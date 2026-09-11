const { guardSessionStream } = require('../utils/authSessions');
const express = require('express');
const fsSync = require('fs');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const db = require('../config/database');
const {
  createMediaToken,
  MEDIA_TOKEN_TTL_MS
} = require('../utils/accessToken');
const {
  buildFeedCommentPreviewsQuery,
  buildFeedCommentsPageQuery,
  buildFeedPostsPageQuery,
  canManageFeedRecord,
  encodeFeedCursor,
  createSerialMutationQueue
} = require('../utils/feedState');
const {
  isMysqlDatabase,
  normalizeMessageAttachments,
  getAttachmentFileId,
  getMessageAttachmentFileIds,
  buildConversationMessagesPageQuery, encodeMessageCursor, decodeMessageCursor
} = require('../utils/chatState');
const {
  ensureRecordsArchiveSchema,
  indexMessageForRecordsArchive
} = require('../utils/recordsArchiveSchema');
const { buildRecordsArchivePackage } = require('../utils/recordsArchivePackage');
const {
  requireAuth,
  requireAuthAllowQuery,
  requireAuthAllowQueryOrMedia,
  requireRole,
  hasRole,
  isSameLogin
} = require('../middleware/auth');

const router = express.Router();
router.use((req, res, next) => {
  const queryTokenAllowed = (
    req.method === 'GET'
    && (
      req.path === '/threads/stream'
      || /^\/files\/[^/]+\/download$/.test(req.path)
    )
  );
  // Для скачивания файлов разрешаем короткоживущий media-токен (?mt=),
  // чтобы полный access_token не попадал в URL.
  const isProtectedDownload = req.method === 'GET' && (
    /^\/files\/[^/]+\/download$/.test(req.path)
    || /^\/records\/archives\/[^/]+\/download$/.test(req.path)
  );
  const middleware = isProtectedDownload ? requireAuthAllowQueryOrMedia : (queryTokenAllowed ? requireAuthAllowQuery : requireAuth);
  return middleware(req, res, next);
});

const dataDir = path.join(__dirname, '..', 'data');
const chatFilePath = path.join(dataDir, 'chatThreads.json');
const feedFilePath = path.join(dataDir, 'employeeFeed.json');
const backupDir = path.join(dataDir, 'backups');
const uploadsDir = path.join(__dirname, '..', 'uploads');
const recordsArchiveDir = path.join(dataDir, 'records-archives');
const MAX_BACKUPS_PER_FILE = 30;
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD = 3 * 1024 * 1024;
const CHAT_SQL_PAGE_SIZE = 50;
const CHAT_SEARCH_PAGE_SIZE = 25;
const STREAM_EVENT_BUFFER_SIZE = 500;
const ORPHAN_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ALLOWED_UPLOAD_SCOPES = new Set(['chat', 'feed']);
const ALLOWED_UPLOAD_TYPES = /^(image\/|video\/|application\/pdf$|text\/plain$|application\/msword$|application\/vnd\.openxmlformats-officedocument|application\/vnd\.ms-excel$|application\/zip$|application\/x-rar-compressed$|application\/vnd.rar$|application\/x-7z-compressed$)/i;
const DANGEROUS_EXTENSIONS = new Set(['.exe', '.bat', '.cmd', '.com', '.scr', '.js', '.mjs', '.sh', '.ps1', '.vbs', '.jar']);
const execFileAsync = promisify(execFile);

let cachedThreads = null;
let storageReadyPromise = null;
const streamClients = new Set();
const streamEventBuffer = [];
const typingTimers = new Map();
const archiveIntegrityCache = new Map();
let lastStreamEventId = Date.now() * 1000;

