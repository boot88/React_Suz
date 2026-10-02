import { translateAdminText as t, useAdminTranslation, getAdminLocale } from '../utils/adminTranslation';
import { userSettingsStorage } from '../utils/userPreferences';
import React, { useState } from 'react';
import { syncEmployees } from '../services/employeeService';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch } from '../utils/authFetch';
import AdminBackups from '../components/AdminBackups';
import ChatUploadSettings from '../components/ChatUploadSettings';
import OperationProgress from '../components/OperationProgress';
import './AdminSettings.css';

const EMPLOYEE_DETAIL_FIELDS = [
  ['position', 'Должность'],
  ['department', 'Отдел'],
  ['room', 'Кабинет'],
  ['internal_phone', 'Внутренний телефон'],
  ['external_phone', 'Внешний телефон'],
  ['email', 'Email']
];

const AUDIT_TEST_MODE_SETTING_KEY = 'admin.auditTestMode';
const DASHBOARD_CARD_SIZE_KEY = 'dashboard.timelineCardDesign';
const DASHBOARD_CARD_SIZE_EVENT = 'dashboard:timeline-card-design-change';
const SHOW_EDIT_APPLICATION_TABLE_KEY = 'admin.showEditApplicationTable';

const isFemaleEmployee = (fullName = '') => {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  const surname = parts[0] || '';
  const patronymic = parts[2] || '';
  return /(овна|евна|ична|инична|кызы)$/i.test(patronymic)
    || /(ова|ева|ёва|ина|ына|ая|ская|цкая)$/i.test(surname);
};

const EmployeeDetails = ({ employee = {} }) => (
  <dl className="directory-person-details">
    {EMPLOYEE_DETAIL_FIELDS.map(([field, label]) => (
      <div key={field}>
        <dt>{t(label)}</dt>
        <dd>{employee[field] || '—'}</dd>
      </div>
    ))}
  </dl>
);

const DirectoryReportGroup = ({ title, count = 0, items = [], tone, renderItem }) => {
  if (!count) return null;
  return (
    <section className={`directory-report-group directory-report-group--${tone}`}>
      <h3>{t(title)} <span>{t(count)}</span></h3>
      <div className="directory-report-list">{t(items.map(renderItem))}</div>
      {count > items.length && <p className="directory-report-more">{t("Показано ")}{items.length}{t(" из ")}{t(count)}{t(" записей.")}</p>}
    </section>
  );
};

const DirectorySyncReport = ({ report }) => {
  if (!report) return null;
  const inserted = report.inserted || { count: 0, items: [] };
  const updated = report.updated || { count: 0, items: [] };
  const deactivated = report.deactivated || { count: 0, items: [] };
  const totalChanges = Number(inserted.count || 0) + Number(updated.count || 0) + Number(deactivated.count || 0);

  return (
    <div className="directory-sync-report" aria-live="polite">
      <div className="directory-report-heading">
        <div><span>{t("Последнее обновление")}</span><h2>{t("Изменения сотрудников")}</h2></div>
        {report.updatedAt && <time>{t(new Date(report.updatedAt).toLocaleString(getAdminLocale()))}</time>}
      </div>
      {!totalChanges && <p className="directory-report-empty">{t("Изменений нет. Данные сотрудников уже актуальны.")}</p>}
      <DirectoryReportGroup
        title={t("Новые сотрудники")}
        tone="hired"
        count={inserted.count}
        items={inserted.items || []}
        renderItem={(employee, index) => {
          const female = isFemaleEmployee(employee.full_name);
          return (
            <article key={employee.source_key || `${employee.full_name}-${index}`}>
              <strong>{t(female ? 'Принята на работу новая сотрудница' : 'Принят на работу новый сотрудник')}</strong>
              <h4>{employee.full_name || t('ФИО не указано')}</h4>
              <EmployeeDetails employee={employee} />
            </article>
          );
        }}
      />
      <DirectoryReportGroup
        title={t("Переводы и изменения")}
        tone="changed"
        count={updated.count}
        items={updated.items || []}
        renderItem={(item, index) => {
          const employee = item.after || item.before || {};
          return (
            <article key={employee.source_key || `${employee.full_name}-${index}`}>
              <strong>{t("Перевели / изменили данные")}</strong>
              <h4>{employee.full_name || t('ФИО не указано')}</h4>
              <div className="directory-field-changes">
                {(item.changes || []).map((change) => (
                  <div key={change.field}>
                    <b>{t(change.label)}</b>
                    <span><small>{t("Было")}</small>{change.oldValue || '—'}</span>
                    <i aria-hidden="true">→</i>
                    <span><small>{t("Стало")}</small>{change.newValue || '—'}</span>
                  </div>
                ))}
              </div>
              <EmployeeDetails employee={employee} />
            </article>
          );
        }}
      />
      <DirectoryReportGroup
        title={t("Уволенные сотрудники")}
        tone="fired"
        count={deactivated.count}
        items={deactivated.items || []}
        renderItem={(employee, index) => (
          <article key={employee.source_key || `${employee.full_name}-${index}`}>
            <strong>{isFemaleEmployee(employee.full_name) ? t('Уволена') : t('Уволен')}</strong>
            <h4>{employee.full_name || t('ФИО не указано')}</h4>
            <EmployeeDetails employee={employee} />
          </article>
        )}
      />
    </div>
  );
};

