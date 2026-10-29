require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { pool, withTransaction } = require('./db');
const v = require('./validation');
const { securityHeaders, csrfProtection, createLimiters, safeEqual, hashToken, newToken } = require('./security');
const { sendMail } = require('./mailer');

const PORT = Number(process.env.PORT || 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
const SESSION_SECRET = process.env.SESSION_SECRET;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DOCTOR_INVITE_CODE = process.env.DOCTOR_INVITE_CODE || '';
const BCRYPT_ROUNDS = 10;
const APPOINTMENT_MINUTES = 60;
const HOUR = 60 * 60 * 1000;
// A normal sign-in lasts until the browser closes or 8 idle hours pass;
// "Remember me" keeps the user signed in for 30 days of inactivity
const SESSION_IDLE_MS = 8 * HOUR;
const REMEMBER_ME_MS = 30 * 24 * HOUR;
const RESET_TOKEN_MS = 30 * 60 * 1000;

if (!SESSION_SECRET) {
  if (IS_PRODUCTION) throw new Error('SESSION_SECRET must be set in production');
  console.warn('SESSION_SECRET is not set; using an insecure development secret');
}

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

app.use(securityHeaders);
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '20kb' }));
app.use(csrfProtection(CLIENT_ORIGIN));
app.use(session({
  name: 'hms.sid',
  // Sessions live in the database, so logins survive a server restart and can be revoked
  store: new PgSession({ pool, tableName: 'session', ttl: SESSION_IDLE_MS / 1000, pruneSessionInterval: 15 * 60 }),
  secret: SESSION_SECRET || 'dev-only-secret-change-me',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
  },
}));

const limiters = createLimiters(Number(process.env.RATE_LIMIT_SCALE || 1));

// ---------- Helpers ----------

class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

// Lets async route handlers pass errors to the error middleware instead of crashing the server
const route = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Runs each field's check against the request body and rejects the request with
// every failing field's message, so the frontend can show them next to the inputs
function validate(body, checks) {
  const fields = {};
  for (const [field, check] of Object.entries(checks)) {
    const message = check(body[field], body);
    if (message) fields[field] = message;
  }
  const failed = Object.keys(fields);
  if (failed.length) {
    throw new HttpError(400, failed.length === 1 ? fields[failed[0]] : 'Please correct the highlighted fields', fields);
  }
}

const str = value => (typeof value === 'string' ? value : '');

