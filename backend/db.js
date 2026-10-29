const { Pool, types } = require('pg');

// Return DATE columns as plain strings ("2024-01-15") instead of JS Dates,
// so the server's or browser's timezone can't shift a date by one day.
// TIME columns already come back as strings ("09:00:00").
const DATE_OID = 1082;
types.setTypeParser(DATE_OID, value => value);

// Connection settings come from backend/.env (see .env.example)
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'hms',
  max: 10,
});

// Runs fn(client) inside a transaction; commits if it resolves, rolls back if it throws
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
