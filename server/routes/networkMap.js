// server/routes/networkMap.js
// Маршрут карты сети (вынесен из server.js для декомпозиции монолита).
const express = require('express');
const { createHash } = require('crypto');
const router = express.Router();
const pool = require('../config/database');
const { parseNetworkZone } = require('../../src/utils/networkZone');
const { requireRole } = require('../middleware/auth');
const { compareNetworkSnapshots } = require('../utils/networkMapChanges');

const NETWORK_MAP_SOURCE_URL = process.env.NETWORK_MAP_SOURCE_URL || 'http://nioch.nioch.nsc.ru/nioch/nioch.txt';

// Снимок меняется только при обновлении источника, поэтому отдаём его браузеру
// с коротким max-age и ETag: повторные входы на страницу не гоняют 70+ КБ текста,
// а при revalidate-запросе отвечаем 304 (см. isClientCacheFresh).
const SNAPSHOT_CACHE_CONTROL = 'private, max-age=60';

let schemaReadyPromise = null;
let refreshPromise = null;

// DDL создаёт таблицу один раз на процесс: раньше он выполнялся при каждом GET.
const ensureNetworkMapSchema = () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = pool.execute(`
      CREATE TABLE IF NOT EXISTS network_map_snapshot (
        id TINYINT PRIMARY KEY,
        source_url VARCHAR(1000) NOT NULL,
        zone_text LONGTEXT NOT NULL,
        fetched_at DATETIME NOT NULL
      )
    `).catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

const readSnapshot = async () => {
  const [rows] = await pool.execute(
    'SELECT source_url, zone_text, fetched_at FROM network_map_snapshot WHERE id = 1 LIMIT 1'
  );
  return rows?.[0] || null;
};

// Express (пакет fresh) отказывается отвечать 304, если в запросе есть
// Cache-Control: no-cache — так делают, например, node-fetch/undici.
// Проверяем If-None-Match сами: RFC 9110 допускает 304 и при revalidate-запросе.
const stripWeakPrefix = (value) => (value.startsWith('W/') ? value.slice(2) : value);

const isClientCacheFresh = (req, etag) => {
  const ifNoneMatch = req.headers['if-none-match'];
  if (!ifNoneMatch) return false;
  const expected = stripWeakPrefix(etag);
  return ifNoneMatch.split(',').some((token) => {
    const value = token.trim();
    return value === '*' || stripWeakPrefix(value) === expected;
  });
};

// External reads are allowed only from the administrator's POST /refresh.
// Importing this module, restarting the server and GET / never fetch the source.
const refreshSnapshot = async () => {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      await ensureNetworkMapSchema();
      const response = await fetch(NETWORK_MAP_SOURCE_URL, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        const error = new Error(`Не удалось загрузить сетку: ${response.status}`);
        error.status = response.status;
        throw error;
      }

      const zoneText = await response.text();
      if (Buffer.byteLength(zoneText, 'utf8') > 2 * 1024 * 1024 || !parseNetworkZone(zoneText).length) {
        throw Object.assign(new Error('Источник не содержит корректных IP-записей. Прежний снимок сохранён.'), { status: 422 });
      }
      const previous = await readSnapshot();
      const changes = compareNetworkSnapshots(previous?.zone_text || '', zoneText, { initialLoad: !previous });
      const fetchedAt = new Date();
      await pool.execute(
        `INSERT INTO network_map_snapshot (id, source_url, zone_text, fetched_at)
         VALUES (1, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           source_url = VALUES(source_url),
           zone_text = VALUES(zone_text),
           fetched_at = VALUES(fetched_at)`,
        [NETWORK_MAP_SOURCE_URL, zoneText, fetchedAt]
      );
      return { sourceUrl: NETWORK_MAP_SOURCE_URL, fetchedAt, zoneText, changes };
    })();
  }

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
};

router.get('/', async (req, res) => {
  try {
    await ensureNetworkMapSchema();
    const snapshot = await readSnapshot();
    if (!snapshot) {
      return res.status(404).json({ error: 'Снимок IP-сетки ещё не создан. Обновите его в настройках.' });
    }
    // Content-based ETag also detects two manual updates within one second.
    const version = createHash('sha256').update(snapshot.zone_text).digest('hex');
    const etag = `W/"network-map-${version}"`;
    res.set('Cache-Control', SNAPSHOT_CACHE_CONTROL);
    res.set('ETag', etag);
    if (isClientCacheFresh(req, etag)) return res.status(304).end();
    return res.json({
      sourceUrl: snapshot.source_url,
      fetchedAt: snapshot.fetched_at,
      zoneText: snapshot.zone_text
    });
  } catch (error) {
    console.error('Error reading network map snapshot:', error);
    return res.status(500).json({ error: 'Не удалось прочитать сохранённую IP-сетку' });
  }
});

router.post('/refresh', requireRole('admin'), async (req, res) => {
  try {
    const snapshot = await refreshSnapshot();
    res.set('Cache-Control', 'no-store');
    res.json(snapshot);
  } catch (error) {
    console.error('Error refreshing network map:', error);
    res.status(error.status || 500).json({ error: error.message || 'Не удалось обновить IP-сетку' });
  }
});

module.exports = router;
