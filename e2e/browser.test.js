// End-to-end tests in a real browser (Chromium through Playwright).
// Start the backend (npm start in backend/) and the frontend (npm start in frontend/)
// with the sample data loaded, then run: npm install && npx playwright install chromium && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PATIENT = { email: 'ramesh@example.com', password: 'password12' };

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

// A page that records console errors; expected 401s from wrong passwords can be allowed
async function openPage(options = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.errors = [];
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', e => page.errors.push(e.message));
  return { context, page };
}

async function signIn(page, { remember = false } = {}) {
  await page.goto(`${BASE}/login`);
  await page.fill('#email', PATIENT.email);
  await page.fill('#password', PATIENT.password);
  if (remember) await page.check('#remember');
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/patient`);
}

test('signed-in user stays signed in after a refresh, with no sign-in page flash', async () => {
  const { context, page } = await openPage();
  await signIn(page);
  const seen = [];
  page.on('framenavigated', f => { if (f === page.mainFrame()) seen.push(f.url()); });
  await page.reload();
  await page.waitForSelector('.welcome');
  assert.equal(page.url(), `${BASE}/patient`);
  assert.ok(!seen.some(u => u.includes('/login')), `visited ${seen}`);
  assert.equal(await page.locator('text=Sign in').count(), 0);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('"Keep me signed in" survives closing the browser; a normal sign-in does not', async () => {
  for (const remember of [true, false]) {
    const first = await openPage();
    await signIn(first.page, { remember });
    const state = await first.context.storageState();
    await first.context.close();
    // A browser restart keeps only cookies with an expiry date
    state.cookies = state.cookies.filter(c => c.expires > 0);
    const second = await openPage({ storageState: state });
    await second.page.goto(`${BASE}/patient`);
    await second.page.waitForLoadState('networkidle');
    assert.equal(second.page.url(), remember ? `${BASE}/patient` : `${BASE}/login`, `remember=${remember}`);
    await second.context.close();
  }
});

test('the session cookie cannot be read by page scripts and nothing is kept in localStorage', async () => {
  const { context, page } = await openPage();
  await signIn(page);
  const { cookie, stored } = await page.evaluate(() => ({ cookie: document.cookie, stored: Object.keys(localStorage) }));
  assert.equal(cookie.includes('hms.sid'), false);
  assert.deepEqual(stored, []);
  await context.close();
});

test('signing out ends the session; Back does not show the dashboard', async () => {
  const { context, page } = await openPage();
  await signIn(page);
  await page.click('.user-button');
  await page.click('text=Sign out');
  await page.waitForURL(`${BASE}/login`);
  await page.goBack();
  await page.waitForLoadState('networkidle');
  assert.equal(page.url(), `${BASE}/login`);
  await context.close();
});

test('logged-out visitors are sent to sign in; signed-in users are kept out of the sign-in page and other roles', async () => {
  const { context, page } = await openPage();
  await page.goto(`${BASE}/patient/records`);
  await page.waitForURL(`${BASE}/login`);
  await signIn(page);
  await page.goto(`${BASE}/login`);
  await page.waitForURL(`${BASE}/patient`);
  await page.goto(`${BASE}/doctor/patients`);
  await page.waitForURL(`${BASE}/patient`);
  await context.close();
});

test('wrong password shows a clear message and the form can be used with the keyboard only', async () => {
  const { context, page } = await openPage();
  await page.goto(`${BASE}/login`);
  await page.focus('#email');
  await page.keyboard.type(PATIENT.email);
  await page.keyboard.press('Tab');
  await page.keyboard.type('wrong-password1');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.alert-error');
  assert.match(await page.textContent('.alert-error'), /Incorrect email or password/);
  await context.close();
});

test('sign-up shows field messages, keeps valid input and toggles password visibility', async () => {
  const { context, page } = await openPage();
  await page.goto(`${BASE}/register`);
  await page.fill('#firstName', 'R4mesh');
  await page.fill('#lastName', 'Kumar');
  await page.fill('#phone', '98abc');
  await page.click('button[type=submit]');
  assert.match(await page.textContent('#firstName-error'), /cannot contain numbers/);
  assert.match(await page.textContent('#phone-error'), /only contain digits/);
  assert.equal(await page.inputValue('#lastName'), 'Kumar');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'firstName');
  await page.fill('#password', 'Secret1x');
  assert.equal(await page.getAttribute('#password', 'type'), 'password');
  await page.click('button[aria-controls=password]');
  assert.equal(await page.getAttribute('#password', 'type'), 'text');
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('new patient can register and lands on the dashboard', async () => {
  const { context, page } = await openPage();
  await page.goto(`${BASE}/register`);
  await page.fill('#firstName', 'Anjali');
  await page.fill('#lastName', "D'Souza");
  await page.fill('#phone', '9876501234');
  await page.selectOption('#gender', 'female');
  await page.fill('#address', 'Panjim, Goa');
  await page.fill('#email', `anjali.${Date.now()}@example.com`);
  await page.fill('#password', 'Str0ng!Pass');
  await page.fill('#confirmPassword', 'Str0ng!Pass');
  await page.check('#acceptTerms');
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/patient`);
  assert.match(await page.textContent('.welcome'), /Anjali/);
  await context.close();
});

