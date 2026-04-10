// server/server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const employeeRoutes = require('./routes/employees');
const pool = require('./config/database');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const MAX_PORT_RETRIES = 10;

app.options('*', cors());

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://react-suz.onrender.com']
    : ['http://localhost:3000', 'http://192.168.1.35:3000', 'http://192.168.1.35:5000','http://192.168.1.35'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
  exposedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' })); // Увеличиваем лимит для больших изображений
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use('/api/employees', employeeRoutes);

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
      'UPDATE knowledge_base SET title = ?, solution = ?, category = ?, images = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [title, solution, categoryValue, imagesJson, id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }
    
    // Получаем обновленную запись
    const [rows] = await pool.execute(
      'SELECT * FROM knowledge_base WHERE id = ?',
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
      'DELETE FROM knowledge_base WHERE id = ?',
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
  const { status, from, to, search } = req.query; // Добавлен параметр search

  let whereClause = [];
  const queryParams = [];

  if (status === 'done') {
    whereClause.push('fl = ?');
    queryParams.push(1);
  } else if (status === 'pending') {
    whereClause.push('fl = ?');
    queryParams.push(0);
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
    whereClause.push('application LIKE ?');
    queryParams.push(`%${search.trim()}%`);
  }

  const whereSql = whereClause.length > 0 ? 'WHERE ' + whereClause.join(' AND ') : '';

  try {
    const applicationsQuery = `
      SELECT 
        id, name, cabinet, application, process, N_tel, executor, 
        data, start_data, end_data, fl
      FROM application
      ${whereSql}
      ORDER BY data DESC
    `;

    const [applications] = await pool.execute(applicationsQuery, queryParams);

    const formattedApplications = applications.map(app => ({
      ...app,
      fl: Boolean(app.fl)
    }));

    res.json({
      applications: formattedApplications,
      total: applications.length
    });
  } catch (error) {
    console.error('Ошибка при экспорте заявок:', error);
    res.status(500).json({ error: 'Ошибка сервера при экспорте заявок' });
  }
});

app.get('/api/applications', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit) || 10));
  const offset = (page - 1) * limit;

  const { status, from, to, search } = req.query; // Добавлен параметр search

  let whereClause = [];
  const queryParams = [];

  if (status === 'done') {
    whereClause.push('fl = ?');
    queryParams.push(1);
  } else if (status === 'pending') {
    whereClause.push('fl = ?');
    queryParams.push(0);
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
    whereClause.push('application LIKE ?');
    queryParams.push(`%${search.trim()}%`);
  }

  const whereSql = whereClause.length > 0 ? 'WHERE ' + whereClause.join(' AND ') : '';

  try {
    // Запрос общего количества с учетом фильтров
    const totalQuery = `SELECT COUNT(*) AS total FROM application ${whereSql}`;
    const [totalResult] = await pool.execute(totalQuery, whereSql ? queryParams : []);

    // Запрос количества выполненных заявок с учетом фильтров
    const completedQuery = `SELECT COUNT(*) AS count FROM application ${whereSql ? whereSql + ' AND fl = ?' : 'WHERE fl = ?'}`;
    const [completedResult] = await pool.execute(
      completedQuery,
      whereSql ? [...queryParams, 1] : [1]
    );

    // Запрос количества заявок в работе с учетом фильтров
    const pendingQuery = `SELECT COUNT(*) AS count FROM application ${whereSql ? whereSql + ' AND fl = ?' : 'WHERE fl = ?'}`;
    const [pendingResult] = await pool.execute(
      pendingQuery,
      whereSql ? [...queryParams, 0] : [0]
    );

    const total = totalResult[0].total;
    const completed = completedResult[0].count;
    const pending = pendingResult[0].count;
    const totalPages = Math.ceil(total / limit);

    // Запрос заявок с пагинацией
    const applicationsQuery = `
      SELECT 
        id, name, cabinet, application, process, N_tel, executor, 
        data, start_data, end_data, fl
      FROM application
      ${whereSql}
      ORDER BY data DESC
      LIMIT ? OFFSET ?
    `;

    // Формируем запрос с параметрами
    const query = pool.format(applicationsQuery, [...queryParams, limit, offset]);
    const [applications] = await pool.query(query);

    const formattedApplications = applications.map(app => ({
      ...app,
      fl: Boolean(app.fl)
    }));

    res.json({
      applications: formattedApplications,
      totalPages,
      currentPage: page,
      stats: { total, completed, pending }
    });
  } catch (error) {
    console.error('Ошибка при запросе к БД:', error);
    res.status(500).json({ 
      error: 'Ошибка сервера при получении заявок',
      details: error.message 
    });
  }
});

