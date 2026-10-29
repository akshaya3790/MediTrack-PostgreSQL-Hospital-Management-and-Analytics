-- Migration 000: columns added to DDL.sql after the first release.
--
-- Only needed for a database created from the older DDL.sql (one without
-- Patient.phone, Patient.dob or Doctor.specialization). Run it before 001:
--   psql -U postgres -d hms -f migrations/000_add_new_columns.sql
-- It only adds columns, so it is safe to run more than once.

BEGIN;

ALTER TABLE Patient ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE Patient ADD COLUMN IF NOT EXISTS dob DATE;
ALTER TABLE Doctor ADD COLUMN IF NOT EXISTS specialization VARCHAR(50) NOT NULL DEFAULT 'General Medicine';

COMMIT;
