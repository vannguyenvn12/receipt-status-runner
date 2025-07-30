const pool = require('../db/db');

async function getReceiptByEmail(email) {
  const conn = await pool.getConnection();
  const [rows] = await conn.execute(
    'SELECT receipt_number FROM uscis WHERE email = ? ORDER BY updated_at DESC LIMIT 1',
    [email]
  );
  conn.release();
  return rows.length > 0 ? rows[0].receipt_number : null;
}

module.exports = getReceiptByEmail;
