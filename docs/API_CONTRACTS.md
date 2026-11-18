# WaterWatch REST API contracts

Base URL: `http://127.0.0.1:8000/api/`. JSON uses ISO-8601 timestamps. Authenticated endpoints accept `Authorization: Bearer <access-token>`. JWT access tokens last 30 minutes; refresh tokens last 7 days. Error responses use DRF's field-to-message-list format or `{"detail":"..."}`.

## Authentication

### `POST /auth/register/` — public

Creates a resident account. Role is always `RESIDENT` for self-registration.

```json
{
  "email": "resident@example.com",
  "username": "resident",
  "password": "at-least-8-characters",
  "first_name": "Sam",
  "last_name": "Patel",
  "phone": "",
  "locality": "Central Ward"
}
```

Returns HTTP 201 with `access`, `refresh`, and the `user` profile. Password is never returned.

### `POST /auth/login/` — public

```json
{"email":"resident@example.com","password":"..."}
```

```json
{
  "access": "<jwt>",
  "refresh": "<jwt>",
  "user": {"id": 7, "email": "resident@example.com", "username": "resident", "first_name": "Sam", "last_name": "Patel", "role": "RESIDENT", "phone": "", "locality": "Central Ward"}
}
```

### `POST /auth/token/refresh/` — public

Request: `{"refresh":"<jwt>"}`. Returns a new `access` token and, when rotation is enabled, a replacement `refresh` token.

### `GET /auth/me/` — authenticated

Returns the current user's profile using the same `user` object fields above.

## Reports and intelligence

### `GET /reports/` — authenticated

Returns a paginated report list. Administrators see all reports, maintenance leads see their assigned team's reports, and residents see their own. Each report includes `location`, `images`, `history`, and read-only `completion_notes`/`resolved_at` when closure evidence is recorded.

### `POST /reports/` — authenticated resident

```json
{
  "title": "Water pooling beside the north gate",
  "description": "A steady stream is coming from a pipe beside the sidewalk.",
  "category": "suspected_pipe_leak",
  "ai_suggested_category": "suspected_pipe_leak",
  "ai_confidence": 0.72,
  "estimated_flow": "MODERATE_STREAM",
  "duration_hours": 3,
  "affected_households": 4,
  "location": {"latitude": 17.385, "longitude": 78.4867, "address_landmark": "North gate", "ward_or_zone": "Central Ward"}
}
```

Allowed categories: `suspected_pipe_leak`, `overflow`, `damaged_valve`, `other`. Allowed flow values: `LOW_DRIP`, `MODERATE_STREAM`, `HIGH_BURST`. The server sets the reporter and initial `REPORTED` status, computes priority/severity, and adds an initial history event.

### `POST /reports/check-duplicates/` — public

Request: `{"latitude":17.385,"longitude":78.4867}`. Returns open reports from the prior 48 hours within 100 m, sorted by distance. Returned coordinates are masked to three decimal places.

```json
{"matches":[{"id":22,"title":"Water pooling beside the north gate","category":"suspected_pipe_leak","status":"REPORTED","created_at":"2026-11-16T09:30:00Z","distance_meters":42.7,"upvotes_count":3,"location":{"latitude":17.385,"longitude":78.487}}],"window_hours":48,"radius_meters":100}
```

### `POST /reports/{id}/upvote/` — authenticated

Adds one community confirmation to an open report. Returns `{"id":22,"upvotes_count":4}`. Resolved or duplicate reports cannot be upvoted.

### `POST /reports/classify-image/` — public multipart upload

Form field `image`, maximum 8 MB and 24 megapixels. Limited to 30 requests per authenticated user or anonymous IP per hour. Returns a suggested category, confidence in the range 0–1, advisory disclaimer, and classifier method. Until a trained WaterWatch checkpoint is installed, the endpoint returns an explicitly marked low-confidence cold-start estimate that must not be treated as a trained prediction. The category remains subject to resident review.

### `GET /reports/classifier-status/` — administrator or maintenance lead

Returns whether a fine-tuned checkpoint is active, its version and validation/test metrics, training sample count, published class counts, and the current number of eligible consented/reviewed photos per category. A cold-start result means the API can still accept photos but does not yet have a locally trained WaterWatch model.

### `POST /reports/{id}/images/` — authenticated multipart upload

Form fields: `image`, `stage` (`BEFORE` or `AFTER`), and optional `consent_for_training` boolean. Residents may attach `BEFORE` images to their own reports. Training consent is opt-in and never applies to generated placeholders or after-repair images. Residents can change consent later; withdrawal excludes the image from future training runs but does not automatically unlearn an already-published model. Image uploads are re-encoded to strip EXIF location metadata. Administrators or the assigned maintenance lead may attach `AFTER` repair evidence. Returns the image record and absolute `image_url`.

### `PATCH /reports/{report_id}/images/{image_id}/classification-review/` — admin or assigned maintenance lead

Request: `{"verified_category":"damaged_valve"}`. Saves an operations-reviewed category on a `BEFORE` image. The report's self-selected category is not used as a training label.