function formatTime(minutes) {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}:00`;
}

const todayString = () => v.localDateString(new Date());

// "09:30:00" -> 570
const toMinutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

// who is "pat" for patients, "doc" for doctors and "adm" for administrators
const ACCOUNT_TABLES = { pat: 'Patient', doc: 'Doctor', adm: 'Admin' };
const tableFor = who => ACCOUNT_TABLES[who] || 'Patient';
const ROLE_NAMES = { pat: 'patient', doc: 'doctor', adm: 'administrator' };

function startSession(req, email, who, remember) {
  return new Promise((resolve, reject) => {
    // New session id on login prevents session fixation
    req.session.regenerate(err => {
      if (err) return reject(err);
      req.session.user = { email, who };
      if (remember) {
        req.session.cookie.maxAge = REMEMBER_ME_MS;
      } else {
        // A browser-session cookie: it is dropped when the browser closes
        req.session.cookie.expires = false;
      }
      req.session.save(saveErr => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

// Signs a user out everywhere, for example after their password is reset
function endAllSessions(email, who, exceptSid = '') {
  return pool.query(
    `DELETE FROM session WHERE sess->'user'->>'email' = $1 AND sess->'user'->>'who' = $2 AND sid <> $3`,
    [email, who, exceptSid]);
}

const requireLogin = (...roles) => (req, res, next) => {
  const user = req.session.user;
  if (!user) return next(new HttpError(401, 'Your session has ended. Please sign in again.'));
  if (roles.length && !roles.includes(user.who)) {
    return next(new HttpError(403, 'You do not have access to this'));
  }
  next();
};

// A doctor may see a patient's records only if the patient has an appointment with them
async function doctorTreatsPatient(doctor, patient) {
  const { rows } = await pool.query(
    `SELECT 1 FROM Appointment a
     JOIN PatientsAttendAppointments p ON p.appt = a.id
     WHERE a.doctor = $1 AND p.patient = $2 LIMIT 1`,
    [doctor, patient]);
  return rows.length > 0;
}

async function checkPatientAccess(user, patientEmail) {
  if (user.who === 'pat' && user.email === patientEmail) return;
  if (user.who === 'doc' && await doctorTreatsPatient(user.email, patientEmail)) {
    // Record the access in the audit table
    await pool.query(
      `INSERT INTO DoctorViewsHistory (history, doctor)
       SELECT history, $1 FROM PatientsFillHistory WHERE patient = $2
       ON CONFLICT DO NOTHING`,
      [user.email, patientEmail]);
    return;
  }
  throw new HttpError(403, 'You do not have access to this patient');
}

// Loads an appointment and checks the logged-in user is its patient or its doctor
async function loadAppointmentFor(user, id) {
  if (!/^\d{1,9}$/.test(id)) throw new HttpError(404, 'Appointment not found');
  const { rows } = await pool.query(
    `SELECT a.*, p.patient FROM Appointment a
     LEFT JOIN PatientsAttendAppointments p ON p.appt = a.id
     WHERE a.id = $1`,
    [id]);
  const appt = rows[0];
  if (!appt) throw new HttpError(404, 'Appointment not found');
  const allowed = (user.who === 'doc' && appt.doctor === user.email)
    || (user.who === 'pat' && appt.patient === user.email);
  if (!allowed) throw new HttpError(403, 'You do not have access to this appointment');
  return appt;
}

// Bookable one-hour start times for a doctor on a date: inside a working shift,
// clear of the one-hour break, not already booked and not already past
async function freeSlots(db, doctor, date) {
  const { rows: shifts } = await db.query(
    `SELECT s.starttime, s.endtime, s.breaktime
     FROM DocsHaveSchedules dhs
     JOIN Schedule s ON s.id = dhs.sched
     JOIN ScheduleDays sd ON sd.sched = s.id
     WHERE dhs.doctor = $1 AND sd.day = TO_CHAR($2::date, 'FMDay')`,
    [doctor, date]);
  const { rows: booked } = await db.query(
    'SELECT starttime, endtime FROM Appointment WHERE doctor = $1 AND date = $2',
    [doctor, date]);
  const isToday = date === todayString();
  const overlaps = (start, end, from, to) => start < to && end > from;

  const slots = new Set();
  for (const shift of shifts) {
    const breakStart = toMinutes(shift.breaktime);
    for (let start = toMinutes(shift.starttime); start + APPOINTMENT_MINUTES <= toMinutes(shift.endtime);
      start += APPOINTMENT_MINUTES) {
      const end = start + APPOINTMENT_MINUTES;
      if (overlaps(start, end, breakStart, breakStart + 60)) continue;
      if (booked.some(b => overlaps(start, end, toMinutes(b.starttime), toMinutes(b.endtime)))) continue;
      if (isToday && start <= nowMinutes()) continue;
      slots.add(start);
    }
  }
  return [...slots].sort((a, b) => a - b).map(m => formatTime(m).slice(0, 5));
}

// One shape for appointment rows, whether a patient or a doctor is asking
const APPOINTMENT_SELECT = `
  SELECT a.id, a.date, a.starttime AS "startTime", a.endtime AS "endTime", a.status,
         d.name AS "doctorName", d.email AS "doctorEmail", d.specialization,
         pt.name AS "patientName", pt.email AS "patientEmail",
         p.concerns, p.symptoms, dg.diagnosis, dg.prescription
  FROM Appointment a
  JOIN Doctor d ON d.email = a.doctor
  JOIN PatientsAttendAppointments p ON p.appt = a.id
  JOIN Patient pt ON pt.email = p.patient
  LEFT JOIN Diagnose dg ON dg.appt = a.id`;

// Hash compared against when the email is unknown, so a failed login takes the same
// time whether or not the account exists
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-1A', BCRYPT_ROUNDS);

// Names of the departments that are open to patients
async function activeDepartmentNames(db = pool) {
  const { rows } = await db.query('SELECT name FROM Department WHERE is_active ORDER BY sort_order, name');
  return rows.map(r => r.name);
}

// A doctor can be booked only while both the doctor and their department are active
const BOOKABLE_DOCTOR = `
  SELECT d.email FROM Doctor d JOIN Department dep ON dep.name = d.specialization
  WHERE d.email = $1 AND d.is_active AND dep.is_active`;

// Public doctor profile: never includes the email address, password or patient data
const PUBLIC_DOCTOR_SELECT = `
  SELECT d.id, d.name, d.specialization, d.gender, d.qualifications,
         d.experience_years AS "experienceYears", d.consultation_fee::float AS "consultationFee",
         d.languages, d.bio, d.profile_image_url AS "photoUrl", d.is_demo AS "isDemo",
         dep.slug AS "departmentSlug",
         MIN(s.starttime) AS "startTime", MAX(s.endtime) AS "endTime",
         COALESCE(ARRAY_AGG(DISTINCT sd.day) FILTER (WHERE sd.day IS NOT NULL), '{}') AS days
  FROM Doctor d
  JOIN Department dep ON dep.name = d.specialization
  LEFT JOIN DocsHaveSchedules dhs ON dhs.doctor = d.email
  LEFT JOIN Schedule s ON s.id = dhs.sched
  LEFT JOIN ScheduleDays sd ON sd.sched = s.id`;

const DEPARTMENT_SELECT = `
  SELECT dep.id, dep.name, dep.slug, dep.short_description AS "shortDescription", dep.description,
         dep.common_concerns AS "commonConcerns", dep.icon, dep.image_url AS "imageUrl",
         dep.phone, dep.email, dep.location, dep.operating_hours AS "operatingHours",
         dep.instructions, dep.sort_order AS "sortOrder", dep.is_active AS "isActive",
         dep.updated_at AS "updatedAt"
  FROM Department dep`;

// Department web addresses are lowercase words joined by hyphens
function checkSlugParam(slug) {
  if (v.checkSlug(slug)) throw new HttpError(404, 'Department not found');
  return slug;
}

async function loadActiveDepartment(slug) {
  const { rows } = await pool.query(`${DEPARTMENT_SELECT} WHERE dep.slug = $1 AND dep.is_active`, [checkSlugParam(slug)]);
  if (!rows.length) throw new HttpError(404, 'Department not found');
  return rows[0];
}

// ---------- Public information (no login needed) ----------

app.get('/public/overview', route(async (req, res) => {
  const { rows: doctors } = await pool.query(
    `${PUBLIC_DOCTOR_SELECT}
     WHERE d.is_active AND dep.is_active
     GROUP BY d.email, dep.id
     ORDER BY d.name`);
  const { rows: [counts] } = await pool.query(
    `SELECT (SELECT COUNT(*) FROM Doctor d JOIN Department dep ON dep.name = d.specialization
             WHERE d.is_active AND dep.is_active)::int AS doctors,
            (SELECT COUNT(*) FROM Patient)::int AS patients,
            (SELECT COUNT(*) FROM Appointment WHERE status = 'Done')::int AS "completedVisits",
            (SELECT COUNT(*) FROM Department WHERE is_active)::int AS departments`);
  res.json({
    doctors,
    counts,
    specializations: await activeDepartmentNames(),
    doctorInviteRequired: Boolean(DOCTOR_INVITE_CODE),
  });
}));

// Schedules a new doctor can pick from when registering
app.get('/public/schedules', route(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.starttime AS "startTime", s.endtime AS "endTime", s.breaktime AS "breakTime",
            COALESCE(ARRAY_AGG(sd.day ORDER BY ARRAY_POSITION(
              ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']::varchar[], sd.day))
              FILTER (WHERE sd.day IS NOT NULL), '{}') AS days
     FROM Schedule s
     LEFT JOIN ScheduleDays sd ON sd.sched = s.id
     GROUP BY s.id
     ORDER BY s.id`);
  res.json({ data: rows });
}));

// ---------- Departments (public) ----------

