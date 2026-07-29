// server/server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const employeeRoutes = require('./routes/employees');
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const pool = require('./config/database');

const app = express();
const PORT = Number(process.env.PORT || 5000);

app.options('*', cors());

// Middleware
const isAllowedCorsOrigin = (origin) => {
  if (!origin) return true;
  if (process.env.NODE_ENV === 'production') {
    return origin === 'https://react-suz.onrender.com';
  }

  try {
    const { hostname } = new URL(origin);
    return (
      hostname === 'localhost'
      || hostname === '127.0.0.1'
      || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)
      || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
      || /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)
    );
  } catch {
    return false;
  }
};

app.use(cors({
  origin(origin, callback) {
    if (isAllowedCorsOrigin(origin)) return callback(null, true);
    return callback(new Error('CORS origin is not allowed'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true,
  exposedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '150mb' })); // Увеличиваем лимит для изображений и видео-вложений
app.use(express.urlencoded({ extended: true, limit: '150mb' }));
app.use('/api/employees', employeeRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);

// Функция для преобразования дат в правильный формат MySQL
const formatDateForMySQL = (dateString) => {
  if (!dateString) return null;
  
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch (error) {
    console.error('Ошибка форматирования даты:', error);
    return null;
  }
};


const quoteColumn = (name) => `\`${name}\``;
const APPLICATION_WORKFLOW_COLUMN_NAMES = [
  'id', 'name', 'cabinet', 'application', 'process', 'N_tel', 'executor',
  'data', 'created_at', 'updated_at', 'start_data', 'end_data', 'fl', 'status', 'employee_login',
  'category', 'priority', 'accepted_by', 'accepted_at', 'work_started_at',
  'resolved_at', 'employee_confirmed_at', 'admin_comment', 'eta_minutes',
  'waiting_seconds', 'arrival_seconds', 'work_seconds', 'source',
  'chat_thread_id', 'source_message_id', 'employee_comment',
  'sla_paused_at', 'sla_paused_seconds'
];
const APPLICATION_WORKFLOW_COLUMNS = APPLICATION_WORKFLOW_COLUMN_NAMES.map(quoteColumn).join(', ');

const APPLICATION_STATUS_LABELS = {
  new: 'Новая',
  accepted: 'Назначена',
  in_progress: 'В работе',
  waiting_employee_confirmation: 'Ждёт подтверждения',
  done: 'Выполнена',
  reopened: 'Переоткрыта'
};

const formatNowForMySQL = () => formatDateForMySQL(new Date());
const secondsBetween = (start, end) => {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  return Math.max(0, Math.round((endMs - startMs) / 1000));
};

const normalizeApplication = (app = {}) => ({
  ...app,
  fl: Boolean(app.fl),
  status: app.status || (app.fl ? 'done' : 'new'),
  statusLabel: APPLICATION_STATUS_LABELS[app.status || (app.fl ? 'done' : 'new')] || 'Новая',
  eta_minutes: app.eta_minutes == null ? null : Number(app.eta_minutes),
  waiting_seconds: app.waiting_seconds == null ? null : Number(app.waiting_seconds),
  arrival_seconds: app.arrival_seconds == null ? null : Number(app.arrival_seconds),
  work_seconds: app.work_seconds == null ? null : Number(app.work_seconds),
  sla_paused_seconds: app.sla_paused_seconds == null ? null : Number(app.sla_paused_seconds)
});

const APPLICATION_WORKFLOW_ALTERS = [
  ['status', "ALTER TABLE application ADD COLUMN `status` VARCHAR(40) NULL DEFAULT 'new'"],
  ['created_at', 'ALTER TABLE application ADD COLUMN `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP'],
  ['updated_at', 'ALTER TABLE application ADD COLUMN `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
  ['employee_login', 'ALTER TABLE application ADD COLUMN `employee_login` VARCHAR(255) NULL'],
  ['category', 'ALTER TABLE application ADD COLUMN `category` VARCHAR(80) NULL'],
  ['priority', 'ALTER TABLE application ADD COLUMN `priority` VARCHAR(40) NULL'],
  ['accepted_by', 'ALTER TABLE application ADD COLUMN `accepted_by` VARCHAR(255) NULL'],
  ['accepted_at', 'ALTER TABLE application ADD COLUMN `accepted_at` DATETIME NULL'],
  ['work_started_at', 'ALTER TABLE application ADD COLUMN `work_started_at` DATETIME NULL'],
  ['resolved_at', 'ALTER TABLE application ADD COLUMN `resolved_at` DATETIME NULL'],
  ['employee_confirmed_at', 'ALTER TABLE application ADD COLUMN `employee_confirmed_at` DATETIME NULL'],
  ['admin_comment', 'ALTER TABLE application ADD COLUMN `admin_comment` TEXT NULL'],
  ['eta_minutes', 'ALTER TABLE application ADD COLUMN `eta_minutes` INT NULL'],
  ['waiting_seconds', 'ALTER TABLE application ADD COLUMN `waiting_seconds` INT NULL'],
  ['arrival_seconds', 'ALTER TABLE application ADD COLUMN `arrival_seconds` INT NULL'],
  ['work_seconds', 'ALTER TABLE application ADD COLUMN `work_seconds` INT NULL'],
  ['source', "ALTER TABLE application ADD COLUMN `source` VARCHAR(40) NOT NULL DEFAULT 'admin'"],
  ['chat_thread_id', 'ALTER TABLE application ADD COLUMN `chat_thread_id` VARCHAR(255) NULL'],
  ['source_message_id', 'ALTER TABLE application ADD COLUMN `source_message_id` VARCHAR(255) NULL'],
  ['employee_comment', 'ALTER TABLE application ADD COLUMN `employee_comment` TEXT NULL'],
  ['sla_paused_at', 'ALTER TABLE application ADD COLUMN `sla_paused_at` DATETIME NULL'],
  ['sla_paused_seconds', 'ALTER TABLE application ADD COLUMN `sla_paused_seconds` INT NULL']
];

let applicationSchemaReadyPromise = null;
const ensureApplicationWorkflowSchema = async () => {
  if (applicationSchemaReadyPromise) return applicationSchemaReadyPromise;
  applicationSchemaReadyPromise = (async () => {
    try {
      const [columns] = await pool.execute('SHOW COLUMNS FROM application');
      const existingColumns = columns || [];
      const existing = new Set(existingColumns.map((column) => column.Field));
      const statusColumn = existingColumns.find((column) => column.Field === 'status');
      if (statusColumn && /^enum/i.test(String(statusColumn.Type || ''))) {
        await pool.execute("ALTER TABLE application MODIFY COLUMN `status` VARCHAR(40) NULL DEFAULT 'new'");
      }
      for (const [columnName, alterSql] of APPLICATION_WORKFLOW_ALTERS) {
        if (!existing.has(columnName)) {
          try {
            await pool.execute(alterSql);
          } catch (alterError) {
            if (alterError.code !== 'ER_DUP_FIELDNAME') throw alterError;
          }
        }
      }
      try {
        await pool.execute(`
          CREATE TABLE IF NOT EXISTS application_events (
            id INT AUTO_INCREMENT PRIMARY KEY,
            application_id INT NOT NULL,
            actor_login VARCHAR(255) NULL,
            actor_role VARCHAR(40) NULL,
            event_type VARCHAR(80) NOT NULL,
            comment TEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_application_events_application_id (application_id)
          )
        `);
      } catch (eventTableError) {
        console.error('Не удалось подготовить журнал событий заявок:', eventTableError.message);
      }
      try {
        await pool.execute(`
          CREATE TABLE IF NOT EXISTS application_views (
            id INT AUTO_INCREMENT PRIMARY KEY,
            application_id INT NOT NULL,
            admin_login VARCHAR(255) NOT NULL,
            viewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_application_view_admin (application_id, admin_login),
            INDEX idx_application_views_admin_login (admin_login),
            INDEX idx_application_views_application_id (application_id)
          )
        `);
      } catch (viewTableError) {
        console.error('Не удалось подготовить просмотры заявок:', viewTableError.message);
      }
      await pool.execute(`
        UPDATE application
        SET \`status\` = CASE
          WHEN \`fl\` = 1 OR \`status\` = 'выполнено' THEN 'done'
          WHEN \`status\` = 'отменено' THEN 'reopened'
          WHEN \`status\` = 'в работе' THEN 'new'
          ELSE \`status\`
        END
        WHERE \`status\` IS NULL OR \`status\` = '' OR \`status\` IN ('в работе', 'выполнено', 'отменено')
      `);
    } catch (error) {
      applicationSchemaReadyPromise = null;
      console.error('Не удалось автоматически подготовить workflow заявок:', error.message);
      throw error;
    }
  })();
  return applicationSchemaReadyPromise;
};

const addApplicationEvent = async (applicationId, actorLogin, actorRole, eventType, comment = '') => {
  try {
    await pool.execute(
      'INSERT INTO application_events (`application_id`, `actor_login`, `actor_role`, `event_type`, `comment`) VALUES (?, ?, ?, ?, ?)',
      [applicationId, actorLogin || null, actorRole || null, eventType, comment || null]
    );
  } catch (error) {
    console.error('Не удалось записать событие заявки:', error.message);
  }
};

const getApplicationById = async (id) => {
  await ensureApplicationWorkflowSchema();
  const [rows] = await pool.execute(`SELECT ${APPLICATION_WORKFLOW_COLUMNS} FROM application WHERE \`id\` = ?`, [id]);
  return rows?.[0] ? normalizeApplication(rows[0]) : null;
};

// Безопасный парсинг JSON для изображений
const safeParseImages = (imagesString) => {
  if (!imagesString) return [];
  
  try {
    // Если imagesString уже массив, возвращаем его
    if (Array.isArray(imagesString)) {
      return imagesString;
    }
    
    // Если это строка, пытаемся распарсить
    if (typeof imagesString === 'string') {
      // Проверяем, не пустая ли строка
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

const NETWORK_MAP_SOURCE_URL = process.env.NETWORK_MAP_SOURCE_URL || 'http://nioch.nioch.nsc.ru/nioch/nioch.txt';

app.get('/api/network-map', async (req, res) => {
  try {
    const response = await fetch(NETWORK_MAP_SOURCE_URL);
    if (!response.ok) {
      return res.status(response.status).json({ error: `Не удалось загрузить сетку: ${response.status}` });
    }

    const zoneText = await response.text();
    res.json({
      sourceUrl: NETWORK_MAP_SOURCE_URL,
      fetchedAt: new Date().toISOString(),
      zoneText
    });
  } catch (error) {
    console.error('Error fetching network map:', error);
    res.status(500).json({ error: 'Не удалось загрузить сетку' });
  }
});

// API для базы знаний - ОБНОВЛЕННЫЕ МАРШРУТЫ С БЕЗОПАСНЫМ ПАРСИНГОМ
app.get('/api/knowledge-base', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM knowledge_base ORDER BY created_at DESC');
    
    // Используем безопасный парсинг для изображений
    const formattedRows = rows.map(row => ({
      ...row,
      images: safeParseImages(row.images),
      category: row.category || 'Общее'
    }));
    
    res.json(formattedRows);
  } catch (error) {
    console.error('Error fetching knowledge base:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/knowledge-base', async (req, res) => {
  try {
    const { title, solution, category, images } = req.body;
    
    if (!title || !solution) {
      return res.status(400).json({ error: 'Title and solution are required' });
    }

    // Обрабатываем images - преобразуем в JSON строку или NULL
    let imagesJson = null;
    if (images && images.length > 0) {
      try {
        // Проверяем, что images - это массив
        if (!Array.isArray(images)) {
          throw new Error('Images must be an array');
        }
        
        // Ограничиваем размер данных изображений
        const processedImages = images.map(img => ({
          name: img.name || `image_${Date.now()}`,
          type: img.type || 'image/jpeg',
          size: img.size || 0,
          data: img.data, // Оставляем base64 данные
          uploadedAt: img.uploadedAt || new Date().toISOString()
        }));
        
        imagesJson = JSON.stringify(processedImages);
        
        // Проверяем общий размер (примерно)
        const totalSize = imagesJson.length;
        if (totalSize > 10 * 1024 * 1024) { // 10MB лимит
          return res.status(400).json({ error: 'Total images size too large' });
        }
      } catch (parseError) {
        console.error('Error processing images:', parseError);
        return res.status(400).json({ error: 'Invalid images format' });
      }
    }

    const categoryValue = category || 'Общее';

    const [result] = await pool.execute(
      'INSERT INTO knowledge_base (title, solution, category, images) VALUES (?, ?, ?, ?)',
      [title, solution, categoryValue, imagesJson]
    );
    
    // Получаем созданную запись
    const [rows] = await pool.execute(
      'SELECT * FROM knowledge_base WHERE id = LAST_INSERT_ID()'
    );
    
    // Форматируем ответ с безопасным парсингом
    const formattedRow = {
      ...rows[0],
      images: safeParseImages(rows[0].images),
      category: rows[0].category || 'Общее'
    };
    
    res.json(formattedRow);
  } catch (error) {
    console.error('Error creating knowledge base article:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

app.put('/api/knowledge-base/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, solution, category, images } = req.body;
    
    if (!title || !solution) {
      return res.status(400).json({ error: 'Title and solution are required' });
    }

    // Обрабатываем images - преобразуем в JSON строку или NULL
    let imagesJson = null;
    if (images && images.length > 0) {
      try {
        // Проверяем, что images - это массив
        if (!Array.isArray(images)) {
          throw new Error('Images must be an array');
        }
        
        // Ограничиваем размер данных изображений
        const processedImages = images.map(img => ({
          name: img.name || `image_${Date.now()}`,
          type: img.type || 'image/jpeg',
          size: img.size || 0,
          data: img.data, // Оставляем base64 данные
          uploadedAt: img.uploadedAt || new Date().toISOString()
        }));
        
        imagesJson = JSON.stringify(processedImages);
        
        // Проверяем общий размер (примерно)
        const totalSize = imagesJson.length;
        if (totalSize > 10 * 1024 * 1024) { // 10MB лимит
          return res.status(400).json({ error: 'Total images size too large' });
        }
      } catch (parseError) {
        console.error('Error processing images:', parseError);
        return res.status(400).json({ error: 'Invalid images format' });
      }
    }

    const categoryValue = category || 'Общее';

    const [result] = await pool.execute(
      'UPDATE knowledge_base SET title = ?, solution = ?, `category` = ?, images = ?, updated_at = CURRENT_TIMESTAMP WHERE `id` = ?',
      [title, solution, categoryValue, imagesJson, id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }
    
    // Получаем обновленную запись
    const [rows] = await pool.execute(
      'SELECT * FROM knowledge_base WHERE `id` = ?',
      [id]
    );
    
    // Форматируем ответ с безопасным парсингом
    const formattedRow = {
      ...rows[0],
      images: safeParseImages(rows[0].images),
      category: rows[0].category || 'Общее'
    };
    
    res.json(formattedRow);
  } catch (error) {
    console.error('Error updating knowledge base article:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

app.delete('/api/knowledge-base/:id', async (req, res) => {
  try {
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ... остальной существующий код для заявок ...

// Функция для обработки NULL значений
const handleNullValues = (value, defaultValue = null) => {
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }
  return value;
};

app.get('/api/applications/export', async (req, res) => {
  const { status, from, to, search, employee_login } = req.query; // Добавлен параметр search
  const statusGroups = {
    done: ['done'],
    pending: ['new', 'accepted', 'in_progress', 'waiting_employee_confirmation', 'reopened'],
    queue: ['new', 'reopened'],
    active: ['accepted', 'in_progress'],
    confirmation: ['waiting_employee_confirmation']
  };

  let whereClause = [];
  const queryParams = [];

  if (status && status !== 'all') {
    if (status === 'overdue') {
      whereClause.push(APPLICATION_OVERDUE_SQL);
    } else {
      const statuses = statusGroups[status] || [status];
      const statusSql = '`status` IN (' + statuses.map(() => '?').join(',') + ')';
      whereClause.push(status === 'done' ? `(${statusSql} OR COALESCE(\`fl\`, 0) = 1)` : `COALESCE(\`fl\`, 0) = 0 AND ${statusSql}`);
      queryParams.push(...statuses);
    }
  }

  if (from) {
    const fromDate = new Date(from);
    if (isNaN(fromDate)) {
      return res.status(400).json({ error: 'Неверный формат даты "from". Используйте YYYY-MM-DD' });
    }
    whereClause.push('data >= ?');
    queryParams.push(fromDate.toISOString().split('T')[0] + ' 00:00:00');
  }

  if (to) {
    const toDate = new Date(to);
    if (isNaN(toDate)) {
      return res.status(400).json({ error: 'Неверный формат даты "to". Используйте YYYY-MM-DD' });
    }
    whereClause.push('data <= ?');
    queryParams.push(toDate.toISOString().split('T')[0] + ' 23:59:59');
  }

  // Добавлен поиск по тексту заявки
  if (search && search.trim()) {
    whereClause.push('(`application` LIKE ? OR `name` LIKE ? OR `cabinet` LIKE ? OR `N_tel` LIKE ? OR `executor` LIKE ? OR `category` LIKE ? OR `priority` LIKE ?)');
    const like = `%${search.trim()}%`;
    queryParams.push(like, like, like, like, like, like, like);
  }

  if (employee_login && employee_login.trim()) {
    whereClause.push('LOWER(`employee_login`) = ?');
    queryParams.push(employee_login.trim().toLowerCase());
  }

  const whereSql = whereClause.length > 0 ? 'WHERE ' + whereClause.join(' AND ') : '';

  try {
    await ensureApplicationWorkflowSchema();
    const applicationsQuery = `
      SELECT ${APPLICATION_WORKFLOW_COLUMNS}
      FROM application
      ${whereSql}
      ORDER BY \`data\` DESC
    `;

    const [applications] = await pool.execute(applicationsQuery, queryParams);

    const formattedApplications = applications.map(normalizeApplication);

    res.json({
      applications: formattedApplications,
      total: applications.length
    });
  } catch (error) {
    console.error('Ошибка при экспорте заявок:', error);
    res.status(500).json({ error: 'Ошибка сервера при экспорте заявок' });
  }
});


const APPLICATION_OVERDUE_SQL = `(
  COALESCE(\`fl\`, 0) = 0 AND (
    (\`sla_paused_at\` IS NOT NULL AND \`status\` IN ('new', 'reopened', 'accepted', 'in_progress', 'waiting_employee_confirmation'))
    OR
    (\`status\` IN ('new', 'reopened') AND (\`source\` = 'chat' OR COALESCE(\`employee_login\`, '') <> '') AND TIMESTAMPDIFF(MINUTE, COALESCE(\`created_at\`, \`data\`, NOW()), NOW()) > 15)
    OR (\`status\` IN ('accepted', 'in_progress') AND TIMESTAMPDIFF(MINUTE, COALESCE(\`work_started_at\`, \`accepted_at\`, \`start_data\`, \`created_at\`, \`data\`, NOW()), NOW()) > 30)
  )
)`;

const getApplicationEvents = async (applicationId) => {
  const [events] = await pool.execute(
    'SELECT `id`, `application_id`, `actor_login`, `actor_role`, `event_type`, `comment`, `created_at` FROM application_events WHERE `application_id` = ? ORDER BY `created_at` DESC, `id` DESC LIMIT 100',
    [applicationId]
  );
  return events;
};

const markApplicationViewed = async (applicationId, adminLogin) => {
  await ensureApplicationWorkflowSchema();
  await pool.execute(
    'INSERT INTO application_views (`application_id`, `admin_login`, `viewed_at`) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE `viewed_at` = NOW()',
    [applicationId, adminLogin]
  );
};

app.get('/api/applications', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit) || 10));
  const offset = (page - 1) * limit;

  const { status, from, to, search, employee_login, queue, assignee, sort } = req.query; // Добавлен параметр search
  const statusGroups = {
    done: ['done'],
    pending: ['new', 'accepted', 'in_progress', 'waiting_employee_confirmation', 'reopened'],
    queue: ['new', 'reopened'],
    active: ['accepted', 'in_progress'],
    confirmation: ['waiting_employee_confirmation']
  };

  let whereClause = [];
  const queryParams = [];

  if (status && status !== 'all') {
    if (status === 'overdue') {
      whereClause.push(APPLICATION_OVERDUE_SQL);
    } else {
      const statuses = statusGroups[status] || [status];
      const statusSql = '`status` IN (' + statuses.map(() => '?').join(',') + ')';
      whereClause.push(status === 'done' ? `(${statusSql} OR COALESCE(\`fl\`, 0) = 1)` : `COALESCE(\`fl\`, 0) = 0 AND ${statusSql}`);
      queryParams.push(...statuses);
    }
  }

  if (from) {
    const fromDate = new Date(from);
    if (isNaN(fromDate)) {
      return res.status(400).json({ error: 'Неверный формат даты "from". Используйте YYYY-MM-DD' });
    }
    whereClause.push('data >= ?');
    queryParams.push(fromDate.toISOString().split('T')[0] + ' 00:00:00');
  }

  if (to) {
    const toDate = new Date(to);
    if (isNaN(toDate)) {
      return res.status(400).json({ error: 'Неверный формат даты "to". Используйте YYYY-MM-DD' });
    }
    whereClause.push('data <= ?');
    queryParams.push(toDate.toISOString().split('T')[0] + ' 23:59:59');
  }

  // Добавлен поиск по тексту заявки
  if (search && search.trim()) {
    whereClause.push('(`application` LIKE ? OR `name` LIKE ? OR `cabinet` LIKE ? OR `N_tel` LIKE ? OR `executor` LIKE ? OR `category` LIKE ? OR `priority` LIKE ?)');
    const like = `%${search.trim()}%`;
    queryParams.push(like, like, like, like, like, like, like);
  }

  if (employee_login && employee_login.trim()) {
    whereClause.push('LOWER(`employee_login`) = ?');
    queryParams.push(employee_login.trim().toLowerCase());
  }

  if (queue === 'unassigned') {
    whereClause.push("COALESCE(`fl`, 0) = 0 AND COALESCE(NULLIF(TRIM(`executor`), ''), NULLIF(TRIM(`accepted_by`), '')) IS NULL");
  }

  if (queue === 'my' && assignee && assignee.trim()) {
    const normalizedAssignee = assignee.trim().toLowerCase();
    whereClause.push('(LOWER(COALESCE(`executor`, \'\')) LIKE ? OR LOWER(COALESCE(`accepted_by`, \'\')) = ?)');
    queryParams.push(`%${normalizedAssignee}%`, normalizedAssignee);
  }

  const whereSql = whereClause.length > 0 ? 'WHERE ' + whereClause.join(' AND ') : '';
  const sortSqlMap = {
    status: 'ORDER BY FIELD(`status`, \'new\', \'reopened\', \'accepted\', \'in_progress\', \'waiting_employee_confirmation\', \'done\'), `data` DESC',
    date_asc: 'ORDER BY `data` ASC, `id` ASC',
    date_desc: 'ORDER BY `data` DESC, `id` DESC',
    executor: 'ORDER BY COALESCE(NULLIF(TRIM(`executor`), \'\'), \'яяя\') ASC, `data` DESC',
    sla: `ORDER BY CASE WHEN ${APPLICATION_OVERDUE_SQL} THEN 0 WHEN \`status\` IN ('new', 'reopened') THEN 1 WHEN \`status\` IN ('accepted', 'in_progress') THEN 2 ELSE 3 END ASC, \`data\` DESC`
  };
  const orderSql = sortSqlMap[sort] || sortSqlMap.date_desc;

  try {
    await ensureApplicationWorkflowSchema();
    // Запрос общего количества с учетом фильтров
    const totalQuery = `SELECT COUNT(*) AS total FROM application ${whereSql}`;
    const [totalResult] = await pool.execute(totalQuery, whereSql ? queryParams : []);

    // Запрос количества выполненных заявок с учетом фильтров
    const completedQuery = 'SELECT COUNT(*) AS count FROM application ' + (whereSql ? whereSql + ' AND `fl` = ?' : 'WHERE `fl` = ?');
    const [completedResult] = await pool.execute(
      completedQuery,
      whereSql ? [...queryParams, 1] : [1]
    );

    // Запрос количества заявок в работе с учетом фильтров
    const pendingQuery = 'SELECT COUNT(*) AS count FROM application ' + (whereSql ? whereSql + ' AND COALESCE(`fl`, 0) = 0 AND `status` IN (?, ?, ?, ?, ?)' : 'WHERE COALESCE(`fl`, 0) = 0 AND `status` IN (?, ?, ?, ?, ?)');
    const [pendingResult] = await pool.execute(
      pendingQuery,
      whereSql ? [...queryParams, 'new', 'accepted', 'in_progress', 'waiting_employee_confirmation', 'reopened'] : ['new', 'accepted', 'in_progress', 'waiting_employee_confirmation', 'reopened']
    );
    const [queueResult] = await pool.execute('SELECT COUNT(*) AS count FROM application WHERE COALESCE(`fl`, 0) = 0 AND `status` IN (?, ?)', ['new', 'reopened']);
    const [acceptedResult] = await pool.execute('SELECT COUNT(*) AS count FROM application WHERE COALESCE(`fl`, 0) = 0 AND `status` = ?', ['accepted']);
    const [inProgressResult] = await pool.execute('SELECT COUNT(*) AS count FROM application WHERE COALESCE(`fl`, 0) = 0 AND `status` = ?', ['in_progress']);
    const [activeResult] = await pool.execute('SELECT COUNT(*) AS count FROM application WHERE COALESCE(`fl`, 0) = 0 AND `status` IN (?, ?)', ['accepted', 'in_progress']);
    const [confirmationResult] = await pool.execute('SELECT COUNT(*) AS count FROM application WHERE COALESCE(`fl`, 0) = 0 AND `status` = ?', ['waiting_employee_confirmation']);
    const [overdueResult] = await pool.execute(`SELECT COUNT(*) AS count FROM application WHERE ${APPLICATION_OVERDUE_SQL}`);

    const total = totalResult[0].total;
    const completed = completedResult[0].count;
    const pending = pendingResult[0].count;
    const totalPages = Math.ceil(total / limit);

    // Запрос заявок с пагинацией
    const applicationsQuery = `
	      SELECT ${APPLICATION_WORKFLOW_COLUMNS}
	      FROM application
	      ${whereSql}
      ${orderSql}
      LIMIT ? OFFSET ?
    `;

    const [applications] = await pool.execute(applicationsQuery, [...queryParams, limit, offset]);

    const formattedApplications = applications.map(normalizeApplication);

    res.json({
      applications: formattedApplications,
      totalPages,
      currentPage: page,
      stats: { total, completed, pending, queue: queueResult[0].count, accepted: acceptedResult[0].count, in_progress: inProgressResult[0].count, active: activeResult[0].count, confirmation: confirmationResult[0].count, overdue: overdueResult[0].count }
    });
  } catch (error) {
    console.error('Ошибка при запросе к БД:', error);
    res.status(500).json({ 
      error: 'Ошибка сервера при получении заявок',
      details: error.message 
    });
  }
});


app.get('/api/applications/unseen-count', async (req, res) => {
  const adminLogin = String(req.query.admin_login || req.query.login || 'admin').trim() || 'admin';
  try {
    await ensureApplicationWorkflowSchema();
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS count
       FROM application a
       LEFT JOIN application_views v ON v.application_id = a.id AND v.admin_login = ?
       WHERE a.\`status\` IN ('new', 'reopened') AND v.id IS NULL`,
      [adminLogin]
    );
    res.json({ count: rows[0]?.count || 0 });
  } catch (error) {
    console.error('Ошибка подсчёта непросмотренных заявок:', error);
    res.status(500).json({ error: 'Не удалось получить количество новых заявок', details: error.sqlMessage || error.message });
  }
});

app.get('/api/applications/:id/events', async (req, res) => {
  try {
    await ensureApplicationWorkflowSchema();
    const events = await getApplicationEvents(req.params.id);
    res.json({ events });
  } catch (error) {
    console.error('Ошибка получения истории заявки:', error);
    res.status(500).json({ error: 'Не удалось получить историю заявки', details: error.sqlMessage || error.message });
  }
});

app.post('/api/applications/:id/view', async (req, res) => {
  const adminLogin = String(req.body?.admin_login || req.body?.actor || 'admin').trim() || 'admin';
  try {
    await markApplicationViewed(req.params.id, adminLogin);
    await addApplicationEvent(req.params.id, adminLogin, 'admin', 'viewed', 'Администратор открыл карточку заявки');
    res.json({ message: 'Заявка отмечена просмотренной' });
  } catch (error) {
    console.error('Ошибка отметки просмотра заявки:', error);
    res.status(500).json({ error: 'Не удалось отметить заявку просмотренной', details: error.sqlMessage || error.message });
  }
});

app.get('/api/applications/my', async (req, res) => {
  const login = String(req.query.employee_login || req.query.login || '').trim().toLowerCase();
  if (!login) return res.status(400).json({ error: 'employee_login обязателен' });

  try {
    await ensureApplicationWorkflowSchema();
    const [applications] = await pool.execute(
      `SELECT ${APPLICATION_WORKFLOW_COLUMNS} FROM application WHERE LOWER(\`employee_login\`) = ? ORDER BY \`data\` DESC LIMIT 100`,
      [login]
    );
    res.json({ applications: applications.map(normalizeApplication) });
  } catch (error) {
    console.error('Ошибка при получении заявок сотрудника:', error);
    res.status(500).json({ error: 'Не удалось получить заявки сотрудника', details: error.sqlMessage || error.message });
  }
});

app.post('/api/applications', async (req, res) => {
  const {
    name, cabinet, N_tel, application, process, executor,
    data, start_data, end_data, fl, status, employee_login, category,
    priority, source, chat_thread_id, source_message_id
  } = req.body;

  try {
    await ensureApplicationWorkflowSchema();
    const normalizedStatus = status || (fl ? 'done' : 'new');
    const processedData = {
      name: handleNullValues(name, ''),
      cabinet: handleNullValues(cabinet, ''),
      N_tel: handleNullValues(N_tel, ''),
      application: handleNullValues(application, ''),
      process: handleNullValues(process, ''),
      executor: handleNullValues(executor, ''),
      data: formatDateForMySQL(data) || formatNowForMySQL(),
      start_data: formatDateForMySQL(start_data),
      end_data: formatDateForMySQL(end_data),
      fl: normalizedStatus === 'done' || fl ? 1 : 0,
      status: normalizedStatus,
      employee_login: handleNullValues(employee_login, ''),
      category: handleNullValues(category, ''),
      priority: handleNullValues(priority, ''),
      source: handleNullValues(source, 'admin'),
      chat_thread_id: handleNullValues(chat_thread_id, ''),
      source_message_id: handleNullValues(source_message_id, '')
    };

    const [result] = await pool.execute(
      'INSERT INTO application (`name`, `cabinet`, `N_tel`, `application`, `process`, `executor`, `data`, `start_data`, `end_data`, `fl`, `status`, `employee_login`, `category`, `priority`, `source`, `chat_thread_id`, `source_message_id`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        processedData.name, processedData.cabinet, processedData.N_tel, processedData.application,
        processedData.process, processedData.executor, processedData.data, processedData.start_data,
        processedData.end_data, processedData.fl, processedData.status, processedData.employee_login,
        processedData.category, processedData.priority, processedData.source, processedData.chat_thread_id,
        processedData.source_message_id
      ]
    );
    await addApplicationEvent(result.insertId, processedData.employee_login || processedData.executor || 'admin', processedData.source, 'created', 'Заявка создана');

    res.status(201).json({
      message: 'Заявка добавлена',
      id: result.insertId,
      application: await getApplicationById(result.insertId)
    });
  } catch (error) {
    console.error('Ошибка при добавлении заявки:', error);
    res.status(500).json({
      error: 'Не удалось добавить заявку',
      details: error.sqlMessage || error.message
    });
  }
});

app.post('/api/applications/from-chat', async (req, res) => {
  const now = formatNowForMySQL();
  const {
    employee_login, name, cabinet, N_tel, application, category, priority,
    chat_thread_id, source_message_id
  } = req.body;

  try {
    await ensureApplicationWorkflowSchema();
    const [result] = await pool.execute(
      'INSERT INTO application (`name`, `cabinet`, `N_tel`, `application`, `process`, `executor`, `data`, `start_data`, `end_data`, `fl`, `status`, `employee_login`, `category`, `priority`, `source`, `chat_thread_id`, `source_message_id`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        handleNullValues(name, 'Сотрудник'), handleNullValues(cabinet, ''), handleNullValues(N_tel, ''),
        handleNullValues(application, ''), '', '', now, null, null, 0, 'new',
        handleNullValues(employee_login, ''), handleNullValues(category, 'Другое'),
        handleNullValues(priority, 'Обычный'), 'chat', handleNullValues(chat_thread_id, ''),
        handleNullValues(source_message_id, '')
      ]
    );
    await addApplicationEvent(result.insertId, employee_login || 'employee', 'employee', 'created_from_chat', 'Заявка создана из чата сотрудника');
    res.status(201).json({ message: 'Заявка из чата создана', id: result.insertId, application: await getApplicationById(result.insertId) });
  } catch (error) {
    console.error('Ошибка при создании заявки из чата:', error);
    res.status(500).json({ error: 'Не удалось создать заявку из чата', details: error.sqlMessage || error.message });
  }
});

app.put('/api/applications/:id', async (req, res) => {
  const { id } = req.params;
  const {
    name, cabinet, N_tel, application, process, executor,
    data, start_data, end_data, fl, status, employee_login, category,
    priority, accepted_by, accepted_at, work_started_at, resolved_at,
    employee_confirmed_at, admin_comment, eta_minutes, waiting_seconds,
    arrival_seconds, work_seconds, source, chat_thread_id, source_message_id,
    employee_comment
  } = req.body;

  try {
    await ensureApplicationWorkflowSchema();
    const existingApp = await getApplicationById(id);
    if (!existingApp) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }

    const has = (field) => Object.prototype.hasOwnProperty.call(req.body, field);
    const pick = (field, fallback = null) => (has(field) ? handleNullValues(req.body[field], fallback) : existingApp[field]);
    const pickDate = (field) => (has(field) ? formatDateForMySQL(req.body[field]) : existingApp[field]);
    const nextStatus = has('fl') && Boolean(fl) ? 'done' : (has('status') ? (status || 'new') : (has('fl') ? 'new' : existingApp.status));
    const processedData = {
      name: pick('name', ''), cabinet: pick('cabinet', ''), N_tel: pick('N_tel', ''),
      application: pick('application', ''), process: pick('process', ''), executor: pick('executor', ''),
      data: pickDate('data'), start_data: pickDate('start_data'), end_data: pickDate('end_data'),
      fl: nextStatus === 'done' || (has('fl') ? Boolean(fl) : existingApp.fl) ? 1 : 0, status: nextStatus,
      employee_login: pick('employee_login', ''), category: pick('category', ''), priority: pick('priority', ''),
      accepted_by: pick('accepted_by', ''), accepted_at: pickDate('accepted_at'), work_started_at: pickDate('work_started_at'),
      resolved_at: pickDate('resolved_at'), employee_confirmed_at: pickDate('employee_confirmed_at'),
      admin_comment: pick('admin_comment', ''), eta_minutes: has('eta_minutes') ? (eta_minutes || null) : existingApp.eta_minutes,
      waiting_seconds: has('waiting_seconds') ? (waiting_seconds || null) : existingApp.waiting_seconds,
      arrival_seconds: has('arrival_seconds') ? (arrival_seconds || null) : existingApp.arrival_seconds,
      work_seconds: has('work_seconds') ? (work_seconds || null) : existingApp.work_seconds,
      source: pick('source', 'admin'), chat_thread_id: pick('chat_thread_id', ''),
      source_message_id: pick('source_message_id', ''), employee_comment: pick('employee_comment', '')
    };

    await pool.execute(
      'UPDATE application SET ' +
        '`name` = ?, `cabinet` = ?, `N_tel` = ?, `application` = ?, `process` = ?, `executor` = ?, `data` = ?, ' +
        '`start_data` = ?, `end_data` = ?, `fl` = ?, `status` = ?, `employee_login` = ?, `category` = ?, `priority` = ?, ' +
        '`accepted_by` = ?, `accepted_at` = ?, `work_started_at` = ?, `resolved_at` = ?, `employee_confirmed_at` = ?, ' +
        '`admin_comment` = ?, `eta_minutes` = ?, `waiting_seconds` = ?, `arrival_seconds` = ?, `work_seconds` = ?, ' +
        '`source` = ?, `chat_thread_id` = ?, `source_message_id` = ?, `employee_comment` = ? WHERE `id` = ?',
      [
        processedData.name, processedData.cabinet, processedData.N_tel, processedData.application,
        processedData.process, processedData.executor, processedData.data, processedData.start_data,
        processedData.end_data, processedData.fl, processedData.status, processedData.employee_login,
        processedData.category, processedData.priority, processedData.accepted_by, processedData.accepted_at,
        processedData.work_started_at, processedData.resolved_at, processedData.employee_confirmed_at,
        processedData.admin_comment, processedData.eta_minutes, processedData.waiting_seconds,
        processedData.arrival_seconds, processedData.work_seconds, processedData.source,
        processedData.chat_thread_id, processedData.source_message_id, processedData.employee_comment, id
      ]
    );
    await addApplicationEvent(id, accepted_by || executor || 'admin', 'admin', 'manual_update', 'Заявка обновлена вручную');

    res.status(200).json({ message: 'Заявка успешно обновлена', application: await getApplicationById(id) });
  } catch (error) {
    console.error('Ошибка при обновлении заявки:', error);
    res.status(500).json({ 
      error: 'Не удалось обновить заявку',
      details: error.sqlMessage || error.message 
    });
  }
});


const updateApplicationWorkflow = async (id, updater, event) => {
  const app = await getApplicationById(id);
  if (!app) return null;
  const next = updater(app);
  await pool.execute(next.sql, next.params);
  if (event) await addApplicationEvent(id, event.actorLogin, event.actorRole, event.eventType, event.comment);
  return getApplicationById(id);
};

const getCurrentSlaSeconds = (app = {}, now = new Date()) => {
  if (app.sla_paused_seconds != null) return Number(app.sla_paused_seconds) || 0;
  const status = app.status || (app.fl ? 'done' : 'new');
  if (['accepted', 'in_progress'].includes(status)) {
    return secondsBetween(app.work_started_at || app.accepted_at || app.start_data || app.created_at || app.data, now) || 0;
  }
  return secondsBetween(app.created_at || app.data, now) || 0;
};

app.post('/api/applications/:id/accept', async (req, res) => {
  const { id } = req.params;
  const { accepted_by, executor, eta_minutes, admin_comment } = req.body;
  try {
    await ensureApplicationWorkflowSchema();
    const updated = await updateApplicationWorkflow(id, (app) => {
      const now = formatNowForMySQL();
      return {
        sql: 'UPDATE application SET `status` = ?, `accepted_by` = ?, `executor` = ?, `eta_minutes` = ?, `admin_comment` = ?, `accepted_at` = ?, `work_started_at` = ?, `start_data` = ?, `waiting_seconds` = ?, `arrival_seconds` = ?, `fl` = 0 WHERE `id` = ?',
        params: ['in_progress', accepted_by || 'admin', executor || accepted_by || '', eta_minutes || null, admin_comment || '', now, now, now, secondsBetween(app.created_at || app.data, now), 0, id]
      };
    }, { actorLogin: accepted_by || 'admin', actorRole: 'admin', eventType: 'accepted', comment: admin_comment || 'Заявка взята в работу' });
    if (!updated) return res.status(404).json({ error: 'Заявка не найдена' });
    res.json({ message: 'Заявка взята в работу, таймер выполнения запущен', application: updated });
  } catch (error) {
    console.error('Ошибка при взятии заявки:', error);
    res.status(500).json({ error: 'Не удалось взять заявку', details: error.sqlMessage || error.message });
  }
});

app.post('/api/applications/:id/start-work', async (req, res) => {
  const { id } = req.params;
  const { actor } = req.body;
  try {
    await ensureApplicationWorkflowSchema();
    const updated = await updateApplicationWorkflow(id, (app) => {
      const now = formatNowForMySQL();
      return {
        sql: 'UPDATE application SET `status` = ?, `work_started_at` = ?, `start_data` = ?, `arrival_seconds` = ?, `fl` = 0 WHERE `id` = ?',
        params: ['in_progress', now, now, secondsBetween(app.accepted_at || app.created_at || app.data, now), id]
      };
    }, { actorLogin: actor || 'admin', actorRole: 'admin', eventType: 'work_started', comment: 'Исполнитель начал работу' });
    if (!updated) return res.status(404).json({ error: 'Заявка не найдена' });
    res.json({ message: 'Работа начата', application: updated });
  } catch (error) {
    console.error('Ошибка при старте работы:', error);
    res.status(500).json({ error: 'Не удалось начать работу', details: error.sqlMessage || error.message });
  }
});

app.post('/api/applications/:id/resolve', async (req, res) => {
  const { id } = req.params;
  const { actor, process } = req.body;
  try {
    await ensureApplicationWorkflowSchema();
    const updated = await updateApplicationWorkflow(id, (app) => {
      const now = formatNowForMySQL();
      const previousWorkSeconds = Number(app.work_seconds || 0);
      const currentWorkSeconds = secondsBetween(app.work_started_at || app.accepted_at || app.created_at || app.data, now) || 0;
      return {
        sql: 'UPDATE application SET `status` = ?, `resolved_at` = ?, `process` = ?, `work_seconds` = ?, `fl` = 0 WHERE `id` = ?',
        params: ['waiting_employee_confirmation', now, process || app.process || '', previousWorkSeconds + currentWorkSeconds, id]
      };
    }, { actorLogin: actor || 'admin', actorRole: 'admin', eventType: 'resolved', comment: process || 'Работа выполнена, ожидается подтверждение' });
    if (!updated) return res.status(404).json({ error: 'Заявка не найдена' });
    res.json({ message: 'Заявка отправлена на подтверждение', application: updated });
  } catch (error) {
    console.error('Ошибка при завершении работы:', error);
    res.status(500).json({ error: 'Не удалось завершить работу', details: error.sqlMessage || error.message });
  }
});

app.post('/api/applications/:id/confirm', async (req, res) => {
  const { id } = req.params;
  const { actor, employee_comment } = req.body;
  try {
    await ensureApplicationWorkflowSchema();
    const updated = await updateApplicationWorkflow(id, (app) => {
      const now = formatNowForMySQL();
      const previousWorkSeconds = Number(app.work_seconds || 0);
      const activeWorkSeconds = secondsBetween(app.resolved_at || app.work_started_at || app.accepted_at || app.created_at || app.data, now) || 0;
      const workSeconds = previousWorkSeconds + activeWorkSeconds;
      return {
        sql: 'UPDATE application SET `status` = ?, `resolved_at` = ?, `work_seconds` = ?, `employee_confirmed_at` = ?, `employee_comment` = ?, `end_data` = ?, `fl` = 1 WHERE `id` = ?',
        params: ['done', app.resolved_at || now, workSeconds, now, employee_comment || app.employee_comment || '', now, id]
      };
    }, { actorLogin: actor || 'employee', actorRole: 'employee', eventType: 'employee_confirmed', comment: employee_comment || 'Сотрудник подтвердил выполнение' });
    if (!updated) return res.status(404).json({ error: 'Заявка не найдена' });
    res.json({ message: 'Заявка подтверждена', application: updated });
  } catch (error) {
    console.error('Ошибка при подтверждении заявки:', error);
    res.status(500).json({ error: 'Не удалось подтвердить заявку', details: error.sqlMessage || error.message });
  }
});

app.post('/api/applications/:id/reopen', async (req, res) => {
  const { id } = req.params;
  const { actor, employee_comment } = req.body;
  try {
    await ensureApplicationWorkflowSchema();
    const updated = await updateApplicationWorkflow(id, () => ({
      sql: 'UPDATE application SET `status` = ?, `employee_comment` = ?, `work_started_at` = NULL, `resolved_at` = NULL, `fl` = 0 WHERE `id` = ?',
      params: ['reopened', employee_comment || '', id]
    }), { actorLogin: actor || 'employee', actorRole: 'employee', eventType: 'reopened', comment: employee_comment || 'Проблема осталась' });
    if (!updated) return res.status(404).json({ error: 'Заявка не найдена' });
    res.json({ message: 'Заявка переоткрыта', application: updated });
  } catch (error) {
    console.error('Ошибка при переоткрытии заявки:', error);
    res.status(500).json({ error: 'Не удалось переоткрыть заявку', details: error.sqlMessage || error.message });
  }
});

app.post('/api/applications/:id/pause-overdue', async (req, res) => {
  const { id } = req.params;
  const { actor } = req.body;
  try {
    await ensureApplicationWorkflowSchema();
    const updated = await updateApplicationWorkflow(id, (app) => {
      const nowDate = new Date();
      const now = formatDateForMySQL(nowDate);
      const pausedSeconds = getCurrentSlaSeconds(app, nowDate);
      return {
        sql: 'UPDATE application SET `sla_paused_at` = ?, `sla_paused_seconds` = ? WHERE `id` = ?',
        params: [now, pausedSeconds, id]
      };
    }, { actorLogin: actor || 'admin', actorRole: 'admin', eventType: 'sla_timer_paused', comment: 'Администратор остановил отображение таймера просрочки' });
    if (!updated) return res.status(404).json({ error: 'Заявка не найдена' });
    res.json({ message: 'Таймер просрочки остановлен. Заявка остаётся в просроченных.', application: updated });
  } catch (error) {
    console.error('Ошибка при остановке таймера просрочки:', error);
    res.status(500).json({ error: 'Не удалось остановить таймер просрочки', details: error.sqlMessage || error.message });
  }
});

app.delete('/api/applications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const applicationId = parseInt(id, 10);
    
    if (isNaN(applicationId)) {
      return res.status(400).json({ error: 'Неверный формат ID' });
    }
    
    const [existing] = await pool.execute(
      'SELECT id FROM application WHERE `id` = ?',
      [applicationId]
    );
    
    if (!existing || existing.length === 0) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }
    
    const [result] = await pool.execute(
      'DELETE FROM application WHERE `id` = ?',
      [applicationId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(500).json({ error: 'Удаление не выполнено' });
    }
    
    res.status(200).json({ 
      message: 'Заявка успешно удалена', 
      id: applicationId 
    });
    
  } catch (error) {
    console.error('Ошибка при удалении:', error);
    res.status(500).json({ 
      error: 'Произошла ошибка при удалении', 
      details: error.message 
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Сервер работает',
    timestamp: new Date(),
    commit: process.env.RENDER_GIT_COMMIT || process.env.SOURCE_VERSION || null,
    branch: process.env.RENDER_GIT_BRANCH || null
  });
});

// API-запрос никогда не должен проваливаться в React index.html: клиент ожидает JSON.
app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'API route not found',
    path: req.originalUrl
  });
});

app.use((err, req, res, next) => {
  console.error('Произошла ошибка:', err);
  res.status(500).json({ error: 'Произошла внутренняя ошибка сервера' });
});

// ✅ ОБСЛУЖИВАНИЕ СТАТИЧЕСКИХ ФАЙЛОВ ДЛЯ RENDER
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../build')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../build', 'index.html'));
  });
}

// Клиент разработки обращается к API на порту 5000. Не переключаемся на другой
// порт молча: иначе новый интерфейс начинает работать со старым сервером.
const startServer = (port) => {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на порту ${port}`);
    console.log(`✅ Режим: ${process.env.NODE_ENV || 'development'}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`❌ Порт ${port} занят. Остановите предыдущий запуск проекта и запустите npm run dev снова.`);
    } else {
      console.error('❌ Не удалось запустить сервер:', error.message);
    }
    process.exit(1);
  });
};

startServer(PORT);
