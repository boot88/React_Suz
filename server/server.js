// server/server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const employeeRoutes = require('./routes/employees');
const pool = require('./config/database');

const app = express();
const PORT = process.env.PORT || 5000; // Важно для Render

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://react-suz.onrender.com'] // ЗАМЕНИТЕ на ваш URL
    : ['http://localhost:3000', 'http://192.168.1.35:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
  exposedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

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

// Функция для обработки NULL значений
const handleNullValues = (value, defaultValue = null) => {
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }
  return value;
};

app.get('/api/applications/export', async (req, res) => {
  const { status, from, to } = req.query;

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
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
  const offset = (page - 1) * limit;

  const { status, from, to } = req.query;

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

  const whereSql = whereClause.length > 0 ? 'WHERE ' + whereClause.join(' AND ') : '';

  try {
    const totalQuery = `SELECT COUNT(*) AS total FROM application ${whereSql}`;
    const [totalResult] = await pool.execute(totalQuery, queryParams);

    const baseWhere = whereSql ? `${whereSql} AND fl = ?` : `WHERE fl = ?`;
    const baseParams = [...queryParams];

    const [completedResult] = await pool.execute(
      `SELECT COUNT(*) AS count FROM application ${baseWhere}`,
      [...baseParams, 1]
    );

    const [pendingResult] = await pool.execute(
      `SELECT COUNT(*) AS count FROM application ${baseWhere}`,
      [...baseParams, 0]
    );

    const total = totalResult[0].total;
    const completed = completedResult[0].count;
    const pending = pendingResult[0].count;
    const totalPages = Math.ceil(total / limit);

    const applicationsQuery = `
      SELECT 
        id, name, cabinet, application, process, N_tel, executor, 
        data, start_data, end_data, fl
      FROM application
      ${whereSql}
      ORDER BY data DESC
      LIMIT ? OFFSET ?
    `;

    const [applications] = await pool.execute(applicationsQuery, [...queryParams, limit, offset]);

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
    res.status(500).json({ error: 'Ошибка сервера при получении заявок' });
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

// Запуск сервера
app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log(`✅ Режим: ${process.env.NODE_ENV || 'development'}`);
});