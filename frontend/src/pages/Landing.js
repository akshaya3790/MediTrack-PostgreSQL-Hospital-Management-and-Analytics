import React from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import { DepartmentGrid } from './Departments';
import { SiteFooter, SiteNav } from '../components/Layout';
import { Avatar, usePageTitle, useApi } from '../components/ui';
import { shortDay, sortDays } from '../format';

const features = [
  ['clock', 'Real-time slots', 'See exactly when your doctor is free and book a slot that suits you, with no phone calls.'],
  ['clipboard', 'Digital records', 'Diagnoses, prescriptions and your medical history, always available and easy to print.'],
  ['shield', 'Private and secure', 'Securely hashed passwords and strict access rules: only you and your doctors see your records.'],
];

export default function Landing() {
  usePageTitle('Quality care, booked in minutes');
  const { data } = useApi('/public/overview');
  const doctors = data ? data.doctors : [];
  const counts = data ? data.counts : null;

  return (
    <>
      <SiteNav />
      <main id="main">

      <section className="hero">
        <div className="container">
          <div>
            <span className="eyebrow"><Icon name="cross" size={14} /> Multi-speciality hospital</span>
            <h1>Quality care, <span>booked in minutes.</span></h1>
            <p className="lead">
              Find the right specialist, pick a free time slot and keep every prescription in one place.
              HMS Hospital puts your health records at your fingertips.
            </p>
            <div className="hero-actions">
              <Link to="/register" className="btn btn-primary btn-lg">
                <Icon name="calendar-plus" /> Book an appointment
              </Link>
              <a href="#doctors" className="btn btn-secondary btn-lg">Meet our doctors</a>
            </div>
            {counts && (
              <div className="hero-stats">
                <div><strong>{counts.doctors}</strong><span>Specialist doctors</span></div>
                <div><strong>{counts.departments}</strong><span>Departments</span></div>
                <div><strong>{counts.completedVisits}</strong><span>Consultations</span></div>
              </div>
            )}
          </div>

          <div className="hero-visual">
            {doctors[0] && (
              <div className="hero-card">
                <div className="row">
                  <Avatar name={doctors[0].name} />
                  <div>
                    <strong>{doctors[0].name}</strong>
                    <div className="muted small">{doctors[0].specialization}</div>
                  </div>
                </div>
                <div className="muted small" style={{ marginTop: 18 }}>Weekly consultation days</div>
                <div className="slot-row">
                  {sortDays(doctors[0].days).map(day => <span key={day} className="day-pill">{shortDay(day)}</span>)}
                </div>
              </div>
            )}
            <div className="hero-card">
              <div className="row">
                <span className="stat-icon green"><Icon name="pill" /></span>
                <div>
                  <strong>Prescriptions in your records</strong>
                  <div className="muted small">Your doctor's notes appear under Medical records after each visit</div>
                </div>
              </div>
            </div>
            <div className="hero-card">
              <div className="row">
                <span className="stat-icon"><Icon name="stethoscope" /></span>
                <div>
                  <strong>Book by department</strong>
                  <div className="muted small">Pick a specialist, then a free one-hour slot</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="departments">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Departments</span>
            <h2>Specialist care under one roof</h2>
            <p>From routine check-ups to specialist treatment, our departments cover the care your family needs.</p>
          </div>
          <DepartmentGrid />
          <div style={{ textAlign: 'center', marginTop: 36 }}>
            <Link to="/departments" className="btn btn-secondary">View all departments <Icon name="arrow-right" size={16} /></Link>
          </div>
        </div>
      </section>

      <section className="section section-alt" id="doctors">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Our doctors</span>
            <h2>Experienced specialists you can trust</h2>
            <p>Every doctor publishes their weekly hours, so you always know when you can be seen.</p>
          </div>
          <div className="grid-4">
            {doctors.map(doc => (
              <div key={doc.id} className="card doctor-card">
                <Avatar name={doc.name} size="lg" />
                <h3>{doc.name}</h3>
                <Link className="small" to={`/departments/${doc.departmentSlug}`}>{doc.specialization}</Link>
                {doc.isDemo && <div><span className="badge badge-amber" style={{ marginTop: 6 }}>Demo profile</span></div>}
                <div className="days">
                  {sortDays(doc.days).map(day => <span key={day} className="day-pill">{shortDay(day)}</span>)}
                </div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 36 }}>
            <Link to="/register" className="btn btn-primary">Book with a doctor <Icon name="arrow-right" size={16} /></Link>
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">How it works</span>
            <h2>Your visit in three simple steps</h2>
          </div>
          <div className="grid-3 steps">
            <div className="card step">
              <h3>Create your account</h3>
              <p className="muted">Register once with your details and medical background. It takes about two minutes.</p>
            </div>
            <div className="card step">
              <h3>Choose a doctor and slot</h3>
              <p className="muted">Filter by department, see each doctor&apos;s free times and confirm instantly.</p>
            </div>
            <div className="card step">
              <h3>Get your prescription</h3>
              <p className="muted">After your visit, your diagnosis and prescription appear in your records.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container grid-2" style={{ alignItems: 'center', gap: 48 }}>
          <div>
            <span className="eyebrow">Why HMS Hospital</span>
            <h2 style={{ fontSize: 32, fontWeight: 800, margin: '14px 0 12px', letterSpacing: '-0.03em' }}>
              Built around patients and the doctors who care for them
            </h2>
            <ul className="check-list">
              <li><Icon name="check" /> Online booking with clash checks, so slots are never double-booked</li>
              <li><Icon name="check" /> Appointment reminders on your dashboard with the date, time and doctor</li>
              <li><Icon name="check" /> Doctors see each patient&apos;s history before the consultation</li>
              <li><Icon name="check" /> Printable medical records for insurance and second opinions</li>
            </ul>
          </div>
          <div className="stack" style={{ gap: 16 }}>
            {features.map(([icon, title, text]) => (
              <div key={title} className="card feature row" style={{ alignItems: 'flex-start', gap: 16 }}>
                <div className="feature-icon" style={{ marginBottom: 0 }}><Icon name={icon} size={22} /></div>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="cta-band">
            <div>
              <h2>Ready to book your visit?</h2>
              <p>Create a free account and see your doctor&apos;s free slots right away.</p>
            </div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <Link to="/register" className="btn btn-secondary btn-lg">Create free account</Link>
              <Link to="/login" className="btn btn-lg" style={{ color: '#fff' }}>I already have one</Link>
            </div>
          </div>
        </div>
      </section>

      </main>
      <SiteFooter />
    </>
  );
}
