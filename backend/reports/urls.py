from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import ClassifierStatusView, ClassifyImageView, DuplicateCheckView, ImageClassificationReviewView, ImageTrainingConsentView, LeakReportViewSet

router = DefaultRouter()
router.register("", LeakReportViewSet, basename="report")

urlpatterns = [
    path("check-duplicates/", DuplicateCheckView.as_view(), name="check-duplicates"),
    path("classify-image/", ClassifyImageView.as_view(), name="classify-image"),
    path("classifier-status/", ClassifierStatusView.as_view(), name="classifier-status"),
    path("<int:report_id>/images/<int:image_id>/classification-review/", ImageClassificationReviewView.as_view(), name="image-classification-review"),
    path("<int:report_id>/images/<int:image_id>/training-consent/", ImageTrainingConsentView.as_view(), name="image-training-consent"),
    path("", include(router.urls)),
]
