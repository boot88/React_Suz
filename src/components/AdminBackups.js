import { useAdminTranslation } from '../utils/adminTranslation';
import React, { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch } from '../utils/authFetch';
import { exportBrowserSettings, importBrowserSettings } from '../utils/adminSettingsBackup';

const DESCRIPTIONS = {
  configuration: 'Общие настройки программы, включая сохранённый лимит вложений сотрудников.',
  applications: 'Все заявки, этапы выполнения, история действий и отметки просмотра. Вложения из чата сохраняются отдельно вместе с чатом.',
  knowledge: 'Статьи, решения, категории и все прикреплённые фотографии в одном SQL-файле.',
  accounts: 'Логины, роли, сохранённые пароли, профили, персональные настройки и аватары. После восстановления может потребоваться повторный вход.',
  communication: 'Переписка, лента, комментарии, реакции, фотографии, видео, документы, архивы и журнал аудита.',
  other: 'Дополнительные локальные таблицы, найденные в этой базе данных.',
  all: 'Все разделы выше и их файлы. Справочник сотрудников, IP-сетка и активные сессии исключены.'
};
const MAX_BYTES = 512 * 1024 * 1024;

const chooseSaveTarget = async (name) => {
  if (!window.showSaveFilePicker || !window.isSecureContext) return null;
  return window.showSaveFilePicker({ suggestedName: name });
};
const saveBlob = async (blob, name, handle) => {
  if (handle) {
    const writable = await handle.createWritable();
    try { await writable.write(blob); await writable.close(); }
    catch (error) { await writable.abort().catch(() => {}); throw error; }
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};
const checkResponse = async (response) => {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || data.error || 'Не удалось выполнить операцию');
  }
  return response;
};

export default function AdminBackups({ onSettingsRestored }) {
  const t = useAdminTranslation();
  const [groups, setGroups] = useState([]);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState('');
  const input = useRef(null);
  const selected = useRef(null);
  const inProgress = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    authFetch(`${API_BASE_URL}/backups`, { signal: controller.signal })
      .then(checkResponse).then((response) => response.json()).then(setGroups)
      .catch((failure) => { if (failure.name !== 'AbortError') setError(failure.message); });
    return () => controller.abort();
  }, []);

  const exportBackup = async (group, recoveryName = '') => {
    if (inProgress.current) return;
    inProgress.current = true;
    setBusy(`export-${group.key}`); setStatus(''); setError('');
    try {
      const name = recoveryName || `react-suz-${group.key}-${new Date().toISOString().slice(0, 10)}${group.extension}`;
      // Open the picker while the click still has browser user activation.
      const target = await chooseSaveTarget(name);
      const blob = group.key === 'settings'
        ? new Blob([JSON.stringify(exportBrowserSettings(), null, 2)], { type: 'application/json' })
        : await (await checkResponse(await authFetch(`${API_BASE_URL}/backups/${recoveryName ? `recovery/${encodeURIComponent(recoveryName)}` : `${group.key}/export`}`))).blob();
      await saveBlob(blob, name, target);
      setStatus(target ? 'Резервная копия сохранена в выбранный файл.' : 'Резервная копия передана браузеру для скачивания.');
    } catch (failure) { if (failure.name !== 'AbortError') setError(failure.message); }
    finally { inProgress.current = false; setBusy(''); }
  };

  const importBackup = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const group = selected.current;
    if (!file || !group || inProgress.current) return;
    if (file.size > (group.key === 'settings' ? 65536 : MAX_BYTES)) { setError('Файл превышает допустимый размер. Для резервных копий — 512 МБ.'); return; }
    if (!window.confirm(t(`Восстановить «${group.title}» из «${file.name}»? Текущие данные выбранного раздела будут заменены. ${group.key === 'settings' ? '' : 'Перед заменой сервер сохранит копию прежних данных.'}`))) return;
    inProgress.current = true;
    setBusy(`import-${group.key}`); setStatus(''); setError(''); setRecovery('');
    try {
      if (group.key === 'settings') {
        importBrowserSettings(JSON.parse(await file.text()));
        onSettingsRestored();
        setStatus('Настройки этого браузера восстановлены.');
      } else {
        const response = await checkResponse(await authFetch(`${API_BASE_URL}/backups/${group.key}/import`, {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Confirm-Restore': 'replace' }, body: file
        }));
        const result = await response.json();
        setStatus(`${result.message} Восстановлено записей: ${result.tables.reduce((sum, table) => sum + table.rows, 0)}; файлов: ${result.files}.`);
        setRecovery(result.recoveryName);
      }
    } catch (failure) { setError(failure.message); }
    finally { inProgress.current = false; setBusy(''); }
  };

  const settings = { key: 'settings', title: 'Настройки этого браузера', extension: '.json' };
  return <section className="settings-group">
    <h2 className="settings-group-title">{t("Резервные копии и восстановление")}</h2>
    <p className="backup-help">{t("Экспорт сохраняет файл на вашем компьютере. Импорт полностью заменяет выбранный раздел. На время операции работа с данными приостанавливается.")}</p>
    <p className="backup-help">{t("Для импорта используйте копии, созданные здесь. Отсутствующие таблицы создаются из копии; таблицы со сложными индексами или внешними ключами предварительно подготовьте миграциями.")}</p>
    <p className="backup-help">{t("Лимит одной копии — 512 МБ, вложений — 256 МБ. Для больших объёмов используйте резервирование на сервере.")}</p>
    {(!window.showSaveFilePicker || !window.isSecureContext) && <p className="backup-help">{t("Место сохранения выбирает браузер. Чтобы он спрашивал папку каждый раз, включите «Всегда указывать место для скачивания» в его настройках загрузок.")}</p>}
    <div className="settings-group-grid">
      {[...groups.filter((group) => group.key !== 'other' || group.tables.length), settings].map((group) => <article key={group.key}>
        <h2>{t(group.title)}</h2>
        <p>{t(DESCRIPTIONS[group.key] || 'Язык, тема, вид и размер списка заявок, история действий, экран редактирования и тестовый режим поиска документов. Аккаунты и пароли в этот файл не входят.')}</p>
        {group.tables && <p className="backup-tables">{t("Таблицы: ")}{t(group.tables.join(', ') || 'ещё не созданы')}</p>}
        <div className="backup-buttons">
          <button type="button" disabled={!!busy || (group.tables && !group.tables.length)} onClick={() => exportBackup(group)}>{t(busy === `export-${group.key}` ? 'Сохраняем…' : `Экспорт ${group.extension === '.sql' ? 'SQL' : ''}`)}</button>
          <button type="button" className="backup-import" disabled={!!busy} onClick={() => { selected.current = group; input.current.accept = group.extension; input.current.click(); }}>{t(busy === `import-${group.key}` ? 'Восстанавливаем…' : 'Импорт / восстановить')}</button>
        </div>
      </article>)}
    </div>
    <input ref={input} type="file" hidden onChange={importBackup} aria-label={t("Файл резервной копии")} />
    {busy && <p role="status" className="settings-message">{t(busy.startsWith('import') ? 'Восстанавливаем данные. Дождитесь завершения операции.' : 'Готовим резервную копию…')}</p>}
    {status && <div className="settings-message" role="status">{t(status)}</div>}
    {error && <div className="settings-message backup-error" role="alert">{t(error)}</div>}
    {recovery && <button type="button" disabled={!!busy} onClick={() => exportBackup({ key: 'recovery' }, recovery)}>{t("Скачать копию до восстановления")}</button>}
  </section>;
}
