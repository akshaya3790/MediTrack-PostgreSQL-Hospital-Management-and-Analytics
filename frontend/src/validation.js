// Field validation rules shared by the backend and the frontend.
// The frontend keeps an identical copy at frontend/src/validation.js (a backend test
// checks the two stay the same), so the browser shows the exact messages the API enforces.
//
// Each check takes a raw value and returns an error message, or null when the value is valid.
// Each normalize function returns the cleaned value that should be stored.

const GENDERS = ['female', 'male', 'other'];

// The ten starting departments. The live list is the Department table, which an
// administrator can extend; this list is only the default set.
const SPECIALIZATIONS = [
  'General Medicine', 'Cardiology', 'Pediatrics', 'Orthopedics', 'Dermatology',
  'Neurology', 'Gynecology', 'ENT', 'Ophthalmology', 'Psychiatry',
];

// Icons a department can use (names from frontend/src/components/Icon.js)
const DEPARTMENT_ICONS = [
  'activity', 'heart', 'smile', 'move', 'sun', 'zap', 'users', 'volume', 'eye', 'message',
  'stethoscope', 'pill', 'cross', 'clipboard', 'shield',
];

const PASSWORD_RULES = [
  ['length', 'At least 8 characters'],
  ['lower', 'A lowercase letter'],
  ['upper', 'An uppercase letter'],
  ['digit', 'A number'],
];

// Days ahead that a patient may book
const MAX_BOOKING_DAYS = 90;

const str = value => (typeof value === 'string' ? value : '');

// Trims, joins runs of spaces and uses one Unicode form, so "José" typed two ways matches
const cleanText = value => str(value).normalize('NFC').trim().replace(/\s+/g, ' ');

// ---------- Names ----------

