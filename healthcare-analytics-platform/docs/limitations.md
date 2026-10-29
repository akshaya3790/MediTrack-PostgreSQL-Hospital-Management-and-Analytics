# Limitations

These are things the platform cannot do, or does only partly, because of what the hospital database records, or because the platform may not change anything in the existing app.

## Imposed by the "change nothing" rule

| What was wanted | Why it was not done | What would make it possible |
|---|---|---|
| A real no-show or cancelled status | The app stores only `NotDone` and `Done`, and a cancellation deletes the row. Adding a status would change the app's tables. | A status column, or a cancellations table, in the hospital app. Until then, "not completed" is a proxy and "removed" counts only deletions seen after the pipeline started. |
| Booking lead time | The app does not record when a booking was made. | A `created_at` column on `Appointment`. Until then, lead time is measured only for bookings first seen by a pipeline run (`observed_lead_days`), so it is accurate only when the pipeline runs often. |
| Financial analytics | There are no invoices, payments or refunds. A consultation fee is a price, not money received. | Billing tables. The Financial page explains this instead of estimating revenue. |
| Faster extraction on large databases | `PatientsAttendAppointments.appt` has no index, and adding one changes the hospital schema. | An index on that column. The pipeline aggregates the table once per run instead, and a full run takes about 3 seconds for 26,000 appointments. |
| Historical capacity | Schedules have no history; only today's working hours exist. | Schedule history in the app. Capacity before the pipeline's first run is back-filled from today's hours and labelled as such. |
| Clinical analytics (diagnoses, conditions, outcomes) | Diagnoses and histories are free text. Reading them would also break the privacy design. | Coded diagnoses (for example ICD-10) and an ethics review. Only whether a diagnosis exists is read. |
| Demographic breakdowns (age, gender) | Deliberately not read. Small numbers would make re-identification likely, and none of the asked-for KPIs need them. | A decision by the hospital about lawful use, then a grant on those columns. |

## Permissions on hospital tables

The setup script grants `hms_analytics` read access to specific columns. That adds entries to the permission lists (ACLs) of those hospital tables. It changes no columns, constraints, rows, triggers or indexes, and the app behaves exactly as before. The regression test proves the schema and data are identical. But it is a change to the permission metadata, so it is stated here.

If even that is not acceptable, point the platform at a copy instead:

* restore a nightly `pg_dump` into a separate database, or use a streaming read replica
* apply the setup script there, and set `ANALYTICS_DB_NAME` to the copy

Nothing else changes. The dashboard's sign-in check reads the `session` table, so for live sign-in checks the copy must be fresh. Alternatively, the dashboard can be run only for administrators on the hospital's own network.

## Privacy

* The `session` table holds the signed-in user's email inside the session data. `hms_analytics` can read it, to check whether a visitor is an administrator. The platform does not store or return it.
* Pseudonymous keys plus appointment dates could still single out a patient in a very small hospital. Mitigations: only administrators can see the dashboard, groups under 5 are hidden, and no row-level data leaves the database.
* If `ANALYTICS_PSEUDONYM_KEY` leaks, anyone with a list of patient emails could match them to keys. Keep it out of the database and out of version control.

## Analytics and models

* All figures in the docs come from synthetic data. Real results will differ and must be checked before anyone relies on them.
* The no-show proxy model is weak even on synthetic data (ROC-AUC 0.64). It suits low-cost actions such as reminders, never decisions about care.
* The demand forecast's 80% interval covered 77% of held-out weeks: slightly too narrow.
* Doctor workload pages show counts, not quality. They are sorted alphabetically on purpose.
* The dashboard recognises administrators by the shared session cookie. If the apps run on different host names, administrators must use the same host name for both, or the cookie is not sent.
