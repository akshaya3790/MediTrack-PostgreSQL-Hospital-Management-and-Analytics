-- Analytics warehouse: a star schema around appointments and doctor capacity.
--
-- Grains
--   fact_appointment             one row per source appointment ever seen by the pipeline
--   fact_doctor_daily_capacity   one row per doctor (current version) per calendar date
--
-- Dimensions use surrogate keys. dim_doctor keeps history (type 2): when a doctor moves
-- department, earlier appointments keep counting towards the department they were in.

CREATE SCHEMA IF NOT EXISTS analytics_warehouse;

CREATE TABLE IF NOT EXISTS analytics_warehouse.dim_date (
  date_key     INT PRIMARY KEY,               -- yyyymmdd
  full_date    DATE NOT NULL UNIQUE,
  iso_dow      SMALLINT NOT NULL CHECK (iso_dow BETWEEN 1 AND 7),
  day_name     TEXT NOT NULL,
  week_start   DATE NOT NULL,                 -- Monday of the ISO week
  iso_week     SMALLINT NOT NULL,
  month_start  DATE NOT NULL,
  month_num    SMALLINT NOT NULL,
  month_name   TEXT NOT NULL,
  quarter      SMALLINT NOT NULL,
  year         SMALLINT NOT NULL,
  is_weekend   BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_warehouse.dim_department (
  department_sk   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  department_name TEXT NOT NULL UNIQUE,
  source_id       INT,                        -- Department.id when the source has it
  slug            TEXT,
  is_active       BOOLEAN NOT NULL,
  first_run_id    BIGINT NOT NULL,
  last_run_id     BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_warehouse.dim_doctor (
  doctor_sk        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_key       TEXT NOT NULL,               -- stable pseudonymous key
  doctor_name      TEXT NOT NULL,
  department_sk    INT NOT NULL REFERENCES analytics_warehouse.dim_department (department_sk),
  is_active        BOOLEAN NOT NULL,
  is_demo          BOOLEAN NOT NULL,
  consultation_fee NUMERIC(10, 2),
  row_hash         TEXT NOT NULL,
  valid_from       TIMESTAMPTZ NOT NULL,
  valid_to         TIMESTAMPTZ,
  is_current       BOOLEAN NOT NULL,
  run_id           BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS dim_doctor_current_key ON analytics_warehouse.dim_doctor (doctor_key) WHERE is_current;
CREATE INDEX IF NOT EXISTS dim_doctor_key_idx ON analytics_warehouse.dim_doctor (doctor_key);

-- Pseudonymous patients: a keyed hash of the email, never the email, name or contact details
CREATE TABLE IF NOT EXISTS analytics_warehouse.dim_patient (
  patient_sk     INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_key    TEXT NOT NULL UNIQUE,
  first_run_id   BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_warehouse.dim_appointment_status (
  status_key  SMALLINT PRIMARY KEY,
  status_code TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  definition  TEXT NOT NULL
);
INSERT INTO analytics_warehouse.dim_appointment_status (status_key, status_code, label, definition) VALUES
  (1, 'scheduled',  'Scheduled',  'Not yet marked done, and the appointment date is today or later.'),
  (2, 'completed',  'Completed',  'Marked done in the hospital system (a diagnosis was recorded).'),
  (3, 'unresolved', 'Not completed', 'The date has passed but the appointment was never marked done. The source cannot tell a no-show from a visit that was not documented.'),
  (4, 'removed',    'Removed',    'Was in the hospital system on an earlier run and has since been deleted. Patients cancelling and doctors removing an appointment both delete it.')
ON CONFLICT (status_key) DO UPDATE SET status_code = EXCLUDED.status_code, label = EXCLUDED.label, definition = EXCLUDED.definition;

CREATE TABLE IF NOT EXISTS analytics_warehouse.fact_appointment (
  appointment_id      INT PRIMARY KEY,         -- degenerate dimension: the source id
  date_key            INT NOT NULL REFERENCES analytics_warehouse.dim_date (date_key),
  start_hour          SMALLINT NOT NULL CHECK (start_hour BETWEEN 0 AND 23),
  duration_minutes    INT NOT NULL CHECK (duration_minutes > 0),
  doctor_sk           INT NOT NULL REFERENCES analytics_warehouse.dim_doctor (doctor_sk),
  department_sk       INT NOT NULL REFERENCES analytics_warehouse.dim_department (department_sk),
  patient_sk          INT REFERENCES analytics_warehouse.dim_patient (patient_sk),
  status_key          SMALLINT NOT NULL REFERENCES analytics_warehouse.dim_appointment_status (status_key),
  source_status       TEXT NOT NULL,
  has_diagnosis       BOOLEAN NOT NULL,
  is_removed          BOOLEAN NOT NULL DEFAULT FALSE,
  removed_at          TIMESTAMPTZ,
  first_seen_at       TIMESTAMPTZ NOT NULL,
  first_seen_run_id   BIGINT NOT NULL,
  last_changed_run_id BIGINT NOT NULL,
  last_seen_run_id    BIGINT NOT NULL,
  -- Days between the pipeline first seeing the booking and the appointment date. Only set
  -- for bookings first seen after the initial load, when that is close to the booking time.
  observed_lead_days  INT,
  row_hash            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fact_appointment_date_idx ON analytics_warehouse.fact_appointment (date_key);
CREATE INDEX IF NOT EXISTS fact_appointment_department_date_idx ON analytics_warehouse.fact_appointment (department_sk, date_key);
CREATE INDEX IF NOT EXISTS fact_appointment_doctor_date_idx ON analytics_warehouse.fact_appointment (doctor_sk, date_key);
CREATE INDEX IF NOT EXISTS fact_appointment_patient_idx ON analytics_warehouse.fact_appointment (patient_sk, date_key) WHERE patient_sk IS NOT NULL;

-- Bookable one-hour slots per doctor per day, from the doctor's working hours.
-- Past days are frozen once written, so later schedule changes do not rewrite history.
-- capacity_basis says whether the day was observed by the pipeline or back-filled.
CREATE TABLE IF NOT EXISTS analytics_warehouse.fact_doctor_daily_capacity (
  doctor_key       TEXT NOT NULL,
  date_key         INT NOT NULL REFERENCES analytics_warehouse.dim_date (date_key),
  doctor_sk        INT NOT NULL REFERENCES analytics_warehouse.dim_doctor (doctor_sk),
  department_sk    INT NOT NULL REFERENCES analytics_warehouse.dim_department (department_sk),
  scheduled_slots  SMALLINT NOT NULL CHECK (scheduled_slots >= 0),
  capacity_basis   TEXT NOT NULL CHECK (capacity_basis IN ('observed', 'backfilled_from_current_schedule')),
  run_id           BIGINT NOT NULL,
  PRIMARY KEY (doctor_key, date_key)
);
CREATE INDEX IF NOT EXISTS capacity_department_date_idx ON analytics_warehouse.fact_doctor_daily_capacity (department_sk, date_key);