// Every open department with how many doctors and services it has
app.get('/public/departments', route(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT dep.id, dep.name, dep.slug, dep.short_description AS "shortDescription", dep.icon,
            dep.image_url AS "imageUrl",
            (SELECT COUNT(*) FROM Doctor d WHERE d.specialization = dep.name AND d.is_active)::int AS "doctorCount",
            (SELECT COUNT(*) FROM DepartmentService ds WHERE ds.department_id = dep.id AND ds.is_active)::int AS "serviceCount"
     FROM Department dep
     WHERE dep.is_active
     ORDER BY dep.sort_order, dep.name`);
  res.json({ data: rows });
}));

// One department with its services, its doctors and the days they see patients
app.get('/public/departments/:slug', route(async (req, res) => {
  const department = await loadActiveDepartment(req.params.slug);
  const { rows: services } = await pool.query(
    `SELECT id, name, description FROM DepartmentService
     WHERE department_id = $1 AND is_active
     ORDER BY sort_order, name`,
    [department.id]);
  const { rows: doctors } = await pool.query(
    `${PUBLIC_DOCTOR_SELECT}
     WHERE d.specialization = $1 AND d.is_active
     GROUP BY d.email, dep.id
     ORDER BY d.name`,
    [department.name]);
  const consultationDays = [...new Set(doctors.flatMap(d => d.days))];
  res.json({ data: { ...department, services, doctors, consultationDays } });
}));

// Free appointment slots of every doctor in a department on one date.
// Only start times are shown, never who booked the other times.
app.get('/public/departments/:slug/availability', route(async (req, res) => {
  const department = await loadActiveDepartment(req.params.slug);
  const date = str(req.query.date).trim();
  const dateError = v.checkAppointmentDate(date);
  if (dateError) throw new HttpError(400, dateError, { date: dateError });
  const doctorId = str(req.query.doctor).trim();
  if (doctorId && !/^\d{1,9}$/.test(doctorId)) throw new HttpError(400, 'Choose a valid doctor');
  const { rows: doctors } = await pool.query(
    `SELECT id, email, name FROM Doctor
     WHERE specialization = $1 AND is_active AND ($2::int IS NULL OR id = $2::int)
     ORDER BY name`,
    [department.name, doctorId || null]);
  const data = [];
  for (const doctor of doctors) {
    data.push({ id: doctor.id, name: doctor.name, slots: await freeSlots(pool, doctor.email, date) });
  }
  res.json({ date, data });
}));

// ---------- Accounts and login ----------

app.post('/auth/patient/register', limiters.register, route(async (req, res) => {
  const b = req.body || {};
  validate(b, {
    firstName: value => v.checkName(value, 'First name'),
    lastName: value => v.checkName(value, 'Last name'),
    email: v.checkEmail,
    phone: value => v.checkPhone(value, { required: true }),
    dob: value => v.checkDateOfBirth(value),
    gender: value => v.checkChoice(value, v.GENDERS, 'gender'),
    address: value => v.checkAddress(value),
    password: v.checkPassword,
    confirmPassword: (value, body) => (body.confirmPassword === undefined ? null : v.checkPasswordConfirmation(body.password, value)),
    conditions: value => v.checkText(value, 'Conditions', { required: false }),
    surgeries: value => v.checkText(value, 'Surgeries', { required: false }),
    medications: value => v.checkText(value, 'Medications', { required: false }),
    acceptTerms: value => (value === true ? null : 'Please accept the terms to continue'),
  });
  const email = v.normalizeEmail(b.email);
  const name = `${v.normalizeName(b.firstName)} ${v.normalizeName(b.lastName)}`;
  if (name.length > 100) throw new HttpError(400, 'Full name must be at most 100 characters', { lastName: 'Full name must be at most 100 characters' });
  const hash = await bcrypt.hash(b.password, BCRYPT_ROUNDS);

  await withTransaction(async client => {
    const { rows: existing } = await client.query('SELECT 1 FROM Patient WHERE email = $1', [email]);
    if (existing.length) {
      throw new HttpError(409, 'An account with this email already exists. Sign in instead.', { email: 'This email is already registered' });
    }
    await client.query(
      'INSERT INTO Patient (email, password, name, address, gender, phone, dob) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [email, hash, name, v.normalizeAddress(b.address), b.gender, v.normalizePhone(b.phone), str(b.dob).trim() || null]);
    const { rows: history } = await client.query(
      'INSERT INTO MedicalHistory (date, conditions, surgeries, medication) VALUES (CURRENT_DATE, $1, $2, $3) RETURNING id',
      [v.normalizeText(b.conditions) || 'none', v.normalizeText(b.surgeries) || 'none', v.normalizeText(b.medications) || 'none']);
    await client.query(
      'INSERT INTO PatientsFillHistory (patient, history) VALUES ($1, $2)',
      [email, history[0].id]);
  });

  await startSession(req, email, 'pat', false);
  res.status(201).json({ email, who: 'pat', name });
}));

app.post('/auth/doctor/register', limiters.register, route(async (req, res) => {
  const b = req.body || {};
  const departments = await activeDepartmentNames();
  if (DOCTOR_INVITE_CODE && !safeEqual(str(b.inviteCode).trim(), DOCTOR_INVITE_CODE)) {
    throw new HttpError(403, 'The invite code is not valid. Ask the hospital administrator for a code.', { inviteCode: 'Invalid invite code' });
  }
  validate(b, {
    firstName: value => v.checkName(value, 'First name'),
    lastName: value => v.checkName(value, 'Last name'),
    email: v.checkEmail,
    gender: value => v.checkChoice(value, v.GENDERS, 'gender'),
    specialization: value => v.checkChoice(value, departments, 'department'),
    schedule: value => (/^\d{1,9}$/.test(String(value || '')) ? null : 'Please choose your working hours'),
    password: v.checkPassword,
    confirmPassword: (value, body) => (body.confirmPassword === undefined ? null : v.checkPasswordConfirmation(body.password, value)),
  });
  const email = v.normalizeEmail(b.email);
  const first = v.normalizeName(b.firstName);
  const name = /^dr\.?\s/i.test(first) ? `${first} ${v.normalizeName(b.lastName)}` : `Dr. ${first} ${v.normalizeName(b.lastName)}`;
  if (name.length > 100) throw new HttpError(400, 'Full name must be at most 100 characters', { lastName: 'Full name must be at most 100 characters' });
  const hash = await bcrypt.hash(b.password, BCRYPT_ROUNDS);

  await withTransaction(async client => {
    const { rows: existing } = await client.query('SELECT 1 FROM Doctor WHERE email = $1', [email]);
    if (existing.length) {
      throw new HttpError(409, 'A doctor account with this email already exists. Sign in instead.', { email: 'This email is already registered' });
    }
    const { rows: sched } = await client.query('SELECT 1 FROM Schedule WHERE id = $1', [String(b.schedule)]);
    if (!sched.length) throw new HttpError(400, 'That schedule does not exist', { schedule: 'Please choose your working hours' });
    await client.query(
      'INSERT INTO Doctor (email, gender, password, name, specialization) VALUES ($1, $2, $3, $4, $5)',
      [email, b.gender, hash, name, b.specialization]);
    await client.query('INSERT INTO DocsHaveSchedules (sched, doctor) VALUES ($1, $2)', [String(b.schedule), email]);
  });

  await startSession(req, email, 'doc', false);
  res.status(201).json({ email, who: 'doc', name });
}));

app.post('/auth/login', limiters.login, route(async (req, res) => {
  const b = req.body || {};
  validate(b, {
    email: v.checkEmail,
    password: value => (str(value) ? null : 'Password is required'),
  });
  const email = v.normalizeEmail(b.email);
  // Administrators sign in on their own page, which sends role "admin"
  const who = b.role === 'admin' ? 'adm' : b.isDoctor === true ? 'doc' : 'pat';
  const { rows } = await pool.query(`SELECT email, password, name FROM ${tableFor(who)} WHERE email = $1`, [email]);
  const user = rows[0];
  const passwordOk = await bcrypt.compare(str(b.password), user ? user.password : DUMMY_HASH);
  // Same message whether the email or the password is wrong
  if (!user || !passwordOk) {
    throw new HttpError(401, `Incorrect email or password for ${who === 'adm' ? 'an' : 'a'} ${ROLE_NAMES[who]} account.`);
  }
  await startSession(req, user.email, who, b.remember === true);
  res.json({ email: user.email, who, name: user.name });
}));

app.post('/auth/logout', (req, res, next) => {
  if (!req.session) return res.json({ ok: true });
  // Removes the session from the database, so the old cookie stops working at once
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie('hms.sid', { httpOnly: true, sameSite: 'lax', secure: IS_PRODUCTION });
    res.json({ ok: true });
  });
});

// Who is logged in, with their display name; empty strings when nobody is
app.get('/auth/me', route(async (req, res) => {
  const user = req.session.user;
  if (!user) return res.json({ email: '', who: '', name: '' });
  const { rows } = await pool.query(`SELECT name FROM ${tableFor(user.who)} WHERE email = $1`, [user.email]);
  if (!rows.length) {
    // The account was removed while the session was still open
    req.session.destroy(() => res.json({ email: '', who: '', name: '' }));
    return;
  }
  res.json({ ...user, name: rows[0].name });
}));

app.post('/auth/password', requireLogin(), route(async (req, res) => {
  const b = req.body || {};
  validate(b, {
    oldPassword: value => (str(value) ? null : 'Current password is required'),
    newPassword: v.checkPassword,
    confirmPassword: (value, body) => (body.confirmPassword === undefined ? null : v.checkPasswordConfirmation(body.newPassword, value)),
  });
  const { email, who } = req.session.user;
  const { rows } = await pool.query(`SELECT password FROM ${tableFor(who)} WHERE email = $1`, [email]);
  if (!rows[0] || !(await bcrypt.compare(b.oldPassword, rows[0].password))) {
    throw new HttpError(400, 'Your current password is incorrect', { oldPassword: 'Your current password is incorrect' });
  }
  const hash = await bcrypt.hash(b.newPassword, BCRYPT_ROUNDS);
  await pool.query(`UPDATE ${tableFor(who)} SET password = $1 WHERE email = $2`, [hash, email]);
  // Other devices must sign in again with the new password
  await endAllSessions(email, who, req.sessionID);
  res.json({ ok: true });
}));

// Starts password recovery. The answer is the same whether or not the account exists,
// so the form cannot be used to find out who is registered.
app.post('/auth/forgot-password', limiters.passwordReset, route(async (req, res) => {
  const b = req.body || {};
  validate(b, { email: v.checkEmail });
  const email = v.normalizeEmail(b.email);
  const who = b.isDoctor === true ? 'doc' : 'pat';
  const { rows } = await pool.query(`SELECT name FROM ${tableFor(who)} WHERE email = $1`, [email]);
  if (rows.length) {
    const token = newToken();
    await pool.query('DELETE FROM PasswordReset WHERE email = $1 AND role = $2', [email, who]);
    await pool.query(
      'INSERT INTO PasswordReset (token_hash, email, role, expires_at) VALUES ($1, $2, $3, $4)',
      [hashToken(token), email, who, new Date(Date.now() + RESET_TOKEN_MS)]);
    const link = `${CLIENT_ORIGIN}/reset-password?token=${token}`;
    try {
      await sendMail({
        to: email,
        subject: 'Reset your HMS Hospital password',
        text: `Hello ${rows[0].name},\n\nUse this link within 30 minutes to choose a new password:\n${link}\n\n`
          + 'If you did not ask to reset your password, you can ignore this email.',
      });
    } catch (err) {
      console.error('Could not send password reset email:', err.message);
    }
  }
  res.json({ ok: true, message: 'If an account exists for that email, we have sent a link to reset the password. The link expires in 30 minutes.' });
}));

app.post('/auth/reset-password', limiters.passwordReset, route(async (req, res) => {
  const b = req.body || {};
  validate(b, {
    token: value => (/^[a-f0-9]{64}$/.test(str(value)) ? null : 'This reset link is not valid'),
    password: v.checkPassword,
    confirmPassword: (value, body) => (body.confirmPassword === undefined ? null : v.checkPasswordConfirmation(body.password, value)),
  });
  const hash = await bcrypt.hash(b.password, BCRYPT_ROUNDS);
  const reset = await withTransaction(async client => {
    // Each link works once and only until it expires
    const { rows } = await client.query(
      `DELETE FROM PasswordReset WHERE token_hash = $1 RETURNING email, role, expires_at`,
      [hashToken(b.token)]);
    const row = rows[0];
    if (!row || new Date(row.expires_at) < new Date()) {
      throw new HttpError(400, 'This reset link has expired or was already used. Please request a new one.');
    }
    await client.query(`UPDATE ${tableFor(row.role)} SET password = $1 WHERE email = $2`, [hash, row.email]);
    return row;
  });
  await endAllSessions(reset.email, reset.role);
  res.json({ ok: true, who: reset.role });
}));

// ---------- Profile ----------

app.get('/profile', requireLogin(), route(async (req, res) => {
  const { email, who } = req.session.user;
  if (who === 'adm') {
    const { rows } = await pool.query('SELECT name, email FROM Admin WHERE email = $1', [email]);
    return res.json({ data: rows[0] });
  }
  if (who === 'pat') {
    const { rows } = await pool.query(
      'SELECT name, email, gender, address, phone, dob FROM Patient WHERE email = $1', [email]);
    return res.json({ data: rows[0] });
  }
  const { rows } = await pool.query(
    `SELECT d.name, d.email, d.gender, d.specialization,
            s.starttime AS "startTime", s.endtime AS "endTime", s.breaktime AS "breakTime",
            COALESCE(ARRAY_AGG(sd.day) FILTER (WHERE sd.day IS NOT NULL), '{}') AS days
     FROM Doctor d
     LEFT JOIN DocsHaveSchedules dhs ON dhs.doctor = d.email
     LEFT JOIN Schedule s ON s.id = dhs.sched
     LEFT JOIN ScheduleDays sd ON sd.sched = s.id
     WHERE d.email = $1
     GROUP BY d.email, s.id
     LIMIT 1`,
    [email]);
  res.json({ data: rows[0] });
}));

app.put('/profile', requireLogin(), route(async (req, res) => {
  const { email, who } = req.session.user;
  const b = req.body || {};
  if (who === 'adm') {
    validate(b, { name: value => v.checkName(value, 'Full name', { min: 2, max: 100 }) });
    await pool.query('UPDATE Admin SET name = $1 WHERE email = $2', [v.normalizeName(b.name), email]);
  } else if (who === 'pat') {
    validate(b, {
      name: value => v.checkName(value, 'Full name', { min: 2, max: 100 }),
      address: value => v.checkAddress(value),
      phone: value => v.checkPhone(value),
      dob: value => v.checkDateOfBirth(value),
    });
    await pool.query(
      'UPDATE Patient SET name = $1, address = $2, phone = $3, dob = $4 WHERE email = $5',
      [v.normalizeName(b.name), v.normalizeAddress(b.address), v.normalizePhone(b.phone), str(b.dob).trim() || null, email]);
  } else {
    const departments = await activeDepartmentNames();
    validate(b, {
      name: value => v.checkName(value, 'Full name', { min: 2, max: 100 }),
      specialization: value => v.checkChoice(value, departments, 'department'),
    });
    await pool.query(
      'UPDATE Doctor SET name = $1, specialization = $2, updated_at = NOW() WHERE email = $3',
      [v.normalizeName(b.name), b.specialization, email]);
  }
  res.json({ ok: true });
}));

// ---------- Doctors ----------

// Doctor list for the booking form, with their department and working days (never includes passwords)
app.get('/doctors', requireLogin(), route(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.id, d.name, d.email, d.specialization, d.gender, d.consultation_fee::float AS "consultationFee",
            d.is_demo AS "isDemo",
            COALESCE(ARRAY_AGG(DISTINCT sd.day) FILTER (WHERE sd.day IS NOT NULL), '{}') AS days
     FROM Doctor d
     JOIN Department dep ON dep.name = d.specialization
     LEFT JOIN DocsHaveSchedules dhs ON dhs.doctor = d.email
     LEFT JOIN ScheduleDays sd ON sd.sched = dhs.sched
     WHERE d.is_active AND dep.is_active
     GROUP BY d.email
     ORDER BY d.name`);
  res.json({ data: rows });
}));

