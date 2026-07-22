const express = require('express');
const fsSync = require('fs');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/database');

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
let writeQueue = Promise.resolve();
let feedWriteQueue = Promise.resolve();
const streamClients = new Set();

const cloneThreads = (threads) => JSON.parse(JSON.stringify(threads || {}));
const createId = (prefix = 'item') => `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;


let chatSqlReady = false;
let chatSqlChecked = false;

const normalizeMessageDate = (message = {}) => {
  const date = new Date(message.createdAt || message.updatedAt || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const ensureChatSqlSchema = async () => {
  if (chatSqlChecked) return chatSqlReady;
  chatSqlChecked = true;
  try {
    if (!db?.execute) throw new Error('SQL execute is unavailable');
    await db.execute(`CREATE TABLE IF NOT EXISTS chat_messages (
      id VARCHAR(128) PRIMARY KEY,
      conversation_id VARCHAR(255) NOT NULL,
      sender_login VARCHAR(255) NULL,
      message_json JSON NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      deleted_at DATETIME NULL,
      INDEX idx_chat_messages_conversation_created (conversation_id, created_at),
      INDEX idx_chat_messages_sender (sender_login)
    )`);
    chatSqlReady = true;
  } catch (error) {
    chatSqlReady = false;
    console.warn('Chat SQL storage unavailable, falling back to JSON archive:', error.message);
  }
  return chatSqlReady;
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
  await db.execute(
    `INSERT INTO chat_messages (id, conversation_id, sender_login, message_json, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, CAST(? AS JSON), ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       conversation_id = VALUES(conversation_id),
       sender_login = VALUES(sender_login),
       message_json = VALUES(message_json),
       created_at = VALUES(created_at),
       updated_at = VALUES(updated_at),
       deleted_at = VALUES(deleted_at)`,
    [message.id, conversationId, message.sender || null, JSON.stringify(message), createdAt, updatedAt, deletedAt]
  );
  return true;
};

const readSqlConversationMessages = async (conversationId, { limit = CHAT_SQL_PAGE_SIZE, before = '' } = {}) => {
  if (!await ensureChatSqlSchema()) return null;
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || CHAT_SQL_PAGE_SIZE));
  const params = [conversationId];
  let where = 'conversation_id = ?';
  if (before) {
    where += ' AND created_at < ?';
    params.push(new Date(before));
  }
  params.push(safeLimit);
  const [rows] = await db.execute(
    `SELECT message_json FROM chat_messages WHERE ${where} ORDER BY created_at DESC LIMIT ?`,
    params
  );
  return (rows || []).map((row) => parseSqlMessage(row.message_json)).filter(Boolean).reverse();
};

const readSqlThreadsSnapshot = async (limit = CHAT_SQL_PAGE_SIZE) => {
  if (!await ensureChatSqlSchema()) return null;
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || CHAT_SQL_PAGE_SIZE));
  const [conversationRows] = await db.execute('SELECT DISTINCT conversation_id FROM chat_messages ORDER BY conversation_id LIMIT 1000');
  const pairs = await Promise.all((conversationRows || []).map(async (row) => [
    row.conversation_id,
    await readSqlConversationMessages(row.conversation_id, { limit: safeLimit })
  ]));
  return Object.fromEntries(pairs.filter(([, messages]) => messages && messages.length));
};

const mergeThreadMessages = (archiveMessages = [], sqlMessages = []) => {
  const byId = new Map();
  [...archiveMessages, ...sqlMessages].forEach((message) => {
    if (message?.id) byId.set(message.id, message);
  });
  return [...byId.values()].sort((a, b) => normalizeMessageDate(a).getTime() - normalizeMessageDate(b).getTime());
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

const buildUploadUrl = (scope, fileName) => `/uploads/${scope}/${encodeURIComponent(fileName)}`;

let chatFilesSqlReady = false;
let chatFilesSqlChecked = false;

const ensureChatFilesSqlSchema = async () => {
  if (chatFilesSqlChecked) return chatFilesSqlReady;
  chatFilesSqlChecked = true;
  try {
    if (!db?.execute) throw new Error('SQL execute is unavailable');
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
      INDEX idx_chat_files_scope (scope),
      INDEX idx_chat_files_uploaded_at (uploaded_at)
    )`);
    chatFilesSqlReady = true;
  } catch (error) {
    chatFilesSqlReady = false;
    console.warn('Chat file SQL metadata unavailable, storing files without SQL metadata:', error.message);
  }
  return chatFilesSqlReady;
};

