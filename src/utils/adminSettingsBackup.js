import { userSettingsStorage } from './userPreferences';
export const SETTING_VALUES = {
  adminLanguage: ['ru', 'en'], adminTheme: ['light', 'dark'],
  'admin.showApplicationActionHistory': ['true', 'false'],
  'admin.auditTestMode': ['true', 'false'],
  'admin.showEditApplicationTable': ['true', 'false'],
  'dashboard.timelineCardDesign': ['modern', 'legacy'],
  'dashboard.sortMode': ['date_asc', 'date_desc'],
  'dashboard.viewMode': ['table', 'timeline'],
  'dashboard.pageSize': ['5', '10', '15', '20', '50'],
  loginLanguage: ['ru', 'en'], loginDesign: ['current', 'new', 'service']
};

export const exportBrowserSettings = (storage = userSettingsStorage) => ({
  format: 'React_Suz browser settings', version: 1, createdAt: new Date().toISOString(),
  settings: Object.fromEntries(Object.keys(SETTING_VALUES).map((key) => [key, storage.getItem(key)]))
});

export const validateBrowserSettings = (backup) => {
  if (backup?.format !== 'React_Suz browser settings' || backup.version !== 1 || !backup.settings || typeof backup.settings !== 'object' || Array.isArray(backup.settings)) throw new Error('Выберите файл настроек, созданный в React_Suz');
  for (const [key, value] of Object.entries(backup.settings)) {
    if (!Object.prototype.hasOwnProperty.call(SETTING_VALUES, key) || (value !== null && !SETTING_VALUES[key].includes(value))) throw new Error(`Некорректная настройка: ${key}`);
  }
  return backup;
};

export const importBrowserSettings = (backup, storage = userSettingsStorage) => {
  validateBrowserSettings(backup);
  const previous = Object.fromEntries(Object.keys(backup.settings).map((key) => [key, storage.getItem(key)]));
  try {
    for (const [key, value] of Object.entries(backup.settings)) {
      if (value === null) storage.removeItem(key); else storage.setItem(key, value);
    }
  } catch (error) {
    for (const [key, value] of Object.entries(previous)) {
      if (value === null) storage.removeItem(key); else storage.setItem(key, value);
    }
    throw error;
  }
};
