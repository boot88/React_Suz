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

const getAttachmentFileId = (attachment = {}) => {
  const directId = String(attachment.id || attachment.fileId || '').trim();
  if (directId) return directId;
  const urls = [
    attachment.url,
    attachment.originalUrl,
    attachment.thumbnailUrl,
    attachment.previewUrl
  ].filter(Boolean);
  for (const value of urls) {
    const match = String(value).match(/\/api\/chat\/files\/([^/?#]+)\/download/i);
    if (match?.[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
  }
  return '';
};

const getMessageAttachmentFileIds = (message = {}) => [...new Set(
  normalizeMessageAttachments(message)
    .map(getAttachmentFileId)
    .filter(Boolean)
)];

const buildConversationMessagesPageQuery = (conversationId, { limit = 50, before = '' } = {}) => {
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const params = [conversationId];
  let where = 'conversation_id = ?';

  if (before) {
    const beforeDate = new Date(before);
    if (Number.isNaN(beforeDate.getTime())) {
      const error = new Error('Некорректный курсор пагинации сообщений');
      error.status = 400;
      error.code = 'INVALID_MESSAGE_CURSOR';
      throw error;
    }
    where += ' AND created_at < ?';
    params.push(beforeDate);
  }

  return {
    sql: `SELECT message_json
     FROM chat_messages
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT ${safeLimit}`,
    params,
    safeLimit
  };
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
  getAttachmentFileId,
  getMessageAttachmentFileIds,
  buildConversationMessagesPageQuery,
  mergeThreadMessages,
  groupThreadSnapshotRows
};
