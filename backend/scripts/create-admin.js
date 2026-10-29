// Creates an administrator account, or sets a new password for an existing one.
// There is deliberately no sign-up page for administrators.
//
//   npm run create-admin -- admin@yourhospital.in "Your Name"
//
// The password is asked for in the terminal (or read from ADMIN_PASSWORD) and is never printed.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const v = require('../validation');

// Reads a line without echoing what is typed
function askHidden(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = false;
    rl._writeToOutput = text => { if (!rl.stdoutMuted) rl.output.write(text); };
    rl.question(question, answer => { rl.close(); process.stdout.write('\n'); resolve(answer); });
    rl.stdoutMuted = true;
  });
}

async function main() {
  const [emailArg, ...nameParts] = process.argv.slice(2);
  const name = v.normalizeName(nameParts.join(' '));
  const problems = [v.checkEmail(emailArg), v.checkName(name, 'Name', { min: 2, max: 100 })].filter(Boolean);
  if (problems.length) {
    console.error(`${problems.join('\n')}\n\nUsage: npm run create-admin -- admin@yourhospital.in "Your Name"`);
    process.exit(1);
  }
  const email = v.normalizeEmail(emailArg);
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await askHidden('Password for the administrator: ');
    const again = await askHidden('Type the password again: ');
    const mismatch = v.checkPasswordConfirmation(password, again);
    if (mismatch) throw new Error(mismatch);
  }
  const weak = v.checkPassword(password);
  if (weak) throw new Error(weak);

  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO Admin (email, password, name) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, name = EXCLUDED.name
     RETURNING (xmax = 0) AS created`,
    [email, hash, name]);
  // Sign the administrator out everywhere if the password was changed
  if (!rows[0].created) {
    await pool.query(`DELETE FROM session WHERE sess->'user'->>'email' = $1 AND sess->'user'->>'who' = 'adm'`, [email]);
  }
  console.log(rows[0].created
    ? `Administrator ${email} created. Sign in at /admin/login.`
    : `Password and name updated for administrator ${email}.`);
}

main()
  .catch(err => { console.error(`Could not save the administrator: ${err.message}`); process.exitCode = 1; })
  .finally(() => pool.end());
