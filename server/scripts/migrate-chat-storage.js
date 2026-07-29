const chatRoutes = require('../routes/chat');
const db = require('../config/database');

const run = async () => {
  try {
    await chatRoutes.runChatStorageMigration();
    console.log('Chat storage migration completed successfully.');
    process.exitCode = 0;
  } catch (error) {
    console.error('Chat storage migration failed:', error);
    process.exitCode = 1;
  } finally {
    await db.end().catch(() => {});
  }
};

run();
