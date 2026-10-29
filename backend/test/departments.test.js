// Department pages, their admin screens and booking through a department
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const bcrypt = require('bcryptjs');
const { startServer, Client } = require('./helpers');

let env;
let visitor;
let patient;
let admin;

// The next date (after today) that falls on the given weekday (0 = Sunday)
function nextDay(weekday) {
  const day = new Date();
  do day.setDate(day.getDate() + 1); while (day.getDay() !== weekday);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

const newDepartment = (overrides = {}) => ({
  name: 'Nephrology',
  slug: '',
  shortDescription: 'Kidney health and dialysis advice.',
  description: 'The Nephrology department looks after kidney health and long-term kidney conditions.',
  commonConcerns: 'Swelling in the legs\nHigh creatinine',
  icon: 'activity',
  imageUrl: '',
  phone: '',
  email: '',
  location: '',
  operatingHours: '',
  instructions: '',
  sortOrder: 50,
  isActive: true,
  ...overrides,
});

test.before(async () => {
  env = await startServer();
  const hash = await bcrypt.hash('Admin!2345', 10);
  await env.pool.query("INSERT INTO Admin (email, password, name) VALUES ('admin@example.com', $1, 'Hospital Admin')", [hash]);
  visitor = new Client(env.base);
  patient = new Client(env.base);
  await patient.login('ramesh@example.com');
  admin = new Client(env.base);
  const login = await admin.login('admin@example.com', 'Admin!2345', { role: 'admin' });
  assert.equal(login.status, 200, JSON.stringify(login.data));
});
test.after(async () => { await env.close(); });

test('the public list has all ten seeded departments with doctor counts', async () => {
  const res = await visitor.get('/public/departments');
  assert.equal(res.status, 200);
  assert.equal(res.data.data.length, 10);
  const slugs = res.data.data.map(d => d.slug);
  for (const slug of ['general-medicine', 'cardiology', 'pediatrics', 'orthopedics', 'dermatology',
    'neurology', 'gynecology', 'ent', 'ophthalmology', 'psychiatry']) {
    assert.ok(slugs.includes(slug), slug);
  }
  const cardiology = res.data.data.find(d => d.slug === 'cardiology');
  assert.equal(cardiology.doctorCount, 1);
  assert.ok(cardiology.serviceCount > 0);
});

test('a department page shows its own services and doctors, without emails', async () => {
  const res = await visitor.get('/public/departments/cardiology');
  assert.equal(res.status, 200);
  const dep = res.data.data;
  assert.equal(dep.name, 'Cardiology');
  assert.ok(dep.services.length > 0);
  assert.deepEqual(dep.doctors.map(d => d.name), ['Dr. Anita Desai']);
  assert.equal(dep.doctors[0].isDemo, true);
  assert.equal(dep.doctors[0].email, undefined);
  assert.ok(!JSON.stringify(res.data).includes('@example.com'));
  assert.ok(dep.consultationDays.includes('Tuesday'));
  // Contact details were never set, so none are made up
  assert.equal(dep.phone, null);
  assert.equal(dep.email, null);
});

test('a department with no doctors returns an empty list, not an error', async () => {
  const res = await visitor.get('/public/departments/neurology');
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.data.doctors, []);
});

test('unknown or malformed department addresses are 404s', async () => {
  for (const slug of ['not-a-department', 'Cardiology', 'card%20iology', "x'%20OR%201=1--", 'a'.repeat(200)]) {
    assert.equal((await visitor.get(`/public/departments/${slug}`)).status, 404, slug);
  }
});

test('availability lists free slots and rejects bad dates or doctors', async () => {
  const tuesday = nextDay(2);
  const res = await visitor.get(`/public/departments/cardiology/availability?date=${tuesday}`);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.data.length, 1);
  assert.ok(res.data.data[0].slots.length > 0);
  assert.ok(!JSON.stringify(res.data).includes('@'));

  assert.equal((await visitor.get('/public/departments/cardiology/availability?date=2020-01-07')).status, 400);
  assert.equal((await visitor.get('/public/departments/cardiology/availability?date=tomorrow')).status, 400);
  assert.equal((await visitor.get(`/public/departments/cardiology/availability?date=${tuesday}&doctor=abc`)).status, 400);
  assert.equal((await visitor.get(`/public/departments/nope/availability?date=${tuesday}`)).status, 404);
});

test('admin endpoints refuse visitors, patients and doctors', async () => {
  const doctor = new Client(env.base);
  await doctor.login('anita.desai@example.com', 'password12', { isDoctor: true });
  assert.equal((await visitor.get('/admin/departments')).status, 401);
  assert.equal((await visitor.post('/admin/departments', newDepartment())).status, 401);
  assert.equal((await patient.get('/admin/departments')).status, 403);
  assert.equal((await patient.put('/admin/doctors/1', {})).status, 403);
  assert.equal((await doctor.get('/admin/doctors')).status, 403);
});

