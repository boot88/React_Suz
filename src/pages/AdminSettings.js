import React, { useState } from 'react';
import { syncEmployees } from '../services/employeeService';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch } from '../utils/authFetch';
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
        <dt>{label}</dt>
        <dd>{employee[field] || '—'}</dd>
      </div>
    ))}
  </dl>
);

const DirectoryReportGroup = ({ title, count = 0, items = [], tone, renderItem }) => {
  if (!count) return null;
  return (
    <section className={`directory-report-group directory-report-group--${tone}`}>
      <h3>{title} <span>{count}</span></h3>
      <div className="directory-report-list">{items.map(renderItem)}</div>
      {count > items.length && <p className="directory-report-more">Показано {items.length} из {count} записей.</p>}
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
        <div><span>Последнее обновление</span><h2>Изменения сотрудников</h2></div>
        {report.updatedAt && <time>{new Date(report.updatedAt).toLocaleString('ru-RU')}</time>}
      </div>
      {!totalChanges && <p className="directory-report-empty">Изменений нет. Данные сотрудников уже актуальны.</p>}
      <DirectoryReportGroup
        title="Новые сотрудники"
        tone="hired"
        count={inserted.count}
        items={inserted.items || []}
        renderItem={(employee, index) => {
          const female = isFemaleEmployee(employee.full_name);
          return (
            <article key={employee.source_key || `${employee.full_name}-${index}`}>
              <strong>{female ? 'Принята на работу новая сотрудница' : 'Принят на работу новый сотрудник'}</strong>
              <h4>{employee.full_name || 'ФИО не указано'}</h4>
              <EmployeeDetails employee={employee} />
            </article>
          );
        }}
      />
      <DirectoryReportGroup
        title="Переводы и изменения"
        tone="changed"
        count={updated.count}
        items={updated.items || []}
        renderItem={(item, index) => {
          const employee = item.after || item.before || {};
          return (
            <article key={employee.source_key || `${employee.full_name}-${index}`}>
              <strong>Перевели / изменили данные</strong>
              <h4>{employee.full_name || 'ФИО не указано'}</h4>
              <div className="directory-field-changes">
                {(item.changes || []).map((change) => (
                  <div key={change.field}>
                    <b>{change.label}</b>
                    <span><small>Было</small>{change.oldValue || '—'}</span>
                    <i aria-hidden="true">→</i>
                    <span><small>Стало</small>{change.newValue || '—'}</span>
                  </div>
                ))}
              </div>
              <EmployeeDetails employee={employee} />
            </article>
          );
        }}
      />
      <DirectoryReportGroup
        title="Уволенные сотрудники"
        tone="fired"
        count={deactivated.count}
        items={deactivated.items || []}
        renderItem={(employee, index) => (
          <article key={employee.source_key || `${employee.full_name}-${index}`}>
            <strong>{isFemaleEmployee(employee.full_name) ? 'Уволена' : 'Уволен'}</strong>
            <h4>{employee.full_name || 'ФИО не указано'}</h4>
            <EmployeeDetails employee={employee} />
          </article>
        )}
      />
    </div>
  );
};

