// Command line entry point:
//   npm run pipeline                    full extract and load
//   npm run pipeline:incremental        only new or changed appointments (falls back to full on the first run)
//   npm run validate                    extract and run the data quality rules without loading
//   npm run refresh                     recompute date-dependent statuses only
const { runPipeline } = require('./pipeline');
const { closePool } = require('../db');

function parseArgs(argv) {
  const args = { mode: 'full', trigger: 'manual' };
  for (const arg of argv) {
    if (arg === '--validate-only') args.mode = 'validate-only';
    else if (arg === '--refresh-only') args.mode = 'refresh-only';
    else if (arg.startsWith('--mode=')) args.mode = arg.slice(7);
    else if (arg.startsWith('--trigger=')) args.trigger = arg.slice(10);
    else throw new Error(`Unknown option ${arg}`);
  }
  return args;
}

if (require.main === module) {
  (async () => {
    try {
      const result = await runPipeline(parseArgs(process.argv.slice(2)));
      if (result.skipped) process.exitCode = 2;
      else {
        const failed = result.dqResults.filter(r => !r.passed);
        console.log(`\nRun ${result.runId}: ${result.status}`);
        console.log(`Rows read: ${JSON.stringify(result.sourceRows)}`);
        console.log(`Load: ${JSON.stringify(result.counts)}`);
        console.log(failed.length
          ? `Data quality: ${failed.length} rule(s) found problems: ${failed.map(r => `${r.rule_name} (${r.rows_failed})`).join(', ')}`
          : 'Data quality: all rules passed');
      }
    } catch (err) {
      console.error(`Pipeline failed: ${err.message}`);
      process.exitCode = 1;
    } finally {
      await closePool();
    }
  })();
}

module.exports = { parseArgs };