test('pages fit a phone screen without sideways scrolling', async () => {
  const { context, page } = await openPage({ viewport: { width: 375, height: 800 } });
  for (const path of ['/', '/login', '/register', '/forgot-password']) {
    await page.goto(BASE + path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${path} overflows by ${overflow}px`);
  }
  await signIn(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `/patient overflows by ${overflow}px`);
  assert.deepEqual(page.errors, []);
  await context.close();
});

// ---------- Department pages ----------
// The admin test needs an administrator: npm run create-admin in backend/, then set
// ADMIN_EMAIL and ADMIN_PASSWORD when running these tests.
const ADMIN = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };

const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test('every department card on the home page opens its own page, which survives a refresh', async () => {
  const { context, page } = await openPage();
  await page.goto(BASE);
  const cards = page.locator('a.dept-card');
  await cards.first().waitFor();
  const count = await cards.count();
  assert.equal(count, 10);
  for (let i = 0; i < count; i += 1) {
    await page.goto(BASE);
    const card = page.locator('a.dept-card').nth(i);
    const name = (await card.locator('h3').textContent()).trim();
    const href = await card.getAttribute('href');
    await card.click();
    await page.waitForURL(BASE + href);
    await page.waitForSelector('h1');
    assert.equal((await page.textContent('h1')).trim(), name);
    assert.match(await page.textContent('nav.breadcrumb'), new RegExp(`Home.*Departments.*${name}`));
    await page.reload();
    await page.waitForSelector('h1');
    assert.equal((await page.textContent('h1')).trim(), name, `refresh on ${href}`);
  }
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('department cards work with the keyboard', async () => {
  const { context, page } = await openPage();
  await page.goto(`${BASE}/departments`);
  const card = page.locator('a.dept-card').first();
  await card.focus();
  const outline = await card.evaluate(el => getComputedStyle(el).outlineStyle);
  assert.notEqual(outline, 'none', 'the focused card shows a focus ring');
  const href = await card.getAttribute('href');
  await page.keyboard.press('Enter');
  await page.waitForURL(BASE + href);
  await context.close();
});

test('an unknown department shows a not-found page', async () => {
  const { context, page } = await openPage();
  await page.goto(`${BASE}/departments/not-a-department`);
  await page.waitForSelector("text=We couldn't find that department");
  assert.ok(await page.locator('a[href="/departments"]').count() > 0, 'links back to the departments');
  await context.close();
});

test('choosing a free time on a department page leads to a pre-filled booking after sign-in', async () => {
  const { context, page } = await openPage();
  await page.goto(`${BASE}/departments/cardiology`);
  const slot = page.locator('#availability button[aria-label^="Book Dr. Anita Desai"]').first();
  await slot.waitFor();
  const label = await slot.getAttribute('aria-label');
  await slot.click();
  await page.waitForURL(`${BASE}/login`);
  await page.fill('#email', PATIENT.email);
  await page.fill('#password', PATIENT.password);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/patient\/book/);
  await page.waitForSelector('button.slot[aria-pressed="true"]');
  const time = label.match(/at (.+?) on/)[1];
  assert.match(await page.textContent('body'), /Dr\. Anita Desai/);
  assert.equal((await page.locator('button.slot[aria-pressed="true"]', { hasText: time }).count()) > 0, true, `slot ${time} selected`);
  await context.close();
});

test('department pages fit a phone screen', async () => {
  const { context, page } = await openPage({ viewport: { width: 375, height: 800 } });
  for (const path of ['/departments', '/departments/cardiology', '/departments/neurology']) {
    await page.goto(BASE + path);
    await page.waitForLoadState('networkidle');
    assert.ok(await noOverflow(page) <= 0, `${path} overflows`);
  }
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('an administrator\'s change is saved and shown on the public page', { skip: !ADMIN.email && 'set ADMIN_EMAIL and ADMIN_PASSWORD' }, async () => {
  const { context, page } = await openPage();
  await page.goto(`${BASE}/admin/login`);
  await page.fill('#email', ADMIN.email);
  await page.fill('#password', ADMIN.password);
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/admin`);
  await page.click('a[aria-label="Edit Dermatology"]');
  await page.waitForSelector('#location');
  const location = `Block C, room ${Date.now() % 1000}`;
  await page.fill('#location', location);
  const saved = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/admin/departments/'));
  await page.click('button:has-text("Save changes")');
  assert.equal((await saved).status(), 200);
  await page.goto(`${BASE}/departments/dermatology`);
  await page.waitForSelector(`text=${location}`);
  // Signed-out visitors cannot open the admin pages
  const visitor = await openPage();
  await visitor.page.goto(`${BASE}/admin/departments/1`);
  await visitor.page.waitForURL(`${BASE}/admin/login`);
  await visitor.context.close();
  await context.close();
});
