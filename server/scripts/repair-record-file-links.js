const chatRoutes = require('../routes/chat');
const db = require('../config/database');

const run = async () => {
  try {
    const result = await chatRoutes.repairStoredRecordFileLinks();
    console.log('Record file link repair completed successfully:', {
      scannedMessages: result.scannedMessages,
      scannedVersions: result.scannedVersions,
      scannedFeedPosts: result.scannedFeedPosts,
      discoveredChatLinks: result.discoveredChatLinks,
      discoveredFeedLinks: result.discoveredFeedLinks,
      insertedChatLinks: result.insertedChatLinks,
      insertedFeedLinks: result.insertedFeedLinks,
      retainedFiles: result.retainedFiles,
      missingFileCount: result.missingFileIds.length
    });
    if (result.missingFileIds.length) {
      console.warn('Some historical attachments have no chat_files metadata:', {
        count: result.missingFileIds.length,
        firstFileIds: result.missingFileIds.slice(0, 20)
      });
    }
    process.exitCode = 0;
  } catch (error) {
    console.error('Record file link repair failed:', error.message);
    process.exitCode = 1;
  } finally {
    await db.end().catch(() => {});
  }
};

run();
