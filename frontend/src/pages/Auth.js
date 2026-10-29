import React, { useMemo, useState } from 'react';
import { Link, useHistory, useLocation } from 'react-router-dom';
import Icon from '../components/Icon';
import { Brand } from '../components/Layout';
import {
  FormAlert, PasswordField, PhoneField, SelectField, TextAreaField, TextField, useValidatedForm,
} from '../components/Form';
import { useApi, usePageTitle, useToast } from '../components/ui';
import { api } from '../api';
import { homeFor, useAuth } from '../auth';
import { formatTime, todayString } from '../format';
import v from '../validation';

const GENDER_OPTIONS = [['female', 'Female'], ['male', 'Male'], ['other', 'Other']];

function AuthShell({ title, points, children }) {
  return (
    <div className="auth">
      <aside className="auth-aside">
        <Brand />
        <div>
          <h2>{title}</h2>
          <ul className="check-list">
            {points.map(p => <li key={p}><Icon name="check-circle" /> {p}</li>)}
          </ul>
        </div>
        <p className="small" style={{ opacity: 0.8 }}>
          <Icon name="shield" size={14} /> Your information is protected and only shared with your care team.
        </p>
      </aside>
      <main className="auth-main" id="main">{children}</main>
    </div>
  );
}

// Shared submit handling: shows server field errors next to fields and other errors in a banner
function useSubmit(form) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = (request, onSuccess) => e => {
    e.preventDefault();
    setError('');
    if (!form.validateAll()) return;
    setBusy(true);
    request()
      .then(onSuccess)
      .catch(err => {
        setBusy(false);
        if (err.fields && Object.keys(err.fields).length) form.setServerErrors(err.fields);
        setError(err.message);
      });
  };
  return { busy, error, run };
}

// ---------- Sign in ----------

const loginRules = {
  email: v.checkEmail,
  password: value => (value ? null : 'Password is required'),
};

export function Login() {
  usePageTitle('Sign in');
  const { setUser } = useAuth();
  const history = useHistory();
  const location = useLocation();
  const notify = useToast();
  const params = new URLSearchParams(location.search);
  const [role, setRole] = useState(params.get('role') === 'doctor' ? 'doc' : 'pat');
  const form = useValidatedForm({ email: '', password: '', remember: false }, loginRules);
  const { busy, error, run } = useSubmit(form);
  const reset = params.get('reset') === '1';

  const submit = run(
    () => api('/auth/login', {
      method: 'POST',
      body: { email: form.values.email, password: form.values.password, remember: form.values.remember, isDoctor: role === 'doc' },
    }),
    user => {
      setUser(user);
      notify(`Welcome back, ${user.name}.`);
      const from = location.state && location.state.from;
      history.replace(from && from.startsWith(homeFor(user)) ? from : homeFor(user));
    },
  );

  return (
    <AuthShell
      title="Your health records, appointments and prescriptions in one secure place."
      points={['Book appointments with real-time availability', 'See diagnoses and prescriptions after each visit', 'Keep your full medical history up to date']}
    >
      <div className="auth-box">
        <div className="mobile-brand"><Brand /></div>
        <h1>Sign in</h1>
        <p>Welcome back. Sign in to continue to your dashboard.</p>
        <div className="tabs" role="tablist" aria-label="Account type" style={{ width: '100%', marginBottom: 20 }}>
          {[['pat', "I'm a patient"], ['doc', "I'm a doctor"]].map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={role === key}
              className={`tab ${role === key ? 'active' : ''}`} style={{ flex: 1 }} onClick={() => setRole(key)}>
              {label}
            </button>
          ))}
        </div>
        <form onSubmit={submit} noValidate>
          {reset && !error && <FormAlert type="success" message="Your password has been changed. Sign in with your new password." />}
          <FormAlert message={error} />
          <TextField form={form} name="email" label="Email address" type="email" autoComplete="email" placeholder="you@example.com" required />
          <PasswordField form={form} name="password" label="Password" />
          <div className="auth-options">
            <label className="checkbox">
              <input type="checkbox" {...form.bind('remember', { type: 'checkbox' })} />
              Keep me signed in for 30 days
            </label>
            <Link to={`/forgot-password${role === 'doc' ? '?role=doctor' : ''}`}>Forgot password?</Link>
          </div>
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy} aria-busy={busy}>
            {busy ? 'Signing in…' : `Sign in as ${role === 'doc' ? 'doctor' : 'patient'}`}
          </button>
          <p className="muted small">Only tick “Keep me signed in” on your own device.</p>
        </form>
        <div className="auth-switch">
          {role === 'doc'
            ? <>New to HMS Hospital? <Link to="/register/doctor">Register as a doctor</Link></>
            : <>Don&apos;t have an account? <Link to={{ pathname: '/register', state: location.state }}>Create one</Link></>}
        </div>
        <div className="auth-switch"><Link to="/"><Icon name="chevron-left" size={14} /> Back to website</Link></div>
      </div>
    </AuthShell>
  );
}

