const crypto = require('crypto');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const normalizeLogin = (login) => String(login || '').trim().toLowerCase();
const parse = (value) => typeof value === 'string' ? JSON.parse(value) : value;

const validateBroadcast = (input) => {
  if (!input || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.id || '')) throw fail('Неверный идентификатор рассылки');
  if (typeof input.text !== 'string' || input.text.trim().length > 2000) throw fail('Текст должен быть не длиннее 2000 символов');
  if (!Array.isArray(input.recipients) || !input.recipients.length || input.recipients.length > 5000 || input.recipients.some((login) => typeof login !== 'string' || !login.trim() || login.includes('::') || login.length > 120)) throw fail('Выберите от 1 до 5000 сотрудников');
  if (!Array.isArray(input.attachments) || input.attachments.length > 10 || input.attachments.some((file) => !file?.id)) throw fail('Неверные вложения');
  const command = { id: input.id, text: input.text.trim(), recipients: [...new Set(input.recipients.map(normalizeLogin))].sort(), attachments: input.attachments };
  if (!command.text && !command.attachments.length) throw fail('Напишите сообщение или прикрепите файл');
  return command;
};
const fingerprint = (command) => crypto.createHash('sha256').update(JSON.stringify({ text: command.text, recipients: command.recipients, files: command.attachments.map((file) => file.id) })).digest('hex');
const messageIdFor = (id, login) => `broadcast_${id}_${crypto.createHash('sha256').update(login).digest('hex').slice(0, 24)}`;

