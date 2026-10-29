const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

// Security headers for every API response. Responses can hold medical data,
// so browsers and proxies are told not to cache them.
function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Cache-Control': 'no-store',
  });
  next();
}

// CSRF protection for the cookie-based session. Every request that changes data must
// carry the X-Requested-With header, which a cross-site form cannot send and which a
// cross-site script can only send after a CORS preflight that only CLIENT_ORIGIN passes.
// When the browser sends an Origin header it must also be the frontend's origin.
function csrfProtection(allowedOrigin) {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('Origin');
    if (req.get('X-Requested-With') !== 'XMLHttpRequest' || (origin && origin !== allowedOrigin)) {
      return res.status(403).json({ error: 'Request blocked for security reasons. Please reload the page and try again.' });
    }
    next();
  };
}

const limiterMessage = message => (req, res) => res.status(429).json({ error: message });

// Brute-force protection. Failed sign-ins are counted per IP address and email,
// so one attacker cannot lock other users out by guessing at random accounts.
function createLimiters(scale = 1) {
  const minutes = n => n * 60 * 1000;
  return {
    login: rateLimit({
      windowMs: minutes(15),
      limit: 5 * scale,
      skipSuccessfulRequests: true,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: req => `${req.ip}|${String((req.body && req.body.email) || '').trim().toLowerCase()}`,
      handler: limiterMessage('Too many failed sign-in attempts. Please wait 15 minutes and try again, or reset your password.'),
    }),
    register: rateLimit({
      windowMs: minutes(60),
      limit: 10 * scale,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: limiterMessage('Too many accounts created from this network. Please try again later.'),
    }),
    passwordReset: rateLimit({
      windowMs: minutes(60),
      limit: 5 * scale,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: limiterMessage('Too many password reset requests. Please try again in an hour.'),
    }),
  };
}

// Compares secrets without leaking their length or content through timing
function safeEqual(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('hex');

module.exports = { securityHeaders, csrfProtection, createLimiters, safeEqual, hashToken, newToken };
