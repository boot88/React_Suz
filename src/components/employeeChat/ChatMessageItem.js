import React, { memo } from 'react';
import { createPortal } from 'react-dom';

const ChatMessageItem = memo(function ChatMessageItem({ item, messageListRef, AttachmentCard, AuthenticatedAvatar, REACTION_EMOJIS, activeDialogSearchResult, chatLocalSettings, copyMessageText, createRequestFromMessage, currentConversationId, deleteMessage, employeeByLogin, extractLinks, formatFeedLogin, getEmployeeAvatar, getLinkPreview, getMessageAttachments, highlightText, inlineEditMessageId, inlineEditText, interfaceLocale, isEnglishInterface, isManager, isMessageRead, isVideoAttachment, messageReactionExpanded, multiSelectMode, openAttachmentInNewTab, openChatMediaViewer, openEmployeeProfile, openForwardMessagePicker, openSelectedMessageMenu, profileForm, retryMessageSend, saveInlineEditMessage, selectedMessageId, selectedMessageIds, selectedMessageMenuPlacement, selectedMessageMenuStyle, setInlineEditMessageId, setInlineEditText, setMessageReactionExpanded, setMultiSelectMode, setReplyTo, setSelectedMessageId, startInlineEditMessage, t, threadSummaries, togglePinned, toggleReaction, toggleSelectedMessage, user }) {
                    if (item.type === 'date') return <div key={item.id} className="date-separator"><span>{item.label}</span></div>;

                    const message = item.message;
                    const canEdit = isManager || message.sender === user.username;
                    const isMine = message.sender === user.username;
                    const isDeleted = Boolean(message.deletedAt);
                    const attachments = !isDeleted && message.attachments?.length ? message.attachments : !isDeleted && message.attachment ? [message.attachment] : [];
                    const hasTextContent = !isDeleted && String(message.text || '').trim() && message.text !== '📎 Вложения';
                    const photoMetaLabel = new Date(message.createdAt).toLocaleTimeString(interfaceLocale, { hour: '2-digit', minute: '2-digit' });
                    const statusLabel = isMine ? (isMessageRead(message, threadSummaries[currentConversationId]?.peerRead) ? '✓✓' : '✓') : '';
                    const photoStatusLabel = isMine ? (message.deliveryStatus === 'error' ? '!' : message.deliveryStatus === 'waiting' ? '◷' : statusLabel) : '';
                    const messageTimeLabel = new Date(message.createdAt).toLocaleTimeString(interfaceLocale, { hour: '2-digit', minute: '2-digit' });
                    const deliveryLabel = message.deliveryStatus === 'sending' ? t('deliverySending') : message.deliveryStatus === 'waiting' ? t('deliveryWaiting') : message.deliveryStatus === 'error' ? t('deliveryError') : statusLabel;
                    const isPhotoCollage = attachments.length > 1 && attachments.every((file) => String(file?.type || '').startsWith('image/'));
                    const isMediaOnly = attachments.length > 0
                      && !hasTextContent
                      && !message.replyTo
                      && !message.forwardedFrom
                      && attachments.every((file) => String(file?.type || '').startsWith('image/') || isVideoAttachment(file));

                    const isSelected = selectedMessageId === message.id;
                    const visibleReactions = messageReactionExpanded ? REACTION_EMOJIS : REACTION_EMOJIS.slice(0, 7);
                    const messageReactionBadges = REACTION_EMOJIS.filter((emoji) => (message.reactions?.[emoji] || []).length > 0);
                    const linkPreviews = extractLinks(message.text).map(getLinkPreview).filter(Boolean);
                    const messageSenderLogin = formatFeedLogin(message.sender);
                    const messageSenderProfile = employeeByLogin.get(messageSenderLogin.toLowerCase()) || {};
                    const messageSenderName = isMine
                      ? (profileForm.full_name || user?.name || user.username)
                      : (messageSenderProfile.full_name || message.sender);
                    const messageSenderAvatar = getEmployeeAvatar(messageSenderLogin, message.avatar, message.senderAvatar, message.senderPhoto, messageSenderProfile.avatar);

                    return (
                      <div key={message.id} data-message-id={message.id} className={`message-row ${isMine ? 'mine' : ''} ${isSelected ? 'selected' : ''} ${selectedMessageIds.includes(message.id) ? 'multi-selected' : ''} ${activeDialogSearchResult?.id === message.id ? 'search-current' : ''}`}>
                        {isMine && ['waiting', 'error'].includes(message.deliveryStatus) && <div className="message-send-recovery" role="status">
                          <span>{message.deliveryStatus === 'error' ? (isEnglishInterface ? 'Not sent' : 'Не отправлено') : t('deliveryWaiting')}</span>
                          <button type="button" onClick={() => retryMessageSend(message)}>{t('retrySend')}</button>
                          <button type="button" onClick={() => startInlineEditMessage(message)}>{t('edit')}</button>
                        </div>}
                        <button type="button" className="message-menu-trigger" aria-label={t('dialogActions')} onClick={event => openSelectedMessageMenu(message.id, event)}>⋯</button>
                        <div
                          role="button"
                          tabIndex={0}
                          className={`message-bubble ${isMediaOnly ? 'media-only' : ''}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (isDeleted || window.getSelection()?.toString() || event.target.closest('a, button, input, textarea, video')) return;
                            if (chatLocalSettings.uiDesign === 'modern' && !multiSelectMode) return;
                            if (multiSelectMode) { toggleSelectedMessage(message.id); return; }
                            if (isSelected && messageReactionExpanded) setMessageReactionExpanded(false);
                            else {
                              openSelectedMessageMenu(message.id, event);
                            }
                          }}
	                          onDoubleClick={(event) => { if (chatLocalSettings.uiDesign === 'modern') return; event.preventDefault(); event.stopPropagation(); if (!isDeleted) toggleReaction(message.id, '👍'); }}
	                          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (!isDeleted) openSelectedMessageMenu(message.id, event); }}
	                          onTouchStart={(event) => { event.currentTarget.dataset.touchX = String(event.touches[0]?.clientX || 0); }}
	                          onTouchEnd={(event) => {
	                            const startX = Number(event.currentTarget.dataset.touchX || 0);
	                            const endX = event.changedTouches[0]?.clientX || startX;
	                            const deltaX = endX - startX;
	                            if (chatLocalSettings.uiDesign === 'modern' || isDeleted || Math.abs(deltaX) < 70) return;
	                            event.stopPropagation();
	                            if (deltaX > 0) setReplyTo(message);
	                            else openForwardMessagePicker(message);
	                          }}
	                          onKeyDown={(event) => {
                            if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                            event.preventDefault();
                            event.stopPropagation();
                            if (!isDeleted) openSelectedMessageMenu(message.id, event);
                          }}
                        >
                          {!isDeleted && messageSenderLogin && (
                            <button type="button" className="message-author-link" onClick={(event) => openEmployeeProfile(messageSenderLogin, event)}>
                              <span className="feed-avatar comment-avatar"><AuthenticatedAvatar src={messageSenderAvatar} alt={messageSenderName} fallback={<span>{String(messageSenderName || messageSenderLogin || '?').slice(0, 1).toUpperCase()}</span>} /></span>
                              <span>{messageSenderName}</span>
                            </button>
                          )}
	                          {!isDeleted && message.forwardedFrom && <div className="forwarded-preview">{t('forwardedFrom')} {message.forwardedFrom}</div>}
	                          {!isDeleted && message.replyTo && <button type="button" className="reply-preview reply-jump" onClick={(event) => { event.stopPropagation(); messageListRef.current?.scrollToId(message.replyTo.id); }}>↪ {message.replyTo.sender}: {message.replyTo.text || t('originalMessageDeleted')}</button>}
	                          {isDeleted ? (
	                            <div className="message-deleted">{t('deletedMessage')} {message.deletedBy ? `· ${message.deletedBy}` : ''}</div>
	                          ) : hasTextContent ? (
	                            inlineEditMessageId === message.id ? <div className="inline-message-editor"><textarea value={inlineEditText} onChange={(e) => setInlineEditText(e.target.value)} /><button type="button" onClick={() => saveInlineEditMessage(message)}>{t('saveActionButton')}</button><button type="button" onClick={() => setInlineEditMessageId('')}>{t('cancel')}</button></div> : <div className="message-text">{highlightText(message.text)}</div>
                          ) : null}

                          {linkPreviews.length > 0 && !isDeleted && (
                            <div className="link-preview-list">
	                              {linkPreviews.map((preview) => (
	                                <a key={preview.url} className="link-preview-card" href={preview.url} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
	                                  <span className="link-preview-icon" aria-hidden="true">↗</span>
	                                  <span><strong>{preview.title}</strong><small>{preview.description}</small><em>{preview.domain}</em></span>
	                                  <b>{t('openAttachment')}</b>
	                                </a>
                              ))}
                            </div>
                          )}

                          {attachments.length > 0 && (
                            <div className={`message-attachments-grid ${isPhotoCollage ? 'photo-collage' : ''}`}>
                              {attachments.map((file, index) => (
                                <AttachmentCard
                                  key={`${message.id}-file-${index}`}
                                  cardKey={`${message.id}-file-${index}`}
                                  file={file}
                                  metaLabel={photoMetaLabel}
                                  statusLabel={photoStatusLabel}
                                  onSelect={(event) => {
                                    openSelectedMessageMenu(message.id, event);
                                  }}
	                                  onOpen={() => openChatMediaViewer(message, file, index)}
	                                  onQuickReaction={() => toggleReaction(message.id, '❤️')}
	                                  isEnglish={isEnglishInterface}
	                                />
                              ))}
                            </div>
                          )}

                          {!isDeleted && messageReactionBadges.length > 0 && (
	                            <div className="message-reactions-inline" aria-label={t('emoji')}>
                              {messageReactionBadges.map((emoji) => {
                                const active = (message.reactions?.[emoji] || []).includes(user.username);
                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    className={active ? 'active' : ''}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      toggleReaction(message.id, emoji);
                                    }}
                                    title={(message.reactions?.[emoji] || []).join(', ')}
                                  >
                                    {emoji}
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {!isMediaOnly && (
                            <small className="read-state message-status-line">
	                              {message.editedAt && !isDeleted ? <span>{t('changed')}</span> : null}
                              <span>{messageTimeLabel}</span>
                              {isMine && deliveryLabel && <span className={`message-checks ${['sending', 'waiting', 'error'].includes(message.deliveryStatus) ? 'textual' : ''}`}>{deliveryLabel}</span>}
                            </small>
                          )}
                        </div>

                        {isSelected && !isDeleted && typeof document !== 'undefined' && createPortal((
                          <div className={`selected-message-menu message-action-popover floating theme-${chatLocalSettings.uiTheme || 'light'} ${isMine ? 'mine' : ''} ${selectedMessageMenuPlacement === 'below' ? 'open-below' : ''}`} style={selectedMessageMenuStyle} onClick={(event) => event.stopPropagation()}>
                            <div className="selected-reaction-row compact-reaction-row">
                              {visibleReactions.map((emoji) => {
                                const active = (message.reactions?.[emoji] || []).includes(user.username);
                                return <button key={emoji} type="button" className={active ? 'active' : ''} onClick={() => { toggleReaction(message.id, emoji); setSelectedMessageId(''); setMessageReactionExpanded(false); }}>{emoji}</button>;
                              })}
                              {!messageReactionExpanded && <button type="button" className="more-reactions" onClick={() => setMessageReactionExpanded(true)}>⌄</button>}
                            </div>

                            {!messageReactionExpanded && (
                              <>
                                <div className="message-action-grid primary-actions compact-message-actions">
                                  <button type="button" onClick={() => { setReplyTo(message); setSelectedMessageId(''); }}><span className="message-action-icon">↩</span>{t('reply')}</button>
                                  <button type="button" onClick={() => { copyMessageText(message); setSelectedMessageId(''); }}><span className="message-action-icon">⧉</span>{t('copy')}</button>
                                  <button type="button" onClick={() => openForwardMessagePicker(message)}><span className="message-action-icon">↷</span>{t('forward')}</button>
                                  <button type="button" onClick={() => { togglePinned(message.id); setSelectedMessageId(''); }}><span className="message-action-icon">⌖</span>{message.pinned ? t('unpin') : t('pin')}</button>
                                  {canEdit && <button type="button" className="danger-action" onClick={() => { deleteMessage(message.id); setSelectedMessageId(''); }}><span className="message-action-icon">×</span>{t('delete')}</button>}
                                </div>
                                {chatLocalSettings.showExtraMessageActions === true && (
                                  <>
                                    <div className="message-action-grid secondary-actions">
                                      {canEdit && <button type="button" onClick={() => startInlineEditMessage(message)}>{t('edit')}</button>}
                                      <button type="button" onClick={() => { setMultiSelectMode(true); toggleSelectedMessage(message.id); setSelectedMessageId(''); }}>{t('selectMultiple')}</button>
                                      <button type="button" onClick={() => createRequestFromMessage(message)}>{t('createRequest')}</button>
                                      <button type="button" onClick={() => getMessageAttachments(message).forEach(openAttachmentInNewTab)}>{t('downloadAttachments')}</button>
                                    </div>
                                    <div className="message-action-grid danger-actions">
	                                      {isMine && ['waiting', 'error'].includes(message.deliveryStatus) && <button type="button" onClick={() => retryMessageSend(message)}>{t('retrySend')}</button>}
                                    </div>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        ), document.body)}
                      </div>
                    );
                  });
export default ChatMessageItem;
