import { authFetch } from './authFetch';
import { DEFAULT_PREFERENCES, configurePreferenceSync, flushPreferenceSync, getChatPreferences, getUserPreferences, initializeUserPreferences, stopPreferenceSync, updateUserPreferences, userSettingsStorage } from './userPreferences';
jest.mock('./authFetch', () => ({ authFetch: jest.fn() }));
const useAccount = (login) => localStorage.setItem('authState', JSON.stringify({ user: { username: login } }));
beforeEach(() => { localStorage.clear(); authFetch.mockReset(); jest.useFakeTimers(); });
afterEach(() => { stopPreferenceSync(); jest.useRealTimers(); });

test('new accounts have the requested defaults and ignore another user’s global browser settings', () => {
  localStorage.setItem('adminLanguage', 'ru'); localStorage.setItem('adminTheme', 'dark'); localStorage.setItem('loginDesign', 'current');
  useAccount('new-employee'); initializeUserPreferences('new-employee');
  expect(getUserPreferences()).toMatchObject({ loginDesign: 'service', uiLanguage: 'en', uiDesign: 'modern', uiTheme: 'light', uiDensity: 'regular', uiTextSize: 'medium', requestCardDesign: 'modern', adminTheme: 'light', showEditApplicationTable: false, showApplicationActionHistory: false, auditTestMode: false });
  expect(userSettingsStorage.getItem('adminLanguage')).toBe('en');
});

test('two accounts keep independent settings and language is shared by chat, login and admin', () => {
  useAccount('alice'); initializeUserPreferences('alice');
  userSettingsStorage.setItem('adminLanguage', 'ru'); userSettingsStorage.setItem('dashboard.timelineCardDesign', 'legacy');
  updateUserPreferences('alice', { uiTheme: 'dark', uiDesign: 'classic' });
  expect(getChatPreferences('alice').uiLanguage).toBe('ru'); expect(userSettingsStorage.getItem('loginLanguage')).toBe('ru');
  useAccount('bob'); initializeUserPreferences('bob');
  expect(getUserPreferences()).toEqual(DEFAULT_PREFERENCES);
  updateUserPreferences('bob', { uiLanguage: 'ru', uiTextSize: 'large' });
  expect(userSettingsStorage.getItem('adminLanguage')).toBe('ru');
  useAccount('ALICE');
  expect(getUserPreferences()).toMatchObject({ uiLanguage: 'ru', uiDesign: 'classic', uiTheme: 'dark', requestCardDesign: 'legacy', uiTextSize: 'medium' });
});

test('settings restore from SQL on a fresh computer and explicit login language wins over an old unsent language', () => {
  initializeUserPreferences('alice', { chatAppearanceVersion: 1, uiLanguage: 'ru', uiTheme: 'dark', requestCardDesign: 'legacy' });
  updateUserPreferences('alice', { uiLanguage: 'en', uiDensity: 'compact' });
  initializeUserPreferences('alice', { chatAppearanceVersion: 1, uiLanguage: 'ru', uiTheme: 'dark' }, { uiLanguage: 'ru' });
  expect(getUserPreferences('alice')).toMatchObject({ uiLanguage: 'ru', uiDensity: 'compact' });
  expect(JSON.parse(localStorage.getItem('user.preferences.pending.alice'))).toEqual({ uiDensity: 'compact' });
  localStorage.clear(); initializeUserPreferences('alice', { chatAppearanceVersion: 1, uiLanguage: 'ru', uiTheme: 'dark', requestCardDesign: 'legacy' });
  expect(getUserPreferences('alice')).toMatchObject({ chatAppearanceVersion: 1, uiLanguage: 'ru', uiTheme: 'dark', requestCardDesign: 'legacy' });
});

test('in-flight saves use the owning token and preserve newer pending changes across an account switch', async () => {
  let finishAlice;
  authFetch.mockImplementationOnce(() => new Promise((resolve) => { finishAlice = resolve; })).mockResolvedValue({ ok: true });
  initializeUserPreferences('alice'); configurePreferenceSync('alice', 'alice-token');
  updateUserPreferences('alice', { uiLanguage: 'ru' }); const first = flushPreferenceSync();
  updateUserPreferences('alice', { uiLanguage: 'en', uiTheme: 'dark' });
  initializeUserPreferences('bob'); configurePreferenceSync('bob', 'bob-token'); updateUserPreferences('bob', { uiLanguage: 'ru' });
  await flushPreferenceSync(); finishAlice({ ok: true }); await first;
  expect(authFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer alice-token');
  expect(authFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer bob-token');
  expect(JSON.parse(localStorage.getItem('user.preferences.pending.alice'))).toEqual({ uiLanguage: 'en', uiTheme: 'dark' });
  configurePreferenceSync('alice', 'alice-new-token'); await flushPreferenceSync();
  expect(JSON.parse(authFetch.mock.calls[2][1].body).preferences).toEqual({ uiLanguage: 'en', uiTheme: 'dark' });
});

test('a network failure keeps personal pending settings for retry at the next login', async () => {
  authFetch.mockRejectedValueOnce(new Error('Network error')).mockResolvedValue({ ok: true });
  initializeUserPreferences('alice'); configurePreferenceSync('alice', 'token');
  updateUserPreferences('alice', { requestCardDesign: 'legacy' }); await flushPreferenceSync(); stopPreferenceSync();
  initializeUserPreferences('alice', { requestCardDesign: 'modern' });
  expect(getUserPreferences('alice').requestCardDesign).toBe('legacy');
  configurePreferenceSync('alice', 'new-token'); await flushPreferenceSync();
  expect(JSON.parse(localStorage.getItem('user.preferences.pending.alice'))).toEqual({});
});

test.each(['employee', 'admin'])('old %s appearance migrates once and a later choice survives sign-out and stale login data', async (login) => {
  const old = { uiDesign: 'classic', uiLanguage: 'ru', uiTheme: 'dark', uiDensity: 'compact', uiTextSize: 'large' };
  initializeUserPreferences(login, old);
  expect(getChatPreferences(login)).toMatchObject({ uiDesign: 'modern', uiLanguage: 'en', uiTheme: 'light', uiDensity: 'regular', uiTextSize: 'medium' });
  authFetch.mockResolvedValue({ ok: true });
  configurePreferenceSync(login, 'token'); await flushPreferenceSync(); stopPreferenceSync();
  // Selecting a default value explicitly must also be saved to SQL.
  updateUserPreferences(login, { uiDesign: 'modern' });
  configurePreferenceSync(login, 'next-token'); await flushPreferenceSync(); stopPreferenceSync();
  expect(JSON.parse(authFetch.mock.calls.at(-1)[1].body).preferences).toEqual({ uiDesign: 'modern' });
  initializeUserPreferences(login, old);
  expect(getChatPreferences(login).uiDesign).toBe('modern');
  updateUserPreferences(login, { uiDesign: 'classic', uiLanguage: 'ru' });
  configurePreferenceSync(login, 'last-token'); await flushPreferenceSync(); stopPreferenceSync();
  const stored = getUserPreferences(login);
  localStorage.clear();
  initializeUserPreferences(login, stored);
  expect(getChatPreferences(login)).toMatchObject({ uiDesign: 'classic', uiLanguage: 'ru', uiTheme: 'light', uiDensity: 'regular', uiTextSize: 'medium' });
});
