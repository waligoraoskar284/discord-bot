const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

// Spróbuj znaleźć plik .env.db w kilku miejscach (startup/ lub root)
const candidates = [
  path.resolve(__dirname, '.env.db'),           // __dirname (np. src/startup/.env.db)
  path.resolve(process.cwd(), '.env.db'),       // projekt root/.env.db
  path.resolve(process.cwd(), '.env')          // fallback na zwykłe .env
];

let loadedEnvPath = null;
for (const p of candidates) {
  if (fs.existsSync(p)) {
    require('dotenv').config({ path: p });
    loadedEnvPath = p;
    break;
  }
}

// Jeżeli nic nie załadowano, nadal próbujemy użyć process.env (np. z Render env vars)
if (!process.env.DATABASE_URL) {
  console.error('❌ Brak DATABASE_URL w środowisku ani w plikach .env.db/.env.');
  console.error('Sprawdź, czy dodałeś DATABASE_URL w panelu Render (Environment -> Environment Variables).');
  console.error('Przykład wartości: postgres://user:pass@host:port/dbname');
  // Zamiast throw możesz zakończyć proces z czytelnym komunikatem:
  throw new Error('Brak DATABASE_URL — konfiguracja bazy danych nie znaleziona.');
}

// Konfiguracja SSL tylko gdy DB_SSL=true (opcjonalnie)
const useSsl = (process.env.DB_SSL === 'true') || (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require'));

const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {})
};

const pool = new Pool(poolConfig);

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};