import React, { useCallback, useRef, useState } from 'react';
import Icon from './Icon';
import v from '../validation';

// Form state with field-level validation.
// A field is checked when it loses focus and again on submit; once it has shown an
// error it is re-checked on every keystroke, so the message clears as soon as the
// value is fixed. Valid values are never cleared when another field fails.
export function useValidatedForm(initial, validators = {}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const touched = useRef({});

  const check = useCallback((field, all) => {
    const rule = validators[field];
    return rule ? rule(all[field], all) : null;
  }, [validators]);

  const setValue = useCallback((field, value) => {
    setValues(prev => {
      const next = { ...prev, [field]: value };
      setErrors(prevErrors => {
        const nextErrors = { ...prevErrors };
        // Re-check this field and any already-touched field whose rule reads it (e.g. confirm password)
        Object.keys(validators).forEach(name => {
          if (name === field ? (touched.current[name] || prevErrors[name]) : touched.current[name] && prevErrors[name] !== undefined) {
            nextErrors[name] = check(name, next);
          }
        });
        return nextErrors;
      });
      return next;
    });
  }, [check, validators]);

  const blur = field => {
    touched.current[field] = true;
    setErrors(prev => ({ ...prev, [field]: check(field, values) }));
  };

  // Props for an input, select or textarea
  const bind = (field, { type } = {}) => ({
    id: field,
    name: field,
    value: type === 'checkbox' ? undefined : values[field],
    checked: type === 'checkbox' ? Boolean(values[field]) : undefined,
    onChange: e => setValue(field, type === 'checkbox' ? e.target.checked : e.target.value),
    onBlur: () => blur(field),
    'aria-invalid': errors[field] ? 'true' : 'false',
    'aria-describedby': errors[field] ? `${field}-error` : `${field}-hint`,
  });

  // Validates everything; returns true when the form can be sent, otherwise
  // shows every error and moves focus to the first invalid field
  const validateAll = () => {
    const next = {};
    Object.keys(validators).forEach(field => {
      touched.current[field] = true;
      const message = check(field, values);
      if (message) next[field] = message;
    });
    setErrors(next);
    const first = Object.keys(validators).find(field => next[field]);
    if (first) {
      const el = document.getElementById(first);
      if (el) el.focus();
      return false;
    }
    return true;
  };

  // Shows field messages returned by the server
  const setServerErrors = fields => {
    if (!fields) return;
    Object.keys(fields).forEach(field => { touched.current[field] = true; });
    setErrors(prev => ({ ...prev, ...fields }));
    const first = Object.keys(fields)[0];
    const el = first && document.getElementById(first);
    if (el) el.focus();
  };

  return { values, errors, setValue, setValues, bind, validateAll, setServerErrors };
}

// Label, control, hint and error message for one field
export function Field({ id, label, required, optional, hint, error, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>
        {label}
        {required && <span className="req" aria-hidden="true">*</span>}
        {required && <span className="sr-only"> (required)</span>}
        {optional && <span className="opt">(optional)</span>}
      </label>
      {children}
      {error ? (
        <span className="error-text" id={`${id}-error`} role="alert">
          <Icon name="alert" size={14} /> {error}
        </span>
      ) : hint && <span className="hint" id={`${id}-hint`}>{hint}</span>}
    </div>
  );
}

const cls = (base, error) => `${base} ${error ? 'invalid' : ''}`;

export function TextField({ form, name, label, required, optional, hint, className, ...inputProps }) {
  return (
    <Field id={name} label={label} required={required} optional={optional} hint={hint} error={form.errors[name]} className={className}>
      <input className={cls('input', form.errors[name])} required={required} {...form.bind(name)} {...inputProps} />
    </Field>
  );
}

export function SelectField({ form, name, label, required, hint, options, placeholder = 'Select…', className }) {
  return (
    <Field id={name} label={label} required={required} hint={hint} error={form.errors[name]} className={className}>
      <select className={cls('select', form.errors[name])} required={required} {...form.bind(name)}>
        <option value="">{placeholder}</option>
        {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
    </Field>
  );
}

export function TextAreaField({ form, name, label, required, optional, hint, maxLength = 255, ...rest }) {
  const value = form.values[name] || '';
  return (
    <Field id={name} label={label} required={required} optional={optional} error={form.errors[name]}
      hint={`${hint ? `${hint} · ` : ''}${value.length}/${maxLength}`}>
      <textarea className={cls('textarea', form.errors[name])} maxLength={maxLength} required={required} {...form.bind(name)} {...rest} />
    </Field>
  );
}

export function PasswordField({ form, name, label, required = true, hint, autoComplete = 'current-password', showRules }) {
  const [visible, setVisible] = useState(false);
  const checks = v.passwordChecks(form.values[name] || '');
  return (
    <Field id={name} label={label} required={required} hint={hint} error={form.errors[name]}>
      <div className="input-group">
        <input
          className={cls('input', form.errors[name])}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required={required}
          {...form.bind(name)}
        />
        <button
          type="button"
          className="icon-btn"
          onClick={() => setVisible(s => !s)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          aria-controls={name}
        >
          <Icon name={visible ? 'eye-off' : 'eye'} size={17} />
        </button>
      </div>
      {showRules && (
        <ul className="password-rules" aria-label="Password requirements">
          {v.PASSWORD_RULES.map(([key, text]) => (
            <li key={key} className={checks[key] ? 'met' : ''}>
              <Icon name={checks[key] ? 'check-circle' : 'alert'} size={13} />
              {text}<span className="sr-only">{checks[key] ? ' (met)' : ' (not met yet)'}</span>
            </li>
          ))}
        </ul>
      )}
    </Field>
  );
}

// Indian mobile number with a fixed +91 prefix. Pasted numbers like
// "+91 98765-43210" are cleaned to their 10 digits.
export function PhoneField({ form, name = 'phone', label = 'Mobile number', required, optional }) {
  const bound = form.bind(name);
  const display = (form.values[name] || '').replace(/^\+91/, '');
  const clean = text => {
    const stripped = text.replace(/[\s\-()]/g, '');
    if (/^\+?91\d{10}$/.test(stripped)) return stripped.slice(-10);
    if (/^0\d{10}$/.test(stripped)) return stripped.slice(1);
    return text;
  };
  return (
    <Field id={name} label={label} required={required} optional={optional} error={form.errors[name]}
      hint="10-digit Indian mobile number">
      <div className="phone-input">
        <span className="prefix" aria-hidden="true">+91</span>
        <input
          {...bound}
          value={display}
          className={cls('input', form.errors[name])}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="98765 43210"
          maxLength={14}
          required={required}
          onChange={e => form.setValue(name, clean(e.target.value))}
        />
      </div>
    </Field>
  );
}

// Banner for errors that do not belong to one field (network, wrong password, …)
export const FormAlert = ({ message, type = 'error' }) => (message ? (
  <div className={`alert alert-${type}`} role={type === 'error' ? 'alert' : 'status'}>
    <Icon name={type === 'error' ? 'alert' : 'check-circle'} />
    <span>{message}</span>
  </div>
) : null);