// ---------- Administrator sign-in ----------
// Administrator accounts are created on the server (npm run create-admin); there is no sign-up.

export function AdminLogin() {
  usePageTitle('Administrator sign in');
  const { setUser } = useAuth();
  const history = useHistory();
  const location = useLocation();
  const notify = useToast();
  const form = useValidatedForm({ email: '', password: '' }, loginRules);
  const { busy, error, run } = useSubmit(form);

  const submit = run(
    () => api('/auth/login', { method: 'POST', body: { email: form.values.email, password: form.values.password, role: 'admin' } }),
    user => {
      setUser(user);
      notify(`Signed in as ${user.name}.`);
      const from = location.state && location.state.from;
      history.replace(from && from.startsWith('/admin') ? from : '/admin');
    },
  );

  return (
    <AuthShell
      title="Hospital administration"
      points={['Edit department pages and services', 'Assign doctors and working hours', 'Changes appear on the website straight away']}
    >
      <div className="auth-box">
        <div className="mobile-brand"><Brand /></div>
        <h1>Administrator sign in</h1>
        <p>For hospital staff who manage the website. Patients and doctors use the <Link to="/login">main sign-in page</Link>.</p>
        <form onSubmit={submit} noValidate>
          <FormAlert message={error} />
          <TextField form={form} name="email" label="Email address" type="email" autoComplete="username" required />
          <PasswordField form={form} name="password" label="Password" />
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy} aria-busy={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="auth-switch"><Link to="/"><Icon name="chevron-left" size={14} /> Back to website</Link></div>
      </div>
    </AuthShell>
  );
}

// ---------- Patient sign-up ----------

