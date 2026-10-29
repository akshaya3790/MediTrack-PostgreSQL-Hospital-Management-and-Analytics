# Regression proof: the existing app is unchanged

The rule for this work was zero changes to existing features, UI, files, tables, columns, constraints, records, APIs and configuration. Five independent checks show it was kept.

## 1. Files: byte for byte identical

Before any work, `baseline/file-manifest.json` recorded a SHA-256 of all 88 existing project files. `.env`, `node_modules`, `.git`, `build` and `test-results` were excluded. After the platform was copied into the project folder on the Windows machine, the check ran again there:

```
> node src/tools/verify-baseline.js
Unchanged: all 88 existing files match the baseline byte for byte.
```

That run was on 29 October 2026 at 16:42 UTC, in `C:\Users\prama\OneDrive\Desktop\Hospital-Management-System-DBMS-master`. Every new file is inside `healthcare-analytics-platform/`. Run `npm run verify:baseline` at any time to repeat the check.

## 2. Existing test suites: all pass, unchanged

The project's own tests were run, without modification, after the platform was built:

| Suite | Result |
|---|---|
| Backend (`backend`, `npm test`) | 54 of 54 pass |
| Frontend (`frontend`, `npm test`) | 14 of 14 pass |
| Browser end-to-end (`e2e`) | 15 of 15 pass |

## 3. UI: pixel-identical screenshots

Eight pages were captured before and after at 1280 px wide, full page: home, login, register, departments, a department page, admin login, not-found and the patient dashboard. They were compared pixel by pixel, and **all 8 are identical**, with 0 differing pixels.

## 4. Database: schema and data fingerprint identical

`test/regression.test.js` runs against a database set up like the real one: hospital tables plus `00_roles_and_grants.sql`. It first takes a fingerprint covering:

* every table, column (type, nullability, default, position), constraint, index and trigger in `public`
* a row count and MD5 of every readable value in every hospital table

Then it runs `db:init` and the pipeline in full, incremental, validate-only, refresh-only and full mode again, and takes the fingerprint a second time. **Result: identical (3 of 3 checks pass).**

The same test checks that the analytics role has no INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER privilege on any hospital table, and cannot create objects in `public`.

## 5. APIs and configuration

* The hospital backend's routes, port (3001), session handling and `.env` were not touched. The platform is a separate process on port 3002 and only reads the session table.
* No existing configuration file was edited. The platform has its own `.env.example`.
* `npm install` for the platform runs inside `healthcare-analytics-platform/` and does not touch the backend's or frontend's `node_modules`.

## What did change, stated plainly

The one-time setup script, which you run yourself after a backup, does two things outside the new schemas:

* It creates the `hms_analytics` role.
* It grants that role column-level `SELECT` on the hospital tables listed in the script.

Grants add entries to those tables' permission lists. They change no column, constraint, row, index or trigger, and the app behaves identically. If that is not acceptable, the platform can run against a copy or read replica instead; see [limitations.md](limitations.md#permissions-on-hospital-tables).
