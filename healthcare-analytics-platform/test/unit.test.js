// Unit tests that need no database
const test = require('node:test');
const assert = require('node:assert/strict');
const signature = require('cookie-signature');
const { parseFilters, whereClause, FilterError } = require('../src/server/filters');
const { toCsv, cell } = require('../src/server/csv');
const { makePseudonymizer } = require('../src/pseudonymize');
const { isTransient, summarize } = require('../src/pipeline/pipeline');
const { compare } = require('../src/tools/verify-baseline');
const { readCookie, requireAdmin } = require('../src/server/auth');

test('filters: defaults are the last year plus four weeks ahead', () => {
  const f = parseFilters({}, '2026-06-15');
  assert.equal(f.from, '2025-06-15');
  assert.equal(f.to, '2026-07-13');
  assert.equal(f.days, 394);
});

test('filters: invalid values are rejected with a 400-style error', () => {
  const bad = [{ from: '2026-02-30' }, { from: '2026/01/01' }, { from: '2026-03-01', to: '2026-02-01' },
    { from: '2020-01-01', to: '2026-01-01' }, { department: '1;DROP' }, { doctor: "doc_1' OR 1=1" },
    { status: 'cancelled' }, { status: ['done', 'done'] }];
  for (const q of bad) assert.throws(() => parseFilters(q, '2026-06-15'), FilterError, JSON.stringify(q));
});

test('filters: values only ever travel as parameters', () => {
  const f = parseFilters({ department: '3', doctor: 'doc_7', status: 'completed' }, '2026-06-15');
  const w = whereClause(f);
  assert.equal(w.sql, 'a.appt_date BETWEEN $1::date AND $2::date AND a.department_sk = $3 AND a.doctor_key = $4 AND a.status = $5');
  assert.deepEqual(w.params.slice(2), [3, 'doc_7', 'completed']);
  assert.equal(whereClause(f, { withStatus: false }).params.length, 4);
});

test('csv: quotes, nested values and formula injection', () => {
  assert.equal(cell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(cell('-5'), '-5');
  assert.equal(cell('+cmd'), "'+cmd");
  assert.equal(cell({ a: 1 }), '"{""a"":1}"');
  assert.equal(toCsv([{ a: 1, b: 'x,y' }, { a: 2 }]), 'a,b\r\n1,"x,y"\r\n2,\r\n');
  assert.equal(toCsv([]), '');
});

test('pseudonymizer: stable, keyed, case-insensitive, refuses weak keys', () => {
  const p = makePseudonymizer('a-very-long-secret-key');
  assert.equal(p('pat', 'A@x.com'), p('pat', 'a@x.com '));
  assert.match(p('pat', 'a@x.com'), /^pat_[0-9a-f]{24}$/);
  assert.notEqual(p('pat', 'a@x.com'), makePseudonymizer('another-long-secret-key')('pat', 'a@x.com'));
  assert.equal(p('pat', null), null);
  assert.throws(() => makePseudonymizer('short'));
});

test('pipeline: only temporary errors are retried, and error text drops row values', () => {
  assert.equal(isTransient({ code: '40P01' }), true);
  assert.equal(isTransient({ code: '23505' }), false);
  assert.equal(summarize(Object.assign(new Error('boom\nDETAIL: Key (email)=(a@b.c)'), { code: 'XX000' })), '[XX000] boom');
});

test('baseline comparison finds changed, missing and added files', () => {
  const r = compare({ a: '1', b: '2', c: '3' }, { a: '1', b: 'x', d: '4' });
  assert.deepEqual(r, { changed: ['b'], missing: ['c'], added: ['d'], same: false });
  assert.equal(compare({ a: '1' }, { a: '1' }).same, true);
});

test('auth: cookie parsing and signature checks', async () => {
  assert.equal(readCookie('x=1; hms.sid=s%3Aabc.def', 'hms.sid'), 's:abc.def');
  assert.equal(readCookie('', 'hms.sid'), null);
  const queries = [];
  const pool = { query: async (sql, params) => { queries.push(params); return { rows: [{ sess: { user: { who: 'pat' } } }] }; } };
  const mw = requireAdmin(pool, 'secret', '/login');
  const run = cookie => new Promise(resolve => {
    const res = { status(code) { this.code = code; return this; }, json(body) { resolve({ code: this.code, body }); } };
    mw({ headers: { cookie } }, res, () => resolve({ code: 'next' }));
  });
  assert.equal((await run(undefined)).code, 401);
  const forged = `hms.sid=${encodeURIComponent(`s:${signature.sign('sid1', 'wrong-secret')}`)}`;
  assert.equal((await run(forged)).code, 401);
  assert.equal(queries.length, 0, 'a forged cookie never reaches the database');
  const good = `hms.sid=${encodeURIComponent(`s:${signature.sign('sid1', 'secret')}`)}`;
  assert.equal((await run(good)).code, 403, 'a signed-in patient is not an administrator');
});
