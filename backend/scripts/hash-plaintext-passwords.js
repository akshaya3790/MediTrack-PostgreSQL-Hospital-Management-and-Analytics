// One-off upgrade step: replaces plain-text passwords left by the old version with
// bcrypt hashes, so existing users keep signing in with the same password.
// Rows that already hold a bcrypt hash are left alone, so it is safe to run again.
// Prints only counts, never a password.
//   cd backend && node scripts/hash-plaintext-passwords.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const { pool, withTransaction } = require('../db');

const BCRYPT_ROUNDS = 10; // same as app.js
const BCRYPT_HASH = /^\$2[aby]\$\d\d\$/;

async function hashTable(client, table) {
  const { rows } = await client.query(`SELECT email, password FROM ${table} FOR UPDATE`);
  const plain = rows.filter(row => !BCRYPT_HASH.test(row.password));
  for (const row of plain) {
    const hash = await bcrypt.hash(row.password, BCRYPT_ROUNDS);
    // Check the hash before saving it, so a bad hash can never lock a user out
    if (!(await bcrypt.compare(row.password, hash))) {
      throw new Error(`Hash check failed for a ${table} row; nothing was changed`);
    }
    await client.query(`UPDATE ${table} SET password = $1 WHERE email = $2`, [hash, row.email]);
  }
  console.log(`${table}: ${plain.length} hashed, ${rows.length - plain.length} already hashed`);
}

withTransaction(async client => {
  await hashTable(client, 'Patient');
  await hashTable(client, 'Doctor');
})
  .catch(err => {
    console.error(`Failed, nothing was changed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