const writeSqlFileMetadata = async (file = {}) => {
  if (!await ensureChatFilesSqlSchema()) return false;
  await db.execute(
    `INSERT INTO chat_files (id, scope, original_name, stored_name, url, thumbnail_url, mime_type, size_bytes, sha256, uploaded_at, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
       metadata_json = VALUES(metadata_json)`,
    [
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
      JSON.stringify({ name: file.name, thumbnailUrl: file.thumbnailUrl || null })
    ]
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
    const url = buildUploadUrl(safeScope, storedName);
    let thumbnailUrl = String(mime).startsWith('image/') || String(mime).startsWith('video/') ? url : '';

    if ((String(mime).startsWith('image/') || String(mime).startsWith('video/')) && fields.thumbnailDataUrl) {
      const thumbnailParsed = getDataUrlPayload(fields.thumbnailDataUrl);
      if (thumbnailParsed && String(thumbnailParsed.mime || '').startsWith('image/')) {
        const thumbnailBuffer = Buffer.from(thumbnailParsed.payload, 'base64');
        if (thumbnailBuffer.length > 0 && thumbnailBuffer.length <= 2 * 1024 * 1024) {
          const thumbnailName = `thumb-${storedName.replace(/\.[^.]+$/, '')}.jpg`;
          await fs.writeFile(path.join(uploadDir, thumbnailName), thumbnailBuffer);
          thumbnailUrl = buildUploadUrl(safeScope, thumbnailName);
        }
      }
    }

    const file = {
      id: createId('file'),
      scope: safeScope,
      name: safeOriginalName,
      type: mime,
      size: filePart.buffer.length,
      url,
      thumbnailUrl,
      originalName: fields.name || filePart.filename,
      storedName,
      sha256,
      uploadedAt: new Date().toISOString()
    };

    try {
      await writeSqlFileMetadata(file);
    } catch (error) {
      console.warn('Chat file SQL metadata write failed:', error.message);
    }

    return file;
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
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

const ensureJsonFile = async (filePath, fallback) => {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await atomicWriteJson(filePath, fallback);
  }
};

const readJsonWithRecovery = async (filePath, fallback, validate, label, { throwOnUnrecoverable = false } = {}) => {
  await ensureJsonFile(filePath, fallback);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw || JSON.stringify(fallback));
    if (validate(parsed)) return parsed;
    throw new Error(`${label} имеет неверный формат`);
  } catch (error) {
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

const writeFeed = async (posts, { allowEmpty = false } = {}) => {
  const safePosts = Array.isArray(posts) ? posts : [];
  feedWriteQueue = feedWriteQueue
    .catch(() => {})
    .then(async () => {
      const currentPosts = await readFeed();
      if (!allowEmpty && safePosts.length === 0 && currentPosts.length > 0) {
        throw new Error('Защита ленты: отказано в перезаписи непустой ленты пустым массивом');
      }
      await atomicWriteJson(feedFilePath, safePosts);
    });

  await feedWriteQueue;
};

const ensureStorage = async () => {
  if (!storageReadyPromise) {
    storageReadyPromise = ensureJsonFile(chatFilePath, {});
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

const broadcastThreads = () => {
  if (!streamClients.size) return;
  const payload = JSON.stringify({ threads: cachedThreads || {} });
  streamClients.forEach((client) => {
    client.write(`event: threads\ndata: ${payload}\n\n`);
  });
};

const writeThreads = async (threads) => {
  const nextThreads = cloneThreads(threads);
  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      await ensureStorage();
      const currentThreads = await readThreadsFromDisk();
      if (Object.keys(nextThreads).length === 0 && Object.keys(currentThreads).length > 0) {
        throw new Error('Защита чата: отказано в перезаписи непустой истории пустым объектом');
      }
      await atomicWriteJson(chatFilePath, nextThreads);
      cachedThreads = cloneThreads(nextThreads);
      broadcastThreads();
    });

  await writeQueue;
};



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
    const posts = await readFeed();
    res.set('Cache-Control', 'no-store');
    res.json({ posts: getVisibleFeedPosts(posts) });
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
  const posts = await readFeed();
  const nextPosts = await mutator(posts);
  await writeFeed(nextPosts);
  return nextPosts;
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

    const posts = await mutateFeed((items) => [post, ...items]);
    res.status(201).json({ message: 'Публикация создана', post, posts: getVisibleFeedPosts(posts) });
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
    let found = false;
    const posts = await mutateFeed((items) => items.filter((post) => {
      if (post.id !== postId) return true;
      found = true;
      return false;
    }));

    if (!found) return res.status(404).json({ message: 'Публикация не найдена' });
    res.json({ message: 'Публикация удалена', postId, deletedAt: now, deletedBy, posts: getVisibleFeedPosts(posts) });
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
    const posts = await mutateFeed((items) => items.map((post) => {
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
    res.json({ message: 'Публикация обновлена', post: updatedPost, posts: getVisibleFeedPosts(posts) });
  } catch (error) {
    console.error('Chat PATCH /feed/posts error:', error);
    res.status(500).json({ message: 'Не удалось обновить публикацию' });
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

    let found = false;
    const posts = await mutateFeed((items) => items.map((post) => {
      if (post.id !== postId) return post;
      found = true;
      return { ...post, comments: [...(post.comments || []), comment], updatedAt: now };
    }));

    if (!found) return res.status(404).json({ message: 'Публикация не найдена' });
    res.status(201).json({ message: 'Комментарий добавлен', postId, comment, posts: getVisibleFeedPosts(posts) });
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
    let found = false;
    const posts = await mutateFeed((items) => items.map((post) => {
      if (post.id !== postId) return post;
      return {
        ...post,
        comments: (post.comments || []).map((comment) => {
          if (comment.id !== commentId) return comment;
          found = true;
          return { ...comment, deletedAt: now, deletedBy, updatedAt: now };
        }),
        updatedAt: now
      };
    }));

    if (!found) return res.status(404).json({ message: 'Комментарий не найден' });
    res.json({ message: 'Комментарий удалён', postId, commentId, deletedAt: now, deletedBy, posts: getVisibleFeedPosts(posts) });
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
    let found = false;
    const posts = await mutateFeed((items) => items.map((post) => {
      if (post.id !== postId) return post;
      found = true;
      const reactions = { ...(post.reactions || {}) };
      const users = new Set(reactions[emoji] || []);
      if (users.has(login)) users.delete(login);
      else users.add(login);
      reactions[emoji] = [...users];
      return { ...post, reactions, updatedAt: now };
    }));

    if (!found) return res.status(404).json({ message: 'Публикация не найдена' });
    res.json({ message: 'Реакция обновлена', posts: getVisibleFeedPosts(posts) });
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
    res.json({ message: 'Закрепление обновлено', posts: getVisibleFeedPosts(posts) });
  } catch (error) {
    console.error('Chat POST /feed/pin error:', error);
    res.status(500).json({ message: 'Не удалось закрепить публикацию' });
  }
});

router.get('/threads', async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || CHAT_SQL_PAGE_SIZE));
    const archiveThreads = await readThreads();
    const sqlThreads = await readSqlThreadsSnapshot(limit);
    const threadIds = new Set([...Object.keys(archiveThreads || {}), ...Object.keys(sqlThreads || {})]);
    const threads = {};
    threadIds.forEach((conversationId) => {
      const archiveMessages = Array.isArray(archiveThreads[conversationId]) ? archiveThreads[conversationId].slice(-limit) : [];
      const sqlMessages = Array.isArray(sqlThreads?.[conversationId]) ? sqlThreads[conversationId] : [];
      threads[conversationId] = mergeThreadMessages(archiveMessages, sqlMessages).slice(-limit);
    });
    res.set('Cache-Control', 'no-store');
    res.json({ threads, pageSize: limit, storage: sqlThreads ? 'sql+json-archive' : 'json-archive' });
  } catch (error) {
    console.error('Chat GET /threads error:', error);
    res.status(500).json({ message: 'Не удалось загрузить сообщения' });
  }
});