export function RegisterPatient() {
  usePageTitle('Create your account');
  const { setUser } = useAuth();
  const history = useHistory();
  const location = useLocation();
  const notify = useToast();
  const rules = useMemo(() => ({
    firstName: value => v.checkName(value, 'First name'),
    lastName: value => v.checkName(value, 'Last name'),
    email: v.checkEmail,
    phone: value => v.checkPhone(value, { required: true }),
    dob: value => v.checkDateOfBirth(value),
    gender: value => v.checkChoice(value, v.GENDERS, 'gender'),
    address: value => v.checkAddress(value),
    password: v.checkPassword,
    confirmPassword: (value, all) => v.checkPasswordConfirmation(all.password, value),
    conditions: value => v.checkText(value, 'Conditions', { required: false }),
    surgeries: value => v.checkText(value, 'Surgeries', { required: false }),
    medications: value => v.checkText(value, 'Medications', { required: false }),
    acceptTerms: value => (value ? null : 'Please accept the terms to continue'),
  }), []);
  const form = useValidatedForm({
    firstName: '', lastName: '', email: '', phone: '', dob: '', gender: '', address: '',
    password: '', confirmPassword: '', conditions: '', surgeries: '', medications: '', acceptTerms: false,
  }, rules);
  const { busy, error, run } = useSubmit(form);

  const submit = run(
    () => api('/auth/patient/register', { method: 'POST', body: form.values }),
    user => {
      setUser(user);
      notify('Your account has been created. Welcome to HMS Hospital!');
      // Continue to the page that sent the visitor here, such as a booking started on a department page
      const from = location.state && location.state.from;
      history.replace(from && from.startsWith('/patient') ? from : '/patient');
    },
  );

  return (
    <AuthShell
      title="Create your patient account."
      points={['Book with any of our specialists', 'Your records are shared only with your doctors', 'Cancel or rebook at any time']}
    >
      <div className="auth-box wide">
        <div className="mobile-brand"><Brand /></div>
        <h1>Create your account</h1>
        <p>Already have an account? <Link to="/login">Sign in</Link></p>
        <form onSubmit={submit} noValidate style={{ display: 'block' }}>
          <p className="required-note">Fields marked <span className="req" style={{ color: 'var(--red)' }}>*</span> are required.</p>
          <FormAlert message={error} />

          <fieldset className="form-section">
            <legend><h3>Personal details</h3></legend>
            <p className="muted small">As they should appear on your medical records.</p>
            <div className="form-grid">
              <TextField form={form} name="firstName" label="First name" autoComplete="given-name" required />
              <TextField form={form} name="lastName" label="Last name" autoComplete="family-name" required />
              <PhoneField form={form} required />
              <TextField form={form} name="dob" label="Date of birth" type="date" max={todayString()} min="1900-01-01" autoComplete="bday" optional />
              <SelectField form={form} name="gender" label="Gender" options={GENDER_OPTIONS} required />
              <TextField form={form} name="address" label="City / address" autoComplete="street-address" maxLength={200} required />
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend><h3>Sign-in details</h3></legend>
            <p className="muted small">You will use your email address and password to sign in.</p>
            <div className="form-grid">
              <TextField form={form} name="email" label="Email address" type="email" autoComplete="email" className="span-2" required />
              <PasswordField form={form} name="password" label="Password" autoComplete="new-password" showRules />
              <PasswordField form={form} name="confirmPassword" label="Confirm password" autoComplete="new-password" />
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend><h3>Medical background</h3></legend>
            <p className="muted small">Optional, but it helps your doctor. Leave a box empty if it does not apply.</p>
            <div className="form-grid">
              <div className="span-2"><TextAreaField form={form} name="conditions" label="Existing conditions" optional rows={2} placeholder="e.g. Type 2 diabetes, asthma" /></div>
              <TextAreaField form={form} name="surgeries" label="Past surgeries" optional rows={2} placeholder="e.g. Appendectomy (2019)" />
              <TextAreaField form={form} name="medications" label="Current medications" optional rows={2} placeholder="e.g. Metformin 500 mg" />
            </div>
          </fieldset>

          <div className="field" style={{ marginTop: 20 }}>
            <label className="checkbox" htmlFor="acceptTerms">
              <input type="checkbox" required {...form.bind('acceptTerms', { type: 'checkbox' })} />
              <span>
                I confirm these details are correct and agree to the <Link to="/terms" target="_blank" rel="noopener">terms and privacy notice</Link>, including that my doctors may view my medical records.
                <span className="req" aria-hidden="true">*</span>
              </span>
            </label>
            {form.errors.acceptTerms && (
              <span className="error-text" id="acceptTerms-error" role="alert"><Icon name="alert" size={14} /> {form.errors.acceptTerms}</span>
            )}
          </div>
          <button type="submit" className="btn btn-primary btn-lg btn-block" style={{ marginTop: 20 }} disabled={busy} aria-busy={busy}>
            {busy ? 'Creating account…' : 'Create account'}
          </button>
          <div className="auth-switch">Are you a doctor? <Link to="/register/doctor">Register here</Link></div>
        </form>
      </div>
    </AuthShell>
  );
}

// ---------- Doctor sign-up ----------

