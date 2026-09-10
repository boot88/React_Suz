import React from 'react';

export default function ChatArchiveAdministration({ AttachmentCard, archiveAccessDrafts, archiveConversations, archiveCreating, archiveFilters, archiveHasMore, archiveLoading, archiveMessages, archivePackageName, archiveSelectedId, createLegalHold, createRecordsArchive, directoryEmployees, downloadRecordsArchive, fetchArchiveMessages, fetchConversationPurgePreview, formatFileSize, formatVisibleLogin, getMessageAttachments, getParticipantsFromThreadId, grantRecordsArchiveAccess, interfaceLocale, isEnglishInterface, legalHoldFilters, legalHoldForm, legalHoldLoading, legalHolds, permanentlyDeleteConversation, purgeHistory, purgeLoading, purgePreview, purgeReason, recordsArchives, releaseLegalHold, revokeRecordsArchiveAccess, sameLogin, setArchiveFilters, setArchivePackageName, setArchiveSelectedId, setConversationArchiveState, setLegalHoldFilters, setLegalHoldForm, setPurgeReason, t, updateArchiveAccessDraft, user }) {
  return (<section className="manager-panel archive-center-panel">
            <h2>{t('archiveCenter')}</h2>
            <div className="archive-package-builder">
              <input type="text" placeholder={t('archiveName')} value={archivePackageName} onChange={(event) => setArchivePackageName(event.target.value)} />
              <button type="button" disabled={archiveCreating} onClick={() => createRecordsArchive('all')}>{t('createFullArchive')}</button>
              <button type="button" disabled={archiveCreating || !archiveSelectedId} onClick={() => createRecordsArchive('conversation')}>{t('createConversationArchive')}</button>
            </div>
            <div className="archive-packages">
              <h3>{t('archivePackages')}</h3>
              {recordsArchives.length === 0 && <small>{t('archiveNoPackages')}</small>}
              {recordsArchives.map((archive) => {
                const statusLabel = archive.status === 'completed'
                  ? t('archiveCompleted')
                  : archive.status === 'failed' ? t('archiveFailed') : t('archivePending');
                const conversationId = archive.selection?.conversationId || '';
                const participantLogins = getParticipantsFromThreadId(conversationId);
                const eligibleEmployees = participantLogins
                  .filter((login) => !sameLogin(login, user?.username))
                  .map((login) => {
                    const employee = directoryEmployees.find((item) => sameLogin(item.login, login));
                    return { login, name: employee?.full_name || formatVisibleLogin(login) };
                  });
                const accessDraft = archiveAccessDrafts[archive.id] || { userLogin: '', expiresInDays: 7 };
                const accesses = Array.isArray(archive.accesses) ? archive.accesses : [];
                return (
                  <div key={archive.id} className={`archive-package-row status-${archive.status}`}>
                    <div className="archive-package-details">
                      <strong>{archive.name}</strong>
                      <small>{statusLabel} · {archive.created_at ? new Date(archive.created_at).toLocaleString(interfaceLocale) : ''}</small>
                      {archive.status === 'completed' && <small>{archive.record_count || 0} {t('archiveRecords')} · {archive.file_count || 0} {t('archiveFiles')} · {formatFileSize(archive.total_bytes)}</small>}
                      {archive.package_sha256 && <code>SHA-256: {archive.package_sha256}</code>}
                      {archive.error_text && <em>{archive.error_text}</em>}
                      {accesses.length > 0 && (
                        <div className="archive-access-list">
                          <b>{t('archiveAccesses')}</b>
                          {accesses.map((access) => {
                            const revoked = Boolean(access.revoked_at);
                            const expired = !revoked && access.expires_at && new Date(access.expires_at).getTime() <= Date.now();
                            return (
                              <div key={access.id} className={`archive-access-row ${revoked || expired ? 'inactive' : ''}`}>
                                <span>
                                  {access.user_full_name || access.user_login} · {revoked
                                    ? t('archiveAccessRevoked')
                                    : expired
                                      ? t('archiveAccessExpired')
                                      : `${t('archiveAccessUntil')} ${new Date(access.expires_at).toLocaleString(interfaceLocale)}`}
                                </span>
                                {!revoked && !expired && <button type="button" onClick={() => revokeRecordsArchiveAccess(access)}>{t('archiveRevokeAccess')}</button>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="archive-package-actions">
                      {archive.status === 'completed' && <button type="button" onClick={() => downloadRecordsArchive(archive)}>{t('archiveDownload')}</button>}
                      {archive.status === 'completed' && archive.archive_type === 'conversation' && (
                        <div className="archive-access-form">
                          <select
                            aria-label={t('archiveAccessEmployee')}
                            value={accessDraft.userLogin}
                            onChange={(event) => updateArchiveAccessDraft(archive.id, { userLogin: event.target.value })}
                          >
                            <option value="">{t('archiveAccessEmployee')}</option>
                            {eligibleEmployees.map((employee) => <option key={employee.login} value={employee.login}>{employee.name} ({employee.login})</option>)}
                          </select>
                          <select
                            aria-label={t('archiveAccessDuration')}
                            value={accessDraft.expiresInDays}
                            onChange={(event) => updateArchiveAccessDraft(archive.id, { expiresInDays: Number(event.target.value) })}
                          >
                            <option value={1}>{t('archiveAccessOneDay')}</option>
                            <option value={7}>{t('archiveAccessSevenDays')}</option>
                            <option value={30}>{t('archiveAccessThirtyDays')}</option>
                            <option value={90}>{t('archiveAccessNinetyDays')}</option>
                          </select>
                          <button type="button" disabled={!accessDraft.userLogin} onClick={() => grantRecordsArchiveAccess(archive)}>{t('archiveGrantAccess')}</button>
                        </div>
                      )}
                      {archive.status === 'completed' && archive.archive_type !== 'conversation' && <small>{t('archiveConversationOnly')}</small>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="legal-hold-center">
              <div className="legal-hold-heading">
                <div>
                  <h3>{t('legalHoldTitle')}</h3>
                  <small>{t('legalHoldHint')}</small>
                </div>
                <div className="legal-hold-filters">
                  <input
                    type="search"
                    placeholder={t('legalHoldSearch')}
                    value={legalHoldFilters.q}
                    onChange={(event) => setLegalHoldFilters((current) => ({ ...current, q: event.target.value }))}
                  />
                  <select value={legalHoldFilters.status} onChange={(event) => setLegalHoldFilters((current) => ({ ...current, status: event.target.value }))}>
                    <option value="all">{t('legalHoldAll')}</option>
                    <option value="active">{t('legalHoldActive')}</option>
                    <option value="expired">{t('legalHoldExpired')}</option>
                    <option value="released">{t('legalHoldReleased')}</option>
                  </select>
                </div>
              </div>
              {legalHoldLoading && legalHolds.length === 0 && <small>{t('loading')}…</small>}
              {!legalHoldLoading && legalHolds.length === 0 && <small>{t('legalHoldEmpty')}</small>}
              <div className="legal-hold-list">
                {legalHolds.map((hold) => {
                  const released = hold.status === 'released';
                  const expired = !released && hold.ends_at && new Date(hold.ends_at).getTime() <= Date.now();
                  const active = !released && !expired;
                  return (
                    <article key={hold.id} className={`legal-hold-card ${active ? 'active' : 'inactive'}`}>
                      <div className="legal-hold-card-title">
                        <strong>🔒 {hold.name}</strong>
                        <span>{active ? t('legalHoldProtected') : expired ? t('legalHoldExpired') : t('legalHoldReleased')}</span>
                      </div>
                      <p>{hold.reason}</p>
                      <small>{hold.conversation_id || hold.scope?.conversationId || '—'}</small>
                      <small>{t('legalHoldCreatedBy')}: {hold.created_by} · {hold.created_at ? new Date(hold.created_at).toLocaleString(interfaceLocale) : '—'}</small>
                      <small>{hold.ends_at ? `${t('archiveAccessUntil')} ${new Date(hold.ends_at).toLocaleString(interfaceLocale)}` : t('legalHoldPermanent')} · {hold.item_count || 0} {t('legalHoldItems')}</small>
                      {hold.released_at && <small>{t('legalHoldReleased')}: {new Date(hold.released_at).toLocaleString(interfaceLocale)} · {hold.released_by || '—'}</small>}
                      {active && <button type="button" onClick={() => releaseLegalHold(hold)}>{t('legalHoldRelease')}</button>}
                    </article>
                  );
                })}
              </div>
            </div>
            <details className="purge-history-panel">
              <summary>{t('purgeHistory')} · {purgeHistory.length}</summary>
              {purgeHistory.length === 0 && <small>{t('purgeHistoryEmpty')}</small>}
              <div className="purge-history-list">
                {purgeHistory.map((entry) => (
                  <article key={entry.id}>
                    <strong>{entry.conversation_id}</strong>
                    <span>{entry.details?.reason || '—'}</span>
                    <small>{t('purgeDeletedBy')}: {entry.actor_login} · {entry.created_at ? new Date(entry.created_at).toLocaleString(interfaceLocale) : '—'}</small>
                    <small>ZIP: {entry.details?.archive?.name || entry.archive_id || '—'}</small>
                    {entry.details?.archive?.packageSha256 && <code>SHA-256: {entry.details.archive.packageSha256}</code>}
                  </article>
                ))}
              </div>
            </details>
            <div className="archive-toolbar">
              <input
                type="search"
                placeholder={t('archiveSearch')}
                value={archiveFilters.q}
                onChange={(event) => setArchiveFilters((current) => ({ ...current, q: event.target.value }))}
              />
              <select value={archiveFilters.state} onChange={(event) => setArchiveFilters((current) => ({ ...current, state: event.target.value }))}>
                <option value="all">{t('archiveAll')}</option>
                <option value="active">{t('archiveActive')}</option>
                <option value="archived">{t('archiveStored')}</option>
              </select>
              <label>{t('archiveFrom')}<input type="date" value={archiveFilters.from} onChange={(event) => setArchiveFilters((current) => ({ ...current, from: event.target.value }))} /></label>
              <label>{t('archiveTo')}<input type="date" value={archiveFilters.to} onChange={(event) => setArchiveFilters((current) => ({ ...current, to: event.target.value }))} /></label>
            </div>
            <div className="threads-grid archive-grid">
              <div className="threads-list">
                {archiveLoading && archiveConversations.length === 0 && <div className="empty-chat">{t('loading')}…</div>}
                {!archiveLoading && archiveConversations.length === 0 && <div className="empty-chat">{t('archiveEmpty')}</div>}
                {archiveConversations.map((conversation) => (
                  <div key={conversation.conversation_id} className={`archive-thread-row ${archiveSelectedId === conversation.conversation_id ? 'active' : ''}`}>
                    <button type="button" className="thread-item" onClick={() => setArchiveSelectedId(conversation.conversation_id)}>
                      <span className="thread-title">{conversation.participant_a} ↔ {conversation.participant_b}</span>
                      <span className="thread-stats">{conversation.message_count} {t('messagesShort')} · 📎 {conversation.file_count || 0} · {t('deletedShort')} {conversation.deleted_count || 0}</span>
                      {Number(conversation.legal_hold_count) > 0 && <span className="legal-hold-badge">🔒 Legal hold · {conversation.legal_hold_count}</span>}
                      <span className="thread-last">{conversation.last_message_at ? new Date(conversation.last_message_at).toLocaleString(interfaceLocale) : '—'}</span>
                    </button>
                    <button
                      type="button"
                      className={conversation.state === 'archived' ? 'archive-restore-button' : 'archive-store-button'}
                      onClick={() => setConversationArchiveState(conversation.conversation_id, conversation.state === 'archived' ? 'active' : 'archived')}
                    >
                      {conversation.state === 'archived' ? t('restoreConversation') : t('archiveConversation')}
                    </button>
                  </div>
                ))}
              </div>
              <div className="threads-messages archive-message-viewer">
                {!archiveSelectedId && <div className="empty-chat">{t('archiveChoose')}</div>}
                {archiveSelectedId && (
                  <form className="legal-hold-form" onSubmit={createLegalHold}>
                    <strong>{t('legalHoldTitle')}</strong>
                    <small>{archiveSelectedId}</small>
                    <input
                      type="text"
                      placeholder={t('legalHoldName')}
                      value={legalHoldForm.name}
                      onChange={(event) => setLegalHoldForm((current) => ({ ...current, name: event.target.value }))}
                      maxLength={255}
                      required
                    />
                    <textarea
                      rows={3}
                      placeholder={t('legalHoldReason')}
                      value={legalHoldForm.reason}
                      onChange={(event) => setLegalHoldForm((current) => ({ ...current, reason: event.target.value }))}
                      maxLength={4000}
                      required
                    />
                    <label>{t('legalHoldEnd')}<input type="date" value={legalHoldForm.endsAt} onChange={(event) => setLegalHoldForm((current) => ({ ...current, endsAt: event.target.value }))} /></label>
                    <button type="submit" disabled={legalHoldLoading}>{t('legalHoldCreate')}</button>
                  </form>
                )}
                {archiveSelectedId && (
                  <section className="purge-panel">
                    <div className="purge-panel-heading">
                      <div>
                        <strong>{t('purgeTitle')}</strong>
                        <small>{t('purgeHint')}</small>
                      </div>
                      <button type="button" disabled={purgeLoading} onClick={() => fetchConversationPurgePreview(archiveSelectedId)}>{t('purgeRefresh')}</button>
                    </div>
                    {purgeLoading && !purgePreview && <small>{t('loading')}…</small>}
                    {purgePreview && (
                      <>
                        <div className="purge-metrics">
                          <span><b>{purgePreview.counts?.messages || 0}</b>{t('purgeMessages')}</span>
                          <span><b>{purgePreview.counts?.messageVersions || 0}</b>{t('purgeVersions')}</span>
                          <span><b>{purgePreview.counts?.files || 0}</b>{t('purgeFiles')} · {formatFileSize(purgePreview.counts?.fileBytes)}</span>
                          <span><b>{purgePreview.counts?.exclusiveFiles || 0}</b>{t('purgeExclusiveFiles')} · {formatFileSize(purgePreview.counts?.exclusiveFileBytes)}</span>
                          <span><b>{purgePreview.counts?.sharedFiles || 0}</b>{t('purgeSharedFiles')}</span>
                        </div>
                        <div className={`purge-backup-status ${purgePreview.backupReady ? 'ready' : 'blocked'}`}>
                          <strong>
                            {purgePreview.backupReady
                              ? `✓ ${t('purgeBackupReady')}`
                              : !purgePreview.backup
                                ? t('purgeBackupMissing')
                                : !purgePreview.backup.complete
                                  ? t('purgeBackupIncomplete')
                                  : !purgePreview.backup.downloadedAt
                                    ? t('purgeBackupNotDownloaded')
                                    : t('purgeBackupCorrupt')}
                          </strong>
                          {purgePreview.backup && <small>{purgePreview.backup.name} · {purgePreview.backup.id}</small>}
                          {purgePreview.backup?.packageSha256 && <code>SHA-256: {purgePreview.backup.packageSha256}</code>}
                        </div>
                        {purgePreview.legalHolds?.length > 0 && (
                          <div className="purge-hold-block">
                            <strong>🔒 {t('purgeLegalHoldBlocked')}</strong>
                            {purgePreview.legalHolds.map((hold) => <small key={hold.id}>{hold.name}: {hold.reason}</small>)}
                          </div>
                        )}
                        <textarea
                          rows={3}
                          placeholder={t('purgeReason')}
                          value={purgeReason}
                          onChange={(event) => setPurgeReason(event.target.value)}
                          maxLength={4000}
                        />
                        <button
                          type="button"
                          className="purge-action-button"
                          disabled={!purgePreview.canPurge || !purgeReason.trim() || purgeLoading}
                          onClick={permanentlyDeleteConversation}
                        >
                          {t('purgeAction')}
                        </button>
                      </>
                    )}
                  </section>
                )}
                {archiveSelectedId && archiveHasMore && (
                  <button type="button" className="chat-pagination-button" disabled={archiveLoading} onClick={() => fetchArchiveMessages(archiveSelectedId, { append: true })}>{t('loadPreviousMessages')}</button>
                )}
                {archiveSelectedId && archiveMessages.map((message) => {
                  const attachments = getMessageAttachments(message);
                  return (
                    <article key={message.id} className={`audit-message ${message.deletedAt ? 'deleted' : ''}`}>
                      <div className="message-meta"><span>{message.sender}</span><span>{new Date(message.createdAt).toLocaleString(interfaceLocale)}</span></div>
                      {message.deletedAt && <em>{t('deletedMessage')} · {message.deletedBy || '—'}</em>}
                      {message.text && <div className="archive-original-text">{message.deletedAt && <strong>{t('savedOriginal')}: </strong>}{message.text}</div>}
                      {attachments.length > 0 && <div className="message-attachments-grid">{attachments.map((file, index) => <AttachmentCard key={`${message.id}-archive-${index}`} cardKey={`${message.id}-archive-${index}`} file={file} isEnglish={isEnglishInterface} />)}</div>}
                    </article>
                  );
                })}
              </div>
            </div>
          </section>);
}
