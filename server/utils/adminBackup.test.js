const test = require('node:test');
const assert = require('node:assert/strict');
const { makeSql, parseSql, digest, getGroups, safeFilePath, buildCreateSql, orderTables, assertReferencedFiles } = require('./adminBackup');

const sample = () => makeSql('knowledge', [{
  name: 'knowledge_base', schema: 'CREATE TABLE `knowledge_base` (`id` INT, `solution` LONGTEXT, `images` LONGTEXT, `created_at` DATETIME) ENGINE=InnoDB',
  columns: ['id', 'solution', 'images', 'created_at'],
  rows: [{ id: '9007199254740993', solution: "Русский текст\n'; DROP TABLE users; -- 😊", images: JSON.stringify([{ name: 'фото.png', data: 'data:image/png;base64,aGVsbG8=' }]), created_at: new Date('2026-09-30T03:00:00.000Z') }]
}]);
const resign = (body) => `${body}-- SHA256 ${digest(body)}\n`;

test('SQL round trip preserves Russian, quotes, photos, bigint and UTC dates', () => {
  const tables = parseSql(sample(), 'knowledge', ['knowledge_base']);
  const values = tables[0].rows[0].map((value) => value.toString('utf8'));
  assert.equal(values[0], '9007199254740993');
  assert.equal(values[1], "Русский текст\n'; DROP TABLE users; -- 😊");
  assert.equal(JSON.parse(values[2])[0].data, 'data:image/png;base64,aGVsbG8=');
  assert.equal(values[3], '2026-09-30 03:00:00.000');
});
test('refuses wrong group, truncation and unexpected SQL even with recomputed checksum', () => {
  assert.throws(() => parseSql(sample(), 'applications', ['knowledge_base']), /раздела/);
  assert.throws(() => parseSql(sample().slice(0, -9), 'knowledge', ['knowledge_base']), /повреждён/);
  const body = sample().split('-- SHA256')[0].replace('COMMIT;', 'DROP TABLE users;\nCOMMIT;');
  assert.throws(() => parseSql(resign(body), 'knowledge', ['knowledge_base']), /SQL-команды/);
});
test('never imports excluded tables and rejects duplicate columns and invalid hex', () => {
  assert.throws(() => parseSql(sample(), 'knowledge', ['users']), /таблиц/);
  const body = sample().split('-- SHA256')[0];
  assert.throws(() => parseSql(resign(body.replace('(`id`,`solution`,`images`,`created_at`)', '(`id`,`id`,`images`,`created_at`)')), 'knowledge', ['knowledge_base']), /колонки/);
  assert.throws(() => parseSql(resign(body.replace("X'393030", "X'zzz393030")), 'knowledge', ['knowledge_base']), /SQL-команды/);
});
test('empty tables are represented and restored rather than skipped', () => {
  const sql = makeSql('applications', [{ name: 'application', schema: 'CREATE TABLE `application` (`id` INT) ENGINE=InnoDB', columns: ['id'], rows: [] }]);
  const [table] = parseSql(sql, 'applications', ['application']);
  assert.equal(table.name, 'application');
  assert.deepEqual(table.rows, []);
});
test('all includes additional local tables while excluding external snapshots and sessions', () => {
  const groups = getGroups(['application', 'knowledge_base', 'phone_book', 'network_map_snapshot', 'auth_sessions', 'local_options']);
  assert.deepEqual(groups.other.tables, ['local_options']);
  assert.deepEqual(groups.all.tables, ['application', 'knowledge_base', 'local_options']);
});
test('file import confines paths to selected roots and rejects traversal', () => {
  const group = getGroups([]).accounts;
  assert.equal(safeFilePath('uploads/profile/avatar.png', group), 'uploads/profile/avatar.png');
  for (const file of ['uploads/profile/../../.env', '/uploads/profile/x', 'uploads/profile\\evil', 'uploads/chat/x', 'uploads/profile/./x']) assert.throws(() => safeFilePath(file, group));
});

test('new-table metadata is constrained and hostile defaults remain literal data', () => {
  const table = { name: 'example', definition: {
    columns: [{ Field: 'id', Type: 'int', Null: 'NO', Default: null, Extra: 'auto_increment' },
      { Field: 'title', Type: 'varchar(255)', Null: 'YES', Default: "'; DROP TABLE users; --", Extra: '' }],
    indexes: [{ Key_name: 'PRIMARY', Column_name: 'id', Non_unique: 0, Seq_in_index: 1, Index_type: 'BTREE' }]
  } };
  const sql = buildCreateSql(table);
  assert.ok(sql.includes('PRIMARY KEY (`id`)'));
  assert.ok(!sql.includes('DROP TABLE'));
  table.definition.columns[1].Type = 'varchar(255)); DROP TABLE users; --';
  assert.throws(() => buildCreateSql(table), /тип колонки/);
});

test('SQL schema metadata survives export and permits creating an absent table', () => {
  const definition = { columns: [{ Field: 'id', Type: 'int', Null: 'NO', Default: null, Extra: '' }], indexes: [] };
  const sql = makeSql('applications', [{ name: 'application', schema: 'CREATE TABLE `application` (`id` INT) ENGINE=InnoDB', definition, columns: ['id'], rows: [] }]);
  const [table] = parseSql(sql, 'applications', ['application']);
  assert.deepEqual(table.definition, definition);
  assert.match(buildCreateSql(table), /^CREATE TABLE `application`/);
});

test('dependency ordering restores parents first and refuses cyclic foreign keys', () => {
  const child = { name: 'child', schema: 'CREATE TABLE child (FOREIGN KEY (`parent_id`) REFERENCES `parent` (`id`))' };
  const parent = { name: 'parent', schema: 'CREATE TABLE parent (`id` INT)' };
  assert.deepEqual(orderTables([child, parent]).map((table) => table.name), ['parent', 'child']);
  parent.schema = 'CREATE TABLE parent (FOREIGN KEY (`child_id`) REFERENCES `child` (`id`))';
  assert.throws(() => orderTables([child, parent]), /циклические/);
});

test('incomplete avatar and attachment archives fail before changing data', () => {
  assert.throws(() => assertReferencedFiles([{ name: 'employee_profiles', columns: ['avatar_stored_name'], rows: [['avatar.png']] }], []), /отсутствует/);
  assert.doesNotThrow(() => assertReferencedFiles([{ name: 'employee_profiles', columns: ['avatar_stored_name'], rows: [['avatar.png']] }], [{ path: 'uploads/profile/avatar.png' }]));
});