// Free one-hour slots of a doctor on one date
app.get('/doctors/:email/slots', requireLogin(), route(async (req, res) => {
  const date = str(req.query.date);
  if (!v.isCalendarDate(date)) throw new HttpError(400, 'Enter a valid date');
  if (v.checkAppointmentDate(date)) return res.json({ data: [] });
  const { rows: bookable } = await pool.query(BOOKABLE_DOCTOR, [v.normalizeEmail(req.params.email)]);
  if (!bookable.length) return res.json({ data: [] });
  res.json({ data: await freeSlots(pool, bookable[0].email, date) });
}));

// ---------- Appointments ----------

// Books an appointment for the logged-in patient after checking for clashes
app.post('/appointments', requireLogin('pat'), route(async (req, res) => {
  const b = req.body || {};
  validate(b, {
    doctor: v.checkEmail,
    date: value => v.checkAppointmentDate(value),
    startTime: v.checkTime,
    concerns: value => v.checkText(value, 'Reason for visit', { min: 3 }),
    symptoms: value => v.checkText(value, 'Symptoms', { min: 3 }),
  });
  const doctor = v.normalizeEmail(b.doctor);
  const date = b.date.trim();
  const [hours, mins] = b.startTime.trim().split(':').map(Number);
  const startMinutes = hours * 60 + mins;
  if (date === todayString() && startMinutes <= nowMinutes()) {
    throw new HttpError(400, 'That time has already passed today', { startTime: 'That time has already passed today' });
  }
  const endMinutes = startMinutes + APPOINTMENT_MINUTES;
  if (endMinutes > 24 * 60) throw new HttpError(400, 'Appointment must end before midnight');
  const start = formatTime(startMinutes);
  const end = formatTime(endMinutes);
  const patient = req.session.user.email;

  const id = await withTransaction(async client => {
    // Lock the doctor's row so two bookings for the same doctor can't race each other
    const { rows: doc } = await client.query(`${BOOKABLE_DOCTOR} FOR UPDATE OF d`, [doctor]);
    if (!doc.length) throw new HttpError(404, 'This doctor is not taking appointments at the moment. Please choose another doctor.');

    const { rows: onShift } = await client.query(
      `SELECT 1 FROM DocsHaveSchedules dhs
       JOIN Schedule s ON s.id = dhs.sched
       JOIN ScheduleDays sd ON sd.sched = s.id
       WHERE dhs.doctor = $1 AND sd.day = TO_CHAR($2::date, 'FMDay')
         AND $3::time >= s.starttime AND $4::time <= s.endtime
         AND ($4::time <= s.breaktime OR $3::time >= s.breaktime + INTERVAL '1 hour')
       LIMIT 1`,
      [doctor, date, start, end]);
    if (!onShift.length) {
      throw new HttpError(409, 'The doctor is not working or is on a break at that time. Try another doctor or date/time.');
    }

    const { rows: doctorBusy } = await client.query(
      `SELECT 1 FROM Appointment
       WHERE doctor = $1 AND date = $2 AND starttime < $3 AND endtime > $4
       LIMIT 1`,
      [doctor, date, end, start]);
    if (doctorBusy.length) {
      throw new HttpError(409, 'The doctor already has an appointment at that time. Try another doctor or date/time.');
    }

    const { rows: patientBusy } = await client.query(
      `SELECT 1 FROM Appointment a
       JOIN PatientsAttendAppointments p ON p.appt = a.id
       WHERE p.patient = $1 AND a.date = $2 AND a.status = 'NotDone' AND a.starttime < $3 AND a.endtime > $4
       LIMIT 1`,
      [patient, date, end, start]);
    if (patientBusy.length) {
      throw new HttpError(409, 'You already have an appointment at that time.');
    }

    const { rows: appt } = await client.query(
      'INSERT INTO Appointment (doctor, date, starttime, endtime) VALUES ($1, $2, $3, $4) RETURNING id',
      [doctor, date, start, end]);
    await client.query(
      'INSERT INTO PatientsAttendAppointments (patient, appt, concerns, symptoms) VALUES ($1, $2, $3, $4)',
      [patient, appt[0].id, v.normalizeText(b.concerns), v.normalizeText(b.symptoms)]);
    return appt[0].id;
  });

  res.status(201).json({ id });
}));

