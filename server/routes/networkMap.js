// server/routes/networkMap.js
// Маршрут карты сети (вынесен из server.js для декомпозиции монолита).
const express = require('express');
const router = express.Router();

const NETWORK_MAP_SOURCE_URL = process.env.NETWORK_MAP_SOURCE_URL || 'http://nioch.nioch.nsc.ru/nioch/nioch.txt';

router.get('/', async (req, res) => {
  try {
    const response = await fetch(NETWORK_MAP_SOURCE_URL);
    if (!response.ok) {
      return res.status(response.status).json({ error: `Не удалось загрузить сетку: ${response.status}` });
    }

    const zoneText = await response.text();
    res.json({
      sourceUrl: NETWORK_MAP_SOURCE_URL,
      fetchedAt: new Date().toISOString(),
      zoneText
    });
  } catch (error) {
    console.error('Error fetching network map:', error);
    res.status(500).json({ error: 'Не удалось загрузить сетку' });
  }
});

module.exports = router;
