from django.utils import timezone
from django.db import transaction
from rest_framework.exceptions import ValidationError
from reports.models import LeakReport, ReportImage
from .models import Assignment, StatusHistory

TRANSITIONS = {
    "REPORTED": {"VERIFIED", "DUPLICATE"},
    "VERIFIED": {"ASSIGNED", "DUPLICATE"},
    "ASSIGNED": {"IN_PROGRESS", "VERIFIED"},
    "IN_PROGRESS": {"RESOLVED", "ASSIGNED"},
    "RESOLVED": set(), "DUPLICATE": set(),
}

@transaction.atomic
def change_report_status(report, new_status, actor, note="", completion_notes=""):
    if new_status not in LeakReport.Status.values:
        raise ValidationError({"status": "Unknown report status."})
    if new_status not in TRANSITIONS.get(report.status, set()):
        raise ValidationError({"status": f"Cannot move a report from {report.status} to {new_status}."})
    assignment = getattr(report, "assignment", None)
    if new_status == "ASSIGNED" and not assignment:
        raise ValidationError({"status": "Assign a maintenance team before setting this report to assigned."})
    if assignment and completion_notes:
        assignment.completion_notes = completion_notes.strip()
    if new_status == "RESOLVED":
        notes = completion_notes.strip() or (assignment.completion_notes.strip() if assignment else "")
        if not notes:
            raise ValidationError({"completion_notes": "Completion notes are required to resolve a report."})
        if not ReportImage.objects.filter(report=report, stage=ReportImage.Stage.AFTER).exists():
            raise ValidationError({"after_photo": "An after-repair photo is required to resolve a report."})
        assignment.completion_notes = notes
        assignment.resolved_at = timezone.now()
        assignment.save(update_fields=("completion_notes", "resolved_at"))
    old_status = report.status
    report.status = new_status
    report.save(update_fields=("status", "updated_at", "priority_score", "severity_level"))
    StatusHistory.objects.create(report=report, old_status=old_status, new_status=new_status, changed_by=actor, note=note)
    return report
