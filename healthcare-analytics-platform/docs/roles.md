# Role mapping

This page shows where the work in this platform matches what a Data Engineer, a Data Scientist and a Data Analyst would be expected to do, and where to find each piece. It describes the project. It makes no claims about anyone's experience.

## Data Engineer

| Skill | Where it is shown |
|---|---|
| Layered pipeline (raw → staging → quality → warehouse → marts) | `src/pipeline/`, [architecture.md](architecture.md#data-flow) |
| Full and incremental loads with change data capture (version hash, deletion detection) | `src/pipeline/source.js` `VERSIONED_APPOINTMENTS`, `warehouse.js` `loadAppointments` |
| Idempotency and transactional safety (one write transaction, rollback on failure) | `pipeline.js`; tested in `test/pipeline.test.js` ("running the same full load again changes nothing", "a failed run leaves the warehouse untouched") |
| Consistent extracts (`REPEATABLE READ READ ONLY` snapshot) | `pipeline.js` extract step |
| Concurrency control (advisory lock) and retries with exponential backoff | `runPipeline`; tested ("two runs at once") |
| Dimensional modelling: star schema, SCD type 2 doctor dimension, degenerate dimension, capacity fact | `sql/schema/03_warehouse.sql`, [ERD](architecture.md#warehouse-model-erd) |
| Run history, step timings, watermarks, freshness, schema drift detection | `analytics_meta.*`, `checkSourceSchema` |
| Least-privilege database access with column-level grants | `sql/setup/00_roles_and_grants.sql` |
| Scheduling and health checks | `src/pipeline/scheduler.js`, `/analytics/api/health` |
| Synthetic data generation for safe scale testing | `src/tools/synthetic.js` |
| Query performance work (EXPLAIN ANALYZE, CTE rewrite of a correlated subquery: 27 s → 3 s) | `npm run sql:check`, [sql-plans](sql-plans/README.md) |

## Data Scientist

| Skill | Where it is shown |
|---|---|
| Problem framing with an honest proxy label ("not completed" in place of no-show) | [ml-methodology.md](ml-methodology.md#1-not-completed-no-show-proxy-classifier) |
| Leakage-free features (point-in-time window frames) | `analytics_marts.ml_appointment_features` |
| Time-based train, validation and test split; rolling-origin backtest | `ml/hms_ml/classifier.py` `time_split`, `forecast.py` `backtest` |
| Comparison against simple baselines (own past rate, seasonal naive, moving average) | Results tables in [ml-methodology.md](ml-methodology.md) |
| Imbalanced classification metrics: PR-AUC, precision and recall at a threshold chosen on validation, Brier score, calibration | `classifier.py` |
| Explainability (permutation importance) | `model_runs.explanation`, dashboard Forecasts page |
| Forecast uncertainty (empirical 80% intervals with held-out coverage check) | `forecast.py` `interval_coverage` |
| Unsupervised segmentation with model selection (silhouette) and privacy-safe outputs | `ml/hms_ml/segments.py` |
| Reproducibility (dataset hashes, versioned artifacts, model cards) | `ml/hms_ml/store.py` |
| Refusing to train on insufficient data | `insufficient_data` status and tests |

## Data Analyst

| Skill | Where it is shown |
|---|---|
| KPI design with written definitions and SQL | [kpi-definitions.md](kpi-definitions.md), dashboard tooltips and the Definitions page |
| Advanced SQL: window functions, cohorts, percentiles, Gini coefficient, Wilson intervals, transition matrices | `sql/analysis/01`–`14`, [sql-analytics.md](sql-analytics.md) |
| Business framing: each query has its question, interpretation, limitations and validation | Headers of every `.sql` file |
| Dashboard with filters, drill-down (department → doctors), CSV export, empty, loading and error states, mobile layout | `public/`, `/analytics` |
| Responsible reporting: small-group suppression, workload shown alphabetically rather than ranked, no invented revenue | API and dashboard |
| Data quality awareness: reconciling the dashboard to the source | `source_to_target_reconciliation` rule, `test/api.test.js` "overview total matches the hospital table" |
