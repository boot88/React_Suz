const getChatTimestamp = (message = {}) => {
  return Math.max(0, ...[
    message.createdAt,
    message.updatedAt,
    message.editedAt,
    message.deletedAt
  ]
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite));
};

const isMysqlDatabase = (database) => typeof database?.execute === 'function';

const mergeThreadMessages = (archiveMessages = [], sqlMessages = []) => {
  const byId = new Map();

  [...sqlMessages, ...archiveMessages].forEach((message) => {
    if (!message?.id) return;
    const current = byId.get(message.id);
    if (!current || getChatTimestamp(message) >= getChatTimestamp(current)) {
      byId.set(message.id, message);
    }
  });

  return [...byId.values()].sort((a, b) => (
    new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
  ));
};

const groupThreadSnapshotRows = (rows = []) => (rows || []).reduce((threads, row) => {
  const conversationId = String(row?.conversation_id || '').trim();
  const message = typeof row?.message === 'object'
    ? row.message
    : (() => {
        try { return JSON.parse(row?.message_json || ''); } catch { return null; }
      })();
  if (!conversationId || !message?.id) return threads;
  if (!threads[conversationId]) threads[conversationId] = [];
  threads[conversationId].push(message);
  return threads;
}, {});

module.exports = {
  getChatTimestamp,
  isMysqlDatabase,
  mergeThreadMessages,
  groupThreadSnapshotRows
};