router.get('/threads/:conversationId/messages', async (req, res) => {
  try {
    const conversationId = decodeURIComponent(req.params.conversationId || '').trim();
    if (!conversationId) return res.status(400).json({ message: 'conversationId обязателен' });
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || CHAT_SQL_PAGE_SIZE));
    const before = req.query?.before || '';
    const archiveThreads = await readThreads();
    const archiveMessages = Array.isArray(archiveThreads[conversationId]) ? archiveThreads[conversationId] : [];
    const archivePage = before
      ? archiveMessages.filter((message) => normalizeMessageDate(message).getTime() < new Date(before).getTime()).slice(-limit)
      : archiveMessages.slice(-limit);
    const sqlMessages = await readSqlConversationMessages(conversationId, { limit, before }).catch(() => null);
    const messages = mergeThreadMessages(archivePage, Array.isArray(sqlMessages) ? sqlMessages : []).slice(-limit);
    const earliest = messages[0]?.createdAt || '';
    const archiveHasMore = earliest ? archiveMessages.some((message) => normalizeMessageDate(message).getTime() < new Date(earliest).getTime()) : false;
    res.set('Cache-Control', 'no-store');
    res.json({ conversationId, messages, hasMore: archiveHasMore || messages.length >= limit, before: earliest });
  } catch (error) {
    console.error('Chat GET /threads/messages error:', error);
    res.status(500).json({ message: 'Не удалось загрузить сообщения' });
  }
});

