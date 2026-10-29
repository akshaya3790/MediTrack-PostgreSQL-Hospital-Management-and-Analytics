// Starts the analytics dashboard and API:  npm start  ->  http://localhost:3002/analytics
const config = require('../config');
const { getPool } = require('../db');
const { createApp } = require('./app');
const log = require('../logger');

// Analytics connections can only read
const pool = getPool({ options: '-c default_transaction_read_only=on' });
const signInUrl = `${config.hmsAppUrl.replace(/\/$/, '')}/admin/login`;
const app = createApp({ pool, sessionSecret: config.sessionSecret, signInUrl });

app.listen(config.port, () => {
  log.info('analytics dashboard running', { url: `http://localhost:${config.port}/analytics` });
});
