import AdminNotice from '../components/AdminNotice';
import { useAdminTranslation, getAdminLocale } from '../utils/adminTranslation';
import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import './NetworkMap.css';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch } from '../utils/authFetch';
import networkZone from '../utils/networkZone';
import { getVisibleNetworkRows } from '../utils/networkMapRows';

const { parseNetworkZone, ipToNumber } = networkZone;

const OFFICIAL_SITE_URL = 'http://nioch.nioch.nsc.ru/nioch/';
const NETWORK_MAP_CACHE_KEY = 'network-map-cache';

// Строка таблицы вынесена в memo-компонент: при смене фильтра или поиска
// перерисовываются только адреса, у которых реально изменились данные.
const NetworkRow = memo(({ ip, status, host }) => {
  const t = useAdminTranslation();
  return (
  <tr className={status === 'free' ? 'ip-free' : 'ip-occupied'}>
    <td>{ip}</td>
    <td>{t(status === 'free' ? 'Нет записи' : 'Есть запись')}</td>
    <td>{host}</td>
  </tr>
);
});
NetworkRow.displayName = 'NetworkRow';

const NetworkMap = () => {
  const t = useAdminTranslation();
  const [networkZoneText, setNetworkZoneText] = useState('');
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkError, setNetworkError] = useState('');
  const [networkUpdatedAt, setNetworkUpdatedAt] = useState('');
  const [networkSearch, setNetworkSearch] = useState('');
  const [networkFilter, setNetworkFilter] = useState('all');
  const [expandedNetworks, setExpandedNetworks] = useState(() => new Set());
  // Поле поиска остаётся отзывчивым: тяжёлая фильтрация выполняется
  // в отложенном рендере, а не на каждое нажатие клавиши.
  const deferredNetworkSearch = useDeferredValue(networkSearch);

  const fetchNetworkMap = useCallback(async () => {
    setNetworkLoading(true);
    setNetworkError('');

    try {
      const response = await authFetch(`${API_BASE_URL}/network-map`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || 'Не удалось загрузить сетку');

      setNetworkZoneText(data.zoneText || '');
      setNetworkUpdatedAt(data.fetchedAt || new Date().toISOString());
      try { localStorage.setItem(NETWORK_MAP_CACHE_KEY, JSON.stringify({
        zoneText: data.zoneText || '',
        fetchedAt: data.fetchedAt || new Date().toISOString()
      })); } catch {}
    } catch (err) {
      console.error('Ошибка загрузки сетки:', err);
      setNetworkError(err.message || 'Не удалось загрузить сетку');
    } finally {
      setNetworkLoading(false);
    }
  }, []);

  useEffect(() => {
    let cached;
    try { cached = localStorage.getItem(NETWORK_MAP_CACHE_KEY); } catch {};
    if (cached) {
      try {
        const data = JSON.parse(cached);
        setNetworkZoneText(data.zoneText || '');
        setNetworkUpdatedAt(data.fetchedAt || '');
      } catch {
        // Кэш повреждён — игнорируем и читаем сохранённый SQL-снимок
      }
    }
    fetchNetworkMap();
  }, [fetchNetworkMap]);

  const networkGroups = useMemo(() => parseNetworkZone(networkZoneText), [networkZoneText]);

  const networkStats = useMemo(() => networkGroups.reduce((acc, network) => ({
    networks: acc.networks + 1,
    occupied: acc.occupied + network.occupied.length,
    free: acc.free + network.freeIps.length
  }), { networks: 0, occupied: 0, free: 0 }), [networkGroups]);

  const filteredNetworkGroups = useMemo(() => {
    const query = deferredNetworkSearch.trim().toLowerCase();

    return networkGroups.map((network) => {
      const occupiedRows = network.occupied
        .filter((record) => networkFilter !== 'free')
        .filter((record) => {
          if (!query) return true;
          return `${record.host} ${record.ip} ${network.cidr} ${record.section}`.toLowerCase().includes(query);
        })
        .map((record) => ({ ...record, status: 'occupied' }));

      const freeRows = network.freeIps
        .filter(() => networkFilter !== 'occupied')
        .filter((ip) => !query || `${ip} свободен ${network.cidr} ${network.section}`.toLowerCase().includes(query))
        .map((ip) => ({ ip, host: '—', section: network.section, status: 'free' }));

      return { ...network, rows: [...occupiedRows, ...freeRows].sort((a, b) => ipToNumber(a.ip) - ipToNumber(b.ip)) };
    }).filter((network) => network.rows.length > 0 || (!query && networkFilter === 'all'));
  }, [deferredNetworkSearch, networkFilter, networkGroups]);

  const toggleNetworkRows = useCallback((cidr) => {
    setExpandedNetworks((prev) => {
      const next = new Set(prev);
      if (next.has(cidr)) next.delete(cidr);
      else next.add(cidr);
      return next;
    });
  }, []);

  return (
    <div className="network-map-page">
      <div className="network-page-header">
        <div>
          <span className="network-eyebrow">{t("Сетка / маска сети")}</span>
          <h1>{t("IP-адреса в сохранённом справочнике")}</h1>
        </div>
      </div>

      <p className="network-snapshot-note">{t("Отсутствие записи не подтверждает, что IP свободен. Перед назначением проверьте устройство, DHCP и фактическую занятость адреса.")}</p>
      <div className="network-resource-link">
        <span>{t("Полезная ссылка для справочной информации")}</span>
        <a href={OFFICIAL_SITE_URL} target="_blank" rel="noopener noreferrer">{t("Открыть сайт")}</a>
      </div>

      <div className="network-toolbar">
        <input
          type="text"
          placeholder={t("Поиск: IP, хост, подсеть, раздел...")}
          value={networkSearch}
          onChange={(e) => setNetworkSearch(e.target.value)}
        />
        <select value={networkFilter} onChange={(e) => setNetworkFilter(e.target.value)}>
          <option value="all">{t("Все адреса")}</option>
          <option value="free">{t("Без записи в справочнике")}</option>
          <option value="occupied">{t("С записью в справочнике")}</option>
        </select>
        <span className="network-snapshot-note">{t(networkLoading ? 'Загрузка сохранённого снимка…' : 'Обновление выполняется в настройках')}</span>
      </div>

      <div className="network-summary-grid">
        <div><strong>{networkStats.networks}</strong><span>{t("подсетей /24")}</span></div>
        <div><strong>{networkStats.occupied}</strong><span>{t("уникальных IP с записью")}</span></div>
        <div><strong>{networkStats.free}</strong><span>{t("IP без записи")}</span></div>
        <div><strong>{t(networkUpdatedAt ? new Date(networkUpdatedAt).toLocaleString(getAdminLocale()) : '—')}</strong><span>{t("последнее обновление")}</span></div>
      </div>

      {networkError && <AdminNotice type="error">{t(networkError)}</AdminNotice>}

      <div className="network-tables">
        {filteredNetworkGroups.length === 0 && <div className="network-empty">{t("Сетка не найдена по текущему поиску")}</div>}
        {filteredNetworkGroups.map((network) => {
          const { visibleRows, hiddenCount: hiddenRows, canCollapse } = getVisibleNetworkRows(network.rows, {
            expanded: expandedNetworks.has(network.cidr)
          });

          return (
            <article key={network.cidr} className="network-card">
              <header>
                <div>
                  <h3>{network.cidr}</h3>
                  <p>{t(network.section)}</p>
                </div>
                <div className="network-card-stats">
                  <span className="occupied">{t("С записью: ")}{network.occupied.length}</span>
                  <span className="free">{t("Без записи: ")}{network.freeIps.length}</span>
                </div>
              </header>
              <div className="free-ranges">
                <strong>{t("Диапазоны без записей:")}</strong>
                <span>{t(network.freeRanges.slice(0, 8).join(', ') || 'нет')}</span>
                {network.freeRanges.length > 8 && <em>{t("ещё ")}{network.freeRanges.length - 8}</em>}
              </div>
              <div className="network-table-wrap">
                <table className="network-table">
                  <thead>
                    <tr>
                      <th>IP</th>
                      <th>{t("Статус")}</th>
                      <th>{t("Хост")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <NetworkRow
                        key={`${network.cidr}-${row.ip}-${row.status}`}
                        ip={row.ip}
                        status={row.status}
                        host={row.host}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {(hiddenRows > 0 || canCollapse) && (
                <div className="network-table-footer">
                  <span className="network-table-note">
                    {t(hiddenRows > 0
                      ? `Показаны первые ${visibleRows.length} из ${network.rows.length} адресов`
                      : `Показаны все ${network.rows.length} адресов`)}
                  </span>
                  <button
                    type="button"
                    className="network-table-toggle"
                    onClick={() => toggleNetworkRows(network.cidr)}
                  >
                    {t(canCollapse ? 'Свернуть' : `Показать все (${network.rows.length})`)}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
};

export default NetworkMap;