// Appointments of the logged-in patient or doctor, newest first
app.get('/appointments', requireLogin('pat', 'doc'), route(async (req, res) => {
  const { email, who } = req.session.user;
  const column = who === 'pat' ? 'p.patient' : 'a.doctor';
  const { rows } = await pool.query(
    `${APPOINTMENT_SELECT}
     WHERE ${column} = $1
     ORDER BY a.date DESC, a.starttime DESC`,
    [email]);
  res.json({ data: rows });
}));

// One appointment with its diagnosis, for its patient or its doctor
app.get('/appointments/:id', requireLogin(), route(async (req, res) => {
  const appt = await loadAppointmentFor(req.session.user, req.params.id);
  const { rows } = await pool.query(`${APPOINTMENT_SELECT} WHERE a.id = $1`, [appt.id]);
  if (!rows.length) throw new HttpError(404, 'Appointment not found');
  res.json({ data: rows[0] });
}));

// Patients cancel upcoming appointments or remove finished ones from their list;
// doctors can only cancel upcoming ones
app.delete('/appointments/:id', requireLogin(), route(async (req, res) => {
  const user = req.session.user;
  const appt = await loadAppointmentFor(user, req.params.id);
  if (appt.status === 'NotDone') {
    // Deleting frees the slot for other patients
    await pool.query('DELETE FROM Appointment WHERE id = $1', [appt.id]);
  } else if (user.who === 'pat') {
    // Keep the doctor's record of a completed appointment; just hide it from the patient
    await pool.query(
      'DELETE FROM PatientsAttendAppointments WHERE appt = $1 AND patient = $2',
      [appt.id, user.email]);
  } else {
    throw new HttpError(400, 'Completed appointments cannot be cancelled');
  }
  res.json({ ok: true });
}));

