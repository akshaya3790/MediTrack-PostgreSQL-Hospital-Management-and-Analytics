-- Pipeline metadata: run history, step log, data quality results, quarantine, watermarks,
-- lineage and the expected source schema. Everything lives in analytics_* schemas.

CREATE SCHEMA IF NOT EXISTS analytics_meta;

CREATE TABLE IF NOT EXISTS analytics_meta.pipeline_runs (
  run_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pipeline_name   TEXT NOT NULL,
  mode            TEXT NOT NULL CHECK (mode IN ('full', 'incremental', 'validate-only', 'refresh-only')),
  trigger_type    TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_type IN ('manual', 'scheduler', 'test')),
  attempt         SMALLINT NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  status          TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'succeeded_with_warnings', 'failed')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  params          JSONB NOT NULL DEFAULT '{}',
  source_rows     JSONB NOT NULL DEFAULT '{}',   -- rows extracted per source table
  load_counts     JSONB NOT NULL DEFAULT '{}',   -- inserted / updated / removed / unchanged / rejected
  dq_failed_rules INT NOT NULL DEFAULT 0,
  error_summary   TEXT                           -- never contains row data
);
CREATE INDEX IF NOT EXISTS pipeline_runs_started_idx ON analytics_meta.pipeline_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS analytics_meta.run_steps (
  run_id       BIGINT NOT NULL REFERENCES analytics_meta.pipeline_runs (run_id) ON DELETE CASCADE,
  step         TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  rows_affected INT,
  detail       JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (run_id, step)
);

CREATE TABLE IF NOT EXISTS analytics_meta.dq_results (
  result_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id            BIGINT NOT NULL REFERENCES analytics_meta.pipeline_runs (run_id) ON DELETE CASCADE,
  rule_name         TEXT NOT NULL,
  dataset           TEXT NOT NULL,
  severity          TEXT NOT NULL CHECK (severity IN ('error', 'warning', 'info')),
  action            TEXT NOT NULL CHECK (action IN ('quarantine', 'flag', 'block', 'report')),
  rows_evaluated    INT NOT NULL CHECK (rows_evaluated >= 0),
  rows_failed       INT NOT NULL CHECK (rows_failed >= 0),
  failure_pct       NUMERIC(6, 2) NOT NULL,
  passed            BOOLEAN NOT NULL,
  executed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolution_status TEXT NOT NULL DEFAULT 'open'
                    CHECK (resolution_status IN ('open', 'acknowledged', 'resolved', 'not_applicable')),
  description       TEXT NOT NULL,
  UNIQUE (run_id, rule_name)
);

-- Rows held back from the warehouse. Source rows are never corrected or deleted;
-- the payload is the pseudonymised staging row, never a name, email or clinical text.
CREATE TABLE IF NOT EXISTS analytics_meta.quarantine (
  quarantine_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id            BIGINT NOT NULL REFERENCES analytics_meta.pipeline_runs (run_id) ON DELETE CASCADE,
  dataset           TEXT NOT NULL,
  record_key        TEXT NOT NULL,
  rule_name         TEXT NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}',
  quarantined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolution_status TEXT NOT NULL DEFAULT 'open'
                    CHECK (resolution_status IN ('open', 'acknowledged', 'resolved'))
);
CREATE INDEX IF NOT EXISTS quarantine_run_idx ON analytics_meta.quarantine (run_id, dataset);

CREATE TABLE IF NOT EXISTS analytics_meta.watermarks (
  source_table  TEXT PRIMARY KEY,
  max_id        BIGINT,
  row_count     INT,
  run_id        BIGINT REFERENCES analytics_meta.pipeline_runs (run_id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The source columns the pipeline expects, captured on the first run.
-- A later difference is reported by the unexpected_schema_change rule.
CREATE TABLE IF NOT EXISTS analytics_meta.source_schema_baseline (
  table_name   TEXT NOT NULL,
  column_name  TEXT NOT NULL,
  data_type    TEXT NOT NULL,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (table_name, column_name)
);

-- Describes the data in this database: real hospital data or a synthetic development set
CREATE TABLE IF NOT EXISTS analytics_meta.dataset_info (
  id            BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  is_synthetic  BOOLEAN NOT NULL,
  label         TEXT NOT NULL,
  generated_at  TIMESTAMPTZ,
  generator     TEXT,
  notes         TEXT
);

-- Which source tables and steps feed each analytics table
CREATE TABLE IF NOT EXISTS analytics_meta.lineage (
  target_object  TEXT NOT NULL,
  source_object  TEXT NOT NULL,
  transformation TEXT NOT NULL,
  PRIMARY KEY (target_object, source_object)
);
