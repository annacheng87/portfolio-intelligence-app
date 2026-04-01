// backend/src/services/sentimentNormService.js
// ─────────────────────────────────────────────────────────────────────────────
// Converts raw positive/negative/neutral labels from your existing Reddit
// and News sentiment engines into normalized 0–100 scores.
// Build now so Phase 4 signalFusionService can import it with zero changes.
//
// Zero DB changes. Pure utility — no side effects.
// ─────────────────────────────────────────────────────────────────────────────

// Base scores without confidence data
// Conservative by design — a bare label shouldn't dominate the fusion score
const BASE_SCORES = {
  positive: 70,
  neutral:  50,
  negative: 30,
};

/**
 * Normalize a single raw sentiment result to a 0–100 score.
 *
 * @param {object} raw
 * @param {'positive'|'negative'|'neutral'} raw.label
 * @param {number}  [raw.confidence]    - 0 to 1, optional
 * @param {number}  [raw.mentionCount]  - Reddit mention count, optional
 * @returns {{ score: number, label: string }}
 */
function normalizeSentiment({ label, confidence, mentionCount }) {
  const base = BASE_SCORES[label] ?? 50;

  // Confidence swing: ±20 points
  // confidence=1.0 → +20, confidence=0.5 → 0, confidence=0.0 → -20
  const confSwing = confidence !== undefined
    ? (confidence - 0.5) * 40
    : 0;

  // Mention volume boost for Reddit (capped at +8 to prevent meme-stock spikes)
  const mentionBoost = mentionCount !== undefined
    ? Math.min(8, Math.log10(mentionCount + 1) * 4)
    : 0;

  const score = Math.min(100, Math.max(0, Math.round(base + confSwing + mentionBoost)));

  return { score, label };
}

/**
 * Normalize a Reddit sentiment result.
 * Your redditSentiment.js returns { sentiment: 'positive'|'negative'|'neutral',
 * mentionCount: number } — pass those fields in here.
 *
 * Example:
 *   const raw = { label: 'positive', mentionCount: 143 };
 *   const { score } = normalizeRedditSentiment(raw); // ~76
 */
function normalizeRedditSentiment({ label, confidence, mentionCount }) {
  return normalizeSentiment({ label, confidence, mentionCount });
}

/**
 * Normalize a News sentiment result.
 * Your newsSentiment.js returns { sentiment: 'positive'|'negative'|'neutral' }
 * Pass the label (and confidence if available) here.
 *
 * Example:
 *   const raw = { label: 'negative', confidence: 0.91 };
 *   const { score } = normalizeNewsSentiment(raw); // ~13
 */
function normalizeNewsSentiment({ label, confidence }) {
  return normalizeSentiment({ label, confidence });
}

/**
 * Aggregate multiple sentiment signals for the same ticker into one score.
 * Useful if you scan multiple subreddits or multiple news articles per ticker.
 *
 * @param {Array<{label: string, confidence?: number, mentionCount?: number}>} raws
 * @returns {{ score: number, label: string }}
 */
function aggregateSentiments(raws) {
  if (!raws || !raws.length) return { score: 50, label: 'neutral' };

  const normalized = raws.map(r => normalizeSentiment(r));
  const avgScore   = normalized.reduce((s, n) => s + n.score, 0) / normalized.length;
  const rounded    = Math.round(avgScore);

  const label =
    rounded >= 60 ? 'positive' :
    rounded <= 40 ? 'negative' :
    'neutral';

  return { score: rounded, label };
}

module.exports = {
  normalizeSentiment,
  normalizeRedditSentiment,
  normalizeNewsSentiment,
  aggregateSentiments,
};