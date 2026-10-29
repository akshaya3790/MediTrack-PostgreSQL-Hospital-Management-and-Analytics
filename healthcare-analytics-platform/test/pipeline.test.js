// Pipeline tests on a throwaway *_test database filled with synthetic hospital data
const test = require('node:test');
const assert = require('node:assert/strict');
const { useTestDatabase, resetTestDatabase, SKIP } = require('./helpers/env');

const enabled = useTestDatabase();
const { getPool, closePool } = require('../src/db');

let pool;
const count = async sql => Number((await pool.query(sql)).rows[0].count);

test('pipeline', { skip: SKIP }, async t => {
  const { generate, advance } = require('../src/tools/synthetic');
  const { initDatabase } = require('../src/tools/init-db');
  const { runPipeline } = require('../src/pipeline/pipeline');
  pool = getPool();
  await resetTestDatabase(pool);
  await generate({ seed: 11, days: 120, ahead: 14, patients: 150 });
  await initDatabase(pool);

  await t.test('a full run loads every source appointment and reconciles', async () => {
    const r = await runPipeline({ mode: 'full', maxRetries: 0 });
    assert.equal(r.status, 'succeeded');
    const source = await count('SELECT COUNT(*) FROM appointment');
    assert.equal(r.counts.inserted, source);
    assert.equal(await count('SELECT COUNT(*) FROM analytics_warehouse.fact_appointment WHERE NOT is_removed'), source);
    assert.equal(await count(`SELECT COUNT(*) FROM analytics_meta.dq_results WHERE run_id = ${r.runId}
      AND rule_name = 'source_to_target_reconciliation' AND passed`), 1);
  });

  await t.test('running the same full load again changes nothing (idempotent)', async () => {
    const before = (await pool.query('SELECT md5(string_agg(row_hash || is_removed::text, \',\' ORDER BY appointment_id)) AS h FROM analytics_warehouse.fact_appointment')).rows[0].h;
    const r = await runPipeline({ mode: 'full', maxRetries: 0 });
    assert.equal(r.counts.inserted, 0);
    assert.equal(r.counts.updated, 0);
    assert.equal(r.counts.removed, 0);
    const after = (await pool.query('SELECT md5(string_agg(row_hash || is_removed::text, \',\' ORDER BY appointment_id)) AS h FROM analytics_warehouse.fact_appointment')).rows[0].h;
    assert.equal(after, before);
  });

  await t.test('an incremental run picks up exactly the new, changed and deleted appointments', async () => {
    const activity = await advance({ seed: 3, cancellations: 5, bookings: 10 });
    const r = await runPipeline({ mode: 'incremental', maxRetries: 0 });
    assert.equal(r.status, 'succeeded');
    assert.equal(r.counts.inserted, activity.booked);
    assert.equal(r.counts.removed, activity.cancelled);
    assert.ok(r.counts.updated >= activity.completed);
    assert.equal(await count('SELECT COUNT(*) FROM analytics_warehouse.fact_appointment WHERE NOT is_removed'),
      await count('SELECT COUNT(*) FROM appointment'));
    const again = await runPipeline({ mode: 'incremental', maxRetries: 0 });
    assert.deepEqual([again.counts.inserted, again.counts.updated, again.counts.removed], [0, 0, 0]);
  });

  await t.test('a bad source row is quarantined, kept out of the warehouse and stored pseudonymised', async () => {
    // Only possible in this throwaway database: drop the time check so a bad row can exist
    const { rows: [c] } = await pool.query(`SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.appointment'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%starttime < endtime%'`);
    await pool.query(`ALTER TABLE appointment DROP CONSTRAINT ${c.conname}`);
    const { rows: [bad] } = await pool.query(`INSERT INTO appointment (doctor, date, starttime, endtime, status)
      SELECT email, CURRENT_DATE + 3, '23:00', '22:00', 'NotDone' FROM doctor LIMIT 1 RETURNING id`);
    const r = await runPipeline({ mode: 'incremental', maxRetries: 0 });
    assert.equal(r.counts.rejected, 1);
    assert.equal(await count(`SELECT COUNT(*) FROM analytics_warehouse.fact_appointment WHERE appointment_id = ${bad.id}`), 0);
    const q = (await pool.query(`SELECT rule_name, payload::text AS p FROM analytics_meta.quarantine WHERE run_id = ${r.runId}`)).rows;
    assert.equal(q.length, 1);
    assert.equal(q[0].rule_name, 'appointment_invalid_time_range');
    assert.doesNotMatch(q[0].p, /@/, 'no email addresses in the quarantine copy');
  });

  await t.test('a failed run leaves the warehouse untouched and is recorded', async () => {
    const before = await count('SELECT COUNT(*) FROM analytics_warehouse.fact_appointment');
    await pool.query('ALTER TABLE analytics_warehouse.fact_appointment ADD CONSTRAINT test_block CHECK (appointment_id < 0) NOT VALID');
    await pool.query(`INSERT INTO appointment (doctor, date, starttime, endtime, status)
      SELECT email, CURRENT_DATE + 5, '06:00', '07:00', 'NotDone' FROM doctor LIMIT 1`);
    await assert.rejects(runPipeline({ mode: 'incremental', maxRetries: 0 }));
    await pool.query('ALTER TABLE analytics_warehouse.fact_appointment DROP CONSTRAINT test_block');
    assert.equal(await count('SELECT COUNT(*) FROM analytics_warehouse.fact_appointment'), before);
    const { rows: [last] } = await pool.query('SELECT status, error_summary FROM analytics_meta.pipeline_runs ORDER BY run_id DESC LIMIT 1');
    assert.equal(last.status, 'failed');
    assert.match(last.error_summary, /23514/);
    const ok = await runPipeline({ mode: 'incremental', maxRetries: 0 });
    assert.equal(ok.counts.inserted, 1, 'the next run catches up');
  });

  await t.test('patients appear only as keyed hashes in the warehouse', async () => {
    assert.equal(await count("SELECT COUNT(*) FROM analytics_warehouse.dim_patient WHERE patient_key !~ '^pat_[0-9a-f]{24}$'"), 0);
    assert.equal(await count("SELECT COUNT(*) FROM analytics_raw.appointment_patient WHERE patient_key LIKE '%@%'"), 0);
  });

  await t.test('two runs at once: the second one steps aside', async () => {
    const [a, b] = await Promise.all([runPipeline({ mode: 'incremental', maxRetries: 0 }), runPipeline({ mode: 'incremental', maxRetries: 0 })]);
    assert.equal([a, b].filter(r => r.skipped).length, 1);
  });
});

test.after(async () => { if (enabled) await closePool(); });
