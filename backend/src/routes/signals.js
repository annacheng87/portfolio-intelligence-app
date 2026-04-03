const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { runSignalFusion, getUserSignals } = require('../services/signalFusionService');

// GET /api/signals
router.get('/', requireAuth, async (req, res) => {
  try {
    const signals = await getUserSignals(req.userId);
    res.json({ signals });
  } catch (err) {
    console.error('[signals] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/signals/compute
router.post('/compute', requireAuth, async (req, res) => {
  try {
    res.json({ message: 'Signal computation started' });
    await runSignalFusion();
  } catch (err) {
    console.error('[signals] compute error:', err);
  }
});

module.exports = router;