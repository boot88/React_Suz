import React, { useState } from 'react';
import { syncEmployees } from '../services/employeeService';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch } from '../utils/authFetch';
import './AdminSettings.css';

export default function AdminSettings() {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const run = async (kind) => {
    if (!window.confirm(kind === 'directory' ? 'Обновить справочник сотрудников? Изменения будут сохранены.' : 'Обновить данные IP-сетки?')) return;
    setBusy(kind); setMessage('');
    try {
      if (kind === 'directory') { const data = await syncEmployees(); setMessage(`Справочник обновлён: добавлено ${data.inserted || 0}, обновлено ${data.updated || 0}.`); }
      else { const r = await authFetch(`${API_BASE_URL}/network-map`); const data = await r.json(); if (!r.ok) throw new Error(data.message); sessionStorage.setItem('network-map-cache', JSON.stringify(data)); setMessage('Данные IP-сетки обновлены.'); }
    } catch (e) { setMessage(e.message || 'Не удалось выполнить обновление.'); } finally { setBusy(''); }
  };
  return <main className="admin-settings"><header><p>Настройки</p><h1>Служебные обновления</h1><span>Редкие операции вынесены из рабочих экранов.</span></header><section><article><h2>Справочник сотрудников</h2><p>Загружает актуальные записи из источника и обновляет локальный справочник.</p><button onClick={() => run('directory')} disabled={!!busy}>{busy === 'directory' ? 'Обновляем…' : 'Обновить справочник'}</button></article><article><h2>Диагностика сети</h2><p>Обновляет сохранённый снимок IP-адресов. Экран диагностики работает с этим снимком.</p><button onClick={() => run('network')} disabled={!!busy}>{busy === 'network' ? 'Обновляем…' : 'Обновить IP-сетку'}</button></article></section>{message && <div className="settings-message">{message}</div>}</main>;
}
