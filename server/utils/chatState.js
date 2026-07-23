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

const getDatabaseDialect = (database) => {
  if (typeof database?.execute === 'function') return 'mysql';
  if (typeof database?.query === 'function') return 'postgres';
  return '';
};

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

module.exports = {
  getChatTimestamp,
  getDatabaseDialect,
  mergeThreadMessages
};
