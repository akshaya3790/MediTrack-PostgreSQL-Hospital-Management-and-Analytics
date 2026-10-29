// Raw and staging layers. The raw tables receive the extract as text; staging turns it into
// standard types and codes. Values that cannot be converted become NULL here and are then
// caught by the data quality rules, instead of failing the whole run.

const RAW_COLUMNS = {
  appointment: ['appointment_id', 'doctor_key', 'appt_date', 'start_time', 'end_time', 'status', 'version_hash'],
  appointment_patient: ['appointment_id', 'patient_key'],
  patient: ['patient_key'],
  doctor: ['doctor_key', 'doctor_name', 'department_name', 'is_active', 'is_demo', 'consultation_fee'],
  department: ['department_id', 'name', 'slug', 'is_active'],
  doctor_schedule: ['doctor_key', 'schedule_id', 'start_time', 'end_time', 'break_time', 'day_name'],
  diagnosis_marker: ['appointment_id'],
};

// Bulk insert through unnest(): one statement per table, whatever the row count
async function loadRaw(client, runId, extract) {
  await client.query(`TRUNCATE ${Object.keys(RAW_COLUMNS).map(t => `analytics_raw.${t}`).join(', ')}`);
  const counts = {};
  for (const [table, columns] of Object.entries(RAW_COLUMNS)) {
    const rows = extract[table] || [];
    counts[table] = rows.length;
    if (!rows.length) continue;
    const arrays = columns.map(c => rows.map(r => (r[c] === null || r[c] === undefined ? null : String(r[c]))));
    await client.query(
      `INSERT INTO analytics_raw.${table} (run_id, ${columns.join(', ')})
       SELECT $1, * FROM unnest(${columns.map((_, i) => `$${i + 2}::text[]`).join(', ')})`,
      [runId, ...arrays]);
  }
  return counts;
}

const DATE = (col) => `CASE WHEN ${col} ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN ${col}::date END`;
const TIME = (col) => `CASE WHEN ${col} ~ '^\\d{1,2}:\\d{2}(:\\d{2})?$' THEN ${col}::time END`;
const BOOL = (col) => `CASE LOWER(BTRIM(${col})) WHEN 'true' THEN TRUE WHEN 't' THEN TRUE WHEN 'false' THEN FALSE WHEN 'f' THEN FALSE END`;

async function buildStaging(client, runId, { departmentTable }) {
  await client.query(`TRUNCATE analytics_staging.appointment, analytics_staging.doctor,
                               analytics_staging.department, analytics_staging.doctor_schedule`);

  // Departments: from the Department table when it exists, otherwise from doctors' specializations
  if (departmentTable) {
    await client.query(
      `INSERT INTO analytics_staging.department (run_id, department_name, department_id, slug, is_active)
       SELECT DISTINCT ON (BTRIM(name)) $1, BTRIM(name),
              CASE WHEN department_id ~ '^\\d+$' THEN department_id::int END, slug, COALESCE(${BOOL('is_active')}, TRUE)
       FROM analytics_raw.department WHERE NULLIF(BTRIM(name), '') IS NOT NULL
       ORDER BY BTRIM(name), department_id`, [runId]);
  } else {
    await client.query(
      `INSERT INTO analytics_staging.department (run_id, department_name, is_active)
       SELECT DISTINCT $1::bigint, BTRIM(department_name), TRUE
       FROM analytics_raw.doctor WHERE NULLIF(BTRIM(department_name), '') IS NOT NULL`, [runId]);
  }

  await client.query(
    `INSERT INTO analytics_staging.doctor
       (run_id, doctor_key, doctor_name, department_name, is_active, is_demo, consultation_fee, row_hash)
     SELECT DISTINCT ON (doctor_key) $1, doctor_key, BTRIM(doctor_name), BTRIM(department_name),
            COALESCE(${BOOL('is_active')}, TRUE), COALESCE(${BOOL('is_demo')}, FALSE),
            CASE WHEN consultation_fee ~ '^-?\\d+(\\.\\d+)?$' THEN consultation_fee::numeric END,
            md5(concat_ws('|', BTRIM(doctor_name), BTRIM(department_name), is_active, is_demo, consultation_fee))
     FROM analytics_raw.doctor WHERE doctor_key IS NOT NULL
     ORDER BY doctor_key`, [runId]);

  // One-hour slots between start and end, skipping the hour that overlaps the break,
  // the same rule the hospital app uses when it offers free times
  await client.query(
    `WITH typed AS (
       SELECT r.doctor_key, x.iso_dow,
              ${TIME('r.start_time')} AS st, ${TIME('r.end_time')} AS et, ${TIME('r.break_time')} AS bt
       FROM analytics_raw.doctor_schedule r
       JOIN (VALUES ('monday', 1), ('tuesday', 2), ('wednesday', 3), ('thursday', 4), ('friday', 5),
                    ('saturday', 6), ('sunday', 7)) AS x(day_name, iso_dow)
         ON x.day_name = LOWER(BTRIM(r.day_name))
     )
     INSERT INTO analytics_staging.doctor_schedule
       (run_id, doctor_key, iso_dow, start_time, end_time, break_time, slots_per_day)
     SELECT DISTINCT ON (t.doctor_key, t.iso_dow, t.st) $1, t.doctor_key, t.iso_dow, t.st, t.et, t.bt,
            (SELECT COUNT(*)
             FROM generate_series(DATE '2000-01-01' + t.st, DATE '2000-01-01' + t.et - INTERVAL '1 hour', INTERVAL '1 hour') AS slot(s)
             WHERE t.bt IS NULL
                OR NOT (slot.s < DATE '2000-01-01' + t.bt + INTERVAL '1 hour' AND slot.s + INTERVAL '1 hour' > DATE '2000-01-01' + t.bt))
     FROM typed t
     WHERE t.st IS NOT NULL AND t.et IS NOT NULL AND t.st < t.et
     ORDER BY t.doctor_key, t.iso_dow, t.st`, [runId]);

  await client.query(
    `INSERT INTO analytics_staging.appointment
       (run_id, appointment_id, doctor_key, patient_key, patient_links, appt_date, start_time, end_time,
        duration_minutes, source_status, has_diagnosis, row_hash)
     SELECT DISTINCT ON (a.appointment_id::int) $1, a.appointment_id::int, a.doctor_key,
            l.patient_key, COALESCE(l.links, 0),
            ${DATE('a.appt_date')}, ${TIME('a.start_time')}, ${TIME('a.end_time')},
            (EXTRACT(EPOCH FROM (${TIME('a.end_time')} - ${TIME('a.start_time')})) / 60)::int,
            CASE UPPER(BTRIM(a.status)) WHEN 'DONE' THEN 'completed' WHEN 'NOTDONE' THEN 'scheduled' END,
            EXISTS (SELECT 1 FROM analytics_raw.diagnosis_marker g WHERE g.appointment_id = a.appointment_id),
            COALESCE(a.version_hash, md5(concat_ws('|', a.appointment_id, a.doctor_key, a.appt_date, a.start_time, a.end_time, a.status)))
     FROM analytics_raw.appointment a
     LEFT JOIN (SELECT appointment_id, MIN(patient_key) AS patient_key, COUNT(*) AS links
                FROM analytics_raw.appointment_patient GROUP BY appointment_id) l
       ON l.appointment_id = a.appointment_id
     WHERE a.appointment_id ~ '^\\d{1,9}$'
     ORDER BY a.appointment_id::int, a.version_hash`, [runId]);
}

module.exports = { loadRaw, buildStaging, RAW_COLUMNS };
