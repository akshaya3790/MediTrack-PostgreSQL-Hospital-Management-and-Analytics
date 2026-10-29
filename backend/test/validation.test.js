// Field rules (validation.js) and the same rules enforced by the API and the database
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const v = require('../validation');

// These tests send many sign-ups; raise the per-network sign-up limit
process.env.RATE_LIMIT_SCALE = '10';
const { startServer, Client, newPatient } = require('./helpers');

const ok = value => assert.equal(value, null);
const bad = value => assert.equal(typeof value, 'string');

test('frontend and backend use the same validation file', () => {
  const backend = fs.readFileSync(path.join(__dirname, '..', 'validation.js'), 'utf8');
  const frontend = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'validation.js'), 'utf8');
  assert.equal(frontend, backend);
});

test('names: letters (any language), spaces, hyphens, apostrophes; no digits or symbols', () => {
  for (const name of ['Priya', "D'Souza", 'Mary-Jane', 'Anne Marie', 'José', 'Zoë', 'प्रिया', 'Dr. Rao', 'O’Neil']) ok(v.checkName(name, 'Name'));
  for (const name of ['R4mesh', 'John3', '<script>', 'a@b', '--', "'", 'Ann  -', '']) bad(v.checkName(name, 'Name'));
  bad(v.checkName('A'.repeat(51), 'Name'));
  assert.match(v.checkName('R4mesh', 'First name'), /cannot contain numbers/);
  assert.equal(v.normalizeName('  priya   sharma '), 'priya sharma');
});

test('email: syntax and normalisation', () => {
  for (const email of ['a@b.co', 'first.last+tag@example.co.in']) ok(v.checkEmail(email));
  for (const email of ['', 'plain', 'a@', '@b.com', 'a@b', 'a b@c.com', 'a@b..com']) bad(v.checkEmail(email));
  assert.equal(v.normalizeEmail('  Me@Example.COM '), 'me@example.com');
});

test('phone: 10-digit Indian mobile with optional +91, no letters', () => {
  for (const phone of ['9876543210', '+919876543210', '+91 98765 43210', '98765-43210', '09876543210']) ok(v.checkPhone(phone, { required: true }));
  for (const phone of ['98abc43210', '12345', '98765432101', '1234567890', '+1 9876543210']) bad(v.checkPhone(phone, { required: true }));
  bad(v.checkPhone('', { required: true }));
  ok(v.checkPhone(''));
  assert.match(v.checkPhone('98abc'), /only contain digits/);
  assert.equal(v.normalizePhone('098765 43210'), '+919876543210');
});

test('password: length, upper, lower, number; symbols allowed; confirmation must match', () => {
  ok(v.checkPassword('Str0ngPass'));
  ok(v.checkPassword('Str0ng!@#$%^&*()Pass'));
  for (const pw of ['', 'short1A', 'alllowercase1', 'ALLUPPERCASE1', 'NoNumbersHere', 'password12']) bad(v.checkPassword(pw));
  bad(v.checkPassword(`Aa1${'x'.repeat(80)}`));
  ok(v.checkPasswordConfirmation('Str0ngPass', 'Str0ngPass'));
  bad(v.checkPasswordConfirmation('Str0ngPass', 'Str0ngpass'));
});

test('date of birth: real date, not in the future, not before 120 years ago', () => {
  const today = '2026-10-29';
  ok(v.checkDateOfBirth('1990-02-28', { today }));
  ok(v.checkDateOfBirth('', { today }));
  for (const dob of ['2026-10-30', '2030-01-01', '1890-01-01', '1990-02-30', '29/10/1990', 'yesterday']) bad(v.checkDateOfBirth(dob, { today }));
  bad(v.checkDateOfBirth('', { required: true, today }));
});

