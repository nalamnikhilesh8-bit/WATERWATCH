from collections import Counter
from datetime import datetime, timezone as dt_timezone
import json
import random
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from PIL import Image, ImageOps

from reports.ai_classifier import CATEGORIES
from reports.models import ReportImage

class ImageDataset:
    def __init__(self, samples, transform):
        self.samples = samples
        self.transform = transform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, index):
        sample = self.samples[index]
        with Image.open(sample["path"]) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
        return self.transform(image), CATEGORIES.index(sample["label"])

class Command(BaseCommand):
    help = "Fine-tune MobileNetV2 on opt-in, operations-reviewed report photos."

    def add_arguments(self, parser):
        parser.add_argument("--epochs", type=int, default=10)
        parser.add_argument("--batch-size", type=int, default=16)
        parser.add_argument("--min-per-class", type=int, default=100)
        parser.add_argument("--min-test-accuracy", type=float, default=0.55)
        parser.add_argument("--min-test-macro-f1", type=float, default=0.50)
        parser.add_argument("--seed", type=int, default=42)

    def handle(self, *args, **options):
        try:
            import torch
            from torch import nn
            from torch.utils.data import DataLoader
            from torchvision import transforms
            from torchvision.models import MobileNet_V2_Weights, mobilenet_v2
        except ImportError as exc:
            raise CommandError("Install the torch and torchvision packages from requirements.txt before training.") from exc

        if options["epochs"] < 1 or options["batch_size"] < 1 or options["min_per_class"] < 3:
            raise CommandError("Epochs and batch size must be positive; min-per-class must be at least 3.")
        if not 0 <= options["min_test_accuracy"] <= 1:
            raise CommandError("min-test-accuracy must be between 0 and 1.")
        if not 0 <= options["min_test_macro_f1"] <= 1:
            raise CommandError("min-test-macro-f1 must be between 0 and 1.")

        rows = ReportImage.objects.filter(
            stage=ReportImage.Stage.BEFORE,
            consent_for_training=True,
            verified_category__in=CATEGORIES,
            classification_reviewed_by__isnull=False,
            is_demo_placeholder=False,
        ).exclude(image="").order_by("id")

        # Keep one image per report so photos from a single incident cannot leak across train/validation.
        samples, seen_reports = [], set()
        for row in rows:
            if row.report_id in seen_reports:
                continue
            try:
                image_path = Path(row.image.path)
                if not image_path.is_file():
                    continue
                with Image.open(image_path) as image:
                    image.verify()
            except (OSError, ValueError):
                continue
            seen_reports.add(row.report_id)
            samples.append({"path": str(image_path), "label": row.verified_category, "report_id": row.report_id})

        counts = Counter(sample["label"] for sample in samples)
        underrepresented = {category: counts.get(category, 0) for category in CATEGORIES if counts.get(category, 0) < options["min_per_class"]}
        if underrepresented:
            summary = ", ".join(f"{category}={count}" for category, count in underrepresented.items())
            raise CommandError(
                f"Not enough approved photos to train ({summary}). Need at least {options['min_per_class']} per category. "
                "Seeded placeholder images are intentionally excluded; add real photos, opt in, and have operations staff review their labels."
            )

        rng = random.Random(options["seed"])
        training_samples, validation_samples, test_samples = [], [], []
        for category in CATEGORIES:
            category_samples = [sample for sample in samples if sample["label"] == category]
            rng.shuffle(category_samples)
            test_count = max(1, round(len(category_samples) * 0.15))
            validation_count = max(1, round(len(category_samples) * 0.15))
            test_samples.extend(category_samples[:test_count])
            validation_samples.extend(category_samples[test_count:test_count + validation_count])
            training_samples.extend(category_samples[test_count + validation_count:])

        weights = MobileNet_V2_Weights.DEFAULT
        normalization = weights.transforms()
        mean, std = normalization.mean, normalization.std
        train_transform = transforms.Compose([
            transforms.RandomResizedCrop(224, scale=(0.78, 1.0)),
            transforms.RandomHorizontalFlip(),
            transforms.ColorJitter(brightness=0.12, contrast=0.12, saturation=0.12),
            transforms.ToTensor(),
            transforms.Normalize(mean, std),
        ])
        validation_transform = transforms.Compose([
            transforms.Resize(256),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(mean, std),
        ])
        train_loader = DataLoader(ImageDataset(training_samples, train_transform), batch_size=options["batch_size"], shuffle=True, num_workers=0)
        validation_loader = DataLoader(ImageDataset(validation_samples, validation_transform), batch_size=options["batch_size"], shuffle=False, num_workers=0)
        test_loader = DataLoader(ImageDataset(test_samples, validation_transform), batch_size=options["batch_size"], shuffle=False, num_workers=0)

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        model = mobilenet_v2(weights=weights)
        model.classifier[1] = nn.Linear(model.last_channel, len(CATEGORIES))
        for parameter in model.features.parameters():
            parameter.requires_grad = False
        for parameter in model.features[-2:].parameters():
            parameter.requires_grad = True
        model.to(device)

        class_weights = torch.tensor(
            [len(training_samples) / (len(CATEGORIES) * sum(sample["label"] == category for sample in training_samples)) for category in CATEGORIES],
            dtype=torch.float32,
            device=device,
        )
        criterion = nn.CrossEntropyLoss(weight=class_weights)
        optimizer = torch.optim.AdamW((p for p in model.parameters() if p.requires_grad), lr=0.0001, weight_decay=0.0001)
        best_accuracy, best_state = -1.0, None

        for epoch in range(options["epochs"]):
            model.train()
            for images, labels in train_loader:
                images, labels = images.to(device), labels.to(device)
                optimizer.zero_grad(set_to_none=True)
                loss = criterion(model(images), labels)
                loss.backward()
                optimizer.step()

            model.eval()
            correct, total = 0, 0
            confusion = [[0 for _ in CATEGORIES] for _ in CATEGORIES]
            with torch.inference_mode():
                for images, labels in validation_loader:
                    logits = model(images.to(device))
                    predictions = logits.argmax(dim=1).cpu()
                    for expected, predicted in zip(labels.tolist(), predictions.tolist()):
                        confusion[expected][predicted] += 1
                        correct += int(expected == predicted)
                        total += 1
            accuracy = correct / total if total else 0.0
            self.stdout.write(f"Epoch {epoch + 1}/{options['epochs']}: validation accuracy {accuracy:.1%}")
            if accuracy > best_accuracy:
                best_accuracy = accuracy
                best_state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}

        if best_state is None:
            raise CommandError("Training did not produce a model checkpoint.")

        model.load_state_dict(best_state, strict=True)
        model.eval()
        test_confusion = [[0 for _ in CATEGORIES] for _ in CATEGORIES]
        with torch.inference_mode():
            for images, labels in test_loader:
                predictions = model(images.to(device)).argmax(dim=1).cpu()
                for expected, predicted in zip(labels.tolist(), predictions.tolist()):
                    test_confusion[expected][predicted] += 1
        test_total = sum(sum(row) for row in test_confusion)
        test_correct = sum(test_confusion[index][index] for index in range(len(CATEGORIES)))
        test_accuracy = test_correct / test_total if test_total else 0.0
        per_class = []
        for index, category in enumerate(CATEGORIES):
            true_positive = test_confusion[index][index]
            predicted_count = sum(test_confusion[row][index] for row in range(len(CATEGORIES)))
            actual_count = sum(test_confusion[index])
            precision = true_positive / predicted_count if predicted_count else 0.0
            recall = true_positive / actual_count if actual_count else 0.0
            f1 = (2 * precision * recall / (precision + recall)) if precision + recall else 0.0
            per_class.append({"category": category, "precision": precision, "recall": recall, "f1": f1})
        macro_f1 = sum(item["f1"] for item in per_class) / len(per_class)

        if test_accuracy < options["min_test_accuracy"] or macro_f1 < options["min_test_macro_f1"]:
            raise CommandError(
                f"Held-out test accuracy is {test_accuracy:.1%} (minimum {options['min_test_accuracy']:.1%}) "
                f"and macro F1 is {macro_f1:.1%} (minimum {options['min_test_macro_f1']:.1%}); "
                "the current model was left unchanged."
            )

        model_path = Path(settings.WATERWATCH_MODEL_PATH)
        model_path.parent.mkdir(parents=True, exist_ok=True)
        model_version = f"waterwatch-mobilenetv2-{datetime.now(dt_timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid4().hex[:8]}"
        checkpoint = {
            "state_dict": best_state,
            "class_names": list(CATEGORIES),
            "model_version": model_version,
            "trained_at": timezone.now().isoformat(),
            "validation_accuracy": best_accuracy,
            "test_accuracy": test_accuracy,
            "test_macro_f1": macro_f1,
            "sample_count": len(samples),
            "class_counts": dict(counts),
            "test_per_class_metrics": per_class,
            "test_confusion_matrix": test_confusion,
        }
        temporary_path = model_path.with_suffix(model_path.suffix + ".tmp")
        torch.save(checkpoint, temporary_path)
        temporary_path.replace(model_path)
        manifest_path = model_path.with_suffix(".json")
        temporary_manifest = manifest_path.with_suffix(manifest_path.suffix + ".tmp")
        manifest = {key: checkpoint[key] for key in ("model_version", "trained_at", "validation_accuracy", "test_accuracy", "test_macro_f1", "sample_count", "class_counts", "test_per_class_metrics")}
        temporary_manifest.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        temporary_manifest.replace(manifest_path)
        self.stdout.write(self.style.SUCCESS(
            f"Published {model_version} with {len(samples)} consented, reviewed photos; "
            f"held-out test accuracy {test_accuracy:.1%}, macro F1 {macro_f1:.1%}. Checkpoint: {model_path}"
        ))
