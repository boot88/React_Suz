import React, { memo, useEffect, useMemo, useState } from 'react';
import {
  formatApplicationDuration,
  getApplicationTiming
} from '../../utils/applicationTime';

const ACTIVE_WORK_STATUSES = new Set(['accepted', 'in_progress', 'waiting_employee_confirmation']);
const WAITING_STATUSES = new Set(['new', 'reopened']);

const RequestTimerMetrics = memo(function RequestTimerMetrics({ ticket, t }) {
  const isWaiting = WAITING_STATUSES.has(ticket.status);
  const isWorking = ACTIVE_WORK_STATUSES.has(ticket.status);
  const shouldTick = isWaiting || isWorking;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!shouldTick) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [shouldTick]);

  const metrics = useMemo(() => {
    const timing = getApplicationTiming(ticket, now);
    const workSeconds = isWorking
      ? timing.workSeconds
      : (ticket.work_seconds ?? timing.workSeconds);
    return {
      waitingSeconds: isWaiting ? timing.waitingSeconds : null,
      workSeconds: isWorking ? workSeconds : null
    };
  }, [isWaiting, isWorking, now, ticket]);

  if (metrics.waitingSeconds == null && metrics.workSeconds == null) return null;

  return (
    <div className="ticket-metrics">
      {metrics.waitingSeconds != null && <span>{t('waitingTime')}: {formatApplicationDuration(metrics.waitingSeconds)}</span>}
      {metrics.workSeconds != null && <span>{t('workTime')}: {formatApplicationDuration(metrics.workSeconds)}</span>}
    </div>
  );
});

export default RequestTimerMetrics;
