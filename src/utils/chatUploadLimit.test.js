import { fetchChatUploadLimitMb } from './chatUploadLimit';
import { authFetch } from './authFetch';
jest.mock('./authFetch', () => ({ authFetch: jest.fn() }));

test('each file selection reads the saved server limit rather than a stale cache', async () => {
  authFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ limitMb: 10 }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ limitMb: 150 }) });
  expect(await fetchChatUploadLimitMb()).toBe(10);
  expect(await fetchChatUploadLimitMb()).toBe(150);
  expect(authFetch).toHaveBeenCalledTimes(2);
});
test('does not silently use a default when checking settings fails', async () => {
  authFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Недоступно' }) });
  await expect(fetchChatUploadLimitMb()).rejects.toThrow('Недоступно');
  authFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ limitMb: 151 }) });
  await expect(fetchChatUploadLimitMb()).rejects.toThrow();
});
