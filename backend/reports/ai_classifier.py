"""Human-reviewed WaterWatch image classifier with a cautious cold-start fallback."""
from functools import lru_cache
import json
import logging
from pathlib import Path

from django.conf import settings
from PIL import Image, ImageOps, ImageStat

CATEGORIES = ("suspected_pipe_leak", "overflow", "damaged_valve", "other")
DISCLAIMER = "AI suggestion only — please verify visually before submitting."
logger = logging.getLogger(__name__)

def classifier_status():
    path = Path(settings.WATERWATCH_MODEL_PATH)
    manifest_path = path.with_suffix(".json")
    result = {"model_ready": False, "model_version": "cold-start", "trained_at": None, "validation_accuracy": None, "test_accuracy": None, "test_macro_f1": None, "sample_count": 0, "class_counts": {category: 0 for category in CATEGORIES}}
    if path.is_file() and manifest_path.is_file():
        try:
            with manifest_path.open("r", encoding="utf-8") as manifest_file:
                result.update(json.load(manifest_file))
            result["model_ready"] = True
        except (OSError, ValueError):
            logger.exception("WaterWatch model manifest could not be read.")
    return result

@lru_cache(maxsize=2)
def _load_trained_model(model_path, modified_ns):
    """Load only our own, versioned state-dict checkpoint and cache by file revision."""
    import torch
    from torch import nn
    from torchvision.models import mobilenet_v2

    checkpoint = torch.load(model_path, map_location="cpu", weights_only=True)
    class_names = tuple(checkpoint.get("class_names", ()))
    if class_names != CATEGORIES:
        raise ValueError("WaterWatch checkpoint class order does not match the API categories.")
    model = mobilenet_v2(weights=None)
    model.classifier[1] = nn.Linear(model.last_channel, len(CATEGORIES))
    model.load_state_dict(checkpoint["state_dict"], strict=True)
    model.eval()
    return torch, model, checkpoint

def _cold_start_suggestion(image):
    """Deterministic offline result; intentionally low confidence until trained."""
    sample = image.convert("RGB").resize((48, 48))
    stats = ImageStat.Stat(sample)
    red, green, blue = stats.mean
    contrast = sum(stats.stddev) / 3
    if blue > red * 1.08 and blue > green * 0.98:
        category = "overflow"
    elif contrast > 46:
        category = "damaged_valve"
    elif contrast > 25:
        category = "suspected_pipe_leak"
    else:
        category = "other"
    return {
        "suggested_category": category,
        "confidence": 0.30,
        "method": "untrained deterministic fallback",
        "model_version": "cold-start",
        "model_ready": False,
        "auto_select_category": False,
        "needs_review": True,
    }

def classify_image(uploaded_file):
    with Image.open(uploaded_file) as source:
        if source.format not in ("JPEG", "PNG", "WEBP"):
            raise ValueError("Unsupported image format.")
        if source.width * source.height > 24_000_000:
            raise ValueError("Image dimensions are too large.")
        image = ImageOps.exif_transpose(source).convert("RGB")
    path = Path(settings.WATERWATCH_MODEL_PATH)
    if not path.is_file():
        return {**_cold_start_suggestion(image), "disclaimer": DISCLAIMER}

    try:
        torch, model, checkpoint = _load_trained_model(str(path), path.stat().st_mtime_ns)
        from torchvision.models import MobileNet_V2_Weights
        tensor = MobileNet_V2_Weights.DEFAULT.transforms()(image).unsqueeze(0)
        with torch.inference_mode():
            probabilities = model(tensor)[0].softmax(dim=0)
        confidence, index = probabilities.max(dim=0)
        category = CATEGORIES[int(index)]
        return {
            "suggested_category": category,
            "confidence": round(float(confidence), 4),
            "method": "fine-tuned MobileNetV2",
            "model_version": checkpoint.get("model_version", "unknown"),
            "model_ready": True,
            "auto_select_category": float(confidence) >= settings.WATERWATCH_CLASSIFIER_CONFIDENCE_THRESHOLD,
            "needs_review": True,
            "disclaimer": DISCLAIMER,
        }
    except Exception:
        # A bad/missing checkpoint should never block residents from filing a report.
        logger.exception("WaterWatch classifier checkpoint could not be loaded; using cold-start fallback.")
        return {**_cold_start_suggestion(image), "disclaimer": DISCLAIMER}
