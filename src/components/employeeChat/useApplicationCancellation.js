import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../utils/apiConfig';
import { authFetch } from '../../utils/authFetch';

export default function useApplicationCancellation({ english, confirmAction, onCancelled, refresh }) {
  const pending = useRef(new Set()), controllers = useRef(new Map()), mounted = useRef(true);
  const [cancellingApplicationIds, setPending] = useState([]);
  const [cancellationErrors, setErrors] = useState({});
  const [cancellationNotice, setNotice] = useState('');
  useEffect(() => {
    mounted.current = true;
    const requests = controllers.current;
    return () => { mounted.current = false; requests.forEach(controller => controller.abort()); };
  }, []);
  const cancelApplication = async id => {
    const key = String(id);
    if (pending.current.has(key)) return;
    pending.current.add(key); setPending([...pending.current]);
    let timeout;
    try {
      const confirmed = await confirmAction(english ? `Cancel request #${id}? It will disappear from your requests and the administrators’ list.` : `Отменить заявку №${id}? Она исчезнет из ваших заявок и списка администраторов.`, english ? 'Cancel request' : 'Отмена заявки');
      if (!confirmed || !mounted.current) return;
      setErrors(current => ({ ...current, [key]: '' })); setNotice('');
      const controller = new AbortController(); controllers.current.set(key, controller);
      timeout = setTimeout(() => controller.abort(), 15000);
      const response = await authFetch(`${API_BASE_URL}/applications/${encodeURIComponent(key)}/cancel`, { method: 'POST', signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 404) {
        if (response.status === 409) refresh?.();
        const error = new Error(english ? (response.status === 409 ? 'This request has already been completed or changed. Refresh the list.' : 'Could not cancel request. Please retry.') : data.error || 'Не удалось отменить заявку. Повторите попытку.');
        error.serverResponse = true;
        throw error;
      }
      if (!mounted.current) return;
      onCancelled(id);
      setNotice(english ? `Request #${id} cancelled.` : `Заявка №${id} отменена.`);
    } catch (error) {
      if (mounted.current) setErrors(current => ({ ...current, [key]: error.serverResponse ? error.message : english ? 'Could not confirm cancellation. Check your connection and retry.' : 'Не удалось подтвердить отмену. Проверьте соединение и повторите попытку.' }));
    } finally {
      clearTimeout(timeout); controllers.current.delete(key); pending.current.delete(key);
      if (mounted.current) setPending([...pending.current]);
    }
  };
  return { cancelApplication, cancellingApplicationIds, cancellationErrors, cancellationNotice };
}
