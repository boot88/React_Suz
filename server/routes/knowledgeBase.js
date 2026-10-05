// server/routes/knowledgeBase.js
// Маршруты базы знаний (вынесены из server.js для декомпозиции монолита).
const express = require('express');
const router = express.Router();
router.param('id', (req, res, next, value) => {
  const id = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Некорректный ID статьи' });
  req.params.id = String(id); next();
});
const pool = require('../config/database');
const { requireRole } = require('../middleware/auth');

const safeParseImages = (imagesString) => {
  if (!imagesString) return [];

  try {
    if (Array.isArray(imagesString)) {
      return imagesString;
    }

    if (typeof imagesString === 'string') {
      if (imagesString.trim() === '') {
        return [];
      }

      const parsed = JSON.parse(imagesString);
      return Array.isArray(parsed) ? parsed : [];
    }

    return [];
  } catch (error) {
    console.error('Ошибка парсинга изображений:', error, 'Строка:', imagesString);
    return [];
  }
};

const serializeImagesPayload = (images) => {
  // Обрабатываем images - преобразуем в JSON строку или NULL
  if (!images || images.length === 0) return null;

  if (!Array.isArray(images)) {
    throw new Error('Images must be an array');
  }

  if (images.length > 20) throw Object.assign(new Error('Максимум 20 изображений в статье'), { status: 400 });
  for (const image of images) {
    const match = typeof image?.data === 'string' && image.data.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match || Buffer.from(match[2], 'base64').length > 2 * 1024 * 1024) throw Object.assign(new Error('Допустимы JPEG, PNG, GIF, WebP размером до 2 МБ на файл'), { status: 400 });
  }
  const processedImages = images.map(img => ({
    name: img.name || `image_${Date.now()}`,
    type: img.type || 'image/jpeg',
    size: img.size || 0,
    data: img.data, // Оставляем base64 данные
    uploadedAt: img.uploadedAt || new Date().toISOString()
  }));

  const imagesJson = JSON.stringify(processedImages);

  // Проверяем общий размер (примерно)
  if (Buffer.byteLength(imagesJson) > 10 * 1024 * 1024) { // 10MB лимит
    const error = new Error('Total images size too large');
    error.status = 400;
    throw error;
  }

  return imagesJson;
};

// An expanded article can request many photos concurrently. Read its JSON once,
// with a short, bounded cache; mutations invalidate it immediately.
const imageCache = new Map(), imageLoads = new Map();
let imageCacheBytes = 0, imageVersion = 0;
const invalidateImages = (id) => {
  const key = String(Number(id)), cached = imageCache.get(key);
  if (cached) imageCacheBytes -= cached.bytes;
  imageCache.delete(key); imageVersion += 1;
};
const readArticleImages = async (id) => {
  const key = String(Number(id)), cached = imageCache.get(key);
  if (cached?.expires > Date.now()) return cached.images;
  if (cached) { imageCache.delete(key); imageCacheBytes -= cached.bytes; }
  const version = imageVersion, loadKey = `${key}:${version}`;
  if (imageLoads.has(loadKey)) return imageLoads.get(loadKey);
  const load = (async () => {
    const [rows] = await pool.execute('SELECT images FROM knowledge_base WHERE id = ?', [id]);
    const images = safeParseImages(rows[0]?.images), bytes = Buffer.byteLength(String(rows[0]?.images || ''));
    if (version === imageVersion && rows.length && bytes <= 32 * 1024 * 1024) {
      while (imageCache.size && imageCacheBytes + bytes > 32 * 1024 * 1024) {
        const oldest = imageCache.keys().next().value;
        imageCacheBytes -= imageCache.get(oldest).bytes; imageCache.delete(oldest);
      }
      imageCache.set(key, { images, bytes, expires: Date.now() + 30000 }); imageCacheBytes += bytes;
    }
    return images;
  })();
  imageLoads.set(loadKey, load);
  try { return await load; } finally { imageLoads.delete(loadKey); }
};

