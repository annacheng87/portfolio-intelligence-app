const axios = require('axios');

const POLYGON_API_KEY = process.env.POLYGON_API_KEY;

// Get previous day close for a single ticker — works on free tier
async function getPreviousClose(ticker) {
  try {
    const res = await axios.get(
      `https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${POLYGON_API_KEY}`
    );
    const result = res.data.results?.[0];
    if (!result) return null;

    return {
      ticker,
      open: result.o,
      close: result.c,
      high: result.h,
      low: result.l,
      volume: result.v,
    };
  } catch (err) {
    console.error(`Failed to fetch price for ${ticker}:`, err.message);
    return null;
  }
}

// Get data for multiple tickers using prev close endpoint (free tier compatible)
async function getSnapshots(tickers) {
  const results = [];

  for (const ticker of tickers) {
    const data = await getPreviousClose(ticker);
    if (data) {
      // Format to match snapshot structure used in alertEvaluator
      results.push({
        ticker: data.ticker,
        day: {
          o: data.open,
          c: data.close,
          h: data.high,
          l: data.low,
          v: data.volume,
        },
        prevDay: {
          v: data.volume,
        },
      });
    }
    // Small delay to avoid rate limiting on free tier
await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return results;
}

module.exports = { getPreviousClose, getSnapshots };