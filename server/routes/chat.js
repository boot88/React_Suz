const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const router = express.Router();

const dataDir = path.join(__dirname, '..', 'data');
const chatFilePath = path.join(dataDir, 'chatThreads.json');
const feedFilePath = path.join(dataDir, 'employeeFeed.json');

let cachedThreads = null;
let storageReadyPromise = null;
let writeQueue = Promise.resolve();
let feedWriteQueue = Promise.resolve();
const streamClients = new Set();

const cloneThreads = (threads) => JSON.parse(JSON.stringify(threads || {}));

const ensureJsonFile = async (filePath, fallback) => {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(fallback, null, 2), 'utf-8');
  }
};

const readFeed = async () => {
  await ensureJsonFile(feedFilePath, []);
  try {
    const raw = await fs.readFile(feedFilePath, 'utf-8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Chat feed read error:', error);
    return [];
  }
};

const writeFeed = async (posts) => {
  const safePosts = Array.isArray(posts) ? posts : [];
  feedWriteQueue = feedWriteQueue
    .catch(() => {})
    .then(async () => {
      await ensureJsonFile(feedFilePath, []);
      await fs.writeFile(feedFilePath, JSON.stringify(safePosts, null, 2), 'utf-8');
    });

  await feedWriteQueue;
};

const ensureStorage = async () => {
  if (!storageReadyPromise) {
    storageReadyPromise = (async () => {
      await fs.mkdir(dataDir, { recursive: true });
      try {
        await fs.access(chatFilePath);
      } catch {
        await fs.writeFile(chatFilePath, JSON.stringify({}, null, 2), 'utf-8');
      }
    })();
  }

  return storageReadyPromise;
};

const readThreadsFromDisk = async () => {
  await ensureStorage();
  const raw = await fs.readFile(chatFilePath, 'utf-8');
  const parsed = JSON.parse(raw || '{}');
  return parsed && typeof parsed === 'object' ? parsed : {};
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
  cachedThreads = cloneThreads(threads);
  broadcastThreads();

  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      await ensureStorage();
      await fs.writeFile(chatFilePath, JSON.stringify(cachedThreads, null, 2), 'utf-8');
    });

  await writeQueue;
};


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

    await writeFeed(posts);
    res.json({ message: 'Лента сохранена', posts });
  } catch (error) {
    console.error('Chat PUT /feed error:', error);
    res.status(500).json({ message: 'Не удалось сохранить ленту' });
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
