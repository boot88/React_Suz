export const APPLICATION_TIME_ZONE = 'Asia/Novosibirsk';

export const toApplicationTimestamp = (value) => {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const secondsBetweenApplicationDates = (startValue, endValue) => {
  const start = toApplicationTimestamp(startValue);
  const end = toApplicationTimestamp(endValue);
  if (!start || !end) return null;
  return Math.max(0, Math.floor((end - start) / 1000));
};

export const formatApplicationDuration = (totalSeconds = 0) => {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const clock = [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
  return days > 0 ? `${days} дн. ${clock}` : clock;
};

export const formatApplicationDateTime = (value, locale = 'ru-RU', options = {}) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(locale, {
    timeZone: APPLICATION_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...options
  });
};

export const getApplicationTiming = (application = {}, now = Date.now()) => {
  const createdAt = application.created_at || application.data || '';
  const takenAt = application.work_started_at || application.accepted_at || application.start_data || '';
  const isClosed = Boolean(application.fl) || application.status === 'done';
  const closedAt = isClosed
    ? (application.employee_confirmed_at || application.end_data || application.resolved_at || '')
    : '';
  const liveEnd = closedAt || new Date(now).toISOString();

  return {
    createdAt,
    takenAt,
    closedAt,
    totalSeconds: createdAt ? secondsBetweenApplicationDates(createdAt, liveEnd) : null,
    waitingSeconds: createdAt
      ? secondsBetweenApplicationDates(createdAt, takenAt || liveEnd)
      : null,
    workSeconds: takenAt
      ? secondsBetweenApplicationDates(takenAt, liveEnd)
      : null
  };
};