// Saves (or updates) the doctor's diagnosis and marks the appointment done
app.post('/appointments/:id/diagnosis', requireLogin('doc'), route(async (req, res) => {
  const b = req.body || {};
  validate(b, {
    diagnosis: value => v.checkText(value, 'Diagnosis', { min: 2 }),
    prescription: value => v.checkText(value, 'Prescription', { min: 2 }),
  });
  const appt = await loadAppointmentFor(req.session.user, req.params.id);
  await withTransaction(async client => {
    await client.query(
      `INSERT INTO Diagnose (appt, doctor, diagnosis, prescription) VALUES ($1, $2, $3, $4)
       ON CONFLICT (appt, doctor) DO UPDATE
       SET diagnosis = EXCLUDED.diagnosis, prescription = EXCLUDED.prescription`,
      [appt.id, appt.doctor, v.normalizeText(b.diagnosis), v.normalizeText(b.prescription)]);
    await client.query("UPDATE Appointment SET status = 'Done' WHERE id = $1", [appt.id]);
  });
  res.json({ ok: true });
}));

// ---------- Patients and medical history ----------

// Patients who have booked with the logged-in doctor, optionally filtered by name,
// with their visit counts and next upcoming visit
app.get('/patients', requireLogin('doc'), route(async (req, res) => {
  const name = str(req.query.name).trim().slice(0, 100);
  // Treat % and _ typed by the user as plain characters, not LIKE wildcards
  const pattern = `%${name.replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
  const { rows } = await pool.query(
    `SELECT pt.name, pt.email, pt.gender, pt.dob,
            COUNT(a.id)::int AS visits,
            MAX(a.date) FILTER (WHERE a.status = 'Done') AS "lastVisit",
            MIN(a.date) FILTER (WHERE a.status = 'NotDone') AS "nextVisit"
     FROM Patient pt
     JOIN PatientsAttendAppointments p ON p.patient = pt.email
     JOIN Appointment a ON a.id = p.appt
     WHERE a.doctor = $1 AND pt.name ILIKE $2
     GROUP BY pt.email
     ORDER BY pt.name`,
    [req.session.user.email, pattern]);
  res.json({ data: rows });
}));

// A patient's profile and the medical history they gave when registering
app.get('/patients/:email/history', requireLogin(), route(async (req, res) => {
  const patient = v.normalizeEmail(req.params.email);
  await checkPatientAccess(req.session.user, patient);
  const { rows } = await pool.query(
    `SELECT pt.gender, pt.name, pt.email, pt.address, pt.phone, pt.dob,
            m.date AS "recordedOn", m.conditions, m.surgeries, m.medication
     FROM Patient pt
     JOIN PatientsFillHistory h ON h.patient = pt.email
     JOIN MedicalHistory m ON m.id = h.history
     WHERE pt.email = $1`,
    [patient]);
  if (!rows.length) throw new HttpError(404, 'No medical history found for this patient');
  res.json({ data: rows[0] });
}));

// Every visit of one patient (all doctors), with diagnoses where given
app.get('/patients/:email/visits', requireLogin(), route(async (req, res) => {
  const patient = v.normalizeEmail(req.params.email);
  await checkPatientAccess(req.session.user, patient);
  const { rows } = await pool.query(
    `${APPOINTMENT_SELECT}
     WHERE p.patient = $1
     ORDER BY a.date DESC, a.starttime DESC`,
    [patient]);
  res.json({ data: rows });
}));

// ---------- Errors ----------

// ---------- Administration (administrators only) ----------

const requireAdmin = requireLogin('adm');
const asBoolean = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const optional = value => v.cleanText(value) || null;

function checkId(id, what) {
  if (!/^\d{1,9}$/.test(String(id))) throw new HttpError(404, `${what} not found`);
  return Number(id);
}

const departmentRules = {
  name: v.checkDepartmentName,
  slug: (value, body) => v.checkSlug(str(value).trim() || v.slugify(body.name)),
  shortDescription: value => v.checkText(value, 'Short description', { min: 10, max: 160 }),
  description: value => v.checkText(value, 'Description', { min: 30, max: 2000 }),
  commonConcerns: value => v.checkLines(value, 'Common concerns'),
  icon: value => v.checkChoice(value, v.DEPARTMENT_ICONS, 'icon'),
  imageUrl: v.checkImageUrl,
  phone: v.checkContactPhone,
  email: v.checkOptionalEmail,
  location: value => v.checkText(value, 'Location', { required: false, max: 120 }),
  operatingHours: value => v.checkText(value, 'Operating hours', { required: false, max: 200 }),
  instructions: value => v.checkText(value, 'Instructions', { required: false, max: 500 }),
  sortOrder: value => v.checkWholeNumber(value, 'Display order', { max: 999 }),
};

const departmentValues = b => [
  v.cleanText(b.name),
  str(b.slug).trim() || v.slugify(b.name),
  v.normalizeText(b.shortDescription),
  v.normalizeText(b.description),
  v.splitLines(b.commonConcerns),
  b.icon,
  optional(b.imageUrl),
  optional(b.phone),
  optional(b.email) && v.normalizeEmail(b.email),
  optional(b.location),
  optional(b.operatingHours),
  optional(b.instructions),
  Number(b.sortOrder || 0),
];

// Name and web address must be unique: say which one is taken instead of a generic error
async function checkDepartmentUnique(db, b, exceptId = 0) {
  const name = v.cleanText(b.name);
  const slug = str(b.slug).trim() || v.slugify(b.name);
  const { rows } = await db.query(
    'SELECT name, slug FROM Department WHERE (LOWER(name) = LOWER($1) OR slug = $2) AND id <> $3',
    [name, slug, exceptId]);
  const fields = {};
  if (rows.some(r => r.name.toLowerCase() === name.toLowerCase())) fields.name = 'Another department already has this name';
  if (rows.some(r => r.slug === slug)) fields.slug = 'Another department already uses this web address';
  if (Object.keys(fields).length) throw new HttpError(409, Object.values(fields)[0], fields);
}

app.get('/admin/departments', requireAdmin, route(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT dep.id, dep.name, dep.slug, dep.icon, dep.is_active AS "isActive", dep.sort_order AS "sortOrder",
            dep.updated_at AS "updatedAt",
            (SELECT COUNT(*) FROM Doctor d WHERE d.specialization = dep.name)::int AS "doctorCount",
            (SELECT COUNT(*) FROM Doctor d WHERE d.specialization = dep.name AND d.is_active)::int AS "activeDoctorCount",
            (SELECT COUNT(*) FROM DepartmentService ds WHERE ds.department_id = dep.id AND ds.is_active)::int AS "serviceCount"
     FROM Department dep
     ORDER BY dep.sort_order, dep.name`);
  res.json({ data: rows });
}));

