const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();

const dataDir = path.join(__dirname, '..', 'data');
const chatFilePath = path.join(dataDir, 'chatThreads.json');
const feedFilePath = path.join(dataDir, 'employeeFeed.json');
const backupDir = path.join(dataDir, 'backups');
const MAX_BACKUPS_PER_FILE = 30;

let cachedThreads = null;
let storageReadyPromise = null;
let writeQueue = Promise.resolve();
let feedWriteQueue = Promise.resolve();
const streamClients = new Set();

const cloneThreads = (threads) => JSON.parse(JSON.stringify(threads || {}));
const createId = (prefix = 'item') => `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

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

const readJsonWithRecovery = async (filePath, fallback, validate, label) => {
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
    return fallback;
  }
};

const readFeed = async () => readJsonWithRecovery(feedFilePath, [], Array.isArray, 'Chat feed');

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

router.get('/feed', async (req, res) => {
  try {
    const posts = await readFeed();
    res.set('Cache-Control', 'no-store');
    res.json({ posts });
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
      reactions: req.body?.reactions || {},
      createdAt: req.body?.createdAt || now,
      updatedAt: now,
      comments: []
    };

    if (!post.text && !post.attachment) {
      return res.status(400).json({ message: 'text или attachment обязателен' });
    }

    const posts = await mutateFeed((items) => [post, ...items]);
    res.status(201).json({ message: 'Публикация создана', post, posts });
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
    const posts = await mutateFeed((items) => items.map((post) => {
      if (post.id !== postId) return post;
      found = true;
      return { ...post, deletedAt: now, deletedBy, updatedAt: now };
    }));

    if (!found) return res.status(404).json({ message: 'Публикация не найдена' });
    res.json({ message: 'Публикация удалена', posts });
  } catch (error) {
    console.error('Chat DELETE /feed/posts error:', error);
    res.status(500).json({ message: 'Не удалось удалить публикацию' });
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
    res.status(201).json({ message: 'Комментарий добавлен', comment, posts });
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
    res.json({ message: 'Комментарий удалён', posts });
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
    res.json({ message: 'Реакция обновлена', posts });
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
    res.json({ message: 'Закрепление обновлено', posts });
  } catch (error) {
    console.error('Chat POST /feed/pin error:', error);
    res.status(500).json({ message: 'Не удалось закрепить публикацию' });
  }
});

router.get('/threads', async (req, res) => {
  try {
    const threads = await readThreads();
    res.set('Cache-Control', 'no-store');
    res.json({ threads });
  } catch (error) {
    console.error('Chat GET /threads error:', error);
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

    const threads = await readThreads();
    const currentMessages = Array.isArray(threads[conversationId]) ? threads[conversationId] : [];
    const exists = currentMessages.some((item) => item.id === message.id);
    threads[conversationId] = exists
      ? currentMessages.map((item) => (item.id === message.id ? { ...item, ...message } : item))
      : [...currentMessages, message];

    await writeThreads(threads);
    res.status(exists ? 200 : 201).json({ message: exists ? 'Сообщение обновлено' : 'Сообщение добавлено', threads, item: message });
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

    await writeThreads(threads);
    res.json({ message: 'Сообщение обновлено', threads, item: threads[conversationId].find((item) => item.id === messageId) });
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
