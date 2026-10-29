// Test setup: points the backend at a separate test database, rebuilds it from the
// project's SQL files and starts the app on a free port.
//
// Needs a database called hms_test (or TEST_DB_NAME) that the DB_USER owns:
//   createdb -U postgres -O hms_user hms_test
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.DB_NAME = process.env.TEST_DB_NAME || 'hms_test';
process.env.NODE_ENV = 'test';
if (!/_test$/.test(process.env.DB_NAME)) {
  // The tests delete every table, so never run them against a real database
  throw new Error(`Refusing to run tests against "${process.env.DB_NAME}": the test database name must end in _test`);
}

// Collect emails instead of sending them
const outbox = [];
const mailer = require('../mailer');
mailer.sendMail = async message => { outbox.push(message); };

const ROOT = path.join(__dirname, '..', '..');

// The SQL files are written for psql; drop the psql-only lines (\c, \ir) and the
// database create/drop, which are not needed for an existing test database
function sqlFile(name) {
  return fs.readFileSync(path.join(ROOT, name), 'utf8')
    .split('\n')
    .filter(line => !/^\s*\\/.test(line) && !/^\s*(DROP|CREATE) DATABASE/i.test(line))
    .join('\n');
}

async function resetDatabase() {
  const { pool } = require('../db');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.query(sqlFile('DDL.sql'));
  await pool.query(sqlFile('migrations/001_auth_and_validation.sql'));
  await pool.query(sqlFile('migrations/002_departments.sql'));
  await pool.query(sqlFile('InsertDML.sql'));
}

async function startServer() {
  await resetDatabase();
  const app = require('../app');
  const { pool } = require('../db');
  const server = await new Promise(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    pool,
    outbox,
    close: async () => {
      await new Promise(resolve => server.close(resolve));
      await pool.end();
    },
  };
}

// A minimal browser: keeps the session cookie between requests
class Client {
  constructor(base) {
    this.base = base;
    this.cookie = '';
    this.lastSetCookie = '';
  }

  async request(method, url, body, headers = {}) {
    const res = await fetch(this.base + url, {
      method,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      this.lastSetCookie = setCookie;
      const pair = setCookie.split(';')[0];
      this.cookie = /=$/.test(pair) || /Expires=Thu, 01 Jan 1970/i.test(setCookie) ? '' : pair;
    }
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data, headers: res.headers };
  }

  get(url, headers) { return this.request('GET', url, undefined, headers); }

  post(url, body, headers) { return this.request('POST', url, body || {}, headers); }

  put(url, body) { return this.request('PUT', url, body || {}); }

  del(url) { return this.request('DELETE', url); }

  login(email, password = 'password12', extra = {}) {
    return this.post('/auth/login', { email, password, ...extra });
  }
}

// A valid patient sign-up; override fields to test one rule at a time
const newPatient = (overrides = {}) => ({
  firstName: 'Priya',
  lastName: 'Sharma',
  email: `priya.${Math.random().toString(36).slice(2, 8)}@example.com`,
  phone: '9876543210',
  dob: '1995-04-12',
  gender: 'female',
  address: '12 MG Road, Bengaluru',
  password: 'Str0ng!Pass',
  confirmPassword: 'Str0ng!Pass',
  acceptTerms: true,
  ...overrides,
});

module.exports = { startServer, Client, newPatient };