app.get('/admin/departments/:id', requireAdmin, route(async (req, res) => {
  const id = checkId(req.params.id, 'Department');
  const { rows } = await pool.query(`${DEPARTMENT_SELECT} WHERE dep.id = $1`, [id]);
  if (!rows.length) throw new HttpError(404, 'Department not found');
  const { rows: services } = await pool.query(
    `SELECT id, name, description, sort_order AS "sortOrder", is_active AS "isActive"
     FROM DepartmentService WHERE department_id = $1 ORDER BY sort_order, name`,
    [id]);
  const { rows: doctors } = await pool.query(
    'SELECT id, name, is_active AS "isActive" FROM Doctor WHERE specialization = $1 ORDER BY name',
    [rows[0].name]);
  res.json({ data: { ...rows[0], services, doctors } });
}));

app.post('/admin/departments', requireAdmin, route(async (req, res) => {
  const b = req.body || {};
  validate(b, departmentRules);
  const id = await withTransaction(async client => {
    await checkDepartmentUnique(client, b);
    const { rows } = await client.query(
      `INSERT INTO Department (name, slug, short_description, description, common_concerns, icon, image_url,
                               phone, email, location, operating_hours, instructions, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id`,
      [...departmentValues(b), asBoolean(b.isActive, true)]);
    return rows[0].id;
  });
  res.status(201).json({ id });
}));

