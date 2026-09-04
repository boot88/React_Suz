export const APPLICATION_TIME_ZONE = 'Asia/Novosibirsk';

const toApplicationDate = (value) => {
  if (!value) return null;
  const raw = String(value).trim();
  // MySQL DATETIME values have no timezone. The server writes their UTC
  // components, so make that explicit before a browser converts them to
  // Novosibirsk time.
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const toApplicationTimestamp = (value) => {
  return toApplicationDate(value)?.getTime() || 0;
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
  const date = toApplicationDate(value);
  if (!date) return '—';
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
  // `data` is a legacy DATE column and therefore contains no clock time.
  // Exact lifecycle calculations must use the UTC `created_at` timestamp.
  const createdAt = application.created_at || application.data || '';
  const hasTakenMarker = Boolean(
    application.work_started_at
    || application.accepted_at
    || application.accepted_by
  );
  const takenAt = application.work_started_at
    || application.accepted_at
    || (hasTakenMarker ? application.start_data : '')
    || '';
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
    waitingSeconds: createdAt && (takenAt || !isClosed)
      ? secondsBetweenApplicationDates(createdAt, takenAt || liveEnd)
      : null,
    workSeconds: takenAt
      ? secondsBetweenApplicationDates(takenAt, liveEnd)
      : null
  };
};
