const path = require('path');
const mysql = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mysql2', 'promise'));
require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', 'backend', '.env')
});

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'smartwathiqa',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function query(sql, params = []) {
  const mysqlSql = sql.replace(/\$\d+/g, '?');
  const [rows] = await pool.query(mysqlSql, params);

  if (Array.isArray(rows)) {
    return { rows };
  }

  return {
    rows: [],
    insertId: rows.insertId,
    affectedRows: rows.affectedRows
  };
}

async function end() {
  await pool.end();
}

module.exports = { query, end };
