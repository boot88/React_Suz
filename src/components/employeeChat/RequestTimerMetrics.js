import React, { memo, useEffect, useMemo, useState } from 'react';
import {
  formatApplicationDuration,
  getApplicationTiming
} from '../../utils/applicationTime';

const ACTIVE_WAITING_STATUSES = new Set(['new', 'reopened']);
const ACTIVE_WORK_STATUSES = new Set(['accepted', 'in_progress', 'waiting_employee_confirmation']);

const RequestTimerMetrics = memo(function RequestTimerMetrics({ ticket, t }) {
  const shouldTick = ACTIVE_WAITING_STATUSES.has(ticket.status) || ACTIVE_WORK_STATUSES.has(ticket.status);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!shouldTick) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [shouldTick]);

  const metrics = useMemo(() => {
    const timing = getApplicationTiming(ticket, now);
    // A legacy row may contain waiting_seconds = 0 while it is still new.
    // For an active request the clock must always be derived from timestamps.
    const waitingSeconds = ACTIVE_WAITING_STATUSES.has(ticket.status)
      ? timing.waitingSeconds
      : (ticket.waiting_seconds ?? timing.waitingSeconds);
    const workSeconds = ACTIVE_WORK_STATUSES.has(ticket.status)
      ? timing.workSeconds
      : (ticket.work_seconds ?? timing.workSeconds);
    return { waitingSeconds, workSeconds };
  }, [now, ticket]);

  return (
    <div className="ticket-metrics">
      {metrics.waitingSeconds != null && (
        <span>{t('waitingTime')}: {formatApplicationDuration(metrics.waitingSeconds)}</span>
      )}
      {metrics.workSeconds != null && (
        <span>{t('workTime')}: {formatApplicationDuration(metrics.workSeconds)}</span>
      )}
    </div>
  );
});

export default RequestTimerMetrics;
