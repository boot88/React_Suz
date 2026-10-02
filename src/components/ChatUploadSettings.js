import AdminNotice from './AdminNotice';
import { useAdminTranslation } from '../utils/adminTranslation';
import React, { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch } from '../utils/authFetch';

export default function ChatUploadSettings() {
  const t = useAdminTranslation();
  const [value, setValue] = useState('10');
  const [saved, setSaved] = useState(10);
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('info');
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/settings/chat-upload-limit`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setSaved(data.limitMb); setValue(String(data.limitMb)); setLoaded(true); setMessage('');
    } catch (error) { setMessageType('error'); setMessage(error.message || 'Не удалось загрузить настройку'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = async (event) => {
    event.preventDefault();
    const limitMb = Number(value);
    if (!Number.isInteger(limitMb) || limitMb < 10 || limitMb > 150) { setMessageType('warning'); setMessage('Введите целое число от 10 до 150 МБ.'); return; }
    setBusy(true); setMessage('');
    try {
      const response = await authFetch(`${API_BASE_URL}/settings/chat-upload-limit`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limitMb }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setSaved(data.limitMb); setValue(String(data.limitMb));
      setMessageType('success');
      setMessage(`Сохранено. Теперь можно прикреплять файлы до ${data.limitMb} МБ.`);
    } catch (error) { setMessageType('error'); setMessage(error.message || 'Не удалось сохранить настройку'); }
    finally { setBusy(false); }
  };
  return <section className="settings-group">
    <h2 className="settings-group-title">{t("Вложения сотрудников")}</h2>
    <div className="settings-group-grid"><article>
      <h2>{t("Размер файла в чате")}</h2>
      <p>{t("Лимит одного файла в переписке и ленте: от 10 до 150 МБ. Изменение применяется ко всем сотрудникам после сохранения.")}</p>
      {loaded && <p>{t("Сейчас действует: ")}<strong>{t(saved)}{t(" МБ")}</strong>.</p>}
      <form onSubmit={save} className="upload-limit-form">
        <label htmlFor="chat-upload-limit">{t("Максимальный размер, МБ")}</label>
        <input id="chat-upload-limit" type="number" min="10" max="150" step="1" required value={value} onChange={(event) => setValue(event.target.value)} disabled={!loaded || busy} />
        <button type="submit" disabled={!loaded || busy || Number(value) === saved}>{t(busy ? 'Подождите…' : 'Сохранить')}</button>
      </form>
      {!loaded && !busy && <button type="button" onClick={load}>{t("Повторить загрузку")}</button>}
      {message && <AdminNotice type={messageType}>{t(message)}</AdminNotice>}
    </article></div>
  </section>;
}
