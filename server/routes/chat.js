const express = require('express');
const fsSync = require('fs');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/database');
const {
  createSerialMutationQueue,
  mergeFeedComments,
  mergeFeedPosts,
  setReactionState
} = require('../utils/feedState');
const {
  isMysqlDatabase,
  mergeThreadMessages,
  groupThreadSnapshotRows
} = require('../utils/chatState');
const { verifyAccessToken } = require('../utils/accessToken');

const router = express.Router();

const dataDir = path.join(__dirname, '..', 'data');
const chatFilePath = path.join(dataDir, 'chatThreads.json');
const feedFilePath = path.join(dataDir, 'employeeFeed.json');
const backupDir = path.join(dataDir, 'backups');
const uploadsDir = path.join(__dirname, '..', 'uploads');
const MAX_BACKUPS_PER_FILE = 30;
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;
const CHAT_SQL_PAGE_SIZE = 50;
const ALLOWED_UPLOAD_SCOPES = new Set(['chat', 'feed']);
const ALLOWED_UPLOAD_TYPES = /^(image\/|video\/|application\/pdf$|text\/plain$|application\/msword$|application\/vnd\.openxmlformats-officedocument|application\/vnd\.ms-excel$|application\/zip$)/i;
const DANGEROUS_EXTENSIONS = new Set(['.exe', '.bat', '.cmd', '.com', '.scr', '.js', '.mjs', '.sh', '.ps1', '.vbs', '.jar']);

let cachedThreads = null;
let storageReadyPromise = null;
let feedSqlWriteQueue = Promise.resolve();
const streamClients = new Set();

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
  return true;
};

