import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ChatIcon from './ChatIcon';

export default function ModernMediaViewer({ file, files, index, author, date, theme, isEnglish, t, isVideoAttachment, getOriginalAttachmentUrl, getAttachmentUrl, getVideoPosterUrl, VideoPosterFrame, onClose, onMove, onSelect, onReply, onShare, onDelete, deletePending }) {
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const menuButtonRef = useRef(null);
  const touchRef = useRef(null);
  const actionsRef = useRef({ onClose, onMove });
  actionsRef.current = { onClose, onMove };
  const [menuOpen, setMenuOpen] = useState(false);
  const [loadedUrl, setLoadedUrl] = useState('');
  const [failedUrl, setFailedUrl] = useState('');
  const url = getOriginalAttachmentUrl(file);
  const isVideo = isVideoAttachment(file);
  const many = files.length > 1;

  useEffect(() => {
    const trigger = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    rootRef.current?.querySelector('button')?.focus({ preventScroll: true });
    const onKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (menuRef.current) {
          setMenuOpen(false);
          menuButtonRef.current?.focus();
        } else actionsRef.current.onClose();
        return;
      }
      // Native video controls own arrow keys for seeking and volume.
      if (!event.target.closest('video, input, textarea') && !menuRef.current && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        actionsRef.current.onMove(event.key === 'ArrowLeft' ? -1 : 1);
      }
      if (event.key === 'Tab') {
        const controls = [...rootRef.current.querySelectorAll('button:not(:disabled), a[href], video[controls]')];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
      if (trigger?.isConnected) trigger.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    const strip = rootRef.current?.querySelector('.modern-viewer-thumbs');
    const active = strip?.querySelector('[aria-current="true"]');
    if (active) strip.scrollLeft = active.offsetLeft - (strip.clientWidth - active.clientWidth) / 2;
  }, [url, index]);

  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector('button, a')?.focus();
  }, [menuOpen]);

  const chooseAction = action => { setMenuOpen(false); action(); };
  return createPortal(
    <div ref={rootRef} className={`modern-media-viewer modern-chat-surface theme-${theme || 'light'}`} role="dialog" aria-modal="true" aria-label={file.name || t('media')} onPointerDown={event => {
      if (!event.target.closest('.modern-viewer-menu, .modern-viewer-menu-trigger')) setMenuOpen(false);
    }}>
      <header className="modern-viewer-header">
        <button type="button" className="modern-icon-button" title={t('back')} aria-label={t('back')} onClick={onClose}><ChatIcon name="close" size={22} /></button>
        <div className="modern-viewer-file"><strong title={file.name}>{file.name || (isVideo ? t('media') : t('photoAlt'))}</strong><span>{[author, date].filter(Boolean).join(' · ')}</span></div>
        <span className="modern-viewer-counter" aria-live="polite">{index + 1} {t('of')} {files.length || 1}</span>
        <a className="modern-icon-button" href={url} download={file.name || 'attachment'} title={t('save')} aria-label={t('save')}><ChatIcon name="download" size={20} /></a>
        <div className="modern-viewer-menu-wrap">
          <button ref={menuButtonRef} type="button" className="modern-icon-button modern-viewer-menu-trigger" title={t('viewerActions')} aria-label={t('viewerActions')} aria-expanded={menuOpen} aria-controls="modern-viewer-actions" onClick={() => setMenuOpen(!menuOpen)}><ChatIcon name="more" size={22} /></button>
          {menuOpen && <div ref={menuRef} id="modern-viewer-actions" className="modern-viewer-menu modern-menu-actions">
            <a href={url} download={file.name || 'attachment'} onClick={() => setMenuOpen(false)}><ChatIcon name="download" />{t('save')}</a>
            {onReply && <button type="button" onClick={() => chooseAction(onReply)}><ChatIcon name="reply" />{t('reply')}</button>}
            {onShare && <button type="button" onClick={() => chooseAction(onShare)}><ChatIcon name="forward" />{t('share')}</button>}
            {onDelete && <button type="button" className="danger-action" disabled={deletePending} onClick={() => chooseAction(onDelete)}><ChatIcon name="delete" />{t('delete')}</button>}
          </div>}
        </div>
      </header>
      <div className="modern-viewer-stage" onClick={event => { if (event.target === event.currentTarget) onClose(); }} onTouchStart={event => {
        if (event.touches.length !== 1 || event.target.closest('button, video')) { touchRef.current = null; return; }
        touchRef.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      }} onTouchCancel={() => { touchRef.current = null; }} onTouchEnd={event => {
        const start = touchRef.current;
        touchRef.current = null;
        if (!start || event.touches.length || !event.changedTouches[0]) return;
        const dx = event.changedTouches[0].clientX - start.x;
        const dy = event.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) onMove(dx > 0 ? -1 : 1);
      }}>
        {many && <button type="button" className="modern-icon-button modern-viewer-nav prev" aria-label={isEnglish ? 'Previous attachment' : 'Предыдущее вложение'} onClick={() => onMove(-1)}><ChatIcon name="left" size={24} /></button>}
        {failedUrl === url ? <div className="modern-viewer-status" role="status">{isEnglish ? 'Could not load this attachment. You can download the file above.' : 'Не удалось загрузить вложение. Вы можете скачать файл кнопкой сверху.'}</div> : <>
          {loadedUrl !== url && <div className="modern-viewer-status" role="status">{t('loading')}</div>}
          {isVideo ? <video key={url} src={url} controls playsInline preload="metadata" poster={getVideoPosterUrl(file) || undefined} onLoadedData={() => setLoadedUrl(url)} onError={() => setFailedUrl(url)}>{t('unsupportedVideo')}</video> : <img key={url} src={url} alt={file.name || t('photoAlt')} onLoad={() => setLoadedUrl(url)} onError={() => setFailedUrl(url)} />}
        </>}
        {many && <button type="button" className="modern-icon-button modern-viewer-nav next" aria-label={isEnglish ? 'Next attachment' : 'Следующее вложение'} onClick={() => onMove(1)}><ChatIcon name="right" size={24} /></button>}
      </div>
      <footer className="modern-viewer-footer">
        {many && <div className="modern-viewer-thumbs" aria-label={t('media')}>{files.map((item, itemIndex) => <button key={`${item.id || item.name}-${itemIndex}`} type="button" aria-label={`${itemIndex + 1}: ${item.name || t('media')}`} aria-current={index === itemIndex ? 'true' : undefined} onClick={() => onSelect(itemIndex)}>{isVideoAttachment(item) ? <VideoPosterFrame file={item} alt={item.name || t('thumbnailAlt')} isEnglish={isEnglish} /> : <img src={getAttachmentUrl(item)} alt="" loading="lazy" />}</button>)}</div>}
        <small>{isEnglish ? 'Esc — close' : 'Esc — закрыть'}{many && (isEnglish ? ' · ← → — browse' : ' · ← → — листать')}</small>
      </footer>
    </div>, document.body
  );
}
