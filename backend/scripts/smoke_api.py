"""Run after migrate + seed_waterwatch to exercise the main API workflows."""
import io
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "waterwatch_core.settings")

import django
django.setup()

from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient
from accounts.models import User
from reports.models import LeakReport, Location, ReportImage
from uuid import uuid4

BASE = "/api"
PASSWORD = "WaterWatch@123"

registration_key = uuid4().hex[:10]
registration_email = f"smoke-{registration_key}@example.test"
registration = APIClient().post(f"{BASE}/auth/register/", {
    "email": registration_email,
    "username": f"smoke_{registration_key}",
    "password": "SmokeTest@12345",
    "first_name": "Smoke",
    "last_name": "Resident",
    "locality": "Test Ward",
}, format="json")
assert registration.status_code == 201 and registration.data.get("access") and registration.data.get("user", {}).get("role") == "RESIDENT", f"Registration failed: {registration.data}"
registration_client = APIClient()
registration_client.credentials(HTTP_AUTHORIZATION=f"Bearer {registration.data['access']}")
assert registration_client.get(f"{BASE}/auth/me/").status_code == 200
User.objects.filter(email=registration_email).delete()

def login(email):
    client = APIClient()
    response = client.post(f"{BASE}/auth/login/", {"email": email, "password": PASSWORD}, format="json")
    assert response.status_code == 200, f"Login failed for {email}: {response.data}"
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
    return client

def make_photo(name, color):
    stream = io.BytesIO()
    Image.new("RGB", (64, 64), color).save(stream, format="JPEG")
    return SimpleUploadedFile(name, stream.getvalue(), content_type="image/jpeg")

resident = login("resident1@waterwatch.local")
assert resident.get(f"{BASE}/auth/me/").status_code == 200
assert resident.get(f"{BASE}/reports/").status_code == 200

nearby = resident.post(f"{BASE}/reports/check-duplicates/", {"latitude": 17.385, "longitude": 78.4867}, format="json")
assert nearby.status_code == 200 and nearby.data["matches"], f"Duplicate detection failed: {nearby.data}"

classifier = APIClient()
health = classifier.get(f"{BASE}/health/")
assert health.status_code == 200 and health.data.get("database") == "ok", f"Health check failed: {health.data}"
classification = classifier.post(f"{BASE}/reports/classify-image/", {"image": make_photo("suggestion.jpg", (40, 100, 180))}, format="multipart")
assert classification.status_code == 200 and classification.data["suggested_category"], f"Classification failed: {classification.data}"

created = resident.post(f"{BASE}/reports/", {
    "title": "API smoke workflow report",
    "description": "Temporary report used to validate the end-to-end API workflow.",
    "category": "other",
    "estimated_flow": "LOW_DRIP",
    "duration_hours": 2,
    "affected_households": 2,
    "location": {"latitude": 17.395123, "longitude": 78.496456, "address_landmark": "Smoke test point", "ward_or_zone": "Central Ward"},
}, format="json")
assert created.status_code == 201, f"Report create failed: {created.data}"
assert float(created.data["location"]["latitude"]) == 17.395123 and float(created.data["location"]["longitude"]) == 78.496456, f"Report owner coordinates were not preserved: {created.data['location']}"
report_id = created.data["id"]
upvote = resident.post(f"{BASE}/reports/{report_id}/upvote/")
assert upvote.status_code == 200, f"Upvote failed: {upvote.data}"
public_matches = classifier.post(f"{BASE}/reports/check-duplicates/", {"latitude": 17.395123, "longitude": 78.496456}, format="json")
public_location = next((match["location"] for match in public_matches.data.get("matches", []) if match["id"] == report_id), None)
assert public_location and round(float(public_location["latitude"]), 3) == 17.395 and round(float(public_location["longitude"]), 3) == 78.496, f"Public coordinates were not privacy-masked: {public_location}"
before_evidence = resident.post(f"{BASE}/reports/{report_id}/images/", {
    "stage": "BEFORE", "consent_for_training": "true", "image": make_photo("before-repair.jpg", (40, 120, 180)),
}, format="multipart")
assert before_evidence.status_code == 201 and before_evidence.data["consent_for_training"], f"Before photo consent failed: {before_evidence.data}"

