const chat = require('../routes/chat');
const db = require('../config/database');
(async () => {
  try { console.log(`Recovered messages: ${await chat.replayMessageJournal()}`); }
  catch (error) { console.error('Journal recovery failed:', error.message); process.exitCode = 1; }
  finally { await db.end(); }
})();
