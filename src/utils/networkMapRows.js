// В подсети /24 до 254 адресов: если рисовать их все сразу, в DOM попадает
// больше 5000 строк и браузер тратит секунды на layout. Полный список остаётся
// в данных, но в разметку попадает только начало, пока подсеть не раскрыта.
export const NETWORK_ROWS_PREVIEW_LIMIT = 25;

export const getVisibleNetworkRows = (rows = [], options = {}) => {
  const expanded = options.expanded === true;
  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.floor(requestedLimit)
    : NETWORK_ROWS_PREVIEW_LIMIT;

  const visibleRows = expanded ? rows : rows.slice(0, limit);
  const hiddenCount = rows.length - visibleRows.length;

  return {
    visibleRows,
    hiddenCount,
    canCollapse: expanded && hiddenCount === 0 && rows.length > limit
  };
};
