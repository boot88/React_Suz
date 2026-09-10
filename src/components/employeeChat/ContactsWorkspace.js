import React, { memo, useMemo, useState } from 'react';
import ChatContacts from './ChatContacts';

const normalizeText = (value) => String(value || '').trim().toLowerCase();
const hasAttachments = (message = {}) => (
  Boolean(message.attachment) || (Array.isArray(message.attachments) && message.attachments.length > 0)
);

const ContactsWorkspace = memo(function ContactsWorkspace({
  modern = false, hiddenDialogs = [], archivedDialogs = [], mutedDialogs = [], onRestoreHidden, onRestoreArchived,
  employees,
  selectedEmail,
  currentLogin,
  managerLogin,
  isManager,
  unreadByEmail,
  favorites,
  pinnedDialogs,
  threadSummaries,
  threads,
  applications,
  department,
  filters,
  getFilterLabel,
  getConversationId,
  formatVisibleLogin,
  t,
  onSelect,
  onOpenProfile,
  onTogglePinned,
  onToggleFavorite
}) {
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const favoriteSet = useMemo(() => new Set(favorites || []), [favorites]);

  const visibleEmployees = useMemo(() => {
    const query = normalizeText(search);
    return employees.filter((employee) => {
      const conversationId = getConversationId(currentLogin, employee.email);
      const summary = threadSummaries[conversationId];
      const messages = threads[conversationId]?.length
        ? threads[conversationId]
        : summary?.lastMessage ? [summary.lastMessage] : [];
      const profile = employee.profile || {};
      if (filter === 'hidden' && !hiddenDialogs.includes(conversationId)) return false;
      if (filter === 'archived' && !archivedDialogs.includes(conversationId)) return false;
      if (!['hidden', 'archived'].includes(filter) && (hiddenDialogs.includes(conversationId) || archivedDialogs.includes(conversationId))) return false;
      if (modern && !directoryOpen && !query && !['hidden', 'archived'].includes(filter) && !summary && !messages.length && !pinnedDialogs?.includes(conversationId)) return false;
      if (filter === 'online' && !employee.isOnline) return false;
      if (filter === 'unread' && !unreadByEmail[employee.email]) return false;
      if (filter === 'managers' && !['manager', 'admin'].includes(String(employee.role || '').toLowerCase())) return false;
      if (filter === 'department' && profile.department && profile.department !== department) return false;
      if (filter === 'favorites' && !favoriteSet.has(employee.email)) return false;
      if (filter === 'attachments' && !(summary?.attachmentsCount > 0 || messages.some(hasAttachments))) return false;
      if (filter === 'tickets' && !applications.some((ticket) => ticket.chat_thread_id === conversationId)) return false;
      if (filter === 'recent' && !summary && messages.length === 0) return false;
      if (!query) return true;
      return [
        employee.email,
        employee.role,
        profile.full_name,
        profile.department,
        profile.position,
        profile.phone,
        profile.room,
        profile.cabinet,
        profile.N_tel
      ].some((value) => normalizeText(value).includes(query));
    }).sort((left, right) => {
      const leftId = getConversationId(currentLogin, left.email);
      const rightId = getConversationId(currentLogin, right.email);
      const pinnedDifference = Number(pinnedDialogs?.includes(rightId)) - Number(pinnedDialogs?.includes(leftId));
      if (pinnedDifference && !directoryOpen) return pinnedDifference;
      if (modern && !directoryOpen) {
        const difference = (threadSummaries[rightId]?.lastTimestamp || 0) - (threadSummaries[leftId]?.lastTimestamp || 0);
        if (difference) return difference;
      }
      return (left.profile?.full_name || left.email).localeCompare(right.profile?.full_name || right.email, 'ru', { sensitivity: 'base' });
    });
  }, [
    modern, directoryOpen, hiddenDialogs, archivedDialogs, pinnedDialogs,
    applications,
    currentLogin,
    department,
    employees,
    favoriteSet,
    filter,
    getConversationId,
    search,
    threadSummaries,
    threads,
    unreadByEmail
  ]);

  return (
    <div className="employee-contact-panel">
      <div className="contacts-heading"><label className="field-label">{modern && !directoryOpen ? (t('contacts') === 'Контакты' ? 'Диалоги' : 'Conversations') : t('contacts')}</label>
      {modern && <button type="button" onClick={() => { setDirectoryOpen(value => !value); setFilter('all'); }}>{directoryOpen ? (t('contacts') === 'Контакты' ? 'К диалогам' : 'Conversations') : (t('contacts') === 'Контакты' ? '+ Новый диалог' : '+ New chat')}</button>}</div>
      <input
        className="employee-chat-search"
        placeholder={t('contactSearch')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <label className="contact-filter-select">
        <span>{t('filter')}</span>
        <select value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="archived">{t('contacts') === 'Контакты' ? 'Архивированные' : 'Archived'}</option>
          <option value="hidden">{t('contacts') === 'Контакты' ? 'Скрытые' : 'Hidden'}</option>
          {filters.map((item) => (
            <option key={item.id} value={item.id}>{getFilterLabel(item)}</option>
          ))}
        </select>
      </label>
      <div className={`employee-chat-list ${isManager ? 'manager-mode' : ''}`}>
        <ChatContacts
          modern={modern}
          resetKey={`${search}:${filter}:${directoryOpen}`}
          summaries={threadSummaries}
          mutedDialogs={mutedDialogs}
          onRestore={filter === 'hidden' ? onRestoreHidden : filter === 'archived' ? onRestoreArchived : null}
          employees={visibleEmployees}
          selectedEmail={selectedEmail}
          currentLogin={currentLogin}
          managerLogin={managerLogin}
          isManager={isManager}
          unreadByEmail={unreadByEmail}
          favorites={favorites}
          pinnedDialogs={pinnedDialogs}
          getConversationId={getConversationId}
          formatVisibleLogin={formatVisibleLogin}
          t={t}
          onSelect={onSelect}
          onOpenProfile={onOpenProfile}
          onTogglePinned={onTogglePinned}
          onToggleFavorite={onToggleFavorite}
        />
      </div>
    </div>
  );
});

export default ContactsWorkspace;