const cloneThreads = (threads) => JSON.parse(JSON.stringify(threads || {}));
const createId = (prefix = 'item') => `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;


let chatSqlReady = false;
let chatSqlCheckPromise = null;
let chatSqlRetryAt = 0;

const normalizeMessageDate = (message = {}) => {
  const date = new Date(message.createdAt || message.updatedAt || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const ensureChatSqlSchema = async () => {
  if (chatSqlReady) {
    await ensureRecordsArchiveSchema(db);
    return true;
  }
  if (chatSqlCheckPromise) return chatSqlCheckPromise;
  if (Date.now() < chatSqlRetryAt) return false;

  chatSqlCheckPromise = (async () => {
    if (!isMysqlDatabase(db)) throw new Error('MySQL client is unavailable');

    await db.execute(`CREATE TABLE IF NOT EXISTS chat_messages (
      id VARCHAR(128) PRIMARY KEY,
      conversation_id VARCHAR(255) NOT NULL,
      sender_login VARCHAR(255) NULL,
      message_json LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      deleted_at DATETIME NULL,
      participant_a VARCHAR(255) GENERATED ALWAYS AS (SUBSTRING_INDEX(conversation_id, '::', 1)) STORED,
      participant_b VARCHAR(255) GENERATED ALWAYS AS (SUBSTRING_INDEX(conversation_id, '::', -1)) STORED,
      INDEX idx_chat_messages_conversation_created (conversation_id, created_at),
      INDEX idx_chat_messages_sender (sender_login),
      INDEX idx_chat_messages_participant_a_created (participant_a, created_at),
      INDEX idx_chat_messages_participant_b_created (participant_b, created_at)
    )`);
    await db.execute(
      "ALTER TABLE chat_messages ADD COLUMN participant_a VARCHAR(255) GENERATED ALWAYS AS (SUBSTRING_INDEX(conversation_id, '::', 1)) STORED"
    ).catch(() => {});
    await db.execute(
      "ALTER TABLE chat_messages ADD COLUMN participant_b VARCHAR(255) GENERATED ALWAYS AS (SUBSTRING_INDEX(conversation_id, '::', -1)) STORED"
    ).catch(() => {});
    await db.execute(
      'CREATE INDEX idx_chat_messages_participant_a_created ON chat_messages (participant_a, created_at)'
    ).catch(() => {});
    await db.execute(
      'CREATE INDEX idx_chat_messages_participant_b_created ON chat_messages (participant_b, created_at)'
    ).catch(() => {});
    await db.execute(`CREATE TABLE IF NOT EXISTS chat_message_files (
      message_id VARCHAR(128) NOT NULL,
      file_id VARCHAR(128) NOT NULL,
      conversation_id VARCHAR(255) NOT NULL,
      participant_a VARCHAR(255) NOT NULL,
      participant_b VARCHAR(255) NOT NULL,
      PRIMARY KEY (message_id, file_id),
      INDEX idx_chat_message_files_file_a (file_id, participant_a),
      INDEX idx_chat_message_files_file_b (file_id, participant_b),
      INDEX idx_chat_message_files_conversation (conversation_id)
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS chat_read_state (
      conversation_id VARCHAR(255) NOT NULL,
      user_login VARCHAR(255) NOT NULL,
      last_read_message_id VARCHAR(128) NULL,
      last_read_at DATETIME NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (conversation_id, user_login),
      INDEX idx_chat_read_state_user_updated (user_login, updated_at)
    )`);

    // The archive foundation is additive. If it cannot be created yet (for
    // example because the database user lacks DDL rights), the live chat must
    // remain available and the helper will retry on a later request.
    await ensureRecordsArchiveSchema(db);

    chatSqlReady = true;
    chatSqlRetryAt = 0;
    return true;
  })()
    .catch((error) => {
      chatSqlReady = false;
      chatSqlRetryAt = Date.now() + 5000;
      console.warn('Chat SQL storage unavailable, falling back to JSON archive:', error.message);
      return false;
    })
    .finally(() => {
      chatSqlCheckPromise = null;
    });

  return chatSqlCheckPromise;
};

const parseSqlMessage = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
};

const writeSqlMessage = async (conversationId, message = {}, { insertOnly = false, expectedSerializedMessage = null } = {}) => {
  if (!await ensureChatSqlSchema()) return false;
  const [owners] = await db.execute('SELECT conversation_id, sender_login FROM chat_messages WHERE id = ?', [message.id]);
  if (owners.length && (owners[0].conversation_id !== conversationId || !isSameLogin(owners[0].sender_login, message.sender))) {
    throw Object.assign(new Error('Идентификатор сообщения уже занят'), { status: 409 });
  }
  const createdAt = normalizeMessageDate(message);
  const updatedAt = new Date(message.updatedAt || message.editedAt || message.createdAt || Date.now());
  const deletedAt = message.deletedAt ? new Date(message.deletedAt) : null;
  const params = [message.id, conversationId, message.sender || null, JSON.stringify(message), createdAt, updatedAt, deletedAt];

  if (expectedSerializedMessage !== null) {
    const [updated] = await db.execute(`UPDATE chat_messages SET message_json = ?, updated_at = ?, deleted_at = ?
      WHERE id = ? AND conversation_id = ? AND sender_login = ? AND BINARY message_json = BINARY ?`,
      [JSON.stringify(message), updatedAt, deletedAt, message.id, conversationId, message.sender, expectedSerializedMessage]);
    if (!updated.affectedRows) throw Object.assign(new Error('Сообщение уже изменилось. Обновите диалог и повторите действие.'), { status: 409 });
  } else {
    await db.execute(
    `INSERT INTO chat_messages (id, conversation_id, sender_login, message_json, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE ${insertOnly ? 'id = id' : `
       message_json = IF(conversation_id = VALUES(conversation_id) AND sender_login = VALUES(sender_login), VALUES(message_json), message_json),
       updated_at = IF(conversation_id = VALUES(conversation_id) AND sender_login = VALUES(sender_login), VALUES(updated_at), updated_at),
       deleted_at = IF(conversation_id = VALUES(conversation_id) AND sender_login = VALUES(sender_login), VALUES(deleted_at), deleted_at)`}`,
    params
  );
  }
  const [savedOwner] = await db.execute('SELECT conversation_id, sender_login, message_json FROM chat_messages WHERE id = ?', [message.id]);
  if (savedOwner[0]?.conversation_id !== conversationId || !isSameLogin(savedOwner[0]?.sender_login, message.sender)) throw Object.assign(new Error('Идентификатор сообщения уже занят'), { status: 409 });
  if (insertOnly) message = parseSqlMessage(savedOwner[0].message_json);
  const [participantA = '', participantB = ''] = String(conversationId || '')
    .toLowerCase()
    .split('::')
    .map((item) => item.trim());
  // File links are append-only. Removing an attachment from the visible
  // message must not sever the historical message -> file relationship.
  const fileIds = getMessageAttachmentFileIds(message);
  if (fileIds.length && participantA && participantB) {
    await db.query(
      `INSERT IGNORE INTO chat_message_files
       (message_id, file_id, conversation_id, participant_a, participant_b)
       VALUES ?`,
      [fileIds.map((fileId) => [message.id, fileId, conversationId, participantA, participantB])]
    );
    await markFilesRetained(fileIds);
  }
  await indexMessageForRecordsArchive(db, conversationId, message);
  return true;
};

const readSqlConversationMessages = async (conversationId, { limit = CHAT_SQL_PAGE_SIZE, before = '' } = {}) => {
  if (!await ensureChatSqlSchema()) return null;
  const { sql, params } = buildConversationMessagesPageQuery(conversationId, { limit, before });

  // The limit is a server-clamped integer. Keeping it out of the prepared
  // statement avoids MySQL 8.4/mysql2 LIMIT marker incompatibilities.
  const [rows] = await db.query(sql, params);

  return (rows || []).map((row) => { const message = parseSqlMessage(row.message_json); return message ? { ...message, _cursor: encodeMessageCursor({ id: row.id, createdAt: row.created_at }) } : null; }).filter(Boolean).reverse();
};

const readSqlMessageRecordById = async (conversationId, messageId) => {
  if (!await ensureChatSqlSchema()) return null;
  const [rows] = await db.execute(
    `SELECT message_json
     FROM chat_messages
     WHERE conversation_id = ? AND id = ?
     LIMIT 1`,
    [conversationId, messageId]
  );
  if (!rows?.[0]) return null;
  const serializedMessage = typeof rows[0].message_json === 'string'
    ? rows[0].message_json
    : JSON.stringify(rows[0].message_json);
  const message = parseSqlMessage(rows[0].message_json);
  return message ? { message, serializedMessage } : null;
};

const readSqlMessageById = async (conversationId, messageId) => {
  const record = await readSqlMessageRecordById(conversationId, messageId);
  return record?.message || null;
};

const isSqlConversationArchived = async (conversationId) => {
  if (!await ensureRecordsArchiveSchema(db)) return false;
  const [rows] = await db.execute(
    'SELECT state FROM chat_conversations WHERE conversation_id = ? LIMIT 1',
    [conversationId]
  );
  return rows?.[0]?.state === 'archived';
};

const hydrateRetainedDeletedMessages = async (conversationId, messages = []) => {
  const deletedIds = messages
    .filter((message) => message?.deletedAt && message?.id)
    .map((message) => message.id);
  if (!deletedIds.length || !await ensureRecordsArchiveSchema(db)) return messages;

  try {
    const [rows] = await db.query(
      `SELECT versions.message_id, versions.snapshot_json
       FROM chat_message_versions AS versions
       INNER JOIN (
         SELECT message_id, MAX(version_no) AS version_no
         FROM chat_message_versions
         WHERE conversation_id = ?
           AND action <> 'delete'
           AND message_id IN (?)
         GROUP BY message_id
       ) AS retained
         ON retained.message_id = versions.message_id
        AND retained.version_no = versions.version_no`,
      [conversationId, deletedIds]
    );
    const retainedById = new Map((rows || []).map((row) => [
      String(row.message_id),
      parseSqlMessage(row.snapshot_json)
    ]));

    return messages.map((message) => {
      if (!message?.deletedAt) return message;
      const retained = retainedById.get(String(message.id));
      if (!retained) return message;
      return {
        ...message,
        text: retained.text,
        attachment: retained.attachment || null,
        attachments: Array.isArray(retained.attachments)
          ? retained.attachments
          : (retained.attachment ? [retained.attachment] : []),
        replyTo: retained.replyTo || null,
        forwardedFrom: retained.forwardedFrom || null
      };
    });
  } catch (error) {
    console.warn('Chat retained message version lookup failed:', error.message);
    return messages;
  }
};

const searchSqlConversationMessages = async (
  conversationId,
  { query = '', limit = CHAT_SEARCH_PAGE_SIZE, before = '' } = {}
) => {
  if (!await ensureChatSqlSchema()) return null;
  const normalizedQuery = String(query || '').trim().slice(0, 200);
  const safeLimit = Math.min(50, Math.max(1, Math.floor(Number(limit)) || CHAT_SEARCH_PAGE_SIZE));
  const params = [conversationId, `%${normalizedQuery.toLowerCase()}%`, `%${normalizedQuery.toLowerCase()}%`];
  let cursorSql = '';
  const cursor = decodeMessageCursor(before);
  if (cursor) { cursorSql = 'AND (created_at < ? OR (created_at = ? AND id < ?))'; params.push(cursor.at, cursor.at, cursor.id); }
  const [rows] = await db.query(
    `SELECT message_json, created_at, id
     FROM chat_messages
     WHERE conversation_id = ?
       AND deleted_at IS NULL
       AND (
         LOWER(CASE
           WHEN JSON_VALID(message_json)
           THEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(message_json, '$.text')), '')
           ELSE ''
         END) LIKE ?
         OR LOWER(message_json) LIKE ?
       )
       ${cursorSql}
     ORDER BY created_at DESC, id DESC
     LIMIT ${safeLimit}`,
    params
  );
  return (rows || [])
    .map((row) => ({ ...parseSqlMessage(row.message_json), _cursor: encodeMessageCursor({ id: row.id, createdAt: row.created_at }) }))
    .filter(Boolean);
};

const readSqlReadStates = async (login) => {
  if (!await ensureChatSqlSchema()) return {};
  const [rows] = await db.execute(
    `SELECT conversation_id, last_read_message_id, last_read_at, updated_at
     FROM chat_read_state
     WHERE user_login = ?`,
    [String(login || '').trim().toLowerCase()]
  );
  return Object.fromEntries((rows || []).map((row) => [row.conversation_id, {
    lastReadMessageId: row.last_read_message_id || '',
    lastReadAt: row.last_read_at || null
  }]));
};

const writeSqlReadState = async (conversationId, login, messageId) => {
  if (!await ensureChatSqlSchema()) return null;
  const message = await readSqlMessageById(conversationId, messageId);
  if (!message) return null;
  // The cursor is the last displayed message, not wall-clock time. Messages
  // arriving during this request must remain unread, including timestamp ties.
  const [positions] = await db.execute('SELECT created_at FROM chat_messages WHERE conversation_id = ? AND id = ?', [conversationId, messageId]);
  const readAt = new Date(positions[0].created_at);
  await db.execute(
    `INSERT INTO chat_read_state
       (conversation_id, user_login, last_read_message_id, last_read_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       last_read_message_id = IF(
         last_read_at IS NULL OR VALUES(last_read_at) > last_read_at OR (VALUES(last_read_at) = last_read_at AND VALUES(last_read_message_id) > COALESCE(last_read_message_id, '')),
         VALUES(last_read_message_id),
         last_read_message_id
       ),
       last_read_at = GREATEST(COALESCE(last_read_at, '1970-01-01'), VALUES(last_read_at)),
       updated_at = CURRENT_TIMESTAMP`,
    [conversationId, login, messageId, readAt]
  );
  const [stored] = await db.execute('SELECT last_read_message_id, last_read_at FROM chat_read_state WHERE conversation_id = ? AND user_login = ?', [conversationId, login]);
  return { conversationId, login, lastReadMessageId: stored[0].last_read_message_id, lastReadAt: new Date(stored[0].last_read_at).toISOString() };
};

const readSqlThreadSummaries = async (login) => {
  if (!await ensureChatSqlSchema()) return null;
  const normalizedLogin = String(login || '').trim().toLowerCase();
  if (!normalizedLogin) return {};

  const [rows] = await db.execute(
    `SELECT
       m.conversation_id,
       m.message_json,
       m.created_at,
       m.message_count,
       m.deleted_count,
       COALESCE(f.attachment_count, 0) AS attachment_count
     FROM (
       SELECT
         conversation_id,
         message_json,
         created_at,
         id,
         ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY created_at DESC, id DESC) AS message_rank,
         COUNT(*) OVER (PARTITION BY conversation_id) AS message_count,
         SUM(deleted_at IS NOT NULL) OVER (PARTITION BY conversation_id) AS deleted_count
       FROM chat_messages
       WHERE (participant_a = ? OR participant_b = ?)
         AND NOT EXISTS (
           SELECT 1 FROM chat_conversations AS conversations
           WHERE conversations.conversation_id = chat_messages.conversation_id
             AND conversations.state = 'archived'
         )
     ) AS m
     LEFT JOIN (
       SELECT conversation_id, COUNT(*) AS attachment_count
       FROM chat_message_files
       WHERE participant_a = ? OR participant_b = ?
       GROUP BY conversation_id
     ) AS f ON f.conversation_id = m.conversation_id
     WHERE m.message_rank = 1
     ORDER BY m.created_at DESC`,
    [normalizedLogin, normalizedLogin, normalizedLogin, normalizedLogin]
  );

  const [unreadRows] = await db.execute(`SELECT m.conversation_id, COUNT(*) AS unread_count
    FROM chat_messages m LEFT JOIN chat_read_state r ON r.conversation_id = m.conversation_id AND r.user_login = ?
    LEFT JOIN chat_messages anchor ON anchor.id = r.last_read_message_id AND anchor.conversation_id = m.conversation_id
    WHERE (m.participant_a = ? OR m.participant_b = ?) AND m.sender_login <> ? AND m.deleted_at IS NULL
      AND (m.created_at > COALESCE(anchor.created_at, r.last_read_at, '1970-01-01')
        OR (m.created_at = anchor.created_at AND m.id > anchor.id)) GROUP BY m.conversation_id`,
    [normalizedLogin, normalizedLogin, normalizedLogin, normalizedLogin]);
  const unread = new Map(unreadRows.map(row => [row.conversation_id, Number(row.unread_count)]));
  const [peerRows] = await db.execute(`SELECT r.conversation_id, r.last_read_message_id, r.last_read_at, m.created_at
    FROM chat_read_state r JOIN chat_messages m ON m.id = r.last_read_message_id AND m.conversation_id = r.conversation_id
    WHERE (m.participant_a = ? OR m.participant_b = ?) AND r.user_login <> ?`, [normalizedLogin, normalizedLogin, normalizedLogin]);
  const peers = new Map(peerRows.map(row => [row.conversation_id, { messageId: row.last_read_message_id, createdAt: row.created_at, readAt: row.last_read_at }]));
  return Object.fromEntries((rows || []).map((row) => {
    const lastMessage = parseSqlMessage(row.message_json);
    return [row.conversation_id, {
      conversationId: row.conversation_id,
      lastMessage,
      unreadCount: unread.get(row.conversation_id) || 0,
      peerRead: peers.get(row.conversation_id) || null,
      lastAt: lastMessage?.createdAt || row.created_at || '',
      lastTimestamp: new Date(lastMessage?.createdAt || row.created_at || 0).getTime() || 0,
      messageCount: Number(row.message_count) || 0,
      deletedCount: Number(row.deleted_count) || 0,
      attachmentsCount: Number(row.attachment_count) || 0
    }];
  }));
};

const getActiveLegalHoldsForConversation = async (conversationId) => {
  if (!conversationId || !await ensureRecordsArchiveSchema(db)) return [];
  const [rows] = await db.execute(
    `SELECT DISTINCT holds.id, holds.name, holds.reason, holds.ends_at
     FROM records_legal_holds AS holds
     INNER JOIN records_legal_hold_items AS items ON items.hold_id = holds.id
     WHERE holds.status = 'active'
       AND holds.starts_at <= NOW()
       AND (holds.ends_at IS NULL OR holds.ends_at > NOW())
       AND (
         (items.entity_type = 'chat_conversation' AND items.entity_id = ?)
         OR items.parent_id = ?
       )
     ORDER BY holds.created_at DESC`,
    [conversationId, conversationId]
  );
  return rows || [];
};


const sanitizeFileName = (name = 'file') => {
  const ext = path.extname(String(name)).toLowerCase();
  const base = path.basename(String(name), ext)
    .replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'file';
  return `${base}${ext}`;
};

const getDataUrlPayload = (dataUrl = '') => {
  const match = String(dataUrl).match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i);
  if (!match) return null;
  return { mime: match[1] || 'application/octet-stream', payload: match[2] || '' };
};


let chatFilesSqlReady = false;
let chatFilesSqlCheckPromise = null;
let chatFilesSqlRetryAt = 0;

const ensureChatFilesSqlSchema = async () => {
  if (chatFilesSqlReady) return true;
  if (chatFilesSqlCheckPromise) return chatFilesSqlCheckPromise;
  if (Date.now() < chatFilesSqlRetryAt) return false;

  chatFilesSqlCheckPromise = (async () => {
    if (!isMysqlDatabase(db)) throw new Error('MySQL client is unavailable');

    await db.execute(`CREATE TABLE IF NOT EXISTS chat_files (
      id VARCHAR(128) PRIMARY KEY,
      scope VARCHAR(32) NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      stored_name VARCHAR(255) NOT NULL,
      relative_path VARCHAR(1024) NULL,
      url VARCHAR(512) NOT NULL,
      thumbnail_url VARCHAR(512) NULL,
      mime_type VARCHAR(255) NOT NULL,
      size_bytes BIGINT NOT NULL,
      sha256 VARCHAR(64) NOT NULL,
      uploaded_at DATETIME NOT NULL,
      metadata_json LONGTEXT NULL,
      uploaded_by VARCHAR(255) NULL,
      claimed_at DATETIME NULL,
      retention_state VARCHAR(32) NOT NULL DEFAULT 'temporary',
      retained_at DATETIME NULL,
      is_verified TINYINT(1) NOT NULL DEFAULT 1,
      deleted_at DATETIME NULL,
      INDEX idx_chat_files_scope (scope),
      INDEX idx_chat_files_uploaded_at (uploaded_at),
      INDEX idx_chat_files_claimed_at (claimed_at),
      INDEX idx_chat_files_retention (retention_state, uploaded_at)
    )`);
    await db.execute('ALTER TABLE chat_files ADD COLUMN uploaded_by VARCHAR(255) NULL').catch(() => {});
    await db.execute('ALTER TABLE chat_files ADD COLUMN claimed_at DATETIME NULL').catch(() => {});
    await db.execute('CREATE INDEX idx_chat_files_claimed_at ON chat_files (claimed_at)').catch(() => {});
    await db.execute('ALTER TABLE chat_files ADD COLUMN relative_path VARCHAR(1024) NULL').catch(() => {});
    await db.execute("ALTER TABLE chat_files ADD COLUMN retention_state VARCHAR(32) NOT NULL DEFAULT 'temporary'").catch(() => {});
    await db.execute('ALTER TABLE chat_files ADD COLUMN retained_at DATETIME NULL').catch(() => {});
    await db.execute('CREATE INDEX idx_chat_files_retention ON chat_files (retention_state, uploaded_at)').catch(() => {});
    await db.execute('ALTER TABLE chat_files ADD COLUMN is_verified TINYINT(1) NOT NULL DEFAULT 1').catch(() => {});
    await db.execute('ALTER TABLE chat_files ADD COLUMN deleted_at DATETIME NULL').catch(() => {});
    await db.execute(
      `UPDATE chat_files
       SET relative_path = CONCAT(scope, '/', stored_name)
       WHERE relative_path IS NULL OR relative_path = ''`
    );
    await db.execute(
      `UPDATE chat_files
       SET retention_state = 'retained',
           retained_at = COALESCE(retained_at, claimed_at)
       WHERE claimed_at IS NOT NULL`
    );

    chatFilesSqlReady = true;
    chatFilesSqlRetryAt = 0;
    return true;
  })()
    .catch((error) => {
      chatFilesSqlReady = false;
      chatFilesSqlRetryAt = Date.now() + 5000;
      console.warn('Chat file SQL storage unavailable:', error.message);
      return false;
    })
    .finally(() => {
      chatFilesSqlCheckPromise = null;
    });

  return chatFilesSqlCheckPromise;
};

const markFilesRetained = async (fileIds = []) => {
  const uniqueFileIds = [...new Set((Array.isArray(fileIds) ? fileIds : []).filter(Boolean))];
  if (!uniqueFileIds.length || !await ensureChatFilesSqlSchema()) return 0;
  const [result] = await db.query(
    `UPDATE chat_files
     SET claimed_at = COALESCE(claimed_at, NOW()),
         retention_state = 'retained',
         retained_at = COALESCE(retained_at, NOW())
     WHERE id IN (?) AND deleted_at IS NULL`,
    [uniqueFileIds]
  );
  return Number(result?.affectedRows) || 0;
};

const writeSqlFileMetadata = async (file = {}) => {
  if (!await ensureChatFilesSqlSchema()) return false;
  const metadata = JSON.stringify({
    name: file.name,
    thumbnailUrl: file.thumbnailUrl || null,
    thumbnailStoredName: file.thumbnailStoredName || '',
    width: Number(file.width) || 0,
    height: Number(file.height) || 0,
    aspectRatio: Number(file.aspectRatio) || 0,
    duration: Number(file.duration) || 0
  });
  const relativePath = String(file.relativePath || `${file.scope}/${file.storedName}`).replace(/\\/g, '/');
  const retentionState = file.retentionState === 'retained' || file.claimedAt ? 'retained' : 'temporary';
  const params = [
    file.id,
    file.scope,
    file.originalName || file.name,
    file.storedName,
    relativePath,
    file.url,
    file.thumbnailUrl || null,
    file.type,
    file.size,
    file.sha256,
    new Date(file.uploadedAt || Date.now()),
    metadata,
    file.uploadedBy || null,
    file.claimedAt ? new Date(file.claimedAt) : null,
    retentionState,
    file.retainedAt ? new Date(file.retainedAt) : (file.claimedAt ? new Date(file.claimedAt) : null),
    file.isVerified === false ? 0 : 1,
    file.deletedAt ? new Date(file.deletedAt) : null
  ];

  await db.execute(
    `INSERT INTO chat_files (
      id, scope, original_name, stored_name, relative_path, url, thumbnail_url, mime_type, size_bytes,
      sha256, uploaded_at, metadata_json, uploaded_by, claimed_at, retention_state, retained_at,
      is_verified, deleted_at
    )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       scope = VALUES(scope),
       original_name = VALUES(original_name),
       stored_name = VALUES(stored_name),
       relative_path = VALUES(relative_path),
       url = VALUES(url),
       thumbnail_url = VALUES(thumbnail_url),
       mime_type = VALUES(mime_type),
       size_bytes = VALUES(size_bytes),
       sha256 = VALUES(sha256),
       uploaded_at = VALUES(uploaded_at),
       metadata_json = VALUES(metadata_json),
       uploaded_by = VALUES(uploaded_by),
       claimed_at = COALESCE(VALUES(claimed_at), claimed_at),
       retention_state = IF(retention_state = 'retained', retention_state, VALUES(retention_state)),
       retained_at = COALESCE(retained_at, VALUES(retained_at)),
       is_verified = VALUES(is_verified),
       deleted_at = VALUES(deleted_at)`,
    params
  );
  return true;
};

const getMultipartBoundary = (contentType = '') => {
  const match = String(contentType).match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);
  return match ? (match[1] || match[2] || '').trim() : '';
};

const parseContentDisposition = (value = '') => {
  const result = {};
  String(value).split(';').map((part) => part.trim()).forEach((part) => {
    const match = part.match(/^([^=]+)="?([^"]*)"?$/);
    if (match) result[match[1].toLowerCase()] = match[2];
  });
  return result;
};

const hasAllowedMagicBytes = (buffer, mime = '', ext = '') => {
  const safeMime = String(mime).toLowerCase();
  const head = buffer.slice(0, 12);
  if (ext === '.rar') return head.slice(0, 6).equals(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]));
  if (ext === '.7z') return head.slice(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]));
  if (safeMime === 'image/png') return head.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (safeMime === 'image/jpeg' || safeMime === 'image/jpg') return head.slice(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (safeMime === 'image/gif') return head.slice(0, 4).toString('ascii') === 'GIF8';
  if (safeMime === 'application/pdf') return head.slice(0, 4).toString('ascii') === '%PDF';
  if (safeMime === 'text/plain') return buffer.slice(0, 512).indexOf(0) === -1;
  if (['.zip', '.docx', '.xlsx'].includes(ext)) return head.slice(0, 2).toString('ascii') === 'PK';
  return true;
};

const writeChunk = async (stream, chunk) => {
  if (!chunk?.length || stream.write(chunk)) return;
  await new Promise((resolve, reject) => {
    stream.once('drain', resolve);
    stream.once('error', reject);
  });
};

// A small streaming multipart reader.  It keeps only headers, form fields and a
// boundary tail in memory; the actual file is written directly to a temporary file.
const readMultipartFileStream = async (req, boundary, tempPath) => {
  const delimiter = Buffer.from(`--${boundary}`);
  const bodyDelimiter = Buffer.from(`\r\n--${boundary}`);
  const fields = {};
  let buffer = Buffer.alloc(0);
  let state = 'start';
  let current = null;
  let filePart = null;
  let total = 0;
  let fieldBytes = 0;

  const fail = (message, status = 400) => {
    const error = new Error(message);
    error.status = status;
    throw error;
  };
  const finishCurrent = async () => {
    if (!current) return;
    if (current.file) {
      await new Promise((resolve, reject) => current.stream.end((error) => error ? reject(error) : resolve()));
      filePart = current;
    } else {
      const value = Buffer.concat(current.chunks);
      if (value.length > 2 * 1024 * 1024) fail('Служебное поле загрузки слишком велико', 413);
      fields[current.name] = value.toString('utf8');
    }
    current = null;
  };
  const consumeBody = async (chunk) => {
    if (!current) fail('Некорректные данные загрузки');
    if (current.file) {
      current.size += chunk.length;
      if (current.size > MAX_UPLOAD_SIZE) fail(`Файл должен быть не больше ${Math.round(MAX_UPLOAD_SIZE / 1024 / 1024)} МБ`, 413);
      current.hash.update(chunk);
      if (current.head.length < 512) current.head = Buffer.concat([current.head, chunk]).subarray(0, 512);
      await writeChunk(current.stream, chunk);
    } else {
      current.chunks.push(chunk);
      current.size += chunk.length;
      fieldBytes += chunk.length;
      if (current.size > 2 * 1024 * 1024 || fieldBytes > MAX_MULTIPART_OVERHEAD) fail('Служебное поле загрузки слишком велико', 413);
    }
  };
  const openPart = async (headerText) => {
    const headers = Object.fromEntries(headerText.split('\r\n').map((line) => {
      const separator = line.indexOf(':');
      return separator === -1 ? ['', ''] : [line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()];
    }).filter(([key]) => key));
    const disposition = parseContentDisposition(headers['content-disposition'] || '');
    if (!disposition.name) fail('Некорректное поле загрузки');
    if (disposition.filename !== undefined) {
      if (filePart || current?.file) fail('Разрешён только один файл в одном запросе');
      const stream = fsSync.createWriteStream(tempPath, { flags: 'wx' });
      current = { file: true, name: disposition.name, filename: disposition.filename || 'file', type: headers['content-type'] || 'application/octet-stream', stream, size: 0, hash: crypto.createHash('sha256'), head: Buffer.alloc(0) };
      await new Promise((resolve, reject) => { stream.once('open', resolve); stream.once('error', reject); });
    } else current = { file: false, name: disposition.name, chunks: [], size: 0 };
  };
  const process = async () => {
    while (true) {
      if (state === 'start') {
        if (buffer.length < delimiter.length + 2) return;
        if (!buffer.subarray(0, delimiter.length).equals(delimiter)) fail('Неверный формат multipart/form-data');
        buffer = buffer.subarray(delimiter.length);
        if (buffer.subarray(0, 2).equals(Buffer.from('--'))) { state = 'done'; return; }
        if (!buffer.subarray(0, 2).equals(Buffer.from('\r\n'))) fail('Неверный формат multipart/form-data');
        buffer = buffer.subarray(2); state = 'headers';
      }
      if (state === 'headers') {
        const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'));
        if (headerEnd === -1) { if (buffer.length > 64 * 1024) fail('Слишком большие заголовки загрузки', 413); return; }
        await openPart(buffer.subarray(0, headerEnd).toString('utf8'));
        buffer = buffer.subarray(headerEnd + 4); state = 'body';
      }
      if (state === 'body') {
        const boundaryIndex = buffer.indexOf(bodyDelimiter);
        if (boundaryIndex === -1) {
          const safeLength = Math.max(0, buffer.length - bodyDelimiter.length);
          if (safeLength) await consumeBody(buffer.subarray(0, safeLength));
          buffer = buffer.subarray(safeLength);
          return;
        }
        await consumeBody(buffer.subarray(0, boundaryIndex));
        buffer = buffer.subarray(boundaryIndex + 2);
        await finishCurrent(); state = 'boundary';
      }
      if (state === 'boundary') {
        if (buffer.length < delimiter.length + 2) return;
        if (!buffer.subarray(0, delimiter.length).equals(delimiter)) fail('Неверный формат multipart/form-data');
        buffer = buffer.subarray(delimiter.length);
        if (buffer.subarray(0, 2).equals(Buffer.from('--'))) { state = 'done'; return; }
        if (!buffer.subarray(0, 2).equals(Buffer.from('\r\n'))) fail('Неверный формат multipart/form-data');
        buffer = buffer.subarray(2); state = 'headers';
      }
      if (state === 'done') return;
    }
  };
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_UPLOAD_SIZE + MAX_MULTIPART_OVERHEAD) fail(`Файл должен быть не больше ${Math.round(MAX_UPLOAD_SIZE / 1024 / 1024)} МБ`, 413);
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    await process();
  }
  await process();
  if (state !== 'done' || !filePart) fail('Файл не передан');
  return { fields, filePart };
};

const scanUploadedFile = async (filePath) => {
  const command = String(process.env.CLAMAV_SCAN_COMMAND || '').trim();
  if (!command) return true;
  try {
    await execFileAsync(command, ['--no-summary', filePath], { timeout: 120000 });
    return true;
  } catch (error) {
    const rejected = new Error('Файл помещён в карантин: проверка безопасности не пройдена');
    rejected.status = 422;
    throw rejected;
  }
};

const saveMultipartUpload = async (req) => {
  const boundary = getMultipartBoundary(req.headers['content-type']);
  if (!boundary) { const error = new Error('Неверный формат multipart/form-data'); error.status = 400; throw error; }
  const tempDir = path.join(uploadsDir, 'tmp');
  const quarantineDir = path.join(uploadsDir, 'quarantine');
  await fs.mkdir(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.upload`);
  const createdFilePaths = [tempPath];
  let uploadSaved = false;
  try {
    const { fields, filePart } = await readMultipartFileStream(req, boundary, tempPath);
    const safeScope = ALLOWED_UPLOAD_SCOPES.has(fields.scope) ? fields.scope : 'chat';
    let mime = filePart.type || fields.type || 'application/octet-stream';
    if (mime === 'application/octet-stream') {
      const extension = path.extname(fields.name || filePart.filename || '').toLowerCase();
      mime = ({ '.rar': 'application/vnd.rar', '.7z': 'application/x-7z-compressed' })[extension] || mime;
    }
    const safeOriginalName = sanitizeFileName(fields.name || filePart.filename || 'file');
    const ext = path.extname(safeOriginalName).toLowerCase();
    if (['image/svg+xml', 'text/html', 'application/xhtml+xml'].includes(mime.toLowerCase()) || ['.svg', '.html', '.htm'].includes(ext)) throw Object.assign(new Error('Этот тип файла запрещён'), { status: 400 });
    if (!ALLOWED_UPLOAD_TYPES.test(mime) || DANGEROUS_EXTENSIONS.has(ext) || !hasAllowedMagicBytes(filePart.head, mime, ext)) {
      const error = new Error('Этот тип файла запрещён'); error.status = 400; throw error;
    }
    if (Number(fields.size || filePart.size) > MAX_UPLOAD_SIZE || filePart.size > MAX_UPLOAD_SIZE) {
      const error = new Error(`Файл должен быть не больше ${Math.round(MAX_UPLOAD_SIZE / 1024 / 1024)} МБ`); error.status = 413; throw error;
    }
    try { await scanUploadedFile(tempPath); } catch (error) {
      await fs.mkdir(quarantineDir, { recursive: true });
      await fs.rename(tempPath, path.join(quarantineDir, path.basename(tempPath))).catch(() => {});
      createdFilePaths.length = 0;
      throw error;
    }
    const uploadDir = path.join(uploadsDir, safeScope);
    await fs.mkdir(uploadDir, { recursive: true });
    const storedName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeOriginalName}`;
    const storedPath = path.join(uploadDir, storedName);
    await fs.rename(tempPath, storedPath);
    createdFilePaths[0] = storedPath;
    const fileId = createId('file');
    const url = `/api/chat/files/${encodeURIComponent(fileId)}/download`;
    let thumbnailStoredName = '';
    let thumbnailUrl = String(mime).startsWith('image/') ? url : '';
    if ((String(mime).startsWith('image/') || String(mime).startsWith('video/')) && fields.thumbnailDataUrl) {
      const thumbnailParsed = getDataUrlPayload(fields.thumbnailDataUrl);
      const thumbnail = thumbnailParsed && String(thumbnailParsed.mime || '').startsWith('image/') ? Buffer.from(thumbnailParsed.payload, 'base64') : null;
      if (thumbnail?.length && thumbnail.length <= 2 * 1024 * 1024) {
        thumbnailStoredName = `thumb-${storedName.replace(/\.[^.]+$/, '')}.jpg`;
        const thumbnailPath = path.join(uploadDir, thumbnailStoredName);
        await fs.writeFile(thumbnailPath, thumbnail); createdFilePaths.push(thumbnailPath);
        thumbnailUrl = `/api/chat/files/${encodeURIComponent(fileId)}/download?variant=thumbnail`;
      }
    }
    const file = { id: fileId, scope: safeScope, name: safeOriginalName, type: mime, size: filePart.size, url, thumbnailUrl, originalName: fields.name || filePart.filename, uploadedBy: req.auth.login, storedName, relativePath: `${safeScope}/${storedName}`, thumbnailStoredName, sha256: filePart.hash.digest('hex'), retentionState: 'temporary', width: Math.max(0, Number(fields.width) || 0), height: Math.max(0, Number(fields.height) || 0), aspectRatio: Math.max(0, Number(fields.aspectRatio) || 0), duration: Math.max(0, Number(fields.duration) || 0), isVerified: true, uploadedAt: new Date().toISOString() };
    if (!await writeSqlFileMetadata(file)) { const error = new Error('Постоянное хранилище файлов временно недоступно'); error.status = 503; throw error; }
    uploadSaved = true;
    return file;
  } finally {
    if (!uploadSaved) await Promise.all(createdFilePaths.map((filePath) => fs.unlink(filePath).catch(() => {})));
  }
};

const getExtensionForMime = (mime = '') => ({
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogv',
  'application/pdf': '.pdf',
  'text/plain': '.txt'
}[String(mime).toLowerCase()] || '');

const hasInlinePayload = (value) => typeof value === 'string'
  && /^data:[^;,]+(?:;charset=[^;,]+)?;base64,/i.test(value);

const stripInlinePayloads = (value) => {
  if (Array.isArray(value)) {
    return value.map(stripInlinePayloads).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') {
    return hasInlinePayload(value) ? undefined : value;
  }
  if (Buffer.isBuffer(value)) return undefined;

  return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, stripInlinePayloads(item)])
    .filter(([, item]) => item !== undefined));
};

const sanitizeMessageForResponse = (message = {}, { includeRetainedContent = false } = {}) => {
  const safeMessage = stripInlinePayloads(message) || {};

  if (includeRetainedContent) return safeMessage;

  // Audit entries can contain text from an earlier client version. They are
  // never needed in the participant chat and are available only to admins.
  delete safeMessage.audit;
  if (!safeMessage.deletedAt) return safeMessage;

  // Keep just enough metadata to render a tombstone. The authoritative row,
  // its version history and file links remain untouched in MySQL.
  return {
    id: safeMessage.id,
    sender: safeMessage.sender,
    createdAt: safeMessage.createdAt,
    updatedAt: safeMessage.updatedAt,
    deletedAt: safeMessage.deletedAt,
    deletedBy: safeMessage.deletedBy,
    deliveryStatus: safeMessage.deliveryStatus,
    readAt: safeMessage.readAt,
    text: '',
    attachment: null,
    attachments: []
  };
};

const materializeLegacyAttachment = async (attachment = {}, scope = 'chat') => {
  const inlineSource = [attachment.url, attachment.dataUrl, attachment.previewUrl]
    .find(hasInlinePayload);
  const inlineThumbnail = [attachment.thumbnailUrl, attachment.thumbnailDataUrl, attachment.posterUrl]
    .find(hasInlinePayload);

  if (!inlineSource) {
    return {
      attachment: stripInlinePayloads(attachment),
      changed: Object.values(attachment).some(hasInlinePayload)
    };
  }

  const parsed = getDataUrlPayload(inlineSource);
  if (!parsed) return { attachment: stripInlinePayloads(attachment), changed: true };
  const fileData = Buffer.from(parsed.payload, 'base64');
  if (!fileData.length || fileData.length > MAX_UPLOAD_SIZE) {
    return { attachment: stripInlinePayloads(attachment), changed: true };
  }

  const mime = attachment.type || parsed.mime || 'application/octet-stream';
  const extension = path.extname(String(attachment.name || '')) || getExtensionForMime(mime);
  const sha256 = crypto.createHash('sha256').update(fileData).digest('hex');
  const fileId = `legacy_${sha256}`;
  const safeName = sanitizeFileName(attachment.name || `legacy-file${extension}`);
  const storedName = `${fileId}${extension || path.extname(safeName)}`;
  const uploadDir = path.join(uploadsDir, scope);
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(path.join(uploadDir, storedName), fileData);

  let thumbnailData = null;
  let thumbnailStoredName = '';
  let thumbnailUrl = String(mime).startsWith('image/')
    ? `/api/chat/files/${encodeURIComponent(fileId)}/download`
    : '';
  const parsedThumbnail = inlineThumbnail ? getDataUrlPayload(inlineThumbnail) : null;
  if (parsedThumbnail) {
    const candidate = Buffer.from(parsedThumbnail.payload, 'base64');
    if (candidate.length > 0 && candidate.length <= 2 * 1024 * 1024) {
      thumbnailData = candidate;
      thumbnailStoredName = `thumb-${fileId}.jpg`;
      await fs.writeFile(path.join(uploadDir, thumbnailStoredName), thumbnailData);
      thumbnailUrl = `/api/chat/files/${encodeURIComponent(fileId)}/download?variant=thumbnail`;
    }
  }

  const file = {
    id: fileId,
    scope,
    name: safeName,
    originalName: attachment.originalName || attachment.name || safeName,
    storedName,
    relativePath: `${scope}/${storedName}`,
    thumbnailStoredName,
    type: mime,
    size: fileData.length,
    sha256,
    url: `/api/chat/files/${encodeURIComponent(fileId)}/download`,
    thumbnailUrl,
    uploadedBy: attachment.uploadedBy || '',
    uploadedAt: attachment.uploadedAt || new Date().toISOString(),
    retentionState: 'temporary',
    isVerified: true,
    fileData,
    thumbnailData
  };
  const fileSaved = await writeSqlFileMetadata(file);
  if (!fileSaved) {
    throw new Error('Не удалось перенести встроенное вложение в файловое хранилище');
  }

  const publicFile = {
    ...stripInlinePayloads(attachment),
    id: file.id,
    name: file.name,
    originalName: file.originalName,
    type: file.type,
    size: file.size,
    url: file.url,
    thumbnailUrl: file.thumbnailUrl,
    uploadedAt: file.uploadedAt,
    isVerified: true
  };
  return { attachment: publicFile, changed: true };
};

const prepareMessageForResponse = async (message = {}) => {
  const attachments = getMessageAttachments(message);
  if (!attachments.length) return { message: stripInlinePayloads(message), changed: false };

  const prepared = await Promise.all(attachments.map((attachment) => materializeLegacyAttachment(attachment, 'chat')));
  const nextAttachments = prepared.map((item) => item.attachment).filter(Boolean);
  const existingAttachments = Array.isArray(message.attachments)
    ? message.attachments.filter(Boolean).map(stripInlinePayloads)
    : [];
  const attachmentShapeChanged = JSON.stringify(existingAttachments) !== JSON.stringify(nextAttachments)
    || Boolean(message.file)
    || (Array.isArray(message.files) && message.files.length > 0);
  const nextMessage = {
    ...message,
    attachment: nextAttachments[0] || null,
    attachments: nextAttachments
  };
  delete nextMessage.file;
  delete nextMessage.files;
  return {
    message: stripInlinePayloads(nextMessage),
    changed: attachmentShapeChanged || prepared.some((item) => item.changed)
  };
};

const validateClientAttachments = async (req, input) => {
  const raw = getMessageAttachments(input);
  if (raw.length > 10) throw Object.assign(new Error('Не больше 10 вложений в сообщении'), { status: 400 });
  const attachments = [];
  for (const attachment of raw) {
    const fileId = getAttachmentFileId(attachment);
    if (!fileId) throw Object.assign(new Error('Сначала загрузите файл'), { status: 400 });
    const file = await ensureFileDownloadAccess(req, fileId);
    const metadata = parseFileMetadataJson(file.metadata_json);
    attachments.push({ id: file.id, name: file.original_name, type: file.mime_type, size: file.size_bytes,
      url: `/api/chat/files/${encodeURIComponent(file.id)}/download`,
      thumbnailUrl: metadata.thumbnailStoredName ? `/api/chat/files/${encodeURIComponent(file.id)}/download?variant=thumbnail` : '',
      width: metadata.width || 0, height: metadata.height || 0, duration: metadata.duration || 0 });
  }
  return attachments;
};

const prepareClientMessage = async (req, conversationId, input, existing = null) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Неверное сообщение'), { status: 400 });
  const id = String(existing?.id || input.id || '');
  const text = String(input.text ?? existing?.text ?? '').trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id) || text.length > 2000) throw Object.assign(new Error('Неверный ID или текст длиннее 2000 символов'), { status: 400 });
  const attachments = await validateClientAttachments(req, input);
  if (!text && !attachments.length) throw Object.assign(new Error('Нельзя отправить пустое сообщение'), { status: 400 });
  let replyTo = existing?.replyTo || null;
  if (!existing && input.replyTo?.id) {
    const original = await readSqlMessageById(conversationId, String(input.replyTo.id));
    if (original && !original.deletedAt) replyTo = { id: original.id, sender: original.sender, text: original.text };
  }
  const now = new Date().toISOString();
  const createdAt = existing?.createdAt || new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
  return { ...(existing || {}), id, sender: existing?.sender || req.auth.login, text,
    createdAt, updatedAt: now,
    editedAt: existing ? now : null, reactions: existing?.reactions || {}, pinned: existing?.pinned || false,
    readAt: existing?.readAt || null, deliveryStatus: 'sent', replyTo,
    attachments, attachment: attachments[0] || null, audit: existing?.audit || [] };
};

const getRequestIdentity = (req) => req.auth || null;
const getRequestLogin = (req) => getRequestIdentity(req)?.login || '';

const requireConversationAccess = (req, res, conversationId) => {
  const login = getRequestLogin(req);
  if (!login) {
    res.status(401).json({ message: 'Для доступа к переписке требуется вход' });
    return '';
  }
  const participants = getParticipantsFromConversationId(conversationId);
  if (participants.length !== 2 || participants[0] === participants[1] || conversationId.length > 255 || !isConversationParticipant(conversationId, login)) {
    res.status(403).json({ message: 'Нет доступа к этой переписке' });
    return '';
  }
  return login;
};

const parseFileMetadataJson = (value) => {
  const parsed = parseSqlJson(value);
  return parsed && typeof parsed === 'object' ? parsed : {};
};

const CHAT_FILE_METADATA_COLUMNS = [
  'id', 'scope', 'original_name', 'stored_name', 'relative_path', 'url', 'thumbnail_url',
  'mime_type', 'size_bytes', 'sha256', 'uploaded_at', 'metadata_json',
  'uploaded_by', 'claimed_at', 'retention_state', 'retained_at', 'is_verified', 'deleted_at'
].join(', ');

const readSqlFileMetadata = async (fileId) => {
  if (!await ensureChatFilesSqlSchema()) return null;
  const [rows] = await db.execute(
    `SELECT ${CHAT_FILE_METADATA_COLUMNS} FROM chat_files WHERE id = ? LIMIT 1`,
    [fileId]
  );
  return rows?.[0] || null;
};

const getMessageAttachments = (message = {}) => normalizeMessageAttachments(message);

const getParticipantsFromConversationId = (conversationId = '') => conversationId
  .toLowerCase()
  .split('::')
  .map((item) => item.trim())
  .filter(Boolean);

const isConversationParticipant = (conversationId = '', login = '') => (
  getParticipantsFromConversationId(conversationId).includes(String(login || '').toLowerCase())
);

const findFeedFileReference = async (file) => {
  if (!await ensureFeedSqlSchema()) return false;
  const [rows] = await db.execute(
    `SELECT 1 FROM feed_post_files AS links
     INNER JOIN feed_posts AS posts ON posts.id = links.post_id AND posts.deleted_at IS NULL
     WHERE links.file_id = ? LIMIT 1`,
    [file.id]
  );
  return Boolean(rows?.length);
};

const hasIndexedChatFileAccess = async (fileId, login) => {
  if (!await ensureChatSqlSchema()) return false;
  const [rows] = await db.execute(
    `SELECT 1
     FROM chat_message_files
     WHERE file_id = ? AND (participant_a = ? OR participant_b = ?)
     LIMIT 1`,
    [fileId, login, login]
  );
  return Boolean(rows?.length);
};

const hasActiveRecordsArchiveFileAccess = async (fileId, login) => {
  if (!fileId || !login || !await ensureRecordsArchiveSchema(db)) return false;
  const [rows] = await db.execute(
    `SELECT 1
     FROM records_archive_access AS access_grants
     INNER JOIN records_archive_files AS archive_files
       ON archive_files.archive_id = access_grants.archive_id
     INNER JOIN records_archives AS archives
       ON archives.id = access_grants.archive_id
     WHERE archive_files.file_id = ?
       AND access_grants.user_login = ?
       AND access_grants.revoked_at IS NULL
       AND (access_grants.expires_at IS NULL OR access_grants.expires_at > NOW())
       AND archives.status = 'completed'
       AND archives.deleted_at IS NULL
     LIMIT 1`,
    [fileId, String(login).trim().toLowerCase()]
  );
  return Boolean(rows?.length);
};

const getFeedAttachmentsFromPost = (post = {}) => [
  ...(Array.isArray(post.attachments) ? post.attachments : []),
  post.attachment || null
].filter(Boolean);

const resolveStoredDownload = (file = {}, variant = '') => {
  const metadata = parseFileMetadataJson(file.metadata_json);
  const scope = ALLOWED_UPLOAD_SCOPES.has(file.scope) ? file.scope : 'chat';
  const storedName = metadata.thumbnailStoredName
    || path.basename(decodeURIComponent(String(file.thumbnail_url || '').split('?')[0] || ''));
  const relativePath = variant === 'thumbnail'
    ? path.join(scope, path.basename(storedName))
    : String(file.relative_path || path.join(scope, path.basename(file.stored_name || '')));
  const fileName = variant === 'thumbnail' ? `thumb-${file.original_name || file.id}.jpg` : (file.original_name || file.id);
  const mime = variant === 'thumbnail' ? 'image/jpeg' : file.mime_type;
  if (!relativePath) return null;
  const storageRoot = path.resolve(uploadsDir);
  const filePath = path.resolve(storageRoot, relativePath);
  if (filePath !== storageRoot && !filePath.startsWith(`${storageRoot}${path.sep}`)) return null;
  return { filePath, fileName, mime };
};

const deleteStoredFileArtifacts = async (file = {}) => {
  const targets = [
    resolveStoredDownload(file),
    resolveStoredDownload(file, 'thumbnail')
  ].filter(Boolean);
  await Promise.all(targets.map(({ filePath }) => fs.unlink(filePath).catch(() => {})));
  await db.execute(
    `UPDATE chat_files
     SET deleted_at = NOW()
     WHERE id = ?`,
    [file.id]
  );
};

const cleanupOrphanChatUploads = async () => {
  if (!await ensureChatFilesSqlSchema() || !await ensureChatSqlSchema() || !await ensureFeedSqlSchema()) return 0;
  const cutoff = new Date(Date.now() - ORPHAN_UPLOAD_MAX_AGE_MS);
  const [rows] = await db.query(
    `SELECT ${CHAT_FILE_METADATA_COLUMNS}
     FROM chat_files AS files
     LEFT JOIN chat_message_files AS links ON links.file_id = files.id
     LEFT JOIN feed_post_files AS feed_links ON feed_links.file_id = files.id
     WHERE files.deleted_at IS NULL
       AND files.claimed_at IS NULL
       AND files.retention_state = 'temporary'
       AND files.uploaded_at < ?
       AND links.file_id IS NULL
       AND feed_links.file_id IS NULL
     LIMIT 100`,
    [cutoff]
  );
  await Promise.all((rows || []).map(deleteStoredFileArtifacts));
  return rows?.length || 0;
};

const ensureFileDownloadAccess = async (req, fileId) => {
  const login = getRequestLogin(req);
  if (!login) {
    const error = new Error('Требуется вход в систему');
    error.status = 401;
    throw error;
  }

  const file = await readSqlFileMetadata(fileId);
  if (!file || file.deleted_at) {
    const error = new Error('Файл не найден');
    error.status = 404;
    throw error;
  }
  if (file.is_verified === 0 || file.is_verified === false) {
    const error = new Error('Файл не прошёл проверку безопасности');
    error.status = 403;
    throw error;
  }

  const isUploader = file.uploaded_by && String(file.uploaded_by).toLowerCase() === login;
  const access = hasRole(req, 'admin')
    || isUploader
    || await hasActiveRecordsArchiveFileAccess(file.id, login)
    || (file.scope === 'feed'
      ? await findFeedFileReference(file)
      : await hasIndexedChatFileAccess(file.id, login));
  if (!access) {
    const error = new Error('Нет прав на скачивание файла');
    error.status = 403;
    throw error;
  }

  return file;
};

const parseByteRange = (headerValue = '', totalSize = 0) => {
  const match = String(headerValue).match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || !totalSize) return null;
  let start = match[1] ? Number(match[1]) : null;
  let end = match[2] ? Number(match[2]) : null;
  if (start === null && end !== null) {
    start = Math.max(0, totalSize - end);
    end = totalSize - 1;
  } else {
    start = start ?? 0;
    end = Math.min(end ?? totalSize - 1, totalSize - 1);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= totalSize) return null;
  return { start, end };
};

const streamFileWithRange = async (req, res, filePath) => {
  const stats = await fs.stat(filePath);
  const range = parseByteRange(req.headers.range, stats.size);
  res.setHeader('Accept-Ranges', 'bytes');
  if (req.headers.range && !range) {
    res.status(416);
    res.setHeader('Content-Range', `bytes */${stats.size}`);
    res.end();
    return;
  }
  let stream;
  if (!range) {
    res.setHeader('Content-Length', stats.size);
    stream = fsSync.createReadStream(filePath);
  } else {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stats.size}`);
    res.setHeader('Content-Length', range.end - range.start + 1);
    stream = fsSync.createReadStream(filePath, { start: range.start, end: range.end });
  }
  await new Promise((resolve, reject) => {
    stream.once('error', reject);
    res.once('finish', resolve);
    res.once('close', resolve);
    stream.pipe(res);
  });
};

