import { compareMessages, mergeMessages, isMessageRead } from './chatMessages';

test('same-millisecond messages follow server receipt sequence rather than random IDs', () => {
  const createdAt = '2026-10-06T00:00:00.123Z';
  const first = { id: 'z', sequence: 101, createdAt };
  const second = { id: 'a', sequence: 102, createdAt };
  expect(compareMessages(first, second)).toBeLessThan(0);
  expect(mergeMessages([second], [first]).map(message => message.id)).toEqual(['z', 'a']);
  expect(isMessageRead(second, { messageId: first.id, createdAt, sequence: first.sequence })).toBe(false);
});
test('a late response cannot replace a newer revision even if its clock is later', () => {
  const current = { id: 'm1', text: 'New', revision: 2, updatedAt: '2026-10-06T00:00:00Z' };
  const stale = { id: 'm1', text: 'Old', revision: 1, updatedAt: '2026-10-06T00:01:00Z' };
  expect(mergeMessages([current], [stale])[0].text).toBe('New');
});
