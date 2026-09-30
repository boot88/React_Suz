import React, { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../utils/apiConfig';
import { authFetch } from '../../utils/authFetch';
import { fetchChatUploadLimitMb } from '../../utils/chatUploadLimit';
import './AdminBroadcastWorkspace.css';

const request = async (path, options) => {
  const response = await authFetch(`${API_BASE_URL}/chat/broadcasts${path}`, options);
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.message || 'Не удалось выполнить запрос'), { status: response.status });
  return data;
};
const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const readPending = (key) => { try { const value = JSON.parse(localStorage.getItem(key)); return value?.id && Array.isArray(value.recipients) && Array.isArray(value.attachments) && typeof value.text === 'string' ? value : null; } catch { return null; } };

export default function AdminBroadcastWorkspace({ login, uploadFile, confirmAction, onSent, isEnglish = false }) {
  const pendingKey = `chat.broadcast.pending.${login}`;
  const [pending, setPending] = useState(() => readPending(pendingKey));
  const [people, setPeople] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState('selected');
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [details, setDetails] = useState({});
  const [expanded, setExpanded] = useState('');
  const [result, setResult] = useState(null);
  const sendingRef = useRef(false);
  const label = (ru, en) => isEnglish ? en : ru;
  const remember = (value) => {
    setPending(value);
    try { if (value) localStorage.setItem(pendingKey, JSON.stringify(value)); else localStorage.removeItem(pendingKey); } catch { /* sending also works without browser storage */ }
  };
  const loadPeople = useCallback(async () => {
    try { const data = await request('/recipients'); setPeople(data); setSelected((current) => current.filter((login) => data.some((person) => person.login === login))); setLoaded(true); }
    catch (err) { setError(err.message); }
  }, []);
  const loadHistory = useCallback(async (offset = 0) => {
    setHistoryBusy(true);
    try {
      const data = await request(`/?offset=${offset}`);
      setHistory((current) => offset ? [...current, ...data.items.filter((item) => !current.some((old) => old.id === item.id))] : data.items);
      setHasMore(data.hasMore);
    } catch (err) { setError(err.message); }
    finally { setHistoryBusy(false); }
  }, []);
  useEffect(() => { loadPeople(); loadHistory(); }, [loadPeople, loadHistory]);
  const targets = mode === 'all' ? people.map((person) => person.login) : selected;
  const chosen = people.filter((person) => selected.includes(person.login));
  const filtered = people.filter((person) => `${person.name} ${person.login} ${person.department}`.toLowerCase().includes(search.toLowerCase().trim()));
  const toggle = (person) => setSelected((current) => current.includes(person.login) ? current.filter((item) => item !== person.login) : [...current, person.login]);
  const complete = (data) => {
    setResult(data); setDetails((current) => ({ ...current, [data.id]: data })); setExpanded(data.id);
    remember(null); setText(''); setFiles([]); setSelected([]);
    onSent?.(); loadHistory();
  };
  const send = async (event) => {
    event?.preventDefault();
    if (busy || uploading || sendingRef.current) return;
    sendingRef.current = true;
    try {
      let command = pending;
      if (!command) {
        if (!targets.length || (!text.trim() && !files.length)) return;
        const confirmed = await confirmAction(`${label('Отправить сообщение', 'Send message')} ${mode === 'all' ? label('всем сотрудникам', 'to all employees') : label('выбранным сотрудникам', 'to selected employees')} (${targets.length})?\n\n${text.trim().slice(0, 300)}\n${label('Вложений', 'Attachments')}: ${files.length}`, label('Подтверждение рассылки', 'Confirm broadcast'));
        if (!confirmed) return;
        command = { id: window.crypto?.randomUUID?.() || `b_${Date.now()}_${Math.random().toString(36).slice(2)}`, recipients: targets, text: text.trim(), attachments: files };
        remember(command);
      }
      setBusy(true); setError('');
      try { complete(await request('/', post(command))); }
      catch (err) {
        setError(err.message);
        if (err.status === 400) { remember(null); setText(command.text); setFiles(command.attachments); setSelected(command.recipients); setMode('selected'); loadPeople(); }
        loadHistory();
      }
      finally { setBusy(false); }
    } finally { sendingRef.current = false; }
  };
  const checkPending = async () => {
    setBusy(true); setError('');
    try { complete(await request(`/${encodeURIComponent(pending.id)}`)); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const addFiles = async (event) => {
    const additions = Array.from(event.target.files || []); event.target.value = '';
    if (!additions.length || busy || uploading || pending) return;
    if (files.length + additions.length > 10) { setError(label('Не больше 10 вложений', 'No more than 10 attachments')); return; }
    setUploading(true); setError('');
    try {
      const limit = await fetchChatUploadLimitMb();
      const tooLarge = additions.find((file) => file.size > limit * 1024 * 1024);
      if (tooLarge) throw new Error(`${tooLarge.name}: ${label('максимум', 'maximum')} ${limit} MB`);
      for (const file of additions) {
        setProgress(file.name);
        const uploaded = await uploadFile(file, 'chat', { onProgress: (percent) => setProgress(`${file.name} — ${percent}%`) });
        setFiles((current) => [...current, uploaded]);
      }
    } catch (err) { setError(err.message); }
    finally { setUploading(false); setProgress(''); }
  };
  const showDetail = async (item) => {
    if (expanded === item.id) { setExpanded(''); return; }
    setExpanded(item.id);
    try { const data = await request(`/${encodeURIComponent(item.id)}`); setDetails((current) => ({ ...current, [item.id]: data })); }
    catch (err) { setError(err.message); }
  };
  const retry = async (item) => {
    if (busy) return;
    if (!await confirmAction(label('Повторить отправку только недоставленным получателям?', 'Retry delivery only for unsent recipients?'), label('Повтор рассылки', 'Retry broadcast'))) return;
    setBusy(true); setError('');
    try { const data = await request(`/${encodeURIComponent(item.id)}/retry`, post({})); setDetails((current) => ({ ...current, [item.id]: data })); setResult(data); onSent?.(); await loadHistory(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const stats = (item) => `${label('Доставлено', 'Delivered')} ${item.delivered} ${label('из', 'of')} ${item.total} · ${label('Прочитали', 'Read')} ${item.read}`;
  const locked = busy || uploading || Boolean(pending);
  return <section className="broadcast-workspace">
    <header><h1>{label('Рассылка сотрудникам', 'Employee broadcast')}</h1><p>{label('Каждый получатель получит сообщение в личном диалоге с вами. Ответы видны только вам и этому сотруднику.', 'Each recipient receives a message in their private conversation with you. Replies remain private.')}</p></header>
    {error && <p role="alert" className="broadcast-error">{error}</p>}
    {result && <p role="status" className="broadcast-result">{stats(result)}{result.delivered < result.total && ` · ${label('Недоставленные сообщения можно отправить повторно в истории ниже.', 'Retry unsent messages in the history below.')}`}</p>}
    {pending && <section className="broadcast-pending"><h2>{label('Проверка отправки', 'Check delivery')}</h2><p>{label('Результат последнего запроса ещё не подтверждён. Повтор безопасен: получатели не получат дубликаты.', 'The last request is not confirmed yet. Retrying will not create duplicate messages.')}</p><p>{pending.text}</p><p>{label('Получателей', 'Recipients')}: {pending.recipients.length} · {label('Вложений', 'Attachments')}: {pending.attachments.length}</p><button disabled={busy} onClick={checkPending}>{label('Проверить результат', 'Check result')}</button> <button disabled={busy} onClick={send}>{busy ? label('Отправляем…', 'Sending…') : label('Повторить запрос', 'Retry request')}</button></section>}
    {!pending && <form onSubmit={send} className="broadcast-compose">
      <fieldset disabled={locked} className="broadcast-recipients"><legend>{label('Получатели', 'Recipients')}</legend>
        <div className="broadcast-mode"><label><input type="radio" name="broadcast-mode" checked={mode === 'selected'} onChange={() => setMode('selected')} />{label('Выбрать сотрудников', 'Select employees')}</label><label><input type="radio" name="broadcast-mode" checked={mode === 'all'} onChange={() => setMode('all')} />{label('Все сотрудники', 'All employees')} ({people.length})</label></div>
        {!loaded && <button type="button" onClick={loadPeople}>{label('Загрузить получателей', 'Load recipients')}</button>}
        {mode === 'selected' && <><label className="broadcast-search">{label('Поиск по ФИО', 'Search by name')}<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={label('ФИО или подразделение', 'Name or department')} /></label><p>{label('Выбрано', 'Selected')}: {selected.length}</p>
          <div className="broadcast-chips">{chosen.map((person) => <button type="button" key={person.login} onClick={() => toggle(person)} aria-label={`${label('Убрать', 'Remove')} ${person.name}`}>{person.name} ×</button>)}</div>
          <div className="broadcast-people">{filtered.map((person) => <label key={person.login}><input type="checkbox" checked={selected.includes(person.login)} onChange={() => toggle(person)} /><span><strong>{person.name}</strong><small>{person.department} · {person.login}</small></span></label>)}{loaded && !filtered.length && <p>{label('Сотрудники не найдены', 'No employees found')}</p>}</div>
        </>}
      </fieldset>
      <fieldset disabled={locked} className="broadcast-content"><legend>{label('Сообщение', 'Message')}</legend><label>{label('Текст сообщения', 'Message text')}<textarea value={text} maxLength={2000} rows={7} onChange={(event) => setText(event.target.value)} /></label><small>{text.length}/2000</small>
        <label className="broadcast-file-input">{label('Прикрепить файлы', 'Attach files')}<input type="file" multiple onChange={addFiles} /></label>
        <ul className="broadcast-files">{files.map((file) => <li key={file.id}><span>{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</span><button type="button" onClick={() => setFiles((current) => current.filter((item) => item.id !== file.id))} aria-label={`${label('Убрать файл', 'Remove file')} ${file.name}`}>×</button></li>)}</ul>
      </fieldset>
      {uploading && <p role="status">{label('Загрузка', 'Uploading')}: {progress}</p>}
      <button className="broadcast-send" type="submit" disabled={locked || !loaded || !targets.length || (!text.trim() && !files.length)}>{busy ? label('Отправляем…', 'Sending…') : mode === 'all' ? `${label('Отправить всем', 'Send to all')} — ${targets.length}` : `${label('Отправить сотрудникам', 'Send to employees')} — ${targets.length}`}</button>
    </form>}
    <section className="broadcast-history"><header><h2>{label('История ваших рассылок', 'Your broadcast history')}</h2><button disabled={historyBusy} onClick={() => loadHistory()}>{label('Обновить', 'Refresh')}</button></header>
      {!history.length && <p>{historyBusy ? label('Загрузка…', 'Loading…') : label('Рассылок пока нет', 'No broadcasts yet')}</p>}
      {history.map((item) => <article key={item.id}><time>{new Date(item.createdAt).toLocaleString(isEnglish ? 'en-GB' : 'ru-RU')}</time><p className="broadcast-history-text">{item.text || label('Сообщение с файлами', 'Message with files')}</p><ul>{item.attachments.map((file) => <li key={file.id}>{file.name}</li>)}</ul><p>{stats(details[item.id] || item)}</p><button onClick={() => showDetail(item)}>{expanded === item.id ? label('Скрыть получателей', 'Hide recipients') : label('Показать получателей', 'Show recipients')}</button> {item.delivered < item.total && <button disabled={busy} onClick={() => retry(item)}>{label('Повторить недоставленным', 'Retry unsent')}</button>}
        {expanded === item.id && <ul className="broadcast-status-list">{details[item.id]?.recipients.map((person) => <li key={person.login}><strong>{person.name}</strong><span>{person.readAt ? label('Прочитано', 'Read') : person.status === 'delivered' ? label('Доставлено', 'Delivered') : person.status === 'failed' ? label('Ошибка доставки', 'Delivery failed') : label('Ожидает отправки', 'Pending')}{person.error && `: ${person.error}`}</span></li>) || <li>{label('Загрузка…', 'Loading…')}</li>}</ul>}
      </article>)}
      {hasMore && <button disabled={historyBusy} onClick={() => loadHistory(history.length)}>{label('Показать ещё', 'Load more')}</button>}
    </section>
  </section>;
}
