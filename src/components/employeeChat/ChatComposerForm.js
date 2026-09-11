import React, { memo, useEffect, useRef } from 'react';
import ChatIcon from './ChatIcon';

const ChatComposerForm = memo(function ChatComposerForm({
  t,
  modern = false,
  draft,
  textareaRef,
  emojiOptions,
  isEmojiOpen,
  enterToSend,
  isSending,
  isOnline,
  onSubmit,
  onDraftChange,
  onKeyDown,
  onPaste,
  onToggleEmoji,
  onAppendEmoji,
  onToggleEnterToSend,
  onAttachmentChange,
  hasAttachments = false
}) {
  const emojiRef = useRef(null);
  const toggleEmojiRef = useRef(onToggleEmoji);
  toggleEmojiRef.current = onToggleEmoji;
  useEffect(() => {
    if (!modern || !isEmojiOpen) return undefined;
    const closeOutside = event => {
      if (!emojiRef.current?.contains(event.target) && !event.target.closest('.composer-emoji-btn')) toggleEmojiRef.current();
    };
    const closeOnEscape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      toggleEmojiRef.current();
      textareaRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [modern, isEmojiOpen, textareaRef]);
  return (
    <form className="message-form" onSubmit={onSubmit}>
      <div className="composer-textarea-box">
        <div className="composer-input-shell">
          <button type="button" className="composer-emoji-btn" aria-label={t('emoji')} aria-expanded={isEmojiOpen} onClick={onToggleEmoji}>{modern ? <ChatIcon name="smile" size={21} /> : '☺'}</button>
          {isEmojiOpen && (
            <div ref={emojiRef} className="emoji-picker composer-emoji-picker" role="group" aria-label={t('emoji')}>
              {emojiOptions.map((emoji) => (
                <button key={emoji} type="button" aria-label={emoji} onClick={() => { onAppendEmoji(emoji); textareaRef.current?.focus({ preventScroll: true }); }}>{emoji}</button>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            placeholder={t('messagePlaceholder')}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            maxLength={2000}
            rows={1}
          />
        </div>
        <div className="composer-hints">
          <label>
            <input type="checkbox" checked={enterToSend} onChange={onToggleEnterToSend} /> {t('enterSends')}
          </label>
          {draft.length > 1600 && <span className={draft.length > 1900 ? 'limit-warning' : ''}>{draft.length}/2000</span>}
          <span>{t('composerHint')}</span>
        </div>
      </div>
      <label role="button" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.querySelector('input').click(); } }} className="attach-file-btn" aria-label={t('attachFiles')} title={t('attachFiles')}>
        📎
        <input
          type="file"
          hidden
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar,.7z"
          onChange={onAttachmentChange}
        />
      </label>
      <button type="submit" disabled={isSending || (!draft.trim() && !hasAttachments)}>{isSending ? t('sending') : isOnline ? t('send') : t('queue')}</button>
    </form>
  );
});

export default ChatComposerForm;
