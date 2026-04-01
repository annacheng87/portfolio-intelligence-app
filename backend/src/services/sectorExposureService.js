// backend/src/services/sectorExposureService.js
// ─────────────────────────────────────────────────────────────────────────────
// Sector metadata fetch priority:
//   1. FMP API        — clean GICS sector, works for most US stocks
//   2. Yahoo Finance  — works for foreign-incorporated stocks (NBIS etc.)
//   3. Polygon.io     — SIC description pattern matching, last resort
//
// Results cached in security_metadata for 7 days.
// Requires: npm install yahoo-finance2  (run from backend/)
// ─────────────────────────────────────────────────────────────────────────────

const { Pool } = require('pg');
const prisma   = require('../lib/prisma');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const FMP_API_KEY     = process.env.FMP_API_KEY;
const FMP_BASE        = 'https://financialmodelingprep.com/api/v3';
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
const POLYGON_BASE    = 'https://api.polygon.io';
const METADATA_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Sector color map ─────────────────────────────────────────────────────────

const SECTOR_COLORS = {
  'Technology':             '#6366f1',
  'Healthcare':             '#22d3ee',
  'Health Care':            '#22d3ee',
  'Financial Services':     '#f59e0b',
  'Financials':             '#f59e0b',
  'Consumer Cyclical':      '#f97316',
  'Consumer Discretionary': '#f97316',
  'Industrials':            '#84cc16',
  'Communication Services': '#a78bfa',
  'Consumer Defensive':     '#34d399',
  'Consumer Staples':       '#34d399',
  'Energy':                 '#fbbf24',
  'Utilities':              '#60a5fa',
  'Real Estate':            '#f472b6',
  'Basic Materials':        '#94a3b8',
  'Materials':              '#94a3b8',
  'Unknown':                '#475569',
};

function getSectorColor(sector) {
  return SECTOR_COLORS[sector] || SECTOR_COLORS['Unknown'];
}

// ─── Source 1: FMP ────────────────────────────────────────────────────────────

