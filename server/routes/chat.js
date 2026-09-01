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
  buildConversationMessagesPageQuery
} = require('../utils/chatState');
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
  const isFileDownload = req.method === 'GET' && /^\/files\/[^/]+\/download$/.test(req.path);
  const middleware = isFileDownload ? requireAuthAllowQueryOrMedia : (queryTokenAllowed ? requireAuthAllowQuery : requireAuth);
  return middleware(req, res, next);
});

const dataDir = path.join(__dirname, '..', 'data');
const chatFilePath = path.join(dataDir, 'chatThreads.json');
const feedFilePath = path.join(dataDir, 'employeeFeed.json');
const backupDir = path.join(dataDir, 'backups');
const uploadsDir = path.join(__dirname, '..', 'uploads');
const MAX_BACKUPS_PER_FILE = 30;
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD = 3 * 1024 * 1024;
const CHAT_SQL_PAGE_SIZE = 50;
const CHAT_SEARCH_PAGE_SIZE = 25;
const STREAM_EVENT_BUFFER_SIZE = 500;
const ORPHAN_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ALLOWED_UPLOAD_SCOPES = new Set(['chat', 'feed']);
const ALLOWED_UPLOAD_TYPES = /^(image\/|video\/|application\/pdf$|text\/plain$|application\/msword$|application\/vnd\.openxmlformats-officedocument|application\/vnd\.ms-excel$|application\/zip$)/i;
const DANGEROUS_EXTENSIONS = new Set(['.exe', '.bat', '.cmd', '.com', '.scr', '.js', '.mjs', '.sh', '.ps1', '.vbs', '.jar']);
const execFileAsync = promisify(execFile);

let cachedThreads = null;
let storageReadyPromise = null;
const streamClients = new Set();
const streamEventBuffer = [];
const typingTimers = new Map();
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
  if (chatSqlReady) return true;
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

const writeSqlMessage = async (conversationId, message = {}) => {
  if (!await ensureChatSqlSchema()) return false;
  const createdAt = normalizeMessageDate(message);
  const updatedAt = new Date(message.updatedAt || message.editedAt || message.createdAt || Date.now());
  const deletedAt = message.deletedAt ? new Date(message.deletedAt) : null;
  const params = [message.id, conversationId, message.sender || null, JSON.stringify(message), createdAt, updatedAt, deletedAt];

  await db.execute(
    `INSERT INTO chat_messages (id, conversation_id, sender_login, message_json, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       conversation_id = VALUES(conversation_id),
       sender_login = VALUES(sender_login),
       message_json = VALUES(message_json),
       created_at = VALUES(created_at),
       updated_at = VALUES(updated_at),
       deleted_at = VALUES(deleted_at)`,
    params
  );
  const [participantA = '', participantB = ''] = String(conversationId || '')
    .toLowerCase()
    .split('::')
    .map((item) => item.trim());
  const fileIds = message.deletedAt ? [] : getMessageAttachmentFileIds(message);
  await db.execute('DELETE FROM chat_message_files WHERE message_id = ?', [message.id]);
  if (fileIds.length && participantA && participantB) {
    await db.query(
      `INSERT IGNORE INTO chat_message_files
       (message_id, file_id, conversation_id, participant_a, participant_b)
       VALUES ?`,
      [fileIds.map((fileId) => [message.id, fileId, conversationId, participantA, participantB])]
    );
    if (await ensureChatFilesSqlSchema()) {
      await db.query(
        'UPDATE chat_files SET claimed_at = COALESCE(claimed_at, NOW()) WHERE id IN (?)',
        [fileIds]
      );
    }
  }
  return true;
};

const readSqlConversationMessages = async (conversationId, { limit = CHAT_SQL_PAGE_SIZE, before = '' } = {}) => {
  if (!await ensureChatSqlSchema()) return null;
  const { sql, params } = buildConversationMessagesPageQuery(conversationId, { limit, before });

  // The limit is a server-clamped integer. Keeping it out of the prepared
  // statement avoids MySQL 8.4/mysql2 LIMIT marker incompatibilities.
  const [rows] = await db.query(sql, params);

  return (rows || []).map((row) => parseSqlMessage(row.message_json)).filter(Boolean).reverse();
};

