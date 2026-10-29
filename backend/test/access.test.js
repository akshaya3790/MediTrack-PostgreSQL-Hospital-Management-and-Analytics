// Route protection and role-based access
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, Client } = require('./helpers');

let env;
let patient;
let doctor;
test.before(async () => {
  env = await startServer();
  patient = new Client(env.base);
  await patient.login('ramesh@example.com');
  doctor = new Client(env.base);
  await doctor.login('anita.desai@example.com', 'password12', { isDoctor: true });
});
test.after(async () => { await env.close(); });

test('protected routes need a session', async () => {
  const visitor = new Client(env.base);
  for (const url of ['/profile', '/appointments', '/doctors', '/patients', '/appointments/1']) {
    assert.equal((await visitor.get(url)).status, 401, url);
  }
  assert.equal((await visitor.post('/appointments', {})).status, 401);
});

test('public pages work without a session', async () => {
  const visitor = new Client(env.base);
  const overview = await visitor.get('/public/overview');
  assert.equal(overview.status, 200);
  assert.equal(overview.data.counts.doctors, 4);
  assert.equal((await visitor.get('/public/schedules')).status, 200);
});

test('patients cannot use doctor-only endpoints', async () => {
  assert.equal((await patient.get('/patients')).status, 403);
  assert.equal((await patient.post('/appointments/1/diagnosis', { diagnosis: 'x ok', prescription: 'y ok' })).status, 403);
});

test('doctors cannot book appointments as a patient', async () => {
  const res = await doctor.post('/appointments', {});
  assert.equal(res.status, 403);
});

test("a patient cannot open another patient's appointment or history", async () => {
  const other = await patient.get('/appointments/2');
  assert.ok([403, 404].includes(other.status), `got ${other.status}`);
  const history = await patient.get('/patients/suresh@example.com/history');
  assert.ok([403, 404].includes(history.status), `got ${history.status}`);
  assert.equal((await patient.get('/appointments/1')).status, 200);
});

test("a doctor only sees their own patients' records", async () => {
  assert.equal((await doctor.get('/patients/ramesh@example.com/history')).status, 200);
  const notMine = await doctor.get('/patients/suresh@example.com/history');
  assert.ok([403, 404].includes(notMine.status), `got ${notMine.status}`);
});

test('there is no way to sign up as an admin or pick a role at sign-up', async () => {
  const res = await new Client(env.base).post('/auth/patient/register', {
    firstName: 'Mal', lastName: 'Lory', email: 'mal@example.com', phone: '9876543210', gender: 'male',
    address: 'Somewhere 1', password: 'Str0ng!Pass', confirmPassword: 'Str0ng!Pass', acceptTerms: true,
    who: 'doc', role: 'admin', isDoctor: true,
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.who, 'pat');
  assert.equal((await new Client(env.base).post('/auth/admin/register', {})).status, 404);
});

test('booking: a valid request works, the same slot cannot be booked twice, bad dates are refused', async () => {
  const day = new Date();
  do day.setDate(day.getDate() + 1); while (day.getDay() !== 2); // next Tuesday (Dr. Desai works Tuesdays)
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  const booking = { doctor: 'anita.desai@example.com', date, startTime: '09:00', concerns: 'Check-up', symptoms: 'None really' };

  const ok = await patient.post('/appointments', booking);
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const twice = await patient.post('/appointments', booking);
  assert.equal(twice.status, 409);

  const past = await patient.post('/appointments', { ...booking, date: '2020-01-07' });
  assert.equal(past.status, 400);
  assert.ok(past.data.fields.date);
  const far = new Date(); far.setDate(far.getDate() + 200);
  const tooFar = await patient.post('/appointments', { ...booking, date: far.toISOString().slice(0, 10) });
  assert.equal(tooFar.status, 400);
  const short = await patient.post('/appointments', { ...booking, startTime: '10:00', concerns: 'x' });
  assert.equal(short.status, 400);
  assert.ok(short.data.fields.concerns);
});
