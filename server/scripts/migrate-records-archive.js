const db = require('../config/database');
const { ensureRecordsArchiveSchema } = require('../utils/recordsArchiveSchema');

const run = async () => {
  try {
    const ready = await ensureRecordsArchiveSchema(db);
    if (!ready) throw new Error('Archive schema was not created');
    console.log('Records archive schema migration completed successfully.');
    process.exitCode = 0;
  } catch (error) {
    console.error('Records archive schema migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await db.end().catch(() => {});
  }
};

run();
