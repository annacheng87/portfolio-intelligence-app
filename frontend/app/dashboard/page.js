'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import api from '../../lib/api';

const ALERT_CATEGORIES = [
  { group: 'Real-time alerts', items: [
    { key: 'large_holding_move',     label: 'Large holding move',        desc: 'Alert when a stock moves above your threshold',             defaultThreshold: 5,    unit: '%'  },
    { key: 'portfolio_value_change', label: 'Portfolio value change',    desc: 'Alert when your total portfolio moves beyond a threshold',  defaultThreshold: 2,    unit: '%'  },
    { key: 'drawdown',               label: 'Drawdown alert',            desc: 'Alert when portfolio drops from a recent 30-day high',      defaultThreshold: 5,    unit: '%'  },
    { key: 'watchlist_price_target', label: 'Watchlist price target',    desc: 'Alert when a watchlist stock crosses your price target',    defaultThreshold: null, unit: null },
    { key: 'major_news',             label: 'Major news',                desc: 'Alert when major news hits a held or watchlisted stock',    defaultThreshold: null, unit: null },
    { key: 'earnings',               label: 'Earnings alerts',           desc: 'Pre-earnings reminder and post-earnings alert',             defaultThreshold: null, unit: null },
    { key: 'volume_spike',           label: 'Volume spike',              desc: 'Alert when a stock sees unusually high trading volume',     defaultThreshold: 2,    unit: 'x'  },
  ]},
  { group: 'Digest alerts', items: [
    { key: 'concentration_risk',   label: 'Concentration risk',      desc: 'Alert when one holding exceeds a large % of portfolio',    defaultThreshold: 25,   unit: '%'  },
    { key: 'cost_basis_deviation', label: 'Cost basis deviation',    desc: 'Alert when a holding moves significantly from cost basis',  defaultThreshold: 15,   unit: '%'  },
    { key: 'dividend_corporate',   label: 'Dividends & corporate',   desc: 'Ex-dividend dates, splits, mergers',                       defaultThreshold: null, unit: null },
    { key: 'reddit_alignment',     label: 'Reddit + price + news',   desc: 'Multi-signal: Reddit buzz, price move, and news align',    defaultThreshold: null, unit: null },
    { key: 'watchlist_move',       label: 'Watchlist daily move',    desc: 'Alert when a watchlist stock moves sharply',               defaultThreshold: 5,    unit: '%'  },
    { key: 'watchlist_news',       label: 'Watchlist news',          desc: 'News on watchlist stocks',                                 defaultThreshold: null, unit: null },
  ]},
  { group: 'Leaderboard alerts', items: [
    { key: 'rank_passed',      label: 'Someone passes your rank',  desc: 'Alert when your leaderboard rank drops',    defaultThreshold: null, unit: null },
    { key: 'top_3_entered',    label: 'You enter top 3 or top 10', desc: 'Alert when you move into the top rankings', defaultThreshold: null, unit: null },
    { key: 'streak_milestone', label: 'Streaks & milestones',      desc: 'Performance streaks and milestones',        defaultThreshold: null, unit: null },
  ]},
  { group: 'Digests', items: [
    { key: 'daily_digest',  label: 'Daily digest email',       desc: 'One email after market close with daily summary', defaultThreshold: null, unit: null },
    { key: 'weekly_digest', label: 'Weekly digest email',      desc: 'Saturday morning recap of the full week',         defaultThreshold: null, unit: null },
    { key: 'sms_realtime',  label: 'SMS for real-time alerts', desc: 'Short SMS for real-time alerts only',             defaultThreshold: null, unit: null },
  ]},
];

function fmt(n, d=2) { if (n===null||n===undefined) return '—'; return parseFloat(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}); }
function fmtDollar(n) { if (n===null||n===undefined) return '—'; const abs=Math.abs(parseFloat(n)); const sign=parseFloat(n)<0?'-':''; return `${sign}$${abs.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`; }
function fmtPct(n) { if (n===null||n===undefined) return '—'; const sign=parseFloat(n)>=0?'+':''; return `${sign}${parseFloat(n).toFixed(2)}%`; }
function pctColor(n) { if (n===null||n===undefined) return '#888'; return parseFloat(n)>=0?'#2a7a4b':'#c0392b'; }

const ORDER_TYPES  = ['Market','Limit','Stop'];
const TIME_IN_FORCE = ['Day','GTC'];

