const test = require('node:test');
const assert = require('node:assert/strict');
let message;
let history = [];
let post;
let deletedBetweenReadAndWrite = false;
let writes = 0;
const operationPosts = new Map();
const operationComments = new Map();
const queries = [];
const execute = async (sql, params = []) => {
  queries.push({ sql, params });
  if (sql.startsWith('SHOW COLUMNS')) return [[{ Field: 'sequence' }, { Field: 'last_read_sequence' }]];
  if (sql.includes('FROM chat_conversations')) return [[]];
  if (sql.includes('SELECT conversation_id, sender_login')) return [[{ conversation_id: 'alice::bob', sender_login: 'alice', message_json: JSON.stringify(message) }]];
  if (sql.includes('SELECT message_json') && sql.includes('FROM chat_messages')) {
    if (sql.includes('WHERE conversation_id = ? AND id = ?')) return [[{ message_json: JSON.stringify(message) }]];
    const afterSequence = Number(params[3]) || 0;
    const limit = Number(sql.match(/LIMIT (\d+)/)?.[1]) || 50;
    return [history.filter(item => item.sequence > afterSequence).slice(0, limit).map(item => ({ message_json: JSON.stringify(item), created_at: new Date(item.createdAt), id: item.id, sequence: item.sequence }))];
  }
  if (sql.startsWith('UPDATE chat_messages SET message_json = ?')) {
    if (params.at(-1) !== JSON.stringify(message)) return [{ affectedRows: 0 }];
    message = JSON.parse(params[0]); writes += 1;
    return [{ affectedRows: 1 }];
  }
  if (sql.includes('SELECT post_json FROM feed_posts')) { const item = params[0] === 'p1' ? post : operationPosts.get(params[0]); return [item ? [{ post_json: JSON.stringify(item) }] : []]; }
  if (sql.includes('INSERT INTO feed_posts')) { if (!operationPosts.has(params[0])) { operationPosts.set(params[0], JSON.parse(params[2])); writes += 1; } return [{ affectedRows: 1 }]; }
  if (sql.includes('INSERT INTO feed_comments')) { if (!operationComments.has(params[0])) { operationComments.set(params[0], JSON.parse(params[3])); writes += 1; } return [{ affectedRows: 1 }]; }
  if (sql.includes('SELECT comment_json FROM feed_comments')) { const item = operationComments.get(params[1]); return [item ? [{ comment_json: JSON.stringify(item) }] : []]; }
  if (sql.startsWith('UPDATE feed_posts')) {
    if (deletedBetweenReadAndWrite) post = { ...post, deletedAt: '2026-10-06T00:00:00Z', revision: post.revision + 1 };
    if (post.deletedAt || post.revision !== params.at(-1)) return [{ affectedRows: 0 }];
    post = JSON.parse(params[0]); writes += 1;
    return [{ affectedRows: 1 }];
  }
  if (sql.includes('FROM chat_messages') && sql.includes('created_at >= ?')) return [[]];
  return [[]];
};
const replace = (name, exports) => {
  const file = require.resolve(name);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
replace('../config/database', { execute, query: execute });
replace('./recordsArchiveSchema', { ensureRecordsArchiveSchema: async () => true, indexMessageForRecordsArchive: async () => {} });
replace('./feedBackupJournal', { createFeedBackupJournal: () => ({ read: async () => [], mutate: async () => [], replace: async () => [], pause: async () => {}, resume: async () => {} }) });
const router = require('../routes/chat');
const invoke = async (method, path, body = {}, query = {}) => {
  const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
  const req = { params: { conversationId: 'alice::bob', messageId: 'm1', postId: 'p1' }, body, query, auth: { login: 'alice', role: 'admin' } };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, set() {}, json(value) { this.body = value; return this; } };
  await route.stack.at(-1).handle(req, res);
  return res;
};
test.beforeEach(() => {
  message = { id: 'm1', sender: 'alice', text: 'New text', createdAt: '2026-10-06T00:00:00Z', updatedAt: '2026-10-06T00:01:00Z', revision: 2, sequence: 1, attachments: [], reactions: {} };
  post = { id: 'p1', author: 'alice', text: 'Original', updatedAt: '2026-10-06T00:01:00Z', createdAt: '2026-10-06T00:00:00Z', revision: 2, attachments: [] };
  history = []; operationPosts.clear(); operationComments.clear();
  writes = 0; deletedBetweenReadAndWrite = false; queries.length = 0;
});
test('pinning from a stale tab is rejected without overwriting text', async () => {
  const result = await invoke('patch', '/threads/:conversationId/messages/:messageId', { patch: { pinned: true }, expectedRevision: 1 });
  assert.equal(result.statusCode, 409);
  assert.equal(message.text, 'New text');
  assert.equal(writes, 0);
});
test('a pin delta preserves authoritative text and increments the revision', async () => {
  const result = await invoke('patch', '/threads/:conversationId/messages/:messageId', { patch: { pinned: true }, expectedRevision: 2 });
  assert.equal(result.statusCode, 200);
  assert.equal(message.text, 'New text');
  assert.equal(message.pinned, true);
  assert.equal(message.revision, 3);
});
test('a deleted post cannot be resurrected by a concurrent edit', async () => {
  deletedBetweenReadAndWrite = true;
  const result = await invoke('patch', '/feed/posts/:postId', { text: 'Edited', expectedRevision: 2 });
  assert.equal(result.statusCode, 409);
  assert.ok(post.deletedAt);
  assert.equal(post.text, 'Original');
});
test('repeating a feed deletion returns the existing result', async () => {
  post.deletedAt = '2026-10-06T00:02:00Z';
  const result = await invoke('delete', '/feed/posts/:postId');
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.alreadyDeleted, true);
  assert.equal(writes, 0);
});
test('the calendar queries Novosibirsk day boundaries in UTC', async () => {
  const result = await invoke('get', '/threads/:conversationId/date', {}, { date: '2026-10-06' });
  assert.equal(result.statusCode, 200);
  const query = queries.find(call => call.sql.includes('created_at >= ?'));
  assert.equal(query.params[1].toISOString(), '2026-10-05T17:00:00.000Z');
  assert.equal(query.params[2].toISOString(), '2026-10-06T17:00:00.000Z');
});