### `PATCH /reports/{report_id}/images/{image_id}/training-consent/` — image uploader or report owner

Request: `{"consent_for_training":true}` (or `false` to withdraw consent). This does not train the model immediately; it makes the photo eligible for a later batch run only after an operations reviewer has also verified its category. Withdrawal excludes the photo from future training runs; a previously published model retains its weights until a new model is trained without that photo.

### Location privacy

Exact coordinates are serialized only to the reporting resident and authenticated operations staff. Other report views and public map results round both coordinates to three decimal places. Public duplicate-check results also use masked coordinates.

## Operations

### `GET /health/` — unauthenticated readiness check

Returns `{"status":"ok","database":"ok"}` when Django can reach the configured database; returns HTTP 503 if the database is unavailable. Use this endpoint for a load-balancer or deployment health probe.

### `GET /operations/teams/` — administrator or maintenance lead

Returns active teams with `id`, `name`, `zone`, `lead_worker`, `lead_worker_name`, and `is_active`.

### `POST /operations/assign/` — administrator

Request: `{"report":22,"team":2}`. Creates or updates the report's team assignment, sets status to `ASSIGNED`, and writes a `StatusHistory` event. Returns the assignment record. Demo reports are rejected.

### `GET /operations/assignments/` — administrator or maintenance lead

Returns `{ "assignment": ..., "report": ... }` records sorted by report priority descending. Demo reports are excluded. Maintenance leads see only real reports assigned to their own team. Each report includes exact coordinates for its authorized worker, resident before photos, repair history, and completion evidence when resolved.

### `PATCH /operations/reports/{id}/status/` — administrator or assigned maintenance lead

```json
{"status":"IN_PROGRESS","note":"Crew started the repair."}
```

Allowed workflow transitions are `REPORTED → VERIFIED|DUPLICATE`, `VERIFIED → ASSIGNED|DUPLICATE`, `ASSIGNED → IN_PROGRESS|VERIFIED`, and `IN_PROGRESS → RESOLVED|ASSIGNED`. Every successful transition adds a history entry. Resolving requires a saved `AFTER` image and non-empty `completion_notes` in this payload or the assignment record; otherwise the endpoint returns HTTP 400.

### `POST /operations/reports/{id}/images/` — assigned maintenance lead or administrator for `AFTER`

Multipart upload fields `image` and `stage`. The endpoint applies the same role and evidence rules as `/reports/{id}/images/`.

### `GET /operations/reports/{id}/history/` — report owner or operations staff

Returns the status audit events in chronological order.

### `GET /operations/analytics/` — public

Query parameters: `source=live|demo` (default `live`), `window=7d|30d|90d|all` (default `30d`), and optional `category=<category>`. Demo data can only be requested while `DEBUG=True`. The response includes status/category counts, report intake trend, resolution times, operational KPIs, at most 500 open map points, `data_source`, and `generated_at`. Public map points and hotspots are approximate; authenticated operations staff receive exact report points. Live analytics exclude seeded demo records.

Returns counts by status and category, approximately 150 m recurring clusters with at least two reports, masked public map points (exact points for authenticated staff), and pilot KPIs:

```json
{
  "counts_by_status": {"REPORTED": 8, "RESOLVED": 3},
  "counts_by_category": {"suspected_pipe_leak": 5},
  "hotspots": [{"latitude": 17.385, "longitude": 78.487, "report_count": 3}],
  "map_reports": [{"id": 22, "title": "Water pooling beside the north gate", "category": "suspected_pipe_leak", "status": "REPORTED", "severity_level": "HIGH", "priority_score": 63, "location": {"latitude": 17.385, "longitude": 78.487}}],
  "resolution_times": [{"month": "Nov 2026", "average_hours": 8.2, "reports": 3}],
  "kpis": {"duplicate_reports_detected": 2, "average_hours_to_assignment": 6.5, "verified_closure_rate": 75, "closed_reports": 4}
}
```

`verified_closure_rate` is the percentage of resolved reports that have both non-empty completion notes and an `AFTER` image. `average_hours_to_assignment` measures report creation to assignment time.

## Classifier training

`POST /reports/classify-image/` runs immediate inference against the latest published MobileNetV2 checkpoint. Until one exists, the endpoint returns a low-confidence cold-start estimate and marks `model_ready=false`; it will not present the heuristic as a trained prediction. New uploads do not alter model weights during requests. Transfer learning starts from pretrained weights and fine-tunes on the reviewed WaterWatch categories, following the [PyTorch transfer-learning approach](https://docs.pytorch.org/tutorials/beginner/transfer_learning_tutorial.html).

Operations staff label photos after visual review. Residents must separately opt in before their before-repair photo can be used. Run `python manage.py train_image_classifier` periodically to fine-tune and evaluate the MobileNetV2 model. The command requires at least 100 consented, reviewed, non-placeholder photos per category by default. It splits examples into training, validation, and test sets, reports held-out test accuracy and macro F1, and only publishes a checkpoint if both configured release thresholds are met. Use `--min-per-class` to explore early experiments, but do not present a model trained on a smaller set as production-validated. Generated seed drawings are placeholders and are never training examples.
