# Data quality, privacy and lineage

## How the checks work

Every pipeline run checks the data twice. The full list of rules is generated from the code in [data-quality-rules.md](data-quality-rules.md).

1. **Before loading**, 18 rules run against the staged rows:
   * 7 quarantine rules (missing fields, unknown status, end before start, duplicate id, unknown doctor, doctor without a known department, double-booked slot)
   * 9 flag rules (implausible date, appointment without a patient, several patients on one appointment, orphan patient links, done without a diagnosis, diagnosis on an open appointment, doctor without working hours, break outside working hours, negative fee)
   * a freshness check
   * a source schema check, which blocks the run on an unexpected change
2. **After loading**, 3 reconciliation rules run inside the same transaction:
   * every source appointment is in the warehouse or in quarantine, and no active warehouse appointment is missing from the source
   * every doctor has exactly one current version
   * statuses are consistent

Each result goes to `analytics_meta.dq_results` with:

* rows evaluated and rows failed
* failure %
* severity (`error` or `warning`)
* action (`quarantine`, `flag`, `report` or `block`)
* a resolution status: `open`, or `not_applicable` when the rule passed

The dashboard's **Data quality and pipeline** page shows the latest results, the run history and the lineage.

## Quarantine

A row that fails a quarantine rule:

* is marked `quarantined` in staging and never reaches the warehouse
* is copied to `analytics_meta.quarantine` with the rule name, run id and a pseudonymised JSON payload. No emails are kept; the payload uses doctor and patient keys.
* is checked again on every later run. Once the source row is fixed in the hospital app, the next run loads it.

The pipeline never edits or deletes hospital records to "fix" them. Fixing the source is a human decision.

Tested in `test/pipeline.test.js`: an appointment that ends before it starts is quarantined, kept out of the fact table, and stored without any email address.

## Privacy

| Measure | How |
|---|---|
| Least privilege | `hms_analytics` gets column-level `SELECT` on only the columns listed in `sql/setup/00_roles_and_grants.sql`. Names, contact details, dates of birth, password hashes, visit reasons, symptoms, diagnoses, prescriptions and medical histories are not readable. |
| No writes to hospital data | No INSERT, UPDATE, DELETE, TRUNCATE or TRIGGER privilege on any hospital table. This is checked by `test/regression.test.js`. The pipeline also reads inside `READ ONLY` transactions, and the API sets `default_transaction_read_only=on`. |
| Pseudonymisation | Patient emails become `pat_` plus 24 hex characters, using HMAC-SHA256 with `ANALYTICS_PSEUDONYM_KEY`. The same patient always gets the same key, so visits can be linked, but the email cannot be recovered without the key. Keep the key out of the database and out of version control. |
| Aggregated output only | The API returns counts, rates and summaries. No endpoint returns a patient key, an appointment id or an email. This is checked by `test/api.test.js`. |
| Small-group suppression | Any patient count under 5 is returned as `null` and shown as "< 5" or left blank. The SQL analyses use the same rule. |
| ML outputs | Segment tables store summaries only. Which patient is in which segment is never stored. Models are trained on behaviour, not on medical or personal attributes. |
| Logs and errors | Run errors keep only the message and error code, never row values. Quarantine payloads are pseudonymised. |
| Access control | The dashboard and API need a valid, signed hospital session whose user is an administrator (`who = 'adm'`). Patients and doctors get 403, everyone else 401. |

Re-identification risk is reduced, not removed. Pseudonymous data combined with dates can still single someone out in a small hospital. That is why only administrators can see the dashboard, groups under 5 are hidden, and nothing row-level leaves the database.

## Lineage

[data-lineage.md](data-lineage.md) lists, for every analytics table, the hospital table or analytics table it comes from and what is done on the way. The same list is stored in `analytics_meta.lineage` and shown on the dashboard. Each row also carries its run ids (`first_seen_run_id`, `last_changed_run_id`, `last_seen_run_id`), so you can trace when it arrived and when it last changed.

## Data inventory

`npm run profile` prints:

* what the analytics role can read
* row counts per source table
* the date range and status values of appointments
* null counts and patient link counts

It never prints personal data. Run it first on a new database to see what the analytics will be able to say.