test('repeating a publication operation returns the same saved record', async () => {
  const first = await invoke('post', '/feed/posts', { text: 'One post', operationId: 'retry-1' });
  const second = await invoke('post', '/feed/posts', { text: 'One post', operationId: 'retry-1' });
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  assert.equal(first.body.post.id, second.body.post.id);
  assert.equal(operationPosts.size, 1);
  assert.equal(writes, 1);
});
test('repeating a comment operation returns the same saved record', async () => {
  const first = await invoke('post', '/feed/posts/:postId/comments', { text: 'One comment', operationId: 'retry-1' });
  const second = await invoke('post', '/feed/posts/:postId/comments', { text: 'One comment', operationId: 'retry-1' });
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  assert.equal(first.body.comment.id, second.body.comment.id);
  assert.equal(operationComments.size, 1);
  assert.equal(writes, 1);
});

test('reconnect pages recover all 80 messages beyond a known 50-message boundary', async () => {
  const { encodeMessageCursor } = require('./chatState');
  history = Array.from({ length: 130 }, (_, index) => ({ id: `message-${index}`, sender: 'bob', text: `Message ${index}`, sequence: index + 1, createdAt: '2026-10-06T00:00:00.123Z' }));
  let after = encodeMessageCursor(history[49]);
  const recovered = new Set(history.slice(0, 50).map(item => item.id));
  for (let page = 0; page < 10; page += 1) {
    const result = await invoke('get', '/threads/:conversationId/messages', {}, { after, limit: 20 });
    assert.equal(result.statusCode, 200);
    result.body.messages.forEach(item => recovered.add(item.id));
    if (!result.body.hasMore) break;
    after = result.body.after;
  }
  assert.equal(recovered.size, 130);
});