// Renaming a department also renames it on its doctors (ON UPDATE CASCADE)
app.put('/admin/departments/:id', requireAdmin, route(async (req, res) => {
  const id = checkId(req.params.id, 'Department');
  const b = req.body || {};
  validate(b, departmentRules);
  await withTransaction(async client => {
    const { rows } = await client.query('SELECT is_active FROM Department WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) throw new HttpError(404, 'Department not found');
    await checkDepartmentUnique(client, b, id);
    await client.query(
      `UPDATE Department SET name = $1, slug = $2, short_description = $3, description = $4, common_concerns = $5,
              icon = $6, image_url = $7, phone = $8, email = $9, location = $10, operating_hours = $11,
              instructions = $12, sort_order = $13, is_active = $14, updated_at = NOW()
       WHERE id = $15`,
      [...departmentValues(b), asBoolean(b.isActive, rows[0].is_active), id]);
  });
  res.json({ ok: true });
}));

const serviceRules = {
  name: value => v.checkText(value, 'Service name', { min: 2, max: 100 }),
  description: value => v.checkText(value, 'Description', { required: false, max: 300 }),
  sortOrder: value => v.checkWholeNumber(value, 'Display order', { max: 999 }),
};

async function checkServiceUnique(db, departmentId, name, exceptId = 0) {
  const { rows } = await db.query(
    'SELECT 1 FROM DepartmentService WHERE department_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3',
    [departmentId, v.normalizeText(name), exceptId]);
  if (rows.length) {
    throw new HttpError(409, 'This department already has a service with that name', { name: 'This department already has a service with that name' });
  }
}

app.post('/admin/departments/:id/services', requireAdmin, route(async (req, res) => {
  const departmentId = checkId(req.params.id, 'Department');
  const b = req.body || {};
  validate(b, serviceRules);
  const id = await withTransaction(async client => {
    const { rows: dep } = await client.query('SELECT id FROM Department WHERE id = $1 FOR UPDATE', [departmentId]);
    if (!dep.length) throw new HttpError(404, 'Department not found');
    await checkServiceUnique(client, departmentId, b.name);
    const { rows } = await client.query(
      `INSERT INTO DepartmentService (department_id, name, description, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [departmentId, v.normalizeText(b.name), optional(b.description), Number(b.sortOrder || 0), asBoolean(b.isActive, true)]);
    return rows[0].id;
  });
  res.status(201).json({ id });
}));

app.put('/admin/services/:id', requireAdmin, route(async (req, res) => {
  const id = checkId(req.params.id, 'Service');
  const b = req.body || {};
  validate(b, serviceRules);
  await withTransaction(async client => {
    const { rows } = await client.query('SELECT department_id, is_active FROM DepartmentService WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) throw new HttpError(404, 'Service not found');
    await checkServiceUnique(client, rows[0].department_id, b.name, id);
    await client.query(
      `UPDATE DepartmentService SET name = $1, description = $2, sort_order = $3, is_active = $4, updated_at = NOW()
       WHERE id = $5`,
      [v.normalizeText(b.name), optional(b.description), Number(b.sortOrder || 0), asBoolean(b.isActive, rows[0].is_active), id]);
  });
  res.json({ ok: true });
}));

app.delete('/admin/services/:id', requireAdmin, route(async (req, res) => {
  const id = checkId(req.params.id, 'Service');
  const { rowCount } = await pool.query('DELETE FROM DepartmentService WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Service not found');
  res.json({ ok: true });
}));

app.get('/admin/doctors', requireAdmin, route(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.id, d.name, d.email, d.gender, d.specialization, d.qualifications,
            d.experience_years AS "experienceYears", d.consultation_fee::float AS "consultationFee",
            d.languages, d.bio, d.profile_image_url AS "photoUrl", d.is_active AS "isActive", d.is_demo AS "isDemo",
            (SELECT MIN(sched) FROM DocsHaveSchedules WHERE doctor = d.email) AS schedule,
            (SELECT COUNT(*) FROM Appointment a WHERE a.doctor = d.email AND a.status = 'NotDone' AND a.date >= CURRENT_DATE)::int AS "upcomingAppointments"
     FROM Doctor d
     ORDER BY d.name`);
  res.json({ data: rows });
}));

// Updates a doctor's department, public profile, schedule and whether they take bookings.
// Existing appointments are kept; a deactivated doctor simply gets no new bookings.
app.put('/admin/doctors/:id', requireAdmin, route(async (req, res) => {
  const id = checkId(req.params.id, 'Doctor');
  const b = req.body || {};
  const { rows: deps } = await pool.query('SELECT name FROM Department');
  validate(b, {
    specialization: value => v.checkChoice(value, deps.map(d => d.name), 'department'),
    qualifications: value => v.checkText(value, 'Qualifications', { required: false, max: 200 }),
    experienceYears: value => v.checkWholeNumber(value, 'Years of experience', { max: 70 }),
    consultationFee: v.checkFee,
    languages: value => v.checkText(value, 'Languages', { required: false, max: 200 }),
    bio: value => v.checkText(value, 'Profile', { required: false, max: 500 }),
    photoUrl: v.checkImageUrl,
    schedule: value => (value === undefined || value === null || value === '' || /^\d{1,9}$/.test(String(value))
      ? null : 'Please choose working hours'),
  });
  await withTransaction(async client => {
    const { rows } = await client.query('SELECT email, is_active, is_demo FROM Doctor WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) throw new HttpError(404, 'Doctor not found');
    const doctor = rows[0];
    await client.query(
      `UPDATE Doctor SET specialization = $1, qualifications = $2, experience_years = $3, consultation_fee = $4,
              languages = $5, bio = $6, profile_image_url = $7, is_active = $8, is_demo = $9, updated_at = NOW()
       WHERE id = $10`,
      [b.specialization, optional(b.qualifications),
        v.cleanText(String(b.experienceYears ?? '')) === '' ? null : Number(b.experienceYears),
        v.cleanText(String(b.consultationFee ?? '')) === '' ? null : Number(b.consultationFee),
        optional(b.languages), optional(b.bio), optional(b.photoUrl),
        asBoolean(b.isActive, doctor.is_active), asBoolean(b.isDemo, doctor.is_demo), id]);
    if (b.schedule !== undefined && b.schedule !== null && b.schedule !== '') {
      const { rows: sched } = await client.query('SELECT 1 FROM Schedule WHERE id = $1', [String(b.schedule)]);
      if (!sched.length) throw new HttpError(400, 'That schedule does not exist', { schedule: 'Please choose working hours' });
      await client.query('DELETE FROM DocsHaveSchedules WHERE doctor = $1', [doctor.email]);
      await client.query('INSERT INTO DocsHaveSchedules (sched, doctor) VALUES ($1, $2)', [String(b.schedule), doctor.email]);
    }
  });
  res.json({ ok: true });
}));

app.use((req, res, next) => next(new HttpError(404, 'Not found')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json(err.fields ? { error: err.message, fields: err.fields } : { error: err.message });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request is too large' });
  }
  // A database CHECK constraint caught invalid data that slipped past validation
  if (err.code === '23514' || err.code === '22001' || err.code === '22007' || err.code === '22008') {
    return res.status(400).json({ error: 'Some of the information is not in a valid format' });
  }
  if (err.code === '23505') {
    return res.status(409).json({ error: 'This record already exists' });
  }
  // The database is down or unreachable: say so instead of showing made-up data
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', '57P01', '57P03', '53300'].includes(err.code)) {
    console.error(`${req.method} ${req.path} failed: database unavailable (${err.code})`);
    return res.status(503).json({ error: 'The hospital system is temporarily unavailable. Please try again in a few minutes.' });
  }
  // Log only the message and code: never request bodies, which can hold passwords or medical data
  console.error(`${req.method} ${req.path} failed:`, err.code || '', err.message);
  res.status(500).json({ error: 'Something went wrong, please try again' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
  });
}

module.exports = app;
