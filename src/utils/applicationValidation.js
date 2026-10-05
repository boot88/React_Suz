// Shared by the browser and the API. Request text is plain text; React escapes it.
const LIMITS = { name: 40, cabinet: 15, N_tel: 15, application: 500, process: 1500, executor: 60 };
const validateApplicationField = (field, raw, { requireCabinet = false } = {}) => {
  if (raw != null && typeof raw !== 'string' && typeof raw !== 'number') return 'Ожидается текстовое значение';
  const value = raw == null ? '' : String(raw);
  if ((field === 'name' || field === 'application' || (field === 'cabinet' && requireCabinet)) && !value.trim()) {
    return { name: 'ФИО обязательно для заполнения', application: 'Суть заявки обязательна для заполнения', cabinet: 'Лаборатория/кабинет обязателен для заполнения' }[field];
  }
  if (LIMITS[field] && value.length > LIMITS[field]) return `Максимум ${LIMITS[field]} символов`;
  if (['name', 'executor'].includes(field) && value && !/^[\p{L}\p{M}\s.,'’-]+$/u.test(value)) return 'Допустимы буквы, пробелы, точки, запятые, апостроф и дефис';
  if (field === 'N_tel' && value && !/^[0-9\s,+()-]+$/.test(value)) return 'Допустимы цифры, пробелы, плюс, скобки, запятые и дефис';
  // eslint-disable-next-line no-control-regex -- Plain text may contain tabs/newlines, but no other control characters.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) return 'Недопустимые управляющие символы';
  return '';
};
const validateApplication = (values, options) => Object.fromEntries(Object.keys(LIMITS)
  .map((field) => [field, validateApplicationField(field, values[field], options)])
  .filter(([, error]) => error));
module.exports = { LIMITS, validateApplicationField, validateApplication };
