// The analytics API and dashboard: a separate Express app on its own port.
// It only reads analytics_* schemas (plus the session table to check who is signed in),
// every connection is read-only, and every answer is aggregated: no patient-level rows.
const path = require('path');
const express = require('express');
const { requireAdmin } = require('./auth');
const { parseFilters, whereClause, FilterError, addDays } = require('./filters');
const { KPIS } = require('./kpis');
const { toCsv } = require('./csv');

// Groups smaller than this are hidden in patient breakdowns
const MIN_GROUP = 5;

const rate = (num, den) => (Number(den) > 0 ? Math.round((Number(num) / Number(den)) * 10000) / 10000 : null);
const suppress = n => (Number(n) < MIN_GROUP ? null : Number(n));

function createApp({ pool, sessionSecret, signInUrl }) {
  const app = express();
  app.disable('x-powered-by');

  // Every query runs in a read-only transaction
  const query = async (sql, params = []) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const result = await client.query(sql, params);
      await client.query('COMMIT');
      return result.rows;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    });
    if (req.path.startsWith('/analytics/api/')) res.set('Cache-Control', 'no-store');
    next();
  });

  const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  // ---------- Public health check (no data) ----------
  app.get('/analytics/api/health', route(async (req, res) => {
    try {
      const rows = await query('SELECT hours_since_refresh, status FROM analytics_marts.data_freshness');
      res.json({
        status: 'ok', database: 'reachable',
        lastRefreshHoursAgo: rows.length ? Math.round(Number(rows[0].hours_since_refresh) * 10) / 10 : null,
      });
    } catch (err) {
      res.status(503).json({ status: 'unavailable', database: 'unreachable' });
    }
  }));

  // ---------- Dashboard page ----------
  app.get('/', (req, res) => res.redirect('/analytics'));
  app.use('/analytics', express.static(path.join(__dirname, '..', '..', 'public'), { index: 'index.html' }));

  const api = express.Router();
  api.use(requireAdmin(pool, sessionSecret, signInUrl));

  const datasetInfo = async () => {
    const rows = await query('SELECT is_synthetic, label, generated_at, notes FROM analytics_meta.dataset_info');
    return rows[0] || { is_synthetic: false, label: 'Hospital data' };
  };

  api.get('/me', route(async (req, res) => {
    const freshness = await query('SELECT run_id, finished_at, hours_since_refresh FROM analytics_marts.data_freshness');
    res.json({ admin: true, dataset: await datasetInfo(), freshness: freshness[0] || null });
  }));

  api.get('/kpis', (req, res) => res.json({ data: KPIS }));

  api.get('/filters', route(async (req, res) => {
    const departments = await query(
      `SELECT department_sk AS id, department_name AS name, is_active AS "isActive"
       FROM analytics_warehouse.dim_department ORDER BY department_name`);
    const doctors = await query(
      `SELECT doctor_key AS key, doctor_name AS name, d.department_sk AS "departmentId", is_demo AS "isDemo"
       FROM analytics_warehouse.dim_doctor d WHERE is_current ORDER BY doctor_name`);
    const coverage = await query(
      `SELECT MIN(appt_date)::text AS first, MAX(appt_date)::text AS last, COUNT(*)::int AS appointments
       FROM analytics_marts.appointments`);
    res.json({ departments, doctors, coverage: coverage[0] });
  }));

  // KPI block shared by several pages
  const kpiSql = `
    COUNT(*) FILTER (WHERE NOT is_removed)::int                    AS appointments,
    COUNT(*) FILTER (WHERE status = 'completed')::int              AS completed,
    COUNT(*) FILTER (WHERE status = 'scheduled')::int              AS scheduled,
    COUNT(*) FILTER (WHERE status = 'unresolved')::int             AS unresolved,
    COUNT(*) FILTER (WHERE is_removed)::int                        AS removed,
    COUNT(*)::int                                                  AS seen`;
  const withRates = r => ({
    ...r,
    completionRate: rate(r.completed, r.completed + r.unresolved),
    notCompletedRate: rate(r.unresolved, r.completed + r.unresolved),
    removalRate: rate(r.removed, r.seen),
  });

  // Slots offered and booked on the same days, for utilisation
  async function capacity(f, groupBy) {
    const params = [f.from, f.to];
    const parts = ['o.ops_date BETWEEN $1::date AND $2::date'];
    if (f.department !== undefined) { params.push(f.department); parts.push(`o.department_sk = $${params.length}`); }
    if (groupBy === 'doctor' || f.doctor !== undefined) {
      const dparts = ['d.full_date BETWEEN $1::date AND $2::date'];
      if (f.department !== undefined) dparts.push('c.department_sk = $3');
      if (f.doctor !== undefined) { params.push(f.doctor); dparts.push(`c.doctor_key = $${params.length}`); }
      return query(
        `SELECT c.doctor_key AS key, SUM(c.scheduled_slots)::int AS slots,
                bool_or(c.capacity_basis = 'backfilled_from_current_schedule') AS backfilled
         FROM analytics_warehouse.fact_doctor_daily_capacity c
         JOIN analytics_warehouse.dim_date d ON d.date_key = c.date_key
         WHERE ${dparts.join(' AND ')}
         GROUP BY c.doctor_key`, params);
    }
    return query(
      `SELECT ${groupBy === 'department' ? 'o.department_sk AS key,' : ''}
              SUM(o.scheduled_slots)::int AS slots
       FROM analytics_marts.daily_department_operations o
       WHERE ${parts.join(' AND ')}
       ${groupBy === 'department' ? 'GROUP BY o.department_sk' : ''}`, params);
  }

  // ---------- Page 1: executive overview ----------
  async function overview(f) {
    const w = whereClause(f);
    const [kpi] = await query(`SELECT ${kpiSql}, COUNT(DISTINCT patient_sk) FILTER (WHERE NOT is_removed)::int AS patients
                               FROM analytics_marts.appointments a WHERE ${w.sql}`, w.params);
    const monthly = await query(
      `SELECT month_start::text AS month, ${kpiSql} FROM analytics_marts.appointments a
       WHERE ${w.sql} GROUP BY month_start ORDER BY month_start`, w.params);
    const departments = await query(
      `SELECT department_sk AS id, department_name AS name, ${kpiSql} FROM analytics_marts.appointments a
       WHERE ${w.sql} GROUP BY department_sk, department_name ORDER BY appointments DESC, name`, w.params);
    const doctors = await query(
      `SELECT doctor_key AS key, MIN(doctor_name) AS name, ${kpiSql} FROM analytics_marts.appointments a
       WHERE ${w.sql} GROUP BY doctor_key ORDER BY name`, w.params);
    const cap = f.doctor !== undefined ? await capacity(f, 'doctor') : await capacity(f);
    const slots = cap.reduce((s, r) => s + Number(r.slots || 0), 0);
    return {
      kpis: { ...withRates(kpi), patients: suppress(kpi.patients), slots, slotUtilization: rate(kpi.appointments, slots) },
      monthly: monthly.map(withRates),
      departments: departments.map(withRates),
      doctors: doctors.map(withRates),
    };
  }

  // ---------- Page 2: departments ----------
  async function departments(f) {
    const w = whereClause(f);
    const prevTo = addDays(f.from, -1);
    const prevFrom = addDays(f.from, -f.days);
    const wp = whereClause(f, { from: prevFrom, to: prevTo });
    const rows = await query(
      `SELECT department_sk AS id, department_name AS name, ${kpiSql} FROM analytics_marts.appointments a
       WHERE ${w.sql} GROUP BY department_sk, department_name`, w.params);
    const prev = await query(
      `SELECT department_sk AS id, COUNT(*) FILTER (WHERE NOT is_removed)::int AS appointments
       FROM analytics_marts.appointments a WHERE ${wp.sql} GROUP BY department_sk`, wp.params);
    const cap = await capacity(f, 'department');
    const total = rows.reduce((s, r) => s + r.appointments, 0);
    const prevById = new Map(prev.map(p => [p.id, p.appointments]));
    const capById = new Map(cap.map(c => [c.key, Number(c.slots)]));
    const monthly = await query(
      `SELECT month_start::text AS month, department_name AS name, COUNT(*) FILTER (WHERE NOT is_removed)::int AS appointments
       FROM analytics_marts.appointments a WHERE ${w.sql}
       GROUP BY month_start, department_name ORDER BY month_start, department_name`, w.params);
    return {
      previousPeriod: { from: prevFrom, to: prevTo },
      departments: rows.map(r => {
        const before = prevById.get(r.id) || 0;
        return {
          ...withRates(r),
          share: rate(r.appointments, total),
          previousAppointments: before,
          demandChange: rate(r.appointments - before, before),
          slots: capById.get(r.id) || 0,
          slotUtilization: rate(r.appointments, capById.get(r.id)),
        };
      }).sort((a, b) => b.appointments - a.appointments || a.name.localeCompare(b.name)),
      monthly,
    };
  }

  // ---------- Page 3: doctor workload ----------
  async function doctors(f) {
    const w = whereClause(f);
    const rows = await query(
      `SELECT doctor_key AS key, MIN(doctor_name) AS name, MIN(department_name) AS department, bool_or(doctor_is_demo) AS "isDemo",
              COUNT(DISTINCT appt_date) FILTER (WHERE NOT is_removed)::int AS "daysWithAppointments", ${kpiSql}
       FROM analytics_marts.appointments a WHERE ${w.sql} GROUP BY doctor_key`, w.params);
    const cap = await capacity(f, 'doctor');
    const capByKey = new Map(cap.map(c => [c.key, c]));
    const weekly = await query(
      `SELECT week_start::text AS week, doctor_key AS key, COUNT(*) FILTER (WHERE NOT is_removed)::int AS appointments
       FROM analytics_marts.appointments a WHERE ${w.sql} GROUP BY week_start, doctor_key ORDER BY week_start`, w.params);
    const counts = rows.map(r => r.appointments).sort((a, b) => a - b);
    const pct = p => (counts.length ? counts[Math.min(counts.length - 1, Math.floor(p * counts.length))] : null);
    return {
      distribution: { doctors: counts.length, min: counts[0] ?? null, median: pct(0.5), p90: pct(0.9), max: counts[counts.length - 1] ?? null },
      doctors: rows.map(r => {
        const c = capByKey.get(r.key);
        return { ...withRates(r), slots: c ? Number(c.slots) : 0, slotUtilization: rate(r.appointments, c && c.slots),
          capacityBackfilled: Boolean(c && c.backfilled) };
      }).sort((a, b) => a.name.localeCompare(b.name)),
      weekly,
    };
  }

  // ---------- Page 4: appointment and patient flow ----------
  async function flow(f) {
    const w = whereClause(f);
    const status = await query(
      `SELECT status, status_label AS label, COUNT(*)::int AS appointments FROM analytics_marts.appointments a
       WHERE ${w.sql} GROUP BY status, status_label ORDER BY appointments DESC`, w.params);
    const heatmap = await query(
      `SELECT iso_dow AS dow, start_hour AS hour, COUNT(*) FILTER (WHERE NOT is_removed)::int AS appointments,
              COUNT(*) FILTER (WHERE status = 'unresolved')::int AS unresolved,
              COUNT(*) FILTER (WHERE status IN ('completed', 'unresolved'))::int AS past
       FROM analytics_marts.appointments a WHERE ${w.sql} GROUP BY iso_dow, start_hour ORDER BY iso_dow, start_hour`, w.params);
    const weekly = await query(
      `SELECT week_start::text AS week, ${kpiSql} FROM analytics_marts.appointments a
       WHERE ${w.sql} GROUP BY week_start ORDER BY week_start`, w.params);
    const byWeekday = await query(
      `SELECT iso_dow AS dow, MIN(day_name) AS day, ${kpiSql} FROM analytics_marts.appointments a
       WHERE ${w.sql} GROUP BY iso_dow ORDER BY iso_dow`, w.params);
    const lead = await query(
      `SELECT CASE WHEN observed_lead_days <= 1 THEN '0-1 days' WHEN observed_lead_days <= 7 THEN '2-7 days'
                   WHEN observed_lead_days <= 14 THEN '8-14 days' ELSE '15+ days' END AS bucket,
              MIN(observed_lead_days) AS sort, COUNT(*)::int AS appointments
       FROM analytics_marts.appointments a WHERE ${w.sql} AND observed_lead_days IS NOT NULL
       GROUP BY 1 ORDER BY 2`, w.params);
    // Visits per patient in the range, and new vs returning patients by month (pseudonymous, aggregated)
    const visits = await query(
      `WITH per_patient AS (
         SELECT patient_sk, COUNT(*) AS n FROM analytics_marts.appointments a
         WHERE ${w.sql} AND NOT is_removed AND patient_sk IS NOT NULL GROUP BY patient_sk)
       SELECT CASE WHEN n = 1 THEN '1 visit' WHEN n = 2 THEN '2 visits' WHEN n <= 5 THEN '3-5 visits' ELSE '6+ visits' END AS bucket,
              MIN(n) AS sort, COUNT(*)::int AS patients
       FROM per_patient GROUP BY 1 ORDER BY 2`, w.params);
    const newReturning = await query(
      `WITH firsts AS (
         SELECT patient_sk, MIN(appt_date) AS first_date FROM analytics_marts.appointments
         WHERE NOT is_removed AND patient_sk IS NOT NULL GROUP BY patient_sk)
       SELECT a.month_start::text AS month,
              COUNT(DISTINCT a.patient_sk) FILTER (WHERE DATE_TRUNC('month', fr.first_date) = a.month_start)::int AS "newPatients",
              COUNT(DISTINCT a.patient_sk) FILTER (WHERE DATE_TRUNC('month', fr.first_date) < a.month_start)::int AS "returningPatients"
       FROM analytics_marts.appointments a JOIN firsts fr ON fr.patient_sk = a.patient_sk
       WHERE ${w.sql} AND NOT a.is_removed GROUP BY a.month_start ORDER BY a.month_start`, w.params);
    return {
      status,
      heatmap,
      weekly: weekly.map(withRates),
      byWeekday: byWeekday.map(withRates),
      leadTime: lead.map(({ sort, ...r }) => r),
      leadTimeNote: 'Lead time is only known for bookings first seen by the pipeline after its first run (the hospital tables do not record when a booking was made).',
      visitsPerPatient: visits.map(({ sort, ...r }) => ({ ...r, patients: suppress(r.patients) })),
      newReturning: newReturning.map(r => ({ ...r, newPatients: suppress(r.newPatients), returningPatients: suppress(r.returningPatients) })),
      minGroupSize: MIN_GROUP,
    };
  }

  async function dataQuality() {
    const [latest] = await query(
      `SELECT run_id, status, mode, started_at, finished_at FROM analytics_meta.pipeline_runs
       WHERE mode <> 'refresh-only' AND status <> 'running' ORDER BY run_id DESC LIMIT 1`);
    if (!latest) return { latest: null, rules: [], quarantine: [] };
    const rules = await query(
      `SELECT rule_name AS rule, dataset, severity, action, rows_evaluated AS evaluated, rows_failed AS failed,
              failure_pct::float AS "failurePct", passed, executed_at AS "executedAt", resolution_status AS resolution, description
       FROM analytics_meta.dq_results WHERE run_id = $1 ORDER BY passed, severity, rule_name`, [latest.run_id]);
    const quarantine = await query(
      `SELECT rule_name AS rule, COUNT(*)::int AS rows FROM analytics_meta.quarantine WHERE run_id = $1 GROUP BY rule_name`,
      [latest.run_id]);
    const trend = await query(
      `SELECT r.run_id AS "runId", r.started_at AS "startedAt", COUNT(*) FILTER (WHERE NOT q.passed)::int AS "failedRules"
       FROM analytics_meta.pipeline_runs r JOIN analytics_meta.dq_results q ON q.run_id = r.run_id
       GROUP BY r.run_id ORDER BY r.run_id DESC LIMIT 30`);
    return { latest, rules, quarantine, trend: trend.reverse() };
  }

  async function pipelineRuns(limit) {
    const runs = await query(
      `SELECT run_id AS "runId", pipeline_name AS pipeline, mode, trigger_type AS trigger, attempt, status,
              started_at AS "startedAt", finished_at AS "finishedAt",
              EXTRACT(EPOCH FROM (finished_at - started_at))::float AS seconds,
              source_rows AS "sourceRows", load_counts AS "loadCounts", dq_failed_rules AS "dqFailedRules",
              error_summary AS error
       FROM analytics_meta.pipeline_runs ORDER BY run_id DESC LIMIT $1`, [limit]);
    const steps = runs.length ? await query(
      `SELECT run_id AS "runId", step, status, rows_affected AS rows,
              EXTRACT(EPOCH FROM (finished_at - started_at))::float AS seconds
       FROM analytics_meta.run_steps WHERE run_id = ANY($1) ORDER BY started_at`, [runs.map(r => r.runId)]) : [];
    const freshness = await query('SELECT run_id, finished_at, hours_since_refresh FROM analytics_marts.data_freshness');
    const lineage = await query('SELECT target_object AS target, source_object AS source, transformation FROM analytics_meta.lineage ORDER BY 1, 2');
    return {
      runs: runs.map(r => ({ ...r, steps: steps.filter(s => s.runId === r.runId) })),
      freshness: freshness[0] || null,
      lineage,
    };
  }

  async function forecasts() {
    const models = await query(
      `SELECT DISTINCT ON (model_name) model_run_id AS id, model_name AS model, status, is_synthetic AS "isSynthetic",
              dataset_label AS dataset, dataset_version AS "datasetVersion", trained_at AS "trainedAt",
              train_rows AS "trainRows", test_rows AS "testRows", params, metrics, baseline_metrics AS "baselineMetrics",
              explanation, notes
       FROM analytics_ml.model_runs ORDER BY model_name, model_run_id DESC`);
    const demand = models.find(m => m.model === 'demand_forecast' && m.status === 'trained');
    const forecast = demand ? await query(
      `SELECT department_name AS department, week_start::text AS week, forecast::float, lower_80::float AS lower, upper_80::float AS upper
       FROM analytics_ml.demand_forecast WHERE model_run_id = $1 ORDER BY department_name, week_start`, [demand.id]) : [];
    const actuals = demand ? await query(
      `SELECT department_name AS department, week_start::text AS week, appointments
       FROM analytics_marts.weekly_department_demand
       WHERE week_start >= (SELECT MIN(week_start) FROM analytics_ml.demand_forecast WHERE model_run_id = $1) - 84
       ORDER BY department_name, week_start`, [demand.id]) : [];
    const seg = models.find(m => m.model === 'patient_segments' && m.status === 'trained');
    const segments = seg ? await query(
      `SELECT segment, label, patients, profile FROM analytics_ml.segment_profiles WHERE model_run_id = $1 ORDER BY segment`, [seg.id]) : [];
    return { models, forecast, actuals, segments: segments.map(s => ({ ...s, patients: suppress(s.patients) })) };
  }

  const withFilters = fn => route(async (req, res) => res.json(await fn(parseFilters(req.query), req)));
  api.get('/overview', withFilters(overview));
  api.get('/departments', withFilters(departments));
  api.get('/doctors', withFilters(doctors));
  api.get('/appointments', withFilters(flow));
  api.get('/data-quality', route(async (req, res) => res.json(await dataQuality())));
  api.get('/pipeline-runs', route(async (req, res) => {
    const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new FilterError('limit must be between 1 and 200', 'limit');
    res.json(await pipelineRuns(limit));
  }));
  api.get('/forecasts', route(async (req, res) => res.json(await forecasts())));
  // There is no billing data in the hospital database, so no financial figures are shown.
  // Revenue is deliberately not estimated from consultation fees or appointment counts.
  api.get('/financial', (req, res) => res.json({
    available: false,
    reason: 'The hospital database has no billing, payment or refund records. Revenue is not estimated from consultation fees or appointment counts, because a booked or completed appointment does not show what was billed or paid.',
    requiredData: ['invoices (amount billed, date, department)', 'payments (amount, date, method)', 'refunds', 'outstanding balances'],
  }));

  // ---------- CSV downloads ----------
  const EXPORTS = {
    'monthly-overview': async f => (await overview(f)).monthly,
    departments: async f => (await departments(f)).departments,
    doctors: async f => (await doctors(f)).doctors,
    'weekly-flow': async f => (await flow(f)).weekly,
    'status-distribution': async f => (await flow(f)).status,
    'data-quality': async () => (await dataQuality()).rules,
    'pipeline-runs': async () => (await pipelineRuns(200)).runs.map(({ steps, ...r }) => r),
    'demand-forecast': async () => (await forecasts()).forecast,
  };
  api.get('/export/:report', route(async (req, res) => {
    const make = Object.prototype.hasOwnProperty.call(EXPORTS, req.params.report) && EXPORTS[req.params.report];
    if (!make) return res.status(404).json({ error: 'Unknown report' });
    const rows = await make(parseFilters(req.query));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="hms-${req.params.report}.csv"`);
    return res.send(toCsv(rows));
  }));

  app.use('/analytics/api', api);
  app.use('/analytics/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof FilterError) return res.status(400).json({ error: err.message, field: err.field });
    if (err.code === '42P01' || err.code === '3F000') {
      return res.status(503).json({ error: 'The analytics tables are not set up yet. Run npm run db:init and npm run pipeline.' });
    }
    if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', '57P01', '57P03', '53300', '28P01'].includes(err.code)) {
      return res.status(503).json({ error: 'The analytics database cannot be reached right now.' });
    }
    console.error(JSON.stringify({ level: 'error', msg: 'request failed', path: req.path, code: err.code || '', error: String(err.message).split('\n')[0] }));
    return res.status(500).json({ error: 'Something went wrong while preparing this report.' });
  });

  return app;
}

module.exports = { createApp, MIN_GROUP };