const readSqlMessageById = async (conversationId, messageId) => {
  if (!await ensureChatSqlSchema()) return null;
  const [rows] = await db.execute(
    `SELECT message_json
     FROM chat_messages
     WHERE conversation_id = ? AND id = ?
     LIMIT 1`,
    [conversationId, messageId]
  );
  return parseSqlMessage(rows?.[0]?.message_json);
};

const searchSqlConversationMessages = async (
  conversationId,
  { query = '', limit = CHAT_SEARCH_PAGE_SIZE, before = '' } = {}
) => {
  if (!await ensureChatSqlSchema()) return null;
  const normalizedQuery = String(query || '').trim().slice(0, 200);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || CHAT_SEARCH_PAGE_SIZE));
  const params = [conversationId, `%${normalizedQuery.toLowerCase()}%`, `%${normalizedQuery.toLowerCase()}%`];
  let cursorSql = '';
  if (before) {
    const beforeDate = new Date(before);
    if (Number.isNaN(beforeDate.getTime())) {
      const error = new Error('Некорректный курсор поиска');
      error.status = 400;
      throw error;
    }
    cursorSql = 'AND created_at < ?';
    params.push(beforeDate);
  }
  const [rows] = await db.query(
    `SELECT message_json, created_at
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
    .map((row) => parseSqlMessage(row.message_json))
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
    lastReadAt: row.last_read_at || row.updated_at || null
  }]));
};

const writeSqlReadState = async (conversationId, login, messageId) => {
  if (!await ensureChatSqlSchema()) return null;
  const message = await readSqlMessageById(conversationId, messageId);
  if (!message) return null;
  const readAt = normalizeMessageDate(message);
  await db.execute(
    `INSERT INTO chat_read_state
       (conversation_id, user_login, last_read_message_id, last_read_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       last_read_message_id = IF(
         last_read_at IS NULL OR VALUES(last_read_at) >= last_read_at,
         VALUES(last_read_message_id),
         last_read_message_id
       ),
       last_read_at = GREATEST(COALESCE(last_read_at, '1970-01-01'), VALUES(last_read_at)),
       updated_at = CURRENT_TIMESTAMP`,
    [conversationId, login, messageId, readAt]
  );
  return { conversationId, login, lastReadMessageId: messageId, lastReadAt: readAt.toISOString() };
};

const readSqlThreadSummaries = async (login) => {
  if (!await ensureChatSqlSchema()) return null;
  const normalizedLogin = String(login || '').trim().toLowerCase();
  if (!normalizedLogin) return {};

  const [rows] = await db.execute(
    `SELECT
       conversation_id,
       message_json,
       created_at,
       message_count,
       deleted_count,
       attachment_count
     FROM (
       SELECT
         conversation_id,
         message_json,
         created_at,
         id,
         ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY created_at DESC, id DESC) AS message_rank,
         COUNT(*) OVER (PARTITION BY conversation_id) AS message_count,
         SUM(deleted_at IS NOT NULL) OVER (PARTITION BY conversation_id) AS deleted_count,
         SUM(
           message_json LIKE '%"attachments":[%'
           OR message_json LIKE '%"attachment":{%'
         ) OVER (PARTITION BY conversation_id) AS attachment_count
       FROM chat_messages
       WHERE participant_a = ? OR participant_b = ?
     ) AS ranked_messages
     WHERE message_rank = 1
     ORDER BY created_at DESC`,
    [normalizedLogin, normalizedLogin]
  );

  return Object.fromEntries((rows || []).map((row) => {
    const lastMessage = parseSqlMessage(row.message_json);
    return [row.conversation_id, {
      conversationId: row.conversation_id,
      lastMessage,
      lastAt: lastMessage?.createdAt || row.created_at || '',
      lastTimestamp: new Date(lastMessage?.createdAt || row.created_at || 0).getTime() || 0,
      messageCount: Number(row.message_count) || 0,
      deletedCount: Number(row.deleted_count) || 0,
      attachmentsCount: Number(row.attachment_count) || 0
    }];
  }));
};

const deleteSqlConversation = async (conversationId) => {
  if (!await ensureChatSqlSchema()) return false;
  await db.execute('DELETE FROM chat_message_files WHERE conversation_id = ?', [conversationId]);
  await db.execute('DELETE FROM chat_messages WHERE conversation_id = ?', [conversationId]);
  return true;
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
      url VARCHAR(512) NOT NULL,
      thumbnail_url VARCHAR(512) NULL,
      mime_type VARCHAR(255) NOT NULL,
      size_bytes BIGINT NOT NULL,
      sha256 VARCHAR(64) NOT NULL,
      uploaded_at DATETIME NOT NULL,
      metadata_json LONGTEXT NULL,
      uploaded_by VARCHAR(255) NULL,
      claimed_at DATETIME NULL,
      is_verified TINYINT(1) NOT NULL DEFAULT 1,
      deleted_at DATETIME NULL,
      INDEX idx_chat_files_scope (scope),
      INDEX idx_chat_files_uploaded_at (uploaded_at),
      INDEX idx_chat_files_claimed_at (claimed_at)
    )`);
    await db.execute('ALTER TABLE chat_files ADD COLUMN uploaded_by VARCHAR(255) NULL').catch(() => {});
    await db.execute('ALTER TABLE chat_files ADD COLUMN claimed_at DATETIME NULL').catch(() => {});
    await db.execute('CREATE INDEX idx_chat_files_claimed_at ON chat_files (claimed_at)').catch(() => {});
    await db.execute('ALTER TABLE chat_files ADD COLUMN is_verified TINYINT(1) NOT NULL DEFAULT 1').catch(() => {});
    await db.execute('ALTER TABLE chat_files ADD COLUMN deleted_at DATETIME NULL').catch(() => {});

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
  const params = [
    file.id,
    file.scope,
    file.originalName || file.name,
    file.storedName,
    file.url,
    file.thumbnailUrl || null,
    file.type,
    file.size,
    file.sha256,
    new Date(file.uploadedAt || Date.now()),
    metadata,
    file.uploadedBy || null,
    file.claimedAt ? new Date(file.claimedAt) : null,
    file.isVerified !== false,
    file.deletedAt ? new Date(file.deletedAt) : null
  ];

  const mysqlParams = [...params];
  mysqlParams[13] = file.isVerified === false ? 0 : 1;
  await db.execute(
    `INSERT INTO chat_files (
      id, scope, original_name, stored_name, url, thumbnail_url, mime_type, size_bytes,
      sha256, uploaded_at, metadata_json, uploaded_by, claimed_at, is_verified, deleted_at
    )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       scope = VALUES(scope),
       original_name = VALUES(original_name),
       stored_name = VALUES(stored_name),
       url = VALUES(url),
       thumbnail_url = VALUES(thumbnail_url),
       mime_type = VALUES(mime_type),
       size_bytes = VALUES(size_bytes),
       sha256 = VALUES(sha256),
       uploaded_at = VALUES(uploaded_at),
       metadata_json = VALUES(metadata_json),
       uploaded_by = VALUES(uploaded_by),
       claimed_at = COALESCE(VALUES(claimed_at), claimed_at),
       is_verified = VALUES(is_verified),
       deleted_at = VALUES(deleted_at)`,
    mysqlParams
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
    const mime = filePart.type || fields.type || 'application/octet-stream';
    const safeOriginalName = sanitizeFileName(fields.name || filePart.filename || 'file');
    const ext = path.extname(safeOriginalName).toLowerCase();
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
    const file = { id: fileId, scope: safeScope, name: safeOriginalName, type: mime, size: filePart.size, url, thumbnailUrl, originalName: fields.name || filePart.filename, uploadedBy: req.auth.login, storedName, thumbnailStoredName, sha256: filePart.hash.digest('hex'), width: Math.max(0, Number(fields.width) || 0), height: Math.max(0, Number(fields.height) || 0), aspectRatio: Math.max(0, Number(fields.aspectRatio) || 0), duration: Math.max(0, Number(fields.duration) || 0), isVerified: true, uploadedAt: new Date().toISOString() };
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
    thumbnailStoredName,
    type: mime,
    size: fileData.length,
    sha256,
    url: `/api/chat/files/${encodeURIComponent(fileId)}/download`,
    thumbnailUrl,
    uploadedBy: attachment.uploadedBy || '',
    uploadedAt: attachment.uploadedAt || new Date().toISOString(),
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

const getRequestIdentity = (req) => req.auth || null;
const getRequestLogin = (req) => getRequestIdentity(req)?.login || '';

const requireConversationAccess = (req, res, conversationId) => {
  const login = getRequestLogin(req);
  if (!login) {
    res.status(401).json({ message: 'Для доступа к переписке требуется вход' });
    return '';
  }
  if (!isConversationParticipant(conversationId, login)) {
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
  'id', 'scope', 'original_name', 'stored_name', 'url', 'thumbnail_url',
  'mime_type', 'size_bytes', 'sha256', 'uploaded_at', 'metadata_json',
  'uploaded_by', 'claimed_at', 'is_verified', 'deleted_at'
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

const getFeedAttachmentsFromPost = (post = {}) => [
  ...(Array.isArray(post.attachments) ? post.attachments : []),
  post.attachment || null
].filter(Boolean);

const resolveStoredDownload = (file = {}, variant = '') => {
  const metadata = parseFileMetadataJson(file.metadata_json);
  const scope = ALLOWED_UPLOAD_SCOPES.has(file.scope) ? file.scope : 'chat';
  const storedName = variant === 'thumbnail'
    ? (metadata.thumbnailStoredName || path.basename(decodeURIComponent(String(file.thumbnail_url || '').split('?')[0] || '')))
    : file.stored_name;
  const fileName = variant === 'thumbnail' ? `thumb-${file.original_name || file.id}.jpg` : (file.original_name || file.id);
  const mime = variant === 'thumbnail' ? 'image/jpeg' : file.mime_type;
  if (!storedName) return null;
  const safeBase = path.basename(storedName);
  const filePath = path.join(uploadsDir, scope, safeBase);
  if (!filePath.startsWith(path.join(uploadsDir, scope))) return null;
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
     LEFT JOIN feed_posts AS feed_posts ON feed_posts.id = feed_links.post_id AND feed_posts.deleted_at IS NULL
     WHERE files.deleted_at IS NULL
       AND files.uploaded_at < ?
       AND links.file_id IS NULL
       AND feed_posts.id IS NULL
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
  const access = isUploader ? true : (file.scope === 'feed'
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
  await db.execute('DELETE FROM feed_post_files WHERE post_id = ?', [post.id]);
  if (!post.deletedAt && fileIds.length) {
    await db.query('INSERT IGNORE INTO feed_post_files (post_id, file_id) VALUES ?', [fileIds.map((fileId) => [post.id, fileId])]);
  }
  if (fileIds.length && await ensureChatFilesSqlSchema()) {
    await db.query('UPDATE chat_files SET claimed_at = COALESCE(claimed_at, NOW()) WHERE id IN (?)', [fileIds]);
  }
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
  const safeLimit = Math.min(5, Math.max(1, Number(limit) || 3));
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

const backupMessageToArchive = (conversationId, message) => {
  mutateThreads((threads) => {
    const currentMessages = Array.isArray(threads[conversationId]) ? threads[conversationId] : [];
    const exists = currentMessages.some((item) => item.id === message.id);
    threads[conversationId] = exists
      ? currentMessages.map((item) => (item.id === message.id ? { ...item, ...message } : item))
      : [...currentMessages, message];
    return threads;
  }).catch((error) => {
    console.warn('Chat JSON backup write failed:', error.message);
  });
};

const replaceArchiveConversation = (conversationId, messages) => {
  mutateThreads((threads) => ({ ...threads, [conversationId]: messages }))
    .catch((error) => console.warn('Chat JSON backup replace failed:', error.message));
};

const removeArchiveConversation = (conversationId) => {
  mutateThreads((threads) => {
    delete threads[conversationId];
    return threads;
  }).catch((error) => console.warn('Chat JSON backup delete failed:', error.message));
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
    const migratedThreads = cloneThreads(threads);
    const messages = Object.entries(threads || {}).flatMap(([conversationId, items]) => (
      (Array.isArray(items) ? items : [])
        .filter((message) => message?.id)
        .map((message) => ({ conversationId, message }))
    ));
    const feedPosts = (Array.isArray(posts) ? posts : []).filter((post) => post?.id);

    await runWithConcurrency(messages, async ({ conversationId, message }) => {
      const preparedMessage = (await prepareMessageForResponse(message)).message;
      await writeSqlMessage(conversationId, preparedMessage);
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

    if (migratedFiles || messages.length || feedPosts.length) {
      console.log(`MySQL archive migration completed: ${messages.length} archived messages, ${(sqlMessageRows || []).length} indexed messages, ${feedPosts.length} feed posts, ${migratedFiles} stored files.`);
    }
  })().catch((error) => {
    archiveMigrationPromise = null;
    throw error;
  });

  return archiveMigrationPromise;
};



router.post('/storage/recover', requireRole('admin'), async (req, res) => {
  try {
    const target = req.body?.target === 'threads' ? 'threads' : 'feed';
    const filePath = target === 'threads' ? chatFilePath : feedFilePath;
    const validate = target === 'threads' ? isPlainObject : Array.isArray;
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
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 50));
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

router.put('/feed', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { posts } = req.body;
    if (!Array.isArray(posts)) {
      return res.status(400).json({ message: 'posts должен быть массивом' });
    }

    if (!await ensureFeedSqlSchema()) {
      return res.status(503).json({ message: 'Хранилище ленты временно недоступно' });
    }
    await runWithConcurrency(posts.filter((post) => post?.id), (post) => writeSqlFeedPost(post), 4);
    await writeFeed(posts, { allowEmpty: req.query.force === '1' });
    res.json({ message: 'Лента сохранена', posts, storage: 'mysql' });
  } catch (error) {
    console.error('Chat PUT /feed error:', error);
    res.status(500).json({ message: 'Не удалось сохранить ленту' });
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
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 50));
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
        { ...summary, lastMessage: stripInlinePayloads(summary.lastMessage) }
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
    const query = String(req.query?.q || '').trim();
    if (query.length < 2) {
      return res.status(400).json({ message: 'Для поиска введите минимум два символа' });
    }
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit) || CHAT_SEARCH_PAGE_SIZE));
    const messages = await searchSqlConversationMessages(conversationId, {
      query,
      limit,
      before: req.query?.before || ''
    });
    if (!Array.isArray(messages)) {
      return res.status(503).json({ message: 'Хранилище сообщений временно недоступно' });
    }
    const before = messages[messages.length - 1]?.createdAt || '';
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

router.get('/threads/:conversationId/messages', async (req, res) => {
  try {
    const conversationId = decodeURIComponent(req.params.conversationId || '').trim();
    if (!conversationId) return res.status(400).json({ message: 'conversationId обязателен' });
    if (!requireConversationAccess(req, res, conversationId)) return;
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || CHAT_SQL_PAGE_SIZE));
    const before = req.query?.before || '';
    const messages = await readSqlConversationMessages(conversationId, { limit, before });
    if (!Array.isArray(messages)) {
      return res.status(503).json({ message: 'Хранилище сообщений временно недоступно' });
    }
    const publicMessages = stripInlinePayloads(messages);
    const earliest = messages[0]?.createdAt || '';
    res.set('Cache-Control', 'no-store');
    res.json({ conversationId, messages: publicMessages, hasMore: messages.length >= limit, before: earliest, storage: 'mysql' });
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
    broadcastThreadEvent('read-state-updated', conversationId, { state }, { excludeLogin: req.auth.login });
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

    const lastEventId = String(req.headers['last-event-id'] || req.query?.last_event_id || '').trim();
    const numericLastEventId = Number(lastEventId) || 0;
    streamEventBuffer
      .filter((event) => Number(event.id) > numericLastEventId)
      .filter((event) => canReceiveBufferedEvent(event, login))
      .filter((event) => !isSameLogin(event.excludeLogin, login))
      .forEach((event) => writeStreamEvent(res, event.name, event.payload, event.id));
    writeStreamEvent(res, 'ready', {
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

    if (!message || typeof message !== 'object' || !message.id) {
      return res.status(400).json({ message: 'message обязателен' });
    }
    const preparedMessage = (await prepareMessageForResponse({
      ...message,
      sender: req.auth.login,
      audit: []
    })).message;

    const existingMessage = await readSqlMessageById(conversationId, preparedMessage.id);
    const exists = Boolean(existingMessage);
    if (existingMessage && !isSameLogin(existingMessage.sender, req.auth.login)) {
      return res.status(403).json({ message: 'Нельзя перезаписать чужое сообщение' });
    }
    const savedItem = existingMessage
      ? { ...existingMessage, ...preparedMessage, sender: existingMessage.sender, audit: existingMessage.audit || [] }
      : preparedMessage;
    const stored = await writeSqlMessage(conversationId, savedItem);
    if (!stored) return res.status(503).json({ message: 'Хранилище сообщений временно недоступно' });
    backupMessageToArchive(conversationId, savedItem);

    broadcastThreadEvent(exists ? 'message-updated' : 'message-created', conversationId, { item: savedItem });
    res.status(exists ? 200 : 201).json({ message: exists ? 'Сообщение обновлено' : 'Сообщение добавлено', conversationId, item: savedItem });
  } catch (error) {
    console.error('Chat POST /threads/messages error:', error);
    res.status(500).json({ message: 'Не удалось сохранить сообщение' });
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

    if (!patch || typeof patch !== 'object') {
      return res.status(400).json({ message: 'message или patch обязателен' });
    }
    const existingMessage = await readSqlMessageById(conversationId, messageId);
    if (!existingMessage) return res.status(404).json({ message: 'Сообщение не найдено' });
    const canEditContent = isSameLogin(existingMessage.sender, req.auth.login) || hasRole(req, 'admin', 'manager');
    const contentFields = ['text', 'attachment', 'attachments', 'deletedAt'];
    const attemptsContentChange = contentFields.some((field) => (
      Object.prototype.hasOwnProperty.call(patch, field)
      && JSON.stringify(patch[field] ?? null) !== JSON.stringify(existingMessage[field] ?? null)
    ));
    if (attemptsContentChange && !canEditContent) {
      return res.status(403).json({ message: 'Нельзя изменять или удалять чужое сообщение' });
    }

    const now = new Date().toISOString();
    const nextMessage = {
      ...existingMessage,
      reactions: patch.reactions && typeof patch.reactions === 'object'
        ? mergeActorReactionState(existingMessage.reactions, patch.reactions, req.auth.login)
        : existingMessage.reactions,
      pinned: typeof patch.pinned === 'boolean' ? patch.pinned : existingMessage.pinned,
      readAt: patch.readAt || existingMessage.readAt || null,
      id: existingMessage.id,
      sender: existingMessage.sender
    };
    if (canEditContent) {
      contentFields.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(patch, field)) nextMessage[field] = patch[field];
      });
      if (Object.prototype.hasOwnProperty.call(patch, 'editedAt')) nextMessage.editedAt = patch.editedAt;
      if (Object.prototype.hasOwnProperty.call(patch, 'deliveryStatus')) nextMessage.deliveryStatus = patch.deliveryStatus;
      if (attemptsContentChange) {
        nextMessage.editedBy = req.auth.login;
        if (patch.deletedAt) nextMessage.deletedBy = req.auth.login;
        nextMessage.audit = [
          ...(Array.isArray(existingMessage.audit) ? existingMessage.audit : []),
          {
            action: patch.deletedAt ? 'delete' : 'edit',
            by: req.auth.login,
            role: req.auth.role,
            at: now
          }
        ];
      }
    }
    const updatedItem = (await prepareMessageForResponse(nextMessage)).message;
    const stored = await writeSqlMessage(conversationId, updatedItem);
    if (!stored) return res.status(503).json({ message: 'Хранилище сообщений временно недоступно' });
    backupMessageToArchive(conversationId, updatedItem);

    broadcastThreadEvent('message-updated', conversationId, { item: updatedItem });
    res.json({ message: 'Сообщение обновлено', conversationId, item: updatedItem });
  } catch (error) {
    console.error('Chat PATCH /threads/messages error:', error);
    res.status(500).json({ message: 'Не удалось обновить сообщение' });
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
    if (!await ensureChatSqlSchema()) {
      return res.status(503).json({ message: 'Хранилище сообщений временно недоступно' });
    }
    connection = await db.getConnection();
    const [rows] = await connection.query(
      'SELECT id, sender_login FROM chat_messages WHERE conversation_id = ? AND id IN (?)',
      [conversationId, messageIds]
    );
    if (rows.length !== messageIds.length) {
      return res.status(404).json({ message: 'Часть сообщений не найдена' });
    }
    if (
      !hasRole(req, 'admin', 'manager')
      && rows.some((row) => !isSameLogin(row.sender_login, req.auth.login))
    ) {
      return res.status(403).json({ message: 'Нельзя удалять чужие сообщения' });
    }

    const deletedAt = new Date().toISOString();
    await connection.beginTransaction();
    await connection.query(
      `UPDATE chat_messages
       SET message_json = JSON_SET(
             JSON_REMOVE(CAST(message_json AS JSON), '$.attachment', '$.attachments'),
             '$.text', '',
             '$.deletedAt', ?,
             '$.deletedBy', ?,
             '$.updatedAt', ?
           ),
           deleted_at = ?,
           updated_at = ?
       WHERE conversation_id = ? AND id IN (?)`,
      [deletedAt, req.auth.login, deletedAt, new Date(deletedAt), new Date(deletedAt), conversationId, messageIds]
    );
    await connection.query(
      'DELETE FROM chat_message_files WHERE conversation_id = ? AND message_id IN (?)',
      [conversationId, messageIds]
    );
    await connection.commit();
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

router.put('/threads/:conversationId', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const conversationId = decodeURIComponent(req.params.conversationId || '').trim();
    const { messages } = req.body;

    if (!conversationId) {
      return res.status(400).json({ message: 'conversationId обязателен' });
    }
    if (!requireConversationAccess(req, res, conversationId)) return;

    if (!Array.isArray(messages)) {
      return res.status(400).json({ message: 'messages должен быть массивом' });
    }
    const preparedMessages = await Promise.all(messages.map(async (message) => (
      (await prepareMessageForResponse(message)).message
    )));

    const writeResults = await Promise.all(
      preparedMessages
        .filter((message) => message?.id)
        .map((message) => writeSqlMessage(conversationId, message))
    );
    if (writeResults.some((stored) => !stored)) {
      return res.status(503).json({ message: 'Хранилище сообщений временно недоступно' });
    }
    replaceArchiveConversation(conversationId, preparedMessages);

    broadcastThreadEvent('conversation-refresh', conversationId);
    res.json({ message: 'Сохранено', conversationId });
  } catch (error) {
    console.error('Chat PUT /threads error:', error);
    res.status(500).json({ message: 'Не удалось сохранить сообщения' });
  }
});

router.delete('/threads/:conversationId', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const conversationId = decodeURIComponent(req.params.conversationId || '').trim();
    if (!conversationId) {
      return res.status(400).json({ message: 'conversationId обязателен' });
    }
    if (!requireConversationAccess(req, res, conversationId)) return;

    const deleted = await deleteSqlConversation(conversationId);
    if (!deleted) return res.status(503).json({ message: 'Хранилище сообщений временно недоступно' });
    removeArchiveConversation(conversationId);

    broadcastThreadEvent('conversation-delete', conversationId);
    res.json({ message: 'Переписка удалена', conversationId });
  } catch (error) {
    console.error('Chat DELETE /threads error:', error);
    res.status(500).json({ message: 'Не удалось удалить переписку' });
  }
});

router.runChatStorageMigration = migrateArchiveToMysql;

module.exports = router;
