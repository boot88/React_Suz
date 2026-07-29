const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isMysqlDatabase,
  normalizeMessageAttachments,
  getMessageAttachmentFileIds,
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

test('normalizes legacy attachment fields without multiplying media', () => {
  const photo = { id: 'file-1', name: 'photo.jpg', type: 'image/jpeg', url: '/files/file-1' };
  const video = { id: 'file-2', name: 'video.mp4', type: 'video/mp4', url: '/files/file-2' };
  const attachments = normalizeMessageAttachments({
    attachments: [photo, photo, video],
    attachment: photo,
    files: [{ ...video }],
    file: { ...photo }
  });

  assert.deepEqual(attachments.map((attachment) => attachment.id), ['file-1', 'file-2']);
});

test('deduplicates old inline attachments that do not have an id', () => {
  const inline = {
    name: 'legacy.jpg',
    type: 'image/jpeg',
    dataUrl: 'data:image/jpeg;base64,AAAA'
  };

  assert.equal(normalizeMessageAttachments({
    attachments: [inline],
    attachment: { ...inline }
  }).length, 1);
});

test('extracts unique file ids for indexed chat access checks', () => {
  assert.deepEqual(getMessageAttachmentFileIds({
    attachments: [
      { id: 'file-1' },
      { url: '/api/chat/files/file-2/download' },
      { thumbnailUrl: '/api/chat/files/file-2/download?variant=thumbnail' }
    ],
    attachment: { id: 'file-1' }
  }), ['file-1', 'file-2']);
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
