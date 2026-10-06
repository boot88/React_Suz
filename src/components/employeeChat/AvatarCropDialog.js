import React, { useEffect, useRef, useState } from 'react';

export default function AvatarCropDialog({ source, english, busy, onCancel, onSave, errorMessage }) {
  const canvas = useRef(null), image = useRef(null), dialog = useRef(null);
  const [loaded, setLoaded] = useState(false), [error, setError] = useState('');
  const [x, setX] = useState(50), [y, setY] = useState(50), [zoom, setZoom] = useState(1);
  const c = (ru, en) => english ? en : ru;
  useEffect(() => {
    let active = true;
    const previousFocus = document.activeElement;
    const photo = new Image();
    photo.onload = () => {
      if (!active) return;
      if (photo.width * photo.height > 40000000 || !photo.width || !photo.height) { setError('size'); return; }
      image.current = photo; setLoaded(true);
    };
    photo.onerror = () => { if (active) setError('image'); };
    photo.src = source;
    dialog.current?.querySelector('button')?.focus();
    return () => { active = false; photo.onload = null; photo.onerror = null; previousFocus?.focus?.(); };
  }, [source]);
  useEffect(() => {
    if (!loaded || !image.current || !canvas.current) return;
    const photo = image.current, side = Math.min(photo.width, photo.height) / zoom;
    const ctx = canvas.current.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(photo, (photo.width - side) * x / 100, (photo.height - side) * y / 100, side, side, 0, 0, 256, 256);
  }, [loaded, x, y, zoom]);
  const keyboard = event => {
    if (event.key === 'Escape' && !busy) { event.stopPropagation(); onCancel(); }
    if (event.key !== 'Tab') return;
    const nodes = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
    if (!nodes.length) return;
    if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1).focus(); }
    if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
  };
  return <div className="app-modal-backdrop"><div ref={dialog} className="app-modal-card profile-crop-dialog" role="dialog" aria-modal="true" aria-label={c('Кадрирование фотографии', 'Crop photo')} onKeyDown={keyboard}>
    <h3>{c('Кадрирование фотографии', 'Crop photo')}</h3>
    <p>{c('Выберите область: сохранится именно это изображение.', 'Choose the crop: this exact image will be saved.')}</p>
    {error ? <p role="alert">{c('Не удалось открыть изображение. Выберите корректное фото до 40 мегапикселей.', 'Could not open image. Choose a valid photo up to 40 megapixels.')}</p> : <canvas ref={canvas} width="256" height="256" aria-label={c('Предпросмотр фотографии', 'Photo preview')} />}
    <label>{c('По горизонтали', 'Horizontal position')}<input type="range" min="0" max="100" value={x} disabled={!loaded || busy} onChange={e => setX(Number(e.target.value))} /></label>
    <label>{c('По вертикали', 'Vertical position')}<input type="range" min="0" max="100" value={y} disabled={!loaded || busy} onChange={e => setY(Number(e.target.value))} /></label>
    <label>{c('Увеличение', 'Zoom')}<input type="range" min="1" max="3" step="0.1" value={zoom} disabled={!loaded || busy} onChange={e => setZoom(Number(e.target.value))} /></label>
    {errorMessage && <p role="alert">{errorMessage}</p>}
    <div className="app-modal-actions"><button type="button" disabled={busy} onClick={onCancel}>{c('Отмена', 'Cancel')}</button><button type="button" disabled={!loaded || Boolean(error) || busy} onClick={() => canvas.current.toBlob(blob => { if (blob) onSave(blob); else setError('image'); }, 'image/jpeg', 0.92)}>{busy ? c('Сохранение…', 'Saving…') : c('Сохранить фотографию', 'Save photo')}</button></div>
  </div></div>;
}