app.post('/api/applications', async (req, res) => {
  const {
    name, cabinet, N_tel, application, process, executor,
    data, start_data, end_data, fl
  } = req.body;

  try {
    const processedData = {
      name: handleNullValues(name, ''),
      cabinet: handleNullValues(cabinet, ''),
      N_tel: handleNullValues(N_tel, ''),
      application: handleNullValues(application, ''),
      process: handleNullValues(process, ''),
      executor: handleNullValues(executor, ''),
      data: formatDateForMySQL(data) || formatDateForMySQL(new Date()),
      start_data: formatDateForMySQL(start_data),
      end_data: formatDateForMySQL(end_data),
      fl: fl ? 1 : 0
    };

    console.log('Добавление заявки с обработанными данными:', processedData);

    const [result] = await pool.execute(
      `INSERT INTO application 
      (name, cabinet, N_tel, application, process, executor, data, start_data, end_data, fl)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        processedData.name,
        processedData.cabinet,
        processedData.N_tel,
        processedData.application,
        processedData.process,
        processedData.executor,
        processedData.data,
        processedData.start_data,
        processedData.end_data,
        processedData.fl
      ]
    );

    res.status(201).json({ 
      message: 'Заявка добавлена',
      id: result.insertId 
    });
  } catch (error) {
    console.error('Ошибка при добавлении заявки:', error);
    res.status(500).json({ 
      error: 'Не удалось добавить заявку',
      details: error.sqlMessage || error.message
    });
  }
});

app.put('/api/applications/:id', async (req, res) => {
  const { id } = req.params;
  const {
    name, cabinet, N_tel, application, process, executor,
    data, start_data, end_data, fl
  } = req.body;

  try {
    const [existingApp] = await pool.execute(
      'SELECT id FROM application WHERE id = ?',
      [id]
    );

    if (!existingApp || existingApp.length === 0) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }

    const processedData = {
      name: handleNullValues(name),
      cabinet: handleNullValues(cabinet),
      N_tel: handleNullValues(N_tel),
      application: handleNullValues(application),
      process: handleNullValues(process),
      executor: handleNullValues(executor),
      data: formatDateForMySQL(data),
      start_data: formatDateForMySQL(start_data),
      end_data: formatDateForMySQL(end_data),
      fl: fl ? 1 : 0
    };

    const [result] = await pool.execute(
      `UPDATE application SET 
        name = ?, cabinet = ?, N_tel = ?, application = ?, 
        process = ?, executor = ?, data = ?, 
        start_data = ?, end_data = ?, fl = ?
       WHERE id = ?`,
      [
        processedData.name,
        processedData.cabinet,
        processedData.N_tel,
        processedData.application,
        processedData.process,
        processedData.executor,
        processedData.data,
        processedData.start_data,
        processedData.end_data,
        processedData.fl,
        id
      ]
    );

    res.status(200).json({ message: 'Заявка успешно обновлена' });
  } catch (error) {
    console.error('Ошибка при обновлении заявки:', error);
    res.status(500).json({ 
      error: 'Не удалось обновить заявку',
      details: error.sqlMessage || error.message 
    });
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
      'SELECT id FROM application WHERE id = ?',
      [applicationId]
    );
    
    if (!existing || existing.length === 0) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }
    
    const [result] = await pool.execute(
      'DELETE FROM application WHERE id = ?',
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
  res.json({ status: 'OK', message: 'Сервер работает', timestamp: new Date() });
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

// Запуск сервера с автоматическим переключением порта, если порт занят
const startServer = (port, retriesLeft = MAX_PORT_RETRIES) => {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на порту ${port}`);
    console.log(`✅ Режим: ${process.env.NODE_ENV || 'development'}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && retriesLeft > 0) {
      const nextPort = port + 1;
      console.warn(`⚠️ Порт ${port} занят. Пробую порт ${nextPort}...`);
      startServer(nextPort, retriesLeft - 1);
      return;
    }

    console.error('❌ Не удалось запустить сервер:', error.message);
    process.exit(1);
  });
};

startServer(PORT);
