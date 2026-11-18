from datetime import timedelta

from django.db.models import F
from django.db import transaction
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework import serializers
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from operations.models import Assignment, StatusHistory
from operations.permissions import IsOperationsStaff
from .ai_classifier import classify_image, classifier_status
from .models import LeakReport, ReportImage
from .serializers import LeakReportSerializer, ReportImageSerializer
from .services import calculate_distance_meters

class LeakReportViewSet(viewsets.ModelViewSet):
    serializer_class = LeakReportSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = LeakReport.objects.select_related("reporter", "location", "assignment", "assignment__team").prefetch_related("images", "history").order_by("-created_at", "-pk")
        user = self.request.user
        if user.role == "ADMIN":
            return queryset
        if user.role == "MAINTENANCE":
            return queryset.filter(assignment__team__lead_worker=user).distinct()
        return queryset.filter(reporter=user)

    @transaction.atomic
    def perform_create(self, serializer):
        report = serializer.save(reporter=self.request.user)
        StatusHistory.objects.create(report=report, old_status="", new_status=report.status, changed_by=self.request.user, note="Report submitted by resident.")

    @action(detail=True, methods=["post"])
    def upvote(self, request, pk=None):
        # Duplicate check results may refer to a neighbor's report, so this lookup is intentionally global.
        report = LeakReport.objects.filter(pk=pk).first()
        if not report or report.status in ("RESOLVED", "DUPLICATE"):
            return Response({"detail": "This report is not open for upvotes."}, status=status.HTTP_404_NOT_FOUND)
        LeakReport.objects.filter(pk=report.pk).update(upvotes_count=F("upvotes_count") + 1)
        report.refresh_from_db(fields=("upvotes_count",))
        return Response({"id": report.id, "upvotes_count": report.upvotes_count})

    @action(detail=True, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def images(self, request, pk=None):
        report = self.get_object()
        stage = request.data.get("stage", "BEFORE")
        if stage == "AFTER":
            if request.user.role == "ADMIN":
                pass
            elif request.user.role == "MAINTENANCE" and Assignment.objects.filter(report=report, team__lead_worker=request.user).exists():
                pass
            else:
                return Response({"detail": "Only the assigned team or an administrator can add after-repair evidence."}, status=status.HTTP_403_FORBIDDEN)
        elif report.reporter_id != request.user.id and request.user.role != "ADMIN":
            return Response({"detail": "You can only add initial photos to your own report."}, status=status.HTTP_403_FORBIDDEN)
        serializer = ReportImageSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        image = serializer.save(report=report, uploaded_by=request.user)
        return Response(ReportImageSerializer(image, context={"request": request}).data, status=status.HTTP_201_CREATED)

class DuplicateCheckView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        try:
            latitude = float(request.data["latitude"])
            longitude = float(request.data["longitude"])
        except (KeyError, TypeError, ValueError):
            return Response({"detail": "Valid latitude and longitude are required."}, status=status.HTTP_400_BAD_REQUEST)
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            return Response({"detail": "Coordinates are out of range."}, status=status.HTTP_400_BAD_REQUEST)
        cutoff = timezone.now() - timedelta(hours=48)
        candidates = LeakReport.objects.filter(created_at__gte=cutoff).exclude(status__in=("RESOLVED", "DUPLICATE")).select_related("location")
        results = []
        for report in candidates:
            distance = calculate_distance_meters(latitude, longitude, report.location.latitude, report.location.longitude)
            if distance <= 100:
                results.append({"id": report.id, "title": report.title, "category": report.category,
                                "status": report.status, "created_at": report.created_at,
                                "distance_meters": round(distance, 1), "upvotes_count": report.upvotes_count,
                                "location": report.location.get_masked_coordinates()})
        results.sort(key=lambda row: row["distance_meters"])
        return Response({"matches": results, "window_hours": 48, "radius_meters": 100})

class ClassifyImageView(APIView):
    permission_classes = [permissions.AllowAny]
    parser_classes = [MultiPartParser, FormParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "image-classify"

    def post(self, request):
        upload = request.FILES.get("image")
        if not upload:
            return Response({"detail": "Upload an image in the 'image' field."}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > 8 * 1024 * 1024:
            return Response({"detail": "Image must be 8 MB or smaller."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            result = classify_image(upload)
        except Exception:
            return Response({"detail": "The image could not be read. Upload a JPEG, PNG, or WEBP image."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)

class ClassifierStatusView(APIView):
    permission_classes = [IsOperationsStaff]

    def get(self, request):
        result = classifier_status()
        eligible = ReportImage.objects.filter(
            stage=ReportImage.Stage.BEFORE,
            consent_for_training=True,
            classification_reviewed_by__isnull=False,
            verified_category__in=[choice for choice, _ in LeakReport.Category.choices],
            is_demo_placeholder=False,
        )
        result["eligible_class_counts"] = {
            category: eligible.filter(verified_category=category).values("report_id").distinct().count()
            for category, _ in LeakReport.Category.choices
        }
        result["eligible_total"] = sum(result["eligible_class_counts"].values())
        result["minimum_per_class"] = 100
        return Response(result)

class ImageClassificationReviewView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, report_id, image_id):
        if request.user.role not in ("ADMIN", "MAINTENANCE"):
            return Response({"detail": "Only operations staff can verify image categories."}, status=status.HTTP_403_FORBIDDEN)
        report = LeakReport.objects.filter(pk=report_id).first()
        image = ReportImage.objects.filter(pk=image_id, report_id=report_id, stage=ReportImage.Stage.BEFORE).first()
        if not report or not image:
            return Response({"detail": "Before-repair report image not found."}, status=status.HTTP_404_NOT_FOUND)
        if image.is_demo_placeholder:
            return Response({"detail": "Generated demo placeholders cannot be used as reviewed training photos."}, status=status.HTTP_400_BAD_REQUEST)
        if request.user.role == "MAINTENANCE" and not Assignment.objects.filter(report=report, team__lead_worker=request.user).exists():
            return Response({"detail": "Only the assigned maintenance team can review this image."}, status=status.HTTP_403_FORBIDDEN)
        choice = serializers.ChoiceField(choices=LeakReport.Category.choices)
        category = choice.run_validation(request.data.get("verified_category"))
        image.verified_category = category
        image.classification_reviewed_by = request.user
        image.classification_reviewed_at = timezone.now()
        image.save(update_fields=("verified_category", "classification_reviewed_by", "classification_reviewed_at"))
        return Response(ReportImageSerializer(image, context={"request": request}).data)

class ImageTrainingConsentView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, report_id, image_id):
        image = ReportImage.objects.filter(pk=image_id, report_id=report_id).select_related("report").first()
        if not image:
            return Response({"detail": "Report image not found."}, status=status.HTTP_404_NOT_FOUND)
        if image.uploaded_by_id != request.user.id and image.report.reporter_id != request.user.id:
            return Response({"detail": "Only the report owner or image uploader may change training consent."}, status=status.HTTP_403_FORBIDDEN)
        consent = serializers.BooleanField().run_validation(request.data.get("consent_for_training"))
        if image.stage != ReportImage.Stage.BEFORE and consent:
            return Response({"detail": "Only before-repair photos may be used for classifier training."}, status=status.HTTP_400_BAD_REQUEST)
        if image.is_demo_placeholder and consent:
            return Response({"detail": "Generated demo placeholders cannot be used for training."}, status=status.HTTP_400_BAD_REQUEST)
        image.consent_for_training = consent
        image.save(update_fields=("consent_for_training",))
        return Response(ReportImageSerializer(image, context={"request": request}).data)
