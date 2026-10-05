const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { MAX_BYTES, fail, identifier, orderTables, sqlValue } = require('./adminBackup');

// Build a compatible, checksummed SQL dump on disk with bounded buffering.
// The caller holds a consistent snapshot and supplies a streaming row reader.
const writeSqlBackup = async (key, tables, readRows) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'suz-backup-'));
  const file = path.join(directory, 'backup.sql');
  const handle = await fs.open(file, 'wx', 0o600);
  const hash = crypto.createHash('sha256');
  let bytes = 0, buffer = '', bufferBytes = 0;
  const cleanup = () => fs.rm(directory, { recursive: true, force: true });
  const flush = async () => { if (buffer) { await handle.writeFile(buffer); buffer = ''; bufferBytes = 0; } };
  const line = async (text) => {
    const chunk = text + '\n';
    const size = Buffer.byteLength(chunk); bytes += size; bufferBytes += size;
    if (bytes > MAX_BYTES - 80) throw fail('Резервная копия превышает лимит 512 МБ. Экспортируйте разделы отдельно.', 413);
    hash.update(chunk); buffer += chunk;
    if (bufferBytes >= 1024 * 1024) await flush();
  };
  try {
    tables = orderTables(tables);
    await line(`-- React_Suz backup v1 ${key}`);
    await line('SET NAMES utf8mb4;'); await line("SET time_zone = '+00:00';");
    for (const table of tables) {
      await line(`-- BEGIN SCHEMA ${table.name}`);
      if (table.definition) await line(`-- TABLE META ${Buffer.from(JSON.stringify(table.definition)).toString('base64')}`);
      await line(`${table.schema.replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS ')};`);
      await line('-- END SCHEMA');
    }
    await line('START TRANSACTION;');
    for (const table of [...tables].reverse()) await line(`DELETE FROM ${identifier(table.name)};`);
    for (const table of tables) {
      const columns = table.columns.map(identifier).join(',');
      for await (const row of readRows(table)) await line(`INSERT INTO ${identifier(table.name)} (${columns}) VALUES (${table.columns.map((column) => sqlValue(row[column])).join(',')});`);
    }
    await line('COMMIT;'); await flush();
    await handle.writeFile(`-- SHA256 ${hash.digest('hex')}\n`);
    await handle.close();
    return { file, cleanup };
  } catch (error) { await handle.close().catch(() => {}); await cleanup(); throw error; }
};
module.exports = { writeSqlBackup };
