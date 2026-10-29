// Runs the pipeline on a fixed interval (PIPELINE_SCHEDULE_MINUTES): an incremental load,
// with a full load once a day to re-check everything. Stop with Ctrl+C.
// On a server, Windows Task Scheduler or cron running "npm run pipeline" works just as well.
const config = require('../config');
const log = require('../logger');
const { runPipeline } = require('./pipeline');
const { closePool } = require('../db');

let lastFullDay = null;
let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  const today = new Date().toISOString().slice(0, 10);
  const mode = lastFullDay === today ? 'incremental' : 'full';
  try {
    const result = await runPipeline({ mode, trigger: 'scheduler' });
    if (!result.skipped && mode === 'full') lastFullDay = today;
  } catch (err) {
    log.error('scheduled run failed; will try again at the next interval', { mode, error: err.message });
  } finally {
    running = false;
  }
}

if (require.main === module) {
  log.info('scheduler started', { every_minutes: config.pipeline.scheduleMinutes });
  tick();
  timer = setInterval(tick, config.pipeline.scheduleMinutes * 60 * 1000);
  const stop = async () => {
    clearInterval(timer);
    log.info('scheduler stopping');
    while (running) await new Promise(r => setTimeout(r, 200));
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

module.exports = { tick };
