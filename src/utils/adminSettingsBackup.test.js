import { exportBrowserSettings, importBrowserSettings } from './adminSettingsBackup';

beforeEach(() => localStorage.clear());

test('browser settings round trip excludes passwords, auth tokens and cached external sources', () => {
  localStorage.setItem('adminTheme', 'dark');
  localStorage.setItem('authState', '{"token":"private"}');
  localStorage.setItem('network-map-cache', 'external');
  const backup = exportBrowserSettings();
  expect(backup.settings.adminTheme).toBe('dark');
  expect(backup.settings.authState).toBeUndefined();
  expect(backup.settings['network-map-cache']).toBeUndefined();
  localStorage.setItem('adminTheme', 'light');
  importBrowserSettings(backup);
  expect(localStorage.getItem('adminTheme')).toBe('dark');
  expect(localStorage.getItem('authState')).toBe('{"token":"private"}');
});

test('validates the whole file before changing any browser setting', () => {
  localStorage.setItem('adminTheme', 'light');
  expect(() => importBrowserSettings({ format: 'React_Suz browser settings', version: 1, settings: { adminTheme: 'dark', authState: 'bad' } })).toThrow();
  expect(localStorage.getItem('adminTheme')).toBe('light');
  expect(() => importBrowserSettings({ format: 'React_Suz browser settings', version: 1, settings: { adminTheme: 'unknown' } })).toThrow();
});