const getSqlPayloadBuffer = (value) => {
  if (Buffer.isBuffer(value)) return value;
  if (value?.data && Array.isArray(value.data)) return Buffer.from(value.data);
  return null;
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isMeaningfulJson = (value) => (Array.isArray(value) ? value.length > 0 : isPlainObject(value) && Object.keys(value).length > 0);

const pruneBackups = async (filePath) => {
  try {
    const fileName = path.basename(filePath);
    const entries = await fs.readdir(backupDir);
    const backups = entries
      .filter((entry) => entry.startsWith(`${fileName}.`) && entry.endsWith('.bak') && !entry.includes('.latest.'))
      .sort()
      .reverse();
    await Promise.all(backups.slice(MAX_BACKUPS_PER_FILE).map((entry) => fs.unlink(path.join(backupDir, entry)).catch(() => {})));
  } catch {
    // backup pruning is best-effort
  }
};

const backupJsonFile = async (filePath) => {
  try {
    await fs.mkdir(backupDir, { recursive: true });
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw || 'null');
    if (!isMeaningfulJson(parsed)) return;
    const latestPath = path.join(backupDir, `${path.basename(filePath)}.latest.bak`);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.writeFile(latestPath, raw, 'utf-8');
    await fs.writeFile(path.join(backupDir, `${path.basename(filePath)}.${stamp}.bak`), raw, 'utf-8');
    await pruneBackups(filePath);
  } catch {
    // no valid source file yet
  }
};

const restoreJsonBackup = async (filePath, validate) => {
  try {
    const fileName = path.basename(filePath);
    const entries = await fs.readdir(backupDir).catch(() => []);
    const candidates = [
      `${fileName}.latest.bak`,
      ...entries.filter((entry) => entry.startsWith(`${fileName}.`) && entry.endsWith('.bak')).sort().reverse()
    ];

    for (const candidate of [...new Set(candidates)]) {
      try {
        const raw = await fs.readFile(path.join(backupDir, candidate), 'utf-8');
        const parsed = JSON.parse(raw || 'null');
        if (validate(parsed)) {
          await fs.writeFile(filePath, JSON.stringify(parsed, null, 2), 'utf-8');
          return parsed;
        }
      } catch {
        // try next backup
      }
    }
  } catch {
    // no backup directory
  }
  return null;
};

const atomicWriteJson = async (filePath, value) => {
  await fs.mkdir(dataDir, { recursive: true });
  await backupJsonFile(filePath);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf-8');
  await fs.rename(tmpPath, filePath);
};

const readJsonWithRecovery = async (filePath, fallback, validate, label, { throwOnUnrecoverable = false } = {}) => {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw || JSON.stringify(fallback));
    if (validate(parsed)) return parsed;
    throw new Error(`${label} имеет неверный формат`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      const restored = await restoreJsonBackup(filePath, validate);
      if (restored) return restored;
      await atomicWriteJson(filePath, fallback);
      return fallback;
    }
    console.error(`${label} read error, trying backup:`, error.message);
    const restored = await restoreJsonBackup(filePath, validate);
    if (restored) return restored;
    if (throwOnUnrecoverable) {
      throw new Error(`${label}: не удалось прочитать файл и восстановить резервную копию`);
    }
    return fallback;
  }
};

const readFeed = async () => readJsonWithRecovery(feedFilePath, [], Array.isArray, 'Chat feed', { throwOnUnrecoverable: true });

const feedMutationQueue = createSerialMutationQueue({
  read: readFeed,
  write: (posts) => atomicWriteJson(feedFilePath, Array.isArray(posts) ? posts : [])
});

const writeFeed = async (posts, { allowEmpty = false } = {}) => {
  const safePosts = Array.isArray(posts) ? posts : [];
  return feedMutationQueue.replace(safePosts, (nextPosts, currentPosts) => {
    if (!allowEmpty && nextPosts.length === 0 && currentPosts.length > 0) {
      throw new Error('Защита ленты: отказано в перезаписи непустой ленты пустым массивом');
    }
  });
};

let feedSqlReady = false;
let feedSqlCheckPromise = null;
let feedSqlRetryAt = 0;

const normalizeFeedDate = (value = {}) => {
  const date = new Date(value.createdAt || value.updatedAt || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const ensureFeedSqlSchema = async () => {
  if (feedSqlReady) return true;
  if (feedSqlCheckPromise) return feedSqlCheckPromise;
  if (Date.now() < feedSqlRetryAt) return false;

  feedSqlCheckPromise = (async () => {
    if (!isMysqlDatabase(db)) throw new Error('MySQL client is unavailable');

    await db.execute(`CREATE TABLE IF NOT EXISTS feed_posts (
      id VARCHAR(128) PRIMARY KEY,
      author_login VARCHAR(255) NULL,
      post_json LONGTEXT NOT NULL,
      pinned TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      deleted_at DATETIME NULL,
      INDEX idx_feed_posts_created (created_at),
      INDEX idx_feed_posts_author (author_login),
      INDEX idx_feed_posts_deleted (deleted_at)
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS feed_comments (
      id VARCHAR(128) PRIMARY KEY,
      post_id VARCHAR(128) NOT NULL,
      author_login VARCHAR(255) NULL,
      comment_json LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      deleted_at DATETIME NULL,
      INDEX idx_feed_comments_post_created (post_id, created_at),
      INDEX idx_feed_comments_deleted (deleted_at)
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS feed_reactions (
      post_id VARCHAR(128) NOT NULL,
      emoji VARCHAR(32) NOT NULL,
      login VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL,
      PRIMARY KEY (post_id, emoji, login),
      INDEX idx_feed_reactions_post (post_id)
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS feed_post_files (
      post_id VARCHAR(128) NOT NULL,
      file_id VARCHAR(128) NOT NULL,
      PRIMARY KEY (post_id, file_id),
      INDEX idx_feed_post_files_file (file_id)
    )`);

    feedSqlReady = true;
    feedSqlRetryAt = 0;
    return true;
  })()
    .catch((error) => {
      feedSqlReady = false;
      feedSqlRetryAt = Date.now() + 30_000;
      console.warn('Feed SQL storage unavailable:', error.message);
      return false;
    })
    .finally(() => {
      feedSqlCheckPromise = null;
    });

  return feedSqlCheckPromise;
};

const parseSqlJson = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
};

const getConversationPurgeFiles = async (conversationId) => {
  if (!await ensureChatFilesSqlSchema() || !await ensureChatSqlSchema() || !await ensureFeedSqlSchema()) return [];
  const [rows] = await db.execute(
    `SELECT ${CHAT_FILE_METADATA_COLUMNS},
            NOT EXISTS (
              SELECT 1 FROM chat_message_files AS other_chat_links
              WHERE other_chat_links.file_id = files.id
                AND other_chat_links.conversation_id <> ?
            )
            AND NOT EXISTS (
              SELECT 1 FROM feed_post_files AS feed_links
              WHERE feed_links.file_id = files.id
            ) AS is_exclusive
     FROM chat_files AS files
     INNER JOIN (
       SELECT DISTINCT file_id FROM chat_message_files WHERE conversation_id = ?
     ) AS conversation_files ON conversation_files.file_id = files.id`,
    [conversationId, conversationId]
  );
  return rows || [];
};

const inspectArchivePackage = async (storagePath, expectedSha256) => {
  if (!storagePath) return { packageOnDisk: false, checksumMatches: false };
  const storageRoot = path.resolve(recordsArchiveDir);
  const archivePath = path.resolve(String(storagePath));
  if (archivePath === storageRoot || !archivePath.startsWith(`${storageRoot}${path.sep}`)) {
    return { packageOnDisk: false, checksumMatches: false };
  }
  try {
    const stat = await fs.stat(archivePath);
    const cached = archiveIntegrityCache.get(archivePath);
    if (
      cached
      && cached.size === stat.size
      && cached.mtimeMs === stat.mtimeMs
      && cached.expectedSha256 === expectedSha256
    ) return cached.result;
    const actualSha256 = await new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fsSync.createReadStream(archivePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.once('error', reject);
      stream.once('end', () => resolve(hash.digest('hex')));
    });
    const result = {
      packageOnDisk: true,
      checksumMatches: Boolean(expectedSha256) && actualSha256 === expectedSha256,
      actualSha256
    };
    archiveIntegrityCache.set(archivePath, {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      expectedSha256,
      result
    });
    if (archiveIntegrityCache.size > 100) archiveIntegrityCache.delete(archiveIntegrityCache.keys().next().value);
    return result;
  } catch {
    return { packageOnDisk: false, checksumMatches: false };
  }
};

const findConversationPurgeBackup = async (conversationId, messageCount, fileCount) => {
  const [rows] = await db.query(
    `SELECT id, name, archive_type, status, selection_json, storage_path,
            package_sha256, record_count, file_count, total_bytes,
            created_at, completed_at, downloaded_at
     FROM records_archives
     WHERE status = 'completed' AND deleted_at IS NULL
     ORDER BY (downloaded_at IS NOT NULL) DESC, completed_at DESC
     LIMIT 100`
  );
  let fallback = null;
  for (const archive of rows || []) {
    const selection = parseSqlJson(archive.selection_json) || {};
    const includesConversation = selection.scope === 'all'
      || (selection.scope === 'conversation' && selection.conversationId === conversationId);
    if (!includesConversation) continue;
    const [[messageRows], [fileRows]] = await Promise.all([
      db.execute(
        `SELECT COUNT(DISTINCT entity_id) AS total
         FROM records_archive_items
         WHERE archive_id = ? AND entity_type = 'chat_message' AND parent_id = ?`,
        [archive.id, conversationId]
      ),
      db.execute(
        `SELECT COUNT(DISTINCT archive_files.file_id) AS total
         FROM records_archive_files AS archive_files
         INNER JOIN chat_message_files AS source_links ON source_links.file_id = archive_files.file_id
         WHERE archive_files.archive_id = ? AND source_links.conversation_id = ?`,
        [archive.id, conversationId]
      )
    ]);
    const archivedMessageCount = Number(messageRows?.[0]?.total) || 0;
    const archivedFileCount = Number(fileRows?.[0]?.total) || 0;
    const complete = archivedMessageCount >= messageCount && archivedFileCount >= fileCount;
    const packageInspection = complete && archive.downloaded_at
      ? await inspectArchivePackage(archive.storage_path, archive.package_sha256)
      : { packageOnDisk: false, checksumMatches: false };
    const candidate = {
      id: archive.id,
      name: archive.name,
      archiveType: archive.archive_type,
      packageSha256: archive.package_sha256,
      createdAt: archive.created_at,
      completedAt: archive.completed_at,
      downloadedAt: archive.downloaded_at,
      packageOnDisk: packageInspection.packageOnDisk,
      checksumMatches: packageInspection.checksumMatches,
      complete,
      archivedMessageCount,
      archivedFileCount,
      requiredMessageCount: messageCount,
      requiredFileCount: fileCount
    };
    if (!fallback) fallback = candidate;
    if (complete && archive.downloaded_at && packageInspection.packageOnDisk && packageInspection.checksumMatches) return candidate;
  }
  return fallback;
};

