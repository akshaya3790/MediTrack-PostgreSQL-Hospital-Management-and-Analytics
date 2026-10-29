import React, { useMemo, useState } from 'react';
import { Link, useHistory, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import {
  FormAlert, SelectField, TextAreaField, TextField, useValidatedForm,
} from '../components/Form';
import {
  ConfirmDialog, EmptyState, ErrorBox, Modal, PageHead, Paginated, Spinner, useApi, usePageTitle, useToast,
} from '../components/ui';
import { api } from '../api';
import { formatTimeRange, shortDay } from '../format';
import v from '../validation';
import { formatFee } from './Departments';

const ICON_OPTIONS = v.DEPARTMENT_ICONS.map(name => [name, name]);

const Status = ({ active }) => (
  <span className={`badge ${active ? 'badge-green' : 'badge-gray'}`}>{active ? 'Active' : 'Hidden'}</span>
);

const Checkbox = ({ form, name, label, hint }) => (
  <label className="checkbox" htmlFor={name}>
    <input type="checkbox" {...form.bind(name, { type: 'checkbox' })} />
    <span>{label}{hint && <span className="muted small" style={{ display: 'block' }}>{hint}</span>}</span>
  </label>
);

// Submits a form, shows field errors from the server next to the fields, and
// reports success only after the server confirms
function useSave(form) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = (request, onSaved) => e => {
    if (e) e.preventDefault();
    setError('');
    if (!form.validateAll()) return;
    setBusy(true);
    request()
      .then(res => { setBusy(false); onSaved(res); })
      .catch(err => { setBusy(false); form.setServerErrors(err.fields); setError(err.message); });
  };
  return { busy, error, save };
}

// ---------- Departments ----------

