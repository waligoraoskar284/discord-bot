const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

// ładujemy env z pliku .env.db w tym katalogu (jeśli istnieje)
const envPath = path.resolve(__dirname, '.env.db');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  // Jeśli nie ma pliku .env.db, próbujemy zwykłego .env (opcjonalne)
  require('dotenv').config();
}

// Walidacja
if (!process.env.DATABASE_URL) {
  throw new Error('❌ Brak DATABASE_URL w startup/.env.db lub w środowisku');
}

// Konfiguracja SSL: włącz tylko gdy DB_SSL=true lub gdy DATABASE_URL wymaga ssl
const useSsl = (process.env.DB_SSL === 'true') || (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require'));

const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {})
};

const pool = new Pool(poolConfig);

async function testConnection() {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('✅ Połączenie z DB OK, czas:', res.rows[0].now);
  } catch (err) {
    console.error('❌ Błąd połączenia z DB:', err);
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  testConnection
};