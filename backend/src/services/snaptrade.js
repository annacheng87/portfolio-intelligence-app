const { Snaptrade } = require('snaptrade-typescript-sdk');

const client = new Snaptrade({
  clientId: process.env.SNAPTRADE_CLIENT_ID,
  consumerKey: process.env.SNAPTRADE_CONSUMER_KEY,
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function registerSnaptradeUser(userId) {
  try {
    const response = await client.authentication.registerSnapTradeUser({ userId });
    return response.data;
  } catch (err) {
    const status = err?.status;
    const code   = err?.responseBody?.code;
    console.error('Snaptrade register error — status:', status, '| code:', code);
    if ((status === 400 && code === '1012') || status === 409) {
      console.log('Snaptrade user already exists — will use existing secret from DB');
      return null;
    }
    throw err;
  }
}

async function deleteSnaptradeUser(userId, userSecret) {
  try {
    await client.authentication.deleteSnapTradeUser({ userId, userSecret });
    console.log('Snaptrade user deleted:', userId);
  } catch (err) {
    console.error('Snaptrade delete user error:', err?.status, err?.responseBody?.code);
    throw err;
  }
}

async function generateConnectionLink(userId, userSecret) {
  try {
    const response = await client.authentication.loginSnapTradeUser({ userId, userSecret });
    return response.data;
  } catch (err) {
    console.error('Snaptrade connection link error — status:', err?.status, '| code:', err?.responseBody?.code);
    throw err;
  }
}

// ─── Account info ─────────────────────────────────────────────────────────────

async function getUserAccounts(userId, userSecret) {
  try {
    const response = await client.accountInformation.listUserAccounts({ userId, userSecret });
    return response.data;
  } catch (err) {
    console.error('Snaptrade get accounts error:', err.message);
    throw err;
  }
}

async function getAccountHoldings(userId, userSecret, accountId) {
  try {
    const response = await client.accountInformation.getUserHoldings({ userId, userSecret, accountId });
    return response.data;
  } catch (err) {
    console.error('Snaptrade get holdings error:', err.message);
    throw err;
  }
}

async function getAllHoldings(userId, userSecret) {
  try {
    const accounts = await getUserAccounts(userId, userSecret);
    if (!accounts || accounts.length === 0) return [];

    const allHoldings = [];
    for (const account of accounts) {
      const holdings = await getAccountHoldings(userId, userSecret, account.id);
      if (holdings?.positions) {
        for (const position of holdings.positions) {
          allHoldings.push({
            accountId:    account.id,
            accountName:  account.name,
            ticker:       position.symbol?.symbol?.symbol || position.symbol?.symbol?.raw_symbol || position.symbol?.ticker || position.symbol?.raw_symbol,
            quantity:     position.units,
            avgCostBasis: position.average_purchase_price || 0,
            currentPrice: position.price,
            marketValue:  position.market_value,
          });
        }
      }
    }
    return allHoldings;
  } catch (err) {
    console.error('Snaptrade get all holdings error:', err.message);
    return [];
  }
}

// Get account balances (cash available to trade)
async function getAccountBalances(userId, userSecret, accountId) {
  try {
    const response = await client.accountInformation.getUserAccountBalance({
      userId,
      userSecret,
      accountId,
    });
    return response.data;
  } catch (err) {
    console.error('Snaptrade get balances error:', err.message);
    return null;
  }
}

// ─── Trading ──────────────────────────────────────────────────────────────────

// Search for a symbol to get its ID (required for placing orders)
async function searchSymbol(ticker) {
  try {
    const response = await client.referenceData.symbolSearchUserAccount({
      substring: ticker,
    });
    const results = response.data;
    if (!results || results.length === 0) return null;
    // Find exact match
    const exact = results.find(s =>
      s.symbol === ticker || s.raw_symbol === ticker
    );
    return exact || results[0];
  } catch (err) {
    console.error('Snaptrade symbol search error:', err.message);
    return null;
  }
}

// Place an order
// action: 'BUY' | 'SELL'
// orderType: 'Market' | 'Limit' | 'Stop'
// timeInForce: 'Day' | 'GTC'
async function placeOrder(userId, userSecret, accountId, {
  symbolId,
  action,
  units,
  orderType,
  price,       // required for Limit orders
  stopPrice,   // required for Stop orders
  timeInForce,
}) {
  try {
    const orderBody = {
      account_id:      accountId,
      action,
      universal_symbol_id: symbolId,
      order_type:      orderType,
      time_in_force:   timeInForce || 'Day',
      units,
    };

    if (orderType === 'Limit' && price) {
      orderBody.price = price;
    }
    if (orderType === 'Stop' && stopPrice) {
      orderBody.stop_price = stopPrice;
    }

    const response = await client.trading.placeOrder({
      userId,
      userSecret,
      accountId,
      ...orderBody,
    });
    return response.data;
  } catch (err) {
    console.error('Snaptrade place order error:', err?.status, err?.responseBody);
    throw err;
  }
}

// Get all orders for an account
async function getOrders(userId, userSecret, accountId) {
  try {
    const response = await client.accountInformation.getUserAccountOrders({
      userId,
      userSecret,
      accountId,
      state: 'all',
    });
    return response.data;
  } catch (err) {
    console.error('Snaptrade get orders error:', err.message);
    return [];
  }
}

// Cancel an order
async function cancelOrder(userId, userSecret, accountId, brokerageOrderId) {
  try {
    const response = await client.trading.cancelUserAccountOrder({
      userId,
      userSecret,
      accountId,
      brokerageOrderId,
    });
    return response.data;
  } catch (err) {
    console.error('Snaptrade cancel order error:', err.message);
    throw err;
  }
}

module.exports = {
  registerSnaptradeUser,
  deleteSnaptradeUser,
  generateConnectionLink,
  getUserAccounts,
  getAccountHoldings,
  getAllHoldings,
  getAccountBalances,
  searchSymbol,
  placeOrder,
  getOrders,
  cancelOrder,
};