const formatRow = (row) => ({
  ...row,
  images: safeParseImages(row?.images),
  category: row?.category || 'Общее'
});

// Таблица создавалась вручную и в репозитории не было ни миграции, ни DDL:
// в новой базе любой запрос к базе знаний падал с 500
// (Table 'its.knowledge_base' doesn't exist). Создаём её один раз на процесс —
// тем же приёмом, что и network_map_snapshot в networkMap.js.
const KNOWLEDGE_BASE_DDL = `
  CREATE TABLE IF NOT EXISTS knowledge_base (
    id INT NOT NULL AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    solution LONGTEXT NOT NULL,
    category VARCHAR(120) NOT NULL DEFAULT 'Общее',
    images LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_knowledge_base_category (category),
    KEY idx_knowledge_base_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

let schemaReadyPromise = null;

const ensureKnowledgeBaseSchema = () => {
  if (!schemaReadyPromise) {
    // pool.query, а не execute: DDL в подготовленном операторе поддерживают
    // не все версии MySQL/MariaDB, а плейсхолдеров здесь нет.
    schemaReadyPromise = pool.query(KNOWLEDGE_BASE_DDL).catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

// Без этого браузер получал невнятное «Internal server error» и по логам было
// не понять, что дело в отсутствующей таблице или правах пользователя БД.
const SCHEMA_ERROR_CODES = new Set([
  'ER_NO_SUCH_TABLE',
  'ER_TABLEACCESS_DENIED_ERROR',
  'ER_DBACCESS_DENIED_ERROR'
]);

const knowledgeBaseErrorMessage = (error) => (
  SCHEMA_ERROR_CODES.has(error?.code)
    ? 'Таблица базы знаний недоступна. Примените миграцию server/migrations/20260928_knowledge_base.sql на сервере БД.'
    : 'Internal server error'
);

const articleSummary = (row) => ({ ...row, images: [], image_count: Number(row.image_count) || 0 });
router.get('/', requireRole('admin', 'manager'), async (req, res) => {
  try {
    await ensureKnowledgeBaseSchema();
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 12));
    const clauses = [], params = [];
    const search = String(req.query.search || '').trim().slice(0, 500);
    if (search) { clauses.push('(title LIKE ? OR solution LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    if (req.query.category && req.query.category !== 'all') { clauses.push('category = ?'); params.push(String(req.query.category)); }
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const [count] = await pool.execute(`SELECT COUNT(*) AS total FROM knowledge_base ${where}`, params);
    const total = Number(count[0].total), totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(totalPages, Math.max(1, parseInt(req.query.page) || 1));
    const [rows] = await pool.execute(`SELECT id, title, LEFT(solution, 180) AS solution, category, created_at, updated_at,
      JSON_LENGTH(CASE WHEN JSON_VALID(images) THEN images ELSE '[]' END) AS image_count
      FROM knowledge_base ${where} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, params);
    const [categories] = await pool.execute('SELECT DISTINCT category FROM knowledge_base ORDER BY category');
    res.json({ articles: rows.map(articleSummary), total, page, totalPages, categories: categories.map((row) => row.category) });
  } catch (error) { res.status(500).json({ error: knowledgeBaseErrorMessage(error) }); }
});
router.get('/:id/images/:index', requireRole('admin', 'manager'), async (req, res) => {
  try {
    await ensureKnowledgeBaseSchema();
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) return res.sendStatus(400);
    const image = (await readArticleImages(req.params.id))[index];
    const match = typeof image?.data === 'string' && image.data.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return res.sendStatus(404);
    res.set('Cache-Control', 'private, max-age=60'); res.type(match[1]).send(Buffer.from(match[2], 'base64'));
  } catch { res.sendStatus(500); }
});
router.get('/:id', requireRole('admin', 'manager'), async (req, res) => {
  try {
    await ensureKnowledgeBaseSchema();
    const [rows] = await pool.execute('SELECT * FROM knowledge_base WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Статья не найдена' });
    const article = formatRow(rows[0]);
    if (req.query.edit !== '1') article.images = article.images.map(({ data, ...image }, index) => ({ ...image, url: `/api/knowledge-base/${article.id}/images/${index}?v=${encodeURIComponent(String(article.updated_at || article.created_at || ''))}` }));
    res.json(article);
  } catch (error) { res.status(500).json({ error: knowledgeBaseErrorMessage(error) }); }
});