export function AdminDepartments() {
  usePageTitle('Departments');
  const { data, loading, error, reload } = useApi('/admin/departments');
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const list = data.data;
  return (
    <>
      <PageHead
        title="Departments"
        subtitle="What patients see on the public department pages. Hidden departments are not shown and cannot be booked."
        actions={<Link to="/admin/departments/new" className="btn btn-primary"><Icon name="plus" size={16} /> Add department</Link>}
      />
      <div className="card">
        {list.length === 0 ? (
          <EmptyState icon="cross" title="No departments yet" action={<Link to="/admin/departments/new" className="btn btn-primary">Add the first department</Link>} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Department</th><th>Web address</th><th>Doctors</th><th>Services</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {list.map(d => (
                  <tr key={d.id}>
                    <td>
                      <div className="cell-person">
                        <span className="stat-icon" style={{ width: 36, height: 36 }}><Icon name={d.icon} size={18} /></span>
                        <strong>{d.name}</strong>
                      </div>
                    </td>
                    <td className="muted">/departments/{d.slug}</td>
                    <td>{d.activeDoctorCount}{d.doctorCount !== d.activeDoctorCount && <span className="muted"> of {d.doctorCount}</span>}</td>
                    <td>{d.serviceCount}</td>
                    <td><Status active={d.isActive} /></td>
                    <td>
                      <div className="actions">
                        {d.isActive && <Link to={`/departments/${d.slug}`} className="btn btn-ghost btn-sm">View page</Link>}
                        <Link to={`/admin/departments/${d.id}`} className="btn btn-primary btn-sm" aria-label={`Edit ${d.name}`}>Edit</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

const departmentRules = {
  name: v.checkDepartmentName,
  slug: value => (String(value || '').trim() ? v.checkSlug(value) : null),
  shortDescription: value => v.checkText(value, 'Short description', { min: 10, max: 160 }),
  description: value => v.checkText(value, 'Description', { min: 30, max: 2000 }),
  commonConcerns: value => v.checkLines(value, 'Common concerns'),
  icon: value => v.checkChoice(value, v.DEPARTMENT_ICONS, 'icon'),
  imageUrl: v.checkImageUrl,
  phone: v.checkContactPhone,
  email: v.checkOptionalEmail,
  location: value => v.checkText(value, 'Location', { required: false, max: 120 }),
  operatingHours: value => v.checkText(value, 'Operating hours', { required: false, max: 200 }),
  instructions: value => v.checkText(value, 'Instructions', { required: false, max: 500 }),
  sortOrder: value => v.checkWholeNumber(value, 'Display order', { max: 999 }),
};

function DepartmentForm({ department, onSaved }) {
  const isNew = !department;
  const form = useValidatedForm({
    name: department ? department.name : '',
    slug: department ? department.slug : '',
    shortDescription: department ? department.shortDescription : '',
    description: department ? department.description : '',
    commonConcerns: department ? department.commonConcerns.join('\n') : '',
    icon: department ? department.icon : 'activity',
    imageUrl: (department && department.imageUrl) || '',
    phone: (department && department.phone) || '',
    email: (department && department.email) || '',
    location: (department && department.location) || '',
    operatingHours: (department && department.operatingHours) || '',
    instructions: (department && department.instructions) || '',
    sortOrder: department ? String(department.sortOrder) : '0',
    isActive: department ? department.isActive : true,
  }, departmentRules);
  const { busy, error, save } = useSave(form);
  const submit = save(
    () => api(isNew ? '/admin/departments' : `/admin/departments/${department.id}`, { method: isNew ? 'POST' : 'PUT', body: form.values }),
    onSaved,
  );
  const slugPreview = form.values.slug.trim() || v.slugify(form.values.name);

  return (
    <form className="card" onSubmit={submit} noValidate>
      <div className="card-header"><h2>{isNew ? 'New department' : 'Department details'}</h2></div>
      <div className="card-body">
        <FormAlert message={error} />
        <fieldset className="form-section">
          <legend><h3>Public page</h3></legend>
          <div className="form-grid">
            <TextField form={form} name="name" label="Department name" maxLength={50} required />
            <TextField form={form} name="slug" label="Web address" optional maxLength={60}
              hint={`Page: /departments/${slugPreview || '…'}${isNew ? ' (made from the name if left empty)' : ''}`} />
            <div className="span-2">
              <TextField form={form} name="shortDescription" label="Short description" maxLength={160} required
                hint="One line shown on the department card" />
            </div>
            <div className="span-2">
              <TextAreaField form={form} name="description" label="About the department" rows={5} maxLength={2000} required
                hint="Describe what the department does. Avoid promising outcomes." />
            </div>
            <div className="span-2">
              <TextAreaField form={form} name="commonConcerns" label="Common reasons to visit" optional rows={4} maxLength={1500}
                hint="One per line, up to 12" />
            </div>
            <SelectField form={form} name="icon" label="Icon" options={ICON_OPTIONS} required />
            <TextField form={form} name="sortOrder" label="Display order" inputMode="numeric" maxLength={3} optional hint="Lower numbers are shown first" />
            <div className="span-2">
              <TextField form={form} name="imageUrl" label="Image address" optional maxLength={300} placeholder="https://"
                hint="Optional photo for the page header (must start with https://)" />
            </div>
          </div>
        </fieldset>
        <fieldset className="form-section">
          <legend><h3>Contact and opening information</h3></legend>
          <p className="muted small">Leave a field empty until the hospital has confirmed it. Empty fields are not shown to patients.</p>
          <div className="form-grid">
            <TextField form={form} name="phone" label="Phone" type="tel" optional maxLength={20} />
            <TextField form={form} name="email" label="Email" type="email" optional maxLength={100} />
            <TextField form={form} name="location" label="Location in the hospital" optional maxLength={120} placeholder="e.g. Block B, 2nd floor" />
            <TextField form={form} name="operatingHours" label="Operating hours" optional maxLength={200} placeholder="e.g. Mon–Sat, 9:00 AM – 5:00 PM" />
            <div className="span-2">
              <TextAreaField form={form} name="instructions" label="Instructions for patients" optional rows={2} maxLength={500}
                placeholder="e.g. Please bring your previous reports" />
            </div>
          </div>
        </fieldset>
        <div style={{ marginTop: 20 }}>
          <Checkbox form={form} name="isActive" label="Show this department to patients"
            hint="When off, its page is hidden and its doctors cannot be booked." />
        </div>
        <div className="form-actions">
          <Link to="/admin" className="btn btn-secondary">Cancel</Link>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
            {busy ? 'Saving…' : isNew ? 'Create department' : 'Save changes'}
          </button>
        </div>
      </div>
    </form>
  );
}

const serviceRules = {
  name: value => v.checkText(value, 'Service name', { min: 2, max: 100 }),
  description: value => v.checkText(value, 'Description', { required: false, max: 300 }),
  sortOrder: value => v.checkWholeNumber(value, 'Display order', { max: 999 }),
};

function ServiceDialog({ departmentId, service, onClose, onSaved }) {
  const form = useValidatedForm({
    name: service ? service.name : '',
    description: (service && service.description) || '',
    sortOrder: service ? String(service.sortOrder) : '0',
    isActive: service ? service.isActive : true,
  }, serviceRules);
  const { busy, error, save } = useSave(form);
  const submit = save(
    () => (service
      ? api(`/admin/services/${service.id}`, { method: 'PUT', body: form.values })
      : api(`/admin/departments/${departmentId}/services`, { method: 'POST', body: form.values })),
    onSaved,
  );
  return (
    <Modal title={service ? 'Edit service' : 'Add a service'} onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="service-form" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save service'}</button>
      </>}>
      <form id="service-form" onSubmit={submit} noValidate className="stack" style={{ gap: 14 }}>
        <FormAlert message={error} />
        <TextField form={form} name="name" label="Service name" maxLength={100} required />
        <TextAreaField form={form} name="description" label="Description" optional rows={3} maxLength={300} />
        <TextField form={form} name="sortOrder" label="Display order" inputMode="numeric" maxLength={3} optional />
        <Checkbox form={form} name="isActive" label="Offered now (shown to patients)" />
      </form>
    </Modal>
  );
}

function ServicesCard({ department, onChanged }) {
  const notify = useToast();
  const [editing, setEditing] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  const remove = () => {
    setBusy(true);
    api(`/admin/services/${toDelete.id}`, { method: 'DELETE' })
      .then(() => { notify('Service deleted.'); setToDelete(null); onChanged(); })
      .catch(err => notify(err.message, 'error'))
      .finally(() => setBusy(false));
  };
  return (
    <div className="card">
      <div className="card-header">
        <h2>Services</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing('new')}><Icon name="plus" size={14} /> Add service</button>
      </div>
      {department.services.length === 0 ? (
        <EmptyState icon="clipboard" title="No services yet">Add the consultations this department offers.</EmptyState>
      ) : (
        <ul className="list">
          {department.services.map(s => (
            <li key={s.id} className="list-item" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{s.name}</strong> <Status active={s.isActive} />
                {s.description && <div className="muted small">{s.description}</div>}
              </div>
              <div className="actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}>Edit</button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => setToDelete(s)} aria-label={`Delete ${s.name}`}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <ServiceDialog departmentId={department.id} service={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { notify('Service saved.'); setEditing(null); onChanged(); }} />
      )}
      {toDelete && (
        <ConfirmDialog title="Delete this service?" danger busy={busy} confirmLabel="Delete service"
          message={`“${toDelete.name}” will no longer be listed. To hide it for now instead, edit it and untick “Offered now”.`}
          onConfirm={remove} onClose={() => setToDelete(null)} />
      )}
    </div>
  );
}

export function AdminDepartmentEdit() {
  const { id } = useParams();
  const isNew = id === 'new';
  const history = useHistory();
  const notify = useToast();
  const { data, loading, error, status, reload } = useApi(isNew ? null : `/admin/departments/${id}`);
  usePageTitle(isNew ? 'New department' : 'Edit department');
  const crumbs = <><Link to="/admin">Departments</Link><Icon name="chevron-right" size={14} /> {isNew ? 'New' : 'Edit'}</>;

  if (isNew) {
    return (
      <>
        <PageHead crumbs={crumbs} title="Add a department" subtitle="After creating it, add its services and assign doctors." />
        <DepartmentForm onSaved={res => { notify('Department created.'); history.push(`/admin/departments/${res.id}`); }} />
      </>
    );
  }
  if (loading && !data) return <Spinner />;
  if (status === 404) return <EmptyState icon="cross" title="Department not found" action={<Link to="/admin" className="btn btn-primary">Back to departments</Link>} />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const d = data.data;
  return (
    <>
      <PageHead crumbs={crumbs} title={d.name}
        subtitle={d.isActive ? 'Shown on the public website.' : 'Hidden from patients.'}
        actions={d.isActive && <Link to={`/departments/${d.slug}`} className="btn btn-secondary">View public page</Link>} />
      <div className="dash-grid">
        <DepartmentForm key={d.updatedAt} department={d} onSaved={() => { notify('Department saved.'); reload(); }} />
        <div className="stack">
          <ServicesCard department={d} onChanged={reload} />
          <div className="card">
            <div className="card-header"><h2>Doctors</h2><Link to="/admin/doctors" className="btn btn-ghost btn-sm">Manage doctors</Link></div>
            {d.doctors.length ? (
              <ul className="list">
                {d.doctors.map(doc => (
                  <li key={doc.id} className="list-item"><span style={{ flex: 1 }}>{doc.name}</span><Status active={doc.isActive} /></li>
                ))}
              </ul>
            ) : <EmptyState icon="stethoscope" title="No doctors assigned">Assign doctors on the Doctors page.</EmptyState>}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------- Doctors ----------

const doctorRules = departments => ({
  specialization: value => v.checkChoice(value, departments, 'department'),
  qualifications: value => v.checkText(value, 'Qualifications', { required: false, max: 200 }),
  experienceYears: value => v.checkWholeNumber(value, 'Years of experience', { max: 70 }),
  consultationFee: v.checkFee,
  languages: value => v.checkText(value, 'Languages', { required: false, max: 200 }),
  bio: value => v.checkText(value, 'Profile', { required: false, max: 500 }),
  photoUrl: v.checkImageUrl,
});

function DoctorDialog({ doctor, departments, schedules, onClose, onSaved }) {
  const rules = useMemo(() => doctorRules(departments.map(d => d.name)), [departments]);
  const blank = value => (value === null || value === undefined ? '' : String(value));
  const form = useValidatedForm({
    specialization: doctor.specialization,
    schedule: blank(doctor.schedule),
    qualifications: blank(doctor.qualifications),
    experienceYears: blank(doctor.experienceYears),
    consultationFee: blank(doctor.consultationFee),
    languages: blank(doctor.languages),
    bio: blank(doctor.bio),
    photoUrl: blank(doctor.photoUrl),
    isActive: doctor.isActive,
    isDemo: doctor.isDemo,
  }, rules);
  const { busy, error, save } = useSave(form);
  const submit = save(() => api(`/admin/doctors/${doctor.id}`, { method: 'PUT', body: form.values }), onSaved);
  return (
    <Modal title={`Edit ${doctor.name}`} onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="doctor-form" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save doctor'}</button>
      </>}>
      <form id="doctor-form" onSubmit={submit} noValidate className="form-grid">
        <div className="span-2"><FormAlert message={error} /></div>
        <SelectField form={form} name="specialization" label="Department" required
          options={departments.map(d => [d.name, d.isActive ? d.name : `${d.name} (hidden)`])} />
        <SelectField form={form} name="schedule" label="Working hours" placeholder="No schedule"
          options={schedules.map(s => [String(s.id), `${formatTimeRange(s.startTime, s.endTime)} · ${s.days.map(shortDay).join(', ')}`])} />
        <div className="span-2">
          <TextField form={form} name="qualifications" label="Qualifications" optional maxLength={200}
            hint="Only enter qualifications the hospital has verified" />
        </div>
        <TextField form={form} name="experienceYears" label="Years of experience" inputMode="numeric" maxLength={2} optional />
        <TextField form={form} name="consultationFee" label="Consultation fee (₹)" inputMode="decimal" maxLength={9} optional />
        <div className="span-2"><TextField form={form} name="languages" label="Languages spoken" optional maxLength={200} placeholder="e.g. English, Hindi, Kannada" /></div>
        <div className="span-2"><TextAreaField form={form} name="bio" label="Profile" optional rows={3} maxLength={500} /></div>
        <div className="span-2"><TextField form={form} name="photoUrl" label="Photo address" optional maxLength={300} placeholder="https://" /></div>
        <div className="span-2 stack" style={{ gap: 10 }}>
          <Checkbox form={form} name="isActive" label="Taking new appointments" hint="Existing appointments are kept either way." />
          <Checkbox form={form} name="isDemo" label="Demo profile" hint="Labels the doctor as a fictional sample on the website." />
        </div>
      </form>
    </Modal>
  );
}

export function AdminDoctors() {
  usePageTitle('Doctors');
  const notify = useToast();
  const doctorsRes = useApi('/admin/doctors');
  const departmentsRes = useApi('/admin/departments');
  const schedulesRes = useApi('/public/schedules');
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('');
  const [editing, setEditing] = useState(null);

  if ((doctorsRes.loading && !doctorsRes.data) || (departmentsRes.loading && !departmentsRes.data)) return <Spinner />;
  const loadError = doctorsRes.error || departmentsRes.error || schedulesRes.error;
  if (loadError) return <ErrorBox message={loadError} onRetry={() => { doctorsRes.reload(); departmentsRes.reload(); schedulesRes.reload(); }} />;
  const q = query.trim().toLowerCase();
  const list = doctorsRes.data.data.filter(d => (!department || d.specialization === department)
    && (!q || d.name.toLowerCase().includes(q) || d.email.includes(q)));
  const departments = departmentsRes.data.data;

  return (
    <>
      <PageHead title="Doctors" subtitle="Assign doctors to departments, update their public profiles and working hours." />
      <div className="card">
        <div className="toolbar">
          <select className="select" style={{ maxWidth: 240 }} value={department} onChange={e => setDepartment(e.target.value)} aria-label="Filter by department">
            <option value="">All departments</option>
            {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
          <div className="input-icon">
            <Icon name="search" size={16} />
            <input className="input" type="search" placeholder="Search name or email" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search doctors" />
          </div>
        </div>
        {list.length === 0 ? <EmptyState icon="stethoscope" title="No doctors match">Try another department or search.</EmptyState> : (
          <Paginated items={list} resetKey={`${department}:${q}`} label="doctors">
            {pageItems => (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Doctor</th><th>Department</th><th>Fee</th><th>Upcoming</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
                  </thead>
                  <tbody>
                    {pageItems.map(d => (
                      <tr key={d.id}>
                        <td><div><strong>{d.name}</strong>{d.isDemo && <span className="badge badge-amber" style={{ marginLeft: 6 }}>Demo</span>}</div><span className="muted small">{d.email}</span></td>
                        <td>{d.specialization}</td>
                        <td>{d.consultationFee !== null ? formatFee(d.consultationFee) : <span className="muted">Not set</span>}</td>
                        <td>{d.upcomingAppointments}</td>
                        <td><span className={`badge ${d.isActive ? 'badge-green' : 'badge-gray'}`}>{d.isActive ? 'Taking bookings' : 'Not taking bookings'}</span></td>
                        <td><button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing(d)} aria-label={`Edit ${d.name}`}>Edit</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Paginated>
        )}
      </div>
      {editing && (
        <DoctorDialog doctor={editing} departments={departments} schedules={schedulesRes.data ? schedulesRes.data.data : []}
          onClose={() => setEditing(null)}
          onSaved={() => { notify(`${editing.name} saved.`); setEditing(null); doctorsRes.reload(); }} />
      )}
    </>
  );
}
