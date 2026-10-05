import React, { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAdminTranslation } from '../utils/adminTranslation';
import AdminNotice from './AdminNotice';

export default function MandatoryPasswordChange() {
  const { changeServicePassword, logout } = useAuth();
  const t = useAdminTranslation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const submit = async (event) => {
    event.preventDefault();
    if (lock.current) return;
    if (newPassword !== confirmation) { setError('Пароли не совпадают'); return; }
    if (newPassword === currentPassword) { setError('Новый пароль должен отличаться от временного'); return; }
    lock.current = true; setBusy(true); setError('');
    try { await changeServicePassword({ currentPassword, newPassword }); await logout({ reason: 'expired' }); }
    catch (failure) { setError(failure.message); }
    finally { lock.current = false; setBusy(false); }
  };
  return <main className="admin-settings">
    <h1>{t('Смените временный пароль')}</h1>
    <p>{t('Перед первым входом в админ-панель задайте свой пароль. После сохранения войдите с новым паролем.')}</p>
    <form onSubmit={submit} className="settings-group">
      <label>{t('Временный пароль')}<input type="password" required autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={busy} /></label>
      <label>{t('Новый пароль')}<input type="password" required minLength={8} maxLength={256} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={busy} /></label>
      <label>{t('Повторите новый пароль')}<input type="password" required minLength={8} maxLength={256} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} /></label>
      {error && <AdminNotice type="error">{t(error)}</AdminNotice>}
      <button type="submit" disabled={busy}>{t(busy ? 'Сохранение...' : 'Сохранить пароль')}</button>
      <button type="button" disabled={busy} onClick={() => logout({ reason: 'expired' })}>{t('Выйти')}</button>
    </form>
  </main>;
}
