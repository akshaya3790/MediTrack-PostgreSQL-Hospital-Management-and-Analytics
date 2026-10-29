// Date and time helpers. Dates travel as "YYYY-MM-DD" strings and times as "HH:MM:SS",
// so they are parsed as local dates here and never shifted by a timezone.

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEK_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function parseDate(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toDateString(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export const todayString = () => toDateString(new Date());

// "2024-01-15" -> "Mon, 15 Jan 2024"
export function formatDate(value, options = {}) {
  if (!value) return '—';
  return parseDate(value).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', ...options,
  });
}

export function formatLongDate(date = new Date()) {
  return date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// "14:00:00" -> "2:00 PM"
export function formatTime(value) {
  if (!value) return '—';
  const [h, m] = value.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

// "12:00:00" + 60 -> "13:00:00"
export function addMinutes(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:00`;
}

export const formatTimeRange = (start, end) => `${formatTime(start)} – ${formatTime(end)}`;

export function ageFrom(dob) {
  if (!dob) return null;
  const birth = parseDate(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth()
    || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

// Whole days from today until the date (negative when it has passed)
export function daysUntil(value) {
  const today = parseDate(todayString());
  return Math.round((parseDate(value) - today) / 86400000);
}

export function relativeDay(value) {
  const days = daysUntil(value);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1) return `In ${days} days`;
  if (days === -1) return 'Yesterday';
  return `${-days} days ago`;
}

export function sortDays(days) {
  return [...days].sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b));
}

export const shortDay = day => day.slice(0, 3);

export function initials(name = '') {
  return name
    .replace(/^dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join('');
}

export const capitalize = text => (text ? text[0].toUpperCase() + text.slice(1) : '');

export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// Upcoming, completed or missed, from the stored status and the date
export function appointmentState(appt) {
  if (appt.status === 'Done') return 'completed';
  return appt.date >= todayString() ? 'upcoming' : 'missed';
}
