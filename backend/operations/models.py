from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

class MaintenanceTeam(models.Model):
    name = models.CharField(max_length=100)
    zone = models.CharField(max_length=100)
    lead_worker = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="maintenance_teams")
    is_active = models.BooleanField(default=True)

    def clean(self):
        if self.lead_worker_id and self.lead_worker.role != "MAINTENANCE":
            raise ValidationError({"lead_worker": "Team leads must have the MAINTENANCE role."})

    def __str__(self):
        return self.name

class Assignment(models.Model):
    report = models.OneToOneField("reports.LeakReport", on_delete=models.CASCADE, related_name="assignment")
    team = models.ForeignKey(MaintenanceTeam, on_delete=models.PROTECT, related_name="assignments")
    assigned_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_assignments")
    assigned_at = models.DateTimeField(auto_now_add=True)
    completion_notes = models.TextField(blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.report_id} → {self.team.name}"

class StatusHistory(models.Model):
    report = models.ForeignKey("reports.LeakReport", on_delete=models.CASCADE, related_name="history")
    old_status = models.CharField(max_length=30, blank=True)
    new_status = models.CharField(max_length=30)
    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="status_changes")
    note = models.TextField(blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("timestamp", "id")

    def __str__(self):
        return f"{self.report_id}: {self.old_status or 'new'} → {self.new_status}"
