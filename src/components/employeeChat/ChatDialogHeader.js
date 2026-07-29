import React, { memo } from 'react';

const ChatDialogHeader = memo(function ChatDialogHeader({
  t,
  contactName,
  visibleLogin,
  search,
  hasSearch,
  searchIndex,
  searchCount,
  showMediaPanel,
  showConversationMenu,
  conversationMenuOpen,
  onSearch,
  onPreviousResult,
  onNextResult,
  onToggleMediaPanel,
  onToggleMenu,
  onArchive,
  onHide,
  onPin,
  onMarkUnread,
  onMute,
  onClearDraft,
  onDeleteConversation
}) {
  return (
    <header className="conversation-header">
      <div>
        <span className="eyebrow">{t('dialog')}</span>
        <h2>{contactName}</h2>
        <p>{visibleLogin}</p>
      </div>
      <div className="conversation-tools">
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={t('dialogSearch')} />
        {hasSearch && <span className="dialog-search-count">{searchCount ? searchIndex + 1 : 0} {t('of')} {searchCount}</span>}
        <button type="button" disabled={!searchCount} onClick={onPreviousResult}>↑</button>
        <button type="button" disabled={!searchCount} onClick={onNextResult}>↓</button>
        {showMediaPanel && <button type="button" onClick={onToggleMediaPanel}>{t('mediaFiles')}</button>}
        {showConversationMenu && (
          <details className="conversation-menu" open={conversationMenuOpen} onClick={(event) => event.stopPropagation()}>
            <summary
              aria-label={t('dialogActions')}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleMenu();
              }}
            >
              ⋯
            </summary>
            <div className="conversation-menu-popover">
              <button type="button" onClick={onArchive}>{t('archiveDialog')}</button>
              <button type="button" onClick={onHide}>{t('hideDialog')}</button>
              <button type="button" onClick={onPin}>{t('pinDialogAction')}</button>
              <button type="button" onClick={onMarkUnread}>{t('markUnread')}</button>
              <button type="button" onClick={onMute}>{t('muteNotifications')}</button>
              <button type="button" onClick={onClearDraft}>{t('clearDraft')}</button>
              <button type="button" className="danger-action" onClick={onDeleteConversation}>{t('deleteConversation')}</button>
            </div>
          </details>
        )}
      </div>
    </header>
  );
});

export default ChatDialogHeader;
