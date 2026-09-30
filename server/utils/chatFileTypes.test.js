const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('stream');
const fs = require('fs/promises');
const path = require('path');
const { getUploadMime, getDownloadHeaders } = require('./chatFileTypes');

const records = new Map();
const database = {
  query: async () => [[]],
  execute: async (sql, args = []) => {
    if (sql.includes('INSERT INTO chat_files')) {
      records.set(args[0], { id: args[0], scope: args[1], original_name: args[2], stored_name: args[3], relative_path: args[4], mime_type: args[7], size_bytes: args[8], is_verified: args[16] });
    }
    if (sql.includes('FROM chat_files WHERE id')) return [[records.get(args[0])].filter(Boolean)];
    return [[]];
  }
};
const dbPath = require.resolve('../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: database };
const router = require('../routes/chat');
const handler = (route) => router.stack.find((layer) => layer.route?.path === route).route.stack[0].handle;

test('upload and download preserve music, archives and arbitrary spectrum files byte for byte', async () => {
  const samples = [
    ['music.mp3', 'audio/mpeg', Buffer.from('ID3\x00music')],
    ['music.wav', 'audio/wav', Buffer.from('RIFF\x00\x00\x00\x00WAVEdata')],
    ['music.flac', '', Buffer.from('fLaC\x00music')],
    ['files.zip', 'application/x-zip-compressed', Buffer.from('PK\x03\x04\x00zip')],
    ['files.rar', 'application/octet-stream', Buffer.from([82, 97, 114, 33, 26, 7, 1, 0])],
    ['files.7z', '', Buffer.from([55, 122, 188, 175, 39, 28, 0])],
    ['files.tar.gz', 'application/gzip', Buffer.from([31, 139, 8, 0, 255])],
    ['files.xz', '', Buffer.from([253, 55, 122, 88, 90, 0])],
    ['spectrum.jdx', 'chemical/x-jcamp-dx', Buffer.from('##TITLE=Спектр\n##END=')],
    ['spectrum.spc', '', Buffer.from([0, 1, 255, 23, 0, 37])],
    ['spectrum.unknown', 'text/plain', Buffer.from([0, 255, 128, 10])],
    ['fid', '', Buffer.from([0, 0, 129, 77])],
    ['page.svg', 'image/svg+xml', Buffer.from('<svg><script>alert(1)</script></svg>')],
    ['program.exe', 'application/octet-stream', Buffer.from('MZ\x00binary')],
    ['fake.jpg', 'image/jpeg', Buffer.from('<html>ordinary download</html>')]
  ];
  for (const [name, mime, payload] of samples) {
    const req = Readable.from([
      Buffer.from(`--files-test\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime || 'application/octet-stream'}\r\n\r\n`),
      payload, Buffer.from('\r\n--files-test--\r\n')
    ]);
    req.headers = { 'content-type': 'multipart/form-data; boundary=files-test' };
    req.auth = { login: 'test-employee' };
    const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await handler('/uploads')(req, response);
    assert.equal(response.code, 201, `${name}: ${JSON.stringify(response.body)}`);
    const file = response.body.file;
    try {
      assert.equal(file.name, name);
      assert.equal(file.size, payload.length);
      const chunks = [];
      const download = new Writable({ write(chunk, encoding, callback) { chunks.push(chunk); callback(); } });
      download.headers = {};
      download.setHeader = (key, value) => { download.headers[key] = value; };
      download.status = (code) => { download.code = code; return download; };
      download.json = (body) => { throw new Error(JSON.stringify(body)); };
      await handler('/files/:fileId/download')({ params: { fileId: file.id }, mediaAuth: { fileId: file.id }, query: { download: '1' }, headers: {} }, download);
      assert.deepEqual(Buffer.concat(chunks), payload, name);
      assert.equal(download.headers['X-Content-Type-Options'], 'nosniff');
      assert.match(download.headers['Content-Disposition'], /^attachment;/);
    } finally {
      await fs.unlink(path.join(__dirname, '..', 'uploads', file.relativePath));
      records.delete(file.id);
    }
  }
});

test('active files are downloadable while valid photos and videos retain inline previews', () => {
  assert.deepEqual(getDownloadHeaders('text/html'), { type: 'application/octet-stream', disposition: 'attachment' });
  assert.deepEqual(getDownloadHeaders('image/svg+xml'), { type: 'application/octet-stream', disposition: 'attachment' });
  assert.equal(getUploadMime('page.html', 'image/jpeg', Buffer.from([255, 216, 255])), 'application/octet-stream');
  assert.equal(getUploadMime('photo.jpg', 'image/jpeg', Buffer.from([255, 216, 255])), 'image/jpeg');
  assert.equal(getDownloadHeaders('image/jpeg').disposition, 'inline');
  assert.equal(getDownloadHeaders('video/mp4').disposition, 'inline');
  assert.equal(getDownloadHeaders('image/jpeg', true).disposition, 'attachment');
  assert.equal(getDownloadHeaders('text/html\r\nInjected: value').type, 'application/octet-stream');
});