const createBroadcastStore = ({ db, deliver, onDelivered = () => {} }) => {
  let schemaPromise;
  const ensure = () => {
    if (!schemaPromise) schemaPromise = (async () => {
      await db.execute(`CREATE TABLE IF NOT EXISTS chat_broadcasts (
        id VARCHAR(64) PRIMARY KEY, sender_login VARCHAR(255) NOT NULL, sender_name VARCHAR(255) NOT NULL,
        body_json LONGTEXT NOT NULL, request_sha256 CHAR(64) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_chat_broadcasts_sender_created (sender_login, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await db.execute(`CREATE TABLE IF NOT EXISTS chat_broadcast_recipients (
        broadcast_id VARCHAR(64) NOT NULL, recipient_login VARCHAR(255) NOT NULL, recipient_name VARCHAR(255) NOT NULL,
        conversation_id VARCHAR(255) NOT NULL, message_id VARCHAR(128) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending', error_text VARCHAR(255) NULL,
        delivered_at DATETIME NULL, read_at DATETIME NULL,
        PRIMARY KEY (broadcast_id, recipient_login), INDEX idx_broadcast_recipient_conversation (conversation_id, recipient_login),
        INDEX idx_broadcast_message (message_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    })().catch((error) => { schemaPromise = null; throw error; });
    return schemaPromise;
  };
  const recipients = async () => {
    const [rows] = await db.execute("SELECT login, full_name, department FROM users WHERE role = 'employee' ORDER BY full_name, login");
    return rows.map((row) => ({ login: normalizeLogin(row.login), name: row.full_name || row.login, department: row.department || '' }));
  };
  const getOwned = async (connection, id, sender, lock = false) => {
    const [rows] = await connection.execute(`SELECT * FROM chat_broadcasts WHERE id = ? AND sender_login = ?${lock ? ' FOR UPDATE' : ''}`, [id, normalizeLogin(sender)]);
    if (!rows[0]) throw fail('Рассылка не найдена', 404);
    return rows[0];
  };
  const syncRead = async (condition, args) => {
    await db.execute(`UPDATE chat_broadcast_recipients AS r
      INNER JOIN chat_broadcasts AS b ON b.id = r.broadcast_id
      INNER JOIN chat_messages AS m ON m.id = r.message_id AND m.conversation_id = r.conversation_id
      INNER JOIN chat_read_state AS s ON s.conversation_id = r.conversation_id AND s.user_login = r.recipient_login
      SET r.read_at = CURRENT_TIMESTAMP
      WHERE ${condition} AND r.status = 'delivered' AND r.read_at IS NULL
        AND (s.last_read_at > m.created_at OR (s.last_read_at = m.created_at AND s.last_read_message_id >= m.id))`, args);
  };
  const updateRead = (sender) => syncRead('b.sender_login = ?', [normalizeLogin(sender)]);
  const recordRead = async (login, conversationId = '') => {
    await ensure();
    return syncRead(`r.recipient_login = ?${conversationId ? ' AND r.conversation_id = ?' : ''}`, conversationId ? [normalizeLogin(login), conversationId] : [normalizeLogin(login)]);
  };
  const detail = async (id, sender) => {
    await ensure();
    const batch = await getOwned(db, id, sender);
    await updateRead(sender);
    const [rows] = await db.execute('SELECT * FROM chat_broadcast_recipients WHERE broadcast_id = ? ORDER BY recipient_name, recipient_login', [id]);
    const body = parse(batch.body_json);
    return { id, text: body.text, attachments: body.attachments, createdAt: batch.created_at, senderName: batch.sender_name,
      total: rows.length, delivered: rows.filter((row) => row.status === 'delivered').length, read: rows.filter((row) => row.read_at).length,
      recipients: rows.map((row) => ({ login: row.recipient_login, name: row.recipient_name, status: row.status, error: row.error_text, readAt: row.read_at })) };
  };
  const create = async (raw, actor) => {
    const command = validateBroadcast(raw);
    const sender = normalizeLogin(actor.login);
    await ensure();
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      // The primary key and row lock make a lost HTTP response safe to retry.
      await connection.execute(`INSERT INTO chat_broadcasts (id, sender_login, sender_name, body_json, request_sha256)
        VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id`, [command.id, sender, actor.name || sender, JSON.stringify({ text: command.text, attachments: command.attachments }), fingerprint(command)]);
      const batch = await getOwned(connection, command.id, sender, true);
      if (batch.request_sha256 !== fingerprint(command)) throw fail('Эта рассылка уже создана с другим текстом или получателями', 409);
      const [existing] = await connection.execute('SELECT recipient_login FROM chat_broadcast_recipients WHERE broadcast_id = ?', [command.id]);
      if (!existing.length) {
        const [users] = await connection.query("SELECT login, full_name FROM users WHERE role = 'employee' AND LOWER(login) IN (?)", [command.recipients]);
        const byLogin = new Map(users.map((user) => [normalizeLogin(user.login), user]));
        if (command.recipients.some((login) => !byLogin.has(login) || login === sender)) throw fail('Список сотрудников изменился. Обновите получателей и повторите отправку');
        for (const login of command.recipients) {
          const conversation = [sender, login].sort().join('::');
          if (conversation.length > 255) throw fail('Слишком длинный логин получателя');
          await connection.execute(`INSERT INTO chat_broadcast_recipients (broadcast_id, recipient_login, recipient_name, conversation_id, message_id)
            VALUES (?, ?, ?, ?, ?)`, [command.id, login, byLogin.get(login).full_name || login, conversation, messageIdFor(command.id, login)]);
        }
        // Pending/retryable broadcasts keep their uploaded files after 24 hours.
        if (command.attachments.length) await connection.query("UPDATE chat_files SET retention_state = 'retained', retained_at = COALESCE(retained_at, NOW()), claimed_at = COALESCE(claimed_at, NOW()) WHERE id IN (?)", [command.attachments.map((file) => file.id)]);
      }
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
    return send(command.id, sender);
  };
  const send = async (id, sender) => {
    await ensure();
    const batch = await getOwned(db, id, sender);
    const body = parse(batch.body_json);
    const [targets] = await db.execute('SELECT recipient_login FROM chat_broadcast_recipients WHERE broadcast_id = ? AND status <> ?', [id, 'delivered']);
    for (const target of targets) {
      const connection = await db.getConnection();
      let saved;
      let row;
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute('SELECT * FROM chat_broadcast_recipients WHERE broadcast_id = ? AND recipient_login = ? FOR UPDATE', [id, target.recipient_login]);
        row = rows[0];
        if (!row || row.status === 'delivered') { await connection.commit(); continue; }
        const [users] = await connection.execute("SELECT login FROM users WHERE LOWER(login) = ? AND role = 'employee'", [row.recipient_login]);
        if (!users.length) throw fail('Сотрудник больше не доступен для отправки');
        const [archived] = await connection.execute("SELECT conversation_id FROM chat_conversations WHERE conversation_id = ? AND state = 'archived'", [row.conversation_id]);
        if (archived.length) throw fail('Диалог находится в архиве. Сначала восстановите его');
        const now = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
        const message = { id: row.message_id, sender: normalizeLogin(sender), text: body.text, attachments: body.attachments,
          attachment: body.attachments[0] || null, broadcast: { id }, createdAt: now, updatedAt: now, reactions: {}, deliveryStatus: 'sent' };
        saved = await deliver(connection, row.conversation_id, message);
        await connection.execute("UPDATE chat_broadcast_recipients SET status = 'delivered', error_text = NULL, delivered_at = CURRENT_TIMESTAMP WHERE broadcast_id = ? AND recipient_login = ?", [id, row.recipient_login]);
        await connection.commit();
      } catch (error) {
        saved = null;
        await connection.rollback();
        await connection.execute("UPDATE chat_broadcast_recipients SET status = 'failed', error_text = ? WHERE broadcast_id = ? AND recipient_login = ? AND status <> 'delivered'", [error.status ? error.message.slice(0, 255) : 'Ошибка доставки. Можно повторить отправку.', id, target.recipient_login]);
      } finally { connection.release(); }
      if (saved) { try { await onDelivered(row.conversation_id, saved); } catch { /* persisted messages remain available without SSE */ } }
    }
    return detail(id, sender);
  };
  const list = async (sender, offset = 0) => {
    await ensure(); await updateRead(sender);
    const start = Math.max(0, Math.min(100000, Math.floor(Number(offset)) || 0));
    const [rows] = await db.query(`SELECT b.id, b.body_json, b.created_at, COUNT(r.recipient_login) AS total,
      SUM(r.status = 'delivered') AS delivered, SUM(r.read_at IS NOT NULL) AS read_count
      FROM chat_broadcasts AS b LEFT JOIN chat_broadcast_recipients AS r ON r.broadcast_id = b.id
      WHERE b.sender_login = ? GROUP BY b.id ORDER BY b.created_at DESC, b.id DESC LIMIT 21 OFFSET ${start}`, [normalizeLogin(sender)]);
    return { items: rows.slice(0, 20).map((row) => ({ id: row.id, text: parse(row.body_json).text, attachments: parse(row.body_json).attachments, createdAt: row.created_at,
      total: Number(row.total), delivered: Number(row.delivered), read: Number(row.read_count) })), hasMore: rows.length > 20 };
  };
  return { recipients, create, send, detail, list, recordRead };
};

module.exports = { createBroadcastStore, validateBroadcast, messageIdFor };
