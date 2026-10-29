// Test settings. Database tests run only when ANALYTICS_TEST_DB_NAME names a throwaway database
// ending in _test that the analytics role owns; they wipe and rebuild it. Never point it at the hospital database.
const TEST_DB = process.env.ANALYTICS_TEST_DB_NAME;

function useTestDatabase() {
  if (!TEST_DB) return false;
  if (!/_test$/.test(TEST_DB)) throw new Error('ANALYTICS_TEST_DB_NAME must end in _test');
  process.env.ANALYTICS_DB_NAME = TEST_DB;
  process.env.ANALYTICS_PSEUDONYM_KEY = process.env.ANALYTICS_PSEUDONYM_KEY || 'test-only-pseudonym-key-0123456789';
  process.env.ANALYTICS_QUIET = '1';
  process.env.PIPELINE_RETRY_DELAY_MS = '10';
  return true;
}

const SKIP = TEST_DB ? false : 'set ANALYTICS_TEST_DB_NAME to a throwaway *_test database to run database tests';

// Empties the throwaway test database: hospital tables (synthetic) and analytics schemas
async function resetTestDatabase(pool) {
  const { rows } = await pool.query('SELECT current_database() AS db');
  if (!/_test$/.test(rows[0].db)) throw new Error(`refusing to reset ${rows[0].db}`);
  await pool.query(`DROP SCHEMA IF EXISTS analytics_meta, analytics_raw, analytics_staging, analytics_warehouse,
                    analytics_marts, analytics_ml CASCADE`);
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
}

module.exports = { useTestDatabase, resetTestDatabase, SKIP };
