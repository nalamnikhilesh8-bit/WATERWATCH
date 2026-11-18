from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import AnalyticsView, AssignmentListView, AssignmentView, ReportHistoryView, ReportImagesView, ReportStatusView, TeamViewSet

router = DefaultRouter()
router.register("teams", TeamViewSet, basename="team")

urlpatterns = [
    path("assign/", AssignmentView.as_view(), name="assign-report"),
    path("assignments/", AssignmentListView.as_view(), name="assignment-list"),
    path("reports/<int:report_id>/status/", ReportStatusView.as_view(), name="report-status"),
    path("reports/<int:report_id>/images/", ReportImagesView.as_view(), name="report-images"),
    path("reports/<int:report_id>/history/", ReportHistoryView.as_view(), name="report-history"),
    path("analytics/", AnalyticsView.as_view(), name="analytics"),
    path("", include(router.urls)),
]
