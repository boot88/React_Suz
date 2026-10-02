import { compareApplicationPeriods } from './statisticsComparison';
const day = 86400000;
const now = Date.parse('2026-10-02T09:00:00Z');
const date = (offset) => new Date(now + offset * day).toISOString();
const open = (id, offset, other = {}) => ({ id, created_at: date(offset), ...other });
const done = (id, created, closed, other = {}) => open(id, created, { fl: true, status: 'done', end_data: date(closed), ...other });

test('compares equal windows and closes requests submitted before the current period', () => {
  const result = compareApplicationPeriods([
    open(1, -20), done(2, -15, -3), open(3, -2), done(4, -10, -8), done(5, -2, -1)
  ], 7, now);
  expect(result.current.received).toBe(2);
  expect(result.current.closed).toBe(2);
  expect(result.current.opening).toBe(2);
  expect(result.current.remaining).toBe(2);
  expect(result.current.change).toBe(0);
  expect(result.previous.received).toBe(1);
  expect(result.previous.closed).toBe(1);
  expect(result.previous.remaining).toBe(result.current.opening);
  expect(result.current.to - result.current.from).toBe(result.previous.to - result.previous.from);
});
test('half-open boundaries assign a request or closure to exactly one period', () => {
  const start = now + 1 - 7 * day;
  const previousStart = start - 7 * day;
  const result = compareApplicationPeriods([
    { created_at: new Date(start).toISOString() },
    { created_at: new Date(previousStart).toISOString(), status: 'done', end_data: new Date(start).toISOString() },
    open(3, 1)
  ], 7, now);
  expect(result.current.received).toBe(1);
  expect(result.previous.received).toBe(1);
  expect(result.current.closed).toBe(1);
  expect(result.previous.closed).toBe(0);
  expect(result.current.remaining).toBe(1);
});
test('waiting for confirmation is open and reopening does not count as final closure', () => {
  const result = compareApplicationPeriods([
    open(1, -8, { status: 'waiting_employee_confirmation', resolved_at: date(-1) }),
    open(2, -9, { status: 'reopened', fl: false, end_data: date(-2), work_cycles: [{ taken_at: date(-5), closed_at: date(-2) }] })
  ], 7, now);
  expect(result.current.closed).toBe(0);
  expect(result.current.remaining).toBe(2);
});
test('uses the confirmation timestamp before the earlier completion timestamp', () => {
  const result = compareApplicationPeriods([done(1, -10, -8, { employee_confirmed_at: date(-1), resolved_at: date(-9) })], 7, now);
  expect(result.current.closed).toBe(1);
  expect(result.previous.closed).toBe(0);
});
test('ignores malformed lifecycle dates explicitly instead of inventing a closing date', () => {
  const result = compareApplicationPeriods([{ created_at: 'bad' }, open(1, -3, { fl: true }), done(2, -2, -3)], 7, now);
  expect(result.excluded).toBe(3);
  expect(result.current.received).toBe(0);
});
test('no finite comparison for all-time, and empty data produces zeros', () => {
  expect(compareApplicationPeriods([], NaN, now)).toBeNull();
  expect(compareApplicationPeriods([], 7, now).current).toMatchObject({ received: 0, closed: 0, remaining: 0, change: 0 });
});
