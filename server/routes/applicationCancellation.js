const ACTIVE_STATUSES = new Set(['new', 'accepted', 'in_progress', 'waiting_employee_confirmation', 'reopened']);
const fail = (status, message) => Object.assign(new Error(message), { status });

const createApplicationCancellationHandler = ({ ensureSchema, withTransaction, getForUpdate, addEvent, publish }) => async (req, res) => {
  const rawId = String(req.params.id || '');
  const id = Number(rawId);
  if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(id)) return res.status(400).json({ error: 'Неверный номер заявки' });
  try {
    await ensureSchema();
    const result = await withTransaction(async connection => {
      // Include already deleted rows: a lost response can safely be retried.
      const current = await getForUpdate(connection, id, true);
      if (!current) throw fail(404, 'Заявка не найдена');
      if (String(current.employee_login || '').trim().toLowerCase() !== String(req.auth.login || '').trim().toLowerCase() || current.source !== 'chat') {
        throw fail(403, 'Можно отменить только собственную заявку из чата');
      }
      if (current.deleted_at) return { application: current, replayed: true };
      if (Number(current.fl) || !ACTIVE_STATUSES.has(current.status)) throw fail(409, 'Заявка уже закрыта. Обновите список заявок.');
      const [updated] = await connection.execute('UPDATE application SET `revision` = `revision` + 1, `deleted_at` = NOW(), `deleted_by` = ? WHERE `id` = ? AND `deleted_at` IS NULL', [req.auth.login, id]);
      if (updated.affectedRows !== 1) throw fail(409, 'Заявка уже изменена. Обновите список заявок.');
      await addEvent(connection, id, req.auth.login, req.auth.role, 'cancelled_by_employee', 'Сотрудник отменил заявку');
      return { application: { ...current, revision: Number(current.revision || 0) + 1, deleted_at: new Date().toISOString(), deleted_by: req.auth.login }, replayed: false };
    });
    if (!result.replayed) publish(result.application, 'deleted');
    return res.json({ message: 'Заявка отменена', id, replayed: result.replayed });
  } catch (error) {
    if (!error.status) console.error('Ошибка отмены заявки:', error);
    return res.status(error.status || 500).json({ error: error.status ? error.message : 'Не удалось отменить заявку. Повторите попытку.' });
  }
};
module.exports = { createApplicationCancellationHandler };