export default function AdminSettings({ language, theme, onLanguageChange, onThemeChange }) {
  const t = useAdminTranslation();
  const [busy, setBusy] = useState('');
  const [operation, setOperation] = useState(null);
  const [message, setMessage] = useState('');
  const [directoryReport, setDirectoryReport] = useState(null);
  const [applicationActionHistoryVisible, setApplicationActionHistoryVisible] = useState(() => userSettingsStorage.getItem('admin.showApplicationActionHistory') === 'true');
  const [auditTestModeEnabled, setAuditTestModeEnabled] = useState(() => userSettingsStorage.getItem(AUDIT_TEST_MODE_SETTING_KEY) === 'true');
  const [largeRequestsEnabled, setLargeRequestsEnabled] = useState(() => userSettingsStorage.getItem(DASHBOARD_CARD_SIZE_KEY) === 'modern');
  const [editApplicationTableVisible, setEditApplicationTableVisible] = useState(() => userSettingsStorage.getItem(SHOW_EDIT_APPLICATION_TABLE_KEY) === 'true');
  const toggleApplicationActionHistory = () => {
    const nextValue = !applicationActionHistoryVisible;
    userSettingsStorage.setItem('admin.showApplicationActionHistory', String(nextValue));
    setApplicationActionHistoryVisible(nextValue);
    window.dispatchEvent(new Event('admin:application-action-history-visibility'));
  };
  const toggleAuditTestMode = () => {
    const nextValue = !auditTestModeEnabled;
    userSettingsStorage.setItem(AUDIT_TEST_MODE_SETTING_KEY, String(nextValue));
    setAuditTestModeEnabled(nextValue);
  };
  const toggleLargeRequests = () => {
    const nextValue = !largeRequestsEnabled;
    userSettingsStorage.setItem(DASHBOARD_CARD_SIZE_KEY, nextValue ? 'modern' : 'legacy');
    setLargeRequestsEnabled(nextValue);
    window.dispatchEvent(new Event(DASHBOARD_CARD_SIZE_EVENT));
  };
  const toggleEditApplicationTable = () => {
    const nextValue = !editApplicationTableVisible;
    userSettingsStorage.setItem(SHOW_EDIT_APPLICATION_TABLE_KEY, String(nextValue));
    setEditApplicationTableVisible(nextValue);
  };
  const run = async (kind) => {
    if (!window.confirm(t(kind === 'directory' ? 'Обновить справочник сотрудников? Изменения будут сохранены.' : 'Обновить данные IP-сетки?'))) return;
    setBusy(kind);
    const steps = kind === 'directory' ? ['Обновление справочника', 'Обновление учётных записей', 'Готово'] : ['Обработка данных', 'Обновление экрана', 'Готово'];
    setOperation({ steps, step: 0 });
    setMessage('');
    if (kind === 'directory') setDirectoryReport(null);
    try {
      if (kind === 'directory') {
        const data = await syncEmployees((step) => setOperation({ steps, step }));
        const createdAccounts = Number(data.accounts?.created || 0);
        const deactivatedCount = Number(data.changes?.deactivated?.count || 0);
        const skippedRemovals = Number(data.accounts?.skippedRemovals || 0);
        const summary = [
          `Справочник и учётные записи обновлены. Активных сотрудников: ${data.accounts?.total || data.activeAfter || 0}.`
        ];
        if (deactivatedCount) summary.push(`Снято с учёта: ${deactivatedCount} — проверьте отчёт ниже.`);
        if (createdAccounts) summary.push(`Новых аккаунтов: ${createdAccounts}; начальный пароль — 12345.`);
        if (skippedRemovals) summary.push(`Удаление ${skippedRemovals} аккаунтов пропущено: справочник загружен неполностью.`);
        setMessage(summary);
        setDirectoryReport({ ...(data.changes || {}), updatedAt: data.updatedAt });
        window.dispatchEvent(new Event('employee-directory-updated'));
      } else {
        const response = await authFetch(`${API_BASE_URL}/network-map/refresh`, { method: 'POST' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || data.message || 'Не удалось обновить IP-сетку');
        setOperation({ steps, step: 1 });
        localStorage.setItem('network-map-cache', JSON.stringify(data));
        setMessage('Данные IP-сетки обновлены и сохранены в SQL.');
      }
      setOperation({ steps, step: 2 });
    } catch (error) {
      setOperation((previous) => ({ ...previous, failed: true }));
      setMessage(error.message || 'Не удалось выполнить обновление.');
    } finally {
      setBusy('');
    }
  };
  return (
    <main className="admin-settings">
      <header>
        <h1>{t("Настройки")}</h1>
        <span>{t("Личные параметры, общие настройки и обслуживание программы.")}</span>
      </header>

      <section className="settings-scope" aria-labelledby="personal-settings-title">
        <h2 id="personal-settings-title">{t("Мои настройки")}</h2>
        <p className="settings-scope-note">{t("Применяются только к вашей учётной записи и сохраняются для следующих входов.")}</p>
        <section className="settings-group">
          <h2 className="settings-group-title">{t("Заявки")}</h2>
          <div className="settings-group-grid">
            <article>
              <h2>{t("Вид заявок")}</h2>
              <p>{t("Вид — Новые заявки.")}</p>
              <label className="settings-toggle">
                <input type="checkbox" checked={largeRequestsEnabled} onChange={toggleLargeRequests} />
                <span aria-hidden="true" />
                <b>{t(largeRequestsEnabled ? 'Большие заявки включены' : 'Обычные заявки')}</b>
              </label>
            </article>
            <article>
              <h2>{t("Редактирование заявок")}</h2>
              <p>{t("Показывать промежуточную таблицу выбора перед открытием заявки.")}</p>
              <label className="settings-toggle">
                <input type="checkbox" checked={editApplicationTableVisible} onChange={toggleEditApplicationTable} />
                <span aria-hidden="true" />
                <b>{t(editApplicationTableVisible ? 'Таблица выбора показывается' : 'Заявка открывается сразу')}</b>
              </label>
            </article>
            <article>
              <h2>{t("Карточка заявки")}</h2>
              <p>{t("Показывать в карточке заявки блок «История действий».")}</p>
              <label className="settings-toggle">
                <input type="checkbox" checked={applicationActionHistoryVisible} onChange={toggleApplicationActionHistory} />
                <span aria-hidden="true" />
                <b>{t(applicationActionHistoryVisible ? 'История показывается' : 'История скрыта')}</b>
              </label>
            </article>
          </div>
        </section>

        <section className="settings-group">
          <h2 className="settings-group-title">{t("Интерфейс")}</h2>
          <div className="settings-group-grid">
            <article>
              <h2>{t("Оформление")}</h2>
              <p>{t("Язык и тема применяются ко всей админ-панели.")}</p>
              <div className="settings-choice">
                <span>{t("Язык")}</span>
                <div className="settings-segmented" role="group" aria-label={t("Язык")}>
                  <button type="button" className={language === 'ru' ? 'active' : ''} onClick={() => onLanguageChange('ru')}>RU</button>
                  <button type="button" className={language === 'en' ? 'active' : ''} onClick={() => onLanguageChange('en')}>EN</button>
                </div>
              </div>
              <div className="settings-choice">
                <span>{t("Тема")}</span>
                <div className="settings-segmented" role="group" aria-label={t("Тема")}>
                  <button type="button" className={theme === 'light' ? 'active' : ''} onClick={() => onThemeChange('light')}>{t("Светлая")}</button>
                  <button type="button" className={theme === 'dark' ? 'active' : ''} onClick={() => onThemeChange('dark')}>{t("Тёмная")}</button>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section className="settings-group">
          <h2 className="settings-group-title">{t("Поиск документов")}</h2>
          <div className="settings-group-grid">
            <article>
              <h2>{t("Тестовый режим")}</h2>
              <p>{t("Тестовый режим показывает переписку по месяцам, включая текущий. Обычный режим показывает периоды старше года.")}</p>
              <label className="settings-toggle">
                <input type="checkbox" checked={auditTestModeEnabled} onChange={toggleAuditTestMode} />
                <span aria-hidden="true" />
                <b>{t(auditTestModeEnabled ? 'Тестовый режим включён' : 'Тестовый режим выключен')}</b>
              </label>
            </article>
          </div>
        </section>
      </section>
      <section className="settings-scope" aria-labelledby="shared-settings-title">
        <h2 id="shared-settings-title">{t("Настройки программы")}</h2>
        <p className="settings-scope-note">{t("Общие параметры для всех сотрудников. Лимит вложения изменится после сохранения.")}</p>
        <ChatUploadSettings />
      </section>
      <section className="settings-scope" aria-labelledby="maintenance-settings-title">
        <h2 id="maintenance-settings-title">{t("Обслуживание и резервные копии")}</h2>
        <p className="settings-scope-note">{t("Обновление справочников и восстановление баз изменяют общие данные программы. Экспорт настроек относится только к вашей учётной записи.")}</p>
        <section className="settings-group">
          <h2 className="settings-group-title">{t("Обновление данных")}</h2>
          <div className="settings-group-grid">
            <article>
              <h2>{t("Справочник сотрудников")}</h2>
              <p>{t("Загружает актуальные записи из источника и обновляет локальный справочник.")}</p>
              <button onClick={() => run('directory')} disabled={!!busy}>{t(busy === 'directory' ? 'Обновляем…' : 'Обновить справочник')}</button>
            </article>
            <article>
              <h2>{t("Диагностика сети")}</h2>
              <p>{t("Обновляет сохранённый снимок IP-адресов. Экран диагностики работает с этим снимком.")}</p>
              <button onClick={() => run('network')} disabled={!!busy}>{t(busy === 'network' ? 'Обновляем…' : 'Обновить IP-сетку')}</button>
            </article>
          </div>
          {operation && <OperationProgress {...operation} />}
          {message && <div className="settings-message">{Array.isArray(message) ? message.map((part) => t(part)).join(' ') : t(message)}</div>}
          <DirectorySyncReport report={directoryReport} />
        </section>

        <AdminBackups onSettingsRestored={() => {
          setApplicationActionHistoryVisible(userSettingsStorage.getItem('admin.showApplicationActionHistory') === 'true');
          setAuditTestModeEnabled(userSettingsStorage.getItem(AUDIT_TEST_MODE_SETTING_KEY) === 'true');
          setLargeRequestsEnabled(userSettingsStorage.getItem(DASHBOARD_CARD_SIZE_KEY) === 'modern');
          setEditApplicationTableVisible(userSettingsStorage.getItem(SHOW_EDIT_APPLICATION_TABLE_KEY) === 'true');
          onLanguageChange(userSettingsStorage.getItem('adminLanguage') || 'en');
          onThemeChange(userSettingsStorage.getItem('adminTheme') || 'light');
          window.dispatchEvent(new Event(DASHBOARD_CARD_SIZE_EVENT));
          window.dispatchEvent(new Event('admin:application-action-history-visibility'));
        }} />

      </section>
    </main>
  );
}
