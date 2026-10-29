-- Raw layer: the latest extract, as text, exactly as read from the source (after
-- pseudonymisation). Replaced on every run, so it never grows without bound.
-- Staging layer: the same rows with standard types, standard codes and a row hash.

CREATE SCHEMA IF NOT EXISTS analytics_raw;
CREATE SCHEMA IF NOT EXISTS analytics_staging;

CREATE TABLE IF NOT EXISTS analytics_raw.appointment (
  run_id        BIGINT NOT NULL,
  appointment_id TEXT,
  doctor_key    TEXT,
  appt_date     TEXT,
  start_time    TEXT,
  end_time      TEXT,
  status        TEXT,
  version_hash  TEXT,
  extracted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_raw.appointment_patient (
  run_id         BIGINT NOT NULL,
  appointment_id TEXT,
  patient_key    TEXT,
  extracted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_raw.patient (
  run_id       BIGINT NOT NULL,
  patient_key  TEXT,
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_raw.doctor (
  run_id           BIGINT NOT NULL,
  doctor_key       TEXT,
  doctor_name      TEXT,
  department_name  TEXT,
  is_active        TEXT,
  is_demo          TEXT,
  consultation_fee TEXT,
  extracted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_raw.department (
  run_id        BIGINT NOT NULL,
  department_id TEXT,
  name          TEXT,
  slug          TEXT,
  is_active     TEXT,
  extracted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_raw.doctor_schedule (
  run_id       BIGINT NOT NULL,
  doctor_key   TEXT,
  schedule_id  TEXT,
  start_time   TEXT,
  end_time     TEXT,
  break_time   TEXT,
  day_name     TEXT,
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_raw.diagnosis_marker (
  run_id         BIGINT NOT NULL,
  appointment_id TEXT,
  extracted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Standardised appointments. dq_status says whether a row may enter the warehouse.
CREATE TABLE IF NOT EXISTS analytics_staging.appointment (
  run_id           BIGINT NOT NULL,
  appointment_id   INT PRIMARY KEY,
  doctor_key       TEXT,
  patient_key      TEXT,
  patient_links    SMALLINT NOT NULL DEFAULT 0,
  appt_date        DATE,
  start_time       TIME,
  end_time         TIME,
  duration_minutes INT,
  source_status    TEXT,             -- 'scheduled' (NotDone) or 'completed' (Done)
  has_diagnosis    BOOLEAN NOT NULL DEFAULT FALSE,
  row_hash         TEXT NOT NULL,
  dq_status        TEXT NOT NULL DEFAULT 'valid' CHECK (dq_status IN ('valid', 'quarantined'))
);

CREATE TABLE IF NOT EXISTS analytics_staging.doctor (
  run_id           BIGINT NOT NULL,
  doctor_key       TEXT PRIMARY KEY,
  doctor_name      TEXT NOT NULL,
  department_name  TEXT NOT NULL,
  is_active        BOOLEAN NOT NULL,
  is_demo          BOOLEAN NOT NULL,
  consultation_fee NUMERIC(10, 2),
  row_hash         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_staging.department (
  run_id        BIGINT NOT NULL,
  department_name TEXT PRIMARY KEY,
  department_id INT,
  slug          TEXT,
  is_active     BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_staging.doctor_schedule (
  run_id       BIGINT NOT NULL,
  doctor_key   TEXT NOT NULL,
  iso_dow      SMALLINT NOT NULL CHECK (iso_dow BETWEEN 1 AND 7),
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  break_time   TIME,
  slots_per_day SMALLINT NOT NULL,
  PRIMARY KEY (doctor_key, iso_dow, start_time)
);
