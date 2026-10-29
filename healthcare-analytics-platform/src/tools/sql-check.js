// Runs every query in sql/analysis read-only, with EXPLAIN (ANALYZE, BUFFERS), and writes the plans
// and timings to docs/sql-plans/. Use it to confirm the analyses run and to spot slow ones.
//   npm run sql:check
const fs = require('fs');
const path = require('path');
const { withTransaction, closePool } = require('../db');

const ANALYSIS_DIR = path.join(__dirname, '..', '..', 'sql', 'analysis');
const OUT_DIR = path.join(__dirname, '..', '..', 'docs', 'sql-plans');

async function checkQuery(client, sql) {
  const started = process.hrtime.bigint();
  const result = await client.query(sql);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const plan = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql.replace(/;\s*$/, '')}`);
  return { rows: result.rows.length, columns: result.fields.map(f => f.name), sample: result.rows.slice(0, 3), ms,
    plan: plan.rows.map(r => r['QUERY PLAN']).join('\n') };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const files = fs.readdirSync(ANALYSIS_DIR).filter(f => f.endsWith('.sql')).sort();
  const summary = [];
  let failed = 0;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(ANALYSIS_DIR, file), 'utf8');
    try {
      const r = await withTransaction(client => checkQuery(client, sql), { readOnly: true });
      const execution = (r.plan.match(/Execution Time: ([\d.]+) ms/) || [])[1];
      summary.push({ file, rows: r.rows, ms: r.ms, execution });
      fs.writeFileSync(path.join(OUT_DIR, file.replace(/\.sql$/, '.md')),
        `# ${file}\n\nRows returned: ${r.rows}. Columns: ${r.columns.join(', ')}.\n\n` +
        `Measured on ${new Date().toISOString().slice(0, 10)} against the database in ANALYTICS_DB_NAME.\n\n` +
        '```text\n' + r.plan + '\n```\n');
      console.log(`ok     ${file}  ${r.rows} rows  ${r.ms.toFixed(0)} ms`);
    } catch (err) {
      failed += 1;
      summary.push({ file, error: err.message });
      console.log(`FAILED ${file}  ${err.message}`);
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'README.md'),
    '# Query plans for the SQL analyses\n\nProduced by `npm run sql:check` (EXPLAIN ANALYZE, read-only).\n\n' +
    '| Query | Rows | Execution time (ms) |\n|---|---:|---:|\n' +
    summary.map(s => (s.error ? `| ${s.file} | failed: ${s.error} | |` : `| [${s.file}](${s.file.replace(/\.sql$/, '.md')}) | ${s.rows} | ${s.execution} |`)).join('\n') + '\n');
  if (failed) process.exitCode = 1;
}

if (require.main === module) main().catch(err => { console.error(err.message); process.exitCode = 1; }).finally(closePool);

module.exports = { checkQuery };
