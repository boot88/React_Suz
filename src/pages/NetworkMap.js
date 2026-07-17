import React, { useEffect, useMemo, useState } from 'react';
import './NetworkMap.css';
import { API_BASE_URL } from '../utils/apiConfig';

const NETWORK_SOURCE_URL = 'http://nioch.nioch.nsc.ru/nioch/nioch.txt';
const OFFICIAL_SITE_URL = 'http://nioch.nioch.nsc.ru/nioch/';
const IP_LAST_OCTET_MIN = 1;
const IP_LAST_OCTET_MAX = 254;

const ipToNumber = (ip) => ip.split('.').reduce((sum, part) => (sum * 256) + Number(part), 0);
const getNetworkKey = (ip) => ip.split('.').slice(0, 3).join('.');
const getNetworkCidr = (networkKey) => `${networkKey}.0/24`;

const getFreeIpRanges = (freeIps) => {
  if (freeIps.length === 0) return [];
  const ranges = [];
  let start = freeIps[0];
  let previous = freeIps[0];

  for (let index = 1; index < freeIps.length; index += 1) {
    const current = freeIps[index];
    if (ipToNumber(current) === ipToNumber(previous) + 1) {
      previous = current;
      continue;
    }
    ranges.push(start === previous ? start : `${start} — ${previous}`);
    start = current;
    previous = current;
  }

  ranges.push(start === previous ? start : `${start} — ${previous}`);
  return ranges;
};

const parseNetworkZone = (zoneText = '') => {
  const records = [];
  let currentSection = 'Без раздела';

  zoneText.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.startsWith(';')) {
      const label = trimmed.replace(/^;+/, '').replace(/;+$/g, '').trim();
      if (label) currentSection = label;
      return;
    }

    const cleanLine = line.split(';')[0].trim();
    const match = cleanLine.match(/^(\S+)\s+IN\s+A\s+((?:\d{1,3}\.){3}\d{1,3})\b/i);
    if (!match) return;

    const [, host, ip] = match;
    const octets = ip.split('.').map(Number);
    if (octets.length !== 4 || octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return;

    records.push({
      host,
      ip,
      networkKey: getNetworkKey(ip),
      section: currentSection
    });
  });

  const byNetwork = records.reduce((acc, record) => {
    if (!acc[record.networkKey]) acc[record.networkKey] = [];
    acc[record.networkKey].push(record);
    return acc;
  }, {});

  return Object.entries(byNetwork).map(([networkKey, networkRecords]) => {
    const occupiedLastOctets = new Set(networkRecords.map((record) => Number(record.ip.split('.')[3])));
    const freeIps = [];

    for (let last = IP_LAST_OCTET_MIN; last <= IP_LAST_OCTET_MAX; last += 1) {
      if (!occupiedLastOctets.has(last)) freeIps.push(`${networkKey}.${last}`);
    }

    return {
      networkKey,
      cidr: getNetworkCidr(networkKey),
      section: networkRecords[0]?.section || 'Без раздела',
      occupied: networkRecords.sort((a, b) => ipToNumber(a.ip) - ipToNumber(b.ip)),
      freeIps,
      freeRanges: getFreeIpRanges(freeIps)
    };
  }).sort((a, b) => ipToNumber(`${a.networkKey}.0`) - ipToNumber(`${b.networkKey}.0`));
};

