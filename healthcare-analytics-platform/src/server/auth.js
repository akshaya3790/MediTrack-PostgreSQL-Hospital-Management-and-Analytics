// Recognises an administrator who is signed in to the hospital app.
// The hospital backend keeps sessions in the "session" table and gives the browser a signed
// "hms.sid" cookie. Cookies are shared by every port on the same host, so this service can
// verify the same cookie with the same secret and read (never write) the session row.
const signature = require('cookie-signature');

const COOKIE = 'hms.sid';

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

function requireAdmin(pool, secret, signInUrl) {
  return async (req, res, next) => {
    try {
      const raw = readCookie(req.headers.cookie, COOKIE);
      const sid = raw && raw.startsWith('s:') ? signature.unsign(raw.slice(2), secret) : false;
      if (!sid) {
        return res.status(401).json({ error: 'Please sign in to the hospital app as an administrator.', signInUrl });
      }
      const { rows } = await pool.query('SELECT sess FROM session WHERE sid = $1 AND expire > NOW()', [sid]);
      const user = rows.length && rows[0].sess && rows[0].sess.user;
      if (!user) {
        return res.status(401).json({ error: 'Your session has ended. Please sign in again.', signInUrl });
      }
      if (user.who !== 'adm') {
        return res.status(403).json({ error: 'Only hospital administrators can open the analytics.' });
      }
      req.admin = { signedIn: true };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requireAdmin, readCookie, COOKIE };
