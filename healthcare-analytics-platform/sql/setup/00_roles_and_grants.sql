-- One-time setup for the analytics platform. Run as the postgres superuser on the hms database:
--
--   psql -U postgres -d hms -v ON_ERROR_STOP=1 -f healthcare-analytics-platform/sql/setup/00_roles_and_grants.sql
--
-- What it does, and what it deliberately does not do:
--   * Creates one login role, hms_analytics, with no password. Set one yourself afterwards with
--     \password hms_analytics   (it is never written in a file).
--   * Creates six NEW schemas owned by hms_analytics. The hospital tables in "public" are not
--     altered: no columns, constraints, triggers or rows are added, changed or removed.
--   * Gives hms_analytics read-only access to the source columns the analytics need, column by
--     column. Password hashes, patient names, addresses, phone numbers, dates of birth, visit reasons,
--     symptoms, diagnoses, prescriptions and medical histories are NOT readable by this role.
--   * Lets the role read the login session table, so the analytics dashboard can check that the
--     visitor is signed in to the hospital app as an administrator.
--   * Grants no INSERT, UPDATE or DELETE on any hospital table: the role cannot change hospital data.
-- Safe to run more than once.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hms_analytics') THEN
    CREATE ROLE hms_analytics LOGIN;
  END IF;
END $$;

-- The role may connect and create its own schemas, nothing more
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO hms_analytics', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO hms_analytics;

CREATE SCHEMA IF NOT EXISTS analytics_meta AUTHORIZATION hms_analytics;
CREATE SCHEMA IF NOT EXISTS analytics_raw AUTHORIZATION hms_analytics;
CREATE SCHEMA IF NOT EXISTS analytics_staging AUTHORIZATION hms_analytics;
CREATE SCHEMA IF NOT EXISTS analytics_warehouse AUTHORIZATION hms_analytics;
CREATE SCHEMA IF NOT EXISTS analytics_marts AUTHORIZATION hms_analytics;
CREATE SCHEMA IF NOT EXISTS analytics_ml AUTHORIZATION hms_analytics;

-- Column-level, read-only grants. A table or column that does not exist in this database
-- (for example before migration 002) is skipped, and the pipeline adapts to what it can read.
DO $$
DECLARE
  allowed CONSTANT TEXT[][] := ARRAY[
    ['appointment', 'id'], ['appointment', 'doctor'], ['appointment', 'date'],
    ['appointment', 'starttime'], ['appointment', 'endtime'], ['appointment', 'status'],
    ['patientsattendappointments', 'patient'], ['patientsattendappointments', 'appt'],
    ['patient', 'email'],
    ['doctor', 'email'], ['doctor', 'name'], ['doctor', 'specialization'], ['doctor', 'id'],
    ['doctor', 'is_active'], ['doctor', 'is_demo'], ['doctor', 'consultation_fee'],
    ['department', 'id'], ['department', 'name'], ['department', 'slug'], ['department', 'is_active'],
    ['schedule', 'id'], ['schedule', 'starttime'], ['schedule', 'endtime'], ['schedule', 'breaktime'],
    ['scheduledays', 'sched'], ['scheduledays', 'day'],
    ['docshaveschedules', 'sched'], ['docshaveschedules', 'doctor'],
    ['diagnose', 'appt'], ['diagnose', 'doctor'],
    ['session', 'sid'], ['session', 'sess'], ['session', 'expire']
  ];
  i INT;
BEGIN
  FOR i IN 1 .. array_length(allowed, 1) LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = allowed[i][1] AND column_name = allowed[i][2]) THEN
      EXECUTE format('GRANT SELECT (%I) ON public.%I TO hms_analytics', allowed[i][2], allowed[i][1]);
    END IF;
  END LOOP;
END $$;
