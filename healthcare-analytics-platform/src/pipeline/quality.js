// Data quality rules. Each rule counts the rows it looked at and returns the rows that fail.
//   quarantine  failing appointments are kept out of the warehouse and listed in analytics_meta.quarantine
//   flag        failing rows still load; the result is reported
//   block       the run stops before loading anything
//   report      a check on the run as a whole
// Source rows are never corrected or deleted.

const STAGED = 'analytics_staging.appointment';

// Rules on the staged extract, run before the warehouse load
const PRE_LOAD_RULES = [
  {
    name: 'appointment_required_fields',
    dataset: 'appointment', severity: 'error', action: 'quarantine',
    description: 'Appointment has a doctor, a valid date, valid start and end times and a known status.',
    evaluated: `SELECT COUNT(*) FROM ${STAGED}`,
    failing: `SELECT appointment_id FROM ${STAGED}
              WHERE doctor_key IS NULL OR appt_date IS NULL OR start_time IS NULL OR end_time IS NULL`,
  },
  {
    name: 'appointment_unknown_status',
    dataset: 'appointment', severity: 'error', action: 'quarantine',
    description: "Status is one of the hospital's codes (NotDone, Done).",
    evaluated: `SELECT COUNT(*) FROM ${STAGED}`,
    failing: `SELECT appointment_id FROM ${STAGED} WHERE source_status IS NULL`,
  },
  {
    name: 'appointment_invalid_time_range',
    dataset: 'appointment', severity: 'error', action: 'quarantine',
    description: 'Appointment ends after it starts.',
    evaluated: `SELECT COUNT(*) FROM ${STAGED} WHERE start_time IS NOT NULL AND end_time IS NOT NULL`,
    failing: `SELECT appointment_id FROM ${STAGED} WHERE duration_minutes <= 0`,
  },
  {
    name: 'appointment_duplicate_id',
    dataset: 'appointment', severity: 'error', action: 'quarantine',
    description: 'Each appointment id appears once in the extract.',
    evaluated: 'SELECT COUNT(*) FROM analytics_raw.appointment',
    failing: `SELECT appointment_id::int FROM analytics_raw.appointment
              WHERE appointment_id ~ '^\\d{1,9}$' GROUP BY appointment_id HAVING COUNT(*) > 1`,
  },
  {
    name: 'appointment_orphan_doctor',
    dataset: 'appointment', severity: 'error', action: 'quarantine',
    description: 'Appointment belongs to a doctor that exists.',
    evaluated: `SELECT COUNT(*) FROM ${STAGED} WHERE doctor_key IS NOT NULL`,
    failing: `SELECT a.appointment_id FROM ${STAGED} a
              WHERE a.doctor_key IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM analytics_staging.doctor d WHERE d.doctor_key = a.doctor_key)`,
  },
  {
    name: 'appointment_doctor_unknown_department',
    dataset: 'appointment', severity: 'error', action: 'quarantine',
    description: "The appointment's doctor belongs to a known department.",
    evaluated: `SELECT COUNT(*) FROM ${STAGED} a JOIN analytics_staging.doctor d ON d.doctor_key = a.doctor_key`,
    failing: `SELECT a.appointment_id FROM ${STAGED} a
              JOIN analytics_staging.doctor d ON d.doctor_key = a.doctor_key
              WHERE NOT EXISTS (SELECT 1 FROM analytics_staging.department dep WHERE dep.department_name = d.department_name)`,
  },
  {
    name: 'appointment_duplicate_slot',
    dataset: 'appointment', severity: 'error', action: 'quarantine',
    description: 'A doctor has at most one appointment starting at the same date and time (later ids are held back).',
    evaluated: `SELECT COUNT(*) FROM ${STAGED} WHERE appt_date IS NOT NULL AND start_time IS NOT NULL`,
    failing: `SELECT appointment_id FROM (
                SELECT appointment_id, ROW_NUMBER() OVER (PARTITION BY doctor_key, appt_date, start_time ORDER BY appointment_id) AS n
                FROM ${STAGED} WHERE appt_date IS NOT NULL AND start_time IS NOT NULL) x
              WHERE n > 1`,
  },
  {
    name: 'appointment_implausible_date',
    dataset: 'appointment', severity: 'warning', action: 'flag',
    description: 'Appointment date is between 2000-01-01 and one year from today.',
    evaluated: `SELECT COUNT(*) FROM ${STAGED} WHERE appt_date IS NOT NULL`,
    failing: `SELECT appointment_id FROM ${STAGED}
              WHERE appt_date < DATE '2000-01-01' OR appt_date > CURRENT_DATE + 365`,
  },
  {
    name: 'appointment_without_patient',
    dataset: 'appointment', severity: 'warning', action: 'flag',
    description: 'Appointment is linked to a patient. (A patient can hide a completed visit, which removes the link.)',
    evaluated: `SELECT COUNT(*) FROM ${STAGED}`,
    failing: `SELECT appointment_id FROM ${STAGED} WHERE patient_links = 0`,
  },
  {
    name: 'appointment_multiple_patients',
    dataset: 'appointment', severity: 'warning', action: 'flag',
    description: 'Appointment is linked to at most one patient.',
    evaluated: `SELECT COUNT(*) FROM ${STAGED}`,
    failing: `SELECT appointment_id FROM ${STAGED} WHERE patient_links > 1`,
  },
  {
    name: 'patient_link_orphan',
    dataset: 'appointment_patient', severity: 'error', action: 'flag',
    description: 'Every appointment-patient link points to a patient that exists.',
    evaluated: 'SELECT COUNT(*) FROM analytics_raw.appointment_patient',
    failing: `SELECT l.appointment_id::int FROM analytics_raw.appointment_patient l
              WHERE NOT EXISTS (SELECT 1 FROM analytics_raw.patient p WHERE p.patient_key = l.patient_key)`,
  },
  {
    name: 'completed_without_diagnosis',
    dataset: 'appointment', severity: 'warning', action: 'flag',
    description: 'Appointments marked done have a diagnosis recorded.',
    evaluated: `SELECT COUNT(*) FROM ${STAGED} WHERE source_status = 'completed'`,
    failing: `SELECT appointment_id FROM ${STAGED} WHERE source_status = 'completed' AND NOT has_diagnosis`,
  },
  {
    name: 'diagnosis_on_open_appointment',
    dataset: 'appointment', severity: 'warning', action: 'flag',
    description: 'Appointments with a diagnosis are marked done.',
    evaluated: `SELECT COUNT(*) FROM ${STAGED} WHERE has_diagnosis`,
    failing: `SELECT appointment_id FROM ${STAGED} WHERE has_diagnosis AND source_status = 'scheduled'`,
  },
  {
    name: 'doctor_without_schedule',
    dataset: 'doctor', severity: 'warning', action: 'flag',
    description: 'Active doctors have working hours, so their capacity can be measured.',
    evaluated: 'SELECT COUNT(*) FROM analytics_staging.doctor WHERE is_active',
    failing: `SELECT NULL::int FROM analytics_staging.doctor d
              WHERE d.is_active AND NOT EXISTS (SELECT 1 FROM analytics_staging.doctor_schedule s WHERE s.doctor_key = d.doctor_key)`,
  },
  {
    name: 'schedule_break_outside_hours',
    dataset: 'doctor_schedule', severity: 'warning', action: 'flag',
    description: 'The break starts within working hours.',
    evaluated: 'SELECT COUNT(*) FROM analytics_staging.doctor_schedule',
    failing: `SELECT NULL::int FROM analytics_staging.doctor_schedule
              WHERE break_time IS NOT NULL AND (break_time < start_time OR break_time >= end_time)`,
  },
  {
    name: 'doctor_negative_fee',
    dataset: 'doctor', severity: 'warning', action: 'flag',
    description: 'Consultation fees are not negative.',
    evaluated: 'SELECT COUNT(*) FROM analytics_staging.doctor WHERE consultation_fee IS NOT NULL',
    failing: 'SELECT NULL::int FROM analytics_staging.doctor WHERE consultation_fee < 0',
  },
];

