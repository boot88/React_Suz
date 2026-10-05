const test = require('node:test');
const assert = require('node:assert/strict');
let imageReads = 0;
let writes = 0;
let images = [{ name: 'test.png', data: 'data:image/png;base64,eA==' }];
const dbPath = require.resolve('../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async () => [[]],
  execute: async (sql) => {
    if (sql.startsWith('SELECT COUNT')) return [[{ total: 1 }]];
    if (sql.startsWith('SELECT id, title')) return [[{ id: 7, title: 'Article', solution: 'Summary', category: 'Общее', image_count: images.length }]];
    if (sql.startsWith('SELECT DISTINCT')) return [[{ category: 'Общее' }]];
    if (sql.startsWith('SELECT images')) { imageReads += 1; return [[{ images: JSON.stringify(images) }]]; }
    if (sql.startsWith('SELECT *')) return [[{ id: 7, title: 'Article', solution: 'Full text', images: JSON.stringify(images), updated_at: '2026-10-01' }]];
    if (/^(UPDATE|INSERT|DELETE)/.test(sql)) { writes += 1; return [{ affectedRows: 1, insertId: 7 }]; }
    throw new Error(`Unexpected query: ${sql}`);
  }
} };
const router = require('../routes/knowledgeBase');
const invoke = async (method, path, query = {}, body = {}, params = { id: '7', index: '0' }) => {
  const route = router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route;
  const response = { code: 200, status(code) { this.code = code; return this; }, sendStatus(code) { this.code = code; return this; }, json(value) { this.body = value; }, send(value) { this.body = value; }, set() { return this; }, type() { return this; } };
  await route.stack.at(-1).handle({ query, body, params }, response);
  return response;
};
test('list pagination returns summaries and no image payload', async () => {
  const res = await invoke('get', '/', { page: '10', search: 'Article' });
  assert.equal(res.body.page, 1); assert.equal(res.body.total, 1);
  assert.deepEqual(res.body.articles[0].images, []); assert.equal(res.body.articles[0].image_count, 1);
  assert.equal(JSON.stringify(res.body).includes('base64'), false);
});
test('reading details exposes image URLs, while edit details expose their original data', async () => {
  const read = await invoke('get', '/:id');
  assert.equal(read.body.images[0].data, undefined); assert.match(read.body.images[0].url, /\/7\/images\/0\?v=/);
  const edit = await invoke('get', '/:id', { edit: '1' });
  assert.equal(edit.body.images[0].data, images[0].data);
});
test('concurrent photographs share a bounded article read and mutation invalidates it', async () => {
  imageReads = 0;
  const responses = await Promise.all(Array.from({ length: 10 }, () => invoke('get', '/:id/images/:index')));
  assert.equal(imageReads, 1); assert.ok(responses.every((res) => res.body.toString() === 'x'));
  await invoke('put', '/:id', {}, { title: 'Article', solution: 'Text', images });
  images = [{ name: 'test.png', data: 'data:image/png;base64,eQ==' }];
  const next = await invoke('get', '/:id/images/:index');
  assert.equal(imageReads, 2); assert.equal(next.body.toString(), 'y');
});
test('unsupported images and oversized article image arrays are rejected without writes', async () => {
  const previous = writes;
  for (const bad of [[{ data: 'data:image/svg+xml;base64,eA==' }], Array.from({ length: 21 }, () => images[0]), [{ data: 'data:image/png;base64,' + Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }]]) {
    const res = await invoke('post', '/', {}, { title: 'Article', solution: 'Text', images: bad });
    assert.equal(res.code, 400);
  }
  assert.equal(writes, previous);
});