router.get('/threads/stream', async (req, res) => {
  try {
    const threads = await readThreads();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    res.write(`event: threads\ndata: ${JSON.stringify({ threads })}\n\n`);
    streamClients.add(res);

    const heartbeat = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      streamClients.delete(res);
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

    if (!message || typeof message !== 'object' || !message.id) {
      return res.status(400).json({ message: 'message обязателен' });
    }

    await writeSqlMessage(conversationId, message).catch((error) => {
      console.warn('Chat SQL message write failed, keeping JSON archive only:', error.message);
      return false;
    });

    const threads = await readThreads();
    const currentMessages = Array.isArray(threads[conversationId]) ? threads[conversationId] : [];
    const exists = currentMessages.some((item) => item.id === message.id);
    threads[conversationId] = exists
      ? currentMessages.map((item) => (item.id === message.id ? { ...item, ...message } : item))
      : [...currentMessages, message];

    await writeThreads(threads);
    res.status(exists ? 200 : 201).json({ message: exists ? 'Сообщение обновлено' : 'Сообщение добавлено', conversationId, item: message });
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

    if (!patch || typeof patch !== 'object') {
      return res.status(400).json({ message: 'message или patch обязателен' });
    }

    const threads = await readThreads();
    const currentMessages = Array.isArray(threads[conversationId]) ? threads[conversationId] : [];
    let found = false;
    threads[conversationId] = currentMessages.map((item) => {
      if (item.id !== messageId) return item;
      found = true;
      return { ...item, ...patch, id: item.id };
    });

    if (!found) return res.status(404).json({ message: 'Сообщение не найдено' });

    const updatedItem = threads[conversationId].find((item) => item.id === messageId);
    if (updatedItem) {
      await writeSqlMessage(conversationId, updatedItem).catch((error) => {
        console.warn('Chat SQL patch write failed, keeping JSON archive only:', error.message);
        return false;
      });
    }

    await writeThreads(threads);
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

    if (!Array.isArray(messages)) {
      return res.status(400).json({ message: 'messages должен быть массивом' });
    }

    await Promise.all(messages.filter((message) => message?.id).map((message) => writeSqlMessage(conversationId, message).catch((error) => {
      console.warn('Chat SQL bulk write failed for message:', error.message);
      return false;
    })));

    const threads = await readThreads();
    threads[conversationId] = messages;
    await writeThreads(threads);

    res.json({ message: 'Сохранено', threads });
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

    const threads = await readThreads();
    delete threads[conversationId];
    await writeThreads(threads);

    res.json({ message: 'Переписка удалена', threads });
  } catch (error) {
    console.error('Chat DELETE /threads error:', error);
    res.status(500).json({ message: 'Не удалось удалить переписку' });
  }
});

module.exports = router;