// The pre-load rules plus a freshness check: was the previous successful run recent enough?
function preLoadRules(freshnessHours, runId) {
  const hours = Number(freshnessHours);
  const id = Number(runId);
  if (!Number.isInteger(hours) || !Number.isInteger(id)) throw new Error('freshness hours and run id must be whole numbers');
  return PRE_LOAD_RULES.concat({
    name: 'data_freshness',
    dataset: 'pipeline', severity: 'warning', action: 'report',
    description: `The previous successful load finished less than ${hours} hours before this run.`,
    evaluated: `SELECT COUNT(*) FROM (SELECT 1 FROM analytics_meta.pipeline_runs
                WHERE run_id <> ${id} AND status IN ('succeeded', 'succeeded_with_warnings') AND mode IN ('full', 'incremental') LIMIT 1) x`,
    failing: `SELECT NULL::int FROM (SELECT MAX(finished_at) AS f FROM analytics_meta.pipeline_runs
              WHERE run_id <> ${id} AND status IN ('succeeded', 'succeeded_with_warnings') AND mode IN ('full', 'incremental')) x
              WHERE x.f < NOW() - INTERVAL '${hours} hours'`,
  });
}

// Checks on the loaded warehouse, run in the same transaction after the load
const POST_LOAD_RULES = [
  {
    name: 'source_to_target_reconciliation',
    dataset: 'fact_appointment', severity: 'error', action: 'report',
    description: 'Every appointment in the source is in the warehouse or in quarantine, and the warehouse has no active appointment the source no longer has.',
    evaluated: 'SELECT COUNT(*) FROM pg_temp.source_ids',
    failing: `SELECT s.id FROM pg_temp.source_ids s
              WHERE NOT EXISTS (SELECT 1 FROM analytics_warehouse.fact_appointment f WHERE f.appointment_id = s.id AND NOT f.is_removed)
                AND NOT EXISTS (SELECT 1 FROM ${STAGED} q WHERE q.appointment_id = s.id AND q.dq_status = 'quarantined')
              UNION ALL
              SELECT f.appointment_id FROM analytics_warehouse.fact_appointment f
              WHERE NOT f.is_removed AND NOT EXISTS (SELECT 1 FROM pg_temp.source_ids s WHERE s.id = f.appointment_id)`,
  },
  {
    name: 'dim_doctor_one_current_version',
    dataset: 'dim_doctor', severity: 'error', action: 'report',
    description: 'Each doctor in the source has exactly one current version in the doctor dimension.',
    evaluated: 'SELECT COUNT(*) FROM analytics_staging.doctor',
    failing: `SELECT NULL::int FROM analytics_staging.doctor s
              WHERE (SELECT COUNT(*) FROM analytics_warehouse.dim_doctor d
                     WHERE d.doctor_key = s.doctor_key AND d.is_current) <> 1`,
  },
  {
    name: 'fact_status_consistent',
    dataset: 'fact_appointment', severity: 'error', action: 'report',
    description: 'Removed appointments have the removed status and active ones do not.',
    evaluated: 'SELECT COUNT(*) FROM analytics_warehouse.fact_appointment',
    failing: `SELECT appointment_id FROM analytics_warehouse.fact_appointment
              WHERE (is_removed AND status_key <> 4) OR (NOT is_removed AND status_key = 4)`,
  },
];

