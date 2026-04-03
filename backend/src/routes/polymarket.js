const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { syncEvents } = require('../services/polymarketService');
const { mapAllUnmappedEvents, getRelevantEventsForUser } = require('../services/eventMappingService');
const { runAlertPipeline, getUserAlerts } = require('../services/eventAlertService');

// GET /api/polymarket/relevant-events
router.get('/relevant-events', requireAuth, async (req, res) => {
  try {
    const events = await getRelevantEventsForUser(req.userId);
    res.json({ events });
  } catch (err) {
    console.error('[polymarket] relevant-events error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/polymarket/alerts
router.get('/alerts', requireAuth, async (req, res) => {
  try {
    const alerts = await getUserAlerts(req.userId);
    res.json({ alerts });
  } catch (err) {
    console.error('[polymarket] alerts error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/polymarket/jobs/sync-polymarket
router.post('/jobs/sync-polymarket', requireAuth, async (req, res) => {
  try {
    res.json({ message: 'Sync started' });
    await syncEvents();
    await mapAllUnmappedEvents();
    await runAlertPipeline();
  } catch (err) {
    console.error('[polymarket] sync error:', err);
  }
});

module.exports = router;