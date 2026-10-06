const LIMITS = { bio: 2000, statusText: 120 };
const validationError = (message, fields = {}) => Object.assign(new Error(message), { status: 400, fields });
const parsePersonalPatch = (body = {}) => {
  const fields = {};
  const patch = {};
  for (const [key, limit] of Object.entries(LIMITS)) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    if (typeof body[key] !== 'string') fields[key] = 'type';
    else if (body[key].length > limit) fields[key] = 'length';
    else patch[key] = body[key].replace(/\r\n?/g, '\n');
  }
  const forbidden = Object.keys(body).filter(key => !['version', ...Object.keys(LIMITS)].includes(key));
  if (forbidden.length) throw validationError('Служебные поля изменяются только через справочник');
  if (Object.keys(fields).length) throw validationError('Проверьте поля профиля', fields);
  if (!Number.isSafeInteger(body.version) || body.version < 0) throw validationError('Необходима версия профиля');
  return patch;
};
const personalProfile = profile => ({ bio: typeof profile.bio === 'string' ? profile.bio : '', statusText: typeof profile.statusText === 'string' ? profile.statusText : 'Работа', version: Number(profile.profileVersion || 0) });
const applyPersonalPatch = (current, body) => {
  const patch = parsePersonalPatch(body);
  if (Number(current.profileVersion || 0) !== body.version) {
    throw Object.assign(new Error('Профиль уже изменён. Сравните свои изменения с актуальными данными.'), { status: 409, current: personalProfile(current) });
  }
  return { ...current, ...patch, profileVersion: body.version + 1, updatedAt: new Date().toISOString() };
};
module.exports = { LIMITS, parsePersonalPatch, personalProfile, applyPersonalPatch };
