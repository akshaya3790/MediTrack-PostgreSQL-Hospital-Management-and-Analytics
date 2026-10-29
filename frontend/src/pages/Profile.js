import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Icon from '../components/Icon';
import {
  FormAlert, PasswordField, PhoneField, SelectField, TextField, useValidatedForm,
} from '../components/Form';
import {
  Avatar, ErrorBox, PageHead, Spinner, useApi, usePageTitle, useToast,
} from '../components/ui';
import { api } from '../api';
import { useAuth } from '../auth';
import { capitalize, formatTimeRange, shortDay, sortDays, todayString } from '../format';
import v from '../validation';

function PersonalDetails({ profile, specializations, onSaved }) {
  const { user } = useAuth();
  const notify = useToast();
  const isDoctor = user.who === 'doc';
  const isAdmin = user.who === 'adm';
  const rules = useMemo(() => (isAdmin ? {
    name: value => v.checkName(value, 'Full name', { min: 2, max: 100 }),
  } : isDoctor ? {
    name: value => v.checkName(value, 'Full name', { min: 2, max: 100 }),
    specialization: value => v.checkChoice(value, specializations, 'department'),
  } : {
    name: value => v.checkName(value, 'Full name', { min: 2, max: 100 }),
    phone: value => v.checkPhone(value),
    dob: value => v.checkDateOfBirth(value),
    address: value => v.checkAddress(value),
  }), [isAdmin, isDoctor, specializations]);
  const form = useValidatedForm({
    name: profile.name || '',
    address: profile.address || '',
    phone: profile.phone || '',
    dob: profile.dob || '',
    specialization: profile.specialization || '',
  }, rules);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = e => {
    e.preventDefault();
    setError('');
    if (!form.validateAll()) return;
    setBusy(true);
    api('/profile', { method: 'PUT', body: form.values })
      .then(() => { notify('Your profile has been updated.'); onSaved(); })
      .catch(err => { form.setServerErrors(err.fields); setError(err.message); setBusy(false); });
  };

  return (
    <form className="card" onSubmit={submit} noValidate>
      <div className="card-header"><h2>Personal details</h2></div>
      <div className="card-body">
        <FormAlert message={error} />
        <div className="form-grid">
          <TextField form={form} name="name" label="Full name" autoComplete="name" maxLength={100} className="span-2" required />
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input id="email" className="input" value={profile.email} disabled aria-describedby="email-hint" />
            <span className="hint" id="email-hint">Your email is your login and cannot be changed.</span>
          </div>
          {!isAdmin && (
            <div className="field">
              <label htmlFor="gender">Gender</label>
              <input id="gender" className="input" value={capitalize(profile.gender)} disabled />
            </div>
          )}
          {isAdmin ? null : isDoctor ? (
            <SelectField form={form} name="specialization" label="Department" className="span-2" required
              options={specializations.map(s => [s, s])} />
          ) : (
            <>
              <PhoneField form={form} optional />
              <TextField form={form} name="dob" label="Date of birth" type="date" max={todayString()} min="1900-01-01" optional />
              <TextField form={form} name="address" label="City / address" autoComplete="street-address" maxLength={200} className="span-2" required />
            </>
          )}
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </form>
  );
}

const EMPTY_PASSWORDS = { oldPassword: '', newPassword: '', confirmPassword: '' };

function Security() {
  const notify = useToast();
  const rules = useMemo(() => ({
    oldPassword: value => (value ? null : 'Current password is required'),
    newPassword: v.checkPassword,
    confirmPassword: (value, all) => v.checkPasswordConfirmation(all.newPassword, value),
  }), []);
  const form = useValidatedForm(EMPTY_PASSWORDS, rules);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = e => {
    e.preventDefault();
    setError('');
    if (!form.validateAll()) return;
    setBusy(true);
    api('/auth/password', { method: 'POST', body: form.values })
      .then(() => {
        notify('Password changed. Your other devices have been signed out.');
        form.setValues(EMPTY_PASSWORDS);
      })
      .catch(err => { form.setServerErrors(err.fields); setError(err.message); })
      .finally(() => setBusy(false));
  };

  return (
    <form className="card" onSubmit={submit} noValidate>
      <div className="card-header"><h2>Change password</h2></div>
      <div className="card-body">
        <FormAlert message={error} />
        <div className="form-grid">
          <div className="span-2"><PasswordField form={form} name="oldPassword" label="Current password" /></div>
          <PasswordField form={form} name="newPassword" label="New password" autoComplete="new-password" showRules />
          <PasswordField form={form} name="confirmPassword" label="Confirm new password" autoComplete="new-password" />
        </div>
        <p className="muted small" style={{ marginTop: 12 }}>Changing your password signs you out on every other device.</p>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>{busy ? 'Updating…' : 'Update password'}</button>
        </div>
      </div>
    </form>
  );
}

export default function Profile() {
  usePageTitle('Profile & settings');
  const { user, refresh } = useAuth();
  const location = useLocation();
  const [tab, setTab] = useState(new URLSearchParams(location.search).get('tab') === 'security' ? 'security' : 'details');
  const { data, loading, error, reload } = useApi('/profile');
  const overview = useApi(user.who === 'doc' ? '/public/overview' : null);

  useEffect(() => {
    setTab(new URLSearchParams(location.search).get('tab') === 'security' ? 'security' : 'details');
  }, [location.search]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  const p = data.data;

  return (
    <>
      <PageHead title="Profile & settings" subtitle="Keep your details up to date and your account secure." />
      <div className="profile-grid">
        <div className="card card-body" style={{ textAlign: 'center' }}>
          <Avatar name={p.name} size="lg" />
          <h2 style={{ fontSize: 18, marginTop: 12 }}>{p.name}</h2>
          <div className="muted small">{p.email}</div>
          <div style={{ marginTop: 12 }}>
            <span className="badge badge-brand badge-plain">{{ doc: p.specialization, adm: 'Administrator' }[user.who] || 'Patient'}</span>
          </div>
          {user.who === 'doc' && p.startTime && (
            <div className="muted small" style={{ marginTop: 16, textAlign: 'left' }}>
              <div className="row" style={{ gap: 8 }}><Icon name="clock" size={15} /> {formatTimeRange(p.startTime, p.endTime)}</div>
              <div className="row" style={{ gap: 8, marginTop: 6 }}><Icon name="calendar" size={15} /> {sortDays(p.days).map(shortDay).join(', ')}</div>
            </div>
          )}
        </div>
        <div className="stack">
          <div className="tabs" role="tablist" aria-label="Profile sections">
            <button type="button" role="tab" aria-selected={tab === 'details'} className={`tab ${tab === 'details' ? 'active' : ''}`} onClick={() => setTab('details')}>Personal details</button>
            <button type="button" role="tab" aria-selected={tab === 'security'} className={`tab ${tab === 'security' ? 'active' : ''}`} onClick={() => setTab('security')}>Password &amp; security</button>
          </div>
          {tab === 'details' ? (
            <PersonalDetails
              key={JSON.stringify(p)}
              profile={p}
              specializations={overview.data ? overview.data.specializations : [p.specialization]}
              onSaved={() => { reload(); refresh(); }}
            />
          ) : <Security />}
        </div>
      </div>
    </>
  );
}