async function runRules(client, runId, rules) {
  const results = [];
  for (const rule of rules) {
    const evaluated = Number((await client.query(rule.evaluated)).rows[0].count);
    const { rows } = await client.query(rule.failing);
    const failingIds = rows.map(r => Object.values(r)[0]).filter(v => v !== null && v !== undefined).map(Number);
    const failed = rows.length;
    const result = {
      rule_name: rule.name, dataset: rule.dataset, severity: rule.severity, action: rule.action,
      rows_evaluated: evaluated, rows_failed: failed,
      failure_pct: evaluated ? Math.round((failed / evaluated) * 10000) / 100 : 0,
      passed: failed === 0, description: rule.description,
    };
    results.push(result);
    await client.query(
      `INSERT INTO analytics_meta.dq_results
         (run_id, rule_name, dataset, severity, action, rows_evaluated, rows_failed, failure_pct, passed, description,
          resolution_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [runId, rule.name, rule.dataset, rule.severity, rule.action, evaluated, failed, result.failure_pct,
        result.passed, rule.description, result.passed ? 'not_applicable' : 'open']);
    if (rule.action === 'quarantine' && failingIds.length) {
      await client.query(
        `UPDATE ${STAGED} SET dq_status = 'quarantined' WHERE appointment_id = ANY($1::int[])`, [failingIds]);
      // The payload is the pseudonymised staging row: no names, emails or clinical text
      await client.query(
        `INSERT INTO analytics_meta.quarantine (run_id, dataset, record_key, rule_name, payload)
         SELECT $1, $2, s.appointment_id::text, $3,
                jsonb_build_object('doctor_key', s.doctor_key, 'appt_date', s.appt_date, 'start_time', s.start_time,
                                   'end_time', s.end_time, 'source_status', s.source_status)
         FROM ${STAGED} s WHERE s.appointment_id = ANY($4::int[])`,
        [runId, rule.dataset, rule.name, failingIds]);
    }
  }
  return results;
}

module.exports = { PRE_LOAD_RULES, POST_LOAD_RULES, preLoadRules, runRules };
