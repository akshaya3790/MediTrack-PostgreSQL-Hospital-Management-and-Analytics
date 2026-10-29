// Sign-up, sign-in, sessions, remember me, logout, password change and reset
const test = require('node:test');
const assert = require('node:assert/strict');
// Room for the reset tests below; the brute-force test works out the limit from this
process.env.RATE_LIMIT_SCALE = '2';
const { startServer, Client, newPatient } = require('./helpers');

let env;
test.before(async () => { env = await startServer(); });
test.after(async () => { await env.close(); });

test('patient registration signs the new user in', async () => {
  const c = new Client(env.base);
  const body = newPatient();
  const res = await c.post('/auth/patient/register', body);
  assert.equal(res.status, 201);
  assert.equal(res.data.who, 'pat');
  assert.equal(res.data.name, 'Priya Sharma');
  const me = await c.get('/auth/me');
  assert.equal(me.data.email, body.email);
});

test('email is stored lowercased and trimmed; duplicates are refused with a clear message', async () => {
  const email = 'Duplicate.Person@Example.com';
  const first = await new Client(env.base).post('/auth/patient/register', newPatient({ email: `  ${email} ` }));
  assert.equal(first.status, 201);
  assert.equal(first.data.email, email.toLowerCase());
  const again = await new Client(env.base).post('/auth/patient/register', newPatient({ email: email.toLowerCase() }));
  assert.equal(again.status, 409);
  assert.equal(again.data.fields.email, 'This email is already registered');
});

test('phone is stored in +91 format', async () => {
  const c = new Client(env.base);
  const body = newPatient({ phone: '+91 98765-43210' });
  assert.equal((await c.post('/auth/patient/register', body)).status, 201);
  const { rows } = await env.pool.query('SELECT phone FROM Patient WHERE email = $1', [body.email]);
  assert.equal(rows[0].phone, '+919876543210');
});

test('passwords are stored as bcrypt hashes, never as plain text', async () => {
  const body = newPatient();
  await new Client(env.base).post('/auth/patient/register', body);
  const { rows } = await env.pool.query('SELECT password FROM Patient WHERE email = $1', [body.email]);
  assert.match(rows[0].password, /^\$2[aby]\$/);
  assert.notEqual(rows[0].password, body.password);
});

test('login works with the right password and gives the same message for a wrong password or unknown email', async () => {
  const c = new Client(env.base);
  const ok = await c.login('ramesh@example.com');
  assert.equal(ok.status, 200);
  assert.equal(ok.data.who, 'pat');

  const wrong = await new Client(env.base).login('suresh@example.com', 'not-the-password');
  const unknown = await new Client(env.base).login('nobody@example.com', 'whatever123');
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.data.error, unknown.data.error);
});

test('session cookie is HttpOnly and SameSite; without remember me it ends with the browser', async () => {
  const c = new Client(env.base);
  await c.login('ramesh@example.com');
  assert.match(c.lastSetCookie, /HttpOnly/i);
  assert.match(c.lastSetCookie, /SameSite=Lax/i);
  assert.doesNotMatch(c.lastSetCookie, /Expires=/i);
});

test('remember me keeps the cookie for 30 days', async () => {
  const c = new Client(env.base);
  await c.login('ramesh@example.com', 'password12', { remember: true });
  const expires = new Date(/Expires=([^;]+)/i.exec(c.lastSetCookie)[1]);
  const days = (expires - Date.now()) / 86400000;
  assert.ok(days > 29 && days <= 30, `cookie lasts ${days} days`);
});

test('session survives a page refresh (a new request with the same cookie)', async () => {
  const c = new Client(env.base);
  await c.login('ramesh@example.com');
  assert.equal((await c.get('/auth/me')).data.email, 'ramesh@example.com');
  assert.equal((await c.get('/profile')).status, 200);
});

test('logout destroys the session on the server, so a copied cookie stops working', async () => {
  const c = new Client(env.base);
  await c.login('ramesh@example.com');
  const stolen = c.cookie;
  assert.equal((await c.post('/auth/logout')).status, 200);
  const replay = new Client(env.base);
  replay.cookie = stolen;
  assert.equal((await replay.get('/profile')).status, 401);
  assert.equal((await replay.get('/auth/me')).data.email, '');
});

test('the session id changes at login (no session fixation)', async () => {
  const c = new Client(env.base);
  await c.login('ramesh@example.com');
  const first = c.cookie;
  await c.login('ramesh@example.com');
  assert.notEqual(c.cookie, first);
});

