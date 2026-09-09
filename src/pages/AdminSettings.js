import React, { useState } from 'react';
import { syncEmployees } from '../services/employeeService';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch } from '../utils/authFetch';
import './AdminSettings.css';

export default function AdminSettings({ language, theme, onLanguageChange, onThemeChange }) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [accessManagementVisible, setAccessManagementVisible] = useState(() => localStorage.getItem('admin.showAccessManagement') === 'true');
  const [applicationActionHistoryVisible, setApplicationActionHistoryVisible] = useState(() => localStorage.getItem('admin.showApplicationActionHistory') === 'true');
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
  const run = async (kind) => {
    if (!window.confirm(kind === 'directory' ? 'Обновить справочник сотрудников? Изменения будут сохранены.' : 'Обновить данные IP-сетки?')) return;
    setBusy(kind); setMessage('');
    try {
      if (kind === 'directory') { const data = await syncEmployees(); setMessage(`Справочник обновлён: добавлено ${data.inserted || 0}, обновлено ${data.updated || 0}.`); }
      else { const r = await authFetch(`${API_BASE_URL}/network-map`); const data = await r.json(); if (!r.ok) throw new Error(data.message); sessionStorage.setItem('network-map-cache', JSON.stringify(data)); setMessage('Данные IP-сетки обновлены.'); }
    } catch (e) { setMessage(e.message || 'Не удалось выполнить обновление.'); } finally { setBusy(''); }
  };
  return <main className="admin-settings"><header><p>Настройки</p><h1>Служебные обновления</h1><span>Редкие операции вынесены из рабочих экранов.</span></header><section><article><h2>Оформление</h2><p>Язык и тема применяются ко всей админ-панели.</p><div className="settings-choice"><span>Язык</span><div className="settings-segmented" role="group" aria-label="Язык"><button type="button" className={language === 'ru' ? 'active' : ''} onClick={() => onLanguageChange('ru')}>RU</button><button type="button" className={language === 'en' ? 'active' : ''} onClick={() => onLanguageChange('en')}>EN</button></div></div><div className="settings-choice"><span>Тема</span><div className="settings-segmented" role="group" aria-label="Тема"><button type="button" className={theme === 'light' ? 'active' : ''} onClick={() => onThemeChange('light')}>Светлая</button><button type="button" className={theme === 'dark' ? 'active' : ''} onClick={() => onThemeChange('dark')}>Тёмная</button></div></div></article><article><h2>Справочник сотрудников</h2><p>Загружает актуальные записи из источника и обновляет локальный справочник.</p><button onClick={() => run('directory')} disabled={!!busy}>{busy === 'directory' ? 'Обновляем…' : 'Обновить справочник'}</button></article><article><h2>Диагностика сети</h2><p>Обновляет сохранённый снимок IP-адресов. Экран диагностики работает с этим снимком.</p><button onClick={() => run('network')} disabled={!!busy}>{busy === 'network' ? 'Обновляем…' : 'Обновить IP-сетку'}</button></article><article><h2>Управление доступом</h2><p>Показывать пункт регистрации и управления доступом в боковом меню.</p><label className="settings-toggle"><input type="checkbox" checked={accessManagementVisible} onChange={toggleAccessManagement} /><span aria-hidden="true" /><b>{accessManagementVisible ? 'Показывается в меню' : 'Скрыто из меню'}</b></label></article><article><h2>Карточка заявки</h2><p>Показывать в карточке заявки блок «История действий».</p><label className="settings-toggle"><input type="checkbox" checked={applicationActionHistoryVisible} onChange={toggleApplicationActionHistory} /><span aria-hidden="true" /><b>{applicationActionHistoryVisible ? 'История показывается' : 'История скрыта'}</b></label></article></section>{message && <div className="settings-message">{message}</div>}</main>;
}
