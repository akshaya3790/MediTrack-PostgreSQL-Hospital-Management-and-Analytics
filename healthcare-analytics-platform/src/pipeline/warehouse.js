// Loads the warehouse from staging. Every statement is an upsert keyed on natural keys,
// so running the same load twice leaves the warehouse unchanged.

async function ensureDates(client, daysAhead) {
  await client.query(
    `WITH bounds AS (
       SELECT LEAST(COALESCE(MIN(appt_date), CURRENT_DATE), CURRENT_DATE - 31) AS lo,
              GREATEST(COALESCE(MAX(appt_date), CURRENT_DATE), CURRENT_DATE + $1::int) AS hi
       FROM analytics_staging.appointment
     )
     INSERT INTO analytics_warehouse.dim_date
       (date_key, full_date, iso_dow, day_name, week_start, iso_week, month_start, month_num, month_name, quarter, year, is_weekend)
     SELECT TO_CHAR(d, 'YYYYMMDD')::int, d::date, EXTRACT(ISODOW FROM d)::smallint, TRIM(TO_CHAR(d, 'Day')),
            DATE_TRUNC('week', d)::date, EXTRACT(WEEK FROM d)::smallint, DATE_TRUNC('month', d)::date,
            EXTRACT(MONTH FROM d)::smallint, TRIM(TO_CHAR(d, 'Month')), EXTRACT(QUARTER FROM d)::smallint,
            EXTRACT(YEAR FROM d)::smallint, EXTRACT(ISODOW FROM d) IN (6, 7)
     FROM bounds, generate_series(bounds.lo, bounds.hi, INTERVAL '1 day') AS g(d)
     ON CONFLICT (date_key) DO NOTHING`, [daysAhead]);
}

async function loadDepartments(client, runId) {
  const { rowCount } = await client.query(
    `INSERT INTO analytics_warehouse.dim_department (department_name, source_id, slug, is_active, first_run_id, last_run_id)
     SELECT department_name, department_id, slug, is_active, $1, $1 FROM analytics_staging.department
     ON CONFLICT (department_name) DO UPDATE
       SET source_id = EXCLUDED.source_id, slug = EXCLUDED.slug, is_active = EXCLUDED.is_active, last_run_id = $1
     WHERE (dim_department.source_id, dim_department.slug, dim_department.is_active)
           IS DISTINCT FROM (EXCLUDED.source_id, EXCLUDED.slug, EXCLUDED.is_active)`, [runId]);
  return rowCount;
}

// Type 2 history: a changed doctor gets a new current version; the old one is closed
async function loadDoctors(client, runId, runStartedAt) {
  const closed = await client.query(
    `UPDATE analytics_warehouse.dim_doctor d SET is_current = FALSE, valid_to = $1
     WHERE d.is_current AND (
       NOT EXISTS (SELECT 1 FROM analytics_staging.doctor s WHERE s.doctor_key = d.doctor_key)
       OR EXISTS (SELECT 1 FROM analytics_staging.doctor s WHERE s.doctor_key = d.doctor_key AND s.row_hash <> d.row_hash))
     RETURNING d.doctor_key`, [runStartedAt]);
  const inserted = await client.query(
    `INSERT INTO analytics_warehouse.dim_doctor
       (doctor_key, doctor_name, department_sk, is_active, is_demo, consultation_fee, row_hash, valid_from, valid_to, is_current, run_id)
     SELECT s.doctor_key, s.doctor_name, dep.department_sk, s.is_active, s.is_demo, s.consultation_fee, s.row_hash,
            $2::timestamptz, NULL, TRUE, $1::bigint
     FROM analytics_staging.doctor s
     JOIN analytics_warehouse.dim_department dep ON dep.department_name = s.department_name
     WHERE NOT EXISTS (SELECT 1 FROM analytics_warehouse.dim_doctor d WHERE d.doctor_key = s.doctor_key AND d.is_current)`,
    [runId, runStartedAt]);
  return { closed: closed.rowCount, inserted: inserted.rowCount };
}