const getConversationPurgePreview = async (conversationId) => {
  if (!await ensureChatSqlSchema() || !await ensureChatFilesSqlSchema() || !await ensureFeedSqlSchema() || !await ensureRecordsArchiveSchema(db)) {
    const error = new Error('Хранилище не готово к окончательному удалению');
    error.status = 503;
    throw error;
  }
  const [[conversationRows], [messageRows], [versionRows], files, legalHolds] = await Promise.all([
    db.execute(
      `SELECT conversation_id, participant_a, participant_b, state, created_at,
              last_message_at, message_count
       FROM chat_conversations WHERE conversation_id = ? LIMIT 1`,
      [conversationId]
    ),
    db.execute(
      `SELECT COUNT(*) AS total, COALESCE(SUM(OCTET_LENGTH(message_json)), 0) AS total_bytes
       FROM chat_messages WHERE conversation_id = ?`,
      [conversationId]
    ),
    db.execute(
      'SELECT COUNT(*) AS total FROM chat_message_versions WHERE conversation_id = ?',
      [conversationId]
    ),
    getConversationPurgeFiles(conversationId),
    getActiveLegalHoldsForConversation(conversationId)
  ]);
  const conversation = conversationRows?.[0];
  if (!conversation) {
    const error = new Error('Переписка не найдена');
    error.status = 404;
    throw error;
  }
  const messageCount = Number(messageRows?.[0]?.total) || 0;
  const fileCount = files.length;
  const exclusiveFiles = files.filter((file) => Number(file.is_exclusive) === 1);
  const sharedFiles = files.filter((file) => !file.is_exclusive);
  const fileBytes = files.reduce((sum, file) => sum + (Number(file.size_bytes) || 0), 0);
  const exclusiveFileBytes = exclusiveFiles.reduce((sum, file) => sum + (Number(file.size_bytes) || 0), 0);
  const backup = await findConversationPurgeBackup(conversationId, messageCount, fileCount);
  const backupReady = Boolean(
    backup?.complete
    && backup?.downloadedAt
    && backup?.packageOnDisk
    && backup?.checksumMatches
  );
  return {
    conversation,
    counts: {
      messages: messageCount,
      messageVersions: Number(versionRows?.[0]?.total) || 0,
      files: fileCount,
      exclusiveFiles: exclusiveFiles.length,
      sharedFiles: sharedFiles.length,
      fileBytes,
      exclusiveFileBytes,
      sqlBytes: Number(messageRows?.[0]?.total_bytes) || 0
    },
    backup,
    backupReady,
    legalHolds,
    canPurge: backupReady && legalHolds.length === 0
  };
};

const stageFilesForPermanentDeletion = async (files, purgeId) => {
  const stagingDir = path.join(dataDir, 'purge-staging', purgeId);
  const moved = [];
  await fs.mkdir(stagingDir, { recursive: true });
  const seenPaths = new Set();
  try {
    for (const [index, file] of files.entries()) {
      for (const [kind, resolved] of [
        ['original', resolveStoredDownload(file)],
        ['thumbnail', resolveStoredDownload(file, 'thumbnail')]
      ]) {
        if (!resolved?.filePath || seenPaths.has(resolved.filePath)) continue;
        seenPaths.add(resolved.filePath);
        const stagedPath = path.join(stagingDir, `${index}-${sanitizeFileName(file.id)}-${kind}-${path.basename(resolved.filePath)}`);
        try {
          await fs.rename(resolved.filePath, stagedPath);
          moved.push({ sourcePath: resolved.filePath, stagedPath });
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    }
  } catch (error) {
    for (const file of [...moved].reverse()) {
      await fs.mkdir(path.dirname(file.sourcePath), { recursive: true });
      await fs.rename(file.stagedPath, file.sourcePath).catch(() => {});
    }
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return { stagingDir, moved };
};

const restoreStagedPurgeFiles = async (staged = {}) => {
  for (const file of [...(staged.moved || [])].reverse()) {
    await fs.mkdir(path.dirname(file.sourcePath), { recursive: true });
    await fs.rename(file.stagedPath, file.sourcePath).catch(() => {});
  }
  if (staged.stagingDir) await fs.rm(staged.stagingDir, { recursive: true, force: true }).catch(() => {});
};

const compactFeedPostForSql = (post = {}) => {
  const { comments, reactions, ...rest } = post;
  return rest;
};

const writeSqlFeedPost = async (post = {}) => {
  if (!await ensureFeedSqlSchema()) return false;
  const createdAt = normalizeFeedDate(post);
  const updatedAt = new Date(post.updatedAt || post.createdAt || Date.now());
  const deletedAt = post.deletedAt ? new Date(post.deletedAt) : null;
  const values = [post.id, post.author || null, JSON.stringify(compactFeedPostForSql(post)), Boolean(post.pinned), createdAt, updatedAt, deletedAt];
  await db.execute(
    `INSERT INTO feed_posts (id, author_login, post_json, pinned, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       author_login = VALUES(author_login),
       post_json = VALUES(post_json),
       pinned = VALUES(pinned),
       created_at = VALUES(created_at),
       updated_at = VALUES(updated_at),
       deleted_at = VALUES(deleted_at)`,
    [values[0], values[1], values[2], values[3] ? 1 : 0, values[4], values[5], values[6]]
  );
  const fileIds = [...new Set(getFeedAttachmentsFromPost(post).map(getAttachmentFileId).filter(Boolean))];
  // Preserve historical links when a post or attachment is hidden. The live
  // post JSON controls visibility; this table controls retention and restore.
  if (fileIds.length) {
    await db.query('INSERT IGNORE INTO feed_post_files (post_id, file_id) VALUES ?', [fileIds.map((fileId) => [post.id, fileId])]);
  }
  await markFilesRetained(fileIds);
  return true;
};

const writeSqlFeedComment = async (postId, comment = {}) => {
  if (!await ensureFeedSqlSchema()) return false;
  const createdAt = normalizeFeedDate(comment);
  const updatedAt = new Date(comment.updatedAt || comment.createdAt || Date.now());
  const deletedAt = comment.deletedAt ? new Date(comment.deletedAt) : null;
  const values = [comment.id, postId, comment.author || null, JSON.stringify(comment), createdAt, updatedAt, deletedAt];
  await db.execute(
    `INSERT INTO feed_comments (id, post_id, author_login, comment_json, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       post_id = VALUES(post_id),
       author_login = VALUES(author_login),
       comment_json = VALUES(comment_json),
       created_at = VALUES(created_at),
       updated_at = VALUES(updated_at),
       deleted_at = VALUES(deleted_at)`,
    values
  );
  return true;
};

const readSqlFeedReactions = async (postIds = []) => {
  if (!postIds.length || !await ensureFeedSqlSchema()) return {};
  const placeholders = postIds.map(() => '?').join(',');
  const [rows] = await db.execute(`SELECT post_id, emoji, login FROM feed_reactions WHERE post_id IN (${placeholders})`, postIds);
  return (rows || []).reduce((acc, row) => {
    if (!acc[row.post_id]) acc[row.post_id] = {};
    if (!acc[row.post_id][row.emoji]) acc[row.post_id][row.emoji] = [];
    acc[row.post_id][row.emoji].push(row.login);
    return acc;
  }, {});
};

const readSqlFeedComments = async (postId, { limit = 3, before = '' } = {}) => {
  if (!await ensureFeedSqlSchema()) return null;
  const query = buildFeedCommentsPageQuery(postId, { limit, before });
  const [rows] = await db.execute(query.sql, query.params);
  return (rows || []).map((row) => parseSqlJson(row.comment_json)).filter(Boolean).reverse();
};

const readSqlFeedCommentPreviews = async (postIds = [], limit = 3) => {
  if (!postIds.length || !await ensureFeedSqlSchema()) return {};
  const safeLimit = Math.min(5, Math.max(1, Math.floor(Number(limit)) || 3));
  let rows;
  let shouldReverse = false;
  try {
    const query = buildFeedCommentPreviewsQuery(postIds, safeLimit);
    [rows] = await db.execute(query.sql, query.params);
  } catch (error) {
    console.warn('Feed comment preview window query failed; using MySQL compatibility query:', {
      code: error.code || 'FEED_COMMENT_PREVIEW_QUERY_FAILED',
      message: error.message
    });
    const placeholders = postIds.map(() => '?').join(',');
    shouldReverse = true;
    [rows] = await db.execute(
      `SELECT post_id, comment_json
       FROM feed_comments
       WHERE deleted_at IS NULL AND post_id IN (${placeholders})
       ORDER BY post_id, created_at DESC`,
      postIds
    );
  }
  const commentsByPost = (rows || []).reduce((acc, row) => {
    if (!acc[row.post_id]) acc[row.post_id] = [];
    if (acc[row.post_id].length >= safeLimit) return acc;
    const comment = parseSqlJson(row.comment_json);
    if (comment) acc[row.post_id].push(comment);
    return acc;
  }, {});
  if (shouldReverse) {
    Object.values(commentsByPost).forEach((comments) => comments.reverse());
  }
  return commentsByPost;
};

const countSqlFeedComments = async (postIds = []) => {
  if (!postIds.length || !await ensureFeedSqlSchema()) return {};
  const placeholders = postIds.map(() => '?').join(',');
  const [rows] = await db.execute(`SELECT post_id, COUNT(*) AS total FROM feed_comments WHERE deleted_at IS NULL AND post_id IN (${placeholders}) GROUP BY post_id`, postIds);
  return Object.fromEntries((rows || []).map((row) => [row.post_id, Number(row.total) || 0]));
};

const readSqlFeedPosts = async ({ limit = 50, cursor = '', before = '', commentsLimit = 3 } = {}) => {
  if (!await ensureFeedSqlSchema()) return null;
  const query = buildFeedPostsPageQuery({ limit, cursor, before });
  let rows;
  try {
    [rows] = await db.execute(query.sql, query.params);
  } catch (error) {
    console.warn('Feed ordered page execute failed; retrying with MySQL query mode:', {
      code: error.code || 'FEED_POSTS_PAGE_QUERY_FAILED',
      message: error.message
    });
    [rows] = await db.query(query.sql, query.params);
  }
  const posts = (rows || [])
    .map((row) => parseSqlJson(row.post_json))
    .filter((post) => post && !post.deletedAt);
  const postIds = posts.map((post) => post.id).filter(Boolean);
  const [reactionsByPost, commentCounts, commentsByPost] = await Promise.all([
    readSqlFeedReactions(postIds).catch((error) => {
      console.warn('Feed reactions query failed:', error.code || error.message);
      return {};
    }),
    countSqlFeedComments(postIds).catch((error) => {
      console.warn('Feed comment count query failed:', error.code || error.message);
      return {};
    }),
    readSqlFeedCommentPreviews(postIds, commentsLimit).catch((error) => {
      console.warn('Feed comment previews query failed:', error.code || error.message);
      return {};
    })
  ]);
  return posts.map((post) => ({
    ...post,
    reactions: reactionsByPost[post.id] || {},
    comments: commentsByPost[post.id] || [],
    commentCount: commentCounts[post.id] || 0,
    commentsPreviewLimit: commentsLimit
  }));
};

const readSqlFeedPost = async (postId) => {
  if (!await ensureFeedSqlSchema()) return null;
  const [rows] = await db.execute(
    'SELECT post_json FROM feed_posts WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [postId]
  );
  return parseSqlJson(rows?.[0]?.post_json);
};

const readSqlFeedComment = async (postId, commentId) => {
  if (!await ensureFeedSqlSchema()) return null;
  const [rows] = await db.execute(
    'SELECT comment_json FROM feed_comments WHERE post_id = ? AND id = ? LIMIT 1',
    [postId, commentId]
  );
  return parseSqlJson(rows?.[0]?.comment_json);
};

const setSqlFeedReaction = async (postId, emoji, login, active) => {
  if (!await ensureFeedSqlSchema()) return false;
  const [rows] = await db.execute('SELECT post_id FROM feed_reactions WHERE post_id = ? AND emoji = ? AND login = ? LIMIT 1', [postId, emoji, login]);
  if (!active && rows?.length) {
    await db.execute('DELETE FROM feed_reactions WHERE post_id = ? AND emoji = ? AND login = ?', [postId, emoji, login]);
  } else if (active && !rows?.length) {
    await db.execute('INSERT INTO feed_reactions (post_id, emoji, login, created_at) VALUES (?, ?, ?, ?)', [postId, emoji, login, new Date()]);
  }
  return true;
};

const ensureStorage = async () => {
  if (!storageReadyPromise) {
    storageReadyPromise = fs.mkdir(dataDir, { recursive: true });
  }

  return storageReadyPromise;
};

const readThreadsFromDisk = async () => {
  await ensureStorage();
  return readJsonWithRecovery(chatFilePath, {}, isPlainObject, 'Chat threads');
};

const readThreads = async () => {
  if (cachedThreads) {
    return cloneThreads(cachedThreads);
  }

  try {
    cachedThreads = await readThreadsFromDisk();
    return cloneThreads(cachedThreads);
  } catch (error) {
    console.error('Chat read error:', error);
    cachedThreads = {};
    return {};
  }
};

const nextStreamEventId = () => {
  const candidate = Date.now() * 1000;
  lastStreamEventId = Math.max(lastStreamEventId + 1, candidate);
  return String(lastStreamEventId);
};

const writeStreamEvent = (res, eventName, payload, eventId = '') => {
  const idLine = eventId ? `id: ${eventId}\n` : '';
  res.write(`${idLine}event: ${eventName}\ndata: ${JSON.stringify(stripInlinePayloads(payload))}\n\n`);
};

const canReceiveBufferedEvent = (event, login) => (
  !Array.isArray(event.recipients)
  || event.recipients.some((recipient) => isSameLogin(recipient, login))
);

const publishStreamEvent = (eventName, payload, { recipients = null, excludeLogin = '' } = {}) => {
  const event = {
    id: nextStreamEventId(),
    name: eventName,
    payload: stripInlinePayloads(payload),
    recipients: Array.isArray(recipients) ? recipients : null,
    excludeLogin: String(excludeLogin || '').trim().toLowerCase()
  };
  streamEventBuffer.push(event);
  if (streamEventBuffer.length > STREAM_EVENT_BUFFER_SIZE) streamEventBuffer.shift();

  streamClients.forEach((client) => {
    if (!canReceiveBufferedEvent(event, client.login) || isSameLogin(event.excludeLogin, client.login)) return;
    try {
      writeStreamEvent(client.res, event.name, event.payload, event.id);
    } catch {
      streamClients.delete(client);
    }
  });
  return event.id;
};

const broadcastThreadEvent = (eventName, conversationId, payload = {}, options = {}) => (
  publishStreamEvent(
    eventName,
    { conversationId, ...payload },
    {
      ...options,
      recipients: getParticipantsFromConversationId(conversationId)
    }
  )
);

const broadcastFeedEvent = (eventName, payload = {}) => publishStreamEvent(eventName, payload);

const persistThreadsSnapshot = async (threads) => {
  const nextThreads = cloneThreads(threads);
  await ensureStorage();
  await atomicWriteJson(chatFilePath, nextThreads);
  cachedThreads = cloneThreads(nextThreads);
};

const threadMutationQueue = createSerialMutationQueue({
  read: readThreadsFromDisk,
  write: persistThreadsSnapshot
});

const writeThreads = async (threads) => {
  const nextThreads = cloneThreads(threads);
  return threadMutationQueue.replace(nextThreads, (next, current) => {
    if (Object.keys(next).length === 0 && Object.keys(current).length > 0) {
      throw new Error('Защита чата: отказано в перезаписи непустой истории пустым объектом');
    }
  });
};

const mutateThreads = async (mutator) => threadMutationQueue.mutate(async (threads) => {
  const nextThreads = await mutator(cloneThreads(threads));
  return cloneThreads(nextThreads);
});

let journalQueue = Promise.resolve();
const appendMessageJournal = (entry) => {
  journalQueue = journalQueue.catch(() => {}).then(async () => {
    const journalDir = path.join(backupDir, 'message-journal');
    await fs.mkdir(journalDir, { recursive: true });
    await fs.appendFile(path.join(journalDir, `${new Date().toISOString().slice(0, 10)}.jsonl`),
      JSON.stringify({ ...entry, recordedAt: new Date().toISOString() }) + '\n');
  });
  journalQueue.catch(error => console.error('Chat recovery journal failed:', error.message));
  return journalQueue;
};
const backupMessageToArchive = (conversationId, message) => appendMessageJournal({ conversationId, message });

const removeArchiveConversation = async (conversationId) => {
  // Recovery scans purge markers before replaying any old messages or snapshots.
  await appendMessageJournal({ action: 'purge', conversationId });
  await mutateThreads((threads) => {
    delete threads[conversationId];
    return threads;
  });
};

let archiveMigrationPromise = null;

const runWithConcurrency = async (items, worker, concurrency = 2) => {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
};

const insertRowsInChunks = async (sql, rows = [], chunkSize = 500) => {
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    if (!chunk.length) continue;
    const [result] = await db.query(sql, [chunk]);
    inserted += Number(result?.affectedRows) || 0;
  }
  return inserted;
};

const repairStoredRecordFileLinks = async () => {
  if (
    !await ensureChatSqlSchema()
    || !await ensureChatFilesSqlSchema()
    || !await ensureFeedSqlSchema()
  ) {
    throw new Error('Хранилище чата, ленты или файлов недоступно');
  }

  const [fileRows] = await db.execute('SELECT id FROM chat_files WHERE deleted_at IS NULL');
  const storedFileIds = new Set((fileRows || []).map((row) => String(row.id || '')).filter(Boolean));
  const missingFileIds = new Set();
  const chatLinks = new Map();
  const feedLinks = new Map();

  const collectChatMessage = (conversationId, message) => {
    if (!conversationId || !message?.id) return;
    const [participantA = '', participantB = ''] = getParticipantsFromConversationId(conversationId);
    if (!participantA || !participantB) return;
    getMessageAttachmentFileIds(message).forEach((fileId) => {
      if (!storedFileIds.has(fileId)) {
        missingFileIds.add(fileId);
        return;
      }
      const key = `${message.id}\u0000${fileId}`;
      chatLinks.set(key, [message.id, fileId, conversationId, participantA, participantB]);
    });
  };

  const collectFeedPost = (postId, post) => {
    if (!postId || !post) return;
    getFeedAttachmentsFromPost(post).map(getAttachmentFileId).filter(Boolean).forEach((fileId) => {
      if (!storedFileIds.has(fileId)) {
        missingFileIds.add(fileId);
        return;
      }
      feedLinks.set(`${postId}\u0000${fileId}`, [postId, fileId]);
    });
  };

  const [[messageRows], [versionRows], [postRows], threads, archivedFeed] = await Promise.all([
    db.execute('SELECT id, conversation_id, message_json FROM chat_messages'),
    db.execute('SELECT message_id, conversation_id, snapshot_json FROM chat_message_versions'),
    db.execute('SELECT id, post_json FROM feed_posts'),
    readThreads(),
    readFeed()
  ]);

  (messageRows || []).forEach((row) => {
    const message = parseSqlMessage(row.message_json);
    if (message && !message.id) message.id = row.id;
    collectChatMessage(row.conversation_id, message);
  });
  (versionRows || []).forEach((row) => {
    const message = parseSqlMessage(row.snapshot_json);
    if (message && !message.id) message.id = row.message_id;
    collectChatMessage(row.conversation_id, message);
  });
  Object.entries(threads || {}).forEach(([conversationId, messages]) => {
    (Array.isArray(messages) ? messages : []).forEach((message) => collectChatMessage(conversationId, message));
  });
  (postRows || []).forEach((row) => collectFeedPost(row.id, parseSqlJson(row.post_json)));
  (Array.isArray(archivedFeed) ? archivedFeed : []).forEach((post) => collectFeedPost(post?.id, post));

  const insertedChatLinks = await insertRowsInChunks(
    `INSERT IGNORE INTO chat_message_files
     (message_id, file_id, conversation_id, participant_a, participant_b)
     VALUES ?`,
    [...chatLinks.values()]
  );
  const insertedFeedLinks = await insertRowsInChunks(
    'INSERT IGNORE INTO feed_post_files (post_id, file_id) VALUES ?',
    [...feedLinks.values()]
  );

  const [retainedResult] = await db.execute(
    `UPDATE chat_files AS files
     SET files.claimed_at = COALESCE(files.claimed_at, NOW()),
         files.retention_state = 'retained',
         files.retained_at = COALESCE(files.retained_at, NOW()),
         files.relative_path = COALESCE(NULLIF(files.relative_path, ''), CONCAT(files.scope, '/', files.stored_name))
     WHERE files.deleted_at IS NULL
       AND (
         EXISTS (SELECT 1 FROM chat_message_files AS chat_links WHERE chat_links.file_id = files.id)
         OR EXISTS (SELECT 1 FROM feed_post_files AS feed_links WHERE feed_links.file_id = files.id)
       )`
  );

  return {
    scannedMessages: (messageRows || []).length,
    scannedVersions: (versionRows || []).length,
    scannedFeedPosts: (postRows || []).length,
    discoveredChatLinks: chatLinks.size,
    discoveredFeedLinks: feedLinks.size,
    insertedChatLinks,
    insertedFeedLinks,
    retainedFiles: Number(retainedResult?.affectedRows) || 0,
    missingFileIds: [...missingFileIds]
  };
};

const migrateArchiveToMysql = async () => {
  if (archiveMigrationPromise) return archiveMigrationPromise;

  archiveMigrationPromise = (async () => {
    let migratedFiles = 0;
    if (await ensureChatFilesSqlSchema()) {
      const [legacyColumns] = await db.execute("SHOW COLUMNS FROM chat_files LIKE 'file_data'");
      const [fileRows] = legacyColumns.length ? await db.execute(
        `SELECT id, scope, stored_name, metadata_json, file_data, thumbnail_data
         FROM chat_files
         WHERE deleted_at IS NULL
           AND (file_data IS NOT NULL OR thumbnail_data IS NOT NULL)`
      ) : [[]];
      await runWithConcurrency(fileRows || [], async (row) => {
        const scope = ALLOWED_UPLOAD_SCOPES.has(row.scope) ? row.scope : 'chat';
        const uploadDir = path.join(uploadsDir, scope);
        await fs.mkdir(uploadDir, { recursive: true });
        const metadata = parseFileMetadataJson(row.metadata_json);
        const payloads = [
          { name: row.stored_name, data: getSqlPayloadBuffer(row.file_data) },
          { name: metadata.thumbnailStoredName, data: getSqlPayloadBuffer(row.thumbnail_data) }
        ];
        await Promise.all(payloads.map(async ({ name, data }) => {
          if (!name || !data?.length) return;
          const safeName = path.basename(name);
          const targetPath = path.join(uploadDir, safeName);
          await fs.access(targetPath).catch(async () => {
            await fs.writeFile(targetPath, data);
            migratedFiles += 1;
          });
        }));
        // Old deployments may still have a copy in MySQL. Once both artifacts
        // are on disk, release the BLOBs so the database contains metadata only.
        if (legacyColumns.length) await db.execute(
          'UPDATE chat_files SET file_data = NULL, thumbnail_data = NULL WHERE id = ?',
          [row.id]
        );
      });
    }

    const [threads, posts] = await Promise.all([readThreads(), readFeed()]);
    const purgedConversations = await getJournalPurgeBoundaries();
    for (const conversationId of purgedConversations.keys()) delete threads[conversationId];
    const migratedThreads = cloneThreads(threads);
    const messages = Object.entries(threads || {}).flatMap(([conversationId, items]) => (
      (Array.isArray(items) ? items : [])
        .filter((message) => message?.id)
        .map((message) => ({ conversationId, message }))
    ));
    const feedPosts = (Array.isArray(posts) ? posts : []).filter((post) => post?.id);

    await runWithConcurrency(messages, async ({ conversationId, message }) => {
      const preparedMessage = (await prepareMessageForResponse(message)).message;
      await writeSqlMessage(conversationId, preparedMessage, { insertOnly: true });
      const items = Array.isArray(migratedThreads[conversationId]) ? migratedThreads[conversationId] : [];
      migratedThreads[conversationId] = items.map((item) => (
        item?.id === preparedMessage.id ? preparedMessage : item
      ));
    });
    if (messages.length) await writeThreads(migratedThreads);

    const [sqlMessageRows] = await db.execute(
      'SELECT conversation_id, message_json FROM chat_messages'
    );
    await runWithConcurrency(sqlMessageRows || [], async (row) => {
      const message = parseSqlMessage(row.message_json);
      if (message?.id && row.conversation_id) {
        const preparedMessage = (await prepareMessageForResponse(message)).message;
        await writeSqlMessage(row.conversation_id, preparedMessage);
      }
    });

    await runWithConcurrency(feedPosts, async (post) => {
      await writeSqlFeedPost(post);
      await runWithConcurrency((post.comments || []).filter((comment) => comment?.id), (comment) => writeSqlFeedComment(post.id, comment), 2);
      const reactions = Object.entries(post.reactions || {}).flatMap(([emoji, logins]) => (
        [...new Set(Array.isArray(logins) ? logins : [])]
          .filter(Boolean)
          .map((login) => ({ emoji, login }))
      ));
      await runWithConcurrency(reactions, ({ emoji, login }) => setSqlFeedReaction(post.id, emoji, login, true), 2);
    });

    await replayMessageJournal();
    const linkRepair = await repairStoredRecordFileLinks();
    if (migratedFiles || messages.length || feedPosts.length || linkRepair.insertedChatLinks || linkRepair.insertedFeedLinks) {
      console.log(`MySQL archive migration completed: ${messages.length} archived messages, ${(sqlMessageRows || []).length} indexed messages, ${feedPosts.length} feed posts, ${migratedFiles} stored files, ${linkRepair.insertedChatLinks} repaired chat links, ${linkRepair.insertedFeedLinks} repaired feed links.`);
    }
  })().catch((error) => {
    archiveMigrationPromise = null;
    throw error;
  });

  return archiveMigrationPromise;
};



const readJournalEntries = async function* () {
  const directory = path.join(backupDir, 'message-journal');
  const files = (await fs.readdir(directory).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  })).filter(file => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)).sort();
  for (const file of files) {
    const lines = require('readline').createInterface({ input: fsSync.createReadStream(path.join(directory, file)), crlfDelay: Infinity });
    for await (const line of lines) if (line.trim()) yield JSON.parse(line);
  }
};
const getJournalPurgeBoundaries = async () => {
  await journalQueue;
  const boundaries = new Map();
  let position = 0;
  for await (const entry of readJournalEntries()) {
    if (entry.action === 'purge') boundaries.set(entry.conversationId, position);
    position += 1;
  }
  return boundaries;
};
const replayMessageJournal = async () => {
  const purged = await getJournalPurgeBoundaries();
  let restored = 0;
  let position = 0;
  for await (const entry of readJournalEntries()) {
    const entryPosition = position++;
    if (!entry.message?.id || !entry.conversationId || entryPosition <= (purged.get(entry.conversationId) ?? -1)) continue;
    const current = await readSqlMessageById(entry.conversationId, entry.message.id);
    const timestamp = value => new Date(value?.updatedAt || value?.editedAt || value?.deletedAt || value?.createdAt || 0).getTime();
    if (current && timestamp(current) >= timestamp(entry.message)) continue;
    if (!await writeSqlMessage(entry.conversationId, entry.message)) throw new Error('Хранилище чата недоступно');
    restored += 1;
  }
  return restored;
};

