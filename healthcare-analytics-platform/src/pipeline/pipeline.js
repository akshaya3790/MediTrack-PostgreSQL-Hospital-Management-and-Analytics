// Runs the pipeline: extract -> raw -> staging -> data quality -> warehouse -> post-load checks.
//
// * The source is read inside one REPEATABLE READ, READ ONLY transaction, so every table comes
//   from the same moment and the hospital tables cannot be written by mistake.
// * Everything the run writes (raw, staging, quality results, warehouse) happens in a single
//   transaction: a failed run leaves the warehouse exactly as it was, so retrying is safe.
// * Only one run at a time: a PostgreSQL advisory lock is held for the whole run.
const config = require('../config');
const { getPool, withTransaction } = require('../db');
const log = require('../logger');
const { makePseudonymizer } = require('../pseudonymize');
const source = require('./source');
const staging = require('./staging');
const quality = require('./quality');
const warehouse = require('./warehouse');

const PIPELINE_NAME = 'hms_appointments';
const LOCK_KEY = 'hms_analytics_pipeline';
const TRANSIENT = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', '57P01', '57P02', '57P03', '53300', '40001', '40P01', '08006', '08001']);

const isTransient = err => TRANSIENT.has(err && err.code);
// Error text kept in the run history: the message and code only, never row values
const summarize = err => `${err.code ? `[${err.code}] ` : ''}${String(err.message || err).split('\n')[0].slice(0, 300)}`;

async function startStep(runId, step) {
  await getPool().query(
    `INSERT INTO analytics_meta.run_steps (run_id, step, status) VALUES ($1, $2, 'running')
     ON CONFLICT (run_id, step) DO UPDATE SET status = 'running', started_at = NOW(), finished_at = NULL`, [runId, step]);
  log.info('step started', { run_id: runId, step });
}

async function endStep(runId, step, status, rows = null, detail = {}) {
  await getPool().query(
    `UPDATE analytics_meta.run_steps SET status = $3, finished_at = NOW(), rows_affected = $4, detail = $5
     WHERE run_id = $1 AND step = $2`, [runId, step, status, rows, detail]);
  log.info('step finished', { run_id: runId, step, status, rows });
}

// Compares the columns the pipeline can read with the ones seen on the first run
async function checkSourceSchema(db) {
  const columns = await source.readableColumns(db);
  const caps = source.capabilities(columns);
  const { rows: baseline } = await db.query('SELECT table_name, column_name, data_type FROM analytics_meta.source_schema_baseline');
  const problems = [];
  if (baseline.length) {
    for (const b of baseline) {
      const now = columns[b.table_name] && columns[b.table_name][b.column_name];
      if (!now) problems.push(`${b.table_name}.${b.column_name} is no longer readable`);
      else if (now !== b.data_type) problems.push(`${b.table_name}.${b.column_name} changed type from ${b.data_type} to ${now}`);
    }
  }
  for (const m of caps.missing) problems.push(`${m} is required but not readable`);
  const added = baseline.length
    ? Object.entries(columns).flatMap(([t, cols]) => Object.keys(cols)
      .filter(c => !baseline.some(b => b.table_name === t && b.column_name === c)).map(c => `${t}.${c}`))
    : [];
  return { caps, columns, problems, added, baselineCount: baseline.length };
}

// Stores the columns seen on the first run as the expected source schema
async function captureSchemaBaseline(client, columns) {
  const entries = Object.entries(columns).flatMap(([t, cols]) => Object.entries(cols).map(([c, type]) => [t, c, type]));
  await client.query(
    `INSERT INTO analytics_meta.source_schema_baseline (table_name, column_name, data_type)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[]) ON CONFLICT DO NOTHING`,
    [entries.map(e => e[0]), entries.map(e => e[1]), entries.map(e => e[2])]);
  return entries.length;
}

async function recordSchemaResult(db, runId, evaluated, problems, added) {
  const description = `The source columns the pipeline reads still exist with the same types.${
    added.length ? ` New columns (not used): ${added.join(', ')}.` : ''}`;
  await db.query(
    `INSERT INTO analytics_meta.dq_results
       (run_id, rule_name, dataset, severity, action, rows_evaluated, rows_failed, failure_pct, passed, description, resolution_status)
     VALUES ($1, 'unexpected_schema_change', 'source_schema', 'error', 'block', $2, $3, $4, $5, $6, $7)
     ON CONFLICT (run_id, rule_name) DO NOTHING`,
    [runId, evaluated, problems.length, evaluated ? Math.round((problems.length / evaluated) * 10000) / 100 : 0,
      problems.length === 0, description, problems.length ? 'open' : 'not_applicable']);
}

