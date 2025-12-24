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
  } finally {
    process.exit();
  }
}

init();
