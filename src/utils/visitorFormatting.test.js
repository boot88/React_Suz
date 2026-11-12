import {
  visitSourceLabel,
  visitRoleLabel,
  visitDeviceLabel,
  formatVisitDuration,
  isVisitOnline,
  fillVisitDays,
  formatVisitDateTime
} from './visitorFormatting';

test('visitor labels map stored codes and keep unknown host names', () => {
  expect(visitSourceLabel('direct')).toBe('Прямой заход');
  expect(visitSourceLabel('yandex')).toBe('Яндекс');
  expect(visitSourceLabel('site:example.org')).toBe('example.org');
  expect(visitSourceLabel('')).toBe('Прямой заход');
  expect(visitRoleLabel('admin')).toBe('Администратор');
  expect(visitRoleLabel('')).toBe('Гость');
  expect(visitDeviceLabel('tablet')).toBe('Планшет');
});

test('duration is formatted in human units and can be translated', () => {
  expect(formatVisitDuration(0)).toBe('0 с');
  expect(formatVisitDuration(45)).toBe('45 с');
  expect(formatVisitDuration(125)).toBe('2 мин 5 с');
  expect(formatVisitDuration(3600)).toBe('1 ч');
  expect(formatVisitDuration(5400, (text) => ({ ч: 'h', мин: 'min' }[text] || text))).toBe('1 h 30 min');
});

test('online status uses the last heartbeat and tolerates a small clock skew', () => {
  const now = new Date('2026-11-09T12:00:00Z').getTime();
  expect(isVisitOnline('2026-11-09T11:59:00Z', now)).toBe(true);
  expect(isVisitOnline('2026-11-09T11:57:00Z', now)).toBe(false);
  expect(isVisitOnline('2026-11-09T12:00:30Z', now)).toBe(true);
  expect(isVisitOnline(null, now)).toBe(false);
});

test('daily series is padded to the selected period with empty days', () => {
  const now = new Date('2026-11-09T12:00:00Z').getTime();
  const result = fillVisitDays([
    { day: '2026-11-09', visits: 4, visitors: 3 },
    { day: '2026-11-07', visits: 2, visitors: 1 }
  ], 3, now);
  expect(result).toEqual([
    { day: '2026-11-07', visits: 2, visitors: 1 },
    { day: '2026-11-08', visits: 0, visitors: 0 },
    { day: '2026-11-09', visits: 4, visitors: 3 }
  ]);
  expect(fillVisitDays([], null)).toEqual([]);
});

test('visit timestamps are shown in Novosibirsk time', () => {
  expect(formatVisitDateTime('2026-11-09T18:30:05Z', 'ru-RU')).toContain('10.11.2026');
  expect(formatVisitDateTime('invalid', 'ru-RU')).toBe('—');
});