async function loadPatients(client, runId) {
  const { rowCount } = await client.query(
    `INSERT INTO analytics_warehouse.dim_patient (patient_key, first_run_id)
     SELECT DISTINCT patient_key, $1::bigint FROM analytics_staging.appointment
     WHERE dq_status = 'valid' AND patient_key IS NOT NULL
     ON CONFLICT (patient_key) DO NOTHING`, [runId]);
  return rowCount;
}

const STATUS_KEY = `CASE WHEN s.source_status = 'completed' THEN 2 WHEN s.appt_date >= CURRENT_DATE THEN 1 ELSE 3 END`;

async function loadAppointments(client, runId, runStartedAt, { initialLoad, detectRemovals }) {
  const valid = `analytics_staging.appointment s
     JOIN analytics_warehouse.dim_doctor doc ON doc.doctor_key = s.doctor_key AND doc.is_current
     LEFT JOIN analytics_warehouse.dim_patient p ON p.patient_key = s.patient_key`;

  const inserted = await client.query(
    `INSERT INTO analytics_warehouse.fact_appointment
       (appointment_id, date_key, start_hour, duration_minutes, doctor_sk, department_sk, patient_sk, status_key,
        source_status, has_diagnosis, first_seen_at, first_seen_run_id, last_changed_run_id, last_seen_run_id,
        observed_lead_days, row_hash)
     SELECT s.appointment_id, TO_CHAR(s.appt_date, 'YYYYMMDD')::int, EXTRACT(HOUR FROM s.start_time)::smallint,
            s.duration_minutes, doc.doctor_sk, doc.department_sk, p.patient_sk, ${STATUS_KEY},
            s.source_status, s.has_diagnosis, $2::timestamptz, $1::bigint, $1::bigint, $1::bigint,
            CASE WHEN $3::boolean OR s.appt_date < $2::timestamptz::date THEN NULL ELSE s.appt_date - $2::timestamptz::date END,
            s.row_hash
     FROM ${valid}
     WHERE s.dq_status = 'valid'
       AND NOT EXISTS (SELECT 1 FROM analytics_warehouse.fact_appointment f WHERE f.appointment_id = s.appointment_id)`,
    [runId, runStartedAt, initialLoad]);

  // Changed rows. The doctor version stays the one from first load unless the doctor itself changed,
  // so past appointments keep their original department.
  const updated = await client.query(
    `UPDATE analytics_warehouse.fact_appointment f
     SET date_key = TO_CHAR(s.appt_date, 'YYYYMMDD')::int,
         start_hour = EXTRACT(HOUR FROM s.start_time)::smallint,
         duration_minutes = s.duration_minutes,
         doctor_sk = CASE WHEN old_doc.doctor_key = s.doctor_key THEN f.doctor_sk ELSE doc.doctor_sk END,
         department_sk = CASE WHEN old_doc.doctor_key = s.doctor_key THEN f.department_sk ELSE doc.department_sk END,
         patient_sk = p.patient_sk,
         source_status = s.source_status,
         has_diagnosis = s.has_diagnosis,
         status_key = ${STATUS_KEY},
         is_removed = FALSE, removed_at = NULL,
         row_hash = s.row_hash, last_changed_run_id = $1, last_seen_run_id = $1
     FROM ${valid}, analytics_warehouse.dim_doctor old_doc
     WHERE s.dq_status = 'valid' AND f.appointment_id = s.appointment_id AND old_doc.doctor_sk = f.doctor_sk
       AND (f.row_hash <> s.row_hash OR f.is_removed)`, [runId]);

  await client.query(
    `UPDATE analytics_warehouse.fact_appointment f SET last_seen_run_id = $1
     FROM pg_temp.source_ids s WHERE s.id = f.appointment_id AND f.last_seen_run_id <> $1`, [runId]);

  let removed = { rowCount: 0 };
  if (detectRemovals) {
    removed = await client.query(
      `UPDATE analytics_warehouse.fact_appointment f
       SET is_removed = TRUE, removed_at = $2, status_key = 4, last_changed_run_id = $1
       WHERE NOT f.is_removed AND NOT EXISTS (SELECT 1 FROM pg_temp.source_ids s WHERE s.id = f.appointment_id)`,
      [runId, runStartedAt]);
  }
  return { inserted: inserted.rowCount, updated: updated.rowCount, removed: removed.rowCount };
}

