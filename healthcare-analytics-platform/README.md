# HMS Healthcare Analytics Platform

A separate analytics platform for the Hospital Management System, by akshaya.

It reads the hospital database without changing it and builds its own warehouse in new schemas. On top of that it adds an admin-only dashboard at `/analytics`, a set of SQL analyses, a machine learning module and a data quality framework.

**What it does not do.** The existing app is not modified in any way: no files, pages, API routes, tables, columns, constraints or records. Everything lives in this folder and in six new database schemas (`analytics_meta`, `analytics_raw`, `analytics_staging`, `analytics_warehouse`, `analytics_marts`, `analytics_ml`). The proof is in [docs/regression-proof.md](docs/regression-proof.md).

## What is inside

| Part | Where | What it gives you |
|---|---|---|
| Pipeline | `src/pipeline/` | Copies data from raw to staging, runs data quality checks, then loads the warehouse and marts. Supports full and incremental runs, and running it twice changes nothing. It keeps a run history, reconciles counts, retries temporary failures and checks freshness. |
| Warehouse | `sql/schema/` | A star schema: appointment fact, daily capacity fact, and date, doctor (history kept), department, patient (pseudonymous) and status dimensions. |
| Dashboard and API | `src/server/`, `public/` | Eight pages: overview, departments, doctors, flow, financial, forecasts, data quality and definitions. Each page has filters and CSV downloads, and only signed-in hospital administrators can open it. |
| SQL analyses | `sql/analysis/` | 14 queries. Each has its business question, definition, interpretation, limitations and a validation check. The EXPLAIN plans are in `docs/sql-plans/`. |
| Machine learning | `ml/` | A no-show proxy classifier, a weekly demand forecast and patient visit segments, each compared against baselines with time-based validation. |
| Data quality | `src/pipeline/quality.js` | 21 rules, a quarantine table, lineage, privacy suppression and pseudonymisation. |
| Synthetic data | `src/tools/synthetic.js` | A separate demo database, clearly labelled, for trying everything at realistic scale. |
| Tests | `test/`, `ml/tests/` | 28 Node tests (unit, pipeline, API, regression) and 12 Python tests. |

## Quick start

Full steps are in [docs/setup.md](docs/setup.md). In short, after taking a backup:

```bash
psql -U postgres -d hms -v ON_ERROR_STOP=1 -f healthcare-analytics-platform/sql/setup/00_roles_and_grants.sql
psql -U postgres -d hms -c "\password hms_analytics"
cd healthcare-analytics-platform
copy .env.example .env        # then fill in the password and keys
npm install
npm run db:init
npm run pipeline
npm start                     # http://localhost:3002/analytics
```

Then sign in to the hospital app as an administrator and open http://localhost:3002/analytics.

## Commands

| Command | What it does |
|---|---|
| `npm run db:init` | Creates or updates the analytics schemas. It is safe to run again. |
| `npm run pipeline` | Runs a full load. |
| `npm run pipeline:incremental` | Loads only new, changed and deleted appointments. |
| `npm run validate` | Runs the data quality checks without loading anything. |
| `npm run refresh` | Recomputes time-dependent statuses only. |
| `npm run schedule` | Runs the pipeline every `PIPELINE_SCHEDULE_MINUTES`, with one full run a day. |
| `npm start` | Starts the dashboard and API on `ANALYTICS_PORT` (default 3002). |
| `npm run ml:train` | Trains the three models and stores their results. Needs Python, see `ml/requirements.txt`. |
| `npm run sql:check` | Runs every SQL analysis with EXPLAIN ANALYZE and writes `docs/sql-plans/`. |
| `npm run profile` | Gives an inventory of what the analytics role can read, without printing personal data. |
| `npm run verify:baseline` | Checks that every existing project file is byte for byte unchanged. |
| `npm run synthetic` | Fills a `*_synthetic_dev` database with fictional data. It refuses any other database. |
| `npm run docs:generate` | Regenerates the KPI, data quality rule and lineage pages from the code. |
| `npm test` / `npm run test:ml` | Runs the tests. The database tests need a throwaway database, see [docs/setup.md](docs/setup.md#tests). |

## Documentation

* [Architecture, data flow and ERD](docs/architecture.md)
* [Setup and operations](docs/setup.md)
* [Data dictionary](docs/data-dictionary.md)
* [KPI definitions](docs/kpi-definitions.md)
* [SQL analyses](docs/sql-analytics.md) and their [query plans](docs/sql-plans/README.md)
* [Data quality, privacy and lineage](docs/data-quality.md), with the [rules](docs/data-quality-rules.md) and [lineage](docs/data-lineage.md)
* [Machine learning: methods and results](docs/ml-methodology.md)
* [API reference](docs/api.md)
* [Baseline inspection](docs/baseline.md) and [regression proof](docs/regression-proof.md)
* [Role mapping: Data Engineer, Data Scientist and Data Analyst](docs/roles.md)
* [Limitations](docs/limitations.md)

## Honesty about the numbers

The hospital database in this project holds only a few sample appointments. Every figure in these docs that comes from the dashboard, the SQL analyses or the models was measured on the **synthetic** demo database, and is labelled that way. Those figures show that the methods work. They say nothing about real patients. Run against the real database, the platform reports what that data supports, including "not enough data" where that is the truth.
