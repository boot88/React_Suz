const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const safeFileName = (value = 'file') => String(value || 'file')
  .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 120) || 'file';

const parseJson = (value, fallback = null) => {
  if (!value) return fallback;
  if (typeof value === 'object' && !Buffer.isBuffer(value)) return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
};

const sha256File = async (filePath) => {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
};

const sqlValue = (value) => {
  if (value === null || value === undefined) return 'NULL';
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  if (value instanceof Date) return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/\0/g, '\\0')}'`;
};

const rowsToSql = (table, rows = []) => rows.map((row) => {
  const columns = Object.keys(row);
  const updates = columns.map((column) => `\`${column}\`=VALUES(\`${column}\`)`).join(', ');
  return `INSERT INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(', ')}) VALUES (${columns.map((column) => sqlValue(row[column])).join(', ')}) ON DUPLICATE KEY UPDATE ${updates};`;
}).join('\n');

const queryRows = async (db, sql, params = []) => {
  const [rows] = await db.query(sql, params);
  return rows || [];
};

const copyArchiveFiles = async ({ files, uploadsDir, stagingDir }) => {
  const copied = [];
  const storageRoot = path.resolve(uploadsDir);
  const targetRoot = path.join(stagingDir, 'files');
  await fs.mkdir(targetRoot, { recursive: true });

  for (const file of files) {
    const metadata = parseJson(file.metadata_json, {});
    const variants = [
      { kind: 'original', relativePath: file.relative_path || path.join(file.scope || 'chat', file.stored_name || '') },
      { kind: 'thumbnail', relativePath: metadata.thumbnailStoredName ? path.join(file.scope || 'chat', metadata.thumbnailStoredName) : '' }
    ].filter((item) => item.relativePath);

    for (const variant of variants) {
      const sourcePath = path.resolve(storageRoot, String(variant.relativePath));
      if (sourcePath !== storageRoot && !sourcePath.startsWith(`${storageRoot}${path.sep}`)) continue;
      try {
        const suffix = variant.kind === 'thumbnail' ? '-thumbnail' : '';
        const destinationName = `${safeFileName(file.id)}${suffix}--${safeFileName(file.original_name)}`;
        const destinationRelative = path.posix.join('files', safeFileName(file.scope || 'chat'), destinationName);
        const destinationPath = path.join(stagingDir, destinationRelative);
        await fs.mkdir(path.dirname(destinationPath), { recursive: true });
        await fs.copyFile(sourcePath, destinationPath);
        const stat = await fs.stat(destinationPath);
        const actualSha256 = await sha256File(destinationPath);
        const databaseSha256 = variant.kind === 'original' ? file.sha256 || '' : '';
        copied.push({
          fileId: file.id,
          variant: variant.kind,
          originalName: file.original_name,
          mimeType: variant.kind === 'thumbnail' ? 'image/jpeg' : file.mime_type,
          archivePath: destinationRelative,
          restorePath: String(variant.relativePath).replace(/\\/g, '/'),
          size: stat.size,
          sha256: actualSha256,
          databaseSha256,
          checksumMatches: !databaseSha256 || databaseSha256 === actualSha256
        });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        copied.push({ fileId: file.id, variant: variant.kind, originalName: file.original_name, missing: true, sourcePath: variant.relativePath });
      }
    }
  }
  return copied;
};

