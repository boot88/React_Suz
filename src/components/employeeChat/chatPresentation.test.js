import { getDateKey, savePendingMessages } from './chatPresentation';

test('calendar labels use Novosibirsk even when the browser runs in UTC', () => {
  expect(getDateKey('2026-10-04T18:00:00Z')).toBe(getDateKey('2026-10-05T01:00:00+07:00'));
  expect(getDateKey('2026-10-04T18:00:00Z')).not.toBe(getDateKey('2026-10-04T10:00:00Z'));
});
test('failed local persistence is reported to the caller', () => {
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
  try { expect(savePendingMessages('alice', [{ message: { id: 'pending-1' } }])).toBe(false); }
  finally { spy.mockRestore(); }
});
