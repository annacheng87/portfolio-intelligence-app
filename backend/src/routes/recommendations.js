const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { runRecommendationEngine, getUserRecommendations } = require('../services/recommendationService');

// GET /api/recommendations
router.get('/', requireAuth, async (req, res) => {
  try {
    const recommendations = await getUserRecommendations(req.userId);
    res.json({ recommendations });
  } catch (err) {
    console.error('[recommendations] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/recommendations/compute
router.post('/compute', requireAuth, async (req, res) => {
  try {
    res.json({ message: 'Recommendation engine started' });
    await runRecommendationEngine(req.userId);
  } catch (err) {
    console.error('[recommendations] compute error:', err);
  }
});

module.exports = router;