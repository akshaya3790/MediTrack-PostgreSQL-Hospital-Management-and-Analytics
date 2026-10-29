import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { api } from '../api';
import { appointmentState, initials } from '../format';

// ---------- Toast notifications ----------

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback(id => setToasts(list => list.filter(t => t.id !== id)), []);

  const notify = useCallback((message, type = 'success') => {
    const id = nextId.current++;
    setToasts(list => [...list, { id, message, type }]);
    setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <Icon name={t.type === 'error' ? 'alert' : 'check-circle'} size={20} />
            <p>{t.message}</p>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <Icon name="x" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------- Dialogs ----------

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-header">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger, busy, onConfirm, onClose }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Keep it</button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Please wait…' : confirmLabel}
          </button>
        </>
      )}
    >
      <p className="muted">{message}</p>
    </Modal>
  );
}

// ---------- Small building blocks ----------

export const Spinner = ({ full }) => (
  <div className={`loading ${full ? 'full' : ''}`}><div className="spinner" aria-label="Loading" /></div>
);

export function EmptyState({ icon = 'calendar', title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={26} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export const ErrorBox = ({ message, onRetry }) => (
  <div className="alert alert-error" role="alert">
    <Icon name="alert" /><span>{message}</span>
    {onRetry && <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={onRetry}>Try again</button>}
  </div>
);

export const Avatar = ({ name, size, soft }) => (
  <span className={`avatar ${size === 'lg' ? 'avatar-lg' : ''} ${soft ? 'avatar-soft' : ''}`}>{initials(name)}</span>
);

const stateBadges = {
  upcoming: ['badge-brand', 'Upcoming'],
  completed: ['badge-green', 'Completed'],
  missed: ['badge-gray', 'Missed'],
};

export function StatusBadge({ appt }) {
  const [cls, label] = stateBadges[appointmentState(appt)];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function PageHead({ title, subtitle, actions, crumbs }) {
  return (
    <div className="page-head">
      <div>
        {crumbs && <div className="breadcrumb">{crumbs}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · HMS Hospital` : 'HMS Hospital';
  }, [title]);
}

// Loads data from the API: returns { data, error, loading, reload }
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, status: 0, loading: true });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    if (!path) return undefined;
    setState(s => ({ ...s, loading: true }));
    api(path)
      .then(res => active && setState({ data: res, error: null, status: 200, loading: false }))
      .catch(err => active && setState({ data: null, error: err.message, status: err.status, loading: false }));
    return () => { active = false; };
  }, [path, version]);

  const reload = useCallback(() => setVersion(v => v + 1), []);
  return { ...state, reload };
}

// Builds a controlled-form helper: values, set(field) change handler and setValues
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const set = field => e => {
    const value = e && e.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setValues(v => ({ ...v, [field]: value }));
  };
  return { values, set, setValues };
}

// ---------- Pagination ----------

// Shows `size` items per page. children is a function that renders the current page;
// the page goes back to 1 when resetKey changes (for example a new tab or search).
export function Paginated({ items, size = 10, resetKey, label = 'items', children }) {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [resetKey]);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(page, pages);
  const start = (current - 1) * size;
  return (
    <>
      {children(items.slice(start, start + size))}
      {items.length > size && (
        <nav className="pagination" aria-label={`${label} pages`}>
          <span aria-live="polite">Showing {start + 1}–{Math.min(start + size, items.length)} of {items.length} {label}</span>
          <div className="row">
            <button type="button" className="btn btn-secondary btn-sm" disabled={current === 1}
              onClick={() => setPage(current - 1)} aria-label="Previous page">
              <Icon name="chevron-left" size={16} /> Previous
            </button>
            <span>Page {current} of {pages}</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={current === pages}
              onClick={() => setPage(current + 1)} aria-label="Next page">
              Next <Icon name="chevron-right" size={16} />
            </button>
          </div>
        </nav>
      )}
    </>
  );
}
