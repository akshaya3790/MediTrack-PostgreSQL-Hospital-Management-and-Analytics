import React, { useEffect, useMemo, useState } from 'react';
import { Link, useHistory, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { AppointmentDetails, MedicalRecord } from '../components/Records';
import {
  Avatar, ConfirmDialog, EmptyState, ErrorBox, PageHead, Paginated, Spinner, StatusBadge,
  useApi, usePageTitle, useToast,
} from '../components/ui';
import { api } from '../api';
import { TextAreaField, useValidatedForm } from '../components/Form';
import v from '../validation';
import { useAuth } from '../auth';
import {
  addMinutes, ageFrom, appointmentState, capitalize, formatDate, formatTime, formatTimeRange,
  greeting, relativeDay, shortDay, sortDays, todayString,
} from '../format';

const byTime = (a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime);

// ---------- Dashboard ----------

export function DoctorDashboard() {
  usePageTitle('Dashboard');
  const { user } = useAuth();
  const appts = useApi('/appointments');
  const profile = useApi('/profile');

  if (appts.loading || profile.loading) return <Spinner />;
  if (appts.error) return <ErrorBox message={appts.error} />;

  const list = appts.data.data;
  const today = todayString();
  const todays = list.filter(a => a.date === today).sort(byTime);
  const upcoming = list.filter(a => appointmentState(a) === 'upcoming').sort(byTime);
  const pending = list.filter(a => a.status !== 'Done' && a.date <= today);
  const patients = new Set(list.map(a => a.patientEmail));
  const later = upcoming.filter(a => a.date > today).slice(0, 5);
  const me = profile.data ? profile.data.data : null;

  return (
    <div className="stack">
      <div className="welcome">
        <div>
          <h1>{greeting()}, {user.name}</h1>
          <p>
            {todays.length
              ? `You have ${todays.length} appointment${todays.length > 1 ? 's' : ''} today.`
              : 'You have no appointments today.'}
            {pending.length > 0 && ` ${pending.length} visit${pending.length > 1 ? 's are' : ' is'} waiting for a diagnosis.`}
          </p>
        </div>
        <Link to="/doctor/appointments" className="btn btn-secondary btn-lg"><Icon name="calendar" /> Open schedule</Link>
      </div>

      <div className="stats">
        <div className="card stat">
          <span className="stat-icon"><Icon name="calendar" size={22} /></span>
          <div><strong>{todays.length}</strong><span>Today</span></div>
        </div>
        <div className="card stat">
          <span className="stat-icon blue"><Icon name="clock" size={22} /></span>
          <div><strong>{upcoming.length}</strong><span>Upcoming</span></div>
        </div>
        <div className="card stat">
          <span className="stat-icon amber"><Icon name="clipboard" size={22} /></span>
          <div><strong>{pending.length}</strong><span>Awaiting diagnosis</span></div>
        </div>
        <div className="card stat">
          <span className="stat-icon green"><Icon name="users" size={22} /></span>
          <div><strong>{patients.size}</strong><span>Patients</span></div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="card">
          <div className="card-header">
            <h2>Today&apos;s schedule</h2>
            <span className="muted small">{formatDate(today)}</span>
          </div>
          {todays.length ? (
            <ul className="list">
              {todays.map(a => (
                <li key={a.id} className="list-item">
                  <div className="date-block" style={{ width: 70, height: 52 }}>
                    <strong style={{ fontSize: 15 }}>{formatTime(a.startTime)}</strong>
                  </div>
                  <div className="grow">
                    <strong>{a.patientName}</strong>
                    <div className="muted small truncate">{a.concerns} · {a.symptoms}</div>
                  </div>
                  <StatusBadge appt={a} />
                  <Link to={`/doctor/appointments/${a.id}/diagnose`} className="btn btn-primary btn-sm">
                    {a.diagnosis ? 'Edit' : 'Diagnose'}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="A free day">No patients are booked for today.</EmptyState>
          )}
        </div>

        <div className="stack">
          {me && (
            <div className="card">
              <div className="card-header"><h2>Your working hours</h2></div>
              <div className="card-body">
                <div className="row" style={{ marginBottom: 12 }}>
                  <span className="badge badge-brand badge-plain">{me.specialization}</span>
                </div>
                {me.startTime ? (
                  <dl className="detail-list" style={{ gridTemplateColumns: '90px 1fr' }}>
                    <dt>Hours</dt><dd>{formatTimeRange(me.startTime, me.endTime)}</dd>
                    <dt>Break</dt><dd>{formatTimeRange(me.breakTime, addMinutes(me.breakTime, 60))}</dd>
                    <dt>Days</dt><dd>{sortDays(me.days).map(shortDay).join(', ')}</dd>
                  </dl>
                ) : <p className="muted">No schedule assigned.</p>}
              </div>
            </div>
          )}
          <div className="card">
            <div className="card-header">
              <h2>Coming up</h2>
              <Link to="/doctor/appointments" className="small">View all <Icon name="chevron-right" size={14} /></Link>
            </div>
            {later.length ? (
              <ul className="list">
                {later.map(a => (
                  <li key={a.id} className="list-item">
                    <Avatar name={a.patientName} soft />
                    <div className="grow">
                      <strong>{a.patientName}</strong>
                      <div className="muted small">{formatDate(a.date, { year: undefined })} · {formatTime(a.startTime)}</div>
                    </div>
                    <span className="badge badge-brand badge-plain">{relativeDay(a.date)}</span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="Nothing scheduled">Later appointments will appear here.</EmptyState>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Appointments ----------

const TABS = [['today', 'Today'], ['upcoming', 'Upcoming'], ['pending', 'Awaiting diagnosis'], ['completed', 'Completed'], ['all', 'All']];

export function DoctorAppointments() {
  usePageTitle('Appointments');
  const notify = useToast();
  const { data, loading, error, reload } = useApi('/appointments');
  const [tab, setTab] = useState('upcoming');
  const [query, setQuery] = useState('');
  const [details, setDetails] = useState(null);
  const [toCancel, setToCancel] = useState(null);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox message={error} />;

  const today = todayString();
  const appts = data.data;
  const groups = {
    today: appts.filter(a => a.date === today).sort(byTime),
    upcoming: appts.filter(a => appointmentState(a) === 'upcoming').sort(byTime),
    pending: appts.filter(a => a.status !== 'Done' && a.date <= today),
    completed: appts.filter(a => a.status === 'Done'),
    all: appts,
  };
  const q = query.trim().toLowerCase();
  const list = groups[tab].filter(a => !q || a.patientName.toLowerCase().includes(q) || a.concerns.toLowerCase().includes(q));

  const cancel = () => {
    setBusy(true);
    api(`/appointments/${toCancel.id}`, { method: 'DELETE' })
      .then(() => {
        notify('Appointment cancelled.');
        setToCancel(null);
        reload();
      })
      .catch(err => notify(err.message, 'error'))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <PageHead title="Appointments" subtitle="Your patients' bookings, with diagnoses and prescriptions." />
      <div className="card">
        <div className="toolbar">
          <div className="tabs">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
                {label}<span className="count">{groups[key].length}</span>
              </button>
            ))}
          </div>
          <div className="input-icon">
            <Icon name="search" size={16} />
            <input className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search patient or reason" />
          </div>
        </div>
        {list.length === 0 ? (
          <EmptyState title="No appointments">Nothing matches this view.</EmptyState>
        ) : (
          <Paginated items={list} resetKey={`${tab}:${q}`} label="appointments">
            {pageItems => (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Patient</th><th>Date</th><th>Time</th><th>Reason</th><th>Status</th><th /></tr>
                  </thead>
                  <tbody>
                    {pageItems.map(a => (
                      <tr key={a.id}>
                        <td>
                          <div className="cell-person">
                            <Avatar name={a.patientName} soft />
                            <div><strong>{a.patientName}</strong><span className="muted small">{a.patientEmail}</span></div>
                          </div>
                        </td>
                        <td>{formatDate(a.date)}</td>
                        <td>{formatTime(a.startTime)}</td>
                        <td><div className="truncate">{a.concerns}</div></td>
                        <td><StatusBadge appt={a} /></td>
                        <td>
                          <div className="actions">
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDetails(a)}>Details</button>
                            <Link to={`/doctor/appointments/${a.id}/diagnose`} className="btn btn-primary btn-sm">
                              {a.diagnosis ? 'Edit diagnosis' : 'Diagnose'}
                            </Link>
                            {a.status !== 'Done' && (
                              <button type="button" className="btn btn-danger btn-sm" onClick={() => setToCancel(a)}>Cancel</button>
                            )}
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

      {details && (
        <AppointmentDetails
          appt={details}
          viewer="doc"
          onClose={() => setDetails(null)}
          footer={(
            <>
              <Link to={`/doctor/patients/${encodeURIComponent(details.patientEmail)}`} className="btn btn-secondary">Patient record</Link>
              <Link to={`/doctor/appointments/${details.id}/diagnose`} className="btn btn-primary">
                {details.diagnosis ? 'Edit diagnosis' : 'Diagnose'}
              </Link>
            </>
          )}
        />
      )}
      {toCancel && (
        <ConfirmDialog
          title="Cancel this appointment?"
          message={`${toCancel.patientName}'s visit on ${formatDate(toCancel.date)} at ${formatTime(toCancel.startTime)} will be cancelled and the slot freed.`}
          confirmLabel="Cancel appointment"
          danger
          busy={busy}
          onConfirm={cancel}
          onClose={() => setToCancel(null)}
        />
      )}
    </>
  );
}

// ---------- Diagnosis ----------

export function Diagnose() {
  usePageTitle('Diagnosis');
  const { id } = useParams();
  const history = useHistory();
  const notify = useToast();
  const { data, loading, error } = useApi(`/appointments/${id}`);
  const rules = useMemo(() => ({
    diagnosis: value => v.checkText(value, 'Diagnosis', { min: 2 }),
    prescription: value => v.checkText(value, 'Prescription', { min: 2 }),
  }), []);
  const form = useValidatedForm({ diagnosis: '', prescription: '' }, rules);
  const { setValues } = form;
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setValues({ diagnosis: data.data.diagnosis || '', prescription: data.data.prescription || '' });
  }, [data, setValues]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  const a = data.data;

  const submit = e => {
    e.preventDefault();
    if (!form.validateAll()) return;
    setBusy(true);
    api(`/appointments/${id}/diagnosis`, { method: 'POST', body: form.values })
      .then(() => {
        notify(`Diagnosis saved for ${a.patientName}.`);
        history.push('/doctor/appointments');
      })
      .catch(err => { form.setServerErrors(err.fields); notify(err.message, 'error'); setBusy(false); });
  };

  return (
    <>
      <PageHead
        crumbs={<><Link to="/doctor/appointments">Appointments</Link><Icon name="chevron-right" size={14} /> Diagnosis</>}
        title={a.diagnosis ? 'Update diagnosis' : 'Record diagnosis'}
        subtitle="Saving marks the appointment as completed and shares it with the patient."
      />
      <div className="book-grid">
        <form className="card" onSubmit={submit} noValidate>
          <div className="card-body stack" style={{ gap: 18 }}>
            <TextAreaField form={form} name="diagnosis" label="Diagnosis" placeholder="e.g. Viral fever" required />
            <TextAreaField form={form} name="prescription" label="Prescription and advice" style={{ minHeight: 150 }} required
              placeholder="e.g. Paracetamol 500 mg twice a day for 3 days, plenty of fluids" />
          </div>
          <div className="form-actions" style={{ padding: '0 24px 22px', marginTop: 0 }}>
            <Link to="/doctor/appointments" className="btn btn-secondary">Cancel</Link>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <Icon name="check" size={16} /> {busy ? 'Saving…' : 'Save and complete visit'}
            </button>
          </div>
        </form>

        <aside className="card summary">
          <div className="card-header"><h2>Visit</h2><StatusBadge appt={a} /></div>
          <div className="card-body">
            <div className="row" style={{ marginBottom: 16 }}>
              <Avatar name={a.patientName} />
              <div>
                <strong>{a.patientName}</strong>
                <div className="muted small">{a.patientEmail}</div>
              </div>
            </div>
            <div className="summary-row"><Icon name="calendar" /><div>{formatDate(a.date)}</div></div>
            <div className="summary-row"><Icon name="clock" /><div>{formatTimeRange(a.startTime, a.endTime)}</div></div>
            <div className="summary-row"><Icon name="message" /><div><span className="muted small">Reason</span><br />{a.concerns}</div></div>
            <div className="summary-row"><Icon name="activity" /><div><span className="muted small">Symptoms</span><br />{a.symptoms}</div></div>
            <Link to={`/doctor/patients/${encodeURIComponent(a.patientEmail)}`} className="btn btn-secondary btn-block" style={{ marginTop: 14 }}>
              <Icon name="clipboard" size={16} /> Open full medical record
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}

// ---------- Patients ----------

export function DoctorPatients() {
  usePageTitle('My patients');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const { data, loading, error } = useApi(`/patients?name=${encodeURIComponent(search)}`);

  // Search shortly after the doctor stops typing
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const list = data ? data.data : [];
  return (
    <>
      <PageHead title="My patients" subtitle="Everyone who has booked with you. Open a record to see their full history." />
      <div className="card">
        <div className="toolbar">
          <strong>{list.length} patient{list.length === 1 ? '' : 's'}</strong>
          <div className="input-icon">
            <Icon name="search" size={16} />
            <input className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name" />
          </div>
        </div>
        {error && <div className="card-body"><ErrorBox message={error} /></div>}
        {loading && !data ? <Spinner /> : list.length === 0 ? (
          <EmptyState icon="users" title={search ? 'No matching patients' : 'No patients yet'}>
            {search ? 'Try a different name.' : 'Patients appear here once they book with you.'}
          </EmptyState>
        ) : (
          <Paginated items={list} resetKey={search} label="patients">
            {pageItems => (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Patient</th><th>Age / gender</th><th>Visits</th><th>Last visit</th><th>Next visit</th><th /></tr>
                  </thead>
                  <tbody>
                    {pageItems.map(p => {
                      const age = ageFrom(p.dob);
                      return (
                        <tr key={p.email}>
                          <td>
                            <div className="cell-person">
                              <Avatar name={p.name} soft />
                              <div><strong>{p.name}</strong><span className="muted small">{p.email}</span></div>
                            </div>
                          </td>
                          <td>{age !== null ? `${age} yrs, ` : ''}{capitalize(p.gender)}</td>
                          <td>{p.visits}</td>
                          <td>{p.lastVisit ? formatDate(p.lastVisit) : <span className="muted">—</span>}</td>
                          <td>{p.nextVisit ? <span className="badge badge-brand badge-plain">{formatDate(p.nextVisit, { year: undefined })}</span> : <span className="muted">—</span>}</td>
                          <td>
                            <div className="actions">
                              <Link to={`/doctor/patients/${encodeURIComponent(p.email)}`} className="btn btn-secondary btn-sm">View record</Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Paginated>
        )}
      </div>
    </>
  );
}

export function PatientRecord() {
  usePageTitle('Patient record');
  const { email } = useParams();
  return (
    <>
      <PageHead
        crumbs={<><Link to="/doctor/patients">My patients</Link><Icon name="chevron-right" size={14} /> Record</>}
        title="Patient record"
        subtitle="Your access to this record is logged for the patient's privacy."
      />
      <MedicalRecord email={decodeURIComponent(email)} />
    </>
  );
}
