// Base URL of the backend; set REACT_APP_API_URL in frontend/.env to change it
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

// Fired when the server says the session has ended, so the app can send the user to sign in
export const SESSION_EXPIRED = 'hms:session-expired';

// Error from the API: message for the user, HTTP status and per-field messages
export class ApiError extends Error {
  constructor(message, status, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

// Calls the backend with the login cookie and JSON body; throws an ApiError carrying
// the server's message when the response is not OK
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(API_URL + path, {
      method,
      credentials: 'include',
      headers: {
        // Required by the server's CSRF protection for every request that changes data
        'X-Requested-With': 'XMLHttpRequest',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError('Cannot reach the server. Check your internet connection and try again.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event(SESSION_EXPIRED));
    }
    throw new ApiError(data.error || 'Something went wrong, please try again', res.status, data.fields);
  }
  return data;
}