router.post('/storage/recover', requireRole('admin'), async (req, res) => {
  try {
    const target = req.body?.target === 'threads' ? 'threads' : 'feed';
    const filePath = target === 'threads' ? chatFilePath : feedFilePath;
    const validate = target === 'threads' ? isPlainObject : Array.isArray;
    if (target === 'threads') {
      const purged = await getJournalPurgeBoundaries();
      const snapshot = await restoreJsonBackup(chatFilePath, isPlainObject);
      if (snapshot) {
        for (const [conversationId, messages] of Object.entries(snapshot)) {
          if (purged.has(conversationId) || !Array.isArray(messages)) continue;
          for (const message of messages) {
            if (!await readSqlMessageById(conversationId, message.id)) await writeSqlMessage(conversationId, message, { insertOnly: true });
          }
        }
        for (const conversationId of purged.keys()) delete snapshot[conversationId];
        await persistThreadsSnapshot(snapshot);
      }
      const count = await replayMessageJournal();
      return res.json({ message: 'Журнал восстановления обработан', target, count });
    }
    const restored = await restoreJsonBackup(filePath, validate);
    if (!restored) return res.status(404).json({ message: 'Резервная копия не найдена' });
    if (target === 'threads') cachedThreads = cloneThreads(restored);
    res.json({ message: 'Восстановлено из резервной копии', target, restored });
  } catch (error) {
    console.error('Chat storage recover error:', error);
    res.status(500).json({ message: 'Не удалось восстановить данные' });
  }
});


router.get('/files/:fileId/download', async (req, res) => {
  try {
    const fileId = decodeURIComponent(req.params.fileId || '').trim();
    if (!fileId) return res.status(400).json({ message: 'fileId обязателен' });

    let file;
    if (req.mediaAuth) {
      // Короткоживущий media-токен: привязан к конкретному fileId.
      if (req.mediaAuth.fileId !== fileId) {
        return res.status(403).json({ message: 'Нет прав на скачивание файла' });
      }
      file = await readSqlFileMetadata(fileId);
      if (!file || file.deleted_at) {
        const error = new Error('Файл не найден');
        error.status = 404;
        throw error;
      }
      if (file.is_verified === 0 || file.is_verified === false) {
        const error = new Error('Файл не прошёл проверку безопасности');
        error.status = 403;
        throw error;
      }
    } else {
      file = await ensureFileDownloadAccess(req, fileId);
    }

    const variant = req.query?.variant === 'thumbnail' ? 'thumbnail' : '';
    const download = resolveStoredDownload(file, variant);
    if (!download) return res.status(404).json({ message: 'Файл не найден' });
    // In development the React client is served from :3000 while protected
    // chat media is served from :5000. Helmet's default CORP header is
    // `same-origin`, so browsers create the image/video element but block its
    // response. Authentication above still protects the file; this header only
    // permits the authorized response to be embedded by the client origin.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Type', download.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(download.fileName)}"`);
    res.setHeader(
      'Cache-Control',
      variant === 'thumbnail'
        ? 'private, max-age=604800, immutable'
        : 'private, max-age=3600'
    );
    await fs.access(download.filePath).catch(() => {
      const error = new Error('Файл не найден. Выполните одноразовую миграцию хранилища.');
      error.status = 404;
      throw error;
    });
    await streamFileWithRange(req, res, download.filePath);
    return;
  } catch (error) {
    console.error('Chat GET /files/download error:', error.message);
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    res.status(error.status || 500).json({ message: error.message || 'Не удалось скачать файл' });
  }
});

// Выдача короткоживущего media-токена для скачивания конкретного файла.
// Позволяет клиенту использовать ?mt= вместо ?access_token= в URL файла.
router.post('/files/:fileId/media-token', async (req, res) => {
  try {
    const fileId = decodeURIComponent(req.params.fileId || '').trim();
    if (!fileId) return res.status(400).json({ message: 'fileId обязателен' });

    // Проверяем, что пользователь имеет право на скачивание файла.
    await ensureFileDownloadAccess(req, fileId);

    const scope = req.body?.scope === 'feed' ? 'feed' : 'chat';
    const token = createMediaToken({ fileId, scope });
    res.json({
      fileId,
      token,
      expiresInMs: MEDIA_TOKEN_TTL_MS,
      expiresAt: new Date(Date.now() + MEDIA_TOKEN_TTL_MS).toISOString()
    });
  } catch (error) {
    console.error('Chat POST /files/media-token error:', error.message);
    res.status(error.status || 500).json({ message: error.message || 'Не удалось выдать токен для файла' });
  }
});

router.post('/files/media-tokens', async (req, res) => {
  try {
    const ids = [...new Set(Array.isArray(req.body?.fileIds) ? req.body.fileIds : [])];
    if (ids.length > 100 || ids.some(id => typeof id !== 'string' || id.length > 128)) return res.sendStatus(400);
    const tokens = [];
    for (const fileId of ids) {
      try { const file = await ensureFileDownloadAccess(req, fileId);
        tokens.push({ fileId, token: createMediaToken({ fileId, scope: file.scope }), expiresAt: Date.now() + MEDIA_TOKEN_TTL_MS });
      } catch (error) { if (![403, 404].includes(error.status)) throw error; }
    }
    res.set('Cache-Control', 'no-store'); res.json({ tokens });
  } catch { res.status(503).json({ message: 'Файлы временно недоступны' }); }
});

router.post('/uploads', async (req, res) => {
  try {
    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      return res.status(415).json({ message: 'Используйте multipart/form-data для загрузки файлов' });
    }

    const file = await saveMultipartUpload(req);
    res.status(201).json({ file });
  } catch (error) {
    console.error('Chat POST /uploads error:', error.message);
    res.status(error.status || 500).json({ message: error.message || 'Не удалось загрузить файл' });
  }
});

router.delete('/uploads/:fileId', async (req, res) => {
  try {
    const fileId = decodeURIComponent(req.params.fileId || '').trim();
    if (!fileId) return res.status(400).json({ message: 'fileId обязателен' });
    const file = await readSqlFileMetadata(fileId);
    if (!file || file.deleted_at) return res.status(404).json({ message: 'Файл не найден' });
    if (!isSameLogin(file.uploaded_by, req.auth.login)) {
      return res.status(403).json({ message: 'Удалять загрузку может только её автор' });
    }
    if (await hasIndexedChatFileAccess(fileId, req.auth.login) || await findFeedFileReference(file)) {
      return res.status(409).json({ message: 'Файл уже прикреплён к сообщению' });
    }
    await deleteStoredFileArtifacts(file);
    res.status(204).end();
  } catch (error) {
    console.error('Chat DELETE /uploads error:', error);
    res.status(500).json({ message: 'Не удалось удалить загрузку' });
  }
});

const orphanCleanupTimer = setInterval(() => {
  cleanupOrphanChatUploads().catch((error) => {
    console.warn('Chat orphan upload cleanup failed:', error.message);
  });
}, 60 * 60 * 1000);
orphanCleanupTimer.unref?.();

router.get('/feed', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query?.limit)) || 25));
    const commentsLimit = Math.min(5, Math.max(2, Number(req.query?.commentsLimit) || 3));
    const cursor = String(req.query?.cursor || '').trim();
    const before = req.query?.before || '';
    const posts = await readSqlFeedPosts({ limit, cursor, before, commentsLimit });
    if (!Array.isArray(posts)) {
      return res.status(503).json({ message: 'Хранилище ленты временно недоступно' });
    }
    const lastPost = posts[posts.length - 1] || null;
    const nextCursor = lastPost ? encodeFeedCursor(lastPost) : '';
    res.set('Cache-Control', 'no-store');
    res.json({
      posts,
      pageSize: limit,
      cursor: nextCursor,
      before: lastPost?.createdAt || '',
      hasMore: posts.length >= limit,
      storage: 'mysql'
    });
  } catch (error) {
    console.error('Chat GET /feed error:', error);
    res.status(error.status || 500).json({
      message: error.status === 400 ? error.message : 'Не удалось загрузить ленту'
    });
  }
});

const mutateFeed = async (mutator) => {
  return feedMutationQueue.mutate(mutator);
};

const backupFeedMutation = (mutator) => {
  mutateFeed(mutator).catch((error) => {
    console.warn('Feed JSON backup write failed:', error.message);
  });
};

const getAuthenticatedActor = async (req) => {
  const [rows] = await db.execute(
    'SELECT login, full_name, role FROM users WHERE LOWER(login) = ? LIMIT 1',
    [req.auth.login]
  );
  const user = rows?.[0] || {};
  return {
    login: req.auth.login,
    role: req.auth.role,
    name: user.full_name || user.login || req.auth.login
  };
};

const mergeActorReactionState = (currentReactions = {}, requestedReactions = {}, actorLogin = '') => {
  const result = {};
  const emojis = new Set([
    ...Object.keys(currentReactions || {}),
    ...Object.keys(requestedReactions || {})
  ]);

  emojis.forEach((emoji) => {
    const currentUsers = new Set(Array.isArray(currentReactions?.[emoji]) ? currentReactions[emoji] : []);
    const requestedUsers = new Set(Array.isArray(requestedReactions?.[emoji]) ? requestedReactions[emoji] : []);
    if (requestedUsers.has(actorLogin)) currentUsers.add(actorLogin);
    else currentUsers.delete(actorLogin);
    if (currentUsers.size) result[emoji] = [...currentUsers];
  });

  return result;
};

router.post('/feed/posts', async (req, res) => {
  try {
    const now = new Date().toISOString();
    const actor = await getAuthenticatedActor(req);
    const post = {
      id: createId('post'),
      author: actor.login,
      authorName: actor.name,
      text: String(req.body?.text || '').trim(),
      category: req.body?.category || 'Объявление',
      pinned: hasRole(req, 'admin', 'manager') && Boolean(req.body?.pinned),
      attachment: req.body?.attachment || null,
      attachments: Array.isArray(req.body?.attachments) ? req.body.attachments.filter(Boolean) : (req.body?.attachment ? [req.body.attachment] : []),
      reactions: {},
      createdAt: now,
      updatedAt: now,
      comments: []
    };

    if (!post.text && !post.attachments.length) {
      return res.status(400).json({ message: 'text или attachment обязателен' });
    }

    post.attachments = await validateClientAttachments(req, post);
    post.attachment = post.attachments[0] || null;
    if (!await writeSqlFeedPost(post)) {
      return res.status(503).json({ message: 'Хранилище ленты временно недоступно' });
    }
    backupFeedMutation((items) => [post, ...items.filter((item) => item.id !== post.id)]);
    broadcastFeedEvent('feed-post-created', { post });
    res.status(201).json({ message: 'Публикация создана', post });
  } catch (error) {
    console.error('Chat POST /feed/posts error:', error);
    res.status(500).json({ message: 'Не удалось создать публикацию' });
  }
});

router.delete('/feed/posts/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const deletedBy = req.auth.login;
    const now = new Date().toISOString();
    const currentPost = await readSqlFeedPost(postId);
    if (!currentPost) return res.status(404).json({ message: 'Публикация не найдена' });
    if (!canManageFeedRecord(req.auth, currentPost)) {
      return res.status(403).json({ message: 'Нет прав на удаление этой публикации' });
    }
    const deletedPost = { ...currentPost, deletedAt: now, deletedBy, updatedAt: now };
    if (!await writeSqlFeedPost(deletedPost)) {
      return res.status(503).json({ message: 'Хранилище ленты временно недоступно' });
    }
    backupFeedMutation((items) => items.map((post) => (post.id === postId ? deletedPost : post)));
    broadcastFeedEvent('feed-post-deleted', { postId, deletedAt: now, deletedBy });
    res.json({
      message: 'Публикация удалена',
      postId,
      deletedAt: deletedPost.deletedAt,
      deletedBy: deletedPost.deletedBy,
      alreadyDeleted: false,
      post: { id: deletedPost.id, deletedAt: deletedPost.deletedAt, deletedBy: deletedPost.deletedBy }
    });
  } catch (error) {
    console.error('Chat DELETE /feed/posts error:', error);
    res.status(500).json({ message: 'Не удалось удалить публикацию' });
  }
});

router.patch('/feed/posts/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const patch = req.body || {};
    const now = new Date().toISOString();
    const currentPost = await readSqlFeedPost(postId);
    if (!currentPost) return res.status(404).json({ message: 'Публикация не найдена' });
    if (!canManageFeedRecord(req.auth, currentPost)) {
      return res.status(403).json({ message: 'Нет прав на изменение этой публикации' });
    }
    const updatedPost = {
      ...currentPost,
      text: Object.prototype.hasOwnProperty.call(patch, 'text') ? String(patch.text || '').trim() : currentPost.text,
      category: Object.prototype.hasOwnProperty.call(patch, 'category') ? String(patch.category || 'Объявление') : currentPost.category,
      id: currentPost.id,
      author: currentPost.author,
      authorName: currentPost.authorName,
      updatedAt: now,
      audit: [
        ...(Array.isArray(currentPost.audit) ? currentPost.audit : []),
        { action: 'edit', by: req.auth.login, role: req.auth.role, at: now }
      ]
    };
    if (Array.isArray(patch.attachments)) {
      updatedPost.attachments = patch.attachments.filter(Boolean);
      updatedPost.attachment = updatedPost.attachments[0] || null;
    }
    updatedPost.attachments = await validateClientAttachments(req, updatedPost);
    updatedPost.attachment = updatedPost.attachments[0] || null;
    if (!await writeSqlFeedPost(updatedPost)) {
      return res.status(503).json({ message: 'Хранилище ленты временно недоступно' });
    }
    backupFeedMutation((items) => items.map((post) => (post.id === postId ? updatedPost : post)));
    const publicPost = { ...updatedPost, comments: undefined, reactions: undefined };
    broadcastFeedEvent('feed-post-updated', { post: publicPost });
    res.json({ message: 'Публикация обновлена', post: publicPost });
  } catch (error) {
    console.error('Chat PATCH /feed/posts error:', error);
    res.status(500).json({ message: 'Не удалось обновить публикацию' });
  }
});

router.get('/feed/posts/:postId/comments', async (req, res) => {
  try {
    const { postId } = req.params;
    const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query?.limit)) || 20));
    const before = req.query?.before || '';
    const post = await readSqlFeedPost(postId);
    if (!post) return res.status(404).json({ message: 'Публикация не найдена' });
    const comments = await readSqlFeedComments(postId, { limit, before });
    if (!Array.isArray(comments)) {
      return res.status(503).json({ message: 'Хранилище ленты временно недоступно' });
    }
    const [counts] = await Promise.all([countSqlFeedComments([postId])]);
    res.set('Cache-Control', 'no-store');
    res.json({
      postId,
      comments,
      before: comments[0]?.createdAt || '',
      hasMore: Number(counts[postId]) > comments.length,
      storage: 'mysql'
    });
  } catch (error) {
    console.error('Chat GET /feed/comments error:', error);
    res.status(500).json({ message: 'Не удалось загрузить комментарии' });
  }
});

router.post('/feed/posts/:postId/comments', async (req, res) => {
  try {
    const { postId } = req.params;
    const now = new Date().toISOString();
    const actor = await getAuthenticatedActor(req);
    const comment = {
      id: createId('comment'),
      author: actor.login,
      authorName: actor.name,
      text: String(req.body?.text || '').trim(),
      createdAt: now,
      updatedAt: now
    };

    if (!comment.text) return res.status(400).json({ message: 'text обязателен' });

    const currentPost = await readSqlFeedPost(postId);
    if (!currentPost) return res.status(404).json({ message: 'Публикация не найдена' });
    if (!await writeSqlFeedComment(postId, comment)) {
      return res.status(503).json({ message: 'Хранилище ленты временно недоступно' });
    }
    const counts = await countSqlFeedComments([postId]);
    const updatedPost = {
      ...currentPost,
      commentCount: counts[postId] || 0,
      updatedAt: now
    };
    backupFeedMutation((items) => items.map((post) => {
      if (post.id !== postId) return post;
      const comments = [...(post.comments || []).filter((item) => item.id !== comment.id), comment];
      return { ...post, comments, commentCount: updatedPost.commentCount, updatedAt: now };
    }));
    broadcastFeedEvent('feed-comment-created', {
      postId,
      comment,
      commentCount: updatedPost.commentCount,
      updatedAt: now
    });
    res.status(201).json({
      message: 'Комментарий добавлен',
      postId,
      comment,
      post: { id: updatedPost.id, commentCount: updatedPost.commentCount, updatedAt: updatedPost.updatedAt }
    });
  } catch (error) {
    console.error('Chat POST /feed/posts/:postId/comments error:', error);
    res.status(500).json({ message: 'Не удалось добавить комментарий' });
  }
});

router.delete('/feed/posts/:postId/comments/:commentId', async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const deletedBy = req.auth.login;
    const now = new Date().toISOString();
    const currentPost = await readSqlFeedPost(postId);
    if (!currentPost) return res.status(404).json({ message: 'Публикация не найдена' });
    const existingComment = await readSqlFeedComment(postId, commentId);
    if (!existingComment) return res.status(404).json({ message: 'Комментарий не найден' });
    if (!canManageFeedRecord(req.auth, existingComment)) {
      return res.status(403).json({ message: 'Нет прав на удаление этого комментария' });
    }
    const alreadyDeleted = Boolean(existingComment.deletedAt);
    const deletedComment = alreadyDeleted
      ? existingComment
      : { ...existingComment, deletedAt: now, deletedBy, updatedAt: now };
    if (!alreadyDeleted && !await writeSqlFeedComment(postId, deletedComment)) {
      return res.status(503).json({ message: 'Хранилище ленты временно недоступно' });
    }
    const counts = await countSqlFeedComments([postId]);
    const updatedPost = { ...currentPost, commentCount: counts[postId] || 0, updatedAt: now };
    backupFeedMutation((items) => items.map((post) => {
      if (post.id !== postId) return post;
      const comments = (post.comments || []).map((comment) => (
        comment.id === commentId ? deletedComment : comment
      ));
      return { ...post, comments, commentCount: updatedPost.commentCount, updatedAt: now };
    }));
    broadcastFeedEvent('feed-comment-deleted', {
      postId,
      commentId,
      deletedAt: deletedComment.deletedAt,
      deletedBy: deletedComment.deletedBy,
      commentCount: updatedPost.commentCount,
      updatedAt: now
    });
    res.json({
      message: 'Комментарий удалён',
      postId,
      commentId,
      deletedAt: deletedComment?.deletedAt || now,
      deletedBy: deletedComment?.deletedBy || deletedBy,
      alreadyDeleted,
      post: { id: updatedPost.id, commentCount: updatedPost.commentCount, updatedAt: updatedPost.updatedAt }
    });
  } catch (error) {
    console.error('Chat DELETE /feed/comments error:', error);
    res.status(500).json({ message: 'Не удалось удалить комментарий' });
  }
});