const NetworkMap = () => {
  const [networkZoneText, setNetworkZoneText] = useState('');
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkError, setNetworkError] = useState('');
  const [networkUpdatedAt, setNetworkUpdatedAt] = useState('');
  const [networkSearch, setNetworkSearch] = useState('');
  const [networkFilter, setNetworkFilter] = useState('all');

  const fetchNetworkMap = async ({ silent = false } = {}) => {
    if (!silent) setNetworkLoading(true);
    setNetworkError('');

    try {
      const response = await fetch(`${API_BASE_URL}/network-map`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || 'Не удалось загрузить сетку');

      setNetworkZoneText(data.zoneText || '');
      setNetworkUpdatedAt(data.fetchedAt || new Date().toISOString());
    } catch (err) {
      console.error('Ошибка загрузки сетки:', err);
      setNetworkError(err.message || 'Не удалось загрузить сетку');
    } finally {
      if (!silent) setNetworkLoading(false);
    }
  };

  useEffect(() => {
    fetchNetworkMap({ silent: true });
  }, []);

  const networkGroups = useMemo(() => parseNetworkZone(networkZoneText), [networkZoneText]);

  const networkStats = useMemo(() => networkGroups.reduce((acc, network) => ({
    networks: acc.networks + 1,
    occupied: acc.occupied + network.occupied.length,
    free: acc.free + network.freeIps.length
  }), { networks: 0, occupied: 0, free: 0 }), [networkGroups]);

  const filteredNetworkGroups = useMemo(() => {
    const query = networkSearch.trim().toLowerCase();

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
  }, [networkFilter, networkGroups, networkSearch]);

  return (
    <div className="network-map-page">
      <div className="network-page-header">
        <div>
          <span className="network-eyebrow">Сетка / маска сети</span>
          <h1>Свободные и занятые IP-адреса</h1>
          <p>Источник: <a href={NETWORK_SOURCE_URL} target="_blank" rel="noopener noreferrer">nioch.txt</a></p>
        </div>
        <button type="button" className="network-refresh-btn" onClick={() => fetchNetworkMap({ silent: false })} disabled={networkLoading}>
          {networkLoading ? 'Обновляем...' : 'Обновить сетку'}
        </button>
      </div>

      <div className="network-resource-link">
        <span>Полезная ссылка для справочной информации</span>
        <a href={OFFICIAL_SITE_URL} target="_blank" rel="noopener noreferrer">Открыть сайт</a>
      </div>

      <div className="network-toolbar">
        <input
          type="text"
          placeholder="Поиск: IP, хост, подсеть, раздел..."
          value={networkSearch}
          onChange={(e) => setNetworkSearch(e.target.value)}
        />
        <select value={networkFilter} onChange={(e) => setNetworkFilter(e.target.value)}>
          <option value="all">Все адреса</option>
          <option value="free">Только свободные</option>
          <option value="occupied">Только занятые</option>
        </select>
      </div>

      <div className="network-summary-grid">
        <div><strong>{networkStats.networks}</strong><span>подсетей /24</span></div>
        <div><strong>{networkStats.occupied}</strong><span>занятых IP</span></div>
        <div><strong>{networkStats.free}</strong><span>свободных IP</span></div>
        <div><strong>{networkUpdatedAt ? new Date(networkUpdatedAt).toLocaleString('ru-RU') : '—'}</strong><span>последнее обновление</span></div>
      </div>

      {networkError && <div className="network-error">{networkError}</div>}

      <div className="network-tables">
        {filteredNetworkGroups.length === 0 && <div className="network-empty">Сетка не найдена по текущему поиску</div>}
        {filteredNetworkGroups.map((network) => (
          <article key={network.cidr} className="network-card">
            <header>
              <div>
                <h3>{network.cidr}</h3>
                <p>{network.section}</p>
              </div>
              <div className="network-card-stats">
                <span className="occupied">Занято: {network.occupied.length}</span>
                <span className="free">Свободно: {network.freeIps.length}</span>
              </div>
            </header>
            <div className="free-ranges">
              <strong>Свободные диапазоны:</strong>
              <span>{network.freeRanges.slice(0, 8).join(', ') || 'нет'}</span>
              {network.freeRanges.length > 8 && <em>ещё {network.freeRanges.length - 8}</em>}
            </div>
            <div className="network-table-wrap">
              <table className="network-table">
                <thead>
                  <tr>
                    <th>IP</th>
                    <th>Статус</th>
                    <th>Хост</th>
                  </tr>
                </thead>
                <tbody>
                  {network.rows.map((row) => (
                    <tr key={`${network.cidr}-${row.ip}-${row.status}`} className={row.status === 'free' ? 'ip-free' : 'ip-occupied'}>
                      <td>{row.ip}</td>
                      <td>{row.status === 'free' ? 'Свободен' : 'Занят'}</td>
                      <td>{row.host}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};

export default NetworkMap;
