// Connection pool for the analytics platform and a transaction helper
const { Pool } = require('pg');
const config = require('./config');

let pool;

function getPool(options = {}) {
  if (!pool) {
    pool = new Pool({ ...config.db, max: 5, ...options });
    pool.on('error', err => console.error(JSON.stringify({ level: 'error', msg: 'idle database client failed', code: err.code })));
  }
  return pool;
}

async function withTransaction(fn, { readOnly = false, isolation } = {}) {
  const client = await getPool().connect();
  try {
    await client.query(`BEGIN${isolation ? ` ISOLATION LEVEL ${isolation}` : ''}${readOnly ? ' READ ONLY' : ''}`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function closePool() {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

module.exports = { getPool, withTransaction, closePool };
