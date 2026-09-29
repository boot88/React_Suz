import { NETWORK_ROWS_PREVIEW_LIMIT, getVisibleNetworkRows } from '../utils/networkMapRows';

const buildRows = (count) => Array.from({ length: count }, (unused, index) => ({ ip: `10.0.0.${index + 1}`, status: 'free', host: '—' }));

test('по умолчанию в разметку попадают только первые адреса подсети', () => {
  const { visibleRows, hiddenCount, canCollapse } = getVisibleNetworkRows(buildRows(254));

  expect(visibleRows).toHaveLength(NETWORK_ROWS_PREVIEW_LIMIT);
  expect(hiddenCount).toBe(254 - NETWORK_ROWS_PREVIEW_LIMIT);
  expect(canCollapse).toBe(false);
});

test('раскрытая подсеть показывает все адреса и даёт кнопку «Свернуть»', () => {
  const { visibleRows, hiddenCount, canCollapse } = getVisibleNetworkRows(buildRows(258), { expanded: true });

  expect(visibleRows).toHaveLength(258);
  expect(hiddenCount).toBe(0);
  expect(canCollapse).toBe(true);
});

test('короткий список целиком помещается в карточку', () => {
  const { visibleRows, hiddenCount, canCollapse } = getVisibleNetworkRows(buildRows(3));

  expect(visibleRows).toHaveLength(3);
  expect(hiddenCount).toBe(0);
  expect(canCollapse).toBe(false);
});

test('свой лимит, пустой список и некорректный лимит не ломают расчёт', () => {
  expect(getVisibleNetworkRows(buildRows(10), { limit: 4 }).hiddenCount).toBe(6);
  expect(getVisibleNetworkRows(buildRows(30), { limit: 0 }).visibleRows).toHaveLength(NETWORK_ROWS_PREVIEW_LIMIT);
  expect(getVisibleNetworkRows(buildRows(30), { limit: 'нет' }).visibleRows).toHaveLength(NETWORK_ROWS_PREVIEW_LIMIT);
  expect(getVisibleNetworkRows().visibleRows).toEqual([]);
});

test('строки не копируются, чтобы React.memo не перерисовывал неизменившиеся адреса', () => {
  const rows = buildRows(30);

  expect(getVisibleNetworkRows(rows).visibleRows[0]).toBe(rows[0]);
});
