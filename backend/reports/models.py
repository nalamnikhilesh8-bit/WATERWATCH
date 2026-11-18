from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from .services import calculate_priority

class Location(models.Model):
    latitude = models.DecimalField(max_digits=9, decimal_places=6, validators=[MinValueValidator(-90), MaxValueValidator(90)])
    longitude = models.DecimalField(max_digits=9, decimal_places=6, validators=[MinValueValidator(-180), MaxValueValidator(180)])
    address_landmark = models.CharField(max_length=255, blank=True)
    ward_or_zone = models.CharField(max_length=100, blank=True)

    def get_masked_coordinates(self):
        return {"latitude": round(float(self.latitude), 3), "longitude": round(float(self.longitude), 3)}

    def __str__(self):
        return self.address_landmark or f"{self.latitude}, {self.longitude}"

class LeakReport(models.Model):
    class Category(models.TextChoices):
        PIPE_LEAK = "suspected_pipe_leak", "Suspected pipe leak"
        OVERFLOW = "overflow", "Overflow"
        VALVE = "damaged_valve", "Damaged valve"
        OTHER = "other", "Other"
    class Flow(models.TextChoices):
        LOW = "LOW_DRIP", "Low drip"
        MODERATE = "MODERATE_STREAM", "Moderate stream"
        HIGH = "HIGH_BURST", "High burst"
    class Severity(models.TextChoices):
        LOW = "LOW", "Low"
        MEDIUM = "MEDIUM", "Medium"
        HIGH = "HIGH", "High"
        CRITICAL = "CRITICAL", "Critical"
    class Status(models.TextChoices):
        REPORTED = "REPORTED", "Reported"
        VERIFIED = "VERIFIED", "Verified"
        ASSIGNED = "ASSIGNED", "Assigned"
        IN_PROGRESS = "IN_PROGRESS", "In progress"
        RESOLVED = "RESOLVED", "Resolved"
        DUPLICATE = "DUPLICATE", "Duplicate"

    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="leak_reports")
    location = models.ForeignKey(Location, on_delete=models.PROTECT, related_name="reports")
    title = models.CharField(max_length=150)
    description = models.TextField()
    category = models.CharField(max_length=32, choices=Category.choices, default=Category.OTHER)
    ai_suggested_category = models.CharField(max_length=50, blank=True, null=True)
    ai_confidence = models.FloatField(default=0.0, validators=[MinValueValidator(0.0), MaxValueValidator(1.0)])
    ai_model_version = models.CharField(max_length=80, blank=True)
    ai_classifier_method = models.CharField(max_length=120, blank=True)
    estimated_flow = models.CharField(max_length=20, choices=Flow.choices, default=Flow.LOW)
    duration_hours = models.PositiveIntegerField(default=1)
    affected_households = models.PositiveIntegerField(default=1)
    priority_score = models.FloatField(default=0.0)
    severity_level = models.CharField(max_length=10, choices=Severity.choices, default=Severity.LOW)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.REPORTED)
    parent_report = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="duplicate_reports")
    upvotes_count = models.PositiveIntegerField(default=1)
    is_demo = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        self.priority_score, self.severity_level = calculate_priority(self.estimated_flow, self.duration_hours, self.affected_households)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.title} (#{self.pk or 'new'})"

class ReportImage(models.Model):
    class Stage(models.TextChoices):
        BEFORE = "BEFORE", "Before repair"
        AFTER = "AFTER", "After repair"
    report = models.ForeignKey(LeakReport, on_delete=models.CASCADE, related_name="images")
    image = models.ImageField(upload_to="leak_reports/%Y/%m/")
    stage = models.CharField(max_length=10, choices=Stage.choices, default=Stage.BEFORE)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="uploaded_report_images")
    uploaded_at = models.DateTimeField(auto_now_add=True)
    consent_for_training = models.BooleanField(default=False)
    verified_category = models.CharField(max_length=32, choices=LeakReport.Category.choices, blank=True)
    classification_reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="reviewed_report_images")
    classification_reviewed_at = models.DateTimeField(null=True, blank=True)
    is_demo_placeholder = models.BooleanField(default=False)

    class Meta:
        indexes = [models.Index(fields=("stage", "consent_for_training", "verified_category"), name="rimg_training_filter_idx")]

    def __str__(self):
        return f"{self.report_id} · {self.stage}"