async function previousSuccess() {
  const { rows } = await getPool().query(
    `SELECT MIN(started_at) AS first_started, MAX(finished_at) AS last_finished, COUNT(*)::int AS runs
     FROM analytics_meta.pipeline_runs
     WHERE status IN ('succeeded', 'succeeded_with_warnings') AND mode IN ('full', 'incremental')`);
  return rows[0];
}

async function runOnce({ mode, trigger, attempt, params }) {
  const pool = getPool();
  const pseudo = mode === 'refresh-only' ? null : makePseudonymizer(config.pseudonymKey);
  const { rows: [run] } = await pool.query(
    `INSERT INTO analytics_meta.pipeline_runs (pipeline_name, mode, trigger_type, attempt, status, params)
     VALUES ($1, $2, $3, $4, 'running', $5) RETURNING run_id, started_at`,
    [PIPELINE_NAME, mode, trigger, attempt, params]);
  const runId = Number(run.run_id);
  const runStartedAt = run.started_at;
  log.info('run started', { run_id: runId, mode, trigger, attempt });

  const counts = {};
  let sourceRows = {};
  let dqResults = [];
  let currentStep = null;
  try {
    const prior = await previousSuccess();
    const initialLoad = prior.runs === 0;
    const firstRunDate = initialLoad ? runStartedAt : prior.first_started;

    if (mode === 'refresh-only') {
      currentStep = 'refresh';
      await startStep(runId, currentStep);
      const refreshed = await withTransaction(c => warehouse.refreshStatuses(c));
      counts.status_refreshed = refreshed;
      await endStep(runId, currentStep, 'succeeded', refreshed);
    } else {
      // 1. Source schema check and extraction, in one read-only snapshot
      currentStep = 'extract';
      await startStep(runId, currentStep);
      const extracted = await withTransaction(async src => {
        const schema = await checkSourceSchema(src);
        if (schema.problems.length) {
          const err = new Error(`Source schema changed: ${schema.problems.join('; ')}`);
          err.schema = schema;
          throw err;
        }
        let ids = null;
        let sourceIds;
        if (mode === 'incremental' && !initialLoad) {
          const versions = await source.scanAppointmentVersions(src);
          sourceIds = versions.map(v => Number(v.id));
          const { rows: known } = await pool.query(
            'SELECT appointment_id, row_hash FROM analytics_warehouse.fact_appointment WHERE NOT is_removed');
          const knownHash = new Map(known.map(k => [k.appointment_id, k.row_hash]));
          ids = versions.filter(v => knownHash.get(Number(v.id)) !== v.version_hash).map(v => Number(v.id));
        }
        const data = await source.extract(src, schema.caps, pseudo, { appointmentIds: ids });
        if (!sourceIds) sourceIds = data.appointment.map(a => Number(a.appointment_id));
        return { data, schema, sourceIds, changedOnly: ids !== null };
      }, { readOnly: true, isolation: 'REPEATABLE READ' });
      sourceRows = Object.fromEntries(Object.entries(extracted.data).map(([k, v]) => [k, v.length]));
      sourceRows.appointment_ids_in_source = extracted.sourceIds.length;
      await endStep(runId, currentStep, 'succeeded', extracted.data.appointment.length, {
        changed_only: extracted.changedOnly, baseline_captured: extracted.schema.baselineCount === 0,
        new_source_columns: extracted.schema.added,
      });

      // 2. Everything else in one transaction
      await withTransaction(async client => {
        await client.query('CREATE TEMP TABLE source_ids (id INT PRIMARY KEY) ON COMMIT DROP');
        await client.query('INSERT INTO pg_temp.source_ids SELECT DISTINCT unnest($1::int[])', [extracted.sourceIds]);

        const schemaColumns = extracted.schema.baselineCount
          || await captureSchemaBaseline(client, extracted.schema.columns);
        await recordSchemaResult(client, runId, schemaColumns, [], extracted.schema.added);

        currentStep = 'raw_and_staging';
        await startStep(runId, currentStep);
        await staging.loadRaw(client, runId, extracted.data);
        await staging.buildStaging(client, runId, extracted.schema.caps);
        const staged = Number((await client.query('SELECT COUNT(*) FROM analytics_staging.appointment')).rows[0].count);
        await endStep(runId, currentStep, 'succeeded', staged);

        currentStep = 'data_quality';
        await startStep(runId, currentStep);
        dqResults = await quality.runRules(client, runId, quality.preLoadRules(config.pipeline.freshnessHours, runId));
        const quarantined = Number((await client.query(
          "SELECT COUNT(*) FROM analytics_staging.appointment WHERE dq_status = 'quarantined'")).rows[0].count);
        counts.rejected = quarantined;
        await endStep(runId, currentStep, 'succeeded', quarantined, { failed_rules: dqResults.filter(r => !r.passed).map(r => r.rule_name) });

        if (mode === 'validate-only') return;

        currentStep = 'warehouse_load';
        await startStep(runId, currentStep);
        await warehouse.ensureDates(client, config.pipeline.capacityDaysAhead);
        counts.departments_changed = await warehouse.loadDepartments(client, runId);
        const doctors = await warehouse.loadDoctors(client, runId, runStartedAt);
        counts.doctor_versions_closed = doctors.closed;
        counts.doctor_versions_added = doctors.inserted;
        counts.patients_added = await warehouse.loadPatients(client, runId);
        const facts = await warehouse.loadAppointments(client, runId, runStartedAt, { initialLoad, detectRemovals: true });
        Object.assign(counts, facts);
        counts.unchanged = Math.max(0, extracted.sourceIds.length - facts.inserted - facts.updated - quarantined);
        counts.status_refreshed = await warehouse.refreshStatuses(client);
        counts.capacity_rows_written = await warehouse.loadCapacity(client, runId, config.pipeline.capacityDaysAhead, firstRunDate);
        await endStep(runId, currentStep, 'succeeded', facts.inserted + facts.updated + facts.removed, counts);

        currentStep = 'post_load_checks';
        await startStep(runId, currentStep);
        const post = await quality.runRules(client, runId, quality.POST_LOAD_RULES);
        dqResults = dqResults.concat(post);
        await endStep(runId, currentStep, 'succeeded', post.filter(r => !r.passed).length);

        await client.query(
          `INSERT INTO analytics_meta.watermarks (source_table, max_id, row_count, run_id, updated_at)
           VALUES ('appointment', (SELECT MAX(id) FROM pg_temp.source_ids), (SELECT COUNT(*) FROM pg_temp.source_ids), $1, NOW())
           ON CONFLICT (source_table) DO UPDATE SET max_id = EXCLUDED.max_id, row_count = EXCLUDED.row_count,
             run_id = EXCLUDED.run_id, updated_at = EXCLUDED.updated_at`, [runId]);
      });
    }

    const failedErrors = dqResults.filter(r => !r.passed && r.severity === 'error').length;
    const failedAny = dqResults.filter(r => !r.passed).length;
    const status = failedErrors ? 'succeeded_with_warnings' : 'succeeded';
    await pool.query(
      `UPDATE analytics_meta.pipeline_runs SET status = $2, finished_at = NOW(), source_rows = $3, load_counts = $4,
         dq_failed_rules = $5 WHERE run_id = $1`, [runId, status, sourceRows, counts, failedAny]);
    log.info('run finished', { run_id: runId, status, counts, dq_failed_rules: failedAny });
    return { runId, status, counts, sourceRows, dqResults };
  } catch (err) {
    if (err.schema) {
      await recordSchemaResult(pool, runId, err.schema.baselineCount, err.schema.problems, err.schema.added).catch(() => {});
    }
    if (currentStep) await endStep(runId, currentStep, 'failed', null, { error: summarize(err) }).catch(() => {});
    await pool.query(
      `UPDATE analytics_meta.pipeline_runs SET status = 'failed', finished_at = NOW(), source_rows = $2, error_summary = $3
       WHERE run_id = $1`, [runId, sourceRows, summarize(err)]).catch(() => {});
    log.error('run failed', { run_id: runId, step: currentStep, error: summarize(err) });
    err.runId = runId;
    throw err;
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Runs the pipeline with retries for temporary failures (lost connection, deadlock, ...).
// Returns { skipped: true } if another run holds the lock.
async function runPipeline({ mode = 'full', trigger = 'manual', maxRetries = config.pipeline.maxRetries,
  retryDelayMs = config.pipeline.retryDelayMs } = {}) {
  if (!['full', 'incremental', 'validate-only', 'refresh-only'].includes(mode)) throw new Error(`Unknown mode "${mode}"`);
  const lockClient = await getPool().connect();
  try {
    const { rows } = await lockClient.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [LOCK_KEY]);
    if (!rows[0].ok) {
      log.warn('another pipeline run is in progress; skipping', { mode });
      return { skipped: true };
    }
    const params = { mode, capacity_days_ahead: config.pipeline.capacityDaysAhead, max_retries: maxRetries };
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await runOnce({ mode, trigger, attempt, params });
      } catch (err) {
        if (!isTransient(err) || attempt > maxRetries) throw err;
        const wait = retryDelayMs * 2 ** (attempt - 1);
        log.warn('temporary failure, retrying', { attempt, wait_ms: wait, error: summarize(err) });
        await sleep(wait);
      }
    }
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]).catch(() => {});
    lockClient.release();
  }
}

module.exports = { runPipeline, PIPELINE_NAME, summarize, isTransient };
