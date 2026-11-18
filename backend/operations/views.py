from collections import Counter
from datetime import datetime, timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Avg, Count, F, ExpressionWrapper, DurationField
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from reports.models import LeakReport, ReportImage
from reports.serializers import LeakReportSerializer, ReportImageSerializer
from reports.services import calculate_distance_meters
from .models import Assignment, MaintenanceTeam, StatusHistory
from .permissions import IsAdminRole, IsOperationsStaff
from .serializers import AssignmentSerializer, MaintenanceTeamSerializer, StatusHistorySerializer
from .services import change_report_status

class TeamViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = MaintenanceTeamSerializer
    permission_classes = [IsOperationsStaff]
    queryset = MaintenanceTeam.objects.filter(is_active=True).select_related("lead_worker").order_by("name")

class AssignmentView(APIView):
    permission_classes = [IsAdminRole]

    @transaction.atomic
    def post(self, request):
        report_id = request.data.get("report")
        team_id = request.data.get("team")
        try:
            report = LeakReport.objects.select_for_update().get(pk=report_id)
            team = MaintenanceTeam.objects.get(pk=team_id, is_active=True)
        except (LeakReport.DoesNotExist, MaintenanceTeam.DoesNotExist, ValueError, TypeError):
            raise ValidationError({"detail": "Choose an existing report and active team."})
        if report.is_demo:
            raise ValidationError({"report": "Demo examples are for practice and cannot be assigned as real maintenance work."})
        if report.status not in ("REPORTED", "VERIFIED", "ASSIGNED"):
            raise ValidationError({"report": "Only open reports can be assigned."})
        old_status = report.status
        assignment, created = Assignment.objects.update_or_create(report=report, defaults={"team": team, "assigned_by": request.user})
        report.status = "ASSIGNED"
        report.save(update_fields=("status", "updated_at", "priority_score", "severity_level"))
        StatusHistory.objects.create(report=report, old_status=old_status, new_status="ASSIGNED", changed_by=request.user, note=f"Assigned to {team.name}.")
        return Response(AssignmentSerializer(assignment).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

class ReportStatusView(APIView):
    permission_classes = [IsOperationsStaff]

    def patch(self, request, report_id):
        try:
            report = LeakReport.objects.select_related("reporter").get(pk=report_id)
        except LeakReport.DoesNotExist:
            return Response({"detail": "Report not found."}, status=status.HTTP_404_NOT_FOUND)
        if request.user.role == "MAINTENANCE":
            if report.is_demo:
                raise PermissionDenied("Demo examples are not maintenance jobs.")
            if not Assignment.objects.filter(report=report, team__lead_worker=request.user).exists():
                raise PermissionDenied("This report is not assigned to your team.")
        updated = change_report_status(report, request.data.get("status", ""), request.user,
                                       note=request.data.get("note", ""),
                                       completion_notes=request.data.get("completion_notes", ""))
        return Response(LeakReportSerializer(updated, context={"request": request}).data)

class ReportImagesView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, report_id):
        try:
            report = LeakReport.objects.get(pk=report_id)
        except LeakReport.DoesNotExist:
            return Response({"detail": "Report not found."}, status=status.HTTP_404_NOT_FOUND)
        if request.user.role == "MAINTENANCE" and report.is_demo:
            raise PermissionDenied("Demo examples are not maintenance jobs.")
        stage = request.data.get("stage", "BEFORE")
        if stage == "BEFORE" and request.user.role == "RESIDENT" and report.reporter_id != request.user.id:
            raise PermissionDenied("You can only add initial photos to your own report.")
        if stage == "AFTER":
            if request.user.role == "ADMIN":
                pass
            elif request.user.role == "MAINTENANCE" and Assignment.objects.filter(report=report, team__lead_worker=request.user).exists():
                pass
            else:
                raise PermissionDenied("Only the assigned team or an administrator can add repair evidence.")
        elif stage == "BEFORE" and request.user.role not in ("RESIDENT", "ADMIN"):
            raise PermissionDenied("You cannot add initial report photos.")
        serializer = ReportImageSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        image = serializer.save(report=report, uploaded_by=request.user)
        return Response(ReportImageSerializer(image, context={"request": request}).data, status=status.HTTP_201_CREATED)

class AssignmentListView(APIView):
    permission_classes = [IsOperationsStaff]
    def get(self, request):
        query = Assignment.objects.filter(report__is_demo=False).select_related("report", "report__location", "team", "team__lead_worker").prefetch_related("report__images", "report__history").order_by("-report__priority_score", "report__created_at")
        if request.user.role == "MAINTENANCE":
            query = query.filter(team__lead_worker=request.user)
        rows = query
        return Response([{"assignment": AssignmentSerializer(row).data,
                          "report": LeakReportSerializer(row.report, context={"request": request}).data} for row in rows])

