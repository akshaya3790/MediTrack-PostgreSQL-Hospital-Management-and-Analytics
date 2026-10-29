// HMS Analytics dashboard. Plain JavaScript, no build step. Every number comes from the
// analytics API; nothing is hard-coded. Text from the API is always set with textContent.
(function () {
  'use strict';

  const API = '/analytics/api';
  const view = document.getElementById('view');
  const form = document.getElementById('filters');
  const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
  const SVGNS = 'http://www.w3.org/2000/svg';
  const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let kpiDefs = {};
  let lookups = { departments: [], doctors: [] };

  // ---------- small helpers ----------
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  }
  function s(tag, attrs, ...children) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, v);
    for (const c of children.flat()) if (c !== null && c !== undefined) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  const fmt = n => (n === null || n === undefined ? '–' : Number(n).toLocaleString('en-IN'));
  const pct = n => (n === null || n === undefined ? '–' : `${(Number(n) * 100).toFixed(1)}%`);
  const monthLabel = m => new Date(`${m}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  const dayLabel = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const fullDate = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  // Rounds an axis maximum up to a round number so tick labels stay readable
  const niceMax = v => { const p = 10 ** Math.floor(Math.log10(v)); return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(m => m * p).find(m => m >= v); };

  class ApiError extends Error {
    constructor(message, status, body) { super(message); this.status = status; this.body = body; }
  }
  async function api(path) {
    let res;
    try {
      res = await fetch(API + path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    } catch (e) {
      throw new ApiError('The analytics service cannot be reached.', 0, {});
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(body.error || 'Something went wrong.', res.status, body);
    return body;
  }

  function filterQuery(withStatus = true) {
    const data = new FormData(form);
    const q = new URLSearchParams();
    for (const [k, v] of data.entries()) if (v && (withStatus || k !== 'status')) q.set(k, v);
    return q.toString();
  }

  // ---------- states ----------
  const loading = () => view.replaceChildren(h('div', { class: 'skeleton', role: 'status', 'aria-label': 'Loading' }),
    h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
  function showError(err, retry) {
    if (err.status === 401) {
      return view.replaceChildren(h('div', { class: 'state' },
        h('h2', { text: 'Administrators only' }),
        h('p', { text: err.message }),
        h('a', { class: 'btn', href: err.body.signInUrl || '/' }, 'Sign in to the hospital app'),
        h('p', { class: 'note', text: 'After signing in, come back to this page and refresh.' })));
    }
    if (err.status === 403) return view.replaceChildren(h('div', { class: 'state error' }, h('p', { text: err.message })));
    return view.replaceChildren(h('div', { class: 'state error', role: 'alert' },
      h('p', { text: err.message }), h('button', { class: 'btn', type: 'button', onclick: retry }, 'Try again')));
  }
  const empty = message => h('div', { class: 'state' }, h('p', { text: message }));

  // ---------- tooltips for KPI definitions ----------
  const tip = h('div', { class: 'tooltip', role: 'tooltip', id: 'kpi-tip', hidden: true });
  document.body.append(tip);
  function info(id) {
    const def = kpiDefs[id];
    if (!def) return null;
    const show = e => {
      tip.textContent = def.definition;
      tip.hidden = false;
      const r = e.currentTarget.getBoundingClientRect();
      tip.style.left = `${Math.min(r.left, window.innerWidth - 330)}px`;
      tip.style.top = `${r.bottom + 6}px`;
    };
    const hide = () => { tip.hidden = true; };
    return h('button', { class: 'info', type: 'button', 'aria-label': `What is ${def.name}?`, 'aria-describedby': 'kpi-tip',
      onmouseenter: show, onfocus: show, onmouseleave: hide, onblur: hide }, 'i');
  }

  // ---------- building blocks ----------
  const kpi = (label, value, sub, id) => h('div', { class: 'kpi' },
    h('div', { class: 'label' }, label, id ? info(id) : null), h('div', { class: 'value', text: value }), sub ? h('div', { class: 'sub', text: sub }) : null);

  function pageHead(title, lead, exports) {
    const links = (exports || []).map(([report, label]) => h('a', {
      href: `${API}/export/${report}?${filterQuery()}`, download: `hms-${report}.csv` }, `Download ${label} (CSV)`));
    return [h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: title }), h('p', { class: 'lead', text: lead })),
      links.length ? h('div', { class: 'downloads' }, links) : null)];
  }

  function table(columns, rows, { onRow } = {}) {
    if (!rows.length) return empty('No data for these filters.');
    return h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, columns.map(c => h('th', { class: c.num ? 'num' : null, scope: 'col' }, c.label)))),
      h('tbody', {}, rows.map(r => {
        const tr = h('tr', onRow ? { class: 'clickable', tabindex: 0, onclick: () => onRow(r),
          onkeydown: e => { if (e.key === 'Enter') onRow(r); } } : {},
        columns.map(c => h('td', { class: c.num ? 'num' : null }, c.render ? c.render(r) : fmt(r[c.key]))));
        return tr;
      }))));
  }

  function legend(items) {
    return h('div', { class: 'legend' }, items.map(([name, color]) => {
      const sw = h('i');
      sw.style.background = color;
      return h('span', {}, sw, name);
    }));
  }

  // Line chart: series = [{ name, values: [{ x, y }] }] with shared x labels
  function lineChart(labels, series, { height = 220, yFormat = fmt, xFormat = x => x } = {}) {
    const W = 640;
    const pad = { l: 46, r: 26, t: 10, b: 28 };
    const max = niceMax(Math.max(1, ...series.flatMap(sr => sr.values.concat((sr.band || []).map(b => (b ? b[1] : 0))).map(v => v ?? 0))));
    const x = i => pad.l + (labels.length <= 1 ? 0 : (i * (W - pad.l - pad.r)) / (labels.length - 1));
    const y = v => pad.t + (height - pad.t - pad.b) * (1 - v / max);
    const svg = s('svg', { viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-label': series.map(sr => sr.name).join(', ') });
    // Pick a number of gridlines that gives round steps (e.g. 1,500 -> 0, 300, 600 ...)
    const roundStep = d => /^(0\.0*)?[1-9](0*|50*)$/.test(String(Number((max / d).toPrecision(12))));
    const ticks = [5, 4, 3, 6].find(roundStep) || 4;
    for (let i = 0; i <= ticks; i += 1) {
      const v = (max * i) / ticks;
      svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'axis' }),
        s('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, yFormat(max >= 8 ? Math.round(v) : Math.round(v * 100) / 100)));
    }
    const step = Math.max(1, Math.ceil(labels.length / 8));
    labels.forEach((lab, i) => { if (i % step === 0) svg.append(s('text', { x: x(i), y: height - 8, 'text-anchor': 'middle' }, xFormat(lab))); });
    series.forEach((sr, k) => {
      const pts = sr.values.map((v, i) => (v === null || v === undefined ? null : `${x(i)},${y(v)}`)).filter(Boolean);
      svg.append(s('polyline', { points: pts.join(' '), fill: 'none', stroke: sr.color || SERIES[k % SERIES.length], 'stroke-width': 2,
        'stroke-dasharray': sr.dashed ? '5 4' : null }));
      if (sr.band) {
        const up = sr.band.map((b, i) => (b ? `${x(i)},${y(b[1])}` : null)).filter(Boolean);
        const lo = sr.band.map((b, i) => (b ? `${x(i)},${y(b[0])}` : null)).filter(Boolean).reverse();
        svg.append(s('polygon', { points: up.concat(lo).join(' '), fill: sr.color || SERIES[k], opacity: 0.15 }));
      }
    });
    return h('div', { class: 'chart' }, svg, legend(series.map((sr, k) => [sr.name, sr.color || SERIES[k % SERIES.length]])));
  }

  function hbars(rows, { value, label, format = fmt }) {
    if (!rows.length) return empty('No data for these filters.');
    const max = Math.max(1, ...rows.map(value));
    return h('div', { class: 'hbar' }, rows.flatMap(r => {
      const bar = h('div', { class: 'bar' });
      bar.style.width = `${(value(r) / max) * 100}%`;
      return [h('div', { text: label(r) }), h('div', {}, bar), h('div', { class: 'val', text: format(value(r)) })];
    }));
  }

  // ---------- pages ----------
  async function overview() {
    const d = await api(`/overview?${filterQuery()}`);
    const k = d.kpis;
    return [
      ...pageHead('Executive overview', 'Appointments, outcomes and capacity across the hospital for the selected period.',
        [['monthly-overview', 'monthly figures']]),
      h('div', { class: 'kpis' },
        kpi('Appointments', fmt(k.appointments), `${fmt(k.removed)} removed`, 'appointments'),
        kpi('Completed', fmt(k.completed), null, 'completed'),
        kpi('Upcoming', fmt(k.scheduled), null, 'scheduled'),
        kpi('Not completed', fmt(k.unresolved), 'possible no-shows', 'unresolved'),
        kpi('Completion rate', pct(k.completionRate), 'of past appointments', 'completion_rate'),
        kpi('Not-completed rate', pct(k.notCompletedRate), 'no-show proxy', 'not_completed_rate'),
        kpi('Slot utilisation', pct(k.slotUtilization), `${fmt(k.slots)} slots offered`, 'slot_utilization'),
        kpi('Patients', k.patients === null ? 'fewer than 5' : fmt(k.patients), 'distinct, pseudonymous', 'patients')),
      h('div', { class: 'card' }, h('h2', { text: 'Monthly appointments' }),
        d.monthly.length ? lineChart(d.monthly.map(m => m.month), [
          { name: 'Appointments', values: d.monthly.map(m => m.appointments) },
          { name: 'Completed', values: d.monthly.map(m => m.completed) },
          { name: 'Not completed', values: d.monthly.map(m => m.unresolved) },
        ], { xFormat: monthLabel }) : empty('No appointments in this period.'),
        h('p', { class: 'note', text: 'The first and last months only count the days inside the selected period, so they can look low.' })),
      h('div', { class: 'grid-2' },
        h('div', { class: 'card' }, h('h2', { text: 'Appointments by department' }),
          hbars(d.departments, { value: r => r.appointments, label: r => r.name })),
        h('div', { class: 'card' }, h('h2', { text: 'Doctor workload' }),
          hbars(d.doctors.slice().sort((a, b) => b.appointments - a.appointments), { value: r => r.appointments, label: r => r.name }),
          h('p', { class: 'note', text: 'Appointment counts show workload only. They say nothing about the quality of care.' }))),
    ];
  }

  async function departments() {
    const d = await api(`/departments?${filterQuery()}`);
    const names = [...new Set(d.monthly.map(m => m.name))];
    const months = [...new Set(d.monthly.map(m => m.month))].sort();
    const top = d.departments.slice(0, 5).map(r => r.name);
    return [
      ...pageHead('Department performance', `Demand, outcomes and utilisation by department. Change in demand compares with the same length of time just before it (${fullDate(d.previousPeriod.from)} to ${fullDate(d.previousPeriod.to)}).`,
        [['departments', 'department table']]),
      h('div', { class: 'card' }, h('h2', { text: 'Departments' }),
        table([
          { label: 'Department', render: r => r.name },
          { label: 'Appointments', key: 'appointments', num: true },
          { label: 'Share', num: true, render: r => pct(r.share) },
          { label: 'Change in demand', num: true, render: r => (r.demandChange === null ? 'new' : `${r.demandChange >= 0 ? '+' : ''}${pct(r.demandChange)}`) },
          { label: 'Completed', key: 'completed', num: true },
          { label: 'Not completed', key: 'unresolved', num: true },
          { label: 'Not-completed rate', num: true, render: r => pct(r.notCompletedRate) },
          { label: 'Removed', key: 'removed', num: true },
          { label: 'Slot utilisation', num: true, render: r => pct(r.slotUtilization) },
        ], d.departments, { onRow: r => { form.department.value = String(r.id); location.hash = '#doctors'; } }),
        h('p', { class: 'note', text: 'Select a department to see its doctors. Raw appointment counts measure demand, not clinical quality.' })),
      h('div', { class: 'card' }, h('h2', { text: 'Monthly demand, five busiest departments' }),
        months.length ? lineChart(months, top.map(name => ({
          name, values: months.map(m => (d.monthly.find(x => x.month === m && x.name === name) || { appointments: 0 }).appointments),
        })), { xFormat: monthLabel }) : empty('No appointments in this period.'),
        names.length > 5 ? h('p', { class: 'note', text: 'Download the department table for every department.' }) : null),
    ];
  }

  async function doctors() {
    const d = await api(`/doctors?${filterQuery()}`);
    const dist = d.distribution;
    return [
      ...pageHead('Doctor workload', 'How appointments are spread across doctors and how much of their offered time is booked. Not a ranking of competence or outcomes.',
        [['doctors', 'doctor table']]),
      h('div', { class: 'kpis' },
        kpi('Doctors with appointments', fmt(dist.doctors)),
        kpi('Median appointments', fmt(dist.median), 'per doctor'),
        kpi('90th percentile', fmt(dist.p90), 'per doctor'),
        kpi('Range', `${fmt(dist.min)} – ${fmt(dist.max)}`)),
      h('div', { class: 'card' }, h('h2', { text: 'Doctors (alphabetical)' }),
        table([
          { label: 'Doctor', render: r => [r.name, r.isDemo ? h('span', { class: 'badge warn' }, ' demo') : null] },
          { label: 'Department', render: r => r.department },
          { label: 'Appointments', key: 'appointments', num: true },
          { label: 'Days with appointments', key: 'daysWithAppointments', num: true },
          { label: 'Completed', key: 'completed', num: true },
          { label: 'Not completed', key: 'unresolved', num: true },
          { label: 'Removed', key: 'removed', num: true },
          { label: 'Slots offered', key: 'slots', num: true },
          { label: 'Slot utilisation', num: true, render: r => [pct(r.slotUtilization), r.capacityBackfilled ? ' *' : ''] },
        ], d.doctors),
        h('p', { class: 'note', text: '* Includes days before the pipeline started, for which capacity is estimated from the doctor\'s current working hours.' })),
    ];
  }

  async function flow() {
    const d = await api(`/appointments?${filterQuery()}`);
    const maxHeat = Math.max(1, ...d.heatmap.map(c => c.appointments));
    const hours = [...new Set(d.heatmap.map(c => c.hour))].sort((a, b) => a - b);
    const heat = h('div', { class: 'heat' });
    heat.style.gridTemplateColumns = `48px repeat(${hours.length}, minmax(28px, 1fr))`;
    heat.append(h('div'), ...hours.map(hr => h('div', { text: `${hr}:00` })));
    for (let dow = 1; dow <= 7; dow += 1) {
      heat.append(h('div', { text: DAYS[dow] }));
      for (const hr of hours) {
        const c = d.heatmap.find(x => x.dow === dow && x.hour === hr);
        const cell = h('div', { title: c ? `${DAYS[dow]} ${hr}:00 — ${c.appointments} appointments, ${c.past ? pct(c.unresolved / c.past) : '–'} not completed` : 'none' },
          c ? fmt(c.appointments) : '');
        const a = c ? c.appointments / maxHeat : 0;
        cell.style.background = `rgba(15, 118, 110, ${0.08 + a * 0.75})`;
        cell.style.color = a > 0.5 ? '#fff' : 'var(--ink)';
        heat.append(cell);
      }
    }
    return [
      ...pageHead('Appointments and patient flow', 'When appointments happen, how they end, and how patients return. Patient figures are pseudonymous and groups under 5 are hidden.',
        [['weekly-flow', 'weekly figures'], ['status-distribution', 'status counts']]),
      h('div', { class: 'grid-2' },
        h('div', { class: 'card' }, h('h2', { text: 'Status' }),
          hbars(d.status, { value: r => r.appointments, label: r => r.label })),
        h('div', { class: 'card' }, h('h2', { text: 'Not-completed rate by weekday' }),
          hbars(d.byWeekday, { value: r => r.notCompletedRate || 0, label: r => r.day, format: pct }))),
      h('div', { class: 'card' }, h('h2', { text: 'Weekly bookings' }),
        d.weekly.length ? lineChart(d.weekly.map(w => w.week), [
          { name: 'Appointments', values: d.weekly.map(w => w.appointments) },
          { name: 'Not completed', values: d.weekly.map(w => w.unresolved) },
          { name: 'Removed', values: d.weekly.map(w => w.removed) },
        ], { xFormat: dayLabel }) : empty('No appointments in this period.')),
      h('div', { class: 'card' }, h('h2', { text: 'Busy times (appointments by weekday and start hour)' }), h('div', { class: 'table-wrap' }, heat)),
      h('div', { class: 'grid-2' },
        h('div', { class: 'card' }, h('h2', { text: 'Visits per patient in this period' }),
          table([{ label: 'Visits', render: r => r.bucket }, { label: 'Patients', num: true, render: r => (r.patients === null ? '< 5' : fmt(r.patients)) }],
            d.visitsPerPatient)),
        h('div', { class: 'card' }, h('h2', { text: 'Booking lead time' }),
          d.leadTime.length ? hbars(d.leadTime, { value: r => r.appointments, label: r => r.bucket }) : empty('Not measured yet.'),
          h('p', { class: 'note', text: d.leadTimeNote }))),
      h('div', { class: 'card' }, h('h2', { text: 'New and returning patients by month' }),
        d.newReturning.length ? lineChart(d.newReturning.map(r => r.month), [
          { name: 'New patients', values: d.newReturning.map(r => r.newPatients) },
          { name: 'Returning patients', values: d.newReturning.map(r => r.returningPatients) },
        ], { xFormat: monthLabel }) : empty('No patients in this period.'),
        h('p', { class: 'note', text: 'Months with fewer than 5 patients in a group are left blank.' })),
    ];
  }

  async function financial() {
    const d = await api('/financial');
    return [
      ...pageHead('Financial analytics', 'Revenue, payments and outstanding balances.'),
      h('div', { class: 'state' }, h('h2', { text: 'Not available' }), h('p', { text: d.reason }),
        h('p', { text: 'To add this page, the hospital system would need to record:' }),
        h('ul', { class: 'lead' }, d.requiredData.map(x => h('li', { text: x })))),
    ];
  }

  async function forecasts() {
    const d = await api('/forecasts');
    const byModel = Object.fromEntries(d.models.map(m => [m.model, m]));
    const out = [...pageHead('Forecasts and models', 'Results of the machine learning module, with the baselines they were compared against.',
      [['demand-forecast', 'demand forecast']])];
    if (!d.models.length) {
      out.push(empty('No models have been trained yet. Run the ML module (see the README) after the pipeline.'));
      return out;
    }
    const synthetic = d.models.some(m => m.isSynthetic);
    if (synthetic) out.push(h('div', { class: 'state', role: 'note' }, h('strong', { text: 'Trained on synthetic data. ' }),
      'These scores show the method works; they describe the rules used to generate the data, not real patients.'));

    const demand = byModel.demand_forecast;
    if (demand) {
      const card = h('div', { class: 'card' }, h('h2', { text: 'Weekly demand forecast' }));
      if (demand.status !== 'trained') card.append(h('p', { text: demand.notes || 'Not enough history to forecast.' }));
      else {
        const deps = [...new Set(d.forecast.map(f => f.department))];
        const pickDep = h('select', { 'aria-label': 'Department' }, deps.map(x => h('option', { value: x }, x)));
        const slot = h('div');
        const draw = () => {
          const dep = pickDep.value;
          const act = d.actuals.filter(a => a.department === dep);
          const fc = d.forecast.filter(f => f.department === dep);
          const weeks = [...new Set(act.map(a => a.week).concat(fc.map(f => f.week)))].sort();
          slot.replaceChildren(lineChart(weeks, [
            { name: 'Actual', values: weeks.map(w => (act.find(a => a.week === w) || {}).appointments ?? null) },
            { name: 'Forecast (80% interval shaded)', dashed: true, values: weeks.map(w => (fc.find(f => f.week === w) || {}).forecast ?? null),
              band: weeks.map(w => { const f = fc.find(x => x.week === w); return f ? [f.lower, f.upper] : null; }) },
          ], { xFormat: dayLabel }));
        };
        pickDep.addEventListener('change', draw);
        draw();
        card.append(h('label', {}, 'Department ', pickDep), slot,
          h('p', { class: 'note', text: 'Actual values for the current and future weeks are bookings made so far, so they will rise. Accuracy below comes from a rolling backtest on complete past weeks.' }),
          metricsTable(demand));
      }
      out.push(card);
    }
    const clf = byModel.not_completed_classifier;
    if (clf) {
      const card = h('div', { class: 'card' }, h('h2', { text: 'Not-completed (no-show proxy) classifier' }));
      if (clf.status !== 'trained') card.append(h('p', { text: clf.notes || 'Not enough labelled appointments.' }));
      else {
        card.append(metricsTable(clf));
        const imp = (clf.explanation && clf.explanation.permutation_importance) || [];
        if (imp.length) card.append(h('h2', { text: 'What the model relies on (permutation importance, drop in ROC-AUC)' }),
          hbars(imp.slice(0, 10), { value: r => Math.max(0, r.importance), label: r => r.feature, format: v => v.toFixed(3) }));
        card.append(h('p', { class: 'note', text: 'For planning reminders and staffing only. It must never be used to refuse or deprioritise anyone\'s care.' }));
      }
      out.push(card);
    }
    const seg = byModel.patient_segments;
    if (seg) {
      const card = h('div', { class: 'card' }, h('h2', { text: 'Patient visit-pattern segments' }));
      if (seg.status !== 'trained') card.append(h('p', { text: seg.notes || 'Not enough patients.' }));
      else {
        card.append(table([
          { label: 'Segment', render: r => r.label },
          { label: 'Patients', num: true, render: r => (r.patients === null ? '< 5' : fmt(r.patients)) },
          { label: 'Visits (median)', num: true, render: r => fmt(r.profile.visits_median) },
          { label: 'Days between visits (median)', num: true, render: r => fmt(r.profile.gap_days_median) },
          { label: 'Not-completed rate', num: true, render: r => pct(r.profile.not_completed_rate_mean) },
          { label: 'Departments (mean)', num: true, render: r => (r.profile.departments_mean ?? 0).toFixed(1) },
        ], d.segments), h('p', { class: 'note', text: `${seg.notes || ''} Based on visit behaviour only; no medical or personal attributes are used.` }));
      }
      out.push(card);
    }
    return out;
  }

  function metricsTable(m) {
    const LABELS = { roc_auc: 'ROC-AUC', pr_auc: 'PR-AUC (precision-recall)', precision: 'Precision', recall: 'Recall', f1: 'F1',
      flagged_share: 'Share of appointments flagged', base_rate: 'Actual not-completed rate', brier: 'Brier score (lower is better)',
      mae: 'MAE, appointments per week', rmse: 'RMSE', smape: 'sMAPE %', interval_coverage_backtest: '80% interval coverage (held out)',
      silhouette: 'Silhouette', k: 'Segments' };
    const num = v => {
      if (typeof v === 'number') return Math.abs(v) >= 100 ? fmt(Math.round(v)) : v.toFixed(3);
      if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${typeof x === 'number' ? (Number.isInteger(x) ? x : x.toFixed(2)) : x}`).join(', ');
      return v ?? '–';
    };
    const rows = Object.keys(m.metrics || {}).map(key => ({ key: LABELS[key] || key.replace(/_/g, ' '), model: m.metrics[key], baseline: (m.baselineMetrics || {})[key] }));
    const baseName = m.baselineMetrics && m.baselineMetrics.baseline ? ` (${m.baselineMetrics.baseline.replace(/_/g, ' ')})`
      : m.model === 'not_completed_classifier' ? ' (patient\'s own past rate)' : '';
    return h('div', {},
      table([{ label: 'Metric', render: r => r.key }, { label: 'Model', num: true, render: r => num(r.model) },
        { label: `Best baseline${baseName}`, num: true, render: r => h('span', { class: 'wrap', text: num(r.baseline) }) }], rows),
      h('p', { class: 'note', text: `Trained ${new Date(m.trainedAt).toLocaleString()} on ${fmt(m.trainRows)} rows, tested on ${fmt(m.testRows)} later rows (time-based split). Dataset version ${String(m.datasetVersion || '').slice(0, 12)}.` }));
  }

  async function quality() {
    const [dq, runs] = await Promise.all([api('/data-quality'), api('/pipeline-runs?limit=15')]);
    const sev = r => (r.passed ? h('span', { class: 'badge ok' }, 'passed') : h('span', { class: `badge ${r.severity === 'error' ? 'bad' : 'warn'}` }, r.severity));
    return [
      ...pageHead('Data quality and pipeline', 'Results of the latest pipeline run, run history and where each table gets its data.',
        [['data-quality', 'quality results'], ['pipeline-runs', 'run history']]),
      h('div', { class: 'card' }, h('h2', { text: dq.latest ? `Rules checked in run ${dq.latest.run_id} (${dq.latest.mode})` : 'No runs yet' }),
        table([
          { label: 'Result', render: sev },
          { label: 'Rule', render: r => r.rule },
          { label: 'Dataset', render: r => r.dataset },
          { label: 'Action', render: r => r.action },
          { label: 'Rows checked', key: 'evaluated', num: true },
          { label: 'Failed', key: 'failed', num: true },
          { label: 'Failed %', num: true, render: r => `${r.failurePct}%` },
          { label: 'Status', render: r => r.resolution },
        ], dq.rules),
        h('p', { class: 'note', text: 'Quarantined rows are kept out of the warehouse and listed for review. Hospital records are never changed or deleted by the pipeline.' })),
      h('div', { class: 'card' }, h('h2', { text: 'Recent pipeline runs' }),
        table([
          { label: 'Run', key: 'runId', num: true },
          { label: 'Mode', render: r => r.mode },
          { label: 'Status', render: r => h('span', { class: `badge ${r.status === 'succeeded' ? 'ok' : r.status === 'failed' ? 'bad' : 'warn'}` }, r.status) },
          { label: 'Started', render: r => new Date(r.startedAt).toLocaleString() },
          { label: 'Seconds', num: true, render: r => (r.seconds === null ? '–' : r.seconds.toFixed(1)) },
          { label: 'Inserted', num: true, render: r => fmt(r.loadCounts.inserted) },
          { label: 'Updated', num: true, render: r => fmt(r.loadCounts.updated) },
          { label: 'Removed', num: true, render: r => fmt(r.loadCounts.removed) },
          { label: 'Rejected', num: true, render: r => fmt(r.loadCounts.rejected) },
          { label: 'Rules failed', key: 'dqFailedRules', num: true },
          { label: 'Error', render: r => r.error || '' },
        ], runs.runs)),
      h('div', { class: 'card' }, h('h2', { text: 'Data lineage' }),
        table([{ label: 'Analytics table', render: r => r.target }, { label: 'Comes from', render: r => r.source },
          { label: 'How', render: r => h('span', { class: 'wrap', text: r.transformation }) }], runs.lineage)),
    ];
  }

  async function definitions() {
    return [
      ...pageHead('KPI definitions', 'Every figure on these pages, how it is defined and the SQL behind it.'),
      h('div', { class: 'card' }, table([
        { label: 'KPI', render: r => h('strong', {}, r.name) },
        { label: 'Definition', render: r => h('span', { class: 'wrap', text: r.definition }) },
        { label: 'SQL', render: r => h('code', { text: r.sql }) },
      ], Object.values(kpiDefs))),
    ];
  }

  const PAGES = { overview, departments, doctors, flow, financial, forecasts, quality, definitions };
  const FILTERED = new Set(['overview', 'departments', 'doctors', 'flow']);

  async function render() {
    const page = PAGES[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
    document.querySelectorAll('.sidenav a').forEach(a => a.toggleAttribute('aria-current', a.dataset.page === page));
    document.querySelectorAll('.sidenav a[aria-current]').forEach(a => a.setAttribute('aria-current', 'page'));
    form.classList.toggle('hidden-filters', !FILTERED.has(page));
    loading();
    try {
      const content = await PAGES[page]();
      view.replaceChildren(...content);
    } catch (err) {
      showError(err, render);
    }
  }

  async function start() {
    try {
      const me = await api('/me');
      const [filters, kpis] = await Promise.all([api('/filters'), api('/kpis')]);
      kpiDefs = Object.fromEntries(kpis.data.map(k => [k.id, k]));
      lookups = filters;
      if (me.dataset && me.dataset.is_synthetic) {
        const banner = document.getElementById('dataset-banner');
        banner.replaceChildren(h('strong', { text: 'SYNTHETIC DATA. ' }),
          `Every patient, doctor and appointment shown here is fictional and generated for development. ${me.dataset.notes || ''}`);
        banner.hidden = false;
      }
      const fresh = document.getElementById('freshness');
      fresh.textContent = me.freshness
        ? `Data refreshed ${new Date(me.freshness.finished_at).toLocaleString()} (run ${me.freshness.run_id})`
        : 'The pipeline has not run yet';
      const depSel = form.department;
      depSel.append(...filters.departments.map(dp => h('option', { value: dp.id }, dp.name)));
      const docSel = form.doctor;
      const fillDoctors = () => {
        const dep = depSel.value;
        docSel.replaceChildren(h('option', { value: '' }, 'All doctors'),
          ...lookups.doctors.filter(dc => !dep || String(dc.departmentId) === dep).map(dc => h('option', { value: dc.key }, dc.name)));
      };
      depSel.addEventListener('change', fillDoctors);
      fillDoctors();
      const today = new Date();
      const iso = d => d.toISOString().slice(0, 10);
      form.from.value = iso(new Date(today.getTime() - 365 * 86400000));
      form.to.value = iso(new Date(today.getTime() + 28 * 86400000));
    } catch (err) {
      return showError(err, start);
    }
    window.addEventListener('hashchange', render);
    form.addEventListener('submit', e => { e.preventDefault(); render(); });
    return render();
  }

  const toggle = document.querySelector('.menu-toggle');
  toggle.addEventListener('click', () => {
    const nav = document.getElementById('nav');
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  document.getElementById('nav').addEventListener('click', e => {
    if (e.target.tagName === 'A') document.getElementById('nav').classList.remove('open');
  });

  start();
}());