admin = login("admin@waterwatch.local")
teams_response = admin.get(f"{BASE}/operations/teams/")
assert teams_response.status_code == 200, f"Team list failed: {teams_response.data}"
teams = teams_response.data.get("results", teams_response.data)
team = teams[0]
assigned = admin.post(f"{BASE}/operations/assign/", {"report": report_id, "team": team["id"]}, format="json")
assert assigned.status_code == 201, f"Assignment failed: {assigned.data}"

worker = login("tech1@waterwatch.local")
review = worker.patch(f"{BASE}/reports/{report_id}/images/{before_evidence.data['id']}/classification-review/", {"verified_category": "other"}, format="json")
assert review.status_code == 200 and review.data["verified_category"] == "other", f"Image category review failed: {review.data}"
started = worker.patch(f"{BASE}/operations/reports/{report_id}/status/", {"status": "IN_PROGRESS"}, format="json")
assert started.status_code == 200, f"Could not start repair: {started.data}"
premature = worker.patch(f"{BASE}/operations/reports/{report_id}/status/", {"status": "RESOLVED", "completion_notes": "Repair complete."}, format="json")
assert premature.status_code == 400, f"Closure should require an after photo: {premature.data}"
evidence = worker.post(f"{BASE}/operations/reports/{report_id}/images/", {"stage": "AFTER", "image": make_photo("after-repair.jpg", (70, 150, 110))}, format="multipart")
assert evidence.status_code == 201, f"After photo upload failed: {evidence.data}"
resolved = worker.patch(f"{BASE}/operations/reports/{report_id}/status/", {"status": "RESOLVED", "completion_notes": "Replaced the coupling and confirmed the leak stopped."}, format="json")
assert resolved.status_code == 200, f"Verified closure failed: {resolved.data}"
withdrawn = resident.patch(f"{BASE}/reports/{report_id}/images/{before_evidence.data['id']}/training-consent/", {"consent_for_training": False}, format="json")
assert withdrawn.status_code == 200 and not withdrawn.data["consent_for_training"], f"Consent withdrawal failed: {withdrawn.data}"
classifier_status = admin.get(f"{BASE}/reports/classifier-status/")
assert classifier_status.status_code == 200 and "model_ready" in classifier_status.data, f"Classifier status failed: {classifier_status.data}"
assert set(classifier_status.data.get("eligible_class_counts", {})) == {"suspected_pipe_leak", "overflow", "damaged_valve", "other"}, f"Training dataset status failed: {classifier_status.data}"

analytics = classifier.get(f"{BASE}/operations/analytics/")
assert analytics.status_code == 200 and "resolution_times" in analytics.data and analytics.data["data_source"] == "LIVE", f"Live analytics failed: {analytics.data}"
assert all(not row["is_demo"] for row in analytics.data.get("map_reports", [])), f"Demo data leaked into live analytics: {analytics.data.get('map_reports')}"
demo_analytics = classifier.get(f"{BASE}/operations/analytics/", {"source": "demo", "window": "all"})
assert demo_analytics.status_code == 200 and demo_analytics.data["data_source"] == "DEMO" and demo_analytics.data["report_count"] >= 25, f"Demo analytics failed: {demo_analytics.data}"
for smoke_image in ReportImage.objects.filter(report_id=report_id):
    if smoke_image.image:
        smoke_image.image.delete(save=False)
LeakReport.objects.filter(pk=report_id, title="API smoke workflow report").delete()
Location.objects.filter(reports__isnull=True).delete()
print("API smoke passed and cleaned up: health, registration, auth, report creation, exact/masked location, photo consent/review, duplicates, upvote, image suggestion, assignment, closure evidence, classifier status, analytics")
