# Data dictionary

All objects live in new schemas owned by `hms_analytics`. Nothing here is in the hospital's `public` schema.

**Privacy conventions.**

* `patient_key` is `pat_` followed by 24 hex characters: an HMAC-SHA256 of the patient's email, made with `ANALYTICS_PSEUDONYM_KEY`. The email cannot be recovered from it without the key.
* `doctor_key` is `doc_<Doctor.id>` when the hospital database has doctor ids (migration 002). Otherwise it is a keyed hash of the doctor's email.
* Doctor names are kept because the dashboard shows staff workload by name. Patient names are never read.

## Warehouse (`analytics_warehouse`)

### fact_appointment: one row per appointment ever seen

| Column | Type | Meaning |
|---|---|---|
| appointment_id | int, PK | `Appointment.id` in the hospital database (degenerate dimension) |
| date_key | int, FK dim_date | Appointment date as yyyymmdd |
| start_hour | smallint | Hour the appointment starts (0–23) |
| duration_minutes | int | End time minus start time |
| doctor_sk | int, FK dim_doctor | The doctor version current when the appointment was first loaded, or when its doctor changed |
| department_sk | int, FK dim_department | The doctor's department at that time |
| patient_sk | int, FK dim_patient, nullable | Linked patient. Null when the patient has hidden the visit from their history, which deletes the link. |
| status_key | smallint, FK dim_appointment_status | scheduled, completed, unresolved or removed (see below) |
| source_status | text | Raw hospital status: NotDone or Done |
| has_diagnosis | bool | A diagnosis row exists. The diagnosis text is never read. |
| is_removed | bool | The appointment was deleted in the hospital app after the pipeline first saw it |
| removed_at | timestamptz | When the pipeline noticed the deletion |
| first_seen_at, first_seen_run_id | timestamptz, bigint | When and in which run the appointment was first loaded |
| last_changed_run_id, last_seen_run_id | bigint | Last run that changed the row, and last run that saw it in the source |
| observed_lead_days | int, nullable | Days between first seen and appointment date. Only filled for bookings first seen after the first run, because the hospital tables have no booking time. |
| row_hash | text | MD5 of the source version, used to detect changes |

### fact_doctor_daily_capacity: one row per doctor per day

| Column | Type | Meaning |
|---|---|---|
| doctor_key, date_key | PK | Doctor and day |
| doctor_sk, department_sk | FK | Doctor version and department |
| scheduled_slots | smallint | One-hour slots in the doctor's working hours that day, excluding the break hour |
| capacity_basis | text | `observed` means written on or after that day, from the schedule then in force. `backfilled_from_current_schedule` means the day was before the pipeline's first run, so it is estimated from today's schedule. |
| run_id | bigint | Run that wrote it. Past days are never rewritten. |

### Dimensions

| Table | Grain | Key columns |
|---|---|---|
| dim_date | One row per calendar date used | `date_key` (yyyymmdd), full_date, iso_dow (1 = Monday), day_name, week_start (Monday), iso_week, month_start, month_num, month_name, quarter, year, is_weekend |
| dim_department | One row per department (type 1) | department_sk, department_name (unique), source_id (`Department.id` if it exists), slug, is_active |
| dim_doctor | One row per doctor version (type 2) | doctor_sk, doctor_key, doctor_name, department_sk, is_active, is_demo, consultation_fee, valid_from, valid_to, is_current |
| dim_patient | One row per pseudonymous patient | patient_sk, patient_key |
| dim_appointment_status | Four rows | 1 scheduled, 2 completed, 3 unresolved, 4 removed, each with a label and definition |

Status definitions:

| status_code | Rule |
|---|---|
| scheduled | NotDone and dated today or later |
| completed | Done |
| unresolved | NotDone and the date has passed. This is the no-show proxy; it also counts visits that happened but were never marked done. |
| removed | Deleted from the hospital database after being seen |

## Marts (`analytics_marts`, views)

| View | Grain | Used by |
|---|---|---|
| appointments | One row per appointment, with date parts, doctor, department and status labels | Dashboard, SQL analyses |
| daily_department_operations | Department × day: appointments, completed, unresolved, scheduled, removed, scheduled_slots | SQL 11, capacity |
| weekly_department_demand | Department × ISO week, with weeks that had no appointments filled as 0 | Demand forecast, SQL 03 and 12 |
| ml_appointment_features | One row per past, non-removed appointment with a patient | No-show proxy classifier, SQL 09 |
| data_freshness | One row: the latest successful load and its age in hours | Health check, dashboard header |

`ml_appointment_features` columns:

* appointment_id, appt_date, start_hour, iso_dow, month_num, department_name
* prior_appointments, prior_not_completed, prior_not_completed_rate and days_since_previous. All four are computed only from the same patient's **earlier** appointments, using `ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING`.
* label_not_completed

The patient key is deliberately not exposed in this view.

## Metadata (`analytics_meta`)

| Table | Contents |
|---|---|
| pipeline_runs | One row per run: mode (full, incremental, validate-only or refresh-only), trigger, attempt, status (running, succeeded, succeeded_with_warnings or failed), times, parameters, source row counts, load counts, failed rule count and error summary (message and code only, never row values) |
| run_steps | Per run and step (extract, raw_and_staging, data_quality, warehouse_load, post_load_checks): status, times, rows affected and detail |
| dq_results | One row per rule per run: severity, action, rows evaluated, rows failed, failure %, passed, resolution status |
| quarantine | Rows held back by a quarantine rule, with a pseudonymised JSON copy of the row and a resolution status |
| watermarks | Per source table: highest id and row count at the last successful run |
| source_schema_baseline | Source columns and types captured on the first run, for detecting schema changes |
| dataset_info | One row: is_synthetic, label and notes. Drives the synthetic banner. |
| lineage | Target object, source object and transformation |

## Raw and staging (`analytics_raw`, `analytics_staging`)

* **Raw** tables hold each run's extract as text, already pseudonymised. They cover appointment (with version_hash), appointment_patient, patient (key only), doctor, department, doctor_schedule and diagnosis_marker (appointment id only). They are replaced on every run.
* **Staging** tables hold the typed, standardised rows the rules run against:
  * `appointment` adds patient_links, duration_minutes, has_diagnosis, row_hash and `dq_status` (valid or quarantined; flag-rule failures are recorded in dq_results).
  * `doctor_schedule` gives one row per doctor per ISO weekday, with slots_per_day.

## Machine learning (`analytics_ml`)

| Table | Contents |
|---|---|
| model_runs | One row per training run: model_name, status (trained, insufficient_data or failed), is_synthetic, dataset_label, dataset_version (SHA-256 of the training rows), train and test rows, params, metrics, baseline_metrics, explanation, artifact_path and notes |
| demand_forecast | Department × week forecast with an 80% interval (lower_80, upper_80) |
| segment_profiles | Segment summaries only: label, patient count and median or mean behaviour. Which patient is in which segment is never stored. |
