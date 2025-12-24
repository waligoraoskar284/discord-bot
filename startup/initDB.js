// initDB.js — uruchamiaj TYLKO ręcznie (np. node initDB.js)
const db = require('./db');

async function init() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        ticket_content TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('✅ Tabela tickets gotowa!');
  } catch (err) {
    console.error('❌ Błąd inicjalizacji bazy:', err);
    process.exitCode = 1;
  } finally {
    try {
      await db.pool.end();
      console.log('🔌 Połączenie z bazą zamknięte.');
    } catch (e) {
      console.warn('⚠️ Nie udało się poprawnie zamknąć pool:', e);
    }
    process.exit();
  }
}

init();