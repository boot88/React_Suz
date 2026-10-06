export const PROFILE_LIMITS = { bio: 2000, statusText: 120 };
export const personalFields = profile => ({ bio: profile?.bio ?? '', statusText: profile?.statusText ?? '' });
export const profilePatch = (base, form) => Object.fromEntries(Object.entries(personalFields(form)).filter(([key, value]) => value !== personalFields(base)[key]));
const key = login => `employeeProfileChanges:${String(login).trim().toLowerCase()}`;
export const readPersonalDraft = login => {
  try { const value = JSON.parse(localStorage.getItem(key(login)) || 'null'); return value?.patch && typeof value.patch === 'object' ? value : null; } catch { return null; }
};
export const writePersonalDraft = (login, base, form) => {
  try {
    const patch = profilePatch(base, form);
    if (Object.keys(patch).length) localStorage.setItem(key(login), JSON.stringify({ version: base.version, base: personalFields(base), patch, savedAt: Date.now() }));
    else localStorage.removeItem(key(login));
    return true;
  } catch { return false; }
};
export const validatePersonalProfile = (form, english) => Object.fromEntries(Object.entries(PROFILE_LIMITS).filter(([key, max]) => typeof form[key] !== 'string' || form[key].length > max).map(([key, max]) => [key, english ? `Maximum ${max} characters.` : `Не больше ${max} символов.`]));
// Only values acknowledged by the server are marked saved. Later typing survives.
export const applyProfileSave = (current, submitted, saved) => ({ ...current, ...Object.fromEntries(Object.entries(personalFields(saved)).filter(([key]) => current[key] === submitted[key])) });
