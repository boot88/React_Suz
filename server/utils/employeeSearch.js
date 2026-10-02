const FIELDS = new Set(['full_name', 'position', 'department', 'room', 'internal_phone', 'external_phone', 'email']);

// Keep the department exact, and combine it with the selected search field.
const buildEmployeeSearch = ({ field, query = '', department = '' } = {}) => {
  if (!FIELDS.has(field)) return { error: 'Недопустимое поле для поиска' };
  if (typeof query !== 'string' || typeof department !== 'string') {
    return { error: 'Не указаны поле поиска или запрос' };
  }
  const term = query.trim();
  const selectedDepartment = department.trim();
  if (!term && !selectedDepartment) return { error: 'Не указаны поле поиска или запрос' };
  const clauses = ['is_active = 1'];
  const params = [];
  if (term) {
    clauses.push(`${field} LIKE ?`);
    params.push(`%${term}%`);
  }
  if (selectedDepartment) {
    clauses.push('department = ?');
    params.push(selectedDepartment);
  }
  return { sql: `SELECT * FROM phone_book WHERE ${clauses.join(' AND ')} ORDER BY full_name`, params };
};

module.exports = { buildEmployeeSearch };