test('changing the password signs out other devices but keeps this one', async () => {
  const body = newPatient();
  const laptop = new Client(env.base);
  await laptop.post('/auth/patient/register', body);
  const phone = new Client(env.base);
  await phone.login(body.email, body.password);

  const wrongOld = await laptop.post('/auth/password', { oldPassword: 'nope', newPassword: 'N3w!Password', confirmPassword: 'N3w!Password' });
  assert.equal(wrongOld.status, 400);
  assert.ok(wrongOld.data.fields.oldPassword);

  const changed = await laptop.post('/auth/password', { oldPassword: body.password, newPassword: 'N3w!Password', confirmPassword: 'N3w!Password' });
  assert.equal(changed.status, 200);
  assert.equal((await laptop.get('/profile')).status, 200);
  assert.equal((await phone.get('/profile')).status, 401);
  assert.equal((await new Client(env.base).login(body.email, 'N3w!Password')).status, 200);
});

test('password reset: generic answer, single-use link, new password works, old sessions end', async () => {
  const body = newPatient();
  const c = new Client(env.base);
  await c.post('/auth/patient/register', body);

  const unknown = await new Client(env.base).post('/auth/forgot-password', { email: 'nobody@example.com' });
  const known = await new Client(env.base).post('/auth/forgot-password', { email: body.email });
  assert.equal(unknown.status, 200);
  assert.equal(known.status, 200);
  assert.equal(unknown.data.message, known.data.message);

  const mail = env.outbox.find(m => m.to === body.email);
  assert.ok(mail, 'reset email was sent');
  const token = /token=([a-f0-9]{64})/.exec(mail.text)[1];
  const { rows } = await env.pool.query('SELECT token_hash FROM PasswordReset WHERE email = $1', [body.email]);
  assert.notEqual(rows[0].token_hash, token, 'only a hash of the token is stored');

  const mismatch = await new Client(env.base).post('/auth/reset-password', { token, password: 'Res3t!Pass', confirmPassword: 'Different1' });
  assert.equal(mismatch.status, 400);

  const reset = await new Client(env.base).post('/auth/reset-password', { token, password: 'Res3t!Pass', confirmPassword: 'Res3t!Pass' });
  assert.equal(reset.status, 200);
  assert.equal((await c.get('/profile')).status, 401, 'existing session ended');
  assert.equal((await new Client(env.base).login(body.email, 'Res3t!Pass')).status, 200);
  assert.equal((await new Client(env.base).login(body.email, body.password)).status, 401);

  const reused = await new Client(env.base).post('/auth/reset-password', { token, password: 'An0ther!Pass', confirmPassword: 'An0ther!Pass' });
  assert.equal(reused.status, 400);
});

test('an expired reset link is refused', async () => {
  const c = new Client(env.base);
  await c.post('/auth/forgot-password', { email: 'suresh@example.com' });
  const mail = env.outbox.filter(m => m.to === 'suresh@example.com').pop();
  const token = /token=([a-f0-9]{64})/.exec(mail.text)[1];
  await env.pool.query("UPDATE PasswordReset SET expires_at = NOW() - INTERVAL '1 minute' WHERE email = 'suresh@example.com'");
  const res = await c.post('/auth/reset-password', { token, password: 'Res3t!Pass', confirmPassword: 'Res3t!Pass' });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /expired/);
});

test('repeated failed logins are rate limited', async () => {
  const c = new Client(env.base);
  const limit = 5 * Number(process.env.RATE_LIMIT_SCALE);
  const statuses = [];
  for (let i = 0; i <= limit; i += 1) {
    statuses.push((await c.login('priya@example.com', `wrong-${i}`)).status);
  }
  assert.deepEqual(statuses, [...Array(limit).fill(401), 429]);
  // Even the right password is refused until the window passes
  assert.equal((await c.login('priya@example.com')).status, 429);
  // Other accounts are not locked out by someone guessing this one
  assert.equal((await c.login('ramesh@example.com')).status, 200);
});

test('requests without the CSRF header, or from another site, are blocked', async () => {
  const noHeader = await fetch(`${env.base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ramesh@example.com', password: 'password12' }),
  });
  assert.equal(noHeader.status, 403);
  const evil = await new Client(env.base).post('/auth/login', { email: 'ramesh@example.com', password: 'password12' }, { Origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
});

test('security headers are set and errors never include stack traces', async () => {
  const res = await new Client(env.base).post('/auth/login', { email: 'x' });
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(JSON.stringify(res.data).includes('at '), false);
});
