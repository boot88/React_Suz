// server/routes/networkMap.js
// Маршрут карты сети (вынесен из server.js для декомпозиции монолита).
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireRole } = require('../middleware/auth');

const NETWORK_MAP_SOURCE_URL = process.env.NETWORK_MAP_SOURCE_URL || 'http://nioch.nioch.nsc.ru/nioch/nioch.txt';

const ensureNetworkMapSchema = async () => {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS network_map_snapshot (
      id TINYINT PRIMARY KEY,
      source_url VARCHAR(1000) NOT NULL,
      zone_text LONGTEXT NOT NULL,
      fetched_at DATETIME NOT NULL
    )
  `);
};

router.get('/', async (req, res) => {
  try {
    await ensureNetworkMapSchema();
    const [rows] = await pool.execute(
      'SELECT source_url, zone_text, fetched_at FROM network_map_snapshot WHERE id = 1 LIMIT 1'
    );
    const snapshot = rows?.[0];
    if (!snapshot) {
      return res.status(404).json({ error: 'Снимок IP-сетки ещё не создан. Обновите его в настройках.' });
    }
    res.set('Cache-Control', 'no-store');
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
    await ensureNetworkMapSchema();
    const response = await fetch(NETWORK_MAP_SOURCE_URL);
    if (!response.ok) {
      return res.status(response.status).json({ error: `Не удалось загрузить сетку: ${response.status}` });
    }

    const zoneText = await response.text();
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
    res.set('Cache-Control', 'no-store');
    res.json({
      sourceUrl: NETWORK_MAP_SOURCE_URL,
      fetchedAt,
      zoneText
    });
  } catch (error) {
    console.error('Error refreshing network map:', error);
    res.status(500).json({ error: 'Не удалось обновить IP-сетку' });
  }
});

module.exports = router;
