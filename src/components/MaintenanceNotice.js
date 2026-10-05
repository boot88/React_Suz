import React, { useEffect, useRef, useState } from 'react';
import AdminNotice from './AdminNotice';
import { authFetch } from '../utils/authFetch';
import { API_BASE_URL } from '../utils/apiConfig';
import { useAdminTranslation } from '../utils/adminTranslation';

export default function MaintenanceNotice() {
  const t = useAdminTranslation();
  const [status, setStatus] = useState({ active: false });
  const active = useRef(false);
  useEffect(() => {
    const onChange = (event) => {
      const next = event.detail;
      if (active.current && !next?.active) window.dispatchEvent(new Event('admin:data-restored'));
      active.current = Boolean(next?.active); setStatus(next);
    };
    window.addEventListener('admin:maintenance', onChange);
    return () => window.removeEventListener('admin:maintenance', onChange);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const check = async () => {
      if (busy) return; busy = true;
      try {
        const response = await authFetch(`${API_BASE_URL}/backups/status`, { signal: controller.signal });
        if (!response.ok) return;
        const next = await response.json();
        if (!controller.signal.aborted) window.dispatchEvent(new CustomEvent('admin:maintenance', { detail: next }));
      } catch {} finally { busy = false; }
    };
    check();
    const timer = setInterval(check, status?.active ? 2000 : 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [status?.active]);
  if (!status?.active) return null;
  return <AdminNotice type="warning">{t(status.operation === 'export'
    ? 'Создаётся резервная копия. Просмотр доступен; дождитесь завершения перед изменением данных.'
    : 'Выполняется обслуживание данных. Дождитесь завершения операции; затем данные обновятся автоматически.')}</AdminNotice>;
}