test('a patient password does not work on the admin sign-in', async () => {
  const res = await new Client(env.base).login('ramesh@example.com', 'password12', { role: 'admin' });
  assert.equal(res.status, 401);
});

test('admins can create a department; it is saved and shown publicly', async () => {
  const bad = await admin.post('/admin/departments', newDepartment({ name: '', imageUrl: 'http://x.example/a.png' }));
  assert.equal(bad.status, 400);
  assert.ok(bad.data.fields.name);
  assert.ok(bad.data.fields.imageUrl);

  const created = await admin.post('/admin/departments', newDepartment({ phone: '080 2345 6789' }));
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const { rows } = await env.pool.query('SELECT slug, phone FROM Department WHERE id = $1', [created.data.id]);
  assert.deepEqual(rows[0], { slug: 'nephrology', phone: '080 2345 6789' });

  const page = await visitor.get('/public/departments/nephrology');
  assert.equal(page.status, 200);
  assert.equal(page.data.data.phone, '080 2345 6789');
  assert.deepEqual(page.data.data.commonConcerns, ['Swelling in the legs', 'High creatinine']);
});

test('duplicate department names and web addresses are refused', async () => {
  const name = await admin.post('/admin/departments', newDepartment({ name: 'cardiology', slug: 'heart-2' }));
  assert.equal(name.status, 409);
  assert.ok(name.data.fields.name);
  const slug = await admin.post('/admin/departments', newDepartment({ name: 'Heart Two', slug: 'cardiology' }));
  assert.equal(slug.status, 409);
  assert.ok(slug.data.fields.slug);
});

test('services can be added, edited and removed', async () => {
  const { rows } = await env.pool.query("SELECT id FROM Department WHERE slug = 'nephrology'");
  const depId = rows[0].id;
  const added = await admin.post(`/admin/departments/${depId}/services`, { name: 'Kidney consultation', description: 'First visit.' });
  assert.equal(added.status, 201);
  assert.equal((await admin.post(`/admin/departments/${depId}/services`, { name: 'kidney consultation' })).status, 409);

  let page = await visitor.get('/public/departments/nephrology');
  assert.deepEqual(page.data.data.services.map(s => s.name), ['Kidney consultation']);

  assert.equal((await admin.put(`/admin/services/${added.data.id}`, { name: 'Kidney review', isActive: false })).status, 200);
  page = await visitor.get('/public/departments/nephrology');
  assert.deepEqual(page.data.data.services, [], 'inactive services are hidden');

  assert.equal((await admin.del(`/admin/services/${added.data.id}`)).status, 200);
  assert.equal((await admin.del(`/admin/services/${added.data.id}`)).status, 404);
});

test('renaming a department keeps its doctors attached', async () => {
  const { rows } = await env.pool.query("SELECT id FROM Department WHERE slug = 'orthopedics'");
  const detail = await admin.get(`/admin/departments/${rows[0].id}`);
  assert.equal(detail.status, 200);
  const res = await admin.put(`/admin/departments/${rows[0].id}`, newDepartment({
    ...detail.data.data, commonConcerns: detail.data.data.commonConcerns.join('\n'),
    imageUrl: '', phone: '', email: '', location: '', operatingHours: '', instructions: '',
    name: 'Orthopaedics', slug: 'orthopaedics',
  }));
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const page = await visitor.get('/public/departments/orthopaedics');
  assert.deepEqual(page.data.data.doctors.map(d => d.name), ['Dr. Arjun Nair']);
  assert.equal((await visitor.get('/public/departments/orthopedics')).status, 404);
});

