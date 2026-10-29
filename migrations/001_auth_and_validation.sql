-- Migration 001: stored sessions, password reset links and data-validation constraints.
--
-- DDL.sql runs this automatically for a fresh database. To upgrade an existing
-- database without losing its data, run it once on its own:
--   psql -U postgres -d hms -f migrations/001_auth_and_validation.sql
-- then run the two GRANT lines from the README again.

BEGIN;

-- Login sessions (used by connect-pg-simple). Keeping them in the database means
-- users stay signed in across server restarts and a session can be revoked.
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expire_idx ON session (expire);

-- One-time password reset links. Only a SHA-256 hash of each token is stored.
CREATE TABLE IF NOT EXISTS PasswordReset (
  token_hash CHAR(64) PRIMARY KEY,
  email VARCHAR(100) NOT NULL,
  role VARCHAR(3) NOT NULL CHECK (role IN ('pat', 'doc')),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS password_reset_email_idx ON PasswordReset (email, role);

-- Bring existing rows into the formats the new rules expect
UPDATE Patient SET email = LOWER(TRIM(email)) WHERE email <> LOWER(TRIM(email));
UPDATE Doctor SET email = LOWER(TRIM(email)) WHERE email <> LOWER(TRIM(email));
UPDATE Patient SET gender = LOWER(gender) WHERE gender <> LOWER(gender);
UPDATE Doctor SET gender = LOWER(gender) WHERE gender <> LOWER(gender);
UPDATE Patient SET phone = '+91' || RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10)
  WHERE phone IS NOT NULL AND phone !~ '^\+91[6-9][0-9]{9}$'
    AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') ~ '^(91|0)?[6-9][0-9]{9}$';
UPDATE Patient SET phone = NULL WHERE phone IS NOT NULL AND phone !~ '^\+91[6-9][0-9]{9}$';

-- Emails are stored in lower case so "A@x.com" and "a@x.com" are one account
ALTER TABLE Patient ADD CONSTRAINT patient_email_format
  CHECK (email = LOWER(email) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');
ALTER TABLE Doctor ADD CONSTRAINT doctor_email_format
  CHECK (email = LOWER(email) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');

ALTER TABLE Patient ADD CONSTRAINT patient_gender_valid CHECK (gender IN ('female', 'male', 'other'));
ALTER TABLE Doctor ADD CONSTRAINT doctor_gender_valid CHECK (gender IN ('female', 'male', 'other'));
ALTER TABLE Patient ADD CONSTRAINT patient_phone_format CHECK (phone IS NULL OR phone ~ '^\+91[6-9][0-9]{9}$');
ALTER TABLE Patient ADD CONSTRAINT patient_dob_range CHECK (dob IS NULL OR dob >= DATE '1900-01-01');
ALTER TABLE Doctor ADD CONSTRAINT doctor_specialization_valid CHECK (specialization IN (
  'General Medicine', 'Cardiology', 'Pediatrics', 'Orthopedics', 'Dermatology',
  'Neurology', 'Gynecology', 'ENT', 'Ophthalmology', 'Psychiatry'));

-- Names and addresses: NOT VALID applies the rule to new and changed rows
-- without rejecting older rows that were saved before these rules existed
ALTER TABLE Patient ADD CONSTRAINT patient_name_valid
  CHECK (CHAR_LENGTH(BTRIM(name)) BETWEEN 2 AND 100 AND name !~ '[0-9]') NOT VALID;
ALTER TABLE Doctor ADD CONSTRAINT doctor_name_valid
  CHECK (CHAR_LENGTH(BTRIM(name)) BETWEEN 2 AND 100 AND name !~ '[0-9]') NOT VALID;
ALTER TABLE Patient ADD CONSTRAINT patient_address_valid
  CHECK (CHAR_LENGTH(BTRIM(address)) BETWEEN 3 AND 200) NOT VALID;

-- Clinical text can never be blank
ALTER TABLE MedicalHistory ADD CONSTRAINT medical_history_not_blank
  CHECK (BTRIM(conditions) <> '' AND BTRIM(surgeries) <> '' AND BTRIM(medication) <> '') NOT VALID;
ALTER TABLE PatientsAttendAppointments ADD CONSTRAINT visit_reason_not_blank
  CHECK (BTRIM(concerns) <> '' AND BTRIM(symptoms) <> '') NOT VALID;
ALTER TABLE Diagnose ADD CONSTRAINT diagnosis_not_blank
  CHECK (BTRIM(diagnosis) <> '' AND BTRIM(prescription) <> '') NOT VALID;

COMMIT;
