// Builds a SYNTHETIC development copy of the hospital database, for demonstrating the pipeline,
// dashboard and models at a realistic size. It never touches the real hospital database:
// it refuses to run unless the database name ends in _synthetic_dev or _test.
//
//   createdb -U postgres -O hms_analytics hms_synthetic_dev      (once)
//   ANALYTICS_DB_NAME=hms_synthetic_dev npm run synthetic
//   ANALYTICS_DB_NAME=hms_synthetic_dev npm run synthetic -- --simulate-days=1   (simulate a day of new bookings, cancellations and completions)
//
// Every record is fictional and labelled: emails end in @example.invalid, names start with
// "Synthetic", and analytics_meta.dataset_info marks the database as synthetic.
// The rules that decide which past appointments were not completed are written below in
// notCompletedProbability(), so model results on this data can be read against them.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getPool, withTransaction, closePool } = require('../db');
const { initDatabase } = require('./init-db');

const REPO = path.join(__dirname, '..', '..', '..');
const GENERATOR = 'hms-synthetic v1';

// Deterministic random numbers, so the same seed gives the same dataset
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: arr => arr[Math.floor(next() * arr.length)],
    poisson: lambda => {
      const l = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do { k += 1; p *= next(); } while (p > l);
      return k - 1;
    },
  };
}

