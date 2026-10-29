// Turns identifiers into stable pseudonymous keys. The same email always gives the same key,
// but the email cannot be recovered from the key without the secret.
const crypto = require('crypto');

function makePseudonymizer(secret) {
  if (!secret || secret.length < 16) {
    throw new Error('ANALYTICS_PSEUDONYM_KEY must be set to at least 16 random characters');
  }
  return (prefix, value) => {
    if (value === null || value === undefined || value === '') return null;
    const digest = crypto.createHmac('sha256', secret).update(String(value).trim().toLowerCase()).digest('hex');
    return `${prefix}_${digest.slice(0, 24)}`;
  };
}

module.exports = { makePseudonymizer };
