// Creates or updates the analytics schemas (safe to run again). Run as hms_analytics:
//   npm run db:init
// It only touches analytics_* schemas. The one-time role and grant setup is
// sql/setup/00_roles_and_grants.sql, which a database administrator runs.
const fs = require('fs');
const path = require('path');
const { getPool, closePool } = require('../db');
const { LINEAGE } = require('./lineage');

const SCHEMA_DIR = path.join(__dirname, '..', '..', 'sql', 'schema');

async function initDatabase(db = getPool()) {
  const files = fs.readdirSync(SCHEMA_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    await db.query(fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8'));
  }
  for (const [target, src, how] of LINEAGE) {
    await db.query(
      `INSERT INTO analytics_meta.lineage (target_object, source_object, transformation) VALUES ($1, $2, $3)
       ON CONFLICT (target_object, source_object) DO UPDATE SET transformation = EXCLUDED.transformation`,
      [target, src, how]);
  }
  const { rows } = await db.query('SELECT 1 FROM analytics_meta.dataset_info');
  if (!rows.length) {
    await db.query(
      `INSERT INTO analytics_meta.dataset_info (is_synthetic, label, notes)
       VALUES (FALSE, 'Hospital data', 'Read from the hospital tables in this database.')`);
  }
  return files;
}

if (require.main === module) {
  initDatabase()
    .then(files => console.log(`Analytics schemas are ready (${files.join(', ')}).`))
    .catch(err => { console.error(`Could not set up the analytics schemas: ${err.message}`); process.exitCode = 1; })
    .finally(closePool);
}

module.exports = { initDatabase };
