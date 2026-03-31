const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const requireAuth = require('../middleware/auth');
const {
  getUserAccounts,
  getAccountBalances,
  searchSymbol,
  placeOrder,
  getOrders,
  cancelOrder,
} = require('../services/snaptrade');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Helper — get user's snaptrade credentials
async function getSnapCredentials(userId) {
  const result = await pool.query(
    `SELECT "snaptradeSecret", "snaptradeUserId" FROM "User" WHERE id = $1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row?.snaptradeSecret) throw new Error('No broker connected');
  return {
    userSecret:      row.snaptradeSecret,
    snaptradeUserId: row.snaptradeUserId || userId,
  };
}

// GET /api/trading/accounts
// Returns all broker accounts with balances
router.get('/accounts', requireAuth, async (req, res) => {
  try {
    const { userSecret, snaptradeUserId } = await getSnapCredentials(req.userId);
    const accounts = await getUserAccounts(snaptradeUserId, userSecret);
    if (!accounts || accounts.length === 0) {
      return res.json({ accounts: [] });
    }

    // Fetch balances for each account
    const accountsWithBalances = await Promise.all(
      accounts.map(async account => {
        const balances = await getAccountBalances(snaptradeUserId, userSecret, account.id);
        const cash = balances?.find(b => b.currency?.code === 'USD');
        return {
          id:          account.id,
          name:        account.name,
          number:      account.number,
          institution: account.institution_name || account.brokerage?.name,
          cashBalance: cash?.cash || 0,
          buyingPower: cash?.buying_power || cash?.cash || 0,
        };
      })
    );

    res.json({ accounts: accountsWithBalances });
  } catch (err) {
    console.error('GET ACCOUNTS ERROR:', err.message);
    res.status(500).json({ error: err.message === 'No broker connected' ? 'No broker connected.' : 'Could not fetch accounts.' });
  }
});

// GET /api/trading/symbol/:ticker
// Search for a symbol and return its ID + details
router.get('/symbol/:ticker', requireAuth, async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const symbol = await searchSymbol(ticker);
    if (!symbol) {
      return res.status(404).json({ error: `Symbol ${ticker} not found.` });
    }
    res.json({ symbol });
  } catch (err) {
    console.error('SYMBOL SEARCH ERROR:', err.message);
    res.status(500).json({ error: 'Could not search for symbol.' });
  }
});

// POST /api/trading/order
// Place a buy or sell order
// Body: { accountId, ticker, action, orderType, units, price, stopPrice, timeInForce }
router.post('/order', requireAuth, async (req, res) => {
  const { accountId, ticker, action, orderType, units, price, stopPrice, timeInForce } = req.body;

  // Validate required fields
  if (!accountId)  return res.status(400).json({ error: 'accountId is required.' });
  if (!ticker)     return res.status(400).json({ error: 'ticker is required.' });
  if (!action)     return res.status(400).json({ error: 'action is required (BUY or SELL).' });
  if (!orderType)  return res.status(400).json({ error: 'orderType is required (Market, Limit, Stop).' });
  if (!units || units <= 0) return res.status(400).json({ error: 'units must be a positive number.' });
  if (orderType === 'Limit' && !price)     return res.status(400).json({ error: 'price is required for Limit orders.' });
  if (orderType === 'Stop'  && !stopPrice) return res.status(400).json({ error: 'stopPrice is required for Stop orders.' });
  if (!['BUY','SELL'].includes(action))          return res.status(400).json({ error: 'action must be BUY or SELL.' });
  if (!['Market','Limit','Stop'].includes(orderType)) return res.status(400).json({ error: 'orderType must be Market, Limit, or Stop.' });

  try {
    const { userSecret, snaptradeUserId } = await getSnapCredentials(req.userId);

    // Get symbol ID
    const symbol = await searchSymbol(ticker.toUpperCase());
    if (!symbol) {
      return res.status(404).json({ error: `Symbol ${ticker} not found.` });
    }

    const order = await placeOrder(snaptradeUserId, userSecret, accountId, {
      symbolId:    symbol.id,
      action:      action.toUpperCase(),
      units:       parseFloat(units),
      orderType,
      price:       price       ? parseFloat(price)     : undefined,
      stopPrice:   stopPrice   ? parseFloat(stopPrice) : undefined,
      timeInForce: timeInForce || 'Day',
    });

    console.log(`Order placed: ${action} ${units} ${ticker} (${orderType}) → user ${req.userId}`);
    res.json({ order, message: `${action} order placed successfully.` });
  } catch (err) {
    console.error('PLACE ORDER ERROR:', err?.status, err?.responseBody, err?.message);
    const errMsg = err?.responseBody?.detail || err?.responseBody?.message || err?.message || 'Failed to place order.';
    res.status(500).json({ error: errMsg });
  }
});

// GET /api/trading/orders/:accountId
// Returns order history for an account
router.get('/orders/:accountId', requireAuth, async (req, res) => {
  try {
    const { userSecret, snaptradeUserId } = await getSnapCredentials(req.userId);
    const orders = await getOrders(snaptradeUserId, userSecret, req.params.accountId);
    res.json({ orders: orders || [] });
  } catch (err) {
    console.error('GET ORDERS ERROR:', err.message);
    res.status(500).json({ error: 'Could not fetch orders.' });
  }
});

// DELETE /api/trading/order/:accountId/:orderId
// Cancel a pending order
router.delete('/order/:accountId/:orderId', requireAuth, async (req, res) => {
  try {
    const { userSecret, snaptradeUserId } = await getSnapCredentials(req.userId);
    await cancelOrder(snaptradeUserId, userSecret, req.params.accountId, req.params.orderId);
    res.json({ message: 'Order cancelled.' });
  } catch (err) {
    console.error('CANCEL ORDER ERROR:', err.message);
    res.status(500).json({ error: 'Could not cancel order.' });
  }
});

module.exports = router;