const nodemailer = require('nodemailer');

// Sends email through the SMTP server set in .env. Without SMTP settings, in
// development only, the message is printed to the server console instead so the
// password reset flow can still be tried locally.
const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  })
  : null;

async function sendMail({ to, subject, text }) {
  if (transport) {
    await transport.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text });
    return;
  }
  if (process.env.NODE_ENV === 'production') {
    console.error('Email not sent: SMTP is not configured');
    return;
  }
  if (process.env.NODE_ENV !== 'test') {
    console.log(`\n[dev email] To: ${to}\nSubject: ${subject}\n${text}\n`);
  }
}

module.exports = { sendMail, emailConfigured: Boolean(transport) };