router.post('/', requireRole('admin', 'manager'), async (req, res) => {
  try {
    await ensureKnowledgeBaseSchema();
    const { title, solution, category, images } = req.body;

    if (typeof title !== 'string' || !title.trim() || title.length > 255 || typeof solution !== 'string' || !solution.trim() || (category && (typeof category !== 'string' || category.length > 120))) {
      return res.status(400).json({ error: 'Title and solution are required' });
    }

    let imagesJson = null;
    try {
      imagesJson = serializeImagesPayload(images);
    } catch (parseError) {
      console.error('Error processing images:', parseError);
      return res.status(parseError.status || 400).json({ error: parseError.message || 'Invalid images format' });
    }

    const categoryValue = category || 'Общее';

    const [result] = await pool.execute(
      'INSERT INTO knowledge_base (title, solution, category, images) VALUES (?, ?, ?, ?)',
      [title, solution, categoryValue, imagesJson]
    );

    // Раньше здесь был LAST_INSERT_ID(), но в пуле соединений SELECT мог уехать
    // на другое соединение и вернуть пустой ответ без id статьи.
    const [rows] = await pool.execute(
      'SELECT * FROM knowledge_base WHERE id = ?',
      [result.insertId]
    );

    invalidateImages(rows[0]?.id);
    res.json(formatRow(rows[0]));
  } catch (error) {
    console.error('Error creating knowledge base article:', error);
    res.status(500).json({ error: knowledgeBaseErrorMessage(error) });
  }
});

router.put('/:id', requireRole('admin', 'manager'), async (req, res) => {
  try {
    await ensureKnowledgeBaseSchema();
    const { id } = req.params;
    const { title, solution, category, images } = req.body;

    if (typeof title !== 'string' || !title.trim() || title.length > 255 || typeof solution !== 'string' || !solution.trim() || (category && (typeof category !== 'string' || category.length > 120))) {
      return res.status(400).json({ error: 'Title and solution are required' });
    }

    let imagesJson = null;
    try {
      imagesJson = serializeImagesPayload(images);
    } catch (parseError) {
      console.error('Error processing images:', parseError);
      return res.status(parseError.status || 400).json({ error: parseError.message || 'Invalid images format' });
    }

    const categoryValue = category || 'Общее';

    const [result] = await pool.execute(
      'UPDATE knowledge_base SET title = ?, solution = ?, `category` = ?, images = ?, updated_at = CURRENT_TIMESTAMP WHERE `id` = ?',
      [title, solution, categoryValue, imagesJson, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const [rows] = await pool.execute(
      'SELECT * FROM knowledge_base WHERE `id` = ?',
      [id]
    );

    invalidateImages(rows[0]?.id);
    res.json(formatRow(rows[0]));
  } catch (error) {
    console.error('Error updating knowledge base article:', error);
    res.status(500).json({ error: knowledgeBaseErrorMessage(error) });
  }
});

router.delete('/:id', requireRole('admin', 'manager'), async (req, res) => {
  try {
    await ensureKnowledgeBaseSchema();
    const { id } = req.params;

    const [result] = await pool.execute(
      'DELETE FROM knowledge_base WHERE `id` = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }

    invalidateImages(id);
    res.json({ message: 'Article deleted successfully' });
  } catch (error) {
    console.error('Error deleting knowledge base article:', error);
    res.status(500).json({ error: knowledgeBaseErrorMessage(error) });
  }
});

router.resetAfterAdminRestore = () => { imageCache.clear(); imageCacheBytes = 0; imageVersion += 1; };
module.exports = router;