export function RegisterDoctor() {
  usePageTitle('Doctor registration');
  const { setUser } = useAuth();
  const history = useHistory();
  const notify = useToast();
  const overview = useApi('/public/overview');
  const schedules = useApi('/public/schedules');
  const inviteRequired = Boolean(overview.data && overview.data.doctorInviteRequired);
  // Departments come from the database, so new ones added by an administrator appear here
  const departments = useMemo(() => (overview.data ? overview.data.specializations : []), [overview.data]);
  const rules = useMemo(() => ({
    firstName: value => v.checkName(value, 'First name'),
    lastName: value => v.checkName(value, 'Last name'),
    email: v.checkEmail,
    gender: value => v.checkChoice(value, v.GENDERS, 'gender'),
    specialization: value => v.checkChoice(value, departments, 'department'),
    schedule: value => (value ? null : 'Please choose your working hours'),
    password: v.checkPassword,
    confirmPassword: (value, all) => v.checkPasswordConfirmation(all.password, value),
    ...(inviteRequired ? { inviteCode: value => (String(value || '').trim() ? null : 'Invite code is required') } : {}),
  }), [inviteRequired, departments]);
  const form = useValidatedForm({
    firstName: '', lastName: '', gender: '', specialization: '', schedule: '', email: '',
    password: '', confirmPassword: '', inviteCode: '',
  }, rules);
  const { busy, error, run } = useSubmit(form);

  const submit = run(
    () => api('/auth/doctor/register', { method: 'POST', body: form.values }),
    user => {
      setUser(user);
      notify('Your doctor account has been created.');
      history.replace('/doctor');
    },
  );

  return (
    <AuthShell
      title="Join our team of specialists."
      points={['See your appointments at a glance', "Review each patient's history before the visit", 'Record diagnoses and prescriptions online']}
    >
      <div className="auth-box wide">
        <div className="mobile-brand"><Brand /></div>
        <h1>Doctor registration</h1>
        <p>Already registered? <Link to="/login?role=doctor">Sign in</Link></p>
        <form onSubmit={submit} noValidate style={{ display: 'block' }}>
          <p className="required-note">All fields are required.</p>
          <FormAlert message={error} />
          <fieldset className="form-section">
            <legend><h3>Professional details</h3></legend>
            <p className="muted small">Patients see your name and department when booking.</p>
            <div className="form-grid">
              <TextField form={form} name="firstName" label="First name" autoComplete="given-name" required />
              <TextField form={form} name="lastName" label="Last name" autoComplete="family-name" required />
              <SelectField form={form} name="gender" label="Gender" options={GENDER_OPTIONS} required />
              <SelectField form={form} name="specialization" label="Department" required
                options={departments.map(s => [s, s])} />
            </div>
          </fieldset>
          <fieldset className="form-section">
            <legend><h3>Working hours <span className="req" style={{ color: 'var(--red)' }} aria-hidden="true">*</span></h3></legend>
            <p className="muted small">Each schedule includes a one-hour break. Appointments last one hour.</p>
            <div className="option-cards" role="radiogroup" aria-label="Working hours" aria-describedby={form.errors.schedule ? 'schedule-error' : undefined}>
              {(schedules.data ? schedules.data.data : []).map((s, i) => (
                <label key={s.id} className={`option-card ${String(form.values.schedule) === String(s.id) ? 'selected' : ''}`}>
                  <input type="radio" name="schedule" id={i === 0 ? 'schedule' : undefined} value={s.id}
                    checked={String(form.values.schedule) === String(s.id)}
                    onChange={() => form.setValue('schedule', String(s.id))} />
                  <strong>{formatTime(s.startTime)} – {formatTime(s.endTime)}</strong>
                  <span className="muted">{s.days.map(d => d.slice(0, 3)).join(', ')}</span>
                  <div className="muted">Break at {formatTime(s.breakTime)}</div>
                </label>
              ))}
            </div>
            {form.errors.schedule && (
              <span className="error-text" id="schedule-error" role="alert" style={{ display: 'flex', gap: 6, marginTop: 8, color: 'var(--red)', fontSize: 13 }}>
                <Icon name="alert" size={14} /> {form.errors.schedule}
              </span>
            )}
          </fieldset>
          <fieldset className="form-section">
            <legend><h3>Sign-in details</h3></legend>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <TextField form={form} name="email" label="Work email" type="email" autoComplete="email" className="span-2" required />
              <PasswordField form={form} name="password" label="Password" autoComplete="new-password" showRules />
              <PasswordField form={form} name="confirmPassword" label="Confirm password" autoComplete="new-password" />
              {inviteRequired && (
                <TextField form={form} name="inviteCode" label="Hospital invite code" autoComplete="off" className="span-2" required
                  hint="Provided by the hospital administrator" />
              )}
            </div>
          </fieldset>
          <button type="submit" className="btn btn-primary btn-lg btn-block" style={{ marginTop: 24 }} disabled={busy} aria-busy={busy}>
            {busy ? 'Creating account…' : 'Create doctor account'}
          </button>
          <div className="auth-switch">Are you a patient? <Link to="/register">Register here</Link></div>
        </form>
      </div>
    </AuthShell>
  );
}

// ---------- Password recovery ----------