// Letters from any script (with their accents), separated by single spaces, hyphens,
// apostrophes or full stops: "Anne-Marie", "O'Brien", "Dr. Anita Desai", "José", "अक्षया"
const NAME_PATTERN = /^\p{L}[\p{L}\p{M}]*(?:(?:[ '’-]|\. ?)[\p{L}\p{M}]+)*\.?$/u;

function checkName(value, label = 'Name', { min = 1, max = 50 } = {}) {
  const name = cleanText(value);
  if (!name) return `${label} is required`;
  if (/\p{N}/u.test(name)) return `${label} cannot contain numbers`;
  if (!NAME_PATTERN.test(name)) {
    return `${label} can only contain letters, spaces, hyphens, apostrophes and full stops`;
  }
  if ([...name].length < min) return `${label} must be at least ${min} characters`;
  if ([...name].length > max) return `${label} must be at most ${max} characters`;
  return null;
}

const normalizeName = cleanText;

// ---------- Email ----------

const EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

const normalizeEmail = value => str(value).trim().toLowerCase();

function checkEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return 'Email address is required';
  if (email.length > 100) return 'Email address must be at most 100 characters';
  const local = email.split('@')[0];
  if (!EMAIL_PATTERN.test(email) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return 'Enter a valid email address, like name@example.com';
  }
  return null;
}

// ---------- Phone (Indian mobile numbers) ----------

// Accepts "98765 43210", "098765-43210", "+91 98765 43210" or "919876543210"
// and stores "+919876543210"
function phoneDigits(value) {
  let digits = str(value).replace(/[\s\-()]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

function checkPhone(value, { required = false } = {}) {
  const raw = str(value).trim();
  if (!raw) return required ? 'Mobile number is required' : null;
  if (!/^[0-9+\-\s()]+$/.test(raw)) return 'Mobile number can only contain digits';
  const digits = phoneDigits(raw);
  if (!/^\d+$/.test(digits)) return 'Use the format +91 followed by 10 digits';
  if (digits.length !== 10) return 'Enter a 10-digit Indian mobile number';
  if (!/^[6-9]/.test(digits)) return 'Indian mobile numbers start with 6, 7, 8 or 9';
  return null;
}

const normalizePhone = value => (str(value).trim() ? `+91${phoneDigits(value)}` : null);

// ---------- Password ----------

function passwordChecks(value) {
  const password = str(value);
  return {
    length: password.length >= 8,
    lower: /\p{Ll}/u.test(password),
    upper: /\p{Lu}/u.test(password),
    digit: /\p{N}/u.test(password),
  };
}

// UTF-8 length; bcrypt only uses the first 72 bytes of a password
const byteLength = text => unescape(encodeURIComponent(text)).length;

function checkPassword(value) {
  const password = str(value);
  if (!password) return 'Password is required';
  if (!password.trim()) return 'Password cannot be only spaces';
  if (byteLength(password) > 72) return 'Password must be at most 72 characters';
  const checks = passwordChecks(password);
  const missing = PASSWORD_RULES.filter(([key]) => !checks[key]).map(([, text]) => text.toLowerCase());
  if (missing.length) return `Password needs ${missing.join(', ')}`;
  return null;
}

function checkPasswordConfirmation(password, confirmation) {
  if (!str(confirmation)) return 'Please confirm your password';
  if (password !== confirmation) return 'Passwords do not match';
  return null;
}

// ---------- Dates and times ----------

function localDateString(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(dateString, days) {
  const [y, m, d] = dateString.split('-').map(Number);
  return localDateString(new Date(y, m - 1, d + days));
}

// A real calendar date in YYYY-MM-DD form (rejects 2024-02-30)
function isCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(value));
  if (!match) return false;
  const [y, m, d] = match.slice(1).map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function checkDateOfBirth(value, { required = false, today = localDateString(new Date()) } = {}) {
  const dob = str(value).trim();
  if (!dob) return required ? 'Date of birth is required' : null;
  if (!isCalendarDate(dob)) return 'Enter a valid date';
  if (dob > today) return 'Date of birth cannot be in the future';
  if (dob < addDays(today, -365 * 120 - 30)) return 'Enter a date of birth within the last 120 years';
  return null;
}

function checkAppointmentDate(value, { today = localDateString(new Date()) } = {}) {
  const date = str(value).trim();
  if (!date) return 'Please choose a date';
  if (!isCalendarDate(date)) return 'Enter a valid date';
  if (date < today) return 'You cannot book an appointment in the past';
  if (date > addDays(today, MAX_BOOKING_DAYS)) return `Appointments can be booked up to ${MAX_BOOKING_DAYS} days ahead`;
  return null;
}

function checkTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(str(value).trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return 'Choose a valid time';
  return null;
}

// ---------- Address and free text ----------

function checkAddress(value, { required = true } = {}) {
  const address = cleanText(value);
  if (!address) return required ? 'Address is required' : null;
  if (address.length < 3) return 'Address must be at least 3 characters';
  if (address.length > 200) return 'Address must be at most 200 characters';
  if (!/\p{L}/u.test(address)) return 'Address must contain letters';
  if (!/^[\p{L}\p{M}\p{N} .,'’#/()&:;-]+$/u.test(address)) {
    return 'Address can contain letters, numbers, spaces and , . - / # ( ) &';
  }
  return null;
}

// Free text such as symptoms or a prescription: no control characters, sensible length
function checkText(value, label, { required = true, min = 1, max = 255 } = {}) {
  const text = str(value).normalize('NFC').trim();
  if (!text) return required ? `${label} is required` : null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) return `${label} contains characters that are not allowed`;
  if (text.length < min) return `${label} must be at least ${min} characters`;
  if (text.length > max) return `${label} must be at most ${max} characters`;
  return null;
}

const normalizeText = value => str(value).normalize('NFC').trim();

// ---------- Choices ----------

// noun is what is being chosen, such as "gender" or "department"
function checkChoice(value, choices, noun) {
  if (!str(value)) return `Please select a ${noun}`;
  if (!choices.includes(value)) return `Please select a valid ${noun}`;
  return null;
}

// ---------- Department and doctor profile fields ----------

// "Ear, Nose & Throat" -> "ear-nose-throat"
const slugify = value => cleanText(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

function checkSlug(value) {
  const slug = str(value).trim();
  if (!slug) return 'Web address is required';
  if (slug.length > 60) return 'Web address must be at most 60 characters';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return 'Use lowercase letters, numbers and single hyphens, like "general-medicine"';
  return null;
}

function checkDepartmentName(value) {
  const name = cleanText(value);
  if (!name) return 'Department name is required';
  if (name.length < 2 || name.length > 50) return 'Department name must be 2–50 characters';
  if (!/^[\p{L}\p{M}][\p{L}\p{M} &'’,()-]*$/u.test(name)) return 'Department name can only contain letters, spaces and & \' , ( ) -';
  return null;
}

// Landline or mobile number for a hospital department, written as it should be shown
function checkContactPhone(value) {
  const phone = cleanText(value);
  if (!phone) return null;
  if (/[a-z]/i.test(phone)) return 'Phone number cannot contain letters';
  if (!/^\+?[0-9][0-9 ()-]{5,18}$/.test(phone)) return 'Enter a phone number of 6–20 digits, spaces or dashes';
  return null;
}

function checkOptionalEmail(value) {
  return cleanText(value) ? checkEmail(value) : null;
}

// Pictures must come from a secure (https) address
function checkImageUrl(value) {
  const url = str(value).trim();
  if (!url) return null;
  if (url.length > 300) return 'Image address must be at most 300 characters';
  if (!/^https:\/\/[^\s"'<>]+$/.test(url)) return 'Use a full https:// image address';
  return null;
}

// Whole number between min and max; empty is allowed unless required
function checkWholeNumber(value, label, { min = 0, max, required = false } = {}) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (!text) return required ? `${label} is required` : null;
  if (!/^\d+$/.test(text)) return `${label} must be a whole number`;
  const n = Number(text);
  if (n < min || n > max) return `${label} must be between ${min} and ${max}`;
  return null;
}

function checkFee(value) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (!text) return null;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return 'Fee must be an amount in rupees, like 500 or 750.50';
  if (Number(text) > 100000) return 'Fee must be at most ₹1,00,000';
  return null;
}

// One item per line, as typed in a textarea; empty lines are dropped
const splitLines = value => (Array.isArray(value) ? value : str(value).split('\n'))
  .map(item => cleanText(item)).filter(Boolean);

function checkLines(value, label, { maxItems = 12, maxLength = 120 } = {}) {
  const items = splitLines(value);
  if (items.length > maxItems) return `${label}: at most ${maxItems} lines`;
  if (items.some(item => item.length > maxLength)) return `${label}: each line must be at most ${maxLength} characters`;
  return null;
}

module.exports = {
  GENDERS,
  SPECIALIZATIONS,
  DEPARTMENT_ICONS,
  PASSWORD_RULES,
  MAX_BOOKING_DAYS,
  checkName,
  normalizeName,
  checkEmail,
  normalizeEmail,
  checkPhone,
  normalizePhone,
  passwordChecks,
  checkPassword,
  checkPasswordConfirmation,
  isCalendarDate,
  checkDateOfBirth,
  checkAppointmentDate,
  checkTime,
  checkAddress,
  normalizeAddress: cleanText,
  checkText,
  normalizeText,
  checkChoice,
  slugify,
  checkSlug,
  checkDepartmentName,
  checkContactPhone,
  checkOptionalEmail,
  checkImageUrl,
  checkWholeNumber,
  checkFee,
  splitLines,
  checkLines,
  cleanText,
  localDateString,
  addDays,
};
