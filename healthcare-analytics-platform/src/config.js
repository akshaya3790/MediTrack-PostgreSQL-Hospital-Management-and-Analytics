// Settings for the analytics platform, read from healthcare-analytics-platform/.env
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const int = (name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number between ${min} and ${max}`);
  }
  return value;
};

const config = {
  db: {
    host: process.env.ANALYTICS_DB_HOST || 'localhost',
    port: int('ANALYTICS_DB_PORT', 5432, { min: 1, max: 65535 }),
    database: process.env.ANALYTICS_DB_NAME || 'hms',
    user: process.env.ANALYTICS_DB_USER || 'hms_analytics',
    password: process.env.ANALYTICS_DB_PASSWORD || undefined,
  },
  pseudonymKey: process.env.ANALYTICS_PSEUDONYM_KEY || '',
  sessionSecret: process.env.HMS_SESSION_SECRET || 'dev-only-secret-change-me',
  hmsAppUrl: process.env.HMS_APP_URL || 'http://localhost:3000',
  port: int('ANALYTICS_PORT', 3002, { min: 1, max: 65535 }),
  pipeline: {
    maxRetries: int('PIPELINE_MAX_RETRIES', 2, { max: 10 }),
    retryDelayMs: int('PIPELINE_RETRY_DELAY_MS', 5000, { max: 600000 }),
    freshnessHours: int('PIPELINE_FRESHNESS_HOURS', 26, { min: 1, max: 24 * 365 }),
    scheduleMinutes: int('PIPELINE_SCHEDULE_MINUTES', 60, { min: 1, max: 24 * 60 * 7 }),
    capacityDaysAhead: int('CAPACITY_DAYS_AHEAD', 28, { max: 365 }),
  },
};

module.exports = config;