const renderHtml = ({ conversations, messages, versions, feedPosts, feedComments }) => {
  const retainedByMessage = new Map();
  versions.forEach((row) => {
    if (row.action === 'delete') return;
    const current = retainedByMessage.get(row.message_id);
    if (!current || Number(row.version_no) > Number(current.version_no)) retainedByMessage.set(row.message_id, row);
  });
  const messagesByConversation = messages.reduce((map, row) => {
    if (!map[row.conversation_id]) map[row.conversation_id] = [];
    const message = parseJson(row.message_json, {});
    const retained = message.deletedAt ? parseJson(retainedByMessage.get(row.id)?.snapshot_json, {}) : null;
    map[row.conversation_id].push(retained ? {
      ...message,
      text: retained.text,
      attachment: retained.attachment,
      attachments: retained.attachments
    } : message);
    return map;
  }, {});
  const commentsByPost = feedComments.reduce((map, row) => {
    if (!map[row.post_id]) map[row.post_id] = [];
    map[row.post_id].push(parseJson(row.comment_json, {}));
    return map;
  }, {});
  const chatsHtml = conversations.map((conversation) => `
    <section><h2>${escapeHtml(conversation.participant_a)} ↔ ${escapeHtml(conversation.participant_b)}</h2>
    <p>Состояние: ${escapeHtml(conversation.state)} · сообщений: ${escapeHtml(conversation.message_count)}</p>
    ${(messagesByConversation[conversation.conversation_id] || []).map((message) => `
      <article><b>${escapeHtml(message.sender || '')}</b> <time>${escapeHtml(message.createdAt || '')}</time>
      ${message.deletedAt ? `<em>Удалено ${escapeHtml(message.deletedAt)}</em>` : ''}
      <pre>${escapeHtml(message.text || '')}</pre>
      <small>${(message.attachments || (message.attachment ? [message.attachment] : [])).map((file) => escapeHtml(file.name || file.originalName || file.id || '')).join(', ')}</small></article>`).join('')}
    </section>`).join('');
  const feedHtml = feedPosts.map((row) => {
    const post = parseJson(row.post_json, {});
    return `<section><h2>Лента · ${escapeHtml(post.author || row.author_login || '')}</h2><time>${escapeHtml(post.createdAt || row.created_at || '')}</time><pre>${escapeHtml(post.text || '')}</pre>${(commentsByPost[row.id] || []).map((comment) => `<article><b>${escapeHtml(comment.author || '')}</b><pre>${escapeHtml(comment.text || '')}</pre></article>`).join('')}</section>`;
  }).join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Архив переписки</title><style>body{font:15px Arial;max-width:1100px;margin:30px auto;padding:0 20px;color:#182437}section{border:1px solid #ccd5e1;border-radius:12px;padding:18px;margin:16px 0}article{border-top:1px solid #e6ebf1;padding:10px 0}pre{font:inherit;white-space:pre-wrap}time,small,em{display:block;color:#64748b;margin:4px 0}</style></head><body><h1>Архив переписки</h1>${chatsHtml}${feedHtml}</body></html>`;
};

const insertArchiveItems = async (db, archiveId, data) => {
  const items = [
    ...data.messages.map((row) => ['chat_message', row.id, row.conversation_id, row.created_at]),
    ...data.feedPosts.map((row) => ['feed_post', row.id, null, row.created_at]),
    ...data.feedComments.map((row) => ['feed_comment', row.id, row.post_id, row.created_at])
  ];
  for (let index = 0; index < items.length; index += 500) {
    const chunk = items.slice(index, index + 500);
    if (chunk.length) await db.query(
      'INSERT IGNORE INTO records_archive_items (archive_id, entity_type, entity_id, parent_id, source_created_at) VALUES ?',
      [chunk.map((item) => [archiveId, ...item])]
    );
  }
};

const buildRecordsArchivePackage = async ({ db, archiveId, selection, archiveRoot, uploadsDir, actor }) => {
  const stagingDir = path.join(archiveRoot, `${archiveId}.building`);
  const archivePath = path.join(archiveRoot, `${archiveId}.zip`);
  await fs.mkdir(archiveRoot, { recursive: true });
  await fs.rm(stagingDir, { recursive: true, force: true });
  await fs.mkdir(path.join(stagingDir, 'json'), { recursive: true });
  await fs.mkdir(path.join(stagingDir, 'view'), { recursive: true });

  try {
    const conversationWhere = selection.scope === 'conversation' ? 'WHERE conversation_id = ?' : '';
    const conversationParams = selection.scope === 'conversation' ? [selection.conversationId] : [];
    const conversations = await queryRows(db, `SELECT * FROM chat_conversations ${conversationWhere} ORDER BY created_at`, conversationParams);
    const conversationIds = conversations.map((row) => row.conversation_id);
    const messages = conversationIds.length ? await queryRows(db, `SELECT id, conversation_id, sender_login,
      message_json, created_at, updated_at, deleted_at
      FROM chat_messages WHERE conversation_id IN (?) ORDER BY created_at`, [conversationIds]) : [];
    const versions = conversationIds.length ? await queryRows(db, `SELECT message_id, conversation_id, version_no,
      action, snapshot_json, snapshot_sha256, actor_login, actor_role, created_at
      FROM chat_message_versions WHERE conversation_id IN (?) ORDER BY message_id, version_no`, [conversationIds]) : [];
    const messageFiles = conversationIds.length ? await queryRows(db, 'SELECT * FROM chat_message_files WHERE conversation_id IN (?)', [conversationIds]) : [];
    const feedPosts = selection.scope === 'all' ? await queryRows(db, 'SELECT * FROM feed_posts ORDER BY created_at') : [];
    const feedComments = selection.scope === 'all' ? await queryRows(db, 'SELECT * FROM feed_comments ORDER BY created_at') : [];
    const feedReactions = selection.scope === 'all' ? await queryRows(db, 'SELECT * FROM feed_reactions ORDER BY created_at') : [];
    const feedPostFiles = selection.scope === 'all' ? await queryRows(db, 'SELECT * FROM feed_post_files') : [];
    const fileIds = [...new Set([...messageFiles, ...feedPostFiles].map((row) => row.file_id).filter(Boolean))];
    const files = fileIds.length ? await queryRows(db, 'SELECT * FROM chat_files WHERE id IN (?)', [fileIds]) : [];
    const data = { conversations, messages, versions, messageFiles, files, feedPosts, feedComments, feedReactions, feedPostFiles };
    const tableRows = { chat_conversations: conversations, chat_messages: messages, chat_message_versions: versions, chat_files: files, chat_message_files: messageFiles, feed_posts: feedPosts, feed_comments: feedComments, feed_reactions: feedReactions, feed_post_files: feedPostFiles };

    await fs.writeFile(path.join(stagingDir, 'json', 'chats.json'), JSON.stringify({
      conversations,
      messages: messages.map((row) => ({ ...row, message: parseJson(row.message_json, {}) })),
      versions: versions.map((row) => ({ ...row, snapshot: parseJson(row.snapshot_json, {}) })),
      fileLinks: messageFiles
    }, null, 2));
    await fs.writeFile(path.join(stagingDir, 'json', 'feed.json'), JSON.stringify({
      posts: feedPosts.map((row) => ({ ...row, post: parseJson(row.post_json, {}) })),
      comments: feedComments.map((row) => ({ ...row, comment: parseJson(row.comment_json, {}) })),
      reactions: feedReactions,
      fileLinks: feedPostFiles
    }, null, 2));
    const schemaSections = [];
    for (const table of Object.keys(tableRows)) {
      const [createRows] = await db.query(`SHOW CREATE TABLE \`${table}\``);
      const createStatement = createRows?.[0]?.['Create Table'];
      if (createStatement) schemaSections.push(`${createStatement.replace(/^CREATE TABLE /i, 'CREATE TABLE IF NOT EXISTS ')};`);
    }
    await fs.writeFile(path.join(stagingDir, 'schema.sql'), `SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n${schemaSections.join('\n\n')}\nSET FOREIGN_KEY_CHECKS=1;\n`);
    const sqlSections = Object.entries(tableRows)
      .map(([table, rows]) => `-- ${table}\n${rowsToSql(table, rows)}`).join('\n\n');
    await fs.writeFile(path.join(stagingDir, 'database.sql'), `SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n${sqlSections}\nSET FOREIGN_KEY_CHECKS=1;\n`);
    await fs.writeFile(path.join(stagingDir, 'view', 'index.html'), renderHtml(data));
    const copiedFiles = await copyArchiveFiles({ files, uploadsDir, stagingDir });
    const manifest = {
      format: 'react-suz-records-archive', version: 1, archiveId,
      createdAt: new Date().toISOString(), createdBy: actor.login, selection,
      counts: Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length])),
      files: copiedFiles,
      links: { messageFiles, feedPostFiles },
      restore: { schemaSql: 'schema.sql', dataSql: 'database.sql', json: ['json/chats.json', 'json/feed.json'], viewer: 'view/index.html' }
    };
    await fs.writeFile(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await fs.writeFile(path.join(stagingDir, 'README.txt'), [
      'ПЕРЕНОСИМЫЙ АРХИВ REACT_SUZ',
      '',
      '1. Перед восстановлением сохраните текущую базу и папку server/uploads.',
      '2. Проверьте целостность: sha256sum -c checksums.sha256',
      '3. Если таблицы утрачены, сначала восстановите структуру:',
      '   mysql -u USER -p DATABASE < schema.sql',
      '4. Затем восстановите записи MySQL:',
      '   mysql -u USER -p DATABASE < database.sql',
      '5. Настоящие вложения находятся в папке files/.',
      '6. Для восстановления вложений используйте manifest.json: скопируйте каждый archivePath',
      '   в server/uploads/restorePath. Не меняйте идентификаторы файлов.',
      '7. view/index.html открывается браузером и показывает переписку в читаемом виде.',
      '8. json/ содержит независимую машиночитаемую копию чатов и ленты.',
      '',
      `Идентификатор архива: ${archiveId}`,
      `Создан: ${manifest.createdAt}`,
      `Создал: ${actor.login}`
    ].join('\n'));

    const artifactPaths = ['README.txt', 'schema.sql', 'database.sql', 'manifest.json', 'json/chats.json', 'json/feed.json', 'view/index.html', ...copiedFiles.filter((file) => !file.missing).map((file) => file.archivePath)];
    const checksums = [];
    for (const relativePath of artifactPaths) checksums.push(`${await sha256File(path.join(stagingDir, relativePath))}  ${relativePath}`);
    await fs.writeFile(path.join(stagingDir, 'checksums.sha256'), `${checksums.join('\n')}\n`);
    await fs.rm(archivePath, { force: true });
    await execFileAsync('zip', ['-q', '-r', archivePath, '.'], { cwd: stagingDir, timeout: 60 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 });
    const archiveStat = await fs.stat(archivePath);
    const archiveSha256 = await sha256File(archivePath);
    const missingFiles = copiedFiles.filter((file) => file.missing).length;
    const checksumMismatches = copiedFiles.filter((file) => file.checksumMatches === false).length;
    const warningText = [
      missingFiles ? `Не найдено файлов на диске: ${missingFiles}` : '',
      checksumMismatches ? `Не совпал SHA-256 файлов: ${checksumMismatches}` : ''
    ].filter(Boolean).join('; ') || null;

    await insertArchiveItems(db, archiveId, data);
    for (const file of copiedFiles.filter((item) => item.variant === 'original' && !item.missing)) {
      await db.execute(
        `INSERT IGNORE INTO records_archive_files
         (archive_id, file_id, relative_path, original_name, mime_type, size_bytes, sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [archiveId, file.fileId, file.archivePath, file.originalName, file.mimeType, file.size, file.sha256]
      );
    }
    await db.execute(
      `UPDATE records_archives SET status = 'completed', storage_path = ?, package_sha256 = ?,
       record_count = ?, file_count = ?, total_bytes = ?, completed_at = NOW(), error_text = ? WHERE id = ?`,
      [archivePath, archiveSha256, messages.length + feedPosts.length + feedComments.length, files.length, archiveStat.size, warningText, archiveId]
    );
    await db.execute(
      `INSERT INTO records_audit_log (action, entity_type, entity_id, archive_id, actor_login, actor_role, details_json)
       VALUES ('archive_completed', 'records_archive', ?, ?, ?, ?, ?)`,
      [archiveId, archiveId, actor.login, actor.role, JSON.stringify({ archiveSha256, bytes: archiveStat.size })]
    );
  } catch (error) {
    await db.execute("UPDATE records_archives SET status = 'failed', error_text = ? WHERE id = ?", [String(error.message || error).slice(0, 2000), archiveId]).catch(() => {});
    throw error;
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
};

module.exports = { buildRecordsArchivePackage };
