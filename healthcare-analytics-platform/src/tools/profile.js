// Data inventory: what the analytics role can see in the hospital tables, row counts, date ranges,
// null rates and status values, without printing any personal data. Read-only.
//   npm run profile
const { withTransaction, closePool } = require('../db');
const { capabilities, readableColumns } = require('../pipeline/source');

async function profile(client) {
  const caps = capabilities(await readableColumns(client));
  const out = { generatedAt: new Date().toISOString(), readable: caps, tables: {} };
  const tables = ['appointment', 'patientsattendappointments', 'patient', 'doctor', 'department', 'schedule',
    'scheduledays', 'docshaveschedules', 'diagnose'];
  for (const t of tables) {
    const ok = await client.query(`SELECT to_regclass('public.${t}') IS NOT NULL AS present,
      has_table_privilege(current_user, 'public.${t}', 'SELECT') AS full_select`).catch(() => ({ rows: [{ present: false }] }));
    if (!ok.rows[0].present) { out.tables[t] = { present: false }; continue; }
    // COUNT(*) needs SELECT on at least one column, which every granted table has
    const count = await client.query(`SELECT COUNT(*)::int AS n FROM public.${t}`).catch(e => ({ error: e.message }));
    out.tables[t] = { present: true, rows: count.rows ? count.rows[0].n : null, error: count.error };
  }
  if (out.tables.appointment && out.tables.appointment.present) {
    const a = await client.query(`
      SELECT MIN(date)::text AS first_date, MAX(date)::text AS last_date,
             COUNT(*) FILTER (WHERE date IS NULL)::int AS null_dates,
             COUNT(*) FILTER (WHERE doctor IS NULL)::int AS null_doctor,
             COUNT(*) FILTER (WHERE starttime IS NULL OR endtime IS NULL)::int AS null_times,
             (SELECT json_object_agg(COALESCE(status, '(null)'), n)
              FROM (SELECT status, COUNT(*) AS n FROM appointment GROUP BY status) s) AS statuses
      FROM appointment`);
    out.appointments = a.rows[0];
    const links = await client.query(`
      SELECT COUNT(*)::int AS links, COUNT(DISTINCT appt)::int AS linked_appointments,
             COUNT(DISTINCT patient)::int AS distinct_patients FROM patientsattendappointments`);
    out.patientLinks = links.rows[0];
  }
  return out;
}

if (require.main === module) {
  withTransaction(profile, { readOnly: true })
    .then(p => console.log(JSON.stringify(p, null, 2)))
    .catch(err => { console.error(`Profiling failed: ${err.message}`); process.exitCode = 1; })
    .finally(closePool);
}

module.exports = { profile };
