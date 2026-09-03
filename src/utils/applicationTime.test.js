import {
  formatApplicationDateTime,
  formatApplicationDuration,
  getApplicationTiming
} from './applicationTime';

test('formats long request durations with days', () => {
  expect(formatApplicationDuration(93784)).toBe('1 дн. 02:03:04');
});

test('formats request timestamps in Novosibirsk time', () => {
  expect(formatApplicationDateTime('2026-09-03T09:44:14.000Z')).toBe('03.09.2026, 16:44:14');
});

test('calculates request lifecycle intervals from created, accepted and closed timestamps', () => {
  expect(getApplicationTiming({
    status: 'done',
    fl: true,
    created_at: '2026-09-03T09:00:00.000Z',
    accepted_at: '2026-09-03T09:05:00.000Z',
    work_started_at: '2026-09-03T09:05:00.000Z',
    employee_confirmed_at: '2026-09-03T10:00:00.000Z'
  })).toMatchObject({
    totalSeconds: 3600,
    waitingSeconds: 300,
    workSeconds: 3300
  });
});

test('uses the exact creation timestamp instead of the legacy date-only value', () => {
  expect(getApplicationTiming({
    status: 'new',
    data: '2026-09-03T00:00:00.000Z',
    created_at: '2026-09-03T05:46:00.000Z'
  }, new Date('2026-09-03T05:47:00.000Z').getTime()).waitingSeconds).toBe(60);
});

test('counts waiting time for an open chat request until it is accepted', () => {
  expect(getApplicationTiming({
    status: 'new',
    source: 'chat',
    created_at: '2026-09-03T05:46:00.000Z'
  }, new Date('2026-09-03T05:46:03.000Z').getTime()).waitingSeconds).toBe(3);
});

test('does not invent taken or work time when an administrator closes a new request directly', () => {
  expect(getApplicationTiming({
    status: 'done',
    fl: true,
    data: '2026-09-03T00:00:00.000Z',
    created_at: '2026-09-03T05:46:00.000Z',
    start_data: '2026-09-03T05:46:00.000Z',
    employee_confirmed_at: '2026-09-03T05:51:00.000Z'
  })).toMatchObject({
    totalSeconds: 300,
    waitingSeconds: null,
    workSeconds: null,
    takenAt: ''
  });
});