router.post('/feed/posts/:postId/reactions', async (req, res) => {
  try {
    const { postId } = req.params;
    const emoji = String(req.body?.emoji || '').trim();
    const login = req.auth.login;
    if (!emoji) return res.status(400).json({ message: 'emoji обязателен' });

    const currentPost = await readSqlFeedPost(postId);
    if (!currentPost) return res.status(404).json({ message: 'Публикация не найдена' });
    const now = new Date().toISOString();
    const currentReactions = await readSqlFeedReactions([postId]);
    const currentUsers = new Set(currentReactions[postId]?.[emoji] || []);
    const active = typeof req.body?.active === 'boolean' ? req.body.active : !currentUsers.has(login);
    if (!await setSqlFeedReaction(postId, emoji, login, active)) {
      return res.status(503).json({ message: 'Хранилище ленты временно недоступно' });
    }
    const nextReactions = await readSqlFeedReactions([postId]);
    const reactions = nextReactions[postId] || {};
    backupFeedMutation((items) => items.map((post) => (
      post.id === postId ? { ...post, reactions, updatedAt: now } : post
    )));
    broadcastFeedEvent('feed-reaction-updated', { postId, emoji, login, active, reactions, updatedAt: now });
    res.json({
      message: 'Реакция обновлена',
      postId,
      emoji,
      login,
      active,
      reactions,
      updatedAt: now
    });
  } catch (error) {
    console.error('Chat POST /feed/reactions error:', error);
    res.status(500).json({ message: 'Не удалось обновить реакцию' });
  }
});

router.post('/feed/posts/:postId/pin', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { postId } = req.params;
    const pinned = Boolean(req.body?.pinned);
    const now = new Date().toISOString();
    const currentPost = await readSqlFeedPost(postId);
    if (!currentPost) return res.status(404).json({ message: 'Публикация не найдена' });
    const updatedPost = { ...currentPost, pinned, updatedAt: now };
    if (!await writeSqlFeedPost(updatedPost)) {
      return res.status(503).json({ message: 'Хранилище ленты временно недоступно' });
    }
    backupFeedMutation((items) => items.map((post) => (post.id === postId ? updatedPost : post)));
    broadcastFeedEvent('feed-pin-updated', { postId, pinned, updatedAt: now });
    res.json({ message: 'Закрепление обновлено', post: { id: updatedPost.id, pinned: updatedPost.pinned, updatedAt: updatedPost.updatedAt } });
  } catch (error) {
    console.error('Chat POST /feed/pin error:', error);
    res.status(500).json({ message: 'Не удалось закрепить публикацию' });
  }
});

router.get('/threads/unread-count', async (req, res) => {
  try {
    const login = getRequestLogin(req);
    if (!login) return res.status(401).json({ message: 'Для загрузки диалогов требуется вход' });
    if (!await ensureChatSqlSchema()) {
      return res.json({ count: 0 });
    }
    const summaries = await readSqlThreadSummaries(login);
    const count = Object.values(summaries || {}).reduce((sum, item) => sum + item.unreadCount, 0);
    res.set('Cache-Control', 'no-store');
    res.json({ count });
  } catch (error) {
    console.error('Chat GET /threads/unread-count error:', error);
    res.status(500).json({ message: 'Не удалось подсчитать непрочитанные сообщения' });
  }
});

router.post('/threads/read-all', async (req, res) => {
  try {
    const login = getRequestLogin(req);
    if (!login) return res.status(401).json({ message: 'Для загрузки диалогов требуется вход' });
    if (!await ensureChatSqlSchema()) {
      return res.json({ message: 'ok' });
    }
    await db.execute(
      `INSERT INTO chat_read_state (conversation_id, user_login, last_read_message_id, last_read_at)
       SELECT conversation_id, ?, '', NOW()
       FROM chat_messages
       WHERE participant_a = ? OR participant_b = ?
       GROUP BY conversation_id
       ON DUPLICATE KEY UPDATE
         last_read_at = NOW(),
         updated_at = CURRENT_TIMESTAMP`,
      [login, login, login]
    );
    res.json({ message: 'Все диалоги отмечены прочитанными' });
  } catch (error) {
    console.error('Chat POST /threads/read-all error:', error);
    res.status(500).json({ message: 'Не удалось отметить сообщения прочитанными' });
  }
});

router.get('/threads', async (req, res) => {
  try {
    const login = getRequestLogin(req);
    if (!login) return res.status(401).json({ message: 'Для загрузки диалогов требуется вход' });

    const [sqlSummaries, readStates] = await Promise.all([
      readSqlThreadSummaries(login),
      readSqlReadStates(login)
    ]);
    if (!sqlSummaries) {
      return res.status(503).json({ message: 'Хранилище сообщений временно недоступно' });
    }
    const summaries = Object.fromEntries(
      Object.entries(sqlSummaries).map(([conversationId, summary]) => [
        conversationId,
        { ...summary, lastMessage: sanitizeMessageForResponse(summary.lastMessage) }
      ])
    );

    res.set('Cache-Control', 'no-store');
    res.json({ summaries, readStates, storage: 'mysql' });
  } catch (error) {
    console.error('Chat GET /threads error:', error);
    res.status(500).json({ message: 'Не удалось загрузить сообщения' });
  }
});

router.get('/threads/:conversationId/search', async (req, res) => {
  try {
    const conversationId = decodeURIComponent(req.params.conversationId || '').trim();
    if (!conversationId) return res.status(400).json({ message: 'conversationId обязателен' });
    if (!requireConversationAccess(req, res, conversationId)) return;
    if (!hasRole(req, 'admin') && await isSqlConversationArchived(conversationId)) {
      return res.status(403).json({ message: 'Переписка находится в архиве администратора' });
    }
    const query = String(req.query?.q || '').trim();
    if (query.length < 2) {
      return res.status(400).json({ message: 'Для поиска введите минимум два символа' });
    }
    const limit = Math.min(50, Math.max(1, Math.floor(Number(req.query?.limit)) || CHAT_SEARCH_PAGE_SIZE));
    const messages = await searchSqlConversationMessages(conversationId, {
      query,
      limit,
      before: req.query?.before || ''
    });
    if (!Array.isArray(messages)) {
      return res.status(503).json({ message: 'Хранилище сообщений временно недоступно' });
    }
    const before = messages.length ? encodeMessageCursor(messages[messages.length - 1]) : '';
    res.set('Cache-Control', 'no-store');
    res.json({
      conversationId,
      query,
      messages: stripInlinePayloads(messages),
      before,
      hasMore: messages.length >= limit
    });
  } catch (error) {
    console.error('Chat GET /threads/search error:', error);
    res.status(error.status || 500).json({
      message: error.status === 400 ? error.message : 'Не удалось выполнить поиск по переписке'
    });
  }
});

router.get('/threads/:conversationId/date', async (req, res) => {
  try {
    const conversationId = decodeURIComponent(req.params.conversationId || '').trim();
    const date = String(req.query?.date || '').trim();
    if (!conversationId) return res.status(400).json({ message: 'conversationId обязателен' });
    if (!requireConversationAccess(req, res, conversationId)) return;
    if (!hasRole(req, 'admin') && await isSqlConversationArchived(conversationId)) {
      return res.status(403).json({ message: 'Переписка находится в архиве администратора' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'Дата должна быть в формате YYYY-MM-DD' });
    }
    const limit = Math.min(200, Math.max(1, Math.floor(Number(req.query?.limit)) || CHAT_SQL_PAGE_SIZE));
    if (!await ensureChatSqlSchema()) {
      return res.status(503).json({ message: 'Хранилище сообщений временно недоступно' });
    }
    const [rows] = await db.query(
      `SELECT message_json
       FROM chat_messages
       WHERE conversation_id = ?
         AND created_at >= CONCAT(?, ' 00:00:00')
         AND created_at < DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 1 DAY)
       ORDER BY created_at ASC, id ASC
       LIMIT ${limit}`,
      [conversationId, date, date]
    );
    const messages = (rows || [])
      .map((row) => parseSqlMessage(row.message_json))
      .filter(Boolean)
      .map((message) => sanitizeMessageForResponse(message));
    res.set('Cache-Control', 'no-store');
    res.json({ conversationId, date, messages, hasMore: messages.length >= limit });
  } catch (error) {
    console.error('Chat GET /threads/date error:', error);
    res.status(500).json({ message: 'Не удалось перейти к выбранной дате' });
  }
});

router.post('/threads/:conversationId/sync', async (req, res) => {
  try {
    const conversationId = req.params.conversationId;
    if (!requireConversationAccess(req, res, conversationId)) return;
    if (!hasRole(req, 'admin') && await isSqlConversationArchived(conversationId)) return res.json({ messages: [], removedIds: req.body?.ids || [] });
    const ids = [...new Set(Array.isArray(req.body?.ids) ? req.body.ids : [])];
    if (ids.length > 200 || ids.some(id => typeof id !== 'string' || id.length > 128)) return res.sendStatus(400);
    if (!await ensureChatSqlSchema()) return res.sendStatus(503);
    if (!ids.length) return res.json({ messages: [], removedIds: [] });
    const [rows] = await db.query('SELECT id, message_json FROM chat_messages WHERE conversation_id = ? AND id IN (?)', [conversationId, ids]);
    const found = new Set(rows.map(row => row.id));
    res.json({ messages: rows.map(row => sanitizeMessageForResponse(parseSqlMessage(row.message_json))), removedIds: ids.filter(id => !found.has(id)) });
  } catch { res.status(503).json({ message: 'Не удалось сверить переписку' }); }
});

router.get('/threads/:conversationId/messages', async (req, res) => {
  try {
    const conversationId = decodeURIComponent(req.params.conversationId || '').trim();
    if (!conversationId) return res.status(400).json({ message: 'conversationId обязателен' });
    if (!requireConversationAccess(req, res, conversationId)) return;
    if (!hasRole(req, 'admin') && await isSqlConversationArchived(conversationId)) {
      res.set('Cache-Control', 'no-store');
      return res.json({ conversationId, messages: [], hasMore: false, archived: true, storage: 'mysql' });
    }
    const limit = Math.min(200, Math.max(1, Math.floor(Number(req.query?.limit)) || CHAT_SQL_PAGE_SIZE));
    const before = req.query?.before || '';
    const messages = await readSqlConversationMessages(conversationId, { limit, before });
    if (!Array.isArray(messages)) {
      return res.status(503).json({ message: 'Хранилище сообщений временно недоступно' });
    }
    const includeRetainedContent = req.query?.includeDeletedContent === '1' && hasRole(req, 'admin');
    const responseMessages = includeRetainedContent
      ? await hydrateRetainedDeletedMessages(conversationId, messages)
      : messages;
    const publicMessages = responseMessages.map((message) => sanitizeMessageForResponse(message, {
      includeRetainedContent
    }));
    const earliest = messages.length ? encodeMessageCursor(messages[0]) : '';
    res.set('Cache-Control', 'no-store');
    res.json({
      conversationId,
      messages: publicMessages,
      hasMore: messages.length >= limit,
      before: earliest,
      storage: 'mysql',
      includesRetainedDeletedContent: includeRetainedContent
    });
  } catch (error) {
    console.error('Chat GET /threads/messages error:', {
      code: error.code || 'CHAT_MESSAGES_QUERY_FAILED',
      message: error.message,
      conversationId: req.params.conversationId
    });
    res.status(error.status || 500).json({
      message: error.status === 400 ? error.message : 'Не удалось загрузить сообщения',
      code: error.code || 'CHAT_MESSAGES_QUERY_FAILED'
    });
  }
});

router.put('/threads/:conversationId/read', async (req, res) => {
  try {
    const conversationId = decodeURIComponent(req.params.conversationId || '').trim();
    const messageId = String(req.body?.messageId || '').trim().slice(0, 128);
    if (!conversationId || !messageId) {
      return res.status(400).json({ message: 'conversationId и messageId обязательны' });
    }
    if (!requireConversationAccess(req, res, conversationId)) return;
    const state = await writeSqlReadState(conversationId, req.auth.login, messageId);
    if (!state) return res.status(404).json({ message: 'Сообщение не найдено' });
    broadcastThreadEvent('read-state-updated', conversationId, { state });
    res.json({ state });
  } catch (error) {
    console.error('Chat PUT /threads/read error:', error);
    res.status(500).json({ message: 'Не удалось сохранить состояние прочтения' });
  }
});

router.post('/threads/:conversationId/typing', async (req, res) => {
  try {
    const conversationId = decodeURIComponent(req.params.conversationId || '').trim();
    if (!conversationId) return res.status(400).json({ message: 'conversationId обязателен' });
    if (!requireConversationAccess(req, res, conversationId)) return;
    const active = Boolean(req.body?.active);
    const timerKey = `${conversationId}::${req.auth.login}`;
    if (typingTimers.has(timerKey)) clearTimeout(typingTimers.get(timerKey));
    typingTimers.delete(timerKey);
    broadcastThreadEvent(
      'typing-updated',
      conversationId,
      { login: req.auth.login, active },
      { excludeLogin: req.auth.login }
    );
    if (active) {
      const timer = setTimeout(() => {
        typingTimers.delete(timerKey);
        broadcastThreadEvent(
          'typing-updated',
          conversationId,
          { login: req.auth.login, active: false },
          { excludeLogin: req.auth.login }
        );
      }, 5000);
      timer.unref?.();
      typingTimers.set(timerKey, timer);
    }
    res.status(204).end();
  } catch (error) {
    console.error('Chat POST /threads/typing error:', error);
    res.status(500).json({ message: 'Не удалось обновить индикатор набора' });
  }
});

router.get('/threads/stream', async (req, res) => {
  try {
    const login = getRequestLogin(req);
    if (!login) return res.status(401).json({ message: 'Для загрузки диалогов требуется вход' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    guardSessionStream(req, res);
    const lastEventId = String(req.headers['last-event-id'] || req.query?.last_event_id || '').trim();
    const numericLastEventId = Number(lastEventId) || 0;
    streamEventBuffer
      .filter((event) => Number(event.id) > numericLastEventId)
      .filter((event) => canReceiveBufferedEvent(event, login))
      .filter((event) => !isSameLogin(event.excludeLogin, login))
      .forEach((event) => writeStreamEvent(res, event.name, event.payload, event.id));
    writeStreamEvent(res, 'ready', {
      resync: true,
      connectedAt: new Date().toISOString(),
      lastEventId: String(lastStreamEventId)
    });
    const streamClient = { res, login };
    streamClients.add(streamClient);

    const heartbeat = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      streamClients.delete(streamClient);
    });
  } catch (error) {
    console.error('Chat GET /threads/stream error:', error);
    res.status(500).json({ message: 'Не удалось открыть поток сообщений' });
  }
});


router.post('/threads/:conversationId/messages', async (req, res) => {
  try {
    const conversationId = decodeURIComponent(req.params.conversationId || '').trim();
    const message = req.body?.message;

    if (!conversationId) {
      return res.status(400).json({ message: 'conversationId обязателен' });
    }
    if (!requireConversationAccess(req, res, conversationId)) return;
    if (!hasRole(req, 'admin') && await isSqlConversationArchived(conversationId)) {
      return res.status(409).json({ message: 'Переписка находится в архиве. Обратитесь к администратору.' });
    }

    if (!message || typeof message !== 'object' || !message.id) {
      return res.status(400).json({ message: 'message обязателен' });
    }
    const existingMessage = await readSqlMessageById(conversationId, String(message.id));
    if (existingMessage) {
      if (!isSameLogin(existingMessage.sender, req.auth.login)) return res.status(403).json({ message: 'Нельзя перезаписать чужое сообщение' });
      await writeSqlMessage(conversationId, existingMessage, { insertOnly: true });
      // A retry acknowledges the original operation; it never rewrites a later edit.
      return res.json({ conversationId, item: sanitizeMessageForResponse(existingMessage) });
    }
    const savedItem = await prepareClientMessage(req, conversationId, message);
    const stored = await writeSqlMessage(conversationId, savedItem, { insertOnly: true });
    if (!stored) return res.status(503).json({ message: 'Хранилище сообщений временно недоступно' });
    const canonicalItem = await readSqlMessageById(conversationId, savedItem.id);
    backupMessageToArchive(conversationId, canonicalItem);
    const publicItem = sanitizeMessageForResponse(canonicalItem);
    broadcastThreadEvent('message-created', conversationId, { item: publicItem });
    res.status(201).json({ conversationId, item: publicItem });
  } catch (error) {
    console.error('Chat POST /threads/messages error:', error);
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Не удалось сохранить сообщение' });
  }
});

