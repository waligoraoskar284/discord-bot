const { Pool } = require('pg');
const path = require('path');

// ładujemy TYLKO env bazy
require('dotenv').config({
  path: path.resolve(__dirname, '.env.db')
});

if (!process.env.DATABASE_URL) {
  throw new Error('❌ Brak DATABASE_URL w startup/.env.db');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
