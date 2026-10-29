import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { PasswordField, PhoneField, TextField, useValidatedForm } from '../components/Form';
import { ToastProvider } from '../components/ui';
import { AuthProvider } from '../auth';
import { Login, RegisterPatient } from '../pages/Auth';
import v from '../validation';

let container;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  // The pages ask the server who is signed in; answer "nobody"
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ email: '', who: '', name: '' }) }));
});
afterEach(() => {
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
});

const $ = selector => container.querySelector(selector);
const type = (selector, value) => {
  const input = $(selector);
  input.value = value;
  Simulate.change(input);
};

function Demo() {
  const form = useValidatedForm({ name: '', phone: '', password: '' }, {
    name: value => v.checkName(value, 'First name'),
    phone: value => v.checkPhone(value, { required: true }),
    password: v.checkPassword,
  });
  return (
    <form onSubmit={e => { e.preventDefault(); form.validateAll(); }} noValidate>
      <TextField form={form} name="name" label="First name" required />
      <PhoneField form={form} required />
      <PasswordField form={form} name="password" label="Password" showRules />
      <button type="submit">Send</button>
    </form>
  );
}

const renderDemo = () => act(() => { ReactDOM.render(<Demo />, container); });

test('an error appears after leaving a field, is linked for screen readers, and clears once fixed', () => {
  renderDemo();
  type('#name', 'R4mesh');
  expect($('#name-error')).toBeNull(); // not while the user is still typing the first time
  Simulate.blur($('#name'));
  expect($('#name-error').textContent).toMatch(/cannot contain numbers/);
  expect($('#name').getAttribute('aria-invalid')).toBe('true');
  expect($('#name').getAttribute('aria-describedby')).toBe('name-error');
  type('#name', 'Ramesh');
  expect($('#name-error')).toBeNull();
  expect($('#name').value).toBe('Ramesh');
});

test('submitting shows every error, keeps valid values and focuses the first invalid field', () => {
  renderDemo();
  type('#phone', '9876543210');
  Simulate.submit($('form'));
  expect($('#name-error')).not.toBeNull();
  expect($('#password-error')).not.toBeNull();
  expect($('#phone-error')).toBeNull();
  expect($('#phone').value).toBe('9876543210');
  expect(document.activeElement).toBe($('#name'));
});

test('required fields are marked visually and for screen readers', () => {
  renderDemo();
  const label = $('label[for="name"]');
  expect(label.querySelector('.req').getAttribute('aria-hidden')).toBe('true');
  expect(label.textContent).toMatch(/\(required\)/);
});

test('phone field cleans pasted numbers with +91 or spaces, and flags letters', () => {
  renderDemo();
  type('#phone', '+91 98765-43210');
  expect($('#phone').value).toBe('9876543210');
  type('#phone', '98abc');
  Simulate.blur($('#phone'));
  expect($('#phone-error').textContent).toMatch(/only contain digits/);
});

test('password visibility toggle switches the input type and its accessible name', () => {
  renderDemo();
  const toggle = $('button[aria-controls="password"]');
  expect($('#password').type).toBe('password');
  expect(toggle.getAttribute('aria-label')).toBe('Show password');
  act(() => { Simulate.click(toggle); });
  expect($('#password').type).toBe('text');
  expect(toggle.getAttribute('aria-label')).toBe('Hide password');
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
});

test('password requirement list ticks off rules as they are met', () => {
  renderDemo();
  type('#password', 'abc');
  expect(container.querySelectorAll('.password-rules li.met')).toHaveLength(1);
  type('#password', 'Abcdefg1');
  expect(container.querySelectorAll('.password-rules li.met')).toHaveLength(4);
});

const renderPage = async (Page, path) => {
  await act(async () => {
    ReactDOM.render(
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider><AuthProvider><Page /></AuthProvider></ToastProvider>
      </MemoryRouter>,
      container,
    );
  });
};

test('sign-in page has remember me, a working forgot-password link and a sign-up link', async () => {
  await renderPage(Login, '/login');
  expect($('input#remember[type=checkbox]')).not.toBeNull();
  expect($('a[href="/forgot-password"]')).not.toBeNull();
  expect($('a[href="/register"]').textContent).toMatch(/Create one/);
});

test('sign-in shows the server message for a wrong password and re-enables the button', async () => {
  await renderPage(Login, '/login');
  global.fetch = jest.fn(() => Promise.resolve({
    ok: false, status: 401, json: () => Promise.resolve({ error: 'Incorrect email or password for a patient account.' }),
  }));
  type('#email', 'ramesh@example.com');
  type('#password', 'wrong');
  await act(async () => { Simulate.submit($('form')); });
  expect($('.alert-error').textContent).toMatch(/Incorrect email or password/);
  expect($('button[type=submit]').disabled).toBe(false);
  const body = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(body).toEqual({ email: 'ramesh@example.com', password: 'wrong', remember: false, isDoctor: false });
});

test('sign-in explains a network failure', async () => {
  await renderPage(Login, '/login');
  global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));
  type('#email', 'ramesh@example.com');
  type('#password', 'whatever');
  await act(async () => { Simulate.submit($('form')); });
  expect($('.alert-error').textContent).toMatch(/Cannot reach the server/);
});

test('sign-up does not call the server while fields are invalid', async () => {
  await renderPage(RegisterPatient, '/register');
  const calls = global.fetch.mock.calls.length;
  type('#firstName', 'R4mesh');
  await act(async () => { Simulate.submit($('form')); });
  expect(global.fetch.mock.calls.length).toBe(calls);
  expect($('#firstName-error')).not.toBeNull();
  expect($('#acceptTerms-error')).not.toBeNull();
  expect($('a[href="/login"]').textContent).toBe('Sign in');
});