router.post('/threads/:conversationId/messages/:messageId/reactions', async (req, res) => {
  let connection;
  let transactionActive = false;
  try {
    const conversationId = decodeURIComponent(req.params.conversationId || '').trim();
    const messageId = decodeURIComponent(req.params.messageId || '').trim();
    const emoji = String(req.body?.emoji || '').trim();
    const active = req.body?.active;

    if (!conversationId || !messageId) {
      return res.status(400).json({ message: 'conversationId и messageId обязательны' });
    }
    if (!emoji || emoji.length > 32 || typeof active !== 'boolean') {
      return res.status(400).json({ message: 'Неверные параметры реакции' });
    }
    if (!requireConversationAccess(req, res, conversationId)) return;
    if (!hasRole(req, 'admin') && await isSqlConversationArchived(conversationId)) {
      return res.status(409).json({ message: 'Переписка находится в архиве администратора' });
    }
    if (!await ensureChatSqlSchema()) {
      return res.status(503).json({ message: 'Хранилище сообщений временно недоступно' });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionActive = true;
    const [rows] = await connection.execute(
      `SELECT message_json
       FROM chat_messages
       WHERE conversation_id = ? AND id = ?
       LIMIT 1
       FOR UPDATE`,
      [conversationId, messageId]
    );
    const existingMessage = parseSqlMessage(rows?.[0]?.message_json);
    if (!existingMessage) {
      await connection.rollback();
      transactionActive = false;
      return res.status(404).json({ message: 'Сообщение не найдено' });
    }
    if (existingMessage.deletedAt) {
      await connection.rollback();
      transactionActive = false;
      return res.status(409).json({ message: 'На скрытое сообщение нельзя поставить реакцию' });
    }

    const reactions = { ...(existingMessage.reactions || {}) };
    const users = (Array.isArray(reactions[emoji]) ? reactions[emoji] : [])
      .filter((login) => !isSameLogin(login, req.auth.login));
    if (active) users.push(req.auth.login);
    if (users.length) reactions[emoji] = users;
    else delete reactions[emoji];

    const now = new Date().toISOString();
    const updatedItem = {
      ...existingMessage,
      reactions,
      updatedAt: now,
      deliveryStatus: 'sent'
    };
    await connection.execute(
      `UPDATE chat_messages
       SET message_json = ?, updated_at = ?
       WHERE conversation_id = ? AND id = ?`,
      [JSON.stringify(updatedItem), new Date(now), conversationId, messageId]
    );
    await connection.commit();
    transactionActive = false;

    indexMessageForRecordsArchive(db, conversationId, updatedItem).catch((error) => {
      console.warn('Chat reaction archive indexing failed:', error.message);
    });
    backupMessageToArchive(conversationId, updatedItem);
    const publicItem = sanitizeMessageForResponse(updatedItem);
    broadcastThreadEvent('message-updated', conversationId, { item: publicItem });
    res.json({ message: 'Реакция обновлена', conversationId, item: publicItem });
  } catch (error) {
    if (transactionActive && connection) {
      await connection.rollback().catch(() => {});
    }
    console.error('Chat POST /threads/messages/reactions error:', error);
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Не удалось обновить реакцию' });
  } finally {
    connection?.release();
  }
});

router.patch('/threads/:conversationId/messages/:messageId', async (req, res) => {
  try {
    const conversationId = decodeURIComponent(req.params.conversationId || '').trim();
    const messageId = decodeURIComponent(req.params.messageId || '').trim();
    const patch = req.body?.message && typeof req.body.message === 'object' ? req.body.message : req.body?.patch;

    if (!conversationId || !messageId) {
      return res.status(400).json({ message: 'conversationId и messageId обязательны' });
    }
    if (!requireConversationAccess(req, res, conversationId)) return;
    if (!hasRole(req, 'admin') && await isSqlConversationArchived(conversationId)) {
      return res.status(409).json({ message: 'Переписка находится в архиве администратора' });
    }

    if (!patch || typeof patch !== 'object') {
      return res.status(400).json({ message: 'message или patch обязателен' });
    }
    const existingRecord = await readSqlMessageRecordById(conversationId, messageId);
    const existingMessage = existingRecord?.message;
    if (!existingMessage) return res.status(404).json({ message: 'Сообщение не найдено' });
    if (existingMessage.deletedAt) {
      if (patch.deletedAt) {
        return res.json({
          message: 'Сообщение уже скрыто',
          conversationId,
          item: sanitizeMessageForResponse(existingMessage)
        });
      }
      return res.status(409).json({ message: 'Скрытое сообщение нельзя изменить или восстановить из чата' });
    }
    const canEditContent = isSameLogin(existingMessage.sender, req.auth.login) || hasRole(req, 'admin', 'manager');
    const contentFields = ['text', 'attachment', 'attachments'];
    const isDeleteRequest = Boolean(patch.deletedAt);
    const attemptsContentChange = isDeleteRequest || contentFields.some((field) => (
      Object.prototype.hasOwnProperty.call(patch, field)
      && JSON.stringify(patch[field] ?? null) !== JSON.stringify(existingMessage[field] ?? null)
    ));
    if (attemptsContentChange && !canEditContent) {
      return res.status(403).json({ message: 'Нельзя изменять или удалять чужое сообщение' });
    }

    const now = new Date().toISOString();
    const nextMessage = {
      ...existingMessage,
      updatedAt: now,
      deliveryStatus: 'sent',
      reactions: patch.reactions && typeof patch.reactions === 'object'
        ? mergeActorReactionState(existingMessage.reactions, patch.reactions, req.auth.login)
        : existingMessage.reactions,
      pinned: typeof patch.pinned === 'boolean' ? patch.pinned : existingMessage.pinned,
      readAt: existingMessage.readAt || null,
      id: existingMessage.id,
      sender: existingMessage.sender
    };
    if (canEditContent) {
      if (isDeleteRequest) {
        // A delete is a visibility change only. Do not copy the client's
        // cleared text/attachments over the retained authoritative message.
        nextMessage.deletedAt = now;
        nextMessage.deletedBy = req.auth.login;
        nextMessage.updatedAt = now;
      } else {
        contentFields.forEach((field) => {
          if (Object.prototype.hasOwnProperty.call(patch, field)) nextMessage[field] = patch[field];
        });
      }
      if (attemptsContentChange) {
        nextMessage.editedBy = req.auth.login;
        nextMessage.audit = [
          ...(Array.isArray(existingMessage.audit) ? existingMessage.audit : []),
          {
            action: isDeleteRequest ? 'delete' : 'edit',
            by: req.auth.login,
            role: req.auth.role,
            at: now
          }
        ];
      }
    }
    const updatedItem = attemptsContentChange && !isDeleteRequest
      ? await prepareClientMessage(req, conversationId, nextMessage, { ...existingMessage, audit: nextMessage.audit, editedBy: nextMessage.editedBy })
      : nextMessage;
    const stored = await writeSqlMessage(conversationId, updatedItem, {
      expectedSerializedMessage: existingRecord.serializedMessage
    });
    if (!stored) return res.status(503).json({ message: 'Хранилище сообщений временно недоступно' });
    backupMessageToArchive(conversationId, updatedItem);

    const publicItem = sanitizeMessageForResponse(updatedItem);
    broadcastThreadEvent('message-updated', conversationId, { item: publicItem });
    res.json({ message: 'Сообщение обновлено', conversationId, item: publicItem });
  } catch (error) {
    console.error('Chat PATCH /threads/messages error:', error);
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Не удалось обновить сообщение' });
  }
});

router.post('/threads/:conversationId/messages/bulk-delete', async (req, res) => {
  let connection;
  try {
    const conversationId = decodeURIComponent(req.params.conversationId || '').trim();
    const messageIds = [...new Set(
      (Array.isArray(req.body?.messageIds) ? req.body.messageIds : [])
        .map((value) => String(value || '').trim().slice(0, 128))
        .filter(Boolean)
    )].slice(0, 100);
    if (!conversationId || !messageIds.length) {
      return res.status(400).json({ message: 'conversationId и messageIds обязательны' });
    }
    if (!requireConversationAccess(req, res, conversationId)) return;
    if (!hasRole(req, 'admin') && await isSqlConversationArchived(conversationId)) {
      return res.status(409).json({ message: 'Переписка находится в архиве администратора' });
    }
    if (!await ensureChatSqlSchema()) {
      return res.status(503).json({ message: 'Хранилище сообщений временно недоступно' });
    }
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.query(
      'SELECT id, sender_login, message_json FROM chat_messages WHERE conversation_id = ? AND id IN (?) FOR UPDATE',
      [conversationId, messageIds]
    );
    if (rows.length !== messageIds.length) {
      await connection.rollback();
      return res.status(404).json({ message: 'Часть сообщений не найдена' });
    }
    if (
      !hasRole(req, 'admin', 'manager')
      && rows.some((row) => !isSameLogin(row.sender_login, req.auth.login))
    ) {
      await connection.rollback();
      return res.status(403).json({ message: 'Нельзя удалять чужие сообщения' });
    }

    const deletedAt = new Date().toISOString();
    const deletedItems = rows.map((row) => {
      const existingMessage = parseSqlMessage(row.message_json);
      if (!existingMessage) {
        const error = new Error(`Не удалось прочитать сообщение ${row.id}`);
        error.status = 500;
        throw error;
      }
      if (existingMessage.deletedAt) return existingMessage;
      return {
        ...existingMessage,
        deletedAt,
        deletedBy: req.auth.login,
        updatedAt: deletedAt,
        audit: [
          ...(Array.isArray(existingMessage.audit) ? existingMessage.audit : []),
          {
            action: 'delete',
            by: req.auth.login,
            role: req.auth.role,
            at: deletedAt
          }
        ]
      };
    });
    for (const item of deletedItems) {
      await connection.execute(
        `UPDATE chat_messages
         SET message_json = ?, deleted_at = ?, updated_at = ?
         WHERE conversation_id = ? AND id = ?`,
        [
          JSON.stringify(item),
          new Date(item.deletedAt),
          new Date(item.updatedAt || item.deletedAt),
          conversationId,
          item.id
        ]
      );
    }
    await connection.commit();
    await Promise.all(deletedItems.map((item) => indexMessageForRecordsArchive(db, conversationId, item)));
    deletedItems.forEach((item) => backupMessageToArchive(conversationId, item));
    broadcastThreadEvent('messages-bulk-deleted', conversationId, {
      messageIds,
      deletedAt,
      deletedBy: req.auth.login
    });
    res.json({ conversationId, messageIds, deletedAt, deletedBy: req.auth.login });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Chat POST /threads/messages/bulk-delete error:', error);
    res.status(500).json({ message: 'Не удалось удалить выбранные сообщения' });
  } finally {
    connection?.release();
  }
});

router.post('/threads/:conversationId/clear', requireRole('admin', 'manager'), async (req, res) => {
  let connection;
  try {
    const conversationId = req.params.conversationId;
    if (!requireConversationAccess(req, res, conversationId)) return;
    if (!hasRole(req, 'admin') && await isSqlConversationArchived(conversationId)) return res.status(409).json({ message: 'Переписка находится в архиве' });
    if (!await ensureChatSqlSchema()) return res.sendStatus(503);
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT message_json FROM chat_messages WHERE conversation_id = ? AND deleted_at IS NULL FOR UPDATE', [conversationId]);
    const now = new Date().toISOString();
    const messages = rows.map(row => { const old = parseSqlMessage(row.message_json); return { ...old, deletedAt: now, deletedBy: req.auth.login, updatedAt: now,
      audit: [...(old.audit || []), { action: 'conversation_clear', by: req.auth.login, at: now }] }; });
    for (const message of messages) {
      await connection.execute('UPDATE chat_messages SET message_json = ?, deleted_at = ?, updated_at = ? WHERE id = ? AND conversation_id = ?',
        [JSON.stringify(message), new Date(now), new Date(now), message.id, conversationId]);
    }
    await connection.commit();
    connection.release(); connection = null;
    for (const message of messages) { await indexMessageForRecordsArchive(db, conversationId, message); backupMessageToArchive(conversationId, message); }
    broadcastThreadEvent('conversation-refresh', conversationId, { clearedAt: now, deletedBy: req.auth.login });
    res.json({ count: messages.length });
  } catch (error) { if (connection) await connection.rollback(); res.status(error.status || 500).json({ message: 'Не удалось очистить переписку' }); }
  finally { connection?.release(); }
});

router.put('/threads/:conversationId/unread', async (req, res) => {
  try {
    const conversationId = req.params.conversationId;
    if (!requireConversationAccess(req, res, conversationId)) return;
    if (!await ensureChatSqlSchema()) return res.sendStatus(503);
    await db.execute(`INSERT INTO chat_read_state (conversation_id, user_login, last_read_message_id, last_read_at)
      VALUES (?, ?, NULL, '1970-01-01') ON DUPLICATE KEY UPDATE last_read_message_id = NULL, last_read_at = '1970-01-01'`, [conversationId, req.auth.login]);
    broadcastThreadEvent('read-state-updated', conversationId, { state: { login: req.auth.login, lastReadMessageId: '', lastReadAt: '1970-01-01T00:00:00.000Z' } });
    res.sendStatus(204);
  } catch { res.sendStatus(503); }
});

router.delete('/threads/:conversationId', requireRole('admin'), async (req, res) => {
  const conversationId = decodeURIComponent(req.params.conversationId || '').trim();
  res.status(409).json({
    message: 'Прямое физическое удаление отключено. Используйте форму окончательного удаления в архиве администратора.',
    conversationId
  });
});

router.get('/records/conversations', requireRole('admin'), async (req, res) => {
  try {
    if (!await ensureChatSqlSchema() || !await ensureRecordsArchiveSchema(db)) {
      return res.status(503).json({ message: 'Архив переписки временно недоступен' });
    }
    const query = String(req.query?.q || '').trim().slice(0, 200).toLowerCase();
    const state = ['active', 'archived'].includes(req.query?.state) ? req.query.state : 'all';
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.from || '') ? req.query.from : '';
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.to || '') ? req.query.to : '';
    const conditions = [];
    const params = [];
    if (state !== 'all') { conditions.push('conversations.state = ?'); params.push(state); }
    if (from) { conditions.push("conversations.last_message_at >= CONCAT(?, ' 00:00:00')"); params.push(from); }
    if (to) { conditions.push("conversations.last_message_at < DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 1 DAY)"); params.push(to); }
    if (query) {
      conditions.push(`(
        LOWER(conversations.participant_a) LIKE ?
        OR LOWER(conversations.participant_b) LIKE ?
        OR EXISTS (
          SELECT 1 FROM chat_messages AS messages
          WHERE messages.conversation_id = conversations.conversation_id
            AND LOWER(messages.message_json) LIKE ?
        )
        OR EXISTS (
          SELECT 1 FROM chat_message_versions AS versions
          WHERE versions.conversation_id = conversations.conversation_id
            AND LOWER(versions.snapshot_json) LIKE ?
        )
        OR EXISTS (
          SELECT 1
          FROM chat_message_files AS links
          INNER JOIN chat_files AS files ON files.id = links.file_id
          WHERE links.conversation_id = conversations.conversation_id
            AND LOWER(files.original_name) LIKE ?
        )
      )`);
      const pattern = `%${query}%`;
      params.push(pattern, pattern, pattern, pattern, pattern);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await db.query(
      `SELECT conversations.conversation_id, conversations.participant_a,
              conversations.participant_b, conversations.state,
              conversations.created_at, conversations.last_message_at,
              conversations.message_count, conversations.archived_at,
              conversations.archived_by,
              (SELECT COUNT(*) FROM chat_messages AS deleted_messages
               WHERE deleted_messages.conversation_id = conversations.conversation_id
                 AND deleted_messages.deleted_at IS NOT NULL) AS deleted_count,
              (SELECT COUNT(*) FROM chat_message_files AS files
               WHERE files.conversation_id = conversations.conversation_id) AS file_count,
              (SELECT COUNT(DISTINCT holds.id)
               FROM records_legal_holds AS holds
               INNER JOIN records_legal_hold_items AS hold_items ON hold_items.hold_id = holds.id
               WHERE holds.status = 'active'
                 AND holds.starts_at <= NOW()
                 AND (holds.ends_at IS NULL OR holds.ends_at > NOW())
                 AND hold_items.entity_type = 'chat_conversation'
                 AND hold_items.entity_id = conversations.conversation_id) AS legal_hold_count
       FROM chat_conversations AS conversations
       ${where}
       ORDER BY conversations.last_message_at DESC
       LIMIT 200`,
      params
    );
    res.set('Cache-Control', 'no-store');
    res.json({ conversations: rows || [] });
  } catch (error) {
    console.error('Chat GET /records/conversations error:', error);
    res.status(500).json({ message: 'Не удалось выполнить поиск в архиве' });
  }
});

router.get('/records/conversations/:conversationId/messages', requireRole('admin'), async (req, res) => {
  try {
    const conversationId = decodeURIComponent(req.params.conversationId || '').trim();
    const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query?.limit)) || CHAT_SQL_PAGE_SIZE));
    const query = String(req.query?.q || '').trim().slice(0, 200).toLowerCase();
    const before = req.query?.before || '';
    let messages;
    if (query && !conversationId.toLowerCase().includes(query)) {
      const params = [conversationId];
      let beforeSql = '';
      if (before) {
        const beforeDate = new Date(before);
        if (Number.isNaN(beforeDate.getTime())) return res.status(400).json({ message: 'Некорректный курсор архива' });
        beforeSql = 'AND messages.created_at < ?';
        params.push(beforeDate);
      }
      const pattern = `%${query}%`;
      params.push(pattern, pattern, pattern);
      const [rows] = await db.query(
        `SELECT messages.message_json
         FROM chat_messages AS messages
         WHERE messages.conversation_id = ?
           ${beforeSql}
           AND (
             LOWER(messages.message_json) LIKE ?
             OR EXISTS (
               SELECT 1 FROM chat_message_versions AS versions
               WHERE versions.message_id = messages.id
                 AND LOWER(versions.snapshot_json) LIKE ?
             )
             OR EXISTS (
               SELECT 1
               FROM chat_message_files AS links
               INNER JOIN chat_files AS files ON files.id = links.file_id
               WHERE links.message_id = messages.id
                 AND LOWER(files.original_name) LIKE ?
             )
           )
         ORDER BY messages.created_at DESC, messages.id DESC
         LIMIT ${limit}`,
        params
      );
      messages = (rows || []).map((row) => parseSqlMessage(row.message_json)).filter(Boolean).reverse();
    } else {
      messages = await readSqlConversationMessages(conversationId, { limit, before });
    }
    if (!Array.isArray(messages)) return res.status(503).json({ message: 'Архив переписки временно недоступен' });
    const retainedMessages = await hydrateRetainedDeletedMessages(conversationId, messages);
    res.set('Cache-Control', 'no-store');
    res.json({
      conversationId,
      messages: retainedMessages.map((message) => sanitizeMessageForResponse(message, { includeRetainedContent: true })),
      before: messages[0]?.createdAt || '',
      hasMore: messages.length >= limit
    });
  } catch (error) {
    console.error('Chat GET /records/conversations/messages error:', error);
    res.status(500).json({ message: 'Не удалось открыть архивную переписку' });
  }
});

router.post('/records/conversations/:conversationId/state', requireRole('admin'), async (req, res) => {
  try {
    const conversationId = decodeURIComponent(req.params.conversationId || '').trim();
    const state = req.body?.state;
    if (!['active', 'archived'].includes(state)) return res.status(400).json({ message: 'Некорректное состояние архива' });
    if (!await ensureRecordsArchiveSchema(db)) return res.status(503).json({ message: 'Архив переписки временно недоступен' });
    const archivedAt = state === 'archived' ? new Date() : null;
    const archivedBy = state === 'archived' ? req.auth.login : null;
    const [result] = await db.execute(
      `UPDATE chat_conversations
       SET state = ?, archived_at = ?, archived_by = ?
       WHERE conversation_id = ?`,
      [state, archivedAt, archivedBy, conversationId]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Переписка не найдена' });
    await db.execute(
      `INSERT INTO records_audit_log
       (action, entity_type, entity_id, actor_login, actor_role, details_json)
       VALUES (?, 'chat_conversation', ?, ?, ?, ?)`,
      [state === 'archived' ? 'conversation_archived' : 'conversation_restored', conversationId, req.auth.login, req.auth.role, JSON.stringify({ state })]
    );
    broadcastThreadEvent('conversation-refresh', conversationId);
    res.json({ conversationId, state, archivedAt: archivedAt?.toISOString() || null, archivedBy });
  } catch (error) {
    console.error('Chat POST /records/conversations/state error:', error);
    res.status(500).json({ message: 'Не удалось изменить состояние переписки' });
  }
});

router.get('/records/legal-holds', requireRole('admin'), async (req, res) => {
  try {
    if (!await ensureRecordsArchiveSchema(db)) return res.status(503).json({ message: 'Legal hold временно недоступен' });
    const query = String(req.query?.q || '').trim().toLowerCase().slice(0, 200);
    const status = ['active', 'expired', 'released'].includes(req.query?.status) ? req.query.status : 'all';
    const conditions = [];
    const params = [];
    if (status === 'active') conditions.push("holds.status = 'active' AND (holds.ends_at IS NULL OR holds.ends_at > NOW())");
    if (status === 'expired') conditions.push("holds.status = 'active' AND holds.ends_at IS NOT NULL AND holds.ends_at <= NOW()");
    if (status === 'released') conditions.push("holds.status = 'released'");
    if (query) {
      conditions.push(`(
        LOWER(holds.name) LIKE ?
        OR LOWER(holds.reason) LIKE ?
        OR LOWER(holds.created_by) LIKE ?
        OR EXISTS (
          SELECT 1 FROM records_legal_hold_items AS search_items
          WHERE search_items.hold_id = holds.id
            AND LOWER(search_items.entity_id) LIKE ?
        )
      )`);
      const pattern = `%${query}%`;
      params.push(pattern, pattern, pattern, pattern);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await db.query(
      `SELECT holds.id, holds.name, holds.reason, holds.status, holds.scope_json,
              holds.starts_at, holds.ends_at, holds.created_by, holds.created_at,
              holds.released_by, holds.released_at,
              conversation_items.entity_id AS conversation_id,
              (SELECT COUNT(*) FROM records_legal_hold_items AS all_items
               WHERE all_items.hold_id = holds.id) AS item_count
       FROM records_legal_holds AS holds
       LEFT JOIN records_legal_hold_items AS conversation_items
         ON conversation_items.hold_id = holds.id
        AND conversation_items.entity_type = 'chat_conversation'
       ${where}
       ORDER BY
         (holds.status = 'active' AND (holds.ends_at IS NULL OR holds.ends_at > NOW())) DESC,
         holds.created_at DESC
       LIMIT 300`,
      params
    );
    res.set('Cache-Control', 'no-store');
    res.json({ holds: (rows || []).map((row) => ({ ...row, scope: parseSqlJson(row.scope_json) || {} })) });
  } catch (error) {
    console.error('Chat GET /records/legal-holds error:', error);
    res.status(500).json({ message: 'Не удалось получить список legal hold' });
  }
});

router.post('/records/legal-holds', requireRole('admin'), async (req, res) => {
  let connection;
  try {
    const conversationId = String(req.body?.conversationId || '').trim();
    const name = String(req.body?.name || '').trim().slice(0, 255);
    const reason = String(req.body?.reason || '').trim().slice(0, 4000);
    const rawEndsAt = String(req.body?.endsAt || '').trim();
    if (!conversationId || !name || !reason) {
      return res.status(400).json({ message: 'Выберите переписку и заполните название и причину запрета' });
    }
    if (!await ensureChatSqlSchema() || !await ensureRecordsArchiveSchema(db)) {
      return res.status(503).json({ message: 'Legal hold временно недоступен' });
    }
    let endsAt = null;
    if (rawEndsAt) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawEndsAt)) return res.status(400).json({ message: 'Некорректная дата окончания' });
      endsAt = new Date(`${rawEndsAt}T23:59:59`);
      if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= Date.now()) {
        return res.status(400).json({ message: 'Дата окончания должна быть позже текущего времени' });
      }
    }
    const [conversationRows] = await db.execute(
      'SELECT conversation_id, participant_a, participant_b FROM chat_conversations WHERE conversation_id = ? LIMIT 1',
      [conversationId]
    );
    if (!conversationRows?.length) return res.status(404).json({ message: 'Переписка не найдена' });

    const holdId = createId('hold');
    connection = await db.getConnection();
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO records_legal_holds
       (id, name, reason, status, scope_json, starts_at, ends_at, created_by)
       VALUES (?, ?, ?, 'active', ?, NOW(), ?, ?)`,
      [holdId, name, reason, JSON.stringify({ type: 'conversation', conversationId }), endsAt, req.auth.login]
    );
    await connection.execute(
      `INSERT INTO records_legal_hold_items (hold_id, entity_type, entity_id, parent_id)
       VALUES (?, 'chat_conversation', ?, NULL)`,
      [holdId, conversationId]
    );
    await connection.execute(
      `INSERT IGNORE INTO records_legal_hold_items (hold_id, entity_type, entity_id, parent_id)
       SELECT ?, 'chat_message', messages.id, messages.conversation_id
       FROM chat_messages AS messages
       WHERE messages.conversation_id = ?`,
      [holdId, conversationId]
    );
    await connection.execute(
      `INSERT IGNORE INTO records_legal_hold_items (hold_id, entity_type, entity_id, parent_id)
       SELECT DISTINCT ?, 'chat_file', links.file_id, links.conversation_id
       FROM chat_message_files AS links
       WHERE links.conversation_id = ?`,
      [holdId, conversationId]
    );
    const [countRows] = await connection.execute(
      'SELECT COUNT(*) AS item_count FROM records_legal_hold_items WHERE hold_id = ?',
      [holdId]
    );
    await connection.execute(
      `INSERT INTO records_audit_log
       (action, entity_type, entity_id, hold_id, actor_login, actor_role, details_json)
       VALUES ('legal_hold_created', 'chat_conversation', ?, ?, ?, ?, ?)`,
      [conversationId, holdId, req.auth.login, req.auth.role, JSON.stringify({ name, reason, endsAt: endsAt?.toISOString() || null })]
    );
    await connection.commit();
    connection.release();
    connection = null;
    res.status(201).json({
      hold: {
        id: holdId,
        name,
        reason,
        status: 'active',
        conversation_id: conversationId,
        scope: { type: 'conversation', conversationId },
        starts_at: new Date().toISOString(),
        ends_at: endsAt?.toISOString() || null,
        created_by: req.auth.login,
        item_count: Number(countRows?.[0]?.item_count) || 0
      }
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Chat POST /records/legal-holds error:', error);
    res.status(500).json({ message: 'Не удалось установить legal hold' });
  } finally {
    connection?.release();
  }
});

router.post('/records/legal-holds/:holdId/release', requireRole('admin'), async (req, res) => {
  try {
    const holdId = decodeURIComponent(req.params.holdId || '').trim();
    if (!holdId) return res.status(400).json({ message: 'Укажите legal hold' });
    if (!await ensureRecordsArchiveSchema(db)) return res.status(503).json({ message: 'Legal hold временно недоступен' });
    const [rows] = await db.execute(
      `SELECT holds.id, holds.name, conversation_items.entity_id AS conversation_id
       FROM records_legal_holds AS holds
       LEFT JOIN records_legal_hold_items AS conversation_items
         ON conversation_items.hold_id = holds.id
        AND conversation_items.entity_type = 'chat_conversation'
       WHERE holds.id = ? AND holds.status = 'active'
       LIMIT 1`,
      [holdId]
    );
    const hold = rows?.[0];
    if (!hold) return res.status(404).json({ message: 'Активный legal hold не найден' });
    await db.execute(
      `UPDATE records_legal_holds
       SET status = 'released', released_by = ?, released_at = NOW()
       WHERE id = ? AND status = 'active'`,
      [req.auth.login, holdId]
    );
    await db.execute(
      `INSERT INTO records_audit_log
       (action, entity_type, entity_id, hold_id, actor_login, actor_role, details_json)
       VALUES ('legal_hold_released', 'chat_conversation', ?, ?, ?, ?, ?)`,
      [hold.conversation_id, holdId, req.auth.login, req.auth.role, JSON.stringify({ name: hold.name })]
    );
    res.json({ holdId, status: 'released', releasedAt: new Date().toISOString(), releasedBy: req.auth.login });
  } catch (error) {
    console.error('Chat POST /records/legal-holds/release error:', error);
    res.status(500).json({ message: 'Не удалось снять legal hold' });
  }
});

router.get('/records/purge-history', requireRole('admin'), async (req, res) => {
  try {
    if (!await ensureRecordsArchiveSchema(db)) return res.status(503).json({ message: 'История удалений временно недоступна' });
    const query = String(req.query?.q || '').trim().toLowerCase().slice(0, 200);
    const params = [];
    let searchSql = '';
    if (query) {
      searchSql = `AND (
        LOWER(entity_id) LIKE ?
        OR LOWER(actor_login) LIKE ?
        OR LOWER(details_json) LIKE ?
      )`;
      const pattern = `%${query}%`;
      params.push(pattern, pattern, pattern);
    }
    const [rows] = await db.query(
      `SELECT id, entity_id AS conversation_id, archive_id, actor_login,
              actor_role, details_json, created_at
       FROM records_audit_log
       WHERE action = 'conversation_permanently_deleted'
         ${searchSql}
       ORDER BY created_at DESC
       LIMIT 200`,
      params
    );
    res.set('Cache-Control', 'no-store');
    res.json({ purges: (rows || []).map((row) => ({ ...row, details: parseSqlJson(row.details_json) || {} })) });
  } catch (error) {
    console.error('Chat GET /records/purge-history error:', error);
    res.status(500).json({ message: 'Не удалось получить историю окончательных удалений' });
  }
});

router.get('/records/conversations/:conversationId/purge-preview', requireRole('admin'), async (req, res) => {
  try {
    const conversationId = decodeURIComponent(req.params.conversationId || '').trim();
    if (!conversationId) return res.status(400).json({ message: 'Выберите переписку' });
    const preview = await getConversationPurgePreview(conversationId);
    res.set('Cache-Control', 'no-store');
    res.json(preview);
  } catch (error) {
    console.error('Chat GET /records/conversations/purge-preview error:', error);
    res.status(error.status || 500).json({ message: error.message || 'Не удалось рассчитать окончательное удаление' });
  }
});

router.post('/records/conversations/:conversationId/purge', requireRole('admin'), async (req, res) => {
  let connection;
  let stagedFiles;
  let committed = false;
  try {
    const conversationId = decodeURIComponent(req.params.conversationId || '').trim();
    const reason = String(req.body?.reason || '').trim().slice(0, 4000);
    const confirmationPhrase = String(req.body?.confirmationPhrase || '').trim().toUpperCase();
    const confirmationConversationId = String(req.body?.confirmationConversationId || '').trim();
    const archiveId = String(req.body?.archiveId || '').trim();
    const acknowledged = req.body?.acknowledgedConsequences === true;
    if (!conversationId || !reason) return res.status(400).json({ message: 'Укажите переписку и обязательную причину удаления' });
    if (confirmationPhrase !== 'УДАЛИТЬ' && confirmationPhrase !== 'DELETE') {
      return res.status(400).json({ message: 'Введите слово УДАЛИТЬ для подтверждения' });
    }
    if (confirmationConversationId !== conversationId || !acknowledged) {
      return res.status(400).json({ message: 'Не получено финальное подтверждение выбранной переписки' });
    }

    const preview = await getConversationPurgePreview(conversationId);
    if (preview.legalHolds.length) {
      return res.status(423).json({
        message: 'Окончательное удаление запрещено действующим legal hold',
        legalHolds: preview.legalHolds
      });
    }
    if (!preview.backupReady || !preview.backup || preview.backup.id !== archiveId) {
      return res.status(409).json({
        message: 'Перед удалением сформируйте, скачайте и повторно проверьте полный ZIP-архив этой переписки',
        preview
      });
    }

    const files = await getConversationPurgeFiles(conversationId);
    const exclusiveFiles = files.filter((file) => Number(file.is_exclusive) === 1);
    const exclusiveFileIds = exclusiveFiles.map((file) => file.id);
    const purgeId = createId('purge');
    stagedFiles = await stageFilesForPermanentDeletion(exclusiveFiles, purgeId);

    connection = await db.getConnection();
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE records_archive_access
       SET revoked_at = COALESCE(revoked_at, NOW()), revoked_by = COALESCE(revoked_by, ?)
       WHERE archive_id IN (
         SELECT DISTINCT archive_id FROM records_archive_items
         WHERE parent_id = ? OR (entity_type = 'chat_conversation' AND entity_id = ?)
       )`,
      [req.auth.login, conversationId, conversationId]
    );
    await connection.execute('DELETE FROM chat_read_state WHERE conversation_id = ?', [conversationId]);
    await connection.execute('DELETE FROM chat_message_files WHERE conversation_id = ?', [conversationId]);
    await connection.execute('DELETE FROM chat_message_versions WHERE conversation_id = ?', [conversationId]);
    await connection.execute('DELETE FROM chat_messages WHERE conversation_id = ?', [conversationId]);
    await connection.execute('DELETE FROM chat_conversations WHERE conversation_id = ?', [conversationId]);
    if (exclusiveFileIds.length) {
      await connection.query('DELETE FROM chat_files WHERE id IN (?)', [exclusiveFileIds]);
    }
    const auditDetails = {
      purgeId,
      reason,
      conversation: preview.conversation,
      counts: preview.counts,
      archive: {
        id: preview.backup.id,
        name: preview.backup.name,
        packageSha256: preview.backup.packageSha256,
        downloadedAt: preview.backup.downloadedAt,
        completedAt: preview.backup.completedAt
      },
      deletedFileIds: exclusiveFileIds,
      preservedSharedFiles: preview.counts.sharedFiles
    };
    await connection.execute(
      `INSERT INTO records_audit_log
       (action, entity_type, entity_id, archive_id, actor_login, actor_role, details_json)
       VALUES ('conversation_permanently_deleted', 'chat_conversation', ?, ?, ?, ?, ?)`,
      [conversationId, preview.backup.id, req.auth.login, req.auth.role, JSON.stringify(auditDetails)]
    );
    await connection.commit();
    committed = true;
    connection.release();
    connection = null;

    let cleanupWarning = '';
    try {
      await fs.rm(stagedFiles.stagingDir, { recursive: true, force: true });
    } catch (error) {
      cleanupWarning = 'Записи удалены, но служебную папку файлов не удалось очистить автоматически';
      await db.execute(
        `INSERT INTO records_audit_log
         (action, entity_type, entity_id, archive_id, actor_login, actor_role, details_json)
         VALUES ('purge_file_cleanup_failed', 'chat_conversation', ?, ?, ?, ?, ?)`,
        [conversationId, preview.backup.id, req.auth.login, req.auth.role, JSON.stringify({ purgeId, error: error.message })]
      ).catch(() => {});
    }
    await removeArchiveConversation(conversationId);
    broadcastThreadEvent('conversation-delete', conversationId);
    res.json({
      message: 'Переписка окончательно удалена',
      conversationId,
      purgeId,
      counts: preview.counts,
      archive: { id: preview.backup.id, packageSha256: preview.backup.packageSha256 },
      cleanupWarning: cleanupWarning || null
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (!committed && stagedFiles) await restoreStagedPurgeFiles(stagedFiles);
    console.error('Chat POST /records/conversations/purge error:', error);
    res.status(error.status || 500).json({ message: error.message || 'Не удалось выполнить окончательное удаление' });
  } finally {
    connection?.release();
  }
});

