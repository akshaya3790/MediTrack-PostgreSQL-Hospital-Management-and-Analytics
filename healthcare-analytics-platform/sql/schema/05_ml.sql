-- Results of the machine learning module (written by the Python code in ml/)

CREATE SCHEMA IF NOT EXISTS analytics_ml;

CREATE TABLE IF NOT EXISTS analytics_ml.model_runs (
  model_run_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_name       TEXT NOT NULL CHECK (model_name IN ('not_completed_classifier', 'demand_forecast', 'patient_segments')),
  status           TEXT NOT NULL CHECK (status IN ('trained', 'insufficient_data', 'failed')),
  is_synthetic     BOOLEAN NOT NULL,
  dataset_label    TEXT NOT NULL,
  dataset_version  TEXT,                 -- SHA-256 of the training rows
  trained_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  train_rows       INT,
  test_rows        INT,
  params           JSONB NOT NULL DEFAULT '{}',
  metrics          JSONB NOT NULL DEFAULT '{}',
  baseline_metrics JSONB NOT NULL DEFAULT '{}',
  explanation      JSONB NOT NULL DEFAULT '{}',
  artifact_path    TEXT,
  notes            TEXT
);

CREATE TABLE IF NOT EXISTS analytics_ml.demand_forecast (
  model_run_id    BIGINT NOT NULL REFERENCES analytics_ml.model_runs (model_run_id) ON DELETE CASCADE,
  department_name TEXT NOT NULL,
  week_start      DATE NOT NULL,
  forecast        NUMERIC(10, 2) NOT NULL,
  lower_80        NUMERIC(10, 2) NOT NULL,
  upper_80        NUMERIC(10, 2) NOT NULL,
  PRIMARY KEY (model_run_id, department_name, week_start)
);

-- Segment summaries only; segment membership of individual patients is not stored
CREATE TABLE IF NOT EXISTS analytics_ml.segment_profiles (
  model_run_id  BIGINT NOT NULL REFERENCES analytics_ml.model_runs (model_run_id) ON DELETE CASCADE,
  segment       SMALLINT NOT NULL,
  label         TEXT NOT NULL,
  patients      INT NOT NULL,
  profile       JSONB NOT NULL,
  PRIMARY KEY (model_run_id, segment)
);
