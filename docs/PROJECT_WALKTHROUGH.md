# WaterWatch project walkthrough

## 1. Start the application

The browser app and API are separate services. The registration form, report lists, and dashboards need both running.

### Database choice

The checked-in `backend/.env.example` and local `backend/.env` are configured for MySQL. Create the `waterwatch_db` database and set `DB_USER` / `DB_PASSWORD` to a MySQL account that can create tables. If you do not have MySQL credentials ready, set `DB_ENGINE=sqlite` in `backend/.env`; SQLite stores local development data in `backend/db.sqlite3`.

### Start Django

In a terminal at the repository root:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_waterwatch
python manage.py runserver
```

The API is at `http://127.0.0.1:8000/api/`. Keep this terminal running.

### Start React

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`. Keep the React terminal running too. A registration or report action cannot reach Django if only Vite is running.

## 2. Sign in as each role

New self-registered accounts always have the `RESIDENT` role. The role is not selectable on the public form. Use these seeded development accounts to inspect other role views; all use password `WaterWatch@123`:

| Role | Email | View |
| --- | --- | --- |
| Admin | `admin@waterwatch.local` | `/admin` or Operations in the navbar |
| Maintenance | `tech1@waterwatch.local` | `/maintenance` or My work queue |
| Maintenance | `tech2@waterwatch.local` | `/maintenance` or My work queue |
| Resident | `resident1@waterwatch.local` | `/report` and `/my-reports` |
| Resident | `resident2@waterwatch.local` | `/report` and `/my-reports` |

Sign out before changing roles. A resident visiting `/admin` is redirected to Community; this is the expected role guard.

## 3. Resident report flow

1. Register or sign in as a resident.
2. Choose **Report a leak**. Add a title, description, flow estimate, duration, affected households, and a confirmed leak location. Tap the map pin or use GPS; the form blocks submission until the location is confirmed. GPS reports its estimated accuracy so the pin can be adjusted before submitting.
3. A photo can be classified into a suggested category. Review or override it before submitting.
   - In cold-start mode the label is explicitly low confidence; it is not a trained WaterWatch prediction.
   - The optional training checkbox gives permission for this before-repair photo to be used later, after an operations reviewer confirms its category.
4. WaterWatch checks active reports from the last 48 hours within 100 m. If a nearby report appears, choose one of two actions:
   - **Confirm & upvote** adds your confirmation to the existing report. It does not create a new report and therefore does not appear under My reports. Find it on the Community map.
   - **Submit as a new report** creates a separate entry under My reports.
5. My reports lists only reports submitted by the signed-in resident, with status history and repair evidence.

The database keeps the selected coordinates to six decimal places. The resident who submitted a report and authorized operations staff can see the exact pin; public maps and duplicate results round coordinates to three decimal places to protect household locations.

## 4. Operations flow

1. Sign in as `admin@waterwatch.local` and open **Operations**. The triage table is sorted by priority and can be searched or filtered. Assign only real resident reports to an active team; demo examples are not assignable.
2. Sign in as the matching maintenance lead (`tech1` for North Zone, `tech2` for South Zone) and open **My work queue**. The queue contains real reports assigned to that lead and refreshes every 30 seconds.
3. Open a job to see its exact map pin, landmark and zone, and a Google Maps directions link. Review the resident's description, reported issue category, estimated flow, leak duration, households affected, priority, and community confirmations.
4. Check the resident's before-repair photo when one was attached. Residents can also add a before photo later from **My reports** while the report is still open. Generated demo drawings are never shown as real field evidence.
5. Start a repair to move an assigned report to `IN_PROGRESS`.
6. Add completion notes describing the work and an after-repair photo, then submit **verified closure**. The API rejects closure if either is missing. The saved closure notes, photo, and status history appear in the resident and operations views.
7. An assigned maintenance lead can verify the category visible in a before-repair photo. Only photos with both that review and resident opt-in are training candidates.

## 5. Model learning loop

1. A new image gets an immediate inference call. Requests do not modify model weights.
2. A resident may opt in to training use when attaching a real before-repair photo, or later from My reports. Consent can be withdrawn for future runs.
3. An administrator or the report's assigned maintenance lead reviews that before photo and saves a verified category.
4. Once at least 100 eligible photos exist for each of the four categories, run `python manage.py train_image_classifier`. It fine-tunes MobileNetV2, keeps separate validation and test splits, and publishes a versioned checkpoint only when its held-out test accuracy and macro-F1 thresholds pass. Smaller `--min-per-class` values are for experiments only.
5. The admin Operations page shows model version, held-out test accuracy, macro F1, and eligible reviewed sample counts. If either test threshold fails, the previous checkpoint stays active.

The `seed_waterwatch` command creates generated placeholder images for the dashboard. They are explicitly marked and excluded from training because synthetic drawings do not represent real leak photos. Actual sample photos in a demo dataset can be used after opt-in and human review. The app does not learn from unreviewed predictions or resident-selected categories alone.

## 6. Real reports vs demo examples

- Community analytics defaults to **Real reports**, which means non-demo report records saved in the WaterWatch database. It does not use hard-coded chart samples.
- In a development setup (`DEBUG=True`), select **Demo examples** to inspect the seeded Hyderabad walkthrough records. The dashboard marks them as simulated and never mixes them into real-report analytics.
- The analytics view refreshes every 30 seconds. Use **Refresh** for an immediate update, select a time period/category to filter, click a category slice to filter by category, click a status bar to filter map points, and use **Export CSV** to download the displayed aggregate results.
- The admin triage table defaults to real resident reports. Demo examples can be reviewed in the table but cannot be assigned; the maintenance queue and assignment API exclude them.
- The app does not currently connect to municipal sensors, dispatch systems, or an external water authority. Real data enters through resident submissions and operations updates unless an authorized integration is added later.

## 7. Code map

- `backend/accounts/`: custom email-based user, resident registration, JWT login, and role.
- `backend/reports/`: locations, leak reports, photos, priority scoring, Haversine duplicate detection, and image classification.
- `backend/operations/`: maintenance teams, assignments, status audit, repair closure rules, analytics, and demo seeding.
- `frontend/src/features/auth_reporting/`: login, registration, new reports, and resident history.
- `frontend/src/features/intelligence/`: duplicate warning and severity display.
- `frontend/src/features/operations/`: admin triage, maintenance work queue, map, and charts.
- `docs/API_CONTRACTS.md`: endpoint payloads and permissions.

The full API smoke script is `backend/scripts/smoke_api.py`; run it after migrations and seeding with the same Python environment and database settings as Django.
