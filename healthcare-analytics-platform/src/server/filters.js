// Validates the dashboard filters and turns them into a parameterised WHERE clause.
// Nothing from the request is ever placed in SQL text; values go in as $n parameters.

const STATUSES = ['scheduled', 'completed', 'unresolved', 'removed'];
const MAX_RANGE_DAYS = 3 * 366;

class FilterError extends Error {
  constructor(message, field) {
    super(message);
    this.status = 400;
    this.field = field;
  }
}

const isoDate = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
};

function parseDate(value, field) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new FilterError(`${field} must be a date like 2026-01-31`, field);
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || isoDate(d) !== value) throw new FilterError(`${field} is not a real date`, field);
  return value;
}

// Defaults: the last 12 months up to four weeks ahead
function parseFilters(query, today = isoDate(new Date())) {
  const one = name => {
    const v = query[name];
    if (Array.isArray(v)) throw new FilterError(`Give ${name} only once`, name);
    return v === undefined || v === '' ? undefined : String(v);
  };
  const from = one('from') ? parseDate(one('from'), 'from') : addDays(today, -365);
  const to = one('to') ? parseDate(one('to'), 'to') : addDays(today, 28);
  if (from > to) throw new FilterError('from must be on or before to', 'from');
  const days = (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000 + 1;
  if (days > MAX_RANGE_DAYS) throw new FilterError('The date range can be at most three years', 'to');

  let department;
  if (one('department')) {
    if (!/^\d{1,9}$/.test(one('department'))) throw new FilterError('department must be a department number', 'department');
    department = Number(one('department'));
  }
  let doctor;
  if (one('doctor')) {
    if (!/^doc_[a-z0-9]{1,40}$/.test(one('doctor'))) throw new FilterError('doctor is not a valid doctor key', 'doctor');
    doctor = one('doctor');
  }
  let status;
  if (one('status')) {
    if (!STATUSES.includes(one('status'))) throw new FilterError(`status must be one of ${STATUSES.join(', ')}`, 'status');
    status = one('status');
  }
  return { from, to, days, department, doctor, status };
}

// WHERE clause over analytics_marts.appointments (alias a)
function whereClause(f, { alias = 'a', withStatus = true, from = f.from, to = f.to } = {}) {
  const params = [from, to];
  const parts = [`${alias}.appt_date BETWEEN $1::date AND $2::date`];
  if (f.department !== undefined) { params.push(f.department); parts.push(`${alias}.department_sk = $${params.length}`); }
  if (f.doctor !== undefined) { params.push(f.doctor); parts.push(`${alias}.doctor_key = $${params.length}`); }
  if (withStatus && f.status !== undefined) { params.push(f.status); parts.push(`${alias}.status = $${params.length}`); }
  return { sql: parts.join(' AND '), params };
}

module.exports = { parseFilters, whereClause, FilterError, STATUSES, addDays };
