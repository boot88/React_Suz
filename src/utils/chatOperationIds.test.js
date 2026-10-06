import { readChatOperationIds, saveChatOperationIds } from './chatOperationIds';
test('retry IDs survive reloading and remain separate between accounts', () => {
  const operations = { feed: { signature: 'same-payload', id: 'stable-id' }, comments: { post1: { id: 'stable-comment', text: 'Hello' } } };
  expect(saveChatOperationIds('alice', operations)).toBe(true);
  expect(readChatOperationIds('alice')).toEqual(operations);
  expect(readChatOperationIds('bob')).toEqual({ feed: null, comments: {} });
  localStorage.clear();
});
