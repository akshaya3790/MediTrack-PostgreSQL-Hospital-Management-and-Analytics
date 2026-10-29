# Analytics API

The API is served by `npm start` on `ANALYTICS_PORT` (default 3002), under `/analytics/api`. The dashboard at `/analytics` uses only these endpoints.

## Access control

Every endpoint except `/health` needs a signed-in hospital **administrator**:

1. The browser sends the hospital app's `hms.sid` cookie. Cookies for `localhost` are shared across ports.
2. The API checks the cookie's signature with `HMS_SESSION_SECRET`, which must equal the backend's `SESSION_SECRET`. A forged or unsigned cookie is rejected before any database query.
3. It reads the session row from the hospital's `session` table, read-only, and requires an unexpired session whose user has `who = 'adm'`.

| Situation | Response |
|---|---|
| No cookie, bad signature, unknown or expired session | `401 {"error": "...", "signInUrl": "<HMS_APP_URL>/admin/login"}` |
| Signed in as a patient or doctor | `403 {"error": "Only hospital administrators can open the analytics."}` |
| Administrator | `200` |

The API never creates, extends or changes sessions; signing in and out stays with the hospital app.

**Other protections.**

* Every query runs in a read-only transaction, on a connection with `default_transaction_read_only=on`.
* Filter values travel only as SQL parameters.
* Responses carry `Cache-Control: no-store`, a strict Content-Security-Policy, `X-Frame-Options: DENY` and `nosniff`.

## Output rules

* **Aggregated only.** There are no endpoints for individual appointments or patients. Responses contain no emails, patient keys or appointment ids, which `test/api.test.js` checks for every endpoint.
* **Small groups hidden.** Patient counts under 5 come back as `null`.
* Rates are fractions between 0 and 1, or `null` when the denominator is 0.

## Filters

These filters apply to `/overview`, `/departments`, `/doctors`, `/appointments` and the matching exports.

| Parameter | Format | Default | Notes |
|---|---|---|---|
| `from` | `YYYY-MM-DD` | today − 365 days | Must be a real date |
| `to` | `YYYY-MM-DD` | today + 28 days | `from` ≤ `to`; at most 3 years apart |
| `department` | integer | all | `id` from `/filters` |
| `doctor` | `doc_…` | all | `key` from `/filters` |
| `status` | `scheduled`, `completed`, `unresolved` or `removed` | all | |

Invalid values return `400 {"error": "<what is wrong>", "field": "<parameter>"}`, for example `{"error": "from is not a real date", "field": "from"}`.

## Endpoints

| Method and path | Returns |
|---|---|
| `GET /analytics/api/health` | **Public.** `{status, database, lastRefreshHoursAgo}`, or 503 if the database is unreachable. Holds no data. |
| `GET /me` | `{admin: true, dataset: {is_synthetic, label, notes}, freshness: {run_id, finished_at, hours_since_refresh}}` |
| `GET /kpis` | `{data: [{id, name, definition, sql}]}`, the KPI catalogue (see [kpi-definitions.md](kpi-definitions.md)) |
| `GET /filters` | `{departments: [{id, name, isActive}], doctors: [{key, name, departmentId, isDemo}], coverage: {first, last, appointments}}` |
| `GET /overview` | `{kpis, monthly[], departments[], doctors[]}` |
| `GET /departments` | `{previousPeriod: {from, to}, departments[], monthly[]}` |
| `GET /doctors` | `{distribution: {doctors, min, median, p90, max}, doctors[]}`, sorted by name, not ranked |
| `GET /appointments` | `{status[], byWeekday[], weekly[], heatmap[], visitsPerPatient[], leadTime[], leadTimeNote, newReturning[], minGroupSize}` |
| `GET /data-quality` | `{latest: {run_id, mode, …}, rules: [{rule, dataset, severity, action, evaluated, failed, failurePct, passed, resolution, description}], quarantine: [{rule, rows}] (counts only), trend: [{runId, startedAt, failedRules}]}` |
| `GET /pipeline-runs?limit=20` | `{runs: [{runId, mode, status, startedAt, seconds, loadCounts, dqFailedRules, error, steps[]}], lineage[]}`. `limit` is 1–200. |
| `GET /forecasts` | `{models: [latest run per model], forecast: [{department, week, forecast, lower, upper}], actuals[], segments[]}` |
| `GET /financial` | `{available: false, reason, requiredData[]}`. The database has no billing data, and revenue is deliberately not estimated. |
| `GET /export/:report` | CSV download, using the same filters. Reports: `monthly-overview`, `departments`, `doctors`, `weekly-flow`, `status-distribution`, `data-quality`, `pipeline-runs`, `demand-forecast`. Unknown reports return 404. |

Each department row (`/overview`, `/departments`) contains:

* id and name
* appointments, completed, scheduled, unresolved, removed and seen
* completionRate, notCompletedRate and removalRate
* on `/departments` only: share, previousAppointments, demandChange, slots and slotUtilization

**CSV safety.** Cells that a spreadsheet would treat as a formula (starting with `=`, `+`, `-`, `@`, tab or carriage return, apart from plain numbers) are prefixed with `'`.

## Errors

| Status | When |
|---|---|
| 400 | Invalid filter or parameter |
| 401 / 403 | See access control above |
| 404 | Unknown endpoint or export |
| 503 | Analytics schemas missing (run `npm run db:init`) or database unreachable |
| 500 | Anything else. The response says only "Something went wrong while preparing this report"; details go to the server log without row values. |

## Example

```bash
# After signing in to the hospital app as an administrator, copy the hms.sid cookie value from the browser
curl -H "Cookie: hms.sid=<value>" "http://localhost:3002/analytics/api/departments?from=2026-01-01&to=2026-06-30"
curl -H "Cookie: hms.sid=<value>" -o departments.csv "http://localhost:3002/analytics/api/export/departments?from=2026-01-01&to=2026-06-30"
```
