const crypto = require('crypto');

const RETRY_DELAY_MS = 30_000;

let schemaReady = false;
let schemaPromise = null;
let retryAt = 0;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS chat_conversations (
    conversation_id VARCHAR(255) PRIMARY KEY,
    participant_a VARCHAR(255) NOT NULL,
    participant_b VARCHAR(255) NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL,
    last_message_at DATETIME NULL,
    message_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    archived_at DATETIME NULL,
    archived_by VARCHAR(255) NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_chat_conversations_state_last (state, last_message_at),
    INDEX idx_chat_conversations_participant_a (participant_a, last_message_at),
    INDEX idx_chat_conversations_participant_b (participant_b, last_message_at)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_message_versions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    message_id VARCHAR(128) NOT NULL,
    conversation_id VARCHAR(255) NOT NULL,
    version_no INT UNSIGNED NOT NULL,
    action VARCHAR(32) NOT NULL DEFAULT 'snapshot',
    snapshot_json LONGTEXT NOT NULL,
    snapshot_sha256 CHAR(64) NOT NULL,
    actor_login VARCHAR(255) NULL,
    actor_role VARCHAR(40) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_chat_message_version (message_id, version_no),
    INDEX idx_chat_message_versions_conversation (conversation_id, created_at),
    INDEX idx_chat_message_versions_message (message_id, created_at)
  )`,
  `CREATE TABLE IF NOT EXISTS records_archives (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    archive_type VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    selection_json LONGTEXT NULL,
    storage_path VARCHAR(1024) NULL,
    package_sha256 CHAR(64) NULL,
    record_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    file_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    total_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    cutoff_at DATETIME NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    downloaded_at DATETIME NULL,
    deleted_at DATETIME NULL,
    error_text TEXT NULL,
    INDEX idx_records_archives_status_created (status, created_at),
    INDEX idx_records_archives_created_by (created_by, created_at),
    INDEX idx_records_archives_cutoff (cutoff_at)
  )`,
  `CREATE TABLE IF NOT EXISTS records_archive_items (
    archive_id VARCHAR(64) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    parent_id VARCHAR(255) NULL,
    source_created_at DATETIME NULL,
    archived_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (archive_id, entity_type, entity_id),
    INDEX idx_archive_items_entity (entity_type, entity_id),
    INDEX idx_archive_items_parent (entity_type, parent_id),
    INDEX idx_archive_items_source_date (source_created_at)
  )`,
  `CREATE TABLE IF NOT EXISTS records_archive_files (
    archive_id VARCHAR(64) NOT NULL,
    file_id VARCHAR(128) NOT NULL,
    relative_path VARCHAR(1024) NOT NULL,
    original_name VARCHAR(255) NULL,
    mime_type VARCHAR(255) NULL,
    size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    sha256 CHAR(64) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (archive_id, file_id),
    INDEX idx_archive_files_file (file_id),
    INDEX idx_archive_files_sha256 (sha256)
  )`,
  `CREATE TABLE IF NOT EXISTS records_archive_access (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    archive_id VARCHAR(64) NOT NULL,
    user_login VARCHAR(255) NOT NULL,
    scope_json LONGTEXT NULL,
    granted_by VARCHAR(255) NOT NULL,
    granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NULL,
    revoked_at DATETIME NULL,
    revoked_by VARCHAR(255) NULL,
    INDEX idx_archive_access_user_active (user_login, revoked_at, expires_at),
    INDEX idx_archive_access_archive (archive_id, revoked_at)
  )`,
  `CREATE TABLE IF NOT EXISTS records_legal_holds (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    scope_json LONGTEXT NULL,
    starts_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ends_at DATETIME NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released_by VARCHAR(255) NULL,
    released_at DATETIME NULL,
    INDEX idx_legal_holds_status_dates (status, starts_at, ends_at),
    INDEX idx_legal_holds_created_by (created_by, created_at)
  )`,
  `CREATE TABLE IF NOT EXISTS records_legal_hold_items (
    hold_id VARCHAR(64) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    parent_id VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (hold_id, entity_type, entity_id),
    INDEX idx_legal_hold_items_entity (entity_type, entity_id),
    INDEX idx_legal_hold_items_parent (entity_type, parent_id)
  )`,
  `CREATE TABLE IF NOT EXISTS records_audit_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    action VARCHAR(80) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    entity_id VARCHAR(255) NULL,
    archive_id VARCHAR(64) NULL,
    hold_id VARCHAR(64) NULL,
    actor_login VARCHAR(255) NOT NULL,
    actor_role VARCHAR(40) NULL,
    details_json LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_records_audit_action_date (action, created_at),
    INDEX idx_records_audit_entity (entity_type, entity_id, created_at),
    INDEX idx_records_audit_actor (actor_login, created_at),
    INDEX idx_records_audit_archive (archive_id, created_at),
    INDEX idx_records_audit_hold (hold_id, created_at)
  )`
];

const backfillStatements = [
  `INSERT INTO chat_conversations (
      conversation_id, participant_a, participant_b, state,
      created_at, last_message_at, message_count
    )
    SELECT
      conversation_id,
      LOWER(SUBSTRING_INDEX(conversation_id, '::', 1)),
      LOWER(SUBSTRING_INDEX(conversation_id, '::', -1)),
      'active',
      MIN(created_at),
      MAX(created_at),
      COUNT(*)
    FROM chat_messages
    GROUP BY conversation_id
    ON DUPLICATE KEY UPDATE
      participant_a = VALUES(participant_a),
      participant_b = VALUES(participant_b),
      created_at = LEAST(chat_conversations.created_at, VALUES(created_at)),
      last_message_at = GREATEST(
        COALESCE(chat_conversations.last_message_at, '1970-01-01 00:00:00'),
        COALESCE(VALUES(last_message_at), '1970-01-01 00:00:00')
      ),
      message_count = VALUES(message_count)`,
  `INSERT IGNORE INTO chat_message_versions (
      message_id, conversation_id, version_no, action, snapshot_json,
      snapshot_sha256, actor_login, actor_role, created_at
    )
    SELECT
      id,
      conversation_id,
      1,
      'snapshot',
      message_json,
      SHA2(message_json, 256),
      COALESCE(sender_login, 'system'),
      NULL,
      COALESCE(updated_at, created_at)
    FROM chat_messages`
];

const ensureRecordsArchiveSchema = async (database) => {
  if (schemaReady) return true;
  if (schemaPromise) return schemaPromise;
  if (Date.now() < retryAt) return false;

  schemaPromise = (async () => {
    for (const statement of schemaStatements) {
      await database.execute(statement);
    }
    for (const statement of backfillStatements) {
      await database.execute(statement);
    }
    schemaReady = true;
    retryAt = 0;
    return true;
  })()
    .catch((error) => {
      schemaReady = false;
      retryAt = Date.now() + RETRY_DELAY_MS;
      console.warn('Records archive SQL schema unavailable:', error.message);
      return false;
    })
    .finally(() => {
      schemaPromise = null;
    });

  return schemaPromise;
};

const getMessageVersionAction = (message = {}) => {
  if (message.deletedAt) return 'delete';
  if (message.editedAt || message.updatedAt) return 'update';
  return 'create';
};

const indexMessageForRecordsArchive = async (database, conversationId, message = {}) => {
  if (!conversationId || !message?.id || !await ensureRecordsArchiveSchema(database)) return false;

  // Recalculate the summary from the authoritative message table. This keeps
  // message_count correct for creates, retries and updates without relying on
  // a fragile in-memory counter.
  await database.execute(
    `INSERT INTO chat_conversations (
        conversation_id, participant_a, participant_b, state,
        created_at, last_message_at, message_count
      )
      SELECT
        conversation_id,
        LOWER(SUBSTRING_INDEX(conversation_id, '::', 1)),
        LOWER(SUBSTRING_INDEX(conversation_id, '::', -1)),
        'active',
        MIN(created_at),
        MAX(created_at),
        COUNT(*)
      FROM chat_messages
      WHERE conversation_id = ?
      GROUP BY conversation_id
      ON DUPLICATE KEY UPDATE
        participant_a = VALUES(participant_a),
        participant_b = VALUES(participant_b),
        created_at = LEAST(chat_conversations.created_at, VALUES(created_at)),
        last_message_at = VALUES(last_message_at),
        message_count = VALUES(message_count)`,
    [conversationId]
  );

  const snapshotJson = JSON.stringify(message);
  const snapshotSha256 = crypto.createHash('sha256').update(snapshotJson).digest('hex');
  const [latestRows] = await database.execute(
    `SELECT version_no, snapshot_sha256
     FROM chat_message_versions
     WHERE message_id = ?
     ORDER BY version_no DESC
     LIMIT 1`,
    [message.id]
  );
  const latest = latestRows?.[0];
  if (latest?.snapshot_sha256 === snapshotSha256) return true;

  const auditEntries = Array.isArray(message.audit) ? message.audit : [];
  const latestAudit = auditEntries[auditEntries.length - 1] || {};
  const actorLogin = message.deletedBy || message.editedBy || latestAudit.by || message.sender || 'system';
  const actorRole = latestAudit.role || null;
  const createdAt = new Date(
    message.deletedAt || message.editedAt || message.updatedAt || message.createdAt || Date.now()
  );
  const safeCreatedAt = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt;
  const nextVersion = (Number(latest?.version_no) || 0) + 1;

  try {
    await database.execute(
      `INSERT INTO chat_message_versions (
         message_id, conversation_id, version_no, action, snapshot_json,
         snapshot_sha256, actor_login, actor_role, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        conversationId,
        nextVersion,
        getMessageVersionAction(message),
        snapshotJson,
        snapshotSha256,
        actorLogin,
        actorRole,
        safeCreatedAt
      ]
    );
  } catch (error) {
    // Concurrent updates can select the same next version number. Re-read the
    // latest version once; the caller may safely retry the message operation.
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    const [concurrentRows] = await database.execute(
      `SELECT snapshot_sha256
       FROM chat_message_versions
       WHERE message_id = ?
       ORDER BY version_no DESC
       LIMIT 1`,
      [message.id]
    );
    if (concurrentRows?.[0]?.snapshot_sha256 !== snapshotSha256) throw error;
  }

  return true;
};

const resetRecordsArchiveSchemaState = () => {
  schemaReady = false;
  schemaPromise = null;
  retryAt = 0;
};

module.exports = {
  ensureRecordsArchiveSchema,
  indexMessageForRecordsArchive,
  resetRecordsArchiveSchemaState,
  schemaStatements,
  backfillStatements
};