export function ForgotPassword() {
  usePageTitle('Reset your password');
  const location = useLocation();
  const [role, setRole] = useState(new URLSearchParams(location.search).get('role') === 'doctor' ? 'doc' : 'pat');
  const form = useValidatedForm({ email: '' }, { email: v.checkEmail });
  const { busy, error, run } = useSubmit(form);
  const [sent, setSent] = useState('');

  const submit = run(
    () => api('/auth/forgot-password', { method: 'POST', body: { email: form.values.email, isDoctor: role === 'doc' } }),
    res => setSent(res.message),
  );

  return (
    <AuthShell title="Forgotten your password?" points={['We email you a secure reset link', 'The link works once and expires in 30 minutes', 'Your other devices are signed out after the reset']}>
      <div className="auth-box">
        <div className="mobile-brand"><Brand /></div>
        <h1>Reset your password</h1>
        <p>Enter the email address you registered with and we will send you a reset link.</p>
        {sent ? (
          <>
            <FormAlert type="success" message={sent} />
            <div className="auth-switch"><Link to="/login">Back to sign in</Link></div>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <div className="tabs" role="tablist" aria-label="Account type" style={{ width: '100%' }}>
              {[['pat', 'Patient account'], ['doc', 'Doctor account']].map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={role === key}
                  className={`tab ${role === key ? 'active' : ''}`} style={{ flex: 1 }} onClick={() => setRole(key)}>
                  {label}
                </button>
              ))}
            </div>
            <FormAlert message={error} />
            <TextField form={form} name="email" label="Email address" type="email" autoComplete="email" required />
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy} aria-busy={busy}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
            <div className="auth-switch"><Link to="/login">Back to sign in</Link></div>
          </form>
        )}
      </div>
    </AuthShell>
  );
}

export function ResetPassword() {
  usePageTitle('Choose a new password');
  const history = useHistory();
  const location = useLocation();
  const token = new URLSearchParams(location.search).get('token') || '';
  const rules = useMemo(() => ({
    password: v.checkPassword,
    confirmPassword: (value, all) => v.checkPasswordConfirmation(all.password, value),
  }), []);
  const form = useValidatedForm({ password: '', confirmPassword: '' }, rules);
  const { busy, error, run } = useSubmit(form);

  const submit = run(
    () => api('/auth/reset-password', { method: 'POST', body: { token, ...form.values } }),
    res => history.replace(`/login?reset=1${res.who === 'doc' ? '&role=doctor' : ''}`),
  );

  return (
    <AuthShell title="Choose a new password." points={['Use a password you do not use anywhere else', 'Mix upper and lower case letters and numbers']}>
      <div className="auth-box">
        <div className="mobile-brand"><Brand /></div>
        <h1>Choose a new password</h1>
        <p>After saving, sign in with your new password.</p>
        {!/^[a-f0-9]{64}$/.test(token) ? (
          <>
            <FormAlert message="This reset link is incomplete. Please use the full link from the email, or request a new one." />
            <div className="auth-switch"><Link to="/forgot-password">Request a new link</Link></div>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <FormAlert message={error} />
            <PasswordField form={form} name="password" label="New password" autoComplete="new-password" showRules />
            <PasswordField form={form} name="confirmPassword" label="Confirm new password" autoComplete="new-password" />
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy} aria-busy={busy}>
              {busy ? 'Saving…' : 'Save new password'}
            </button>
            {error && <div className="auth-switch"><Link to="/forgot-password">Request a new link</Link></div>}
          </form>
        )}
      </div>
    </AuthShell>
  );
}

// ---------- Static pages ----------

export function Terms() {
  usePageTitle('Terms and privacy');
  return (
    <main className="terms" id="main">
      <Brand />
      <h1 style={{ marginTop: 28 }}>Terms of use and privacy notice</h1>
      <p>This notice explains how HMS Hospital uses the information you give when you create an account.</p>
      <h2>What we store</h2>
      <p>Your name, contact details, date of birth, address and the medical background you enter, plus your appointments, diagnoses and prescriptions. Your password is stored only as a secure one-way hash.</p>
      <h2>Who can see it</h2>
      <p>You can see your own records. A doctor can see your records only after you book an appointment with them, and every time a doctor opens your record it is logged.</p>
      <h2>Your responsibilities</h2>
      <p>Keep your password private, give accurate information and only choose “Keep me signed in” on your own device. Online booking is not for emergencies: call 108 for an ambulance.</p>
      <h2>Your choices</h2>
      <p>You can update your details on your profile page at any time and cancel upcoming appointments yourself.</p>
      <p style={{ marginTop: 28 }}><Link to="/register">Back to registration</Link></p>
    </main>
  );
}

export function NotFound() {
  usePageTitle('Page not found');
  const { user } = useAuth();
  return (
    <main className="not-found" id="main">
      <strong aria-hidden="true">404</strong>
      <h1>We couldn&apos;t find that page</h1>
      <p>The link may be old, or the page may have moved.</p>
      <div className="row">
        <Link to="/" className="btn btn-secondary">Hospital website</Link>
        {user && <Link to={homeFor(user)} className="btn btn-primary">Go to dashboard</Link>}
      </div>
    </main>
  );
}
