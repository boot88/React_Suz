const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const router = express.Router();

const dataDir = path.join(__dirname, '..', 'data');
const chatFilePath = path.join(dataDir, 'chatThreads.json');

let cachedThreads = null;
let storageReadyPromise = null;
let writeQueue = Promise.resolve();

const cloneThreads = (threads) => JSON.parse(JSON.stringify(threads || {}));

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

const writeThreads = async (threads) => {
  cachedThreads = cloneThreads(threads);

  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      await ensureStorage();
      await fs.writeFile(chatFilePath, JSON.stringify(cachedThreads, null, 2), 'utf-8');
    });

  await writeQueue;
};

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
