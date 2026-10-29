import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon, { departmentIcons } from '../components/Icon';
import { AppointmentDetails, MedicalRecord } from '../components/Records';
import {
  Avatar, ConfirmDialog, EmptyState, ErrorBox, PageHead, Paginated, Spinner, StatusBadge,
  useApi, usePageTitle, useToast,
} from '../components/ui';
import { api } from '../api';
import { TextAreaField, TextField, useValidatedForm } from '../components/Form';
import v from '../validation';
import { useAuth } from '../auth';
import {
  WEEKDAYS, appointmentState, formatDate, formatTime, formatTimeRange, greeting,
  parseDate, relativeDay, shortDay, sortDays, toDateString,
} from '../format';

const firstName = name => name.split(' ')[0];

// ---------- Dashboard ----------

export function PatientDashboard() {
  usePageTitle('Dashboard');
  const { user } = useAuth();
  const { data, loading, error } = useApi('/appointments');

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;

  const appts = data.data;
  const upcoming = appts.filter(a => appointmentState(a) === 'upcoming')
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  const completed = appts.filter(a => a.status === 'Done');
  const doctors = new Set(appts.map(a => a.doctorEmail));
  const next = upcoming[0];
  const prescriptions = completed.filter(a => a.prescription).slice(0, 4);

  return (
    <div className="stack">
      <div className="welcome">
        <div>
          <h1>{greeting()}, {firstName(user.name)}</h1>
          <p>
            {next
              ? `Your next appointment is ${relativeDay(next.date).toLowerCase()} at ${formatTime(next.startTime)}.`
              : 'You have no upcoming appointments. Book one whenever you need to see a doctor.'}
          </p>
        </div>
        <Link to="/patient/book" className="btn btn-secondary btn-lg"><Icon name="calendar-plus" /> Book appointment</Link>
      </div>

      <div className="stats three">
        <div className="card stat">
          <span className="stat-icon"><Icon name="calendar" size={22} /></span>
          <div><strong>{upcoming.length}</strong><span>Upcoming appointments</span></div>
        </div>
        <div className="card stat">
          <span className="stat-icon green"><Icon name="check-circle" size={22} /></span>
          <div><strong>{completed.length}</strong><span>Completed visits</span></div>
        </div>
        <div className="card stat">
          <span className="stat-icon blue"><Icon name="stethoscope" size={22} /></span>
          <div><strong>{doctors.size}</strong><span>Doctors consulted</span></div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="stack">
          <div className="card">
            <div className="card-header">
              <h2>Next appointment</h2>
              <Link to="/patient/appointments" className="small">View all <Icon name="chevron-right" size={14} /></Link>
            </div>
            {next ? (
              <div className="card-body next-appt">
                <div className="date-block">
                  <span>{parseDate(next.date).toLocaleDateString('en-IN', { month: 'short' })}</span>
                  <strong>{parseDate(next.date).getDate()}</strong>
                </div>
                <div style={{ flex: 1 }}>
                  <strong>{next.doctorName}</strong>
                  <div className="muted small">{next.specialization}</div>
                  <div className="row small" style={{ marginTop: 8, gap: 16, flexWrap: 'wrap' }}>
                    <span className="row" style={{ gap: 6 }}><Icon name="clock" size={15} /> {formatTimeRange(next.startTime, next.endTime)}</span>
                    <span className="badge badge-brand">{relativeDay(next.date)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState title="Nothing booked" action={<Link to="/patient/book" className="btn btn-primary btn-sm">Book a visit</Link>}>
                Pick a doctor and a free time slot.
              </EmptyState>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <h2>Recent prescriptions</h2>
              <Link to="/patient/records" className="small">Medical records <Icon name="chevron-right" size={14} /></Link>
            </div>
            {prescriptions.length ? (
              <ul className="list">
                {prescriptions.map(a => (
                  <li key={a.id} className="list-item">
                    <span className="stat-icon green" style={{ width: 40, height: 40 }}><Icon name="pill" /></span>
                    <div className="grow">
                      <strong>{a.diagnosis}</strong>
                      <div className="muted small truncate">{a.prescription}</div>
                    </div>
                    <div className="muted small" style={{ textAlign: 'right' }}>
                      {formatDate(a.date, { weekday: undefined })}<br />{a.doctorName}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="pill" title="No prescriptions yet">They appear here after your doctor sees you.</EmptyState>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h2>Quick actions</h2></div>
          <div className="quick-actions">
            <Link to="/patient/book" className="quick-action"><Icon name="calendar-plus" size={22} /> Book appointment</Link>
            <Link to="/patient/appointments" className="quick-action"><Icon name="calendar" size={22} /> My appointments</Link>
            <Link to="/patient/records" className="quick-action"><Icon name="clipboard" size={22} /> Medical records</Link>
            <Link to="/profile" className="quick-action"><Icon name="user" size={22} /> Update profile</Link>
          </div>
          <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="alert alert-info">
              <Icon name="phone" />
              <span>For a medical emergency, do not book online. Call the ambulance on <strong>108</strong>.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Booking ----------

// The next two weeks, starting today
function nextDays(count = 14) {
  const days = [];
  const d = new Date();
  for (let i = 0; i < count; i += 1) {
    days.push(new Date(d.getFullYear(), d.getMonth(), d.getDate() + i));
  }
  return days;
}

export function BookAppointment() {
  usePageTitle('Book appointment');
  const notify = useToast();
  const doctorsRes = useApi('/doctors');
  const [department, setDepartment] = useState('All');
  const [doctor, setDoctor] = useState(null);
  const [date, setDate] = useState(null);
  const [slot, setSlot] = useState(null);
  const [slots, setSlots] = useState({ loading: false, list: [] });
  const reasonRules = useMemo(() => ({
    concerns: value => v.checkText(value, 'Reason for visit', { min: 3 }),
    symptoms: value => v.checkText(value, 'Symptoms', { min: 3 }),
  }), []);
  const reason = useValidatedForm({ concerns: '', symptoms: '' }, reasonRules);
  const { concerns, symptoms } = reason.values;
  const reasonDone = !reasonRules.concerns(concerns) && !reasonRules.symptoms(symptoms);
  const [busy, setBusy] = useState(false);
  const [booked, setBooked] = useState(null);

  const doctors = useMemo(() => (doctorsRes.data ? doctorsRes.data.data : []), [doctorsRes.data]);
  const departments = useMemo(() => ['All', ...new Set(doctors.map(d => d.specialization))], [doctors]);
  const shown = department === 'All' ? doctors : doctors.filter(d => d.specialization === department);
  const days = useMemo(() => nextDays(), []);

  // A booking started on a department page arrives as ?doctor=<id>&date=…&time=…
  const location = useLocation();
  const prefill = useRef(new URLSearchParams(location.search));
  const wantedTime = useRef(null);
  const [prefillNote, setPrefillNote] = useState('');

  useEffect(() => {
    const params = prefill.current;
    if (!params || !doctorsRes.data) return;
    prefill.current = null;
    const doctorId = params.get('doctor');
    if (!doctorId) return;
    const wanted = doctors.find(d => String(d.id) === doctorId);
    if (!wanted) {
      setPrefillNote('That doctor is not taking appointments at the moment. Please choose another doctor.');
      return;
    }
    setDepartment(wanted.specialization);
    setDoctor(wanted);
    const wantedDate = params.get('date');
    const inRange = days.some(d => toDateString(d) === wantedDate);
    if (wantedDate && inRange && wanted.days.includes(WEEKDAYS[parseDate(wantedDate).getDay()])) {
      setDate(wantedDate);
      wantedTime.current = params.get('time');
    }
  }, [doctorsRes.data, doctors, days]);

  useEffect(() => {
    setSlot(null);
    if (!doctor || !date) return undefined;
    let active = true;
    setSlots({ loading: true, list: [] });
    api(`/doctors/${encodeURIComponent(doctor.email)}/slots?date=${date}`)
      .then(res => {
        if (!active) return;
        setSlots({ loading: false, list: res.data });
        // Select the time chosen on the department page, if it is still free
        if (wantedTime.current) {
          if (res.data.includes(wantedTime.current)) setSlot(wantedTime.current);
          else setPrefillNote('The time you picked has just been booked by someone else. Please choose another time.');
          wantedTime.current = null;
        }
      })
      .catch(err => active && setSlots({ loading: false, list: [], error: err.message }));
    return () => { active = false; };
  }, [doctor, date]);

  const pickDoctor = d => {
    setDoctor(d);
    // Keep the date only if the new doctor also works that day
    if (date && !d.days.includes(WEEKDAYS[parseDate(date).getDay()])) setDate(null);
  };

  const ready = doctor && date && slot && reasonDone;

  const confirm = () => {
    if (!reason.validateAll()) return;
    setBusy(true);
    api('/appointments', {
      method: 'POST',
      body: { doctor: doctor.email, date, startTime: slot, concerns, symptoms },
    })
      .then(res => {
        notify('Appointment booked successfully.');
        setBooked({ id: res.id, doctor, date, slot });
      })
      .catch(err => {
        reason.setServerErrors(err.fields);
        notify(err.message, 'error');
        setBusy(false);
      });
  };

  const startOver = () => {
    setDoctor(null);
    setDate(null);
    reason.setValues({ concerns: '', symptoms: '' });
    setBusy(false);
    setBooked(null);
  };

  if (doctorsRes.loading) return <Spinner />;
  if (doctorsRes.error) return <ErrorBox message={doctorsRes.error} />;

  if (booked) {
    return (
      <div className="card success-box">
        <div className="success-icon"><Icon name="check" size={34} strokeWidth={3} /></div>
        <h1 style={{ fontSize: 24 }}>Appointment confirmed</h1>
        <p className="muted" style={{ margin: '8px 0 24px' }}>
          Reference #{String(booked.id).padStart(5, '0')}. Please arrive 10 minutes early.
        </p>
        <div className="card card-body" style={{ textAlign: 'left', marginBottom: 24, boxShadow: 'none' }}>
          <dl className="detail-list">
            <dt>Doctor</dt><dd>{booked.doctor.name}</dd>
            <dt>Department</dt><dd>{booked.doctor.specialization}</dd>
            <dt>Date</dt><dd>{formatDate(booked.date)}</dd>
            <dt>Time</dt><dd>{formatTime(`${booked.slot}:00`)}</dd>
          </dl>
        </div>
        <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/patient/appointments" className="btn btn-primary">View my appointments</Link>
          <button type="button" className="btn btn-secondary" onClick={startOver}>Book another</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHead title="Book an appointment" subtitle="Choose a doctor, pick a free slot and tell us why you are visiting." />
      {prefillNote && <div className="alert alert-info" role="status" style={{ marginBottom: 16 }}><Icon name="alert" /><span>{prefillNote}</span></div>}
      <div className="book-grid">
        <div className="card">
          <section className="book-step">
            <div className="step-title">
              <span className={`step-num ${doctor ? 'done' : ''}`}>{doctor ? <Icon name="check" size={14} /> : 1}</span>
              <h2>Choose a doctor</h2>
            </div>
            <div className="chip-row">
              {departments.map(d => (
                <button key={d} type="button" className={`chip ${department === d ? 'active' : ''}`} onClick={() => setDepartment(d)}>
                  {d}
                </button>
              ))}
            </div>
            <div className="doctor-options">
              {shown.map(d => (
                <button
                  key={d.email}
                  type="button"
                  className={`doctor-option ${doctor && doctor.email === d.email ? 'selected' : ''}`}
                  onClick={() => pickDoctor(d)}
                >
                  <Avatar name={d.name} soft />
                  <div>
                    <strong>{d.name}</strong>
                    <span className="row" style={{ gap: 4 }}>
                      <Icon name={departmentIcons[d.specialization] || 'activity'} size={12} /> {d.specialization}
                    </span>
                    <span>{sortDays(d.days).map(shortDay).join(' · ') || 'No working days set'}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="book-step">
            <div className="step-title">
              <span className={`step-num ${slot ? 'done' : ''}`}>{slot ? <Icon name="check" size={14} /> : 2}</span>
              <h2>Pick a date and time</h2>
            </div>
            {!doctor ? (
              <p className="muted">Choose a doctor first to see their available days.</p>
            ) : (
              <>
                <div className="date-strip">
                  {days.map(d => {
                    const value = toDateString(d);
                    const works = doctor.days.includes(WEEKDAYS[d.getDay()]);
                    return (
                      <button
                        key={value}
                        type="button"
                        className={`date-option ${date === value ? 'selected' : ''}`}
                        disabled={!works}
                        title={works ? '' : 'Doctor not available'}
                        onClick={() => setDate(value)}
                      >
                        <span>{d.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
                        <strong>{d.getDate()}</strong>
                        <span>{d.toLocaleDateString('en-IN', { month: 'short' })}</span>
                      </button>
                    );
                  })}
                </div>
                {date && (slots.loading ? <Spinner /> : (
                  slots.list.length ? (
                    <div className="slot-grid">
                      {slots.list.map(t => (
                        <button key={t} type="button" className={`slot ${slot === t ? 'selected' : ''}`} aria-pressed={slot === t} onClick={() => setSlot(t)}>
                          {formatTime(`${t}:00`)}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="muted" style={{ marginTop: 16 }}>
                      {slots.error || 'No free slots left on this day. Please try another date.'}
                    </p>
                  )
                ))}
              </>
            )}
          </section>

          <section className="book-step">
            <div className="step-title">
              <span className={`step-num ${reasonDone ? 'done' : ''}`}>
                {reasonDone ? <Icon name="check" size={14} /> : 3}
              </span>
              <h2>Reason for your visit</h2>
            </div>
            <div className="form-grid">
              <TextField form={reason} name="concerns" label="What would you like to discuss?" maxLength={255}
                className="span-2" placeholder="e.g. Follow-up on blood pressure" required />
              <div className="span-2">
                <TextAreaField form={reason} name="symptoms" label="Symptoms" placeholder="e.g. Headache and dizziness for 3 days" required />
              </div>
            </div>
          </section>
        </div>

        <aside className="card summary">
          <div className="card-header"><h2>Booking summary</h2></div>
          <div className="card-body">
            <div className="summary-row">
              <Icon name="user" />
              <div>{doctor ? <><strong>{doctor.name}</strong><div className="muted small">{doctor.specialization}</div></> : <span className="muted">No doctor selected</span>}</div>
            </div>
            <div className="summary-row">
              <Icon name="calendar" />
              <div>{date ? formatDate(date) : <span className="muted">No date selected</span>}</div>
            </div>
            <div className="summary-row">
              <Icon name="clock" />
              <div>{slot ? `${formatTime(`${slot}:00`)} (1 hour)` : <span className="muted">No time selected</span>}</div>
            </div>
            <button type="button" className="btn btn-primary btn-lg btn-block" style={{ marginTop: 16 }} disabled={!ready || busy} onClick={confirm}>
              {busy ? 'Booking…' : 'Confirm booking'}
            </button>
            <p className="muted small" style={{ marginTop: 12, textAlign: 'center' }}>
              You can cancel any time before the visit.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

// ---------- Appointments ----------

const TABS = [['upcoming', 'Upcoming'], ['past', 'Past'], ['all', 'All']];

export function PatientAppointments() {
  usePageTitle('My appointments');
  const notify = useToast();
  const { data, loading, error, reload } = useApi('/appointments');
  const [tab, setTab] = useState('upcoming');
  const [details, setDetails] = useState(null);
  const [toRemove, setToRemove] = useState(null);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox message={error} />;

  const appts = data.data;
  const isUpcoming = a => appointmentState(a) === 'upcoming';
  const groups = {
    upcoming: appts.filter(isUpcoming).reverse(),
    past: appts.filter(a => !isUpcoming(a)),
    all: appts,
  };
  const list = groups[tab];

  const remove = () => {
    setBusy(true);
    api(`/appointments/${toRemove.id}`, { method: 'DELETE' })
      .then(() => {
        notify(isUpcoming(toRemove) ? 'Appointment cancelled. The slot is free for others.' : 'Removed from your list.');
        setToRemove(null);
        reload();
      })
      .catch(err => notify(err.message, 'error'))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <PageHead
        title="My appointments"
        subtitle="Upcoming visits, past consultations and their prescriptions."
        actions={<Link to="/patient/book" className="btn btn-primary"><Icon name="plus" size={16} /> New appointment</Link>}
      />
      <div className="card">
        <div className="toolbar">
          <div className="tabs">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
                {label}<span className="count">{groups[key].length}</span>
              </button>
            ))}
          </div>
        </div>
        {list.length === 0 ? (
          <EmptyState
            title={tab === 'upcoming' ? 'No upcoming appointments' : 'Nothing here yet'}
            action={<Link to="/patient/book" className="btn btn-primary btn-sm">Book an appointment</Link>}
          >
            Your appointments will show up here.
          </EmptyState>
        ) : (
          <Paginated items={list} resetKey={tab} label="appointments">
            {pageItems => (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Doctor</th><th>Date</th><th>Time</th><th>Reason</th><th>Status</th><th /></tr>
                  </thead>
                  <tbody>
                    {pageItems.map(a => (
                      <tr key={a.id}>
                        <td>
                          <div className="cell-person">
                            <Avatar name={a.doctorName} soft />
                            <div><strong>{a.doctorName}</strong><span className="muted small">{a.specialization}</span></div>
                          </div>
                        </td>
                        <td>{formatDate(a.date)}</td>
                        <td>{formatTime(a.startTime)}</td>
                        <td><div className="truncate">{a.concerns}</div></td>
                        <td><StatusBadge appt={a} /></td>
                        <td>
                          <div className="actions">
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDetails(a)}>Details</button>
                            <button type="button" className="btn btn-danger btn-sm" onClick={() => setToRemove(a)}>
                              {isUpcoming(a) ? 'Cancel' : 'Remove'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Paginated>
        )}
      </div>

      {details && <AppointmentDetails appt={details} viewer="pat" onClose={() => setDetails(null)} />}
      {toRemove && (
        <ConfirmDialog
          title={isUpcoming(toRemove) ? 'Cancel this appointment?' : 'Remove from your list?'}
          message={isUpcoming(toRemove)
            ? `Your visit with ${toRemove.doctorName} on ${formatDate(toRemove.date)} at ${formatTime(toRemove.startTime)} will be cancelled.`
            : "This only hides it from your list. Your doctor keeps the record of the visit."}
          confirmLabel={isUpcoming(toRemove) ? 'Cancel appointment' : 'Remove'}
          danger
          busy={busy}
          onConfirm={remove}
          onClose={() => setToRemove(null)}
        />
      )}
    </>
  );
}

// ---------- Medical records ----------

export function PatientRecords() {
  usePageTitle('Medical records');
  const { user } = useAuth();
  return (
    <>
      <PageHead title="Medical records" subtitle="Your medical background and every diagnosis and prescription." />
      <MedicalRecord email={user.email} />
    </>
  );
}
