// Reads the hospital tables, read-only and inside one consistent snapshot.
// Emails are turned into pseudonymous keys here, before anything is stored.

// Source columns the pipeline needs, and ones it uses when the database has them
const REQUIRED = {
  appointment: ['id', 'doctor', 'date', 'starttime', 'endtime', 'status'],
  patientsattendappointments: ['patient', 'appt'],
  patient: ['email'],
  doctor: ['email', 'name', 'specialization'],
  schedule: ['id', 'starttime', 'endtime', 'breaktime'],
  scheduledays: ['sched', 'day'],
  docshaveschedules: ['sched', 'doctor'],
  diagnose: ['appt'],
};
const OPTIONAL = {
  doctor: ['id', 'is_active', 'is_demo', 'consultation_fee'],
  department: ['id', 'name', 'slug', 'is_active'],
};

// What this database lets the pipeline read: { table: { column: data_type } }
async function readableColumns(db) {
  const tables = [...new Set([...Object.keys(REQUIRED), ...Object.keys(OPTIONAL)])];
  const { rows } = await db.query(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1)
       AND has_column_privilege(format('public.%I', table_name), column_name, 'SELECT')`,
    [tables]);
  const out = {};
  for (const r of rows) {
    out[r.table_name] = out[r.table_name] || {};
    out[r.table_name][r.column_name] = r.data_type;
  }
  return out;
}

function capabilities(columns) {
  const missing = [];
  for (const [table, cols] of Object.entries(REQUIRED)) {
    for (const col of cols) if (!(columns[table] && columns[table][col])) missing.push(`${table}.${col}`);
  }
  const has = (table, col) => Boolean(columns[table] && columns[table][col]);
  return {
    missing,
    doctorId: has('doctor', 'id'),
    doctorActive: has('doctor', 'is_active'),
    doctorDemo: has('doctor', 'is_demo'),
    doctorFee: has('doctor', 'consultation_fee'),
    departmentTable: OPTIONAL.department.every(c => has('department', c)),
  };
}

// The same version hash in full and incremental mode, so changes can be detected either way.
// It covers the appointment row, its patient links and whether a diagnosis exists.
// Links and diagnoses are aggregated once and joined, because the source has no index on
// PatientsAttendAppointments.appt (and the pipeline must not add one).
const VERSIONED_APPOINTMENTS = `
  WITH links AS (
    SELECT appt, string_agg(patient, ',' ORDER BY patient) AS patients FROM patientsattendappointments GROUP BY appt
  ), dx AS (
    SELECT DISTINCT appt FROM diagnose
  )
  SELECT a.*, md5(concat_ws('|', a.id, a.doctor, a.date, a.starttime, a.endtime, a.status, l.patients, dx.appt IS NOT NULL)) AS version_hash
  FROM appointment a
  LEFT JOIN links l ON l.appt = a.id
  LEFT JOIN dx ON dx.appt = a.id`;

// Light scan used by incremental mode: every appointment id with its version hash
async function scanAppointmentVersions(db) {
  const { rows } = await db.query(`SELECT v.id, v.version_hash FROM (${VERSIONED_APPOINTMENTS}) v`);
  return rows;
}

// Reads everything the pipeline needs. With `appointmentIds`, only those appointments
// (and their links) are read; reference tables are always read in full because they are small.
async function extract(db, caps, pseudo, { appointmentIds = null } = {}) {
  const doctorKey = row => (caps.doctorId && row.doctor_id !== null && row.doctor_id !== undefined
    ? `doc_${row.doctor_id}` : pseudo('doc', row.doctor_email));
  const idFilter = appointmentIds ? 'WHERE a.id = ANY($1::int[])' : '';
  const params = appointmentIds ? [appointmentIds] : [];

  const { rows: doctors } = await db.query(
    `SELECT d.email AS doctor_email, d.name, d.specialization
            ${caps.doctorId ? ', d.id AS doctor_id' : ''}
            ${caps.doctorActive ? ', d.is_active' : ''}
            ${caps.doctorDemo ? ', d.is_demo' : ''}
            ${caps.doctorFee ? ', d.consultation_fee' : ''}
     FROM doctor d`);
  const keyByEmail = new Map(doctors.map(d => [d.doctor_email, doctorKey(d)]));

  const { rows: appointments } = await db.query(
    `SELECT a.id, a.doctor AS doctor_email, a.date::text AS appt_date, a.starttime::text AS start_time,
            a.endtime::text AS end_time, a.status, a.version_hash
     FROM (${VERSIONED_APPOINTMENTS}) a ${idFilter}`, params);

  const { rows: links } = await db.query(
    `SELECT p.appt, p.patient FROM patientsattendappointments p
     ${appointmentIds ? 'WHERE p.appt = ANY($1::int[])' : ''}`, params);

  const { rows: patients } = await db.query('SELECT email FROM patient');

  const { rows: diagnoses } = await db.query(
    `SELECT DISTINCT g.appt FROM diagnose g ${appointmentIds ? 'WHERE g.appt = ANY($1::int[])' : ''}`, params);

  const { rows: schedules } = await db.query(
    `SELECT dhs.doctor AS doctor_email, s.id, s.starttime::text AS start_time, s.endtime::text AS end_time,
            s.breaktime::text AS break_time, sd.day
     FROM docshaveschedules dhs
     JOIN schedule s ON s.id = dhs.sched
     JOIN scheduledays sd ON sd.sched = s.id`);

  let departments = [];
  if (caps.departmentTable) {
    ({ rows: departments } = await db.query('SELECT id, name, slug, is_active FROM department'));
  }

  const str = v => (v === null || v === undefined ? null : String(v));
  return {
    appointment: appointments.map(a => ({
      appointment_id: str(a.id),
      // An appointment whose doctor is missing keeps a key so the orphan rule can catch it
      doctor_key: keyByEmail.get(a.doctor_email) || pseudo('doc', a.doctor_email),
      appt_date: a.appt_date, start_time: a.start_time, end_time: a.end_time, status: a.status,
      version_hash: a.version_hash,
    })),
    appointment_patient: links.map(l => ({ appointment_id: str(l.appt), patient_key: pseudo('pat', l.patient) })),
    patient: patients.map(p => ({ patient_key: pseudo('pat', p.email) })),
    doctor: doctors.map(d => ({
      doctor_key: doctorKey(d), doctor_name: d.name, department_name: d.specialization,
      is_active: caps.doctorActive ? str(d.is_active) : 'true',
      is_demo: caps.doctorDemo ? str(d.is_demo) : 'false',
      consultation_fee: caps.doctorFee ? str(d.consultation_fee) : null,
    })),
    department: departments.map(d => ({ department_id: str(d.id), name: d.name, slug: d.slug, is_active: str(d.is_active) })),
    doctor_schedule: schedules.map(s => ({
      doctor_key: keyByEmail.get(s.doctor_email) || pseudo('doc', s.doctor_email),
      schedule_id: str(s.id), start_time: s.start_time, end_time: s.end_time, break_time: s.break_time, day_name: s.day,
    })),
    diagnosis_marker: diagnoses.map(g => ({ appointment_id: str(g.appt) })),
  };
}

module.exports = { REQUIRED, OPTIONAL, readableColumns, capabilities, scanAppointmentVersions, extract };
