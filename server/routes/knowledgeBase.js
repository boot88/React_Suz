// server/routes/knowledgeBase.js
// Маршруты базы знаний (вынесены из server.js для декомпозиции монолита).
const express = require('express');
const router = express.Router();
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

  const processedImages = images.map(img => ({
    name: img.name || `image_${Date.now()}`,
    type: img.type || 'image/jpeg',
    size: img.size || 0,
    data: img.data, // Оставляем base64 данные
    uploadedAt: img.uploadedAt || new Date().toISOString()
  }));

  const imagesJson = JSON.stringify(processedImages);

  // Проверяем общий размер (примерно)
  if (imagesJson.length > 10 * 1024 * 1024) { // 10MB лимит
    const error = new Error('Total images size too large');
    error.status = 400;
    throw error;
  }

  return imagesJson;
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

router.get('/', requireRole('admin', 'manager'), async (req, res) => {
  try {
    await ensureKnowledgeBaseSchema();
    const [rows] = await pool.execute('SELECT * FROM knowledge_base ORDER BY created_at DESC');
    res.json(rows.map(formatRow));
  } catch (error) {
    console.error('Error fetching knowledge base:', error);
    res.status(500).json({ error: knowledgeBaseErrorMessage(error) });
  }
});

router.post('/', requireRole('admin', 'manager'), async (req, res) => {
  try {
    await ensureKnowledgeBaseSchema();
    const { title, solution, category, images } = req.body;

    if (!title || !solution) {
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

    if (!title || !solution) {
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

    res.json({ message: 'Article deleted successfully' });
  } catch (error) {
    console.error('Error deleting knowledge base article:', error);
    res.status(500).json({ error: knowledgeBaseErrorMessage(error) });
  }
});

module.exports = router;
