# WaterWatch

WaterWatch is a community water-leak reporting and repair coordination platform. It helps residents report suspected leaks, maintenance teams coordinate repairs, and administrators review service patterns. It is an independent community tool and does not represent a municipal water authority.

## Stack

- React 18, Vite, React Router, Axios, Leaflet, React Leaflet, and Recharts
- Django 5, Django REST Framework, SimpleJWT, and Pillow
- MySQL 8 in configured deployments; SQLite can be selected for local development with `DB_ENGINE=sqlite`
- MobileNetV2 image classification, with a clearly marked cold-start estimate until locally reviewed training data is available

## Local setup

### Backend

1. Create and activate a Python 3.11+ virtual environment in `backend/`.
2. Install dependencies with `pip install -r requirements.txt`.
3. Copy `.env.example` to `.env` and edit the database settings. MySQL is the default; for a no-MySQL local run, set `DB_ENGINE=sqlite`.
4. Run `python manage.py migrate` and `python manage.py seed_waterwatch`.
5. Start the API with `python manage.py runserver`.

To exercise the main authenticated API workflows against your local database, run `python scripts/smoke_api.py` after seeding. It creates and removes a temporary smoke report, and checks that repair closure is rejected without an after photo.

The demo accounts use `WaterWatch@123`: `admin@waterwatch.local`, `tech1@waterwatch.local`, `tech2@waterwatch.local`, `resident1@waterwatch.local`, and `resident2@waterwatch.local`.

### Frontend

1. From `frontend/`, run `npm install`.
2. Copy `.env.example` to `.env.local` if the API is not running at `http://127.0.0.1:8000/api`.
3. Run `npm run dev` and open the URL Vite prints.
4. Create a production bundle with `npm run build`.

The Leaflet map uses OpenStreetMap tiles and requires internet access to load the basemap.

## API overview

Full endpoint paths, authentication rules, request payloads, and response examples are in [docs/API_CONTRACTS.md](docs/API_CONTRACTS.md).

For the full resident-to-repair flow, role demo accounts, and a step-by-step walkthrough, see [docs/PROJECT_WALKTHROUGH.md](docs/PROJECT_WALKTHROUGH.md).

## Collaboration workflow

Use `main` for reviewed releases, `develop` for integrated work, and short-lived `feat/<slice>-<description>` branches. Open pull requests into `develop`; merge `develop` to `main` for releases. Keep migrations owned by their vertical slice and coordinate shared model changes before editing.

| Owner | Slice | Primary paths |
| --- | --- | --- |
| Member 1 | Accounts and resident reporting | `backend/accounts/`, `frontend/src/features/auth_reporting/` |
| Member 2 | Report intelligence and duplicate detection | `backend/reports/`, `frontend/src/features/intelligence/` |
| Member 3 | Repair operations and analytics | `backend/operations/`, `frontend/src/features/operations/` |

Shared app configuration, API contracts, and navigation should be changed through small reviewed pull requests to reduce merge conflicts.

## Privacy and trust

Public map coordinates are rounded to three decimal places. Exact coordinates are restricted to the reporting resident and authorized operations staff. AI output is a suggestion that requires human review. Repair closure requires completion notes and an after-repair photo. The app displays an independence disclaimer throughout.

## Classifier learning

The classifier performs real-time inference but does not train on an unreviewed upload. A before-repair photo can enter a future training batch only after the resident opts in and operations staff verify its category. The trainer requires at least 100 reviewed photos per category by default, keeps separate training, validation, and test sets, and only publishes a model that meets its held-out test accuracy and macro-F1 thresholds. Generated seed placeholders are excluded. The admin Operations page reports eligible photo counts and active model metrics. Reducing the minimum is useful for experiments, not a production accuracy claim.

Community analytics uses saved report records, defaults to non-demo resident submissions, and refreshes every 30 seconds. The development seed set is tagged as demo data and is only available through an explicit Demo examples selector while `DEBUG=True`; those rows are excluded from live analytics. Charts support time/category filters and map/status interaction, and both analytics and admin triage can export filtered CSV data. The project does not currently ingest municipal sensor or dispatch-system feeds.

## Production notes

Set a unique `DJANGO_SECRET_KEY`, `DEBUG=False`, `ALLOWED_HOSTS`, secure database credentials, and HTTPS before deployment. Django refuses to start with `DEBUG=False` and no secret key. Demo seeding is blocked with `DEBUG=False` unless explicitly forced. Use `/api/health/` for a database readiness probe. Install the complete `backend/requirements.txt` in every API process so trained-model inference has Torch and TorchVision. Point `WATERWATCH_MODEL_PATH` to a persistent model artifact volume shared by API workers, and schedule `python manage.py train_image_classifier` in a worker or controlled deployment job. The image classifier is throttled; configure a shared cache such as Redis across API workers so the rate limit is consistent. Configure object storage or persistent media storage, backups, monitoring, and email verification for a public deployment. The included seeded accounts and local defaults are for development only.