// Statuses that depend on today's date: yesterday's open appointment is now "not completed"
async function refreshStatuses(client) {
  const { rowCount } = await client.query(
    `UPDATE analytics_warehouse.fact_appointment f
     SET status_key = CASE WHEN f.source_status = 'completed' THEN 2 WHEN d.full_date >= CURRENT_DATE THEN 1 ELSE 3 END
     FROM analytics_warehouse.dim_date d
     WHERE d.date_key = f.date_key AND NOT f.is_removed
       AND f.status_key <> CASE WHEN f.source_status = 'completed' THEN 2 WHEN d.full_date >= CURRENT_DATE THEN 1 ELSE 3 END`);
  return rowCount;
}

// Slots per doctor per day. Today and later are recalculated each run; past days are written once.
// Days before the first pipeline run are marked as back-filled from the current schedule.
async function loadCapacity(client, runId, daysAhead, firstRunDate) {
  const { rowCount } = await client.query(
    `WITH days AS (
       SELECT d.date_key, d.full_date, d.iso_dow FROM analytics_warehouse.dim_date d
       WHERE d.full_date BETWEEN
         (SELECT COALESCE(MIN(dd.full_date), CURRENT_DATE) FROM analytics_warehouse.fact_appointment f
            JOIN analytics_warehouse.dim_date dd ON dd.date_key = f.date_key)
         AND CURRENT_DATE + $2::int
     ), slots AS (
       SELECT doc.doctor_key, doc.doctor_sk, doc.department_sk, days.date_key, days.full_date,
              CASE WHEN days.full_date >= CURRENT_DATE AND NOT (doc.is_active AND dep.is_active) THEN 0
                   ELSE COALESCE(SUM(sch.slots_per_day), 0) END AS scheduled_slots
       FROM analytics_warehouse.dim_doctor doc
       JOIN analytics_warehouse.dim_department dep ON dep.department_sk = doc.department_sk
       CROSS JOIN days
       LEFT JOIN analytics_staging.doctor_schedule sch ON sch.doctor_key = doc.doctor_key AND sch.iso_dow = days.iso_dow
       WHERE doc.is_current
       GROUP BY doc.doctor_key, doc.doctor_sk, doc.department_sk, doc.is_active, dep.is_active, days.date_key, days.full_date
     )
     INSERT INTO analytics_warehouse.fact_doctor_daily_capacity
       (doctor_key, date_key, doctor_sk, department_sk, scheduled_slots, capacity_basis, run_id)
     SELECT doctor_key, date_key, doctor_sk, department_sk, scheduled_slots,
            CASE WHEN full_date < $3::date THEN 'backfilled_from_current_schedule' ELSE 'observed' END, $1
     FROM slots
     ON CONFLICT (doctor_key, date_key) DO UPDATE
       SET doctor_sk = EXCLUDED.doctor_sk, department_sk = EXCLUDED.department_sk,
           scheduled_slots = EXCLUDED.scheduled_slots, run_id = EXCLUDED.run_id
     WHERE (SELECT full_date FROM analytics_warehouse.dim_date WHERE date_key = EXCLUDED.date_key) >= CURRENT_DATE
       AND (fact_doctor_daily_capacity.scheduled_slots, fact_doctor_daily_capacity.doctor_sk)
           IS DISTINCT FROM (EXCLUDED.scheduled_slots, EXCLUDED.doctor_sk)`,
    [runId, daysAhead, firstRunDate]);
  return rowCount;
}

module.exports = { ensureDates, loadDepartments, loadDoctors, loadPatients, loadAppointments, refreshStatuses, loadCapacity };
