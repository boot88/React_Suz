import { API_BASE_URL } from './apiConfig';
import { authFetch } from './authFetch';

export const PREFERENCES_EVENT = 'user:preferences-change';
export const DEFAULT_CHAT_PREFERENCES = {
  archived: [], hidden: [], pinned: [], muted: [], favorites: [],
  uiDesign: 'modern', uiLanguage: 'en', uiTheme: 'light', uiDensity: 'regular', uiTextSize: 'medium',
  showChatTemplates: false, showExtraMessageActions: false, showDialogMediaPanel: false,
  showDialogFilters: false, showDialogDateJump: false, showConversationMenu: false,
  showFeedCategorySelect: false, showFeedFilters: false, enterToSend: true
};
const CHAT_APPEARANCE_VERSION = 1;
const CHAT_APPEARANCE_KEYS = ['uiDesign', 'uiLanguage', 'uiTheme', 'uiDensity', 'uiTextSize'];
export const DEFAULT_PREFERENCES = { ...DEFAULT_CHAT_PREFERENCES, chatAppearanceVersion: CHAT_APPEARANCE_VERSION, loginDesign: 'service', adminTheme: 'light',
  requestCardDesign: 'modern', requestViewMode: 'timeline', requestSortMode: 'date_desc', requestPageSize: '10',
  showApplicationActionHistory: false, showEditApplicationTable: false, auditTestMode: false };
const SETTING_KEYS = {
  adminLanguage: 'uiLanguage', loginLanguage: 'uiLanguage', loginDesign: 'loginDesign', adminTheme: 'adminTheme',
  'dashboard.timelineCardDesign': 'requestCardDesign', 'dashboard.viewMode': 'requestViewMode',
  'dashboard.sortMode': 'requestSortMode', 'dashboard.pageSize': 'requestPageSize',
  'admin.showApplicationActionHistory': 'showApplicationActionHistory',
  'admin.showEditApplicationTable': 'showEditApplicationTable', 'admin.auditTestMode': 'auditTestMode'
};
const normalize = (login) => String(login || '').trim().toLowerCase();
const cacheKey = (login) => `user.preferences.${normalize(login)}`;
const pendingKey = (login) => `user.preferences.pending.${normalize(login)}`;
const read = (key) => { try { const data = JSON.parse(localStorage.getItem(key) || '{}'); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { return {}; } };
const write = (key, data) => localStorage.setItem(key, JSON.stringify(data));
let binding = null;
const emit = (login, error = '') => window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: { login: normalize(login), error } }));
export const activePreferencesLogin = () => {
  try { return normalize(JSON.parse(localStorage.getItem('authState') || 'null')?.user?.username); } catch { return ''; }
};
export const getUserPreferences = (login = activePreferencesLogin()) => ({ ...DEFAULT_PREFERENCES, ...read(cacheKey(login)) });
export const getChatPreferences = (login) => {
  const preferences = getUserPreferences(login);
  return Object.fromEntries(Object.keys(DEFAULT_CHAT_PREFERENCES).map((key) => [key, preferences[key]]));
};
export const initializeUserPreferences = (login, serverPreferences = {}, overrides = {}) => {
  let pending = read(pendingKey(login));
  Object.keys(overrides).forEach((key) => { delete pending[key]; });
  const legacy = read('chatLocalSettings');
  const cached = read(cacheKey(login));
  const server = { ...serverPreferences };
  const migrated = [cached, pending, server].some(item => item.chatAppearanceVersion === CHAT_APPEARANCE_VERSION);
  // A response from a server that has not yet saved the migration must not
  // roll back the appearance already selected on this device.
  if (cached.chatAppearanceVersion === CHAT_APPEARANCE_VERSION && server.chatAppearanceVersion !== CHAT_APPEARANCE_VERSION) {
    CHAT_APPEARANCE_KEYS.forEach(key => { delete server[key]; });
  }
  const preferences = { ...(legacy[login] || legacy[normalize(login)] || {}), ...cached, ...server, ...pending, ...overrides };
  if (!migrated) {
    const appearance = Object.fromEntries(CHAT_APPEARANCE_KEYS.map(key => [key, DEFAULT_CHAT_PREFERENCES[key]]));
    const migration = { ...appearance, ...overrides, chatAppearanceVersion: CHAT_APPEARANCE_VERSION };
    Object.assign(preferences, migration);
    pending = { ...pending, ...migration };
  }
  write(cacheKey(login), preferences); write(pendingKey(login), pending); emit(login);
  return getUserPreferences(login);
};
export const updateUserPreferences = (login, patch) => {
  if (!normalize(login)) return;
  const current = getUserPreferences(login);
  const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => key in DEFAULT_PREFERENCES && (CHAT_APPEARANCE_KEYS.includes(key) || JSON.stringify(current[key]) !== JSON.stringify(value))));
  if (!Object.keys(changed).length) return;
  write(cacheKey(login), { ...read(cacheKey(login)), ...changed });
  write(pendingKey(login), { ...read(pendingKey(login)), ...changed });
  emit(login);
  if (binding?.login === normalize(login)) binding.schedule();
};
export const stopPreferenceSync = () => { if (binding) { binding.active = false; clearTimeout(binding.timer); binding = null; } };
export const configurePreferenceSync = (login, token) => {
  stopPreferenceSync();
  const owner = { login: normalize(login), token, active: true, saving: false, timer: null };
  const save = async () => {
    if (!owner.active || owner.saving) return;
    const patch = read(pendingKey(owner.login));
    if (!Object.keys(patch).length) return;
    owner.saving = true;
    let failed = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await authFetch(`${API_BASE_URL}/auth/profile/preferences`, { method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` }, body: JSON.stringify({ preferences: patch }), keepalive: true, signal: controller.signal });
      if (!response.ok) throw new Error('Не удалось сохранить настройки на сервере. Изменения сохранены на этом устройстве и будут отправлены повторно.');
      const pending = read(pendingKey(owner.login));
      Object.entries(patch).forEach(([key, value]) => { if (JSON.stringify(pending[key]) === JSON.stringify(value)) delete pending[key]; });
      write(pendingKey(owner.login), pending); emit(owner.login);
    } catch (error) { failed = true; emit(owner.login, error.message); }
    finally {
      clearTimeout(timeout); owner.failed = failed;
      owner.saving = false;
      if (owner.active && Object.keys(read(pendingKey(owner.login))).length) owner.schedule(failed ? 5000 : 0);
    }
  };
  owner.flush = () => { if (owner.saving) return owner.inFlight; owner.inFlight = save(); return owner.inFlight; };
  owner.schedule = (delay = 250) => { clearTimeout(owner.timer); owner.timer = setTimeout(owner.flush, delay); };
  binding = owner; owner.schedule();
};
export const flushPreferenceSync = async () => {
  const owner = binding;
  if (!owner) return;
  await owner.flush();
  if (owner.active && !owner.failed && Object.keys(read(pendingKey(owner.login))).length) await owner.flush();
};
export const userSettingsStorage = {
  getItem(key) { const value = getUserPreferences()[SETTING_KEYS[key]]; return value === undefined ? null : String(value); },
  setItem(key, value) { const field = SETTING_KEYS[key]; if (!field) return; const parsed = typeof DEFAULT_PREFERENCES[field] === 'boolean' ? value === 'true' : String(value); updateUserPreferences(activePreferencesLogin(), { [field]: parsed }); },
  removeItem(key) { const field = SETTING_KEYS[key]; if (field) updateUserPreferences(activePreferencesLogin(), { [field]: DEFAULT_PREFERENCES[field] }); }
};
