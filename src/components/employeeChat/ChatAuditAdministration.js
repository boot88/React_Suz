import React from 'react';

export default function ChatAuditAdministration({ AUDIT_PERIODS, AttachmentCard, allConversationIds, auditFilters, auditSearch, deleteMessage, editMessage, getMessageAttachments, getOptionLabel, getParticipantsFromThreadId, getThreadActivityMeta, interfaceLocale, isAdmin, isEnglishInterface, loadingConversationIds, selectedThreadId, selectedThreadMessages, setAuditFilters, setAuditSearch, setSelectedThreadId, t, threadActivityById, threads }) {
  return (<section className="manager-panel">
            <h2>{t('employeeMessages')}</h2>
            <div className="audit-toolbar">
              <input type="search" placeholder={t('auditSearch')} value={auditSearch} onChange={(e) => setAuditSearch(e.target.value)} />
              <div className="audit-filter-row">
                <label><input type="checkbox" checked={auditFilters.showEmpty} onChange={(e) => setAuditFilters((prev) => ({ ...prev, showEmpty: e.target.checked }))} />{t('showEmptyArchived')}</label>
                <label><input type="checkbox" checked={auditFilters.attachmentsOnly} onChange={(e) => setAuditFilters((prev) => ({ ...prev, attachmentsOnly: e.target.checked }))} />{t('attachmentsOnly')}</label>
                <label><input type="checkbox" checked={auditFilters.deletedOnly} onChange={(e) => setAuditFilters((prev) => ({ ...prev, deletedOnly: e.target.checked }))} />{t('deletedOnly')}</label>
              </div>
              <div className="audit-periods">
                {AUDIT_PERIODS.map((period) => <button key={period.id} type="button" className={auditFilters.period === period.id ? 'active' : ''} onClick={() => setAuditFilters((prev) => ({ ...prev, period: period.id }))}>{getOptionLabel(period)}</button>)}
              </div>
            </div>
            <div className="threads-grid">
              <div className="threads-list">
                {allConversationIds.length === 0 && <div className="empty-chat">{t('noAuditDialogs')}</div>}
                {allConversationIds.map((threadId) => {
                  const participants = getParticipantsFromThreadId(threadId);
                  const meta = threadActivityById[threadId] || getThreadActivityMeta(threads[threadId] || []);
                  return (
                    <button key={threadId} type="button" className={`thread-item ${selectedThreadId === threadId ? 'active' : ''}`} onClick={() => setSelectedThreadId(threadId)}>
                      <span className="thread-title">{participants.join(' ↔ ')}</span>
                      <span className="thread-stats"><b>{meta.messageCount}</b> {t('messagesShort')} {meta.attachmentsCount > 0 ? ` · 📎 ${meta.attachmentsCount}` : ''}{meta.deletedCount > 0 ? ` · ${t('deletedShort')} ${meta.deletedCount}` : ''}</span>
                      <span className="thread-last">{meta.lastAt ? `${t('lastMessage')}: ${new Date(meta.lastAt).toLocaleString(interfaceLocale)}` : t('noMessagesShort')}</span>
                    </button>
                  );
                })}
              </div>
              <div className="threads-messages">
                {!selectedThreadId && <div className="empty-chat">{t('chooseConversation')}</div>}
                {selectedThreadId && loadingConversationIds[selectedThreadId] && <div className="empty-chat">{t('loading')}…</div>}
                {selectedThreadId && !loadingConversationIds[selectedThreadId] && selectedThreadMessages.map((message) => {
                  const isDeleted = Boolean(message.deletedAt);
                  const attachments = isDeleted && !isAdmin ? [] : getMessageAttachments(message);
                  const retainedText = isDeleted && isAdmin ? String(message.text || '').trim() : '';
                  return (
                    <div key={message.id} className={`audit-message ${isDeleted ? 'deleted' : ''}`}>
                      <div className="message-meta"><span>{message.sender}</span><span>{new Date(message.createdAt).toLocaleString(interfaceLocale)}</span></div>
                      <div>{isDeleted ? <em>{t('deletedMessage')}</em> : message.text}</div>
                      {isDeleted && <div className="audit-history">{t('deletedBy')}: {message.deletedBy || '—'} · {message.deletedAt ? new Date(message.deletedAt).toLocaleString(interfaceLocale) : '—'}</div>}
                      {isDeleted && isAdmin && (retainedText || attachments.length > 0) && (
                        <div className="audit-retained-original">
                          <strong>{t('savedOriginal')}:</strong>
                          {retainedText && <div>{retainedText}</div>}
                        </div>
                      )}
                      {attachments.length > 0 && <div className="message-attachments-grid">{attachments.map((file, index) => <AttachmentCard key={`${message.id}-audit-${index}`} cardKey={`${message.id}-audit-${index}`} file={file} isEnglish={isEnglishInterface} />)}</div>}
                      {Array.isArray(message.audit) && message.audit.length > 0 && <div className="audit-history"><strong>{t('history')}:</strong>{message.audit.slice(-4).map((entry, index) => <span key={`${message.id}-audit-entry-${index}`}>{entry.action || t('change')} · {entry.by || '—'} · {entry.at ? new Date(entry.at).toLocaleString(interfaceLocale) : '—'}</span>)}</div>}
                      {!isDeleted && <div className="message-controls"><button type="button" onClick={() => editMessage(message.id, selectedThreadId)}>{t('edit')}</button><button type="button" onClick={() => deleteMessage(message.id, selectedThreadId)}>{t('delete')}</button></div>}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>);
}
