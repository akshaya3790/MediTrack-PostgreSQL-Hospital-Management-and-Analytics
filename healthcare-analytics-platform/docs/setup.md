# Setup and operations

These steps are for Windows with PostgreSQL installed locally, as in the hospital project. Every command runs from the project folder `Hospital-Management-System-DBMS-master` unless it says otherwise.

## 1. Take a backup first

```bash
pg_dump -U postgres -d hms -F c -f hms_backup_before_analytics.dump
```

The platform never writes to the hospital tables, but the setup script does change database permissions, so a backup comes first.

## 2. Create the analytics role and schemas (database administrator, once)

```bash
psql -U postgres -d hms -v ON_ERROR_STOP=1 -f healthcare-analytics-platform/sql/setup/00_roles_and_grants.sql
psql -U postgres -d hms
```

Inside `psql`, set the role's password yourself. It is never written in any file the project ships:

```
\password hms_analytics
\q
```

What the script does:

* Creates the login role `hms_analytics`.
* Creates the six `analytics_*` schemas, owned by that role.
* Grants read access, column by column, to the hospital columns the analytics need.

It does not add, change or remove any table, column, constraint, trigger or row. Grants do change the permission list of the hospital tables they cover; see [limitations](limitations.md#permissions-on-hospital-tables) for what that means and the read-replica alternative.

Columns the role **cannot** read include:

* password hashes, patient names, addresses, gender and dates of birth
* visit concerns and symptoms, diagnoses, prescriptions and medical histories

## 3. Configure

```bash
cd healthcare-analytics-platform
copy .env.example .env
```

Edit `.env`:

| Setting | Value |
|---|---|
| `ANALYTICS_DB_NAME` | `hms` |
| `ANALYTICS_DB_PASSWORD` | The password you just set. |
| `ANALYTICS_PSEUDONYM_KEY` | At least 16 random characters. One way to make one: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`. Keep it safe and do not change it later, or every patient will look new. |
| `HMS_SESSION_SECRET` | The same value as `SESSION_SECRET` in `backend/.env`. Leave it empty if the backend has none. |
| `HMS_APP_URL` | Where the hospital app runs, `http://localhost:3000` by default. |

## 4. Install, create the schemas, load the data

```bash
npm install
npm run db:init
npm run pipeline
```

The pipeline prints JSON log lines and ends with a summary. Run it again whenever you like: if nothing changed in the hospital data, nothing changes in the warehouse.

## 5. Open the dashboard

```bash
npm start
```

Sign in to the hospital app as an administrator, then open http://localhost:3002/analytics. Anyone who is not signed in as an administrator gets a sign-in link and no data.

## 6. Machine learning (optional)

Needs Python 3.10 or newer.

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r ml/requirements.txt
python ml/train.py
```

With only the sample data, every model reports `insufficient_data` and says how much data it needs. That is the intended behaviour.

## 7. Keep it up to date

Choose one of these:

* `npm run schedule` keeps running and loads every `PIPELINE_SCHEDULE_MINUTES` (default 60), with one full load a day.
* Windows Task Scheduler runs `npm run pipeline:incremental` hourly and `npm run pipeline` nightly, with "Start in" set to the `healthcare-analytics-platform` folder.

Only one run can happen at a time. If a scheduled run starts while another is going, it skips.

## Health checks

* `GET http://localhost:3002/analytics/api/health` is public. It returns `{"status":"ok","database":"reachable","lastRefreshHoursAgo":…}`, or HTTP 503 when the database cannot be reached. It holds no data, so a monitor can poll it.
* The dashboard header shows when the data was last refreshed, and the Data quality page shows every run.
* The `data_freshness` rule fails when the last successful load is older than `PIPELINE_FRESHNESS_HOURS` (default 26).
* `analytics_meta.pipeline_runs` and `analytics_meta.run_steps` hold the history. To see recent runs:

```sql
SELECT run_id, mode, status, started_at, finished_at, load_counts, error_summary
FROM analytics_meta.pipeline_runs ORDER BY run_id DESC LIMIT 10;
```

## Synthetic demo database (optional)

This lets you see the dashboard and models at realistic scale without any real data:

```bash
psql -U postgres -c "CREATE DATABASE hms_synthetic_dev OWNER hms_analytics"
set ANALYTICS_DB_NAME=hms_synthetic_dev
npm run synthetic
npm run db:init
npm run pipeline
python ml/train.py
npm start
```

What the generator does:

* It refuses any database whose name does not end in `_synthetic_dev` or `_test`.
* It creates the hospital tables from the project's own `DDL.sql` and migrations, then generates 2,500 fictional patients, 22 fictional doctors and about 26,000 appointments over two years.
* Every name says "Synthetic", and emails end in `@example.invalid`.
* The dataset is flagged as synthetic, and the dashboard shows a banner saying so.

`node src/tools/synthetic.js --simulate-days=1` simulates a day of new bookings, completions and cancellations, which is useful for watching incremental loads.

## Tests

The platform's tests never touch the hospital database.

```bash
npm test                 # unit tests; database tests are skipped unless the variables below are set
npm run test:ml          # Python tests, no database needed
```

To run the database tests, create a throwaway database. Its name must end in `_test`, because the tests wipe it:

```bash
psql -U postgres -c "CREATE DATABASE hms_analytics_test OWNER hms_analytics"
set ANALYTICS_TEST_DB_NAME=hms_analytics_test
npm test
```

The regression test needs a copy of the hospital database with the setup script applied. Never point it at a database you cannot rebuild:

```bash
set ANALYTICS_REGRESSION_DB_NAME=hms_copy
npm test
```

## Troubleshooting

| Message | What to do |
|---|---|
| `ANALYTICS_PSEUDONYM_KEY must be set` | Fill it in `.env`, using at least 16 characters. |
| `password authentication failed for user "hms_analytics"` | Set the password with `\password hms_analytics` and put the same value in `.env`. |
| `permission denied for table …` | Run the setup script again. It is safe to repeat, and it also picks up the department columns if migration 002 was applied later. |
| The dashboard says "Administrators only" while you are signed in | `HMS_SESSION_SECRET` must equal the backend's `SESSION_SECRET`. Use the same host name (`localhost`) for both apps. |
| A run is blocked with `unexpected_schema_change` | A hospital column the pipeline reads was removed or changed type. Check `analytics_meta.dq_results`. If the change is intended, clear `analytics_meta.source_schema_baseline` so the next run records the new baseline. |
| The dashboard shows 503 | The analytics schemas are missing (run `npm run db:init`) or the database is down. |

## Removing the platform

Everything can be removed without touching the hospital data:

```sql
DROP SCHEMA analytics_meta, analytics_raw, analytics_staging, analytics_warehouse, analytics_marts, analytics_ml CASCADE;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hms_analytics;
REVOKE ALL ON SCHEMA public FROM hms_analytics;
REVOKE ALL ON DATABASE hms FROM hms_analytics;
DROP ROLE hms_analytics;
```

Then delete the `healthcare-analytics-platform` folder.
