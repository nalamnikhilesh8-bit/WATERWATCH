from rest_framework import serializers
from django.conf import settings
from django.core.files.base import ContentFile
from io import BytesIO
from operations.models import StatusHistory
from .models import LeakReport, Location, ReportImage
from PIL import Image, ImageOps, UnidentifiedImageError

class LocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Location
        fields = ("id", "latitude", "longitude", "address_landmark", "ward_or_zone")
        read_only_fields = ("id",)

class ReportImageSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()
    uploaded_by_name = serializers.CharField(source="uploaded_by.get_full_name", read_only=True)
    class Meta:
        model = ReportImage
        fields = ("id", "image", "image_url", "stage", "uploaded_by", "uploaded_by_name", "uploaded_at", "consent_for_training", "verified_category", "classification_reviewed_by", "classification_reviewed_at", "is_demo_placeholder")
        read_only_fields = ("id", "uploaded_by", "uploaded_at", "image_url", "uploaded_by_name", "verified_category", "classification_reviewed_by", "classification_reviewed_at", "is_demo_placeholder")

    def validate_image(self, value):
        if value.size > settings.FILE_UPLOAD_MAX_MEMORY_SIZE:
            raise serializers.ValidationError("Image must be 8 MB or smaller.")
        try:
            with Image.open(value) as source:
                if source.format not in ("JPEG", "PNG", "WEBP"):
                    raise serializers.ValidationError("Upload a JPEG, PNG, or WEBP image.")
                if source.width * source.height > 24_000_000:
                    raise serializers.ValidationError("Image dimensions must be 24 megapixels or smaller.")
                source.verify()
            value.seek(0)
        except serializers.ValidationError:
            raise
        except (OSError, ValueError, Image.DecompressionBombError, UnidentifiedImageError) as exc:
            raise serializers.ValidationError("The uploaded image is damaged or cannot be read.") from exc
        return value

    def validate(self, attrs):
        if attrs.get("stage", ReportImage.Stage.BEFORE) == ReportImage.Stage.AFTER and attrs.get("consent_for_training", False):
            raise serializers.ValidationError({"consent_for_training": "Only before-repair photos may be shared for classifier training."})
        return attrs

    def create(self, validated_data):
        upload = validated_data["image"]
        with Image.open(upload) as source:
            safe_image = ImageOps.exif_transpose(source).convert("RGB")
            safe_image.thumbnail((1920, 1920), Image.Resampling.LANCZOS)
            output = BytesIO()
            safe_image.save(output, format="JPEG", quality=90, optimize=True)
        safe_name = f"{upload.name.rsplit('.', 1)[0]}.jpg"
        validated_data["image"] = ContentFile(output.getvalue(), name=safe_name)
        return super().create(validated_data)

    def get_image_url(self, obj):
        request = self.context.get("request")
        return request.build_absolute_uri(obj.image.url) if request else obj.image.url

class HistorySerializer(serializers.ModelSerializer):
    changed_by_name = serializers.CharField(source="changed_by.get_full_name", read_only=True)
    class Meta:
        model = StatusHistory
        fields = ("id", "old_status", "new_status", "changed_by", "changed_by_name", "note", "timestamp")

class LeakReportSerializer(serializers.ModelSerializer):
    location = LocationSerializer()
    images = ReportImageSerializer(many=True, read_only=True)
    history = HistorySerializer(many=True, read_only=True)
    reporter_name = serializers.CharField(source="reporter.get_full_name", read_only=True)
    exact_location = serializers.SerializerMethodField()
    completion_notes = serializers.SerializerMethodField()
    resolved_at = serializers.SerializerMethodField()

    class Meta:
        model = LeakReport
        fields = ("id", "reporter", "reporter_name", "location", "title", "description", "category", "ai_suggested_category", "ai_confidence", "ai_model_version", "ai_classifier_method", "estimated_flow", "duration_hours", "affected_households", "priority_score", "severity_level", "status", "parent_report", "upvotes_count", "is_demo", "created_at", "updated_at", "images", "history", "exact_location", "completion_notes", "resolved_at")
        read_only_fields = ("reporter", "priority_score", "severity_level", "status", "parent_report", "upvotes_count", "is_demo", "created_at", "updated_at", "images", "history", "exact_location", "completion_notes", "resolved_at")

    def get_exact_location(self, obj):
        user = getattr(self.context.get("request"), "user", None)
        return bool(user and user.is_authenticated and (user == obj.reporter or user.role in ("ADMIN", "MAINTENANCE")))

    def get_completion_notes(self, obj):
        assignment = getattr(obj, "assignment", None)
        return assignment.completion_notes if assignment else ""

    def get_resolved_at(self, obj):
        assignment = getattr(obj, "assignment", None)
        return assignment.resolved_at if assignment else None

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not self.get_exact_location(instance):
            data["location"].update(instance.location.get_masked_coordinates())
        return data

    def create(self, validated_data):
        location_data = validated_data.pop("location")
        location = Location.objects.create(**location_data)
        return LeakReport.objects.create(location=location, **validated_data)