router.get('/records/archives', requireRole('admin'), async (req, res) => {
  try {
    if (!await ensureRecordsArchiveSchema(db)) return res.status(503).json({ message: 'Архивы временно недоступны' });
    const [[rows], [accessRows]] = await Promise.all([
      db.query(
        `SELECT id, name, archive_type, status, selection_json, package_sha256,
                record_count, file_count, total_bytes, created_by, created_at,
                completed_at, downloaded_at, error_text
         FROM records_archives
         WHERE deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT 100`
      ),
      db.query(
        `SELECT access_grants.id, access_grants.archive_id, access_grants.user_login,
                access_grants.scope_json, access_grants.granted_by,
                access_grants.granted_at, access_grants.expires_at,
                access_grants.revoked_at, access_grants.revoked_by,
                users.full_name AS user_full_name
         FROM records_archive_access AS access_grants
         LEFT JOIN users ON LOWER(users.login) = access_grants.user_login
         ORDER BY access_grants.granted_at DESC
         LIMIT 500`
      )
    ]);
    const accessesByArchive = (accessRows || []).reduce((result, access) => {
      if (!result[access.archive_id]) result[access.archive_id] = [];
      result[access.archive_id].push({ ...access, scope: parseSqlJson(access.scope_json) || {} });
      return result;
    }, {});
    res.set('Cache-Control', 'no-store');
    res.json({
      archives: (rows || []).map((row) => ({
        ...row,
        selection: parseSqlJson(row.selection_json) || {},
        accesses: accessesByArchive[row.id] || []
      }))
    });
  } catch (error) {
    console.error('Chat GET /records/archives error:', error);
    res.status(500).json({ message: 'Не удалось получить список сформированных архивов' });
  }
});

router.post('/records/archives', requireRole('admin'), async (req, res) => {
  try {
    const scope = req.body?.scope === 'conversation' ? 'conversation' : 'all';
    const conversationId = scope === 'conversation' ? String(req.body?.conversationId || '').trim() : '';
    if (scope === 'conversation' && !conversationId) return res.status(400).json({ message: 'Выберите переписку' });
    if (!await ensureChatSqlSchema() || !await ensureChatFilesSqlSchema() || !await ensureFeedSqlSchema() || !await ensureRecordsArchiveSchema(db)) {
      return res.status(503).json({ message: 'Хранилище не готово к формированию архива' });
    }
    if (conversationId) {
      const [conversationRows] = await db.execute('SELECT 1 FROM chat_conversations WHERE conversation_id = ? LIMIT 1', [conversationId]);
      if (!conversationRows?.length) return res.status(404).json({ message: 'Переписка не найдена' });
    }
    const archiveId = createId('archive');
    const selection = { scope, ...(conversationId ? { conversationId } : {}) };
    const defaultName = scope === 'conversation'
      ? `Переписка ${conversationId}`
      : `Полный архив ${new Date().toISOString().slice(0, 10)}`;
    const name = String(req.body?.name || defaultName).trim().slice(0, 255) || defaultName;
    await db.execute(
      `INSERT INTO records_archives
       (id, name, archive_type, status, selection_json, created_by)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
      [archiveId, name, scope === 'all' ? 'full' : 'conversation', JSON.stringify(selection), req.auth.login]
    );
    await db.execute(
      `INSERT INTO records_audit_log (action, entity_type, entity_id, archive_id, actor_login, actor_role, details_json)
       VALUES ('archive_created', 'records_archive', ?, ?, ?, ?, ?)`,
      [archiveId, archiveId, req.auth.login, req.auth.role, JSON.stringify(selection)]
    );
    setImmediate(() => {
      buildRecordsArchivePackage({
        db,
        archiveId,
        selection,
        archiveRoot: recordsArchiveDir,
        uploadsDir,
        actor: { login: req.auth.login, role: req.auth.role }
      }).catch((error) => console.error(`Records archive ${archiveId} build failed:`, error));
    });
    res.status(202).json({ archive: { id: archiveId, name, archive_type: scope === 'all' ? 'full' : 'conversation', status: 'pending', selection } });
  } catch (error) {
    console.error('Chat POST /records/archives error:', error);
    res.status(500).json({ message: 'Не удалось начать формирование архива' });
  }
});

router.post('/records/archives/:archiveId/access', requireRole('admin'), async (req, res) => {
  try {
    const archiveId = decodeURIComponent(req.params.archiveId || '').trim();
    const userLogin = String(req.body?.userLogin || '').trim().toLowerCase();
    const expiresInDays = Math.min(365, Math.max(1, Number.parseInt(req.body?.expiresInDays, 10) || 7));
    if (!archiveId || !userLogin) return res.status(400).json({ message: 'Выберите архив и сотрудника' });
    if (!await ensureRecordsArchiveSchema(db)) return res.status(503).json({ message: 'Архивы временно недоступны' });

    const [[archiveRows], [userRows]] = await Promise.all([
      db.execute(
        `SELECT id, archive_type, status, selection_json
         FROM records_archives
         WHERE id = ? AND deleted_at IS NULL
         LIMIT 1`,
        [archiveId]
      ),
      db.execute(
        `SELECT login, role, full_name
         FROM users
         WHERE LOWER(login) = ? AND role IN ('employee', 'manager')
         LIMIT 1`,
        [userLogin]
      )
    ]);
    const archive = archiveRows?.[0];
    const targetUser = userRows?.[0];
    if (!archive || archive.status !== 'completed') return res.status(409).json({ message: 'Доступ можно выдать только к готовому архиву' });
    if (archive.archive_type !== 'conversation') return res.status(400).json({ message: 'Сотруднику можно выдать только архив отдельной переписки' });
    if (!targetUser) return res.status(404).json({ message: 'Сотрудник не найден' });

    const selection = parseSqlJson(archive.selection_json) || {};
    const conversationId = String(selection.conversationId || '').trim();
    if (!conversationId || !isConversationParticipant(conversationId, userLogin)) {
      return res.status(403).json({ message: 'Сотруднику можно открыть только переписку, участником которой он является' });
    }

    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    await db.execute(
      `UPDATE records_archive_access
       SET revoked_at = NOW(), revoked_by = ?
       WHERE archive_id = ? AND user_login = ? AND revoked_at IS NULL`,
      [req.auth.login, archiveId, userLogin]
    );
    const [result] = await db.execute(
      `INSERT INTO records_archive_access
       (archive_id, user_login, scope_json, granted_by, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [archiveId, userLogin, JSON.stringify({ conversationId }), req.auth.login, expiresAt]
    );
    const accessId = Number(result.insertId);
    await db.execute(
      `INSERT INTO records_audit_log
       (action, entity_type, entity_id, archive_id, actor_login, actor_role, details_json)
       VALUES ('archive_access_granted', 'records_archive_access', ?, ?, ?, ?, ?)`,
      [String(accessId), archiveId, req.auth.login, req.auth.role, JSON.stringify({ userLogin, conversationId, expiresAt: expiresAt.toISOString() })]
    );
    res.status(201).json({
      access: {
        id: accessId,
        archive_id: archiveId,
        user_login: userLogin,
        user_full_name: targetUser.full_name,
        scope: { conversationId },
        granted_by: req.auth.login,
        granted_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        revoked_at: null
      }
    });
  } catch (error) {
    console.error('Chat POST /records/archives/access error:', error);
    res.status(500).json({ message: 'Не удалось выдать доступ к архиву' });
  }
});

router.post('/records/access/:accessId/revoke', requireRole('admin'), async (req, res) => {
  try {
    const accessId = Number.parseInt(req.params.accessId, 10);
    if (!Number.isSafeInteger(accessId) || accessId <= 0) return res.status(400).json({ message: 'Некорректный доступ' });
    if (!await ensureRecordsArchiveSchema(db)) return res.status(503).json({ message: 'Архивы временно недоступны' });
    const [rows] = await db.execute(
      'SELECT id, archive_id, user_login FROM records_archive_access WHERE id = ? LIMIT 1',
      [accessId]
    );
    const access = rows?.[0];
    if (!access) return res.status(404).json({ message: 'Доступ не найден' });
    await db.execute(
      `UPDATE records_archive_access
       SET revoked_at = COALESCE(revoked_at, NOW()), revoked_by = COALESCE(revoked_by, ?)
       WHERE id = ?`,
      [req.auth.login, accessId]
    );
    await db.execute(
      `INSERT INTO records_audit_log
       (action, entity_type, entity_id, archive_id, actor_login, actor_role, details_json)
       VALUES ('archive_access_revoked', 'records_archive_access', ?, ?, ?, ?, ?)`,
      [String(accessId), access.archive_id, req.auth.login, req.auth.role, JSON.stringify({ userLogin: access.user_login })]
    );
    res.json({ accessId, revokedAt: new Date().toISOString(), revokedBy: req.auth.login });
  } catch (error) {
    console.error('Chat POST /records/access/revoke error:', error);
    res.status(500).json({ message: 'Не удалось отозвать доступ к архиву' });
  }
});

router.get('/records/received', async (req, res) => {
  try {
    if (!await ensureRecordsArchiveSchema(db)) return res.status(503).json({ message: 'Архивы временно недоступны' });
    const userLogin = String(req.auth.login || '').trim().toLowerCase();
    const [rows] = await db.execute(
      `SELECT access_grants.id AS access_id, access_grants.archive_id,
              access_grants.granted_by, access_grants.granted_at,
              access_grants.expires_at, access_grants.scope_json,
              archives.name, archives.archive_type, archives.completed_at,
              archives.record_count, archives.file_count, archives.selection_json
       FROM records_archive_access AS access_grants
       INNER JOIN records_archives AS archives ON archives.id = access_grants.archive_id
       WHERE access_grants.user_login = ?
         AND access_grants.revoked_at IS NULL
         AND (access_grants.expires_at IS NULL OR access_grants.expires_at > NOW())
         AND archives.status = 'completed'
         AND archives.deleted_at IS NULL
       ORDER BY access_grants.granted_at DESC`,
      [userLogin]
    );
    res.set('Cache-Control', 'no-store');
    res.json({
      archives: (rows || []).map((row) => ({
        ...row,
        scope: parseSqlJson(row.scope_json) || {},
        selection: parseSqlJson(row.selection_json) || {}
      }))
    });
  } catch (error) {
    console.error('Chat GET /records/received error:', error);
    res.status(500).json({ message: 'Не удалось получить выданные архивы' });
  }
});

router.get('/records/received/:accessId/messages', async (req, res) => {
  try {
    const accessId = Number.parseInt(req.params.accessId, 10);
    const userLogin = String(req.auth.login || '').trim().toLowerCase();
    const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query?.limit)) || CHAT_SQL_PAGE_SIZE));
    if (!Number.isSafeInteger(accessId) || accessId <= 0) return res.status(400).json({ message: 'Некорректный доступ' });
    if (!await ensureRecordsArchiveSchema(db)) return res.status(503).json({ message: 'Архивы временно недоступны' });
    const [accessRows] = await db.execute(
      `SELECT access_grants.archive_id, access_grants.scope_json,
              archives.completed_at, archives.status
       FROM records_archive_access AS access_grants
       INNER JOIN records_archives AS archives ON archives.id = access_grants.archive_id
       WHERE access_grants.id = ?
         AND access_grants.user_login = ?
         AND access_grants.revoked_at IS NULL
         AND (access_grants.expires_at IS NULL OR access_grants.expires_at > NOW())
         AND archives.status = 'completed'
         AND archives.deleted_at IS NULL
       LIMIT 1`,
      [accessId, userLogin]
    );
    const access = accessRows?.[0];
    if (!access) return res.status(403).json({ message: 'Доступ к архиву отсутствует или истёк' });
    const scope = parseSqlJson(access.scope_json) || {};
    const conversationId = String(scope.conversationId || '').trim();
    if (!conversationId || !isConversationParticipant(conversationId, userLogin)) {
      return res.status(403).json({ message: 'Этот архив не относится к вашему диалогу' });
    }

    const cursorParams = [];
    let beforeSql = '';
    if (req.query?.before) {
      const beforeDate = new Date(req.query.before);
      if (Number.isNaN(beforeDate.getTime())) return res.status(400).json({ message: 'Некорректный курсор архива' });
      beforeSql = 'AND messages.created_at < ?';
      cursorParams.push(beforeDate);
    }
    const [rows] = await db.query(
      `SELECT COALESCE(
          (SELECT versions.snapshot_json
           FROM chat_message_versions AS versions
           WHERE versions.message_id = messages.id
             AND versions.created_at <= ?
           ORDER BY versions.version_no DESC
           LIMIT 1),
          messages.message_json
        ) AS message_json
       FROM records_archive_items AS archive_items
       INNER JOIN chat_messages AS messages
         ON messages.id = archive_items.entity_id
        AND messages.conversation_id = archive_items.parent_id
       WHERE archive_items.archive_id = ?
         AND archive_items.entity_type = 'chat_message'
         AND archive_items.parent_id = ?
         ${beforeSql}
       ORDER BY messages.created_at DESC, messages.id DESC
       LIMIT ${limit}`,
      [access.completed_at, access.archive_id, conversationId, ...cursorParams]
    );
    const messages = (rows || [])
      .map((row) => parseSqlMessage(row.message_json))
      .filter(Boolean)
      .reverse()
      .map((message) => sanitizeMessageForResponse(message, { includeRetainedContent: true }));
    res.set('Cache-Control', 'no-store');
    res.json({
      accessId,
      conversationId,
      messages,
      before: messages[0]?.createdAt || '',
      hasMore: messages.length >= limit
    });
  } catch (error) {
    console.error('Chat GET /records/received/messages error:', error);
    res.status(500).json({ message: 'Не удалось открыть полученный архив' });
  }
});

router.post('/records/archives/:archiveId/download-token', requireRole('admin'), async (req, res) => {
  try {
    const archiveId = decodeURIComponent(req.params.archiveId || '').trim();
    const [rows] = await db.execute(
      "SELECT id FROM records_archives WHERE id = ? AND status = 'completed' AND deleted_at IS NULL LIMIT 1",
      [archiveId]
    );
    if (!rows?.length) return res.status(404).json({ message: 'Готовый архив не найден' });
    const token = createMediaToken({ fileId: archiveId, scope: `records-archive:${req.auth.login}` });
    res.json({ archiveId, token, expiresInMs: MEDIA_TOKEN_TTL_MS });
  } catch (error) {
    console.error('Chat POST /records/archives/download-token error:', error);
    res.status(500).json({ message: 'Не удалось подготовить скачивание архива' });
  }
});

router.get('/records/archives/:archiveId/download', async (req, res) => {
  try {
    const archiveId = decodeURIComponent(req.params.archiveId || '').trim();
    const mediaScope = String(req.mediaAuth?.scope || '');
    const tokenAuthorized = req.mediaAuth?.fileId === archiveId && mediaScope.startsWith('records-archive:');
    if (!tokenAuthorized && !hasRole(req, 'admin')) return res.status(403).json({ message: 'Недостаточно прав для скачивания архива' });
    const actorLogin = req.auth?.login || mediaScope.slice('records-archive:'.length) || 'archive-token';
    const actorRole = req.auth?.role || 'admin';
    const [rows] = await db.execute(
      `SELECT id, name, status, storage_path FROM records_archives
       WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [archiveId]
    );
    const archive = rows?.[0];
    if (!archive) return res.status(404).json({ message: 'Архив не найден' });
    if (archive.status !== 'completed' || !archive.storage_path) return res.status(409).json({ message: 'Архив ещё не готов' });
    const storageRoot = path.resolve(recordsArchiveDir);
    const filePath = path.resolve(String(archive.storage_path));
    if (filePath !== storageRoot && !filePath.startsWith(`${storageRoot}${path.sep}`)) {
      return res.status(403).json({ message: 'Некорректный путь архива' });
    }
    await fs.access(filePath);
    const downloadName = `${sanitizeFileName(archive.name || archive.id).replace(/\.zip$/i, '')}.zip`;
    return res.download(filePath, downloadName, async (error) => {
      if (error) {
        if (!res.headersSent) res.status(500).json({ message: 'Не удалось скачать архив' });
        return;
      }
      await db.execute('UPDATE records_archives SET downloaded_at = NOW() WHERE id = ?', [archiveId]).catch(() => {});
      await db.execute(
        `INSERT INTO records_audit_log (action, entity_type, entity_id, archive_id, actor_login, actor_role)
         VALUES ('archive_downloaded', 'records_archive', ?, ?, ?, ?)`,
        [archiveId, archiveId, actorLogin, actorRole]
      ).catch(() => {});
    });
  } catch (error) {
    console.error('Chat GET /records/archives/download error:', error);
    res.status(error.code === 'ENOENT' ? 404 : 500).json({ message: error.code === 'ENOENT' ? 'Файл архива не найден на диске' : 'Не удалось скачать архив' });
  }
});

router.runChatStorageMigration = migrateArchiveToMysql;
router.replayMessageJournal = replayMessageJournal;
router.repairStoredRecordFileLinks = repairStoredRecordFileLinks;

module.exports = router;
