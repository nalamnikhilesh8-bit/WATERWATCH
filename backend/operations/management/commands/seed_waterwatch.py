from datetime import timedelta
from io import BytesIO
from random import Random

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from PIL import Image, ImageDraw

from accounts.models import User
from operations.models import Assignment, MaintenanceTeam, StatusHistory
from reports.models import LeakReport, Location, ReportImage

class Command(BaseCommand):
    help = "Create repeatable demo users, teams, reports, and repair evidence."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true", help="Allow seeding demo records when DEBUG is disabled.")

    def handle(self, *args, **options):
        if not settings.DEBUG and not options["force"]:
            raise CommandError("Demo seeding is disabled when DEBUG=False. Pass --force only in an isolated demo environment.")
        rng = Random(18)
        password = "WaterWatch@123"
        users = {}
        account_specs = [
            ("admin@waterwatch.local", "admin", "ADMIN", "Asha", "Admin"),
            ("tech1@waterwatch.local", "tech1", "MAINTENANCE", "Nikhil", "Rao"),
            ("tech2@waterwatch.local", "tech2", "MAINTENANCE", "Meera", "Das"),
            ("resident1@waterwatch.local", "resident1", "RESIDENT", "Anaya", "Shah"),
            ("resident2@waterwatch.local", "resident2", "RESIDENT", "Kabir", "Sen"),
        ]
        for email, username, role, first, last in account_specs:
            user, _ = User.objects.update_or_create(email=email, defaults={"username": username, "role": role, "first_name": first, "last_name": last, "is_active": True})
            user.set_password(password)
            user.save()
            users[email] = user
        north, _ = MaintenanceTeam.objects.update_or_create(name="North Zone Rapid Response", defaults={"zone": "North Zone", "lead_worker": users["tech1@waterwatch.local"], "is_active": True})
        south, _ = MaintenanceTeam.objects.update_or_create(name="South Zone Pipeline Crew", defaults={"zone": "South Zone", "lead_worker": users["tech2@waterwatch.local"], "is_active": True})
        teams = [north, south]

        # Preserve seeded records by replacing only the deterministic demo report set.
        LeakReport.objects.filter(title__startswith="Demo leak ").delete()
        Location.objects.filter(reports__isnull=True).delete()
        categories = list(LeakReport.Category.values)
        flows = list(LeakReport.Flow.values)
        statuses = ["REPORTED", "VERIFIED", "ASSIGNED", "RESOLVED", "DUPLICATE"]
        # Demo reports are centered on Hyderabad to match the WaterWatch pilot area.
        base_lat, base_lon = 17.3850, 78.4867
        now = timezone.now()
        report_rows = []
        # Five nearby points form an intentional recurring hotspot/duplicate cluster.
        points = [(0.00000, 0.00000), (0.00016, 0.00008), (0.00022, -0.00004), (0.00008, 0.00018), (0.00030, 0.00004)]
        for index in range(25):
            if index < len(points):
                dlat, dlon = points[index]
            else:
                dlat, dlon = rng.uniform(-0.008, 0.008), rng.uniform(-0.009, 0.009)
            location = Location.objects.create(latitude=round(base_lat + dlat, 6), longitude=round(base_lon + dlon, 6), address_landmark=f"{['Cedar Lane', 'Lake Road', 'Market Street', 'Garden Avenue'][index % 4]} · block {index + 1}", ward_or_zone="Central Ward")
            age_hours = [2, 12, 32, 70, 110][index % 5]
            report = LeakReport.objects.create(
                reporter=users["resident1@waterwatch.local"] if index % 2 == 0 else users["resident2@waterwatch.local"],
                location=location, title=f"Demo leak {index + 1:02d} · {['roadside pipe', 'overflowing tank', 'valve seep'][index % 3]}",
                description="Water is escaping near a shared access route. Please verify on site and coordinate a safe repair.",
                category=categories[index % len(categories)], estimated_flow=flows[index % len(flows)],
                duration_hours=1 + (index * 3) % 42, affected_households=1 + (index * 7) % 18,
                ai_suggested_category=categories[(index + 1) % len(categories)] if index % 3 == 0 else None,
                ai_confidence=0.62 if index % 3 == 0 else 0, is_demo=True,
            )
            # Demo timestamps make the dashboards useful immediately.
            LeakReport.objects.filter(pk=report.pk).update(created_at=now - timedelta(hours=age_hours), updated_at=now - timedelta(hours=max(0, age_hours - 2)))
            report.refresh_from_db()
            target_status = statuses[index % len(statuses)]
            if target_status == "DUPLICATE":
                parent = LeakReport.objects.filter(pk__lt=report.pk).order_by("pk").first()
                report.parent_report = parent
                report.status = "DUPLICATE"
                report.save(update_fields=("parent_report", "status", "priority_score", "severity_level", "updated_at"))
            elif target_status in ("ASSIGNED", "RESOLVED"):
                team = teams[index % 2]
                assignment = Assignment.objects.create(report=report, team=team, assigned_by=users["admin@waterwatch.local"], completion_notes="Leak isolated, fitting replaced, and area checked for continued flow." if target_status == "RESOLVED" else "")
                Assignment.objects.filter(pk=assignment.pk).update(assigned_at=report.created_at + timedelta(hours=2), resolved_at=report.created_at + timedelta(hours=5) if target_status == "RESOLVED" else None)
                report.status = target_status
                report.save(update_fields=("status", "priority_score", "severity_level", "updated_at"))
            else:
                report.status = target_status
                report.save(update_fields=("status", "priority_score", "severity_level", "updated_at"))
            StatusHistory.objects.create(report=report, old_status="", new_status="REPORTED", changed_by=report.reporter, note="Seeded sample report.")
            if target_status != "REPORTED":
                StatusHistory.objects.create(report=report, old_status="REPORTED", new_status=target_status, changed_by=users["admin@waterwatch.local"], note="Sample workflow event.")
            if target_status == "RESOLVED":
                for stage, color in (("BEFORE", (74, 158, 202)), ("AFTER", (72, 163, 123))):
                    image = Image.new("RGB", (640, 420), (234, 241, 238))
                    draw = ImageDraw.Draw(image)
                    draw.rounded_rectangle((38, 38, 602, 382), radius=22, fill=(248, 250, 248), outline=color, width=8)
                    draw.line((120, 220, 260, 220, 310, 270, 500, 270), fill=color, width=18)
                    draw.text((64, 72), f"WATERWATCH · {stage} REPAIR", fill=(24, 57, 67))
                    blob = BytesIO()
                    image.save(blob, format="JPEG", quality=84)
                    ReportImage.objects.create(report=report, image=ContentFile(blob.getvalue(), name=f"demo-{report.pk}-{stage.lower()}.jpg"), stage=stage, uploaded_by=assignment.team.lead_worker, is_demo_placeholder=True)
            report_rows.append(report)
        self.stdout.write(self.style.SUCCESS(f"Seeded {len(users)} demo users, 2 teams, and {len(report_rows)} reports."))
