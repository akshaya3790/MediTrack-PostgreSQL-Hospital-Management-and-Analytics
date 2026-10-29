// Regression proof for the hospital database. Runs against a database set up exactly like the real
// one (hospital tables + sql/setup/00_roles_and_grants.sql), named by ANALYTICS_REGRESSION_DB_NAME.
// It takes a fingerprint of the public schema (tables, columns, types, defaults, constraints,
// indexes, triggers) and of every readable value, runs the whole pipeline, and checks that the
// fingerprint is identical afterwards. It also checks the analytics role cannot change hospital tables.
const test = require('node:test');
const assert = require('node:assert/strict');

const DB = process.env.ANALYTICS_REGRESSION_DB_NAME;
if (DB) {
  process.env.ANALYTICS_DB_NAME = DB;
  process.env.ANALYTICS_PSEUDONYM_KEY = process.env.ANALYTICS_PSEUDONYM_KEY || 'test-only-pseudonym-key-0123456789';
  process.env.ANALYTICS_QUIET = '1';
}
const SKIP = DB ? false : 'set ANALYTICS_REGRESSION_DB_NAME to a copy of the hospital database with the analytics grants applied';
const { getPool, closePool } = require('../src/db');

async function fingerprint(pool) {
  const q = async sql => (await pool.query(sql)).rows;
  const structure = await q(`
    SELECT 'column' AS kind, table_name || '.' || column_name AS name,
           concat_ws('|', data_type, character_maximum_length, is_nullable, column_default, ordinal_position) AS def
    FROM information_schema.columns WHERE table_schema = 'public'
    UNION ALL
    SELECT 'constraint', conrelid::regclass::text || '.' || conname, pg_get_constraintdef(oid)
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace
    UNION ALL
    SELECT 'index', indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
    UNION ALL
    SELECT 'trigger', tgrelid::regclass::text || '.' || tgname, pg_get_triggerdef(oid)
    FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text NOT LIKE 'analytics_%'
    UNION ALL
    SELECT 'table', c.relname, c.relkind::text FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
    ORDER BY 1, 2`);
  const readable = await q(`
    SELECT table_name, string_agg(format('%I', column_name), ', ' ORDER BY column_name) AS cols
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND has_column_privilege(format('public.%I', table_name), column_name, 'SELECT')
    GROUP BY table_name ORDER BY table_name`);
  const contents = {};
  for (const { table_name: t, cols } of readable) {
    const [r] = await q(`SELECT COUNT(*)::int AS n, md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) AS h
                         FROM (SELECT ${cols} FROM public.${t}) x`);
    contents[t] = r;
  }
  return { structure, contents };
}

test('the hospital database is unchanged by the analytics platform', { skip: SKIP }, async t => {
  const pool = getPool();
  const { initDatabase } = require('../src/tools/init-db');
  const { runPipeline } = require('../src/pipeline/pipeline');
  t.after(closePool);

  await t.test('the analytics role has no write access to hospital tables', async () => {
    const { rows } = await pool.query(`
      SELECT c.relname, p.priv
      FROM pg_class c CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(priv)
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v', 'm', 'p')
        AND has_table_privilege(c.oid, p.priv)`);
    assert.deepEqual(rows, [], 'no write privileges on any public table');
    const { rows: [s] } = await pool.query("SELECT has_schema_privilege('public', 'CREATE') AS can_create");
    const { rows: [owner] } = await pool.query("SELECT pg_get_userbyid(nspowner) = current_user AS owns FROM pg_namespace WHERE nspname = 'public'");
    assert.equal(s.can_create && !owner.owns, false, 'cannot create objects in the public schema');
  });

  await t.test('schema and data fingerprint is identical after full, incremental, validate and refresh runs', async () => {
    const before = await fingerprint(pool);
    assert.ok(Object.keys(before.contents).length >= 5, 'the hospital tables are readable');
    await initDatabase(pool);
    for (const mode of ['full', 'incremental', 'validate-only', 'refresh-only', 'full']) {
      const r = await runPipeline({ mode, maxRetries: 0 });
      assert.notEqual(r.status, 'failed', mode);
    }
    const after = await fingerprint(pool);
    assert.deepEqual(after.structure, before.structure);
    assert.deepEqual(after.contents, before.contents);
  });
});
