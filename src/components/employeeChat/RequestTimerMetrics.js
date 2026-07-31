import React, { memo, useEffect, useMemo, useState } from 'react';

const ACTIVE_WAITING_STATUSES = new Set(['new', 'reopened']);
const ACTIVE_WORK_STATUSES = new Set(['accepted', 'in_progress', 'waiting_employee_confirmation']);

const secondsSince = (dateValue, now) => {
  if (!dateValue) return 0;
  const startedAt = new Date(dateValue).getTime();
  return Number.isFinite(startedAt) ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
};

const formatDuration = (totalSeconds = 0) => {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  return [hours, minutes, rest].map((value) => String(value).padStart(2, '0')).join(':');
};

const RequestTimerMetrics = memo(function RequestTimerMetrics({ ticket, t }) {
  const shouldTick = ACTIVE_WAITING_STATUSES.has(ticket.status) || ACTIVE_WORK_STATUSES.has(ticket.status);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!shouldTick) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [shouldTick]);

  const metrics = useMemo(() => {
    const waitingStartedAt = ticket.reopened_at || ticket.created_at;
    const waitingSeconds = ticket.waiting_seconds
      ?? (ACTIVE_WAITING_STATUSES.has(ticket.status) ? secondsSince(waitingStartedAt, now) : null);
    const activeWorkSeconds = ACTIVE_WORK_STATUSES.has(ticket.status)
      ? secondsSince(ticket.resolved_at || ticket.work_started_at || ticket.accepted_at, now)
      : 0;
    const workSeconds = ticket.work_seconds != null
      ? Number(ticket.work_seconds || 0) + activeWorkSeconds
      : (ACTIVE_WORK_STATUSES.has(ticket.status)
        ? secondsSince(ticket.work_started_at || ticket.accepted_at, now)
        : null);
    return { waitingSeconds, workSeconds };
  }, [now, ticket]);

  return (
    <div className="ticket-metrics">
      {metrics.waitingSeconds != null && (
        <span>{t('waitingTime')}: {formatDuration(metrics.waitingSeconds)}</span>
      )}
      {metrics.workSeconds != null && metrics.workSeconds > 0 && (
        <span>{t('workTime')}: {formatDuration(metrics.workSeconds)}</span>
      )}
    </div>
  );
});

export default RequestTimerMetrics;
