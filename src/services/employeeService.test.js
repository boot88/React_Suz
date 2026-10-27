import { syncEmployees } from './employeeService';
import { authFetch } from '../utils/authFetch';
jest.mock('../utils/authFetch', () => ({ authFetch: jest.fn() }));
const reply = (data, ok = true) => ({ ok, json: async () => data });
const report = (updatedAt, count) => ({ updatedAt, changes: { updated: { count, items: [] } } });
beforeEach(() => jest.clearAllMocks());

test('each new successful refresh fetches a new directory report instead of reusing the old timestamp and counts', async () => {
  const first = report('2026-10-27T10:18:46Z', 134);
  const second = report('2026-10-27T10:23:46Z', 0);
  authFetch.mockResolvedValueOnce(reply(first)).mockResolvedValueOnce(reply({ total: 399 }))
    .mockResolvedValueOnce(reply(second)).mockResolvedValueOnce(reply({ total: 399 }));
  expect((await syncEmployees()).changes.updated.count).toBe(134);
  const result = await syncEmployees();
  expect(result.changes.updated.count).toBe(0);
  expect(result.updatedAt).toBe(second.updatedAt);
  expect(authFetch.mock.calls.map(([url]) => url.split('/').pop())).toEqual([
    'sync', 'provision-from-phone-book', 'sync', 'provision-from-phone-book'
  ]);
});

test('only an explicit account-only retry reuses the already saved directory report', async () => {
  const saved = report('2026-10-27T10:18:46Z', 0);
  authFetch.mockResolvedValue(reply({ total: 399 }));
  const result = await syncEmployees(jest.fn(), saved);
  expect(authFetch).toHaveBeenCalledTimes(1);
  expect(authFetch).toHaveBeenCalledWith(expect.stringContaining('/auth/provision-from-phone-book'), { method: 'POST' });
  expect(result.updatedAt).toBe(saved.updatedAt);
});