test('appointment date: from today up to 90 days ahead', () => {
  const today = '2026-10-29';
  ok(v.checkAppointmentDate('2026-10-29', { today }));
  ok(v.checkAppointmentDate('2027-01-27', { today }));
  bad(v.checkAppointmentDate('2026-10-28', { today }));
  bad(v.checkAppointmentDate('2027-01-28', { today }));
  bad(v.checkAppointmentDate('2026-02-30', { today }));
});

test('address, free text and dropdown choices', () => {
  ok(v.checkAddress('12/B, MG Road, Bengaluru - 560001'));
  for (const address of ['', '12', '<b>bold</b>', '#$%^&*']) bad(v.checkAddress(address));
  bad(v.checkText('ab\u0000c', 'Notes'));
  ok(v.checkText('', 'Notes', { required: false }));
  ok(v.checkChoice('female', v.GENDERS, 'gender'));
  bad(v.checkChoice('Female ', v.GENDERS, 'gender'));
  bad(v.checkChoice('robot', v.GENDERS, 'gender'));
  bad(v.checkChoice('Astrology', v.SPECIALIZATIONS, 'department'));
});

// ---- The API enforces the same rules even when the browser is bypassed ----

let env;
test.before(async () => { env = await startServer(); });
test.after(async () => { await env.close(); });

const register = body => new Client(env.base).post('/auth/patient/register', body);

test('API rejects invalid sign-up fields with a message per field', async () => {
  const cases = {
    firstName: 'R4mesh',
    lastName: '',
    email: 'not-an-email',
    phone: '98abc43210',
    dob: '2999-01-01',
    gender: 'robot',
    address: '<script>',
    password: 'password',
    confirmPassword: 'something else',
    acceptTerms: false,
  };
  for (const [field, value] of Object.entries(cases)) {
    const res = await register(newPatient({ [field]: value }));
    assert.equal(res.status, 400, `${field}=${value} should be refused`);
    assert.ok(res.data.fields && res.data.fields[field], `${field} has its own error message`);
  }
});

test('API rejects a sign-up with missing fields or the wrong types', async () => {
  const res = await register({ email: 'x@example.com' });
  assert.equal(res.status, 400);
  for (const field of ['firstName', 'lastName', 'phone', 'gender', 'address', 'password']) assert.ok(res.data.fields[field], field);
  const typed = await register(newPatient({ firstName: ['Array'], phone: 9876543210 }));
  assert.equal(typed.status, 400);
});

test('API accepts names with accents, hyphens and apostrophes', async () => {
  const res = await register(newPatient({ firstName: 'Zoë-Anne', lastName: "D'Souza" }));
  assert.equal(res.status, 201);
  assert.equal(res.data.name, "Zoë-Anne D'Souza");
});

test('profile updates are validated too', async () => {
  const c = new Client(env.base);
  await c.login('ramesh@example.com');
  const res = await c.put('/profile', { name: 'Ram3sh', address: 'MG Road 1', phone: '12', dob: '2999-01-01' });
  assert.equal(res.status, 400);
  assert.deepEqual(Object.keys(res.data.fields).sort(), ['dob', 'name', 'phone']);
  assert.equal((await c.put('/profile', { name: 'Ramesh Kumar', address: 'MG Road 1', phone: '9876543210', dob: '' })).status, 200);
});

test('the database itself refuses bad values written around the API', async () => {
  const insert = (phone, name, email) => env.pool.query(
    "INSERT INTO Patient(email,password,name,address,gender,phone) VALUES ($1,'x',$2,'Some street','male',$3)",
    [email, name, phone]);
  await assert.rejects(insert('12345', 'Valid Name', 'db1@example.com'), { code: '23514' });
  await assert.rejects(insert('+919876543210', 'Valid Name', 'NOT-AN-EMAIL'), { code: '23514' });
  await assert.rejects(insert('+919876543210', 'R2D2', 'db2@example.com'), { code: '23514' });
  // Departments live in their own table now, so an unknown one breaks the foreign key
  await assert.rejects(
    env.pool.query("UPDATE Doctor SET specialization = 'Astrology' WHERE email = 'anita.desai@example.com'"),
    { code: '23503' });
});
