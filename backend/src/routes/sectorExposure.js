// backend/src/routes/sectorExposure.js

const express     = require('express');
const router      = express.Router();
const requireAuth = require('../middleware/auth');
const { getUserSectorExposure, refreshTickerMetadata } = require('../services/sectorExposureService');

router.get('/sector-exposure', requireAuth, async (req, res) => {
  try {
    const data = await getUserSectorExposure(req.userId);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[GET /sector-exposure] error:', err.message);
    res.status(500).json({ error: 'Could not compute sector exposure.' });
  }
});

router.post('/sector-exposure/refresh/:ticker', requireAuth, async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const prisma = require('../lib/prisma');
    await prisma.securityMetadata.deleteMany({ where: { ticker } });
    await refreshTickerMetadata(ticker);
    res.json({ success: true, message: `Metadata refreshed for ${ticker}` });
  } catch (err) {
    console.error('[POST /sector-exposure/refresh] error:', err.message);
    res.status(500).json({ error: 'Could not refresh ticker metadata.' });
  }
});

module.exports = router;