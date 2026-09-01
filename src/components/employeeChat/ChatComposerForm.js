import React, { memo } from 'react';

const ChatComposerForm = memo(function ChatComposerForm({
  t,
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
  onAttachmentChange
}) {
  return (
    <form className="message-form" onSubmit={onSubmit}>
      <div className="composer-textarea-box">
        <div className="composer-input-shell">
          <button type="button" className="composer-emoji-btn" aria-label={t('emoji')} onClick={onToggleEmoji}>☺</button>
          {isEmojiOpen && (
            <div className="emoji-picker composer-emoji-picker">
              {emojiOptions.map((emoji) => (
                <button key={emoji} type="button" onClick={() => onAppendEmoji(emoji)}>{emoji}</button>
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
      <label className="attach-file-btn" aria-label={t('attachFiles')} title={t('attachFiles')}>
        📎
        <input
          type="file"
          hidden
          multiple
          accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar,.7z"
          onChange={onAttachmentChange}
        />
      </label>
      <button type="submit" disabled={isSending}>{isSending ? t('sending') : isOnline ? t('send') : t('queue')}</button>
    </form>
  );
});

export default ChatComposerForm;
