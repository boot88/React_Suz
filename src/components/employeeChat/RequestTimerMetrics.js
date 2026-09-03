import React, { memo, useEffect, useMemo, useState } from 'react';
import {
  formatApplicationDuration,
  getApplicationTiming
} from '../../utils/applicationTime';

const ACTIVE_WORK_STATUSES = new Set(['accepted', 'in_progress', 'waiting_employee_confirmation']);

const RequestTimerMetrics = memo(function RequestTimerMetrics({ ticket, t }) {
  const shouldTick = ACTIVE_WORK_STATUSES.has(ticket.status);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!shouldTick) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [shouldTick]);

  const metrics = useMemo(() => {
    const timing = getApplicationTiming(ticket, now);
    const workSeconds = ACTIVE_WORK_STATUSES.has(ticket.status)
      ? timing.workSeconds
      : (ticket.work_seconds ?? timing.workSeconds);
    return { workSeconds };
  }, [now, ticket]);

  if (metrics.workSeconds == null) return null;

  return (
    <div className="ticket-metrics">
      <span>{t('workTime')}: {formatApplicationDuration(metrics.workSeconds)}</span>
    </div>
  );
});

export default RequestTimerMetrics;
