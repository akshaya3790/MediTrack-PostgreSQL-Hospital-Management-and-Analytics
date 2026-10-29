// API tests: access control, validation, aggregated-only output and CSV, on a throwaway *_test database
const test = require('node:test');
const assert = require('node:assert/strict');
const signature = require('cookie-signature');
const { useTestDatabase, resetTestDatabase, SKIP } = require('./helpers/env');

const enabled = useTestDatabase();
const { getPool, closePool } = require('../src/db');

const SECRET = 'test-session-secret';
const cookieFor = sid => `hms.sid=${encodeURIComponent(`s:${signature.sign(sid, SECRET)}`)}`;

test('analytics API', { skip: SKIP }, async t => {
  const { generate } = require('../src/tools/synthetic');
  const { initDatabase } = require('../src/tools/init-db');
  const { runPipeline } = require('../src/pipeline/pipeline');
  const { createApp } = require('../src/server/app');
  const pool = getPool();
  await resetTestDatabase(pool);
  await generate({ seed: 5, days: 90, ahead: 14, patients: 120 });
  await initDatabase(pool);
  await runPipeline({ mode: 'full', maxRetries: 0 });
  const sessions = [['adm1', 'adm'], ['doc1', 'doc'], ['pat1', 'pat']];
  for (const [sid, who] of sessions) {
    await pool.query(`INSERT INTO session (sid, sess, expire) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [sid, { cookie: {}, user: { who, email: `${sid}@example.invalid` } }]);
  }
  await pool.query(`INSERT INTO session (sid, sess, expire) VALUES ('old', $1, NOW() - INTERVAL '1 hour')`,
    [{ cookie: {}, user: { who: 'adm' } }]);

  const server = createApp({ pool, sessionSecret: SECRET, signInUrl: 'http://localhost:3000/admin' }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, cookie) => fetch(base + path, { headers: cookie ? { cookie } : {} });
  t.after(() => server.close());

  await t.test('health check is public and reveals no data', async () => {
    const res = await get('/analytics/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(await res.json()).sort(), ['database', 'lastRefreshHoursAgo', 'status']);
  });

  await t.test('only signed-in administrators get data', async () => {
    assert.equal((await get('/analytics/api/overview')).status, 401);
    assert.equal((await get('/analytics/api/overview', `hms.sid=${encodeURIComponent('s:adm1.forged')}`)).status, 401);
    assert.equal((await get('/analytics/api/overview', cookieFor('old'))).status, 401, 'expired session');
    assert.equal((await get('/analytics/api/overview', cookieFor('pat1'))).status, 403);
    assert.equal((await get('/analytics/api/overview', cookieFor('doc1'))).status, 403);
    const ok = await get('/analytics/api/overview', cookieFor('adm1'));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    const body = await (await get('/analytics/api/overview', cookieFor('adm1'))).json();
    const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM appointment
      WHERE date BETWEEN CURRENT_DATE - 365 AND CURRENT_DATE + 28`)).rows[0].n;
    assert.equal(body.kpis.appointments, total, 'overview total matches the hospital table');
  });

  await t.test('bad filters get a 400 with a readable message', async () => {
    const res = await get('/analytics/api/overview?from=2026-13-01', cookieFor('adm1'));
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /date/);
    assert.equal((await get("/analytics/api/doctors?doctor=x'--", cookieFor('adm1'))).status, 400);
    assert.equal((await get('/analytics/api/pipeline-runs?limit=999', cookieFor('adm1'))).status, 400);
  });

  await t.test('responses are aggregated: no emails, patient keys or appointment ids', async () => {
    const pages = ['overview', 'departments', 'doctors', 'appointments', 'data-quality', 'pipeline-runs', 'forecasts', 'filters', 'kpis', 'me'];
    for (const page of pages) {
      const text = await (await get(`/analytics/api/${page}`, cookieFor('adm1'))).text();
      assert.doesNotMatch(text, /@/, `${page} has no email addresses`);
      assert.doesNotMatch(text, /pat_[0-9a-f]{8}/, `${page} has no patient keys`);
      assert.doesNotMatch(text, /"(appointment_?id|patient_?sk|patientKey)"/i, `${page} has no row identifiers`);
    }
  });

  await t.test('small patient groups are hidden', async () => {
    const body = await (await get('/analytics/api/appointments', cookieFor('adm1'))).json();
    for (const row of body.visitsPerPatient) assert.ok(row.patients === null || row.patients >= 5);
    for (const row of body.newReturning) {
      for (const v of [row.newPatients, row.returningPatients]) assert.ok(v === null || v >= 5);
    }
  });

  await t.test('CSV export works for each report and refuses unknown ones', async () => {
    const res = await get('/analytics/api/export/departments', cookieFor('adm1'));
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /hms-departments\.csv/);
    assert.match((await res.text()).split('\r\n')[0], /^id,name,/);
    assert.equal((await get('/analytics/api/export/__proto__', cookieFor('adm1'))).status, 404);
    assert.equal((await get('/analytics/api/export/departments')).status, 401);
  });

  await t.test('no billing data means no financial figures', async () => {
    const body = await (await get('/analytics/api/financial', cookieFor('adm1'))).json();
    assert.equal(body.available, false);
  });

  await t.test('the API cannot write: its queries run read-only', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await assert.rejects(client.query('DELETE FROM analytics_meta.lineage'), /read-only/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

test.after(async () => { if (enabled) await closePool(); });
