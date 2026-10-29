import React from 'react';
import Icon from './Icon';
import { Avatar, EmptyState, ErrorBox, Modal, Spinner, StatusBadge, useApi } from './ui';
import { ageFrom, capitalize, formatDate, formatTimeRange } from '../format';

// Popup with everything about one appointment, including the diagnosis once given
export function AppointmentDetails({ appt, viewer, onClose, footer }) {
  return (
    <Modal title="Appointment details" onClose={onClose} footer={footer}>
      <div className="row" style={{ marginBottom: 18 }}>
        <Avatar name={viewer === 'doc' ? appt.patientName : appt.doctorName} />
        <div style={{ flex: 1 }}>
          <strong>{viewer === 'doc' ? appt.patientName : appt.doctorName}</strong>
          <div className="muted small">{viewer === 'doc' ? appt.patientEmail : appt.specialization}</div>
        </div>
        <StatusBadge appt={appt} />
      </div>
      <dl className="detail-list">
        <dt>Date</dt><dd>{formatDate(appt.date)}</dd>
        <dt>Time</dt><dd>{formatTimeRange(appt.startTime, appt.endTime)}</dd>
        <dt>Reference no.</dt><dd>#{String(appt.id).padStart(5, '0')}</dd>
        <dt>Reason for visit</dt><dd>{appt.concerns}</dd>
        <dt>Symptoms</dt><dd>{appt.symptoms}</dd>
        <dt>Diagnosis</dt><dd>{appt.diagnosis || <span className="muted">Not diagnosed yet</span>}</dd>
        <dt>Prescription</dt><dd>{appt.prescription || <span className="muted">Not prescribed yet</span>}</dd>
      </dl>
    </Modal>
  );
}

// A patient's full record: profile, medical background and every visit
export function MedicalRecord({ email, actions }) {
  const history = useApi(`/patients/${encodeURIComponent(email)}/history`);
  const visits = useApi(`/patients/${encodeURIComponent(email)}/visits`);

  if (history.loading || visits.loading) return <Spinner />;
  if (history.error) return <ErrorBox message={history.error} />;

  const p = history.data.data;
  const list = visits.data ? visits.data.data : [];
  const age = ageFrom(p.dob);
  const diagnosed = list.filter(v => v.diagnosis);

  return (
    <div className="stack">
      <div className="card card-body">
        <div className="row-between">
          <div className="record-header">
            <Avatar name={p.name} size="lg" />
            <div>
              <h2 style={{ fontSize: 22 }}>{p.name}</h2>
              <div className="record-meta">
                <span><Icon name="user" size={15} /> {capitalize(p.gender)}{age !== null && `, ${age} years`}</span>
                <span><Icon name="mail" size={15} /> {p.email}</span>
                {p.phone && <span><Icon name="phone" size={15} /> {p.phone}</span>}
                <span><Icon name="pin" size={15} /> {p.address}</span>
              </div>
            </div>
          </div>
          <div className="row no-print">
            {actions}
            <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
              <Icon name="printer" size={16} /> Print record
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Medical background</h2>
          <span className="muted small">Recorded on {formatDate(p.recordedOn)}</span>
        </div>
        <div className="card-body info-tiles">
          <div className="info-tile"><span>Conditions</span>{p.conditions}</div>
          <div className="info-tile"><span>Past surgeries</span>{p.surgeries}</div>
          <div className="info-tile"><span>Medications</span>{p.medication}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Visit history</h2>
          <span className="muted small">{list.length} visits · {diagnosed.length} with a diagnosis</span>
        </div>
        {list.length === 0 ? (
          <EmptyState icon="clipboard" title="No visits yet">Appointments and diagnoses will appear here.</EmptyState>
        ) : (
          <ul className="timeline">
            {list.map(v => (
              <li key={v.id}>
                <div className="row-between">
                  <div>
                    <strong>{formatDate(v.date)}</strong>
                    <span className="muted small"> · {formatTimeRange(v.startTime, v.endTime)}</span>
                  </div>
                  <StatusBadge appt={v} />
                </div>
                <div className="muted small">{v.doctorName} · {v.specialization}</div>
                <div className="visit-grid">
                  <div><span>Reason</span>{v.concerns}</div>
                  <div><span>Symptoms</span>{v.symptoms}</div>
                  <div><span>Diagnosis</span>{v.diagnosis || <em className="muted">Pending</em>}</div>
                  <div><span>Prescription</span>{v.prescription || <em className="muted">Pending</em>}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
