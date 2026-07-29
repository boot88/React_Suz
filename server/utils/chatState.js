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

const getAttachmentAliases = (attachment = {}) => [
  attachment.id,
  attachment.fileId,
  attachment.sha256,
  attachment.url,
  attachment.originalUrl,
  attachment.dataUrl,
  attachment.previewUrl,
  attachment.thumbnailUrl,
  attachment.posterUrl,
  attachment.storedName
]
  .filter(Boolean)
  .map((value) => String(value));

const normalizeMessageAttachments = (message = {}) => {
  const candidates = [
    ...(Array.isArray(message.attachments) ? message.attachments : []),
    ...(Array.isArray(message.files) ? message.files : []),
    message.attachment || null,
    message.file || null
  ].filter(Boolean);
  const seenAliases = new Set();
  const seenFallbacks = new Set();

  return candidates.filter((attachment) => {
    const aliases = getAttachmentAliases(attachment);
    const fallback = aliases.length
      ? ''
      : JSON.stringify([
        attachment.name || attachment.originalName || '',
        attachment.type || '',
        Number(attachment.size) || 0,
        attachment.uploadedAt || ''
      ]);
    const duplicate = aliases.some((alias) => seenAliases.has(alias))
      || (!aliases.length && seenFallbacks.has(fallback));

    aliases.forEach((alias) => seenAliases.add(alias));
    if (!aliases.length) seenFallbacks.add(fallback);
    return !duplicate;
  });
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
  normalizeMessageAttachments,
  mergeThreadMessages,
  groupThreadSnapshotRows
};
