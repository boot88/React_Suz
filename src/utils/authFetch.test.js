import { API_BASE_URL } from './apiConfig';
import { authFetch, withAccessToken } from './authFetch';

describe('authenticated API requests', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a delayed session check cannot expire an account signed in afterwards', async () => {
    localStorage.setItem('authState', JSON.stringify({ user: { accessToken: 'old-token' } }));
    let finishSessionCheck;
    global.fetch.mockResolvedValueOnce({ status: 401 });
    global.fetch.mockImplementationOnce(() => new Promise(resolve => { finishSessionCheck = resolve; }));
    const expired = jest.fn();
    window.addEventListener('auth:expired', expired);
    try {
      const request = authFetch(`${API_BASE_URL}/chat/feed`);
      await Promise.resolve();
      expect(finishSessionCheck).toBeDefined();
      localStorage.setItem('authState', JSON.stringify({ user: { accessToken: 'new-token' } }));
      finishSessionCheck({ status: 401 });
      await request;
      expect(expired).not.toHaveBeenCalled();
    } finally { window.removeEventListener('auth:expired', expired); }
  });

  test('an unauthorized response from another origin does not check the API session', async () => {
    localStorage.setItem('authState', JSON.stringify({ user: { accessToken: 'signed-token' } }));
    global.fetch.mockResolvedValue({ status: 401 });
    await authFetch('https://example.com/resource');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1].headers.has('Authorization')).toBe(false);
  });

  test('a request with another bearer token does not invalidate the current session', async () => {
    localStorage.setItem('authState', JSON.stringify({ user: { accessToken: 'current-token' } }));
    global.fetch.mockResolvedValue({ status: 401 });
    await authFetch(`${API_BASE_URL}/auth/profile/preferences`, { headers: { Authorization: 'Bearer old-token' } });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('adds the saved bearer token without overwriting request headers', async () => {
    localStorage.setItem('authState', JSON.stringify({
      user: { accessToken: 'signed-token' }
    }));

    await authFetch(`${API_BASE_URL}/chat/feed`, {
      headers: { 'Content-Type': 'application/json' }
    });

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers.get('Authorization')).toBe('Bearer signed-token');
    expect(options.headers.get('Content-Type')).toBe('application/json');
  });

  test('adds a query token for protected media URLs', () => {
    localStorage.setItem('authState', JSON.stringify({
      user: { accessToken: 'signed-token' }
    }));

    expect(withAccessToken(`${API_BASE_URL}/chat/files/file-1/download`))
      .toBe(`${API_BASE_URL}/chat/files/file-1/download?access_token=signed-token`);
  });

  test('prefers a short-lived media token for file URLs when cached', async () => {
    localStorage.setItem('authState', JSON.stringify({
      user: { accessToken: 'signed-token' }
    }));

    // Кэш media-токенов изолирован от тестов: сначала убеждаемся, что fallback
    // работает, а затем заполняем кэш и проверяем ветку с ?mt=.
    const { ensureMediaTokens } = require('./mediaTokenCache');
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ tokens: [{ fileId: 'file-1', token: 'media-token-1', expiresAt: Date.now() + 600000 }] }) });
    await ensureMediaTokens({ fileIds: ['file-1'], getToken: () => 'signed-token' });

    expect(withAccessToken(`${API_BASE_URL}/chat/files/file-1/download`))
      .toBe(`${API_BASE_URL}/chat/files/file-1/download?mt=media-token-1`);
  });
});
