import React, { useEffect, useMemo, useState } from 'react';
import { Link, useHistory, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { SiteFooter, SiteNav } from '../components/Layout';
import { Avatar, EmptyState, ErrorBox, usePageTitle, useApi } from '../components/ui';
import { api } from '../api';
import { useAuth } from '../auth';
import {
  WEEKDAYS, formatDate, formatTime, formatTimeRange, shortDay, sortDays, toDateString,
} from '../format';

// How far ahead the department page shows availability (booking allows up to 90 days)
const AVAILABILITY_DAYS = 14;

export const formatFee = fee => `₹${Number(fee).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function upcomingDays(count) {
  const days = [];
  const d = new Date();
  for (let i = 0; i < count; i += 1) {
    days.push(toDateString(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

const weekdayOf = date => WEEKDAYS[new Date(`${date}T00:00:00`).getDay()];

// A whole card that links to the department page: one link, so it works with the
// keyboard, opens in a new tab, and is announced as "Cardiology, link"
export function DepartmentCard({ department }) {
  return (
    <Link to={`/departments/${department.slug}`} className="card feature dept-card">
      <div className="feature-icon"><Icon name={department.icon} size={22} /></div>
      <h3>{department.name}</h3>
      <p>{department.shortDescription}</p>
      <div className="dept-card-foot">
        {department.doctorCount > 0
          ? <span className="badge badge-green">{department.doctorCount} doctor{department.doctorCount === 1 ? '' : 's'}</span>
          : <span className="badge badge-gray">No doctors yet</span>}
        <span className="dept-card-more">View department <Icon name="arrow-right" size={15} /></span>
      </div>
    </Link>
  );
}

// Grey placeholders shown while departments load
export const DepartmentSkeletons = ({ count = 8 }) => (
  <div className="grid-4" aria-hidden="true">
    {Array.from({ length: count }, (_, i) => <div key={i} className="card skeleton" style={{ height: 196 }} />)}
  </div>
);

export function DepartmentGrid() {
  const { data, loading, error, reload } = useApi('/public/departments');
  if (loading && !data) return <><span className="sr-only" role="status">Loading departments…</span><DepartmentSkeletons /></>;
  if (error) return <ErrorBox message={`We could not load the departments. ${error}`} onRetry={reload} />;
  if (!data.data.length) {
    return <EmptyState icon="cross" title="No departments are open yet">Please check back soon.</EmptyState>;
  }
  return (
    <div className="grid-4">
      {data.data.map(dep => <DepartmentCard key={dep.id} department={dep} />)}
    </div>
  );
}

function PublicPage({ children }) {
  return (
    <>
      <SiteNav />
      <main id="main">{children}</main>
      <SiteFooter />
    </>
  );
}

const Crumbs = ({ current }) => (
  <nav className="breadcrumb" aria-label="Breadcrumb">
    <ol>
      <li><Link to="/">Home</Link></li>
      <li>{current ? <Link to="/departments">Departments</Link> : <span aria-current="page">Departments</span>}</li>
      {current && <li><span aria-current="page">{current}</span></li>}
    </ol>
  </nav>
);

// ---------- All departments ----------

export function DepartmentsPage() {
  usePageTitle('Departments');
  return (
    <PublicPage>
      <section className="dept-hero">
        <div className="container">
          <Crumbs />
          <h1>Departments</h1>
          <p className="lead">Choose a department to see its services, its doctors and their free appointment times.</p>
        </div>
      </section>
      <section className="section" style={{ paddingTop: 40 }}>
        <div className="container"><DepartmentGrid /></div>
      </section>
    </PublicPage>
  );
}

// ---------- One department ----------

function DoctorCard({ doctor, onCheck }) {
  const facts = [
    doctor.qualifications && ['Qualifications', doctor.qualifications],
    doctor.experienceYears !== null && doctor.experienceYears !== undefined
      && ['Experience', `${doctor.experienceYears} year${doctor.experienceYears === 1 ? '' : 's'}`],
    doctor.languages && ['Languages', doctor.languages],
    doctor.consultationFee !== null && doctor.consultationFee !== undefined && ['Consultation fee', formatFee(doctor.consultationFee)],
  ].filter(Boolean);
  return (
    <article className="card dept-doctor">
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        {doctor.photoUrl
          ? <img className="dept-doctor-photo" src={doctor.photoUrl} alt="" loading="lazy" />
          : <Avatar name={doctor.name} size="lg" />}
        <div style={{ minWidth: 0 }}>
          <h3>{doctor.name}</h3>
          <div className="muted small">{doctor.specialization}</div>
          {doctor.isDemo && <span className="badge badge-amber" style={{ marginTop: 6 }} title="This is a fictional sample profile">Demo profile</span>}
        </div>
      </div>
      {doctor.bio && <p className="dept-doctor-bio">{doctor.bio}</p>}
      {facts.length > 0 && (
        <dl className="detail-list dept-facts">
          {facts.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}
        </dl>
      )}
      <div className="dept-doctor-hours">
        <Icon name="clock" size={15} />
        {doctor.days.length
          ? <span>{sortDays(doctor.days).map(shortDay).join(', ')}{doctor.startTime && ` · ${formatTimeRange(doctor.startTime, doctor.endTime)}`}</span>
          : <span>Consultation hours not set yet</span>}
      </div>
      <button type="button" className="btn btn-secondary btn-block" onClick={() => onCheck(doctor)} disabled={!doctor.days.length}>
        <Icon name="calendar" size={16} /> See free times
      </button>
    </article>
  );
}

function Availability({ department, doctorId, setDoctorId }) {
  const history = useHistory();
  const { user } = useAuth();
  const doctors = department.doctors.filter(d => d.days.length);
  const chosen = doctors.find(d => String(d.id) === String(doctorId));
  const workingDays = chosen ? chosen.days : department.consultationDays;
  const days = useMemo(() => upcomingDays(AVAILABILITY_DAYS), []);
  const firstOpen = days.find(d => workingDays.includes(weekdayOf(d)));
  const [date, setDate] = useState(firstOpen);
  const [state, setState] = useState({ loading: false, data: null, error: null });
  const [version, setVersion] = useState(0);

  // Keep the chosen date valid when the doctor changes
  useEffect(() => {
    if (!date || !workingDays.includes(weekdayOf(date))) setDate(firstOpen);
  }, [date, firstOpen, workingDays]);

  useEffect(() => {
    if (!date) return undefined;
    let active = true;
    setState(s => ({ ...s, loading: true, error: null }));
    api(`/public/departments/${department.slug}/availability?date=${date}${doctorId ? `&doctor=${doctorId}` : ''}`)
      .then(res => active && setState({ loading: false, data: res.data, error: null }))
      .catch(err => active && setState({ loading: false, data: null, error: err.message }));
    return () => { active = false; };
  }, [department.slug, date, doctorId, version]);

  const book = (doctor, time) => {
    const target = `/patient/book?doctor=${doctor.id}&date=${date}&time=${time}`;
    if (!user) history.push('/login', { from: target });
    else history.push(target);
  };

  if (!doctors.length) {
    return (
      <EmptyState icon="calendar" title="No appointment times yet">
        This department has no doctors with published consultation hours yet. Please check another department or come back later.
      </EmptyState>
    );
  }

  return (
    <div className="card card-body">
      <div className="availability-controls">
        <div className="field" style={{ minWidth: 220 }}>
          <label htmlFor="availability-doctor">Doctor</label>
          <select id="availability-doctor" className="select" value={doctorId} onChange={e => setDoctorId(e.target.value)}>
            <option value="">All doctors in {department.name}</option>
            {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        {user && user.who !== 'pat' && (
          <p className="alert alert-info small" style={{ margin: 0 }}>
            <Icon name="alert" size={16} /> Appointments are booked from a patient account.
          </p>
        )}
      </div>
      <div className="date-strip" role="group" aria-label="Choose a date">
        {days.map(d => {
          const open = workingDays.includes(weekdayOf(d));
          const dt = new Date(`${d}T00:00:00`);
          return (
            <button key={d} type="button" className={`date-option ${d === date ? 'selected' : ''}`} disabled={!open}
              aria-pressed={d === date} aria-label={`${formatDate(d)}${open ? '' : ', no consultations'}`} onClick={() => setDate(d)}>
              <span>{shortDay(WEEKDAYS[dt.getDay()])}</span>
              <strong>{dt.getDate()}</strong>
              <span>{dt.toLocaleDateString('en-IN', { month: 'short' })}</span>
            </button>
          );
        })}
      </div>
      <div aria-live="polite">
        {!date && <p className="muted">No consultation days in the next {AVAILABILITY_DAYS} days.</p>}
        {date && state.loading && <div className="skeleton" style={{ height: 80, marginTop: 16 }} role="status" aria-label="Loading free times" />}
        {date && state.error && <div style={{ marginTop: 16 }}><ErrorBox message={state.error} onRetry={() => setVersion(n => n + 1)} /></div>}
        {date && !state.loading && state.data && (
          <div className="stack" style={{ gap: 18, marginTop: 18 }}>
            <h3 className="small muted" style={{ margin: 0 }}>Free one-hour slots on {formatDate(date)}</h3>
            {state.data.map(doctor => {
              const profile = department.doctors.find(d => d.id === doctor.id);
              return (
                <div key={doctor.id} className="availability-row">
                  <div>
                    <strong>{doctor.name}</strong>
                    {profile && profile.consultationFee !== null && profile.consultationFee !== undefined && (
                      <div className="muted small">Fee {formatFee(profile.consultationFee)}</div>
                    )}
                  </div>
                  {doctor.slots.length ? (
                    <div className="slot-grid">
                      {doctor.slots.map(time => (
                        <button key={time} type="button" className="slot" onClick={() => book(doctor, time)}
                          disabled={Boolean(user && user.who !== 'pat')}
                          aria-label={`Book ${doctor.name} at ${formatTime(time)} on ${formatDate(date)}`}>
                          {formatTime(time)}
                        </button>
                      ))}
                    </div>
                  ) : <span className="badge badge-gray">Fully booked or not working this day</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {!user && (
        <p className="muted small" style={{ marginTop: 18 }}>
          <Icon name="lock" size={14} /> Choosing a time asks you to <Link to="/login">sign in</Link> or <Link to="/register">create a patient account</Link> first. The time is held only once you confirm the booking.
        </p>
      )}
    </div>
  );
}

const InfoRow = ({ icon, label, children }) => (
  <div className="summary-row">
    <Icon name={icon} />
    <div><div className="muted small">{label}</div>{children}</div>
  </div>
);

export function DepartmentPage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const { data, loading, error, status, reload } = useApi(`/public/departments/${encodeURIComponent(slug)}`);
  const [doctorId, setDoctorId] = useState('');
  const department = data && data.data;
  usePageTitle(department ? department.name : 'Department');

  useEffect(() => { setDoctorId(''); }, [slug]);

  if (loading && !department) {
    return (
      <PublicPage>
        <section className="dept-hero"><div className="container">
          <div className="skeleton" style={{ height: 24, width: 220 }} />
          <div className="skeleton" style={{ height: 44, width: 360, marginTop: 18 }} />
          <div className="skeleton" style={{ height: 70, marginTop: 18 }} />
          <span className="sr-only" role="status">Loading department…</span>
        </div></section>
      </PublicPage>
    );
  }

  if (status === 404) {
    return (
      <PublicPage>
        <section className="not-found">
          <strong aria-hidden="true">404</strong>
          <h1>We couldn&apos;t find that department</h1>
          <p>It may have been renamed or is not open to patients at the moment.</p>
          <div className="row"><Link to="/departments" className="btn btn-primary">Browse all departments</Link></div>
        </section>
      </PublicPage>
    );
  }

  if (error) {
    return (
      <PublicPage>
        <section className="section"><div className="container">
          <Crumbs current="Department" />
          <ErrorBox message={`We could not load this department. ${error}`} onRetry={reload} />
        </div></section>
      </PublicPage>
    );
  }

  const d = department;
  const bookTarget = '#availability';
  const contact = [
    d.phone && ['phone', 'Phone', <a href={`tel:${d.phone.replace(/[^+0-9]/g, '')}`}>{d.phone}</a>],
    d.email && ['mail', 'Email', <a href={`mailto:${d.email}`}>{d.email}</a>],
    d.location && ['pin', 'Location in the hospital', d.location],
    d.operatingHours && ['clock', 'Operating hours', d.operatingHours],
  ].filter(Boolean);
  const checkDoctor = doctor => {
    setDoctorId(String(doctor.id));
    const el = document.getElementById('availability');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <PublicPage>
      <section className="dept-hero">
        <div className="container dept-hero-grid">
          <div>
            <Crumbs current={d.name} />
            <div className="row" style={{ gap: 14, marginTop: 8 }}>
              <span className="feature-icon" style={{ margin: 0 }}><Icon name={d.icon} size={24} /></span>
              <h1>{d.name}</h1>
            </div>
            <p className="lead">{d.shortDescription}</p>
            {d.services.length > 0 && (
              <ul className="chip-row dept-key-services" aria-label="Key services">
                {d.services.slice(0, 4).map(s => <li key={s.id} className="chip">{s.name}</li>)}
              </ul>
            )}
            <div className="hero-actions">
              <a href={bookTarget} className="btn btn-primary btn-lg"><Icon name="calendar-plus" /> Book appointment</a>
              <a href="#doctors" className="btn btn-secondary btn-lg"><Icon name="stethoscope" /> Meet our doctors</a>
            </div>
          </div>
          {d.imageUrl && <img className="dept-hero-image" src={d.imageUrl} alt="" />}
        </div>
      </section>

      <div className="container">
        <p className="dept-emergency"><Icon name="phone" size={16} /> Online booking is not for emergencies. In an emergency, call the ambulance on <strong>108</strong>.</p>
      </div>

      <section className="section dept-section" aria-labelledby="about-heading">
        <div className="container dept-two-col">
          <div>
            <h2 id="about-heading">About {d.name}</h2>
            {d.description.split(/\n+/).map(para => <p key={para}>{para}</p>)}
          </div>
          <div className="card card-body">
            <h3>Common reasons to visit</h3>
            {d.commonConcerns.length ? (
              <ul className="check-list">{d.commonConcerns.map(c => <li key={c}><Icon name="check" /> {c}</li>)}</ul>
            ) : <p className="muted">Ask at your appointment about the concerns this department handles.</p>}
            {d.consultationDays.length > 0 && (
              <p className="muted small" style={{ marginTop: 12 }}>
                Consultations on {sortDays(d.consultationDays).join(', ')}.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="section section-alt dept-section" aria-labelledby="services-heading">
        <div className="container">
          <h2 id="services-heading">Services</h2>
          <p className="muted">Consultation services offered by {d.name} at this hospital.</p>
          {d.services.length ? (
            <div className="grid-3" style={{ marginTop: 20 }}>
              {d.services.map(s => (
                <div key={s.id} className="card card-body dept-service">
                  <Icon name="clipboard" />
                  <div><h3>{s.name}</h3>{s.description && <p className="muted small">{s.description}</p>}</div>
                </div>
              ))}
            </div>
          ) : <EmptyState icon="clipboard" title="Services not listed yet">The hospital has not published this department&apos;s services yet.</EmptyState>}
        </div>
      </section>

      <section className="section dept-section" id="doctors" aria-labelledby="doctors-heading">
        <div className="container">
          <h2 id="doctors-heading">Meet our doctors</h2>
          {d.doctors.some(doc => doc.isDemo) && (
            <p className="muted small">Profiles marked “Demo profile” are fictional sample doctors used to demonstrate the system.</p>
          )}
          {d.doctors.length ? (
            <div className="grid-3" style={{ marginTop: 20 }}>
              {d.doctors.map(doc => <DoctorCard key={doc.id} doctor={doc} onCheck={checkDoctor} />)}
            </div>
          ) : (
            <EmptyState icon="stethoscope" title={`No doctors listed in ${d.name} yet`}
              action={<Link to="/departments" className="btn btn-secondary">Browse other departments</Link>}>
              General Medicine can assess most concerns and refer you to the right specialist.
            </EmptyState>
          )}
        </div>
      </section>

      <section className="section section-alt dept-section" id="availability" aria-labelledby="availability-heading">
        <div className="container">
          <h2 id="availability-heading">Appointment availability</h2>
          <p className="muted">Free times update live from the booking system. A time is only reserved when you confirm the booking.</p>
          <div style={{ marginTop: 20 }}>
            <Availability department={d} doctorId={doctorId} setDoctorId={setDoctorId} />
          </div>
        </div>
      </section>

      <section className="section dept-section" aria-labelledby="contact-heading">
        <div className="container dept-two-col">
          <div>
            <h2 id="contact-heading">Contact and visiting information</h2>
            {contact.length ? (
              <div className="stack" style={{ gap: 4, marginTop: 12 }}>
                {contact.map(([icon, label, value]) => <InfoRow key={label} icon={icon} label={label}>{value}</InfoRow>)}
              </div>
            ) : (
              <p className="muted">Contact details for this department have not been published yet. You can book online at any time.</p>
            )}
            {d.instructions && <div className="alert alert-info" style={{ marginTop: 16 }}><Icon name="alert" /><span>{d.instructions}</span></div>}
            <ul className="check-list" style={{ marginTop: 16 }}>
              <li><Icon name="check" /> Each appointment lasts one hour.</li>
              <li><Icon name="check" /> You can cancel an upcoming appointment from My appointments.</li>
              <li><Icon name="check" /> Your diagnosis and prescription appear in your medical records after the visit.</li>
            </ul>
          </div>
          <div className="card card-body">
            <h3>What would you like to do?</h3>
            <div className="stack" style={{ gap: 10, marginTop: 12 }}>
              <a href={bookTarget} className="btn btn-primary btn-block"><Icon name="calendar-plus" size={16} /> Book an appointment</a>
              <Link to="/#doctors" className="btn btn-secondary btn-block"><Icon name="users" size={16} /> View all doctors</Link>
              <Link to="/departments" className="btn btn-secondary btn-block"><Icon name="cross" size={16} /> Browse all departments</Link>
              {!user && <Link to="/login" className="btn btn-ghost btn-block">Log in</Link>}
              {!user && <Link to="/register" className="btn btn-ghost btn-block">Create a patient account</Link>}
            </div>
            <Link to="/departments" className="small" style={{ display: 'inline-flex', gap: 4, marginTop: 14, alignItems: 'center' }}>
              <Icon name="chevron-left" size={14} /> Back to departments
            </Link>
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
