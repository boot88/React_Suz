import { getApplicationTiming, toApplicationTimestamp } from './applicationTime';

const DAY_MS = 86400000;

// Compare adjacent half-open windows of exactly equal length. A closed request
// belongs to its final closing date, even if submitted before either window.
export const compareApplicationPeriods = (applications, days, now = Date.now()) => {
  if (!Number.isFinite(days) || days <= 0) return null;
  const end = now + 1;
  const start = end - days * DAY_MS;
  const previousStart = start - days * DAY_MS;
  let excluded = 0;
  const records = applications.flatMap((app) => {
    const created = toApplicationTimestamp(app.created_at || app.data);
    const isClosed = Boolean(app.fl) || app.status === 'done';
    const closed = isClosed ? toApplicationTimestamp(getApplicationTiming(app, now).closedAt) : 0;
    if (!created || (isClosed && (!closed || closed < created))) { excluded += 1; return []; }
    return [{ created, closed }];
  });
  const summarize = (from, to) => {
    let received = 0, closed = 0, opening = 0, remaining = 0;
    for (const record of records) {
      if (record.created >= from && record.created < to) received += 1;
      if (record.closed >= from && record.closed < to) closed += 1;
      if (record.created < from && (!record.closed || record.closed >= from)) opening += 1;
      if (record.created < to && (!record.closed || record.closed >= to)) remaining += 1;
    }
    return { from, to, received, closed, opening, remaining, change: remaining - opening };
  };
  return { current: summarize(start, end), previous: summarize(previousStart, start), excluded };
};