export default function AdminSettings({ language, theme, onLanguageChange, onThemeChange }) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [directoryReport, setDirectoryReport] = useState(null);
  const [accessManagementVisible, setAccessManagementVisible] = useState(() => localStorage.getItem('admin.showAccessManagement') === 'true');
  const [applicationActionHistoryVisible, setApplicationActionHistoryVisible] = useState(() => localStorage.getItem('admin.showApplicationActionHistory') === 'true');
  const [auditTestModeEnabled, setAuditTestModeEnabled] = useState(() => localStorage.getItem(AUDIT_TEST_MODE_SETTING_KEY) === 'true');
  const toggleAccessManagement = () => {
    const nextValue = !accessManagementVisible;
    localStorage.setItem('admin.showAccessManagement', String(nextValue));
    setAccessManagementVisible(nextValue);
    window.dispatchEvent(new Event('admin:access-management-visibility'));
  };
  const toggleApplicationActionHistory = () => {
    const nextValue = !applicationActionHistoryVisible;
    localStorage.setItem('admin.showApplicationActionHistory', String(nextValue));
    setApplicationActionHistoryVisible(nextValue);
    window.dispatchEvent(new Event('admin:application-action-history-visibility'));
  };
  const toggleAuditTestMode = () => {
    const nextValue = !auditTestModeEnabled;
    localStorage.setItem(AUDIT_TEST_MODE_SETTING_KEY, String(nextValue));
    setAuditTestModeEnabled(nextValue);
  };
  const run = async (kind) => {
    if (!window.confirm(kind === 'directory' ? 'Обновить справочник сотрудников? Изменения будут сохранены.' : 'Обновить данные IP-сетки?')) return;
    setBusy(kind);
    setMessage('');
    if (kind === 'directory') setDirectoryReport(null);
    try {
      if (kind === 'directory') {
        const data = await syncEmployees();
        const createdAccounts = Number(data.accounts?.created || 0);
        setMessage(`Справочник и учётные записи обновлены. Активных сотрудников: ${data.accounts?.total || data.activeAfter || 0}.${createdAccounts ? ` Новых аккаунтов: ${createdAccounts}; начальный пароль — 12345.` : ''}`);
        setDirectoryReport({ ...(data.changes || {}), updatedAt: data.updatedAt });
        window.dispatchEvent(new Event('employee-directory-updated'));
      } else {
        const response = await authFetch(`${API_BASE_URL}/network-map`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.message);
        sessionStorage.setItem('network-map-cache', JSON.stringify(data));
        setMessage('Данные IP-сетки обновлены.');
      }
    } catch (error) {
      setMessage(error.message || 'Не удалось выполнить обновление.');
    } finally {
      setBusy('');
    }
  };
  return <main className="admin-settings"><header><p>Настройки</p><h1>Служебные обновления</h1><span>Редкие операции вынесены из рабочих экранов.</span></header><section><article><h2>Оформление</h2><p>Язык и тема применяются ко всей админ-панели.</p><div className="settings-choice"><span>Язык</span><div className="settings-segmented" role="group" aria-label="Язык"><button type="button" className={language === 'ru' ? 'active' : ''} onClick={() => onLanguageChange('ru')}>RU</button><button type="button" className={language === 'en' ? 'active' : ''} onClick={() => onLanguageChange('en')}>EN</button></div></div><div className="settings-choice"><span>Тема</span><div className="settings-segmented" role="group" aria-label="Тема"><button type="button" className={theme === 'light' ? 'active' : ''} onClick={() => onThemeChange('light')}>Светлая</button><button type="button" className={theme === 'dark' ? 'active' : ''} onClick={() => onThemeChange('dark')}>Тёмная</button></div></div></article><article><h2>Справочник сотрудников</h2><p>Загружает актуальные записи из источника и обновляет локальный справочник.</p><button onClick={() => run('directory')} disabled={!!busy}>{busy === 'directory' ? 'Обновляем…' : 'Обновить справочник'}</button></article><article><h2>Диагностика сети</h2><p>Обновляет сохранённый снимок IP-адресов. Экран диагностики работает с этим снимком.</p><button onClick={() => run('network')} disabled={!!busy}>{busy === 'network' ? 'Обновляем…' : 'Обновить IP-сетку'}</button></article><article><h2>Управление доступом</h2><p>Показывать пункт регистрации и управления доступом в боковом меню.</p><label className="settings-toggle"><input type="checkbox" checked={accessManagementVisible} onChange={toggleAccessManagement} /><span aria-hidden="true" /><b>{accessManagementVisible ? 'Показывается в меню' : 'Скрыто из меню'}</b></label></article><article><h2>Карточка заявки</h2><p>Показывать в карточке заявки блок «История действий».</p><label className="settings-toggle"><input type="checkbox" checked={applicationActionHistoryVisible} onChange={toggleApplicationActionHistory} /><span aria-hidden="true" /><b>{applicationActionHistoryVisible ? 'История показывается' : 'История скрыта'}</b></label></article><article><h2>Поиск документов</h2><p>Тестовый режим показывает переписку по месяцам, включая текущий. Обычный режим показывает периоды старше года.</p><label className="settings-toggle"><input type="checkbox" checked={auditTestModeEnabled} onChange={toggleAuditTestMode} /><span aria-hidden="true" /><b>{auditTestModeEnabled ? 'Тестовый режим включён' : 'Тестовый режим выключен'}</b></label></article></section>{message && <div className="settings-message">{message}</div>}<DirectorySyncReport report={directoryReport} /></main>;
}
