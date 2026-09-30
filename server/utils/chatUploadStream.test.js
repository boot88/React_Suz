const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const dbPath = require.resolve('../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => [[]], execute: async () => [[]] } };
const { readMultipartFileStream } = require('../routes/chat');
const MB = 1024 * 1024;

const multipart = (size) => Readable.from((async function* () {
  yield Buffer.from('--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\n');
  const chunk = Buffer.alloc(MB, 65);
  while (size > 0) {
    const length = Math.min(size, chunk.length);
    yield chunk.subarray(0, length); size -= length;
  }
  yield Buffer.from('\r\n--test-boundary--\r\n');
})());

test('streamed uploads accept larger files with a raised limit and reject at the saved lower limit', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'suz-stream-'));
  try {
    const accepted = await readMultipartFileStream(multipart(51 * MB), 'test-boundary', path.join(directory, 'accepted'), 128 * MB);
    assert.equal(accepted.filePart.size, 51 * MB);
    await assert.rejects(readMultipartFileStream(multipart(51 * MB), 'test-boundary', path.join(directory, 'rejected'), 50 * MB), (error) => error.status === 413 && error.message.includes('50 МБ'));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test('128 MB boundary is accepted and one byte over is rejected by actual streamed size', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'suz-stream-'));
  try {
    const accepted = await readMultipartFileStream(multipart(128 * MB), 'test-boundary', path.join(directory, 'exact'), 128 * MB);
    assert.equal(accepted.filePart.size, 128 * MB);
    await assert.rejects(readMultipartFileStream(multipart(128 * MB + 1), 'test-boundary', path.join(directory, 'over'), 128 * MB), (error) => error.status === 413);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
