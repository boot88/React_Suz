const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isMysqlDatabase,
  mergeThreadMessages,
  groupThreadSnapshotRows
} = require('./chatState');
const { createSerialMutationQueue } = require('./feedState');

const clone = (value) => JSON.parse(JSON.stringify(value));

test('recognizes the MySQL pool used in every environment', () => {
  assert.equal(isMysqlDatabase({ execute() {} }), true);
  assert.equal(isMysqlDatabase({ query() {} }), false);
  assert.equal(isMysqlDatabase({}), false);
});

test('newer archive messages win over stale SQL rows', () => {
  const messages = mergeThreadMessages(
    [{ id: 'message-1', text: 'edited', createdAt: '2026-07-23T10:00:00.000Z', updatedAt: '2026-07-23T10:02:00.000Z' }],
    [{ id: 'message-1', text: 'original', createdAt: '2026-07-23T10:00:00.000Z', updatedAt: '2026-07-23T10:01:00.000Z' }]
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, 'edited');
});

test('groups a single MySQL thread snapshot without per-dialog requests', () => {
  const threads = groupThreadSnapshotRows([
    { conversation_id: 'anna::boris', message_json: '{"id":"message-1","text":"one"}' },
    { conversation_id: 'anna::boris', message_json: '{"id":"message-2","text":"two"}' },
    { conversation_id: 'claire::dmitry', message_json: '{"id":"message-3","text":"three"}' }
  ]);

  assert.deepEqual(Object.keys(threads), ['anna::boris', 'claire::dmitry']);
  assert.deepEqual(threads['anna::boris'].map((message) => message.id), ['message-1', 'message-2']);
});

test('serial chat mutations do not lose messages sent together', async () => {
  let stored = {};
  const queue = createSerialMutationQueue({
    read: async () => clone(stored),
    write: async (threads) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      stored = clone(threads);
    }
  });

  await Promise.all([
    queue.mutate((threads) => ({
      ...threads,
      'ivanov::petrov': [...(threads['ivanov::petrov'] || []), { id: 'message-1' }]
    })),
    queue.mutate((threads) => ({
      ...threads,
      'ivanov::petrov': [...(threads['ivanov::petrov'] || []), { id: 'message-2' }]
    }))
  ]);

  assert.deepEqual(stored['ivanov::petrov'].map((message) => message.id), ['message-1', 'message-2']);
});