test('admins can move a doctor and update their public profile', async () => {
  const doctors = (await admin.get('/admin/doctors')).data.data;
  const nair = doctors.find(d => d.name === 'Dr. Arjun Nair');
  const res = await admin.put(`/admin/doctors/${nair.id}`, {
    specialization: 'Nephrology', qualifications: 'MBBS, MD', experienceYears: 12, consultationFee: 700,
    languages: 'English, Malayalam', bio: '', photoUrl: '', isActive: true, isDemo: true,
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const page = await visitor.get('/public/departments/nephrology');
  assert.equal(page.data.data.doctors.length, 1);
  assert.equal(page.data.data.doctors[0].qualifications, 'MBBS, MD');
  assert.equal(page.data.data.doctors[0].consultationFee, 700);

  const bad = await admin.put(`/admin/doctors/${nair.id}`, { specialization: 'Astrology', experienceYears: 200, consultationFee: -1 });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.fields.specialization);
  assert.equal((await admin.put('/admin/doctors/999999', { specialization: 'Cardiology' })).status, 404);
});

test('an inactive doctor is hidden and cannot be booked', async () => {
  const doctors = (await admin.get('/admin/doctors')).data.data;
  const nair = doctors.find(d => d.name === 'Dr. Arjun Nair');
  await admin.put(`/admin/doctors/${nair.id}`, { specialization: 'Nephrology', isActive: false });
  const page = await visitor.get('/public/departments/nephrology');
  assert.deepEqual(page.data.data.doctors, []);

  const { rows } = await env.pool.query(
    `SELECT sd.day FROM DocsHaveSchedules dhs JOIN ScheduleDays sd ON sd.sched = dhs.sched WHERE dhs.doctor = $1 LIMIT 1`,
    [nair.email]);
  const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(rows[0].day);
  const res = await patient.post('/appointments', {
    doctor: nair.email, date: nextDay(weekday), startTime: '10:00', concerns: 'Knee pain', symptoms: 'Pain when walking',
  });
  assert.equal(res.status, 404, JSON.stringify(res.data));
  await admin.put(`/admin/doctors/${nair.id}`, { specialization: 'Nephrology', isActive: true });
});

test('a deactivated department disappears and its doctors cannot be booked', async () => {
  const { rows } = await env.pool.query("SELECT id FROM Department WHERE slug = 'nephrology'");
  const detail = (await admin.get(`/admin/departments/${rows[0].id}`)).data.data;
  const off = await admin.put(`/admin/departments/${rows[0].id}`, newDepartment({
    ...detail, commonConcerns: detail.commonConcerns.join('\n'), imageUrl: '', email: '', location: '',
    operatingHours: '', instructions: '', isActive: false,
  }));
  assert.equal(off.status, 200, JSON.stringify(off.data));
  assert.equal((await visitor.get('/public/departments/nephrology')).status, 404);
  assert.ok(!(await visitor.get('/public/departments')).data.data.some(d => d.slug === 'nephrology'));
  // The admin can still see and edit it
  assert.equal((await admin.get(`/admin/departments/${rows[0].id}`)).status, 200);

  const nair = (await admin.get('/admin/doctors')).data.data.find(d => d.name === 'Dr. Arjun Nair');
  const { rows: day } = await env.pool.query(
    `SELECT sd.day FROM DocsHaveSchedules dhs JOIN ScheduleDays sd ON sd.sched = dhs.sched WHERE dhs.doctor = $1 LIMIT 1`,
    [nair.email]);
  const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(day[0].day);
  const res = await patient.post('/appointments', {
    doctor: nair.email, date: nextDay(weekday), startTime: '10:00', concerns: 'Knee pain', symptoms: 'Pain when walking',
  });
  assert.equal(res.status, 404);
});

test('two patients booking the same slot at once: exactly one succeeds', async () => {
  const other = new Client(env.base);
  await other.login('suresh@example.com');
  const date = nextDay(5); // Dr. Desai works Fridays
  const booking = { doctor: 'anita.desai@example.com', date, startTime: '11:00', concerns: 'Check-up', symptoms: 'Mild chest pain' };
  const results = await Promise.all([patient.post('/appointments', booking), other.post('/appointments', booking)]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409], JSON.stringify(results.map(r => r.data)));

  const avail = await visitor.get(`/public/departments/cardiology/availability?date=${date}`);
  assert.ok(!avail.data.data[0].slots.includes('11:00'), 'the booked slot is no longer offered');
});

test('the department migration can be run again without changing data', async () => {
  const before = await env.pool.query('SELECT COUNT(*)::int AS deps, (SELECT COUNT(*)::int FROM DepartmentService) AS services FROM Department');
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '002_departments.sql'), 'utf8');
  await env.pool.query(sql);
  await env.pool.query(sql);
  const after = await env.pool.query('SELECT COUNT(*)::int AS deps, (SELECT COUNT(*)::int FROM DepartmentService) AS services FROM Department');
  assert.deepEqual(after.rows[0], before.rows[0]);
  // The admin's renamed department was not re-seeded under its old name
  const { rows } = await env.pool.query("SELECT COUNT(*)::int AS n FROM Department WHERE slug IN ('orthopedics', 'orthopaedics')");
  assert.equal(rows[0].n, 1);
});

test('the create-admin script creates an administrator who can sign in', async () => {
  const script = path.join(__dirname, '..', 'scripts', 'create-admin.js');
  const out = await new Promise((resolve, reject) => {
    execFile(process.execPath, [script, 'second.admin@example.com', 'Second Admin'],
      { env: { ...process.env, ADMIN_PASSWORD: 'An0ther!Pass' } },
      (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
  });
  assert.match(out, /created/);
  assert.ok(!out.includes('An0ther!Pass'));
  const res = await new Client(env.base).login('second.admin@example.com', 'An0ther!Pass', { role: 'admin' });
  assert.equal(res.status, 200);
  assert.equal(res.data.who, 'adm');
});