export default function DashboardPage() {
  const [user, setUser]               = useState(null);
  const [holdings, setHoldings]       = useState([]);
  const [performance, setPerformance] = useState(null);
  const [perfLoading, setPerfLoading] = useState(false);
  const [watchlist, setWatchlist]     = useState([]);
  const [alerts, setAlerts]           = useState([]);
  const [brokerStatus, setBrokerStatus] = useState(null);
  const [newTicker, setNewTicker]     = useState('');
  const [activeTab, setActiveTab]     = useState('holdings');
  const [prefs, setPrefs]             = useState({});
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsSaved, setPrefsSaved]   = useState(false);

  // Trading state
  const [tradeAccounts, setTradeAccounts]     = useState([]);
  const [tradeAccountsLoading, setTradeAccountsLoading] = useState(false);
  const [orderTicket, setOrderTicket]         = useState(null); // { ticker, action }
  const [orderAccount, setOrderAccount]       = useState('');
  const [orderType, setOrderType]             = useState('Market');
  const [orderUnits, setOrderUnits]           = useState('');
  const [orderPrice, setOrderPrice]           = useState('');
  const [orderStopPrice, setOrderStopPrice]   = useState('');
  const [orderTIF, setOrderTIF]               = useState('Day');
  const [orderLoading, setOrderLoading]       = useState(false);
  const [orderResult, setOrderResult]         = useState(null);
  const [orderError, setOrderError]           = useState(null);
  const [orderHistory, setOrderHistory]       = useState([]);

  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/login'); return; }
    const cached = localStorage.getItem('user');
    if (cached) setUser(JSON.parse(cached));
    fetchAll();
  }, []);

  async function fetchAll() {
    try {
      const [h, w, a, b, p] = await Promise.all([
        api.get('/portfolio/holdings'),
        api.get('/portfolio/watchlist'),
        api.get('/portfolio/alerts'),
        api.get('/broker/status'),
        api.get('/portfolio/alert-preferences'),
      ]);
      setHoldings(h.data.holdings);
      setWatchlist(w.data.watchlist);
      setAlerts(a.data.alerts);
      setBrokerStatus(b.data);
      const map = {};
      for (const pref of p.data.preferences) {
        map[pref.alertType] = { enabled: pref.enabled, threshold: pref.threshold ?? pref.defaultThreshold ?? null };
      }
      setPrefs(map);
    } catch (err) { console.error('Failed to fetch data:', err); }
  }

  async function fetchPerformance() {
    setPerfLoading(true);
    try {
      const res = await api.get('/portfolio/performance');
      setPerformance(res.data);
    } catch (err) { console.error('Failed to fetch performance:', err); }
    finally { setPerfLoading(false); }
  }

  async function fetchTradeAccounts() {
    setTradeAccountsLoading(true);
    try {
      const res = await api.get('/trading/accounts');
      setTradeAccounts(res.data.accounts || []);
      if (res.data.accounts?.length > 0) setOrderAccount(res.data.accounts[0].id);
    } catch (err) { console.error('Failed to fetch trade accounts:', err); }
    finally { setTradeAccountsLoading(false); }
  }

  async function fetchOrderHistory(accountId) {
    try {
      const res = await api.get(`/trading/orders/${accountId}`);
      setOrderHistory(res.data.orders || []);
    } catch (err) { console.error('Failed to fetch orders:', err); }
  }

  useEffect(() => { if (activeTab === 'performance' && !performance) fetchPerformance(); }, [activeTab]);
  useEffect(() => {
    if (activeTab === 'trade') {
      fetchTradeAccounts();
    }
  }, [activeTab]);
  useEffect(() => { if (orderAccount) fetchOrderHistory(orderAccount); }, [orderAccount]);

  function openOrderTicket(ticker, action) {
    setOrderTicket({ ticker, action });
    setOrderType('Market');
    setOrderUnits('');
    setOrderPrice('');
    setOrderStopPrice('');
    setOrderTIF('Day');
    setOrderResult(null);
    setOrderError(null);
  }

  function closeOrderTicket() {
    setOrderTicket(null);
    setOrderResult(null);
    setOrderError(null);
  }

  async function submitOrder() {
    if (!orderTicket) return;
    setOrderLoading(true);
    setOrderError(null);
    setOrderResult(null);
    try {
      const res = await api.post('/trading/order', {
        accountId:   orderAccount,
        ticker:      orderTicket.ticker,
        action:      orderTicket.action,
        orderType,
        units:       parseFloat(orderUnits),
        price:       orderPrice     ? parseFloat(orderPrice)     : undefined,
        stopPrice:   orderStopPrice ? parseFloat(orderStopPrice) : undefined,
        timeInForce: orderTIF,
      });
      setOrderResult(res.data);
      fetchOrderHistory(orderAccount);
      if (activeTab === 'performance') fetchPerformance();
    } catch (err) {
      setOrderError(err.response?.data?.error || 'Failed to place order.');
    } finally { setOrderLoading(false); }
  }

  function isPrefEnabled(key) { return prefs[key]?.enabled ?? true; }
  function getPrefThreshold(key, def) { return prefs[key]?.threshold ?? def; }
  function togglePref(key) { setPrefs(p => ({...p,[key]:{...p[key],enabled:!isPrefEnabled(key)}})); setPrefsSaved(false); }
  function setThreshold(key, val) { setPrefs(p => ({...p,[key]:{...p[key],threshold:val===''?null:parseFloat(val)}})); setPrefsSaved(false); }

  async function savePreferences() {
    setPrefsSaving(true);
    try {
      const preferences = ALERT_CATEGORIES.flatMap(cat => cat.items.map(item => ({
        alertType: item.key, enabled: isPrefEnabled(item.key), threshold: getPrefThreshold(item.key, item.defaultThreshold),
      })));
      await api.put('/portfolio/alert-preferences', { preferences });
      setPrefsSaved(true);
    } catch { alert('Failed to save preferences.'); }
    finally { setPrefsSaving(false); }
  }

  async function addToWatchlist(e) {
    e.preventDefault();
    if (!newTicker.trim()) return;
    try { await api.post('/portfolio/watchlist', { ticker: newTicker.trim() }); setNewTicker(''); fetchAll(); }
    catch (err) { alert(err.response?.data?.error || 'Failed to add ticker.'); }
  }
  async function removeFromWatchlist(ticker) {
    try { await api.delete(`/portfolio/watchlist/${ticker}`); fetchAll(); }
    catch { alert('Failed to remove ticker.'); }
  }
  async function connectBroker() {
    try { const res = await api.post('/broker/connect'); window.open(res.data.redirectUri,'_blank'); }
    catch (err) { alert(err.response?.data?.error || 'Failed to initiate broker connection.'); }
  }
  async function syncHoldings() {
    try { const res = await api.post('/broker/sync'); alert(res.data.message); fetchAll(); if (activeTab==='performance') fetchPerformance(); }
    catch (err) { alert(err.response?.data?.error || 'Failed to sync holdings.'); }
  }
  function logout() { localStorage.removeItem('token'); localStorage.removeItem('user'); router.push('/login'); }

  const tabs = ['holdings','performance','trade','watchlist','alerts','alert settings'];

  // Current holding for the order ticket
  const currentHolding = orderTicket ? performance?.holdings?.find(h => h.ticker === orderTicket.ticker) : null;

  return (
    <div style={s.page}>
      <div style={s.nav}>
        <span style={s.navBrand}>Portfolio Intelligence</span>
        <div style={{display:'flex',alignItems:'center',gap:16}}>
          {user && <span style={s.navUser}>Hi, {user.displayName}</span>}
          <button style={s.logoutBtn} onClick={logout}>Sign out</button>
        </div>
      </div>

      <div style={s.content}>
        {/* Summary cards */}
        <div style={s.cardRow}>
          <div style={s.summaryCard}><div style={s.summaryLabel}>Holdings</div><div style={s.summaryValue}>{holdings.length}</div></div>
          <div style={s.summaryCard}><div style={s.summaryLabel}>Watchlist</div><div style={s.summaryValue}>{watchlist.length}</div></div>
          <div style={s.summaryCard}><div style={s.summaryLabel}>Unread alerts</div><div style={s.summaryValue}>{alerts.filter(a=>!a.isRead).length}</div></div>
          {performance?.summary && (
            <div style={s.summaryCard}>
              <div style={s.summaryLabel}>Portfolio value</div>
              <div style={s.summaryValue}>{fmtDollar(performance.summary.totalValue)}</div>
              <div style={{fontSize:12,color:pctColor(performance.summary.dailyPnLPct),marginTop:4}}>{fmtPct(performance.summary.dailyPnLPct)} today</div>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={s.tabs}>
          {tabs.map(tab => (
            <button key={tab} style={{...s.tab,...(activeTab===tab?s.tabActive:{})}} onClick={()=>setActiveTab(tab)}>
              {tab.charAt(0).toUpperCase()+tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Holdings tab */}
        {activeTab==='holdings' && (
          <div style={s.panel}>
            <div style={s.brokerBar}>
              {brokerStatus?.connected ? (
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <span style={s.brokerConnected}>✓ Broker connected</span>
                  {brokerStatus.connections?.[0]?.lastSyncedAt && <span style={{fontSize:12,color:'#888'}}>Last synced: {new Date(brokerStatus.connections[0].lastSyncedAt).toLocaleString()}</span>}
                  <button style={s.syncBtn} onClick={syncHoldings}>Sync now</button>
                </div>
              ) : (
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <span style={{fontSize:13,color:'#888'}}>No broker connected</span>
                  <button style={s.connectBtn} onClick={connectBroker}>Connect broker</button>
                </div>
              )}
            </div>
            {holdings.length===0 ? (
              <div style={s.empty}>{brokerStatus?.connected?'No holdings found. Try syncing.':'Connect a broker to see your positions.'}</div>
            ) : (
              <table style={s.table}>
                <thead><tr><th style={s.th}>Ticker</th><th style={s.th}>Quantity</th><th style={s.th}>Avg cost</th><th style={s.th}>Actions</th></tr></thead>
                <tbody>
                  {holdings.map(h => (
                    <tr key={h.id}>
                      <td style={s.td}><strong>{h.ticker}</strong></td>
                      <td style={s.td}>{parseFloat(h.quantity).toFixed(4)}</td>
                      <td style={s.td}>${parseFloat(h.avgCostBasis).toFixed(2)}</td>
                      <td style={s.td}>
                        <div style={{display:'flex',gap:6}}>
                          <button style={s.buyBtn} onClick={()=>{setActiveTab('trade');openOrderTicket(h.ticker,'BUY');}}>Buy</button>
                          <button style={s.sellBtn} onClick={()=>{setActiveTab('trade');openOrderTicket(h.ticker,'SELL');}}>Sell</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Performance tab */}
        {activeTab==='performance' && (
          <div style={s.panel}>
            {perfLoading ? <div style={s.empty}>Loading performance data...</div>
            : !performance ? <div style={s.empty}>No performance data yet. Connect a broker and sync first.</div>
            : (
              <>
                <div style={s.perfSummaryRow}>
                  <div style={s.perfStat}><div style={s.perfStatLabel}>Total value</div><div style={s.perfStatValue}>{fmtDollar(performance.summary.totalValue)}</div></div>
                  <div style={s.perfStat}><div style={s.perfStatLabel}>Total cost</div><div style={s.perfStatValue}>{fmtDollar(performance.summary.totalCost)}</div></div>
                  <div style={s.perfStat}><div style={s.perfStatLabel}>Total return</div><div style={{...s.perfStatValue,color:pctColor(performance.summary.totalReturn)}}>{fmtDollar(performance.summary.totalReturn)}</div><div style={{fontSize:12,color:pctColor(performance.summary.totalReturnPct)}}>{fmtPct(performance.summary.totalReturnPct)}</div></div>
                  <div style={s.perfStat}><div style={s.perfStatLabel}>Today's P&L</div><div style={{...s.perfStatValue,color:pctColor(performance.summary.dailyPnL)}}>{fmtDollar(performance.summary.dailyPnL)}</div><div style={{fontSize:12,color:pctColor(performance.summary.dailyPnLPct)}}>{fmtPct(performance.summary.dailyPnLPct)}</div></div>
                </div>
                {performance.holdings.length===0 ? <div style={s.empty}>No holdings.</div> : (
                  <table style={{...s.table,marginTop:20}}>
                    <thead><tr><th style={s.th}>Ticker</th><th style={s.th}>Price</th><th style={s.th}>Qty</th><th style={s.th}>Value</th><th style={s.th}>Weight</th><th style={s.th}>Today</th><th style={s.th}>Total return</th><th style={s.th}>Trade</th></tr></thead>
                    <tbody>
                      {performance.holdings.map(h => (
                        <tr key={h.id}>
                          <td style={s.td}><strong>{h.ticker}</strong></td>
                          <td style={s.td}>{h.currentPrice?`$${fmt(h.currentPrice)}`:'—'}</td>
                          <td style={s.td}>{fmt(h.quantity,4)}</td>
                          <td style={s.td}>{fmtDollar(h.positionValue)}</td>
                          <td style={s.td}>
                            {h.portfolioWeight!==null?(
                              <div style={{display:'flex',alignItems:'center',gap:6}}>
                                <div style={{width:48,height:4,background:'#f0f0ef',borderRadius:2,overflow:'hidden'}}><div style={{width:`${Math.min(h.portfolioWeight,100)}%`,height:4,background:'#1a1a18',borderRadius:2}}/></div>
                                <span style={{fontSize:12}}>{fmt(h.portfolioWeight,1)}%</span>
                              </div>
                            ):'—'}
                          </td>
                          <td style={{...s.td,color:pctColor(h.dailyPct)}}>{fmtPct(h.dailyPct)}</td>
                          <td style={s.td}><div style={{color:pctColor(h.gainLossPct)}}>{fmtDollar(h.gainLoss)}</div><div style={{fontSize:11,color:pctColor(h.gainLossPct)}}>{fmtPct(h.gainLossPct)}</div></td>
                          <td style={s.td}>
                            <div style={{display:'flex',gap:6}}>
                              <button style={s.buyBtn} onClick={()=>{setActiveTab('trade');openOrderTicket(h.ticker,'BUY');}}>Buy</button>
                              <button style={s.sellBtn} onClick={()=>{setActiveTab('trade');openOrderTicket(h.ticker,'SELL');}}>Sell</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div style={{marginTop:12,textAlign:'right'}}><button style={s.syncBtn} onClick={fetchPerformance}>Refresh prices</button></div>
              </>
            )}
          </div>
        )}

        {/* Trade tab */}
        {activeTab==='trade' && (
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,alignItems:'start'}}>

            {/* Order ticket */}
            <div style={s.panel}>
              <div style={{fontSize:15,fontWeight:500,marginBottom:16}}>Order ticket</div>

              {tradeAccountsLoading ? <div style={s.empty}>Loading accounts...</div>
              : tradeAccounts.length===0 ? <div style={s.empty}>No broker accounts found. Connect a broker first.</div>
              : (
                <>
                  {/* Account selector */}
                  <div style={s.fieldGroup}>
                    <label style={s.fieldLabel}>Account</label>
                    <select style={s.select} value={orderAccount} onChange={e=>setOrderAccount(e.target.value)}>
                      {tradeAccounts.map(a => (
                        <option key={a.id} value={a.id}>{a.name} — ${fmt(a.buyingPower)} available</option>
                      ))}
                    </select>
                  </div>

                  {/* Ticker + action */}
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                    <div style={s.fieldGroup}>
                      <label style={s.fieldLabel}>Symbol</label>
                      <input style={s.input} value={orderTicket?.ticker||''} onChange={e=>setOrderTicket(t=>({...t,ticker:e.target.value.toUpperCase()}))} placeholder="e.g. AAPL"/>
                    </div>
                    <div style={s.fieldGroup}>
                      <label style={s.fieldLabel}>Action</label>
                      <div style={{display:'flex',gap:8}}>
                        <button style={{...s.actionBtn,...(orderTicket?.action==='BUY'?s.actionBtnBuy:{})}} onClick={()=>setOrderTicket(t=>({...t,action:'BUY'}))}>Buy</button>
                        <button style={{...s.actionBtn,...(orderTicket?.action==='SELL'?s.actionBtnSell:{})}} onClick={()=>setOrderTicket(t=>({...t,action:'SELL'}))}>Sell</button>
                      </div>
                    </div>
                  </div>

                  {/* Order type */}
                  <div style={s.fieldGroup}>
                    <label style={s.fieldLabel}>Order type</label>
                    <div style={{display:'flex',gap:8}}>
                      {ORDER_TYPES.map(t => (
                        <button key={t} style={{...s.typeBtn,...(orderType===t?s.typeBtnActive:{})}} onClick={()=>setOrderType(t)}>{t}</button>
                      ))}
                    </div>
                  </div>

                  {/* Units */}
                  <div style={s.fieldGroup}>
                    <label style={s.fieldLabel}>Shares</label>
                    <input style={s.input} type="number" min="0" step="1" value={orderUnits} onChange={e=>setOrderUnits(e.target.value)} placeholder="Number of shares"/>
                  </div>

                  {/* Limit price */}
                  {orderType==='Limit' && (
                    <div style={s.fieldGroup}>
                      <label style={s.fieldLabel}>Limit price ($)</label>
                      <input style={s.input} type="number" min="0" step="0.01" value={orderPrice} onChange={e=>setOrderPrice(e.target.value)} placeholder="Price per share"/>
                    </div>
                  )}

                  {/* Stop price */}
                  {orderType==='Stop' && (
                    <div style={s.fieldGroup}>
                      <label style={s.fieldLabel}>Stop price ($)</label>
                      <input style={s.input} type="number" min="0" step="0.01" value={orderStopPrice} onChange={e=>setOrderStopPrice(e.target.value)} placeholder="Stop trigger price"/>
                    </div>
                  )}

                  {/* Time in force */}
                  <div style={s.fieldGroup}>
                    <label style={s.fieldLabel}>Time in force</label>
                    <div style={{display:'flex',gap:8}}>
                      {TIME_IN_FORCE.map(t => (
                        <button key={t} style={{...s.typeBtn,...(orderTIF===t?s.typeBtnActive:{})}} onClick={()=>setOrderTIF(t)}>{t==='GTC'?'Good till cancelled':'Day order'}</button>
                      ))}
                    </div>
                  </div>

                  {/* Order summary */}
                  {orderTicket?.ticker && orderUnits && (
                    <div style={s.orderSummary}>
                      <div style={{fontSize:12,color:'#888',marginBottom:6}}>Order summary</div>
                      <div style={{fontSize:14,fontWeight:500}}>
                        {orderTicket.action} {orderUnits} share{parseFloat(orderUnits)!==1?'s':''} of {orderTicket.ticker}
                      </div>
                      <div style={{fontSize:12,color:'#888',marginTop:3}}>
                        {orderType} order · {orderTIF==='GTC'?'Good till cancelled':'Day order'}
                        {orderType==='Limit'&&orderPrice?` · Limit $${orderPrice}`:''}
                        {orderType==='Stop'&&orderStopPrice?` · Stop $${orderStopPrice}`:''}
                      </div>
                      {currentHolding && (
                        <div style={{fontSize:12,color:'#888',marginTop:3}}>
                          Current position: {fmt(currentHolding.quantity,4)} shares · ${fmt(currentHolding.currentPrice)} per share
                        </div>
                      )}
                    </div>
                  )}

                  {/* Error / success */}
                  {orderError && <div style={s.orderError}>{orderError}</div>}
                  {orderResult && <div style={s.orderSuccess}>Order placed successfully.</div>}

                  {/* Submit */}
                  <button
                    style={{...s.primaryBtn,width:'100%',marginTop:12,padding:'11px',background:orderTicket?.action==='SELL'?'#c0392b':'#1a1a18',opacity:(orderLoading||!orderTicket?.ticker||!orderUnits)?0.5:1}}
                    onClick={submitOrder}
                    disabled={orderLoading||!orderTicket?.ticker||!orderUnits}
                  >
                    {orderLoading?'Placing order...':`${orderTicket?.action||'Place'} order`}
                  </button>

                  <p style={{fontSize:11,color:'#aaa',marginTop:8,textAlign:'center'}}>
                    Orders are executed through your connected broker. Review carefully before submitting.
                  </p>
                </>
              )}
            </div>

            {/* Order history */}
            <div style={s.panel}>
              <div style={{fontSize:15,fontWeight:500,marginBottom:16}}>Order history</div>
              {orderHistory.length===0 ? (
                <div style={s.empty}>No orders yet.</div>
              ) : (
                orderHistory.slice(0,20).map((order,i) => (
                  <div key={i} style={s.orderRow}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                      <span style={{fontWeight:500,fontSize:13}}>{order.symbol?.symbol||order.universal_symbol?.symbol||'—'}</span>
                      <span style={{fontSize:11,padding:'2px 7px',borderRadius:4,background:order.action==='BUY'?'#e8f5e9':'#fce4ec',color:order.action==='BUY'?'#2a7a4b':'#c0392b',fontWeight:500}}>{order.action}</span>
                      <span style={{fontSize:11,padding:'2px 7px',borderRadius:4,background:'#f0f0ef',color:'#666'}}>{order.status}</span>
                    </div>
                    <div style={{fontSize:12,color:'#888'}}>
                      {order.units} shares · {order.order_type}
                      {order.price?` · $${order.price}`:''}
                      {order.time_placed?` · ${new Date(order.time_placed).toLocaleString()}`:''}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Watchlist tab */}
        {activeTab==='watchlist' && (
          <div style={s.panel}>
            <form onSubmit={addToWatchlist} style={{display:'flex',gap:8,marginBottom:20}}>
              <input style={{...s.input,flex:1}} value={newTicker} onChange={e=>setNewTicker(e.target.value.toUpperCase())} placeholder="Add ticker e.g. AAPL"/>
              <button style={s.primaryBtn} type="submit">Add</button>
            </form>
            {watchlist.length===0 ? <div style={s.empty}>No tickers on your watchlist yet.</div> : (
              watchlist.map(item => (
                <div key={item.id} style={s.listRow}>
                  <span style={{fontWeight:500}}>{item.ticker}</span>
                  <div style={{display:'flex',gap:8}}>
                    <button style={s.buyBtn} onClick={()=>{setActiveTab('trade');openOrderTicket(item.ticker,'BUY');}}>Buy</button>
                    <button style={s.removeBtn} onClick={()=>removeFromWatchlist(item.ticker)}>Remove</button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Alerts tab */}
        {activeTab==='alerts' && (
          <div style={s.panel}>
            {alerts.length===0 ? <div style={s.empty}>No alerts yet.</div> : (
              alerts.map(alert => (
                <div key={alert.id} style={{...s.alertCard,opacity:alert.isRead?0.6:1}}>
                  <div style={s.alertHeader}>
                    <span style={s.alertTicker}>{alert.ticker}</span>
                    <span style={s.alertType}>{alert.alertType.replace(/_/g,' ')}</span>
                    {alert.ticker!=='PORTFOLIO' && (
                      <button style={{...s.buyBtn,marginLeft:'auto'}} onClick={()=>{setActiveTab('trade');openOrderTicket(alert.ticker,'BUY');}}>Trade</button>
                    )}
                  </div>
                  <p style={s.alertSummary}>{alert.plainEnglishSummary}</p>
                  {alert.riskNote && <p style={s.alertRisk}>⚠ {alert.riskNote}</p>}
                  {alert.newsUrl && (
                    <div style={s.sourceRow}>
                      <span style={s.sourceLabel}>📰 Top news</span>
                      <a href={alert.newsUrl} target="_blank" rel="noopener noreferrer" style={s.sourceLink}>{alert.newsHeadline?(alert.newsHeadline.length>80?alert.newsHeadline.slice(0,80)+'...':alert.newsHeadline):'Read article →'}</a>
                    </div>
                  )}
                  {alert.redditUrl && (
                    <div style={s.sourceRow}>
                      <span style={s.sourceLabel}>💬 Top Reddit post</span>
                      <a href={alert.redditUrl} target="_blank" rel="noopener noreferrer" style={s.sourceLink}>{alert.redditTitle?(alert.redditTitle.length>80?alert.redditTitle.slice(0,80)+'...':alert.redditTitle):'View post →'}</a>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Alert settings tab */}
        {activeTab==='alert settings' && (
          <div style={s.panel}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24}}>
              <div>
                <div style={{fontSize:15,fontWeight:500,marginBottom:4}}>Alert preferences</div>
                <div style={{fontSize:13,color:'#888'}}>Choose which alerts you receive and set your thresholds</div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                {prefsSaved && <span style={{fontSize:12,color:'#2a7a4b'}}>✓ Saved</span>}
                <button style={s.primaryBtn} onClick={savePreferences} disabled={prefsSaving}>{prefsSaving?'Saving...':'Save preferences'}</button>
              </div>
            </div>
            {ALERT_CATEGORIES.map(cat => (
              <div key={cat.group} style={{marginBottom:28}}>
                <div style={s.prefGroupLabel}>{cat.group}</div>
                {cat.items.map(item => (
                  <div key={item.key} style={s.prefRow}>
                    <div style={s.prefLeft}>
                      <div style={{display:'flex',alignItems:'center',gap:10}}>
                        <button style={{...s.toggle,background:isPrefEnabled(item.key)?'#1a1a18':'#ddd'}} onClick={()=>togglePref(item.key)}>
                          <div style={{...s.toggleThumb,left:isPrefEnabled(item.key)?18:2}}/>
                        </button>
                        <span style={{fontSize:14,fontWeight:500,color:isPrefEnabled(item.key)?'#1a1a18':'#aaa'}}>{item.label}</span>
                      </div>
                      <div style={s.prefDesc}>{item.desc}</div>
                    </div>
                    {item.defaultThreshold!==null && (
                      <div style={s.prefRight}>
                        <span style={{fontSize:12,color:'#888',marginRight:6}}>Threshold</span>
                        <input style={s.thresholdInput} type="number" value={getPrefThreshold(item.key,item.defaultThreshold)??''} onChange={e=>setThreshold(item.key,e.target.value)} disabled={!isPrefEnabled(item.key)} min="0" step="0.5"/>
                        <span style={{fontSize:12,color:'#888',marginLeft:4}}>{item.unit}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
            <div style={{paddingTop:16,borderTop:'1px solid #f0f0ef',display:'flex',justifyContent:'flex-end'}}>
              <button style={s.primaryBtn} onClick={savePreferences} disabled={prefsSaving}>{prefsSaving?'Saving...':'Save preferences'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const s = {
  page:            { minHeight:'100vh', backgroundColor:'#f9f9f8', fontFamily:'system-ui, sans-serif' },
  nav:             { background:'#fff', borderBottom:'1px solid #e5e5e3', padding:'14px 32px', display:'flex', justifyContent:'space-between', alignItems:'center' },
  navBrand:        { fontSize:15, fontWeight:500 },
  navUser:         { fontSize:13, color:'#888' },
  logoutBtn:       { fontSize:13, color:'#666', background:'none', border:'1px solid #ddd', borderRadius:6, padding:'6px 12px', cursor:'pointer' },
  content:         { maxWidth:1100, margin:'0 auto', padding:'28px 24px' },
  cardRow:         { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:12, marginBottom:28 },
  summaryCard:     { background:'#fff', border:'1px solid #e5e5e3', borderRadius:10, padding:'18px 20px' },
  summaryLabel:    { fontSize:12, color:'#888', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.05em' },
  summaryValue:    { fontSize:26, fontWeight:500 },
  tabs:            { display:'flex', gap:4, marginBottom:16, borderBottom:'1px solid #e5e5e3', flexWrap:'wrap' },
  tab:             { padding:'8px 18px', background:'none', border:'none', borderBottom:'2px solid transparent', cursor:'pointer', fontSize:14, color:'#888', marginBottom:-1 },
  tabActive:       { color:'#1a1a18', borderBottomColor:'#1a1a18', fontWeight:500 },
  panel:           { background:'#fff', border:'1px solid #e5e5e3', borderRadius:10, padding:'20px 24px' },
  empty:           { textAlign:'center', color:'#888', fontSize:14, padding:'32px 0' },
  primaryBtn:      { background:'#1a1a18', color:'#fff', border:'none', borderRadius:8, padding:'9px 18px', fontSize:13, fontWeight:500, cursor:'pointer' },
  input:           { padding:'9px 12px', border:'1px solid #ddd', borderRadius:8, fontSize:14, outline:'none', width:'100%' },
  select:          { padding:'9px 12px', border:'1px solid #ddd', borderRadius:8, fontSize:13, outline:'none', width:'100%', background:'#fff' },
  table:           { width:'100%', borderCollapse:'collapse' },
  th:              { textAlign:'left', fontSize:12, color:'#888', padding:'8px 12px', borderBottom:'1px solid #eee', fontWeight:500 },
  td:              { padding:'10px 12px', fontSize:13, borderBottom:'1px solid #f0f0ef' },
  listRow:         { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 0', borderBottom:'1px solid #f0f0ef' },
  removeBtn:       { fontSize:12, color:'#c00', background:'none', border:'none', cursor:'pointer' },
  buyBtn:          { fontSize:11, color:'#2a7a4b', background:'#e8f5e9', border:'none', borderRadius:5, padding:'4px 10px', cursor:'pointer', fontWeight:500 },
  sellBtn:         { fontSize:11, color:'#c0392b', background:'#fce4ec', border:'none', borderRadius:5, padding:'4px 10px', cursor:'pointer', fontWeight:500 },
  alertCard:       { border:'1px solid #e5e5e3', borderRadius:8, padding:'14px 16px', marginBottom:12 },
  alertHeader:     { display:'flex', alignItems:'center', gap:10, marginBottom:8 },
  alertTicker:     { fontWeight:500, fontSize:14 },
  alertType:       { fontSize:11, background:'#f0f0ef', color:'#666', borderRadius:4, padding:'2px 8px' },
  alertSummary:    { fontSize:13, color:'#333', margin:'0 0 6px' },
  alertRisk:       { fontSize:12, color:'#b45', margin:0 },
  sourceRow:       { display:'flex', flexDirection:'column', gap:2, marginTop:8, padding:'8px 10px', background:'#f9f9f8', borderRadius:6 },
  sourceLabel:     { fontSize:11, color:'#888', fontWeight:500 },
  sourceLink:      { fontSize:12, color:'#1a1a18', textDecoration:'underline', cursor:'pointer', lineHeight:1.4 },
  brokerBar:       { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 0', marginBottom:16, borderBottom:'1px solid #f0f0ef' },
  brokerConnected: { fontSize:13, color:'#2a7a4b', fontWeight:500 },
  connectBtn:      { background:'#1a1a18', color:'#fff', border:'none', borderRadius:8, padding:'8px 16px', fontSize:13, fontWeight:500, cursor:'pointer' },
  syncBtn:         { background:'none', color:'#1a1a18', border:'1px solid #ddd', borderRadius:8, padding:'6px 14px', fontSize:12, cursor:'pointer' },
  perfSummaryRow:  { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:12, marginBottom:8 },
  perfStat:        { background:'#f9f9f8', borderRadius:8, padding:'14px 16px' },
  perfStatLabel:   { fontSize:11, color:'#888', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 },
  perfStatValue:   { fontSize:20, fontWeight:500 },
  prefGroupLabel:  { fontSize:11, fontWeight:500, color:'#888', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:10 },
  prefRow:         { display:'flex', alignItems:'flex-start', justifyContent:'space-between', padding:'12px 0', borderBottom:'1px solid #f0f0ef', gap:16 },
  prefLeft:        { flex:1 },
  prefDesc:        { fontSize:12, color:'#aaa', marginTop:4, marginLeft:42 },
  prefRight:       { display:'flex', alignItems:'center', flexShrink:0 },
  thresholdInput:  { width:60, padding:'5px 8px', border:'1px solid #ddd', borderRadius:6, fontSize:13, textAlign:'center' },
  toggle:          { width:36, height:20, borderRadius:10, border:'none', cursor:'pointer', position:'relative', transition:'background 0.2s', flexShrink:0 },
  toggleThumb:     { position:'absolute', top:3, width:14, height:14, borderRadius:7, background:'#fff', transition:'left 0.2s' },
  fieldGroup:      { marginBottom:14 },
  fieldLabel:      { display:'block', fontSize:12, color:'#888', marginBottom:6, fontWeight:500 },
  actionBtn:       { flex:1, padding:'8px', border:'1px solid #ddd', borderRadius:7, fontSize:13, cursor:'pointer', background:'#fff', fontWeight:500 },
  actionBtnBuy:    { background:'#e8f5e9', color:'#2a7a4b', borderColor:'#2a7a4b' },
  actionBtnSell:   { background:'#fce4ec', color:'#c0392b', borderColor:'#c0392b' },
  typeBtn:         { padding:'6px 14px', border:'1px solid #ddd', borderRadius:6, fontSize:12, cursor:'pointer', background:'#fff', color:'#888' },
  typeBtnActive:   { background:'#1a1a18', color:'#fff', borderColor:'#1a1a18' },
  orderSummary:    { background:'#f9f9f8', borderRadius:8, padding:'12px 14px', marginTop:12, border:'1px solid #e5e5e3' },
  orderError:      { background:'#fce4ec', color:'#c0392b', borderRadius:7, padding:'10px 14px', fontSize:13, marginTop:10 },
  orderSuccess:    { background:'#e8f5e9', color:'#2a7a4b', borderRadius:7, padding:'10px 14px', fontSize:13, marginTop:10 },
  orderRow:        { padding:'10px 0', borderBottom:'1px solid #f0f0ef' },
};