async function fetchFromFMP(ticker) {
  try {
    const url = `${FMP_BASE}/profile/${ticker}?apikey=${FMP_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || !json.length) return null;
    const p = json[0];
    if (!p.sector) return null;
    return {
      companyName: p.companyName || ticker,
      sector:      p.sector,
      industry:    p.industry    || p.sector,
      marketCap:   p.mktCap      || null,
    };
  } catch (err) {
    console.warn(`[sectorExposure] FMP failed for ${ticker}:`, err.message);
    return null;
  }
}

// ─── Source 2: Yahoo Finance (yahoo-finance2 v3) ──────────────────────────────

async function fetchFromYahoo(ticker) {
  try {
    const YahooFinance = require('yahoo-finance2').default;
    const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

    const result = await yf.quoteSummary(ticker, {
      modules: ['summaryProfile', 'price'],
    });

    const sector   = result?.summaryProfile?.sector   || null;
    const industry = result?.summaryProfile?.industry || null;
    const name     = result?.price?.longName || result?.price?.shortName || ticker;
    const mktCap   = result?.price?.marketCap || null;

    if (!sector) return null;

    return {
      companyName: name,
      sector,
      industry:   industry || sector,
      marketCap:  mktCap,
    };
  } catch (err) {
    console.warn(`[sectorExposure] Yahoo Finance failed for ${ticker}:`, err.message);
    return null;
  }
}

// ─── Source 3: Polygon fallback with SIC pattern matching ────────────────────

const SIC_TO_SECTOR = [
  { pattern: /software|computer|semiconductor|electronic|tech|internet|cloud|data|hardware|chip|ai|artificial intelligence|machine learning|cyber|digital|saas|platform/i, sector: 'Technology' },
  { pattern: /pharma|biotech|medical|health|hospital|drug|therapeutics|clinical|genomic|diagnostic|life science/i,                                                           sector: 'Healthcare' },
  { pattern: /bank|financial|insurance|invest|capital|asset management|credit|lending|brokerage|fund|securities|payment/i,                                                   sector: 'Financial Services' },
  { pattern: /retail|restaurant|automotive|luxury|apparel|consumer|entertainment|gaming|leisure|hotel|travel|ecommerce/i,                                                     sector: 'Consumer Cyclical' },
  { pattern: /aerospace|defense|industrial|manufacturing|machinery|transport|freight|logistics|construction|engineering/i,                                                    sector: 'Industrials' },
  { pattern: /telecom|media|broadcast|streaming|wireless|communication|publishing|advertising|social|network/i,                                                               sector: 'Communication Services' },
  { pattern: /food|beverage|household|personal care|tobacco|staple|grocery|packaged/i,                                                                                        sector: 'Consumer Defensive' },
  { pattern: /oil|gas|energy|petroleum|mining|coal|refin|exploration|drilling|renewable|solar|wind/i,                                                                         sector: 'Energy' },
  { pattern: /electric|utility|water|natural gas|power|nuclear/i,                                                                                                             sector: 'Utilities' },
  { pattern: /real estate|reit|property|mortgage|residential|commercial property/i,                                                                                           sector: 'Real Estate' },
  { pattern: /chemical|material|steel|aluminum|paper|packaging|plastic|rubber|metal/i,                                                                                        sector: 'Basic Materials' },
];

async function fetchFromPolygon(ticker) {
  try {
    const url  = `${POLYGON_BASE}/v3/reference/tickers/${ticker}?apiKey=${POLYGON_API_KEY}`;
    const res  = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const p    = json.results;
    if (!p) return null;

    const haystack = `${p.sic_description || ''} ${p.name || ''}`;
    let sector = 'Unknown';
    for (const { pattern, sector: s } of SIC_TO_SECTOR) {
      if (pattern.test(haystack)) { sector = s; break; }
    }
    if (sector === 'Unknown') return null;

    return {
      companyName: p.name            || ticker,
      sector,
      industry:    p.sic_description || sector,
      marketCap:   p.market_cap      || null,
    };
  } catch (err) {
    console.warn(`[sectorExposure] Polygon failed for ${ticker}:`, err.message);
    return null;
  }
}

// ─── Orchestrator: try all three sources in order ─────────────────────────────

async function refreshTickerMetadata(ticker) {
  try {
    const existing = await prisma.securityMetadata.findUnique({ where: { ticker } });
    const isStale  = !existing || (Date.now() - new Date(existing.updatedAt).getTime() > METADATA_TTL_MS);
    if (!isStale) return;

    let result = null;

    // 1. FMP
    result = await fetchFromFMP(ticker);
    if (result) {
      console.log(`[sectorExposure] FMP hit: ${ticker} → ${result.sector}`);
    }

    // 2. Yahoo Finance
    if (!result) {
      result = await fetchFromYahoo(ticker);
      if (result) {
        console.log(`[sectorExposure] Yahoo hit: ${ticker} → ${result.sector}`);
      }
    }

    // 3. Polygon
    if (!result) {
      result = await fetchFromPolygon(ticker);
      if (result) {
        console.log(`[sectorExposure] Polygon hit: ${ticker} → ${result.sector}`);
      }
    }

    if (!result) {
      console.warn(`[sectorExposure] All sources failed for ${ticker} — storing Unknown`);
      result = { companyName: ticker, sector: 'Unknown', industry: 'Unknown', marketCap: null };
    }

    const marketCap = result.marketCap ? BigInt(Math.round(result.marketCap)) : null;

    await prisma.securityMetadata.upsert({
      where:  { ticker },
      update: { companyName: result.companyName, sector: result.sector, industry: result.industry, marketCap },
      create: { ticker, companyName: result.companyName, sector: result.sector, industry: result.industry, marketCap },
    });

  } catch (err) {
    console.error(`[sectorExposure] refreshTickerMetadata failed for ${ticker}:`, err.message);
  }
}

// ─── Batch refresh with 400ms throttle ───────────────────────────────────────

async function ensureSecurityMetadata(tickers) {
  const existing = await prisma.securityMetadata.findMany({
    where: { ticker: { in: tickers } },
  });

  const existingMap    = Object.fromEntries(existing.map(m => [m.ticker, m]));
  const staleOrMissing = tickers.filter(t => {
    const m = existingMap[t];
    return !m || (Date.now() - new Date(m.updatedAt).getTime() > METADATA_TTL_MS);
  });

  if (staleOrMissing.length > 0) {
    console.log(`[sectorExposure] Fetching metadata for: ${staleOrMissing.join(', ')}`);
  }

  for (const ticker of staleOrMissing) {
    await refreshTickerMetadata(ticker);
    if (staleOrMissing.length > 1) {
      await new Promise(r => setTimeout(r, 400));
    }
  }

  const all = await prisma.securityMetadata.findMany({
    where: { ticker: { in: tickers } },
  });

  return Object.fromEntries(
    all.map(m => [m.ticker, {
      sector:      m.sector,
      industry:    m.industry,
      companyName: m.companyName,
    }])
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

async function getUserSectorExposure(userId) {
  const holdingsResult = await pool.query(
    `SELECT h.* FROM "Holding" h
     JOIN "BrokerConnection" bc ON h."brokerConnectionId" = bc.id
     WHERE bc."userId" = $1`,
    [userId]
  );
  const holdings = holdingsResult.rows;

  if (!holdings.length) {
    return {
      sectors:         [],
      totalPortfolio:  0,
      lastComputedAt:  new Date().toISOString(),
      metadataMissing: [],
    };
  }

 const { getSnapshots } = require('./marketData');
const tickers      = [...new Set(holdings.map(h => h.ticker))];
const snapshots    = await getSnapshots(tickers);
const priceMap     = {};
for (const s of snapshots) {
  priceMap[s.ticker] = {
    ticker: s.ticker,
    open:   s.day.o,
    close:  s.day.c,
  };
}

  const metadata = await ensureSecurityMetadata(tickers);

  const missing   = [];
  const positions = holdings.map(h => {
    const qty          = parseFloat(h.quantity);
    const avgCost      = parseFloat(h.avgCostBasis);
    const price        = priceMap[h.ticker];
    const currentPrice = price?.close ?? null;
    const openPrice    = price?.open   ?? null;
    const marketValue  = currentPrice !== null ? qty * currentPrice : qty * avgCost;
    const totalPnl     = currentPrice !== null ? (currentPrice - avgCost) * qty : 0;
    const dailyPnl     = (currentPrice !== null && openPrice !== null)
      ? qty * (currentPrice - openPrice)
      : 0;
    const meta = metadata[h.ticker];

    if (!meta || meta.sector === 'Unknown') missing.push(h.ticker);

    return {
      ticker:      h.ticker,
      marketValue,
      dailyPnl,
      totalPnl,
      sector:      meta?.sector      || 'Unknown',
      industry:    meta?.industry    || 'Unknown',
      companyName: meta?.companyName || h.ticker,
    };
  });

  const totalPortfolio = positions.reduce((s, p) => s + p.marketValue, 0);
  const bySector       = {};

  for (const p of positions) {
    if (!bySector[p.sector]) {
      bySector[p.sector] = { tickers: [], totalValue: 0, dailyPnl: 0, totalPnl: 0 };
    }
    bySector[p.sector].tickers.push(p.ticker);
    bySector[p.sector].totalValue += p.marketValue;
    bySector[p.sector].dailyPnl  += p.dailyPnl;
    bySector[p.sector].totalPnl  += p.totalPnl;
  }

  const sectors = Object.entries(bySector)
    .map(([sector, data]) => ({
      sector,
      totalValue: parseFloat(data.totalValue.toFixed(2)),
      weightPct:  totalPortfolio > 0
        ? parseFloat(((data.totalValue / totalPortfolio) * 100).toFixed(2))
        : 0,
      dailyPnl:   parseFloat(data.dailyPnl.toFixed(2)),
      totalPnl:   parseFloat(data.totalPnl.toFixed(2)),
      tickers:    [...new Set(data.tickers)],
      color:      getSectorColor(sector),
    }))
    .sort((a, b) => b.totalValue - a.totalValue);

  return {
    sectors,
    totalPortfolio:  parseFloat(totalPortfolio.toFixed(2)),
    lastComputedAt:  new Date().toISOString(),
    metadataMissing: [...new Set(missing)],
  };
}

module.exports = {
  getUserSectorExposure,
  refreshTickerMetadata,
  getSectorColor,
};