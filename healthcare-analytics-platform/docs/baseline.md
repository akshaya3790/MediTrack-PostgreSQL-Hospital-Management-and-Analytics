# Baseline inspection (before the platform was added)

Captured on 29 October 2026 at 15:55 UTC, before any platform file existed.

## Existing project

| Area | Contents |
|---|---|
| Database | PostgreSQL. The base tables come from `DDL.sql`: Patient, MedicalHistory, Doctor, Appointment, PatientsAttendAppointments, Schedule, PatientsFillHistory, Diagnose, DocsHaveSchedules, DoctorViewsHistory and ScheduleDays. Migrations 000–002 add session, PasswordReset, Department, DepartmentService and Admin, plus doctor profile columns. |
| Backend | Express, `backend/app.js` (34 routes), with session login (`hms.sid` cookie, `session` table), validation and mailer. 54 tests. |
| Frontend | React, with pages Landing, Auth, Patient, Doctor, Admin, Departments and Profile. 14 tests. |
| End-to-end | `e2e/browser.test.js`, 15 tests. |
| Files | 88 files outside `node_modules`, `.git`, `build`, `test-results` and `.env`: 31 in frontend, 30 screenshots, 15 in backend, 7 at the root, 3 migrations and 2 in e2e |

## What the data can support

From `npm run profile` and reading the schema:

| Question | Supported? | Why |
|---|---|---|
| Appointment volume by date, department and doctor | Yes | Appointment date and doctor; department from the doctor (or from the Department table after migration 002) |
| Completion | Yes | Status Done |
| No-shows | Proxy only | There is no status for it; a past NotDone appointment is the closest measure |
| Cancellations | Partly | A cancel deletes the row, so only deletions seen by the pipeline can be counted |
| Booking lead time | Partly | There is no booking timestamp |
| Capacity and utilisation | Yes, with estimation for the past | Schedules give working hours and break, but have no history |
| Patient return visits and cohorts | Yes, pseudonymously | Patient email links visits |
| Revenue, billing and payments | No | There are no such tables |
| Clinical outcomes | No | Free-text diagnoses; deliberately not read |

The sample data (`InsertDML.sql`) has 3 appointments, 3 patients and 4 doctors. That is too little for trends or models, which is why a separate, clearly labelled synthetic database is provided for demonstration.

## Recorded baseline

* `baseline/file-manifest.json` holds a SHA-256 of each of the 88 existing files.
* `baseline/captured-at.txt` holds the capture time.
* Screenshots of 8 existing pages were taken before the work: home, login, register, departments, a department page, admin login, not-found and the patient dashboard. They were compared pixel by pixel afterwards (see [regression-proof.md](regression-proof.md)).
* The existing test suites were run before and after: backend 54, frontend 14, e2e 15.
