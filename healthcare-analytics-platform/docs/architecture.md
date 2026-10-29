# Architecture

## The big picture

```mermaid
flowchart LR
  subgraph existing["Existing hospital app (unchanged)"]
    FE["React frontend :3000"] --> BE["Express backend :3001"]
    BE --> PUB[("PostgreSQL hms<br/>schema public")]
  end
  subgraph platform["healthcare-analytics-platform (new)"]
    PIPE["Pipeline<br/>npm run pipeline / schedule"]
    API["Analytics API + dashboard<br/>:3002/analytics"]
    ML["ML module<br/>python ml/train.py"]
  end
  PUB -- "read-only snapshot<br/>(column-level SELECT)" --> PIPE
  PIPE --> AN[("New schemas<br/>analytics_*")]
  AN --> API
  AN --> ML
  ML --> AN
  PUB -. "session table, read-only<br/>(is this an admin?)" .-> API
  Browser(("Admin's browser")) --> FE
  Browser --> API
```

* The platform is its own Node service on its own port, and its own Python module. The hospital frontend and backend are not touched.
* It connects as a separate database role, `hms_analytics`. That role can read only the hospital columns it needs, and can write only to its own schemas.
* The dashboard recognises administrators by verifying the hospital app's signed `hms.sid` session cookie, using the same secret, and reading (never writing) the `session` table. A browser sends cookies for `localhost` to every port, so an administrator signed in on port 3000 is recognised on port 3002.

## Data flow

```mermaid
flowchart TB
  S[("public.*<br/>hospital tables")] -->|"1. extract: REPEATABLE READ, READ ONLY<br/>emails → HMAC keys"| R["analytics_raw<br/>text copies, per run"]
  R -->|"2. type, standardise, hash"| ST["analytics_staging<br/>typed rows + dq_status"]
  ST -->|"3. data quality rules"| DQ{"pass?"}
  DQ -- "quarantine rule fails" --> Q["analytics_meta.quarantine"]
  DQ -- "flag rule fails" --> W
  DQ -- "pass" --> W["analytics_warehouse<br/>facts + dimensions"]
  W -->|"4. post-load checks<br/>(reconciliation)"| M["analytics_marts<br/>views"]
  M --> D["Dashboard / API"]
  M --> SQL["SQL analyses"]
  M --> ML["ML module"] --> MLT["analytics_ml"]
  META["analytics_meta<br/>runs, steps, dq_results,<br/>watermarks, lineage"]
```

How a run works (`src/pipeline/pipeline.js`):

1. **Lock.** A PostgreSQL advisory lock makes sure only one run happens at a time. A second run that starts while one is going steps aside.
2. **Schema check.** The pipeline compares the source columns it reads with the baseline it saved on its first run. If a column was removed or changed type, the run is blocked (`unexpected_schema_change`).
3. **Extract.** All reads happen in one `REPEATABLE READ READ ONLY` transaction, so every table comes from the same moment and nothing can be written. Patient and doctor emails become keyed hashes here, before anything is stored.
   * **Incremental mode** first scans a version hash per appointment. The hash covers the row, its patient links and whether it has a diagnosis. The run then fetches only appointments that are new or changed. Deletions are found by comparing ids.
4. **Load, all in one transaction.** This covers raw, staging, data quality, warehouse and post-load checks. If anything fails, the warehouse is left exactly as it was and the run is recorded as `failed`.
5. **Retry.** Temporary errors (lost connection, deadlock, serialisation failure) are retried with exponential backoff. Other errors are not retried.
6. **Record.** The run's status, per-step timings, row counts, rule results and watermarks are stored in `analytics_meta`.

Modes:

| Mode | What it does |
|---|---|
| `full` | Compares every source appointment with the warehouse. Inserts new rows, updates changed ones and marks deleted ones as removed. Idempotent: a second full run changes nothing. |
| `incremental` | Does the same work, but reads only the changed appointments. |
| `validate-only` | Extracts and runs the data quality rules without loading anything. |
| `refresh-only` | Recomputes time-dependent statuses. For example, an appointment whose date has passed moves from "upcoming" to "not completed". |

## Warehouse model (ERD)

