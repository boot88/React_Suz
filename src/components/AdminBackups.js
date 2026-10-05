import AdminNotice from './AdminNotice';
import { useAdminTranslation, getAdminLocale } from '../utils/adminTranslation';
import React, { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch } from '../utils/authFetch';
import { exportBrowserSettings, importBrowserSettings, validateBrowserSettings } from '../utils/adminSettingsBackup';
import OperationProgress from './OperationProgress';

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
  const [progress, setProgress] = useState(null);
  const [pendingRestore, setPendingRestore] = useState(null);
  const confirmButton = useRef(null);
  useEffect(() => { if (pendingRestore) confirmButton.current?.focus(); }, [pendingRestore]);
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
    if (inProgress.current || pendingRestore) return;
    inProgress.current = true;
    setBusy(`export-${group.key}`); setStatus(''); setError('');
    const steps = ['Подготовка', 'Обработка данных', 'Сохранение', 'Готово'];
    setProgress({ steps, step: 0 });
    try {
      const name = recoveryName || `react-suz-${group.key}-${new Date().toISOString().slice(0, 10)}${group.extension}`;
      // Open the picker while the click still has browser user activation.
      const target = await chooseSaveTarget(name);
      setProgress({ steps, step: 1 });
      const blob = group.key === 'settings'
        ? new Blob([JSON.stringify(exportBrowserSettings(), null, 2)], { type: 'application/json' })
        : await (await checkResponse(await authFetch(`${API_BASE_URL}/backups/${recoveryName ? `recovery/${encodeURIComponent(recoveryName)}` : `${group.key}/export`}`))).blob();
      setProgress({ steps, step: 2 });
      await saveBlob(blob, name, target);
      setProgress({ steps, step: 3 });
      setStatus(target ? 'Резервная копия сохранена в выбранный файл.' : 'Резервная копия передана браузеру для скачивания.');
    } catch (failure) {
      if (failure.name === 'AbortError') setProgress(null);
      else { setError(failure.message); setProgress((previous) => ({ ...previous, failed: true })); }
    }
    finally { inProgress.current = false; setBusy(''); }
  };

  const importBackup = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const group = selected.current;
    if (!file || !group || inProgress.current || pendingRestore) return;
    setError(''); setStatus(''); setProgress(null);
    if (file.size > (group.key === 'settings' ? 65536 : MAX_BYTES)) { setError(group.key === 'settings' ? 'Файл личных настроек превышает 64 КБ.' : 'Файл превышает допустимый размер. Для резервных копий — 512 МБ.'); return; }
    inProgress.current = true;
    setBusy(`inspect-${group.key}`);
    const steps = ['Подготовка', 'Проверка копии', 'Подтверждение'];
    setProgress({ steps, step: 0 });
    try {
      setProgress({ steps, step: 1 });
      let metadata, settingsData;
      if (group.key === 'settings') {
        settingsData = validateBrowserSettings(JSON.parse(await file.text()));
        metadata = { createdAt: settingsData.createdAt, settings: Object.keys(settingsData.settings).length };
      } else {
        const response = await checkResponse(await authFetch(`${API_BASE_URL}/backups/${group.key}/inspect`, {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file
        }));
        metadata = await response.json();
      }
      setProgress(null);
      setPendingRestore({ file, group, metadata, settingsData });
    } catch (failure) {
      setError(failure instanceof SyntaxError ? 'Выберите файл настроек, созданный в React_Suz' : failure.message);
      setProgress({ steps, step: 1, failed: true });
    } finally { inProgress.current = false; setBusy(''); }
  };

  const restoreBackup = async () => {
    if (!pendingRestore || inProgress.current) return;
    const { file, group, settingsData } = pendingRestore;
    inProgress.current = true;
    setPendingRestore(null);
    setBusy(`import-${group.key}`); setStatus(''); setError(''); setRecovery('');
    const steps = ['Подготовка', group.key === 'settings' ? 'Сохранение настроек' : 'Восстановление на сервере', 'Готово'];
    setProgress({ steps, step: 0 });
    try {
      setProgress({ steps, step: 1 });
      if (group.key === 'settings') {
        importBrowserSettings(settingsData);
        onSettingsRestored?.();
        setStatus('Личные настройки восстановлены.');
      } else {
        const response = await checkResponse(await authFetch(`${API_BASE_URL}/backups/${group.key}/import`, {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Confirm-Restore': 'replace' }, body: file
        }));
        const result = await response.json();
        setStatus(`${result.message} Восстановлено записей: ${result.tables.reduce((sum, table) => sum + table.rows, 0)}; файлов: ${result.files}.`);
        setRecovery(result.recoveryName);
        window.dispatchEvent(new Event('admin:data-restored'));
      }
      setProgress({ steps, step: 2 });
    } catch (failure) { setError(failure.message); setProgress({ steps, step: 1, failed: true }); }
    finally { inProgress.current = false; setBusy(''); }
  };

  const settings = { key: 'settings', title: 'Личные настройки', extension: '.json' };
  return <section className="settings-group">
    <h2 className="settings-group-title">{t("Резервные копии и восстановление")}</h2>
    <p className="backup-help">{t("Экспорт сохраняет файл на вашем компьютере. Импорт полностью заменяет выбранный раздел. Во время экспорта чтение доступно, изменения приостанавливаются. При восстановлении приостанавливается вся работа с данными.")}</p>
    <p className="backup-help">{t("Для импорта используйте копии, созданные здесь. Отсутствующие таблицы создаются из копии; таблицы со сложными индексами или внешними ключами предварительно подготовьте миграциями.")}</p>
    <p className="backup-help">{t("Лимит одной копии — 512 МБ, вложений — 256 МБ. Для больших объёмов используйте резервирование на сервере.")}</p>
    {(!window.showSaveFilePicker || !window.isSecureContext) && <p className="backup-help">{t("Место сохранения выбирает браузер. Чтобы он спрашивал папку каждый раз, включите «Всегда указывать место для скачивания» в его настройках загрузок.")}</p>}
    <div className="settings-group-grid">
      {[...groups.filter((group) => group.key !== 'other' || group.tables.length), settings].map((group) => <article key={group.key}>
        <h2>{t(group.title)}</h2>
        <p>{t(DESCRIPTIONS[group.key] || 'Язык, тема, вид и размер списка заявок, история действий, экран редактирования и тестовый режим поиска документов. Аккаунты и пароли в этот файл не входят.')}</p>
        {group.tables && <p className="backup-tables">{t("Таблицы: ")}{t(group.tables.join(', ') || 'ещё не созданы')}</p>}
        <div className="backup-buttons">
          <button type="button" disabled={!!busy || !!pendingRestore || (group.tables && !group.tables.length)} onClick={() => exportBackup(group)}>{t(busy === `export-${group.key}` ? 'Сохраняем…' : `Экспорт ${group.extension === '.sql' ? 'SQL' : ''}`)}</button>
          <button type="button" className="backup-import" disabled={!!busy || !!pendingRestore} onClick={() => { selected.current = group; input.current.accept = group.extension; input.current.click(); }}>{t(busy === `inspect-${group.key}` ? 'Проверяем…' : busy === `import-${group.key}` ? 'Восстанавливаем…' : 'Импорт / восстановить')}</button>
        </div>
      </article>)}
    </div>
    <input ref={input} type="file" hidden onChange={importBackup} aria-label={t("Файл резервной копии")} />
    {progress && <OperationProgress {...progress} />}
    {pendingRestore && <div className="backup-dialog-backdrop" onKeyDown={(event) => {
      if (event.key === 'Escape') setPendingRestore(null);
      if (event.key === 'Tab') {
        const buttons = event.currentTarget.querySelectorAll('button');
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <div className="backup-dialog" role="dialog" aria-modal="true" aria-labelledby="backup-confirm-title">
        <h2 id="backup-confirm-title">{t('Подтверждение восстановления')}</h2>
        <dl>
          <div><dt>{t('Раздел')}</dt><dd>{t(pendingRestore.group.title)}</dd></div>
          <div><dt>{t('Имя файла:')}</dt><dd>{pendingRestore.file.name}</dd></div>
          <div><dt>{t('Размер:')}</dt><dd>{(pendingRestore.file.size / 1024 / 1024).toLocaleString(getAdminLocale(), { maximumFractionDigits: 2 })} MB</dd></div>
          <div><dt>{t('Дата создания копии')}</dt><dd>{Number.isFinite(Date.parse(pendingRestore.metadata.createdAt)) ? new Date(pendingRestore.metadata.createdAt).toLocaleString(getAdminLocale()) : t('Не указана в копии')}</dd></div>
          {pendingRestore.group.key === 'settings' ? <div><dt>{t('Настроек')}</dt><dd>{pendingRestore.metadata.settings}</dd></div> : <>
            <div><dt>{t('Записей')}</dt><dd>{pendingRestore.metadata.rows}</dd></div>
            <div><dt>{t('Файлов в архиве')}</dt><dd>{pendingRestore.metadata.files}</dd></div>
            <div><dt>{t('Фотографий в статьях')}</dt><dd>{pendingRestore.metadata.embeddedImages}</dd></div>
            <div><dt>{t('Таблицы')}</dt><dd>{pendingRestore.metadata.tables.map((table) => `${table.name}: ${table.rows}`).join(', ')}</dd></div>
          </>}
        </dl>
        <p>{t(pendingRestore.group.key === 'settings' ? 'Будут заменены ваши личные настройки. Настройки других сотрудников не изменятся.' : 'Текущие данные выбранного раздела будут заменены. Перед заменой сервер сохранит копию прежних данных.')}</p>
        <div className="backup-buttons">
          <button type="button" className="backup-import" onClick={() => setPendingRestore(null)}>{t('Отмена')}</button>
          <button type="button" ref={confirmButton} onClick={restoreBackup}>{t('Восстановить данные')}</button>
        </div>
      </div>
    </div>}
    {status && <AdminNotice type="success">{t(status)}</AdminNotice>}
    {error && <AdminNotice type="error">{t(error)}</AdminNotice>}
    {recovery && <button type="button" disabled={!!busy || !!pendingRestore} onClick={() => exportBackup({ key: 'recovery' }, recovery)}>{t("Скачать копию до восстановления")}</button>}
  </section>;
}