class AnalyticsView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        source = request.query_params.get("source", "live").lower()
        if source not in ("live", "demo"):
            raise ValidationError({"source": "Choose live or demo."})
        if source == "demo" and not settings.DEBUG:
            raise PermissionDenied("Demo analytics are only available in development mode.")

        window = request.query_params.get("window", "30d").lower()
        if window not in ("7d", "30d", "90d", "all"):
            raise ValidationError({"window": "Choose 7d, 30d, 90d, or all."})
        category = request.query_params.get("category", "all")
        allowed_categories = {choice for choice, _ in LeakReport.Category.choices}
        if category != "all" and category not in allowed_categories:
            raise ValidationError({"category": "Choose a valid report category or all."})

        query = LeakReport.objects.filter(is_demo=(source == "demo"))
        if window != "all":
            days = int(window[:-1])
            query = query.filter(created_at__gte=timezone.now() - timedelta(days=days))
        if category != "all":
            query = query.filter(category=category)
        reports = list(query.select_related("location", "reporter").prefetch_related("images", "assignment"))
        status_tally = Counter(report.status for report in reports)
        category_tally = Counter(report.category for report in reports)
        status_counts = {key: status_tally.get(key, 0) for key, _ in LeakReport.Status.choices}
        category_counts = {key: category_tally.get(key, 0) for key, _ in LeakReport.Category.choices}
        clusters = []
        for report in reports:
            lat, lon = float(report.location.latitude), float(report.location.longitude)
            target = next((cluster for cluster in clusters if calculate_distance_meters(lat, lon, cluster["lat"], cluster["lon"]) <= 150), None)
            if target:
                target["lat_sum"] += lat
                target["lon_sum"] += lon
                target["count"] += 1
                target["lat"] = target["lat_sum"] / target["count"]
                target["lon"] = target["lon_sum"] / target["count"]
            else:
                clusters.append({"lat": lat, "lon": lon, "lat_sum": lat, "lon_sum": lon, "count": 1})
        hotspots = [{"latitude": round(c["lat"], 3), "longitude": round(c["lon"], 3), "report_count": c["count"]} for c in clusters if c["count"] >= 2]
        assigned = [r for r in reports if hasattr(r, "assignment")]
        avg_assign = (sum((r.assignment.assigned_at - r.created_at).total_seconds() / 3600 for r in assigned) / len(assigned)) if assigned else 0
        closed = [r for r in reports if r.status == "RESOLVED"]
        verified_closed = [r for r in closed if hasattr(r, "assignment") and r.assignment.completion_notes.strip() and any(image.stage == "AFTER" for image in r.images.all())] if closed else []
        duplicate_count = sum(r.status == "DUPLICATE" or r.parent_report_id is not None for r in reports) + sum(max(r.upvotes_count - 1, 0) for r in reports)
        resolution_by_month = {}
        for report in closed:
            if hasattr(report, "assignment") and report.assignment.resolved_at:
                month = timezone.localtime(report.assignment.resolved_at).strftime("%Y-%m")
                resolution_by_month.setdefault(month, []).append((report.assignment.resolved_at - report.created_at).total_seconds() / 3600)
        resolution_times = [{"month": month, "label": datetime.strptime(month, "%Y-%m").strftime("%b %Y"), "average_hours": round(sum(hours) / len(hours), 1), "reports": len(hours)} for month, hours in sorted(resolution_by_month.items())]
        report_buckets = Counter()
        for report in reports:
            local_created = timezone.localtime(report.created_at)
            if window == "all":
                bucket = local_created.strftime("%Y-%m")
            elif window == "90d":
                bucket = (local_created.date() - timedelta(days=local_created.weekday())).isoformat()
            else:
                bucket = local_created.date().isoformat()
            report_buckets[bucket] += 1
        reports_over_time = [{"date": key, "count": count} for key, count in sorted(report_buckets.items())]
        staff = request.user.is_authenticated and getattr(request.user, "role", "") in ("ADMIN", "MAINTENANCE")
        map_reports = []
        for r in reports:
            if r.status in ("RESOLVED", "DUPLICATE"):
                continue
            coords = {"latitude": float(r.location.latitude), "longitude": float(r.location.longitude)} if staff else r.location.get_masked_coordinates()
            map_reports.append({"id": r.id, "title": r.title, "category": r.category, "status": r.status, "severity_level": r.severity_level, "priority_score": r.priority_score, "is_demo": r.is_demo, "location": coords})
        map_reports.sort(key=lambda item: item["priority_score"], reverse=True)
        map_limit = 500
        open_reports = [r for r in reports if r.status not in ("RESOLVED", "DUPLICATE")]
        overdue_count = sum(1 for report in open_reports if (timezone.now() - report.created_at).total_seconds() >= 72 * 3600)
        map_reports = map_reports[:map_limit]
        return Response({
            "counts_by_status": status_counts, "counts_by_category": category_counts,
            "hotspots": hotspots, "map_reports": map_reports,
            "resolution_times": resolution_times, "reports_over_time": reports_over_time,
            "report_count": len(reports), "open_report_count": len(open_reports),
            "unassigned_count": sum(1 for report in reports if report.status in ("REPORTED", "VERIFIED") and not hasattr(report, "assignment")),
            "over_72h_open_count": overdue_count, "map_limited": len(open_reports) > map_limit,
            "data_source": source.upper(), "demo_data_available": bool(settings.DEBUG),
            "window": window, "category_filter": category,
            "generated_at": timezone.now().isoformat(),
            "kpis": {"duplicate_reports_detected": duplicate_count,
                     "average_hours_to_assignment": round(avg_assign, 1),
                     "verified_closure_rate": round((len(verified_closed) / len(closed) * 100) if closed else 0, 1),
                     "closed_reports": len(closed)},
        })

class ReportHistoryView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    def get(self, request, report_id):
        try:
            report = LeakReport.objects.get(pk=report_id)
        except LeakReport.DoesNotExist:
            return Response({"detail": "Report not found."}, status=status.HTTP_404_NOT_FOUND)
        allowed = request.user.role in ("ADMIN", "MAINTENANCE") or report.reporter_id == request.user.id
        if not allowed:
            raise PermissionDenied()
        return Response(StatusHistorySerializer(report.history.select_related("changed_by"), many=True).data)