// Letters-only codes, because the hospital schema does not allow digits in names
const code = (n, len = 4) => {
  let s = '';
  for (let i = 0; i < len; i += 1) { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
};
const title = s => s.charAt(0).toUpperCase() + s.slice(1);
const iso = d => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Average appointments per open weekday, and how each department varies over the year
const DEPARTMENTS = {
  'General Medicine': { rate: 9, winter: 0.35 },
  Cardiology: { rate: 3.5, winter: 0.1 },
  Pediatrics: { rate: 5, winter: 0.4 },
  Orthopedics: { rate: 4, winter: -0.05 },
  Dermatology: { rate: 3, winter: -0.15 },
  Neurology: { rate: 2, winter: 0 },
  Gynecology: { rate: 3.5, winter: 0 },
  ENT: { rate: 3, winter: 0.3 },
  Ophthalmology: { rate: 2.5, winter: -0.05 },
  Psychiatry: { rate: 2.5, winter: 0.1 },
};
const DEPARTMENT_EFFECT = { Psychiatry: 0.35, Dermatology: 0.2, Pediatrics: -0.25, Cardiology: -0.2 };

// The generating rule for "not completed" (possible no-show). Documented in docs/ml-methodology.md.
function notCompletedProbability({ priorVisits, priorNotCompleted, daysSincePrevious, dow, hour, month, department }) {
  let z = -2.4;
  z += 0.55 * Math.min(priorNotCompleted, 3);
  z -= 0.25 * Math.log1p(priorVisits - priorNotCompleted);
  if (daysSincePrevious === null) z += 0.35; else if (daysSincePrevious > 120) z += 0.3;
  if (dow === 1) z += 0.3;
  if (dow === 6) z += 0.2;
  if (hour >= 15) z += 0.35;
  if (month === 12 || month === 1) z += 0.2;
  z += DEPARTMENT_EFFECT[department] || 0;
  return 1 / (1 + Math.exp(-z));
}

function assertSafeDatabase() {
  const name = config.db.database;
  if (!/(_synthetic_dev|_test)$/.test(name)) {
    throw new Error(`Refusing to write synthetic data into "${name}". Use a database whose name ends in _synthetic_dev.`);
  }
}

const sqlFile = file => fs.readFileSync(path.join(REPO, file), 'utf8')
  .split('\n')
  .filter(line => !/^\s*\\/.test(line) && !/^\s*(DROP|CREATE) DATABASE/i.test(line))
  .join('\n');

async function createHospitalSchema(db) {
  const { rows } = await db.query("SELECT to_regclass('public.appointment') AS t");
  if (rows[0].t) throw new Error('This database already has hospital tables. Drop and recreate it to generate again.');
  await db.query(sqlFile('DDL.sql'));
  for (const file of ['migrations/001_auth_and_validation.sql', 'migrations/002_departments.sql']) {
    if (fs.existsSync(path.join(REPO, file))) await db.query(sqlFile(file));
  }
}

// Inserts rows given as text, cast to each column's real type
async function bulkInsert(client, table, columns, rows) {
  const { rows: types } = await client.query(
    `SELECT column_name, format_type(a.atttypid, a.atttypmod) AS type
     FROM information_schema.columns c
     JOIN pg_attribute a ON a.attrelid = format('public.%I', c.table_name)::regclass AND a.attname = c.column_name
     WHERE c.table_schema = 'public' AND c.table_name = LOWER($1)`, [table]);
  const typeOf = Object.fromEntries(types.map(t => [t.column_name, t.type]));
  const select = columns.map((c, i) => `u.c${i}::${typeOf[c.toLowerCase()]}`).join(', ');
  for (let i = 0; i < rows.length; i += 5000) {
    const chunk = rows.slice(i, i + 5000);
    const arrays = columns.map((_, c) => chunk.map(r => r[c]));
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')})
       SELECT ${select} FROM unnest(${columns.map((_, c) => `$${c + 1}::text[]`).join(', ')}) AS u(${columns.map((_, c) => `c${c}`).join(', ')})`,
      arrays);
  }
}

async function generate({ seed = 42, days = 730, ahead = 28, patients = 2500 } = {}) {
  assertSafeDatabase();
  const r = rng(seed);
  const pool = getPool();
  await createHospitalSchema(pool);
  await initDatabase(pool);
  const today = new Date(`${iso(new Date())}T00:00:00Z`);

  const schedules = [
    { id: 1001, start: 9, end: 17, brk: 12, days: [1, 2, 3, 4, 5] },
    { id: 1002, start: 10, end: 18, brk: 13, days: [2, 4, 6] },
    { id: 1003, start: 8, end: 14, brk: 11, days: [1, 3, 5, 6] },
  ];
  const doctors = [];
  let n = 0;
  for (const dep of Object.keys(DEPARTMENTS)) {
    const count = DEPARTMENTS[dep].rate > 4 ? 3 : 2;
    for (let i = 0; i < count; i += 1) {
      const c = code(n += 1, 3);
      const sched = schedules[(n + i) % schedules.length];
      const slots = [];
      for (let h = sched.start; h + 1 <= sched.end; h += 1) if (h !== sched.brk) slots.push(h);
      doctors.push({ email: `synthetic.doctor.${c}@example.invalid`, name: `Dr. Synthetic ${title(c)}`, dep, sched, slots,
        fee: 300 + 100 * r.int(0, 9), gender: r.pick(['female', 'male']) });
    }
  }

  // Patients have different visit habits: most visit rarely, a few often
  const people = [];
  for (let i = 0; i < patients; i += 1) {
    const c = code(i + 1, 4);
    people.push({
      email: `synthetic.patient.${c}@example.invalid`, name: `Synthetic Patient ${title(c)}`,
      weight: (-Math.log(1 - r.next())) ** 1.5, visits: 0, notCompleted: 0, last: null,
      home: r.pick(Object.keys(DEPARTMENTS)),
    });
  }
  const totalWeight = people.reduce((s, p) => s + p.weight, 0);
  const pickPatient = () => {
    let x = r.next() * totalWeight;
    for (const p of people) { x -= p.weight; if (x <= 0) return p; }
    return people[people.length - 1];
  };

  const appointments = [];
  const links = [];
  const diagnoses = [];
  let id = 100000;
  for (let d = -days; d <= ahead; d += 1) {
    const date = addDays(today, d);
    const dow = date.getUTCDay();
    const month = date.getUTCMonth() + 1;
    const winterness = Math.cos(((month - 1) / 12) * 2 * Math.PI);  // 1 in January, -1 in July
    const trend = 1 + 0.12 * ((d + days) / 365);
    const booked = new Set();
    for (const [dep, info] of Object.entries(DEPARTMENTS)) {
      const open = doctors.filter(doc => doc.dep === dep && doc.sched.days.includes(dow));
      if (!open.length) continue;
      const weekday = dow === 1 ? 1.15 : dow === 6 ? 0.8 : 1;
      let want = r.poisson(info.rate * weekday * trend * (1 + info.winter * winterness) * (d > 0 ? 0.6 + 0.4 * Math.exp(-d / 10) : 1));
      for (let tries = 0; want > 0 && tries < 40; tries += 1) {
        const doc = r.pick(open);
        const hour = r.pick(doc.slots);
        const key = `${doc.email}|${hour}`;
        if (booked.has(key)) continue;
        let patient = pickPatient();
        if (patient.home !== dep && r.next() < 0.5) patient = pickPatient();
        booked.add(key);
        want -= 1;
        id += 1;
        let status = 'NotDone';
        if (d < 0) {
          const p = notCompletedProbability({
            priorVisits: patient.visits, priorNotCompleted: patient.notCompleted,
            daysSincePrevious: patient.last === null ? null : d - patient.last, dow: dow === 0 ? 7 : dow, hour, month, department: dep,
          });
          if (r.next() < p) patient.notCompleted += 1;
          else {
            status = 'Done';
            diagnoses.push([String(id), doc.email, 'Synthetic diagnosis', 'Synthetic prescription']);
          }
          patient.visits += 1;
          patient.last = d;
        }
        const hh = String(hour).padStart(2, '0');
        appointments.push([String(id), doc.email, iso(date), `${hh}:00`, `${String(hour + 1).padStart(2, '0')}:00`, status]);
        links.push([patient.email, String(id), 'Synthetic visit', 'Synthetic symptoms']);
      }
    }
  }

  await withTransaction(async client => {
    await bulkInsert(client, 'Patient', ['email', 'password', 'name', 'address', 'gender', 'phone', 'dob'],
      people.map((p, i) => [p.email, '!synthetic-no-login', p.name, 'Synthetic address', r.pick(['female', 'male', 'other']),
        `+919${String(100000000 + i).slice(-9)}`, iso(addDays(today, -r.int(365, 365 * 85)))]));
    await bulkInsert(client, 'Doctor', ['email', 'gender', 'password', 'name', 'specialization', 'is_demo', 'consultation_fee'],
      doctors.map(doc => [doc.email, doc.gender, '!synthetic-no-login', doc.name, doc.dep, 'true', String(doc.fee)]));
    await bulkInsert(client, 'Schedule', ['id', 'starttime', 'endtime', 'breaktime'],
      schedules.map(s => [String(s.id), `${s.start}:00`, `${s.end}:00`, `${s.brk}:00`]));
    await bulkInsert(client, 'ScheduleDays', ['sched', 'day'],
      schedules.flatMap(s => s.days.map(day => [String(s.id), DAY_NAMES[day]])));
    await bulkInsert(client, 'DocsHaveSchedules', ['sched', 'doctor'], doctors.map(doc => [String(doc.sched.id), doc.email]));
    await bulkInsert(client, 'Appointment', ['id', 'doctor', 'date', 'starttime', 'endtime', 'status'], appointments);
    await bulkInsert(client, 'PatientsAttendAppointments', ['patient', 'appt', 'concerns', 'symptoms'], links);
    await bulkInsert(client, 'Diagnose', ['appt', 'doctor', 'diagnosis', 'prescription'], diagnoses);
    await client.query(`SELECT setval(pg_get_serial_sequence('appointment', 'id'), (SELECT MAX(id) FROM appointment))`);
    await client.query(
      `INSERT INTO analytics_meta.dataset_info (id, is_synthetic, label, generated_at, generator, notes)
       VALUES (TRUE, TRUE, 'SYNTHETIC development data', NOW(), $1, $2)
       ON CONFLICT (id) DO UPDATE SET is_synthetic = TRUE, label = EXCLUDED.label, generated_at = NOW(),
         generator = EXCLUDED.generator, notes = EXCLUDED.notes`,
      [GENERATOR, `Seed ${seed}; ${patients} fictional patients, ${doctors.length} fictional doctors, ${appointments.length} appointments over ${days} days plus ${ahead} days ahead. Not real hospital activity.`]);
  });
  return { patients: people.length, doctors: doctors.length, appointments: appointments.length, diagnoses: diagnoses.length };
}

// Simulates activity since the last run: some upcoming appointments are cancelled (deleted),
// new ones are booked, and past open appointments are completed or left open
async function advance({ seed = 7, cancellations = 12, bookings = 40 } = {}) {
  assertSafeDatabase();
  const r = rng(seed + Date.now() % 1000);
  return withTransaction(async client => {
    const { rowCount: cancelled } = await client.query(
      `DELETE FROM appointment WHERE id IN (
         SELECT id FROM appointment WHERE status = 'NotDone' AND date >= CURRENT_DATE ORDER BY md5(id::text || $1) LIMIT $2)`,
      [String(seed), cancellations]);
    const { rows: done } = await client.query(
      `UPDATE appointment SET status = 'Done'
       WHERE id IN (SELECT id FROM appointment WHERE status = 'NotDone' AND date < CURRENT_DATE AND date >= CURRENT_DATE - 3
                    ORDER BY md5(id::text) LIMIT 20)
       RETURNING id, doctor`);
    for (const d of done) {
      await client.query(
        `INSERT INTO diagnose (appt, doctor, diagnosis, prescription) VALUES ($1, $2, 'Synthetic diagnosis', 'Synthetic prescription')
         ON CONFLICT DO NOTHING`, [d.id, d.doctor]);
    }
    const { rows: doctors } = await client.query(
      `SELECT d.email, s.starttime, s.endtime, s.breaktime, array_agg(sd.day) AS days
       FROM doctor d JOIN docshaveschedules dhs ON dhs.doctor = d.email JOIN schedule s ON s.id = dhs.sched
       JOIN scheduledays sd ON sd.sched = s.id GROUP BY d.email, s.id`);
    const { rows: pats } = await client.query('SELECT email FROM patient ORDER BY md5(email) LIMIT 500');
    let booked = 0;
    for (let i = 0; i < bookings * 3 && booked < bookings; i += 1) {
      const doc = r.pick(doctors);
      const date = addDays(new Date(`${iso(new Date())}T00:00:00Z`), r.int(1, 28));
      if (!doc.days.includes(DAY_NAMES[date.getUTCDay()])) continue;
      const start = Number(doc.starttime.slice(0, 2));
      const end = Number(doc.endtime.slice(0, 2));
      const hour = r.int(start, end - 1);
      if (hour === Number(doc.breaktime.slice(0, 2))) continue;
      const { rows } = await client.query(
        `INSERT INTO appointment (doctor, date, starttime, endtime, status) VALUES ($1, $2, $3, $4, 'NotDone')
         ON CONFLICT DO NOTHING RETURNING id`,
        [doc.email, iso(date), `${hour}:00`, `${hour + 1}:00`]);
      if (!rows.length) continue;
      await client.query(
        `INSERT INTO patientsattendappointments (patient, appt, concerns, symptoms) VALUES ($1, $2, 'Synthetic visit', 'Synthetic symptoms')`,
        [r.pick(pats).email, rows[0].id]);
      booked += 1;
    }
    return { cancelled, completed: done.length, booked };
  });
}

if (require.main === module) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
  const run = args['simulate-days']
    ? (async () => {
      const out = [];
      for (let i = 0; i < Number(args['simulate-days']); i += 1) out.push(await advance({ seed: 7 + i }));
      return out;
    })()
    : generate({ seed: Number(args.seed || 42), days: Number(args.days || 730), patients: Number(args.patients || 2500) });
  run.then(result => console.log(JSON.stringify(result)))
    .catch(err => { console.error(err.message); process.exitCode = 1; })
    .finally(closePool);
}

module.exports = { generate, advance, notCompletedProbability, assertSafeDatabase };
