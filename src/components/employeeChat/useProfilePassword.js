import { useEffect, useRef, useState } from 'react';
import { authFetch } from '../../utils/authFetch';
import { API_BASE_URL } from '../../utils/apiConfig';
import { isNetworkFailure } from './chatPresentation';
export default function useProfilePassword({ english, logout }) {
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordBusy, setPasswordBusy] = useState(false), [passwordError, setPasswordError] = useState('');
  const passwordBusyRef = useRef(false);
  const controllerRef = useRef(null);
  useEffect(() => () => controllerRef.current?.abort(), []);
  const changeMyPassword = async event => {
    event.preventDefault();
    if (passwordBusyRef.current) return;
    const { currentPassword, newPassword, confirmPassword } = passwordForm;
    const error = !currentPassword ? (english ? 'Enter your current password.' : 'Введите текущий пароль.')
      : newPassword.length < 8 || newPassword.length > 256 ? (english ? 'Use 8–256 characters.' : 'Используйте от 8 до 256 символов.')
      : newPassword === currentPassword ? (english ? 'Choose a different password.' : 'Новый пароль должен отличаться от текущего.')
      : newPassword !== confirmPassword ? (english ? 'Passwords do not match.' : 'Пароли не совпадают.') : '';
    setPasswordError(error); if (error) return;
    passwordBusyRef.current = true; setPasswordBusy(true);
    const controller = new AbortController(); controllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await authFetch(`${API_BASE_URL}/auth/change-password`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }), signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(english ? (String(data.message || '').includes('Текущий пароль') ? 'The current password is incorrect.' : 'Could not change password. Check the fields and retry.') : data.message || 'Не удалось сменить пароль');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      window.alert(english ? 'Password updated. Sign in again with your new password.' : 'Пароль обновлён. Войдите снова с новым паролем.');
      await logout({ reason: 'expired' });
    } catch (error) { setPasswordError(error.name === 'AbortError' || isNetworkFailure(error) ? (english ? 'Could not confirm password change. Check your connection. If it was changed, sign in with the new password.' : 'Не удалось подтвердить смену пароля. Проверьте соединение. Если пароль изменился, войдите с новым паролем.') : error.message); }
    finally { clearTimeout(timeout); passwordBusyRef.current = false; setPasswordBusy(false); }
  };

  return { passwordForm, setPasswordForm, passwordBusy, passwordError, changeMyPassword };
}