```mermaid
erDiagram
  dim_date ||--o{ fact_appointment : "date_key"
  dim_doctor ||--o{ fact_appointment : "doctor_sk (version at load)"
  dim_department ||--o{ fact_appointment : "department_sk"
  dim_patient |o--o{ fact_appointment : "patient_sk"
  dim_appointment_status ||--o{ fact_appointment : "status_key"
  dim_date ||--o{ fact_doctor_daily_capacity : "date_key"
  dim_doctor ||--o{ fact_doctor_daily_capacity : "doctor_sk"
  dim_department ||--o{ fact_doctor_daily_capacity : "department_sk"
  dim_department ||--o{ dim_doctor : "department_sk"

  fact_appointment {
    int appointment_id PK "source id (degenerate dimension)"
    int date_key FK
    smallint start_hour
    int duration_minutes
    int doctor_sk FK
    int department_sk FK
    int patient_sk FK "nullable"
    smallint status_key FK
    bool has_diagnosis
    bool is_removed
    timestamptz first_seen_at
    int observed_lead_days "only for bookings seen after the first run"
    text row_hash
  }
  fact_doctor_daily_capacity {
    text doctor_key PK
    int date_key PK
    smallint scheduled_slots
    text capacity_basis "observed | backfilled_from_current_schedule"
  }
  dim_doctor {
    int doctor_sk PK
    text doctor_key "doc_<id> or keyed hash"
    text doctor_name
    bool is_active
    bool is_demo
    timestamptz valid_from
    timestamptz valid_to
    bool is_current "SCD type 2"
  }
  dim_department {
    int department_sk PK
    text department_name UK
    int source_id
    bool is_active
  }
  dim_patient {
    int patient_sk PK
    text patient_key UK "pat_ + 24 hex (HMAC-SHA256)"
  }
  dim_date {
    int date_key PK "yyyymmdd"
    date full_date
    date week_start
    date month_start
  }
  dim_appointment_status {
    smallint status_key PK
    text status_code "scheduled | completed | unresolved | removed"
  }
```

**Grain.**

* `fact_appointment` has one row per appointment ever seen. Appointments deleted in the hospital app stay in the fact table with `is_removed = true`, so cancellations can be measured.
* `fact_doctor_daily_capacity` has one row per doctor per day, giving the number of one-hour slots their working hours offered.

**Status.** The hospital app stores only `NotDone` and `Done`. The warehouse derives four statuses from those values plus the date:

| Status | Meaning |
|---|---|
| `scheduled` | NotDone and dated today or later. |
| `completed` | Done. |
| `unresolved` | NotDone and the date has passed. This is the no-show proxy. |
| `removed` | Deleted from the hospital database after the pipeline first saw it. |

**History.**

* `dim_doctor` is a type 2 slowly changing dimension. A change in name, department, active flag, demo flag or fee closes the current version and opens a new one. Facts keep the version that applied when they were first loaded.
* `dim_department` is type 1: it is updated in place.
* Capacity for past days is frozen once written. Days before the pipeline's first run are back-filled from today's schedule and marked as back-filled.

## Database objects created

Only the setup script touches anything outside the new schemas, and it does so only to create one role and grant it read access. Everything else is created by `npm run db:init` as `hms_analytics`.

| Schema | Contents |
|---|---|
| `analytics_meta` | `pipeline_runs`, `run_steps`, `dq_results`, `quarantine`, `watermarks`, `source_schema_baseline`, `dataset_info`, `lineage` |
| `analytics_raw` | Text copies of each extract: appointment, appointment_patient, patient, doctor, department, doctor_schedule, diagnosis_marker |
| `analytics_staging` | Typed and standardised appointment, doctor, department and doctor_schedule |
| `analytics_warehouse` | The star schema above |
| `analytics_marts` | Views: `appointments`, `daily_department_operations`, `weekly_department_demand`, `ml_appointment_features`, `data_freshness` |
| `analytics_ml` | `model_runs`, `demand_forecast`, `segment_profiles` |

## Code map

```
healthcare-analytics-platform/
  src/config.js, db.js, logger.js, pseudonymize.js
  src/pipeline/   source.js (extract), staging.js, quality.js, warehouse.js, pipeline.js, run.js, scheduler.js
  src/server/     server.js, app.js (API), auth.js, filters.js, kpis.js, csv.js
  src/tools/      init-db.js, synthetic.js, profile.js, sql-check.js, verify-baseline.js, generate-docs.js, lineage.js
  public/         index.html, app.js, styles.css (dashboard, no build step)
  sql/setup/      00_roles_and_grants.sql (run once by the database administrator)
  sql/schema/     01_meta.sql … 05_ml.sql (run by npm run db:init)
  sql/analysis/   01 … 14 analytical queries
  ml/             hms_ml/ (data, classifier, forecast, segments, store), train.py, tests/
  test/           unit, pipeline, api, regression tests
  baseline/       file-manifest.json (hashes of the existing project before this was added)
  docs/
```