const readSqlConversationMessages = async (conversationId, { limit = CHAT_SQL_PAGE_SIZE, before = '' } = {}) => {
  if (!await ensureChatSqlSchema()) return null;
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || CHAT_SQL_PAGE_SIZE));
  const params = [conversationId];
  let rows;

  let where = 'conversation_id = ?';
  if (before) {
    where += ' AND created_at < ?';
    params.push(new Date(before));
  }
  params.push(safeLimit);
  [rows] = await db.execute(
    `SELECT message_json FROM chat_messages WHERE ${where} ORDER BY created_at DESC LIMIT ?`,
    params
  );

  return (rows || []).map((row) => parseSqlMessage(row.message_json)).filter(Boolean).reverse();
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
      is_verified TINYINT(1) NOT NULL DEFAULT 1,
      deleted_at DATETIME NULL,
      file_data LONGBLOB NULL,
      thumbnail_data LONGBLOB NULL,
      INDEX idx_chat_files_scope (scope),
      INDEX idx_chat_files_uploaded_at (uploaded_at)
    )`);
    await db.execute('ALTER TABLE chat_files ADD COLUMN uploaded_by VARCHAR(255) NULL').catch(() => {});
    await db.execute('ALTER TABLE chat_files ADD COLUMN is_verified TINYINT(1) NOT NULL DEFAULT 1').catch(() => {});
    await db.execute('ALTER TABLE chat_files ADD COLUMN deleted_at DATETIME NULL').catch(() => {});
    await db.execute('ALTER TABLE chat_files ADD COLUMN file_data LONGBLOB NULL').catch(() => {});
    await db.execute('ALTER TABLE chat_files ADD COLUMN thumbnail_data LONGBLOB NULL').catch(() => {});

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
  const metadata = JSON.stringify({ name: file.name, thumbnailUrl: file.thumbnailUrl || null, thumbnailStoredName: file.thumbnailStoredName || '' });
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
    file.isVerified !== false,
    file.deletedAt ? new Date(file.deletedAt) : null,
    file.fileData || null,
    file.thumbnailData || null
  ];

  const mysqlParams = [...params];
  mysqlParams[12] = file.isVerified === false ? 0 : 1;
  await db.execute(
    `INSERT INTO chat_files (
      id, scope, original_name, stored_name, url, thumbnail_url, mime_type, size_bytes,
      sha256, uploaded_at, metadata_json, uploaded_by, is_verified, deleted_at, file_data, thumbnail_data
    )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
       is_verified = VALUES(is_verified),
       deleted_at = VALUES(deleted_at),
       file_data = COALESCE(VALUES(file_data), file_data),
       thumbnail_data = COALESCE(VALUES(thumbnail_data), thumbnail_data)`,
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

const splitBuffer = (buffer, separator) => {
  const parts = [];
  let start = 0;
  let index = buffer.indexOf(separator, start);
  while (index !== -1) {
    parts.push(buffer.slice(start, index));
    start = index + separator.length;
    index = buffer.indexOf(separator, start);
  }
  parts.push(buffer.slice(start));
  return parts;
};

const trimPartBreaks = (buffer) => {
  let start = 0;
  let end = buffer.length;
  if (buffer.slice(0, 2).equals(Buffer.from('\r\n'))) start = 2;
  if (buffer.slice(end - 2, end).equals(Buffer.from('\r\n'))) end -= 2;
  if (buffer.slice(end - 2, end).equals(Buffer.from('--'))) end -= 2;
  return buffer.slice(start, end);
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

const readMultipartRequestToTemp = async (req, tempPath) => new Promise((resolve, reject) => {
  let total = 0;
  const output = fsSync.createWriteStream(tempPath, { flags: 'wx' });
  const fail = (error) => {
    req.destroy();
    output.destroy();
    reject(error);
  };

  req.on('data', (chunk) => {
    total += chunk.length;
    if (total > MAX_UPLOAD_SIZE + 5 * 1024 * 1024) {
      const error = new Error(`Файл должен быть не больше ${Math.round(MAX_UPLOAD_SIZE / 1024 / 1024)} МБ`);
      error.status = 413;
      fail(error);
    }
  });
  req.on('error', reject);
  output.on('error', reject);
  output.on('finish', () => resolve(total));
  req.pipe(output);
});

const parseMultipartParts = (rawBuffer, boundary) => {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const fields = {};
  let filePart = null;

  splitBuffer(rawBuffer, boundaryBuffer).forEach((rawPart) => {
    const part = trimPartBreaks(rawPart);
    if (!part.length) return;
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) return;
    const headerText = part.slice(0, headerEnd).toString('utf8');
    const body = part.slice(headerEnd + 4);
    const headers = Object.fromEntries(headerText.split('\r\n').map((line) => {
      const separator = line.indexOf(':');
      if (separator === -1) return ['', ''];
      return [line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()];
    }).filter(([key]) => key));
    const disposition = parseContentDisposition(headers['content-disposition'] || '');
    const fieldName = disposition.name;
    if (!fieldName) return;
    if (disposition.filename !== undefined) {
      filePart = { fieldName, filename: disposition.filename || 'file', type: headers['content-type'] || 'application/octet-stream', buffer: trimPartBreaks(body) };
    } else {
      fields[fieldName] = trimPartBreaks(body).toString('utf8');
    }
  });

  return { fields, filePart };
};

const saveMultipartUpload = async (req) => {
  const boundary = getMultipartBoundary(req.headers['content-type']);
  if (!boundary) {
    const error = new Error('Неверный формат multipart/form-data');
    error.status = 400;
    throw error;
  }

  const tempDir = path.join(uploadsDir, 'tmp');
  await fs.mkdir(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.multipart`);

  try {
    await readMultipartRequestToTemp(req, tempPath);
    const raw = await fs.readFile(tempPath);
    const { fields, filePart } = parseMultipartParts(raw, boundary);
    if (!filePart?.buffer?.length) {
      const error = new Error('Файл не передан');
      error.status = 400;
      throw error;
    }

    const safeScope = ALLOWED_UPLOAD_SCOPES.has(fields.scope) ? fields.scope : 'chat';
    const mime = filePart.type || fields.type || 'application/octet-stream';
    if (!ALLOWED_UPLOAD_TYPES.test(mime)) {
      const error = new Error('Этот тип файла запрещён');
      error.status = 400;
      throw error;
    }

    const safeOriginalName = sanitizeFileName(fields.name || filePart.filename || 'file');
    const ext = path.extname(safeOriginalName).toLowerCase();
    if (DANGEROUS_EXTENSIONS.has(ext) || !hasAllowedMagicBytes(filePart.buffer, mime, ext)) {
      const error = new Error('Этот тип файла запрещён');
      error.status = 400;
      throw error;
    }

    if (filePart.buffer.length > MAX_UPLOAD_SIZE || Number(fields.size || filePart.buffer.length) > MAX_UPLOAD_SIZE) {
      const error = new Error(`Файл должен быть не больше ${Math.round(MAX_UPLOAD_SIZE / 1024 / 1024)} МБ`);
      error.status = 413;
      throw error;
    }

    const uploadDir = path.join(uploadsDir, safeScope);
    await fs.mkdir(uploadDir, { recursive: true });
    const storedName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeOriginalName}`;
    await fs.writeFile(path.join(uploadDir, storedName), filePart.buffer);
    const sha256 = crypto.createHash('sha256').update(filePart.buffer).digest('hex');
    const fileId = createId('file');
    const url = `/api/chat/files/${encodeURIComponent(fileId)}/download`;
    let thumbnailStoredName = '';
    let thumbnailData = null;
    // A video file itself is not a valid poster image. Keep the poster empty when
    // client-side frame extraction failed so the browser can render the first frame.
    let thumbnailUrl = String(mime).startsWith('image/') ? url : '';

    if ((String(mime).startsWith('image/') || String(mime).startsWith('video/')) && fields.thumbnailDataUrl) {
      const thumbnailParsed = getDataUrlPayload(fields.thumbnailDataUrl);
      if (thumbnailParsed && String(thumbnailParsed.mime || '').startsWith('image/')) {
        thumbnailData = Buffer.from(thumbnailParsed.payload, 'base64');
        if (thumbnailData.length > 0 && thumbnailData.length <= 2 * 1024 * 1024) {
          const thumbnailName = `thumb-${storedName.replace(/\.[^.]+$/, '')}.jpg`;
          await fs.writeFile(path.join(uploadDir, thumbnailName), thumbnailData);
          thumbnailStoredName = thumbnailName;
          thumbnailUrl = `/api/chat/files/${encodeURIComponent(fileId)}/download?variant=thumbnail`;
        } else {
          thumbnailData = null;
        }
      }
    }

    const file = {
      id: fileId,
      scope: safeScope,
      name: safeOriginalName,
      type: mime,
      size: filePart.buffer.length,
      url,
      thumbnailUrl,
      originalName: fields.name || filePart.filename,
      uploadedBy: String(fields.uploadedBy || fields.login || '').trim().toLowerCase(),
      storedName,
      thumbnailStoredName,
      sha256,
      fileData: filePart.buffer,
      thumbnailData,
      isVerified: true,
      uploadedAt: new Date().toISOString()
    };

    const sqlSaved = await writeSqlFileMetadata(file);
    if (!sqlSaved) {
      const error = new Error('Постоянное хранилище файлов временно недоступно');
      error.status = 503;
      throw error;
    }

    const publicFile = { ...file };
    delete publicFile.fileData;
    delete publicFile.thumbnailData;
    return publicFile;
  } finally {
    await fs.unlink(tempPath).catch(() => {});
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
  const nextMessage = {
    ...message,
    attachment: nextAttachments[0] || null,
    attachments: nextAttachments
  };
  delete nextMessage.file;
  delete nextMessage.files;
  return {
    message: stripInlinePayloads(nextMessage),
    changed: prepared.some((item) => item.changed)
  };
};

const prepareConversationForResponse = async (conversationId, messages = []) => {
  const prepared = await Promise.all((Array.isArray(messages) ? messages : []).map(prepareMessageForResponse));
  const changedMessages = prepared.filter((item) => item.changed).map((item) => item.message);

  if (changedMessages.length) {
    await Promise.all(changedMessages.filter((message) => message?.id).map((message) => (
      writeSqlMessage(conversationId, message).catch((error) => {
        console.warn('Legacy inline attachment SQL migration failed:', error.message);
        return false;
      })
    )));
    setImmediate(() => {
      mutateThreads((threads) => {
        const replacements = new Map(changedMessages.map((message) => [message.id, message]));
        const current = Array.isArray(threads[conversationId]) ? threads[conversationId] : [];
        threads[conversationId] = current.map((message) => replacements.get(message.id) || message);
        return threads;
      }).catch((error) => {
        console.warn('Legacy inline attachment archive migration failed:', error.message);
      });
    });
  }

  return prepared.map((item) => item.message);
};


const getRequestAccessToken = (req) => {
  const authorization = String(req.headers.authorization || '');
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  return bearer || String(req.query?.access_token || '');
};

const getRequestIdentity = (req) => verifyAccessToken(getRequestAccessToken(req));
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

const readSqlFileMetadata = async (fileId) => {
  if (!await ensureChatFilesSqlSchema()) return null;
  const [rows] = await db.execute('SELECT * FROM chat_files WHERE id = ? LIMIT 1', [fileId]);
  return rows?.[0] || null;
};

const getMessageAttachments = (message = {}) => [
  ...(Array.isArray(message.attachments) ? message.attachments : []),
  ...(Array.isArray(message.files) ? message.files : []),
  message.attachment || null,
  message.file || null
].filter(Boolean);

const fileMatchesAttachment = (attachment = {}, file = {}) => {
  const values = new Set([
    attachment.id,
    attachment.fileId,
    attachment.url,
    attachment.thumbnailUrl,
    attachment.previewUrl,
    attachment.originalUrl
  ].filter(Boolean).map(String));
  return [file.id, file.url, file.thumbnail_url].filter(Boolean).some((value) => values.has(String(value)));
};

const isConversationParticipant = (conversationId = '', login = '') => conversationId
  .toLowerCase()
  .split('::')
  .map((item) => item.trim())
  .includes(String(login || '').toLowerCase());

const findChatFileReference = async (file, login) => {
  const archiveThreads = await ensureThreadsCache();
  const fileNeedles = [file.id, file.url, file.thumbnail_url].filter(Boolean).map(String);
  const sqlRows = fileNeedles.length && await ensureChatSqlSchema()
    ? await db.execute(
      `SELECT conversation_id, message_json
       FROM chat_messages
       WHERE (participant_a = ? OR participant_b = ?)
         AND (${fileNeedles.map(() => 'message_json LIKE ?').join(' OR ')})`,
      [login, login, ...fileNeedles.map((value) => `%${value.replace(/[\\%_]/g, '\\$&')}%`)]
    ).then(([rows]) => rows).catch(() => [])
    : [];
  const sqlThreads = groupThreadSnapshotRows(sqlRows);
  const threadIds = new Set([
    ...Object.keys(archiveThreads || {}).filter((conversationId) => isConversationParticipant(conversationId, login)),
    ...Object.keys(sqlThreads || {})
  ]);
  for (const conversationId of threadIds) {
    const messages = mergeThreadMessages(
      Array.isArray(archiveThreads[conversationId]) ? archiveThreads[conversationId] : [],
      Array.isArray(sqlThreads?.[conversationId]) ? sqlThreads[conversationId] : []
    );
    const found = messages.some((message) => !message.deletedAt && getMessageAttachments(message).some((attachment) => !attachment.deletedAt && fileMatchesAttachment(attachment, file)));
    if (found) return { conversationId };
  }
  return null;
};

const findFeedFileReference = async (file) => {
  const archivePosts = getVisibleFeedPosts(await readFeed());
  const sqlPosts = await readSqlFeedPosts({ limit: 100, commentsLimit: 2 }).catch(() => null);
  return [...archivePosts, ...(Array.isArray(sqlPosts) ? sqlPosts : [])].some((post) => (
    post && !post.deletedAt && getFeedAttachmentsFromPost(post).some((attachment) => fileMatchesAttachment(attachment, file))
  ));
};

const getFeedAttachmentsFromPost = (post = {}) => [
  ...(Array.isArray(post.attachments) ? post.attachments : []),
  post.attachment || null
].filter(Boolean);

const resolveStoredDownload = (file = {}, variant = '') => {
  const metadata = parseFileMetadataJson(file.metadata_json);
  const scope = ALLOWED_UPLOAD_SCOPES.has(file.scope) ? file.scope : 'chat';
  const storedData = variant === 'thumbnail' ? file.thumbnail_data : file.file_data;
  const data = Buffer.isBuffer(storedData)
    ? storedData
    : (storedData?.data && Array.isArray(storedData.data) ? Buffer.from(storedData.data) : null);
  const storedName = variant === 'thumbnail'
    ? (metadata.thumbnailStoredName || path.basename(decodeURIComponent(String(file.thumbnail_url || '').split('?')[0] || '')))
    : file.stored_name;
  const fileName = variant === 'thumbnail' ? `thumb-${file.original_name || file.id}.jpg` : (file.original_name || file.id);
  const mime = variant === 'thumbnail' ? 'image/jpeg' : file.mime_type;
  if (data?.length) return { data, fileName, mime };
  if (!storedName) return null;
  const safeBase = path.basename(storedName);
  const filePath = path.join(uploadsDir, scope, safeBase);
  if (!filePath.startsWith(path.join(uploadsDir, scope))) return null;
  return { filePath, fileName, mime };
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
    : await findChatFileReference(file, login));
  if (!access) {
    const error = new Error('Нет прав на скачивание файла');
    error.status = 403;
    throw error;
  }

  return file;
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
const getVisibleFeedPosts = (posts = []) => (Array.isArray(posts) ? posts.filter((post) => post && !post.deletedAt) : []);

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

const queueFeedSqlWrite = (operation) => {
  const run = feedSqlWriteQueue
    .catch(() => {})
    .then(operation);
  feedSqlWriteQueue = run;
  return run;
};

const scheduleFeedSqlWrite = (label, operation) => {
  queueFeedSqlWrite(operation).catch((error) => {
    console.warn(`${label}:`, error.message);
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

    feedSqlReady = true;
    feedSqlRetryAt = 0;
    return true;
  })()
    .catch((error) => {
      feedSqlReady = false;
      feedSqlRetryAt = Date.now() + 30_000;
      console.warn('Feed SQL storage unavailable, using JSON feed archive:', error.message);
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

const deleteSqlFeedComment = async (postId, commentId, deletedBy = 'system') => {
  if (!await ensureFeedSqlSchema()) return false;
  const deletedAt = new Date();
  const [rows] = await db.execute('SELECT comment_json FROM feed_comments WHERE post_id = ? AND id = ? LIMIT 1', [postId, commentId]);
  const existing = parseSqlJson(rows?.[0]?.comment_json) || { id: commentId };
  const nextComment = { ...existing, deletedAt: deletedAt.toISOString(), deletedBy, updatedAt: deletedAt.toISOString() };
  return writeSqlFeedComment(postId, nextComment);
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
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 3));
  const params = [postId];
  let where = 'post_id = ? AND deleted_at IS NULL';
  if (before) {
    where += ' AND created_at < ?';
    params.push(new Date(before));
  }
  params.push(safeLimit);
  const [rows] = await db.execute(`SELECT comment_json FROM feed_comments WHERE ${where} ORDER BY created_at DESC LIMIT ?`, params);
  return (rows || []).map((row) => parseSqlJson(row.comment_json)).filter(Boolean).reverse();
};

const countSqlFeedComments = async (postIds = []) => {
  if (!postIds.length || !await ensureFeedSqlSchema()) return {};
  const placeholders = postIds.map(() => '?').join(',');
  const [rows] = await db.execute(`SELECT post_id, COUNT(*) AS total FROM feed_comments WHERE deleted_at IS NULL AND post_id IN (${placeholders}) GROUP BY post_id`, postIds);
  return Object.fromEntries((rows || []).map((row) => [row.post_id, Number(row.total) || 0]));
};

const readSqlFeedPosts = async ({ limit = 50, before = '', commentsLimit = 3 } = {}) => {
  if (!await ensureFeedSqlSchema()) return null;
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  let rows;
  const params = [];
  let where = 'deleted_at IS NULL';
  if (before) {
    where += ' AND created_at < ?';
    params.push(new Date(before));
  }
  params.push(safeLimit);
  [rows] = await db.execute(`SELECT post_json FROM feed_posts WHERE ${where} ORDER BY pinned DESC, created_at DESC LIMIT ?`, params);
  const posts = (rows || []).map((row) => parseSqlJson(row.post_json)).filter(Boolean);
  const postIds = posts.map((post) => post.id).filter(Boolean);
  const [reactionsByPost, commentCounts] = await Promise.all([readSqlFeedReactions(postIds), countSqlFeedComments(postIds)]);
  const commentsPairs = await Promise.all(postIds.map(async (postId) => [postId, await readSqlFeedComments(postId, { limit: commentsLimit })]));
  const commentsByPost = Object.fromEntries(commentsPairs.filter(([, comments]) => Array.isArray(comments)));
  return posts.map((post) => ({
    ...post,
    reactions: reactionsByPost[post.id] || {},
    comments: commentsByPost[post.id] || [],
    commentCount: commentCounts[post.id] || 0,
    commentsPreviewLimit: commentsLimit
  }));
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

const ensureThreadsCache = async () => {
  if (!cachedThreads) await readThreads();
  return cachedThreads || {};
};

const readArchiveConversation = async (conversationId) => {
  const threads = await ensureThreadsCache();
  return cloneThreads(Array.isArray(threads[conversationId]) ? threads[conversationId] : []);
};

const readArchiveThreadSummaries = async (login) => {
  const threads = await ensureThreadsCache();
  return Object.fromEntries(Object.entries(threads)
    .filter(([conversationId]) => isConversationParticipant(conversationId, login))
    .map(([conversationId, messages]) => {
      const items = Array.isArray(messages) ? messages : [];
      const lastMessage = [...items].sort((left, right) => (
        new Date(left?.createdAt || 0).getTime() - new Date(right?.createdAt || 0).getTime()
      )).at(-1) || null;
      return [conversationId, {
        conversationId,
        lastMessage,
        lastAt: lastMessage?.createdAt || '',
        lastTimestamp: new Date(lastMessage?.createdAt || 0).getTime() || 0,
        messageCount: items.length,
        deletedCount: items.filter((message) => Boolean(message?.deletedAt)).length,
        attachmentsCount: items.filter((message) => getMessageAttachments(message).length > 0).length
      }];
    }));
};

const broadcastThreads = () => {
  if (!streamClients.size) return;
  streamClients.forEach((client) => {
    readArchiveThreadSummaries(client.login)
      .then((summaries) => {
        client.res.write(`event: threads\ndata: ${JSON.stringify({ summaries: stripInlinePayloads(summaries) })}\n\n`);
      })
      .catch(() => {});
  });
};

const persistThreadsSnapshot = async (threads) => {
  const nextThreads = cloneThreads(threads);
  await ensureStorage();
  await atomicWriteJson(chatFilePath, nextThreads);
  cachedThreads = cloneThreads(nextThreads);
  broadcastThreads();
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
    const [threads, posts] = await Promise.all([readThreads(), readFeed()]);
    const messages = Object.entries(threads || {}).flatMap(([conversationId, items]) => (
      (Array.isArray(items) ? items : [])
        .filter((message) => message?.id)
        .map((message) => ({ conversationId, message }))
    ));
    const feedPosts = (Array.isArray(posts) ? posts : []).filter((post) => post?.id);

    await runWithConcurrency(messages, async ({ conversationId, message }) => {
      await writeSqlMessage(conversationId, message);
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

    if (messages.length || feedPosts.length) {
      console.log(`MySQL archive migration completed: ${messages.length} messages, ${feedPosts.length} feed posts.`);
    }
  })().catch((error) => {
    console.warn('MySQL archive migration skipped:', error.message);
  });

  return archiveMigrationPromise;
};

// Load the legacy backup before the first visitor opens the chat. This keeps
// the fallback instant while MySQL is being populated in the background.
setImmediate(() => {
  readThreads().catch((error) => console.warn('Chat archive preload skipped:', error.message));
});

setTimeout(() => {
  migrateArchiveToMysql();
}, 30000);



router.post('/storage/recover', async (req, res) => {
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
    const file = await ensureFileDownloadAccess(req, fileId);
    const download = resolveStoredDownload(file, req.query?.variant === 'thumbnail' ? 'thumbnail' : '');
    if (!download) return res.status(404).json({ message: 'Файл не найден' });
    res.setHeader('Content-Type', download.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(download.fileName)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    if (download.data) {
      res.setHeader('Content-Length', download.data.length);
      return res.send(download.data);
    }
    await fs.access(download.filePath);
    fsSync.createReadStream(download.filePath).pipe(res);
  } catch (error) {
    console.error('Chat GET /files/download error:', error.message);
    res.status(error.status || 500).json({ message: error.message || 'Не удалось скачать файл' });
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

router.get('/feed', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 50));
    const commentsLimit = Math.min(5, Math.max(2, Number(req.query?.commentsLimit) || 3));
    const before = req.query?.before || '';
    const archivePosts = await readFeed();
    const filteredArchivePosts = before
      ? archivePosts.filter((post) => normalizeFeedDate(post).getTime() < new Date(before).getTime())
      : archivePosts;
    const visibleArchivePosts = getVisibleFeedPosts(filteredArchivePosts);
    const sqlPosts = await readSqlFeedPosts({ limit, before, commentsLimit }).catch(() => null);
    const posts = Array.isArray(sqlPosts)
      ? mergeFeedPosts(filteredArchivePosts, sqlPosts, limit)
      : visibleArchivePosts.slice(0, limit);
    const earliest = posts[posts.length - 1]?.createdAt || '';
    const hasMoreArchive = earliest ? getVisibleFeedPosts(archivePosts).some((post) => normalizeFeedDate(post).getTime() < new Date(earliest).getTime()) : false;
    res.set('Cache-Control', 'no-store');
    res.json({ posts, pageSize: limit, before: earliest, hasMore: hasMoreArchive || posts.length >= limit, storage: Array.isArray(sqlPosts) ? 'sql+json-archive' : 'json-archive' });
  } catch (error) {
    console.error('Chat GET /feed error:', error);
    res.status(500).json({ message: 'Не удалось загрузить ленту' });
  }
});

router.put('/feed', async (req, res) => {
  try {
    const { posts } = req.body;
    if (!Array.isArray(posts)) {
      return res.status(400).json({ message: 'posts должен быть массивом' });
    }

    await writeFeed(posts, { allowEmpty: req.query.force === '1' });
    res.json({ message: 'Лента сохранена', posts });
  } catch (error) {
    console.error('Chat PUT /feed error:', error);
    res.status(500).json({ message: 'Не удалось сохранить ленту' });
  }
});


const mutateFeed = async (mutator) => {
  return feedMutationQueue.mutate(mutator);
};

router.post('/feed/posts', async (req, res) => {
  try {
    const now = new Date().toISOString();
    const post = {
      id: req.body?.id || createId('post'),
      author: req.body?.author || 'employee',
      authorName: req.body?.authorName || req.body?.author || 'Сотрудник',
      text: String(req.body?.text || '').trim(),
      category: req.body?.category || 'Объявление',
      pinned: Boolean(req.body?.pinned),
      attachment: req.body?.attachment || null,
      attachments: Array.isArray(req.body?.attachments) ? req.body.attachments.filter(Boolean) : (req.body?.attachment ? [req.body.attachment] : []),
      reactions: req.body?.reactions || {},
      createdAt: req.body?.createdAt || now,
      updatedAt: now,
      comments: []
    };

    if (!post.text && !post.attachments.length) {
      return res.status(400).json({ message: 'text или attachment обязателен' });
    }

    await mutateFeed((items) => [post, ...items.filter((item) => item.id !== post.id)]);
    scheduleFeedSqlWrite('Feed SQL post write failed', () => writeSqlFeedPost(post));
    res.status(201).json({ message: 'Публикация создана', post });
  } catch (error) {
    console.error('Chat POST /feed/posts error:', error);
    res.status(500).json({ message: 'Не удалось создать публикацию' });
  }
});

router.delete('/feed/posts/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const deletedBy = req.query?.deletedBy || req.body?.deletedBy || 'system';
    const now = new Date().toISOString();
    let deletedPost = null;
    await mutateFeed((items) => items.map((post) => {
      if (post.id !== postId) return post;
      deletedPost = post.deletedAt
        ? post
        : { ...post, deletedAt: now, deletedBy, updatedAt: now };
      return deletedPost;
    }));

    if (!deletedPost) return res.status(404).json({ message: 'Публикация не найдена' });
    scheduleFeedSqlWrite('Feed SQL post delete failed', () => writeSqlFeedPost(deletedPost));
    res.json({
      message: 'Публикация удалена',
      postId,
      deletedAt: deletedPost.deletedAt,
      deletedBy: deletedPost.deletedBy,
      alreadyDeleted: deletedPost.deletedAt !== now,
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
    let updatedPost = null;
    await mutateFeed((items) => items.map((post) => {
      if (post.id !== postId) return post;
      const nextPost = {
        ...post,
        ...patch,
        id: post.id,
        updatedAt: now
      };
      if (Array.isArray(patch.attachments)) {
        nextPost.attachments = patch.attachments.filter(Boolean);
        nextPost.attachment = nextPost.attachments[0] || null;
      }
      updatedPost = nextPost;
      return nextPost;
    }));

    if (!updatedPost) return res.status(404).json({ message: 'Публикация не найдена' });
    scheduleFeedSqlWrite('Feed SQL post patch failed', () => writeSqlFeedPost(updatedPost));
    res.json({ message: 'Публикация обновлена', post: { id: updatedPost.id, updatedAt: updatedPost.updatedAt } });
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
    const posts = await readFeed();
    const post = posts.find((item) => item.id === postId);
    if (!post || post.deletedAt) return res.status(404).json({ message: 'Публикация не найдена' });
    const archiveComments = (post.comments || []).filter((comment) => (
      !before || normalizeFeedDate(comment).getTime() < new Date(before).getTime()
    ));
    const sqlComments = await readSqlFeedComments(postId, { limit, before }).catch(() => null);
    if (Array.isArray(sqlComments)) {
      const comments = mergeFeedComments(archiveComments, sqlComments, limit);
      const earliest = comments[0]?.createdAt || '';
      const visibleArchiveCount = archiveComments.filter((comment) => !comment.deletedAt).length;
      return res.json({
        postId,
        comments,
        before: earliest,
        hasMore: Math.max(visibleArchiveCount, sqlComments.length) > comments.length,
        storage: 'sql+json-archive'
      });
    }

    const filtered = archiveComments.filter((comment) => !comment.deletedAt);
    const page = filtered.slice(-limit);
    res.json({ postId, comments: page, before: page[0]?.createdAt || '', hasMore: filtered.length > page.length, storage: 'json-archive' });
  } catch (error) {
    console.error('Chat GET /feed/comments error:', error);
    res.status(500).json({ message: 'Не удалось загрузить комментарии' });
  }
});

router.post('/feed/posts/:postId/comments', async (req, res) => {
  try {
    const { postId } = req.params;
    const now = new Date().toISOString();
    const comment = {
      id: req.body?.id || createId('comment'),
      author: req.body?.author || 'employee',
      authorName: req.body?.authorName || req.body?.author || 'Сотрудник',
      text: String(req.body?.text || '').trim(),
      createdAt: req.body?.createdAt || now,
      updatedAt: now
    };

    if (!comment.text) return res.status(400).json({ message: 'text обязателен' });

    let updatedPost = null;
    await mutateFeed((items) => items.map((post) => {
      if (post.id !== postId) return post;
      const comments = [...(post.comments || []).filter((item) => item.id !== comment.id), comment];
      updatedPost = {
        ...post,
        comments,
        commentCount: comments.filter((item) => !item.deletedAt).length,
        updatedAt: now
      };
      return updatedPost;
    }));

    if (!updatedPost) return res.status(404).json({ message: 'Публикация не найдена' });
    scheduleFeedSqlWrite('Feed SQL comment write failed', () => writeSqlFeedComment(postId, comment));
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
    const deletedBy = req.query?.deletedBy || req.body?.deletedBy || 'system';
    const now = new Date().toISOString();
    let foundPost = false;
    let deletedComment = null;
    let updatedPost = null;
    await mutateFeed((items) => items.map((post) => {
      if (post.id !== postId) return post;
      foundPost = true;
      const comments = (post.comments || []).map((comment) => {
        if (comment.id !== commentId) return comment;
        deletedComment = comment.deletedAt
          ? comment
          : { ...comment, deletedAt: now, deletedBy, updatedAt: now };
        return deletedComment;
      });
      updatedPost = {
        ...post,
        comments,
        commentCount: comments.filter((comment) => !comment.deletedAt).length,
        updatedAt: now
      };
      return updatedPost;
    }));

    if (!foundPost) return res.status(404).json({ message: 'Публикация не найдена' });
    scheduleFeedSqlWrite('Feed SQL comment delete failed', () => deleteSqlFeedComment(postId, commentId, deletedBy));
    res.json({
      message: 'Комментарий удалён',
      postId,
      commentId,
      deletedAt: deletedComment?.deletedAt || now,
      deletedBy: deletedComment?.deletedBy || deletedBy,
      alreadyDeleted: !deletedComment || deletedComment.deletedAt !== now,
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
    const login = String(req.body?.login || '').trim();
    if (!emoji || !login) return res.status(400).json({ message: 'emoji и login обязательны' });

    const now = new Date().toISOString();
    let updatedPost = null;
    let active = false;
    await mutateFeed((items) => items.map((post) => {
      if (post.id !== postId) return post;
      const currentUsers = new Set(post.reactions?.[emoji] || []);
      active = typeof req.body?.active === 'boolean' ? req.body.active : !currentUsers.has(login);
      updatedPost = {
        ...setReactionState(post, emoji, login, active),
        updatedAt: now
      };
      return updatedPost;
    }));

    if (!updatedPost) return res.status(404).json({ message: 'Публикация не найдена' });
    scheduleFeedSqlWrite('Feed SQL reaction update failed', () => setSqlFeedReaction(postId, emoji, login, active));
    res.json({
      message: 'Реакция обновлена',
      postId,
      emoji,
      login,
      active,
      reactions: updatedPost.reactions,
      updatedAt: updatedPost.updatedAt
    });
  } catch (error) {
    console.error('Chat POST /feed/reactions error:', error);
    res.status(500).json({ message: 'Не удалось обновить реакцию' });
  }
});

router.post('/feed/posts/:postId/pin', async (req, res) => {
  try {
    const { postId } = req.params;
    const pinned = Boolean(req.body?.pinned);
    const now = new Date().toISOString();
    let found = false;
    const posts = await mutateFeed((items) => items.map((post) => {
      if (post.id !== postId) return post;
      found = true;
      return { ...post, pinned, updatedAt: now };
    }));

    if (!found) return res.status(404).json({ message: 'Публикация не найдена' });
    const updatedPost = posts.find((post) => post.id === postId);
    if (updatedPost) scheduleFeedSqlWrite('Feed SQL pin update failed', () => writeSqlFeedPost(updatedPost));
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

    const [sqlSummaries, archiveSummaries] = await Promise.all([
      readSqlThreadSummaries(login).catch((error) => {
        console.warn('Chat SQL summaries failed, using JSON archive fallback:', error.message);
        return null;
      }),
      readArchiveThreadSummaries(login)
    ]);
    const conversationIds = new Set([
      ...Object.keys(archiveSummaries || {}),
      ...Object.keys(sqlSummaries || {})
    ]);
    const summaries = {};

    conversationIds.forEach((conversationId) => {
      const archiveSummary = archiveSummaries?.[conversationId];
      const sqlSummary = sqlSummaries?.[conversationId];
      const latest = (sqlSummary?.lastTimestamp || 0) >= (archiveSummary?.lastTimestamp || 0)
        ? (sqlSummary || archiveSummary)
        : archiveSummary;
      if (!latest) return;
      summaries[conversationId] = {
        ...latest,
        lastMessage: stripInlinePayloads(latest.lastMessage),
        messageCount: Math.max(sqlSummary?.messageCount || 0, archiveSummary?.messageCount || 0),
        deletedCount: Math.max(sqlSummary?.deletedCount || 0, archiveSummary?.deletedCount || 0),
        attachmentsCount: Math.max(sqlSummary?.attachmentsCount || 0, archiveSummary?.attachmentsCount || 0)
      };
    });

    res.set('Cache-Control', 'no-store');
    res.json({
      summaries,
      storage: sqlSummaries ? 'mysql+json-archive-summary' : 'json-archive-summary'
    });
  } catch (error) {
    console.error('Chat GET /threads error:', error);
    res.status(500).json({ message: 'Не удалось загрузить сообщения' });
  }
});

router.get('/threads/:conversationId/messages', async (req, res) => {
  try {
    const conversationId = decodeURIComponent(req.params.conversationId || '').trim();
    if (!conversationId) return res.status(400).json({ message: 'conversationId обязателен' });
    if (!requireConversationAccess(req, res, conversationId)) return;
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || CHAT_SQL_PAGE_SIZE));
    const before = req.query?.before || '';
    const archiveMessages = await readArchiveConversation(conversationId);
    const archivePage = before
      ? archiveMessages.filter((message) => normalizeMessageDate(message).getTime() < new Date(before).getTime()).slice(-limit)
      : archiveMessages.slice(-limit);
    const sqlMessages = await readSqlConversationMessages(conversationId, { limit, before }).catch(() => null);
    const messages = mergeThreadMessages(archivePage, Array.isArray(sqlMessages) ? sqlMessages : []).slice(-limit);
    const publicMessages = await prepareConversationForResponse(conversationId, messages);
    const earliest = messages[0]?.createdAt || '';
    const archiveHasMore = earliest ? archiveMessages.some((message) => normalizeMessageDate(message).getTime() < new Date(earliest).getTime()) : false;
    res.set('Cache-Control', 'no-store');
    res.json({ conversationId, messages: publicMessages, hasMore: archiveHasMore || messages.length >= limit, before: earliest });
  } catch (error) {
    console.error('Chat GET /threads/messages error:', error);
    res.status(500).json({ message: 'Не удалось загрузить сообщения' });
  }
});

router.get('/threads/stream', async (req, res) => {
  try {
    const login = getRequestLogin(req);
    if (!login) return res.status(401).json({ message: 'Для загрузки диалогов требуется вход' });
    const summaries = await readArchiveThreadSummaries(login);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    res.write(`event: threads\ndata: ${JSON.stringify({ summaries: stripInlinePayloads(summaries) })}\n\n`);
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
    const preparedMessage = (await prepareMessageForResponse(message)).message;

    await writeSqlMessage(conversationId, preparedMessage).catch((error) => {
      console.warn('Chat SQL message write failed, keeping JSON archive only:', error.message);
      return false;
    });

    let exists = false;
    let savedItem = preparedMessage;
    await mutateThreads((threads) => {
      const currentMessages = Array.isArray(threads[conversationId]) ? threads[conversationId] : [];
      exists = currentMessages.some((item) => item.id === preparedMessage.id);
      threads[conversationId] = exists
        ? currentMessages.map((item) => {
          if (item.id !== preparedMessage.id) return item;
          savedItem = { ...item, ...preparedMessage };
          return savedItem;
        })
        : [...currentMessages, preparedMessage];
      return threads;
    });

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
    const preparedPatch = (await prepareMessageForResponse(patch)).message;

    let found = false;
    let updatedItem = null;
    await mutateThreads((threads) => {
      const currentMessages = Array.isArray(threads[conversationId]) ? threads[conversationId] : [];
      threads[conversationId] = currentMessages.map((item) => {
        if (item.id !== messageId) return item;
        found = true;
        updatedItem = { ...item, ...preparedPatch, id: item.id };
        return updatedItem;
      });
      return threads;
    });

    if (!found) return res.status(404).json({ message: 'Сообщение не найдено' });

    if (updatedItem) {
      await writeSqlMessage(conversationId, updatedItem).catch((error) => {
        console.warn('Chat SQL patch write failed, keeping JSON archive only:', error.message);
        return false;
      });
    }

    res.json({ message: 'Сообщение обновлено', conversationId, item: updatedItem });
  } catch (error) {
    console.error('Chat PATCH /threads/messages error:', error);
    res.status(500).json({ message: 'Не удалось обновить сообщение' });
  }
});

router.put('/threads/:conversationId', async (req, res) => {
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

    await Promise.all(preparedMessages.filter((message) => message?.id).map((message) => writeSqlMessage(conversationId, message).catch((error) => {
      console.warn('Chat SQL bulk write failed for message:', error.message);
      return false;
    })));

    await mutateThreads((items) => ({
      ...items,
      [conversationId]: preparedMessages
    }));

    res.json({ message: 'Сохранено', conversationId });
  } catch (error) {
    console.error('Chat PUT /threads error:', error);
    res.status(500).json({ message: 'Не удалось сохранить сообщения' });
  }
});

router.delete('/threads/:conversationId', async (req, res) => {
  try {
    const conversationId = decodeURIComponent(req.params.conversationId || '').trim();
    if (!conversationId) {
      return res.status(400).json({ message: 'conversationId обязателен' });
    }
    if (!requireConversationAccess(req, res, conversationId)) return;

    await deleteSqlConversation(conversationId).catch((error) => {
      console.warn('Chat SQL conversation delete failed, deleting JSON archive only:', error.message);
      return false;
    });

    await mutateThreads((items) => {
      delete items[conversationId];
      return items;
    });

    res.json({ message: 'Переписка удалена', conversationId });
  } catch (error) {
    console.error('Chat DELETE /threads error:', error);
    res.status(500).json({ message: 'Не удалось удалить переписку' });
  }
});

module.exports = router;
