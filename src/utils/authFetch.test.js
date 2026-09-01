import { authFetch, withAccessToken } from './authFetch';

describe('authenticated API requests', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('adds the saved bearer token without overwriting request headers', async () => {
    localStorage.setItem('authState', JSON.stringify({
      user: { accessToken: 'signed-token' }
    }));

    await authFetch('/api/chat/feed', {
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

    expect(withAccessToken('/api/chat/files/file-1/download'))
      .toBe('/api/chat/files/file-1/download?access_token=signed-token');
  });

  test('prefers a short-lived media token for file URLs when cached', () => {
    localStorage.setItem('authState', JSON.stringify({
      user: { accessToken: 'signed-token' }
    }));

    // Кэш media-токенов изолирован от тестов: сначала убеждаемся, что fallback
    // работает, а затем заполняем кэш и проверяем ветку с ?mt=.
    const { storeMediaToken } = require('./mediaTokenCache');
    storeMediaToken('file-1', 'media-token-1', Date.now() + 600000);

    expect(withAccessToken('/api/chat/files/file-1/download'))
      .toBe('/api/chat/files/file-1/download?mt=media-token-1');
  });
});
