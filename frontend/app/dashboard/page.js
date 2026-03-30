'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import api from '../../lib/api';

export default function DashboardPage() {
  const [user, setUser] = useState(null);
  const [holdings, setHoldings] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [brokerStatus, setBrokerStatus] = useState(null);
  const [newTicker, setNewTicker] = useState('');
  const [activeTab, setActiveTab] = useState('holdings');
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
      const [h, w, a, b] = await Promise.all([
        api.get('/portfolio/holdings'),
        api.get('/portfolio/watchlist'),
        api.get('/portfolio/alerts'),
        api.get('/broker/status'),
      ]);
      setHoldings(h.data.holdings);
      setWatchlist(w.data.watchlist);
      setAlerts(a.data.alerts);
      setBrokerStatus(b.data);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    }
  }

  async function addToWatchlist(e) {
    e.preventDefault();
    if (!newTicker.trim()) return;
    try {
      await api.post('/portfolio/watchlist', { ticker: newTicker.trim() });
      setNewTicker('');
      fetchAll();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add ticker.');
    }
  }

  async function removeFromWatchlist(ticker) {
    try {
      await api.delete(`/portfolio/watchlist/${ticker}`);
      fetchAll();
    } catch (err) {
      alert('Failed to remove ticker.');
    }
  }

  async function connectBroker() {
    try {
      const res = await api.post('/broker/connect');
      window.open(res.data.redirectUri, '_blank');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to initiate broker connection.');
    }
  }

  async function syncHoldings() {
    try {
      const res = await api.post('/broker/sync');
      alert(res.data.message);
      fetchAll();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to sync holdings.');
    }
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/login');
  }

  return (
    <div style={s.page}>
      <div style={s.nav}>
        <span style={s.navBrand}>Portfolio Intelligence</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {user && <span style={s.navUser}>Hi, {user.displayName}</span>}
          <button style={s.logoutBtn} onClick={logout}>Sign out</button>
        </div>
      </div>

      <div style={s.content}>
        <div style={s.cardRow}>
          <div style={s.summaryCard}>
            <div style={s.summaryLabel}>Holdings</div>
            <div style={s.summaryValue}>{holdings.length}</div>
          </div>
          <div style={s.summaryCard}>
            <div style={s.summaryLabel}>Watchlist</div>
            <div style={s.summaryValue}>{watchlist.length}</div>
          </div>
          <div style={s.summaryCard}>
            <div style={s.summaryLabel}>Unread alerts</div>
            <div style={s.summaryValue}>{alerts.filter(a => !a.isRead).length}</div>
          </div>
        </div>

        <div style={s.tabs}>
          {['holdings', 'watchlist', 'alerts'].map(tab => (
            <button key={tab}
              style={{ ...s.tab, ...(activeTab === tab ? s.tabActive : {}) }}
              onClick={() => setActiveTab(tab)}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {activeTab === 'holdings' && (
          <div style={s.panel}>
            <div style={s.brokerBar}>
              {brokerStatus?.connected ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={s.brokerConnected}>✓ Broker connected</span>
                  {brokerStatus.connections?.[0]?.lastSyncedAt && (
                    <span style={{ fontSize: 12, color: '#888' }}>
                      Last synced: {new Date(brokerStatus.connections[0].lastSyncedAt).toLocaleString()}
                    </span>
                  )}
                  <button style={s.syncBtn} onClick={syncHoldings}>Sync now</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 13, color: '#888' }}>No broker connected</span>
                  <button style={s.connectBtn} onClick={connectBroker}>Connect broker</button>
                </div>
              )}
            </div>

            {holdings.length === 0 ? (
              <div style={s.empty}>
                {brokerStatus?.connected
                  ? 'No holdings found. Try syncing your account.'
                  : 'Connect a broker account to see your positions here.'}
              </div>
            ) : (
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Ticker</th>
                    <th style={s.th}>Quantity</th>
                    <th style={s.th}>Avg cost</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map(h => (
                    <tr key={h.id}>
                      <td style={s.td}><strong>{h.ticker}</strong></td>
                      <td style={s.td}>{parseFloat(h.quantity).toFixed(4)}</td>
                      <td style={s.td}>${parseFloat(h.avgCostBasis).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'watchlist' && (
          <div style={s.panel}>
            <form onSubmit={addToWatchlist} style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <input style={{ ...s.input, flex: 1 }} value={newTicker}
                onChange={e => setNewTicker(e.target.value.toUpperCase())}
                placeholder="Add ticker e.g. AAPL" />
              <button style={s.primaryBtn} type="submit">Add</button>
            </form>
            {watchlist.length === 0 ? (
              <div style={s.empty}>No tickers on your watchlist yet.</div>
            ) : (
              watchlist.map(item => (
                <div key={item.id} style={s.listRow}>
                  <span style={{ fontWeight: 500 }}>{item.ticker}</span>
                  <button style={s.removeBtn} onClick={() => removeFromWatchlist(item.ticker)}>Remove</button>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'alerts' && (
          <div style={s.panel}>
            {alerts.length === 0 ? (
              <div style={s.empty}>No alerts yet. These will appear once the alerts engine is running.</div>
            ) : (
              alerts.map(alert => (
                <div key={alert.id} style={{ ...s.alertCard, opacity: alert.isRead ? 0.6 : 1 }}>
                  <div style={s.alertHeader}>
                    <span style={s.alertTicker}>{alert.ticker}</span>
                    <span style={s.alertType}>{alert.alertType.replace('_', ' ')}</span>
                  </div>
                  <p style={s.alertSummary}>{alert.plainEnglishSummary}</p>
                  {alert.riskNote && <p style={s.alertRisk}>⚠ {alert.riskNote}</p>}

                  {alert.newsUrl && (
                    <div style={s.sourceRow}>
                      <span style={s.sourceLabel}>📰 Top news</span>
                      <a href={alert.newsUrl} target="_blank" rel="noopener noreferrer" style={s.sourceLink}>
                        {alert.newsHeadline
                          ? alert.newsHeadline.length > 80
                            ? alert.newsHeadline.slice(0, 80) + '...'
                            : alert.newsHeadline
                          : 'Read article →'}
                      </a>
                    </div>
                  )}

                  {alert.redditUrl && (
                    <div style={s.sourceRow}>
                      <span style={s.sourceLabel}>💬 Top Reddit post</span>
                      <a href={alert.redditUrl} target="_blank" rel="noopener noreferrer" style={s.sourceLink}>
                        {alert.redditTitle
                          ? alert.redditTitle.length > 80
                            ? alert.redditTitle.slice(0, 80) + '...'
                            : alert.redditTitle
                          : 'View post →'}
                      </a>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const s = {
  page: { minHeight: '100vh', backgroundColor: '#f9f9f8', fontFamily: 'system-ui, sans-serif' },
  nav: { background: '#fff', borderBottom: '1px solid #e5e5e3', padding: '14px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  navBrand: { fontSize: 15, fontWeight: 500 },
  navUser: { fontSize: 13, color: '#888' },
  logoutBtn: { fontSize: 13, color: '#666', background: 'none', border: '1px solid #ddd', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' },
  content: { maxWidth: 860, margin: '0 auto', padding: '28px 24px' },
  cardRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 28 },
  summaryCard: { background: '#fff', border: '1px solid #e5e5e3', borderRadius: 10, padding: '18px 20px' },
  summaryLabel: { fontSize: 12, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' },
  summaryValue: { fontSize: 26, fontWeight: 500 },
  tabs: { display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid #e5e5e3' },
  tab: { padding: '8px 18px', background: 'none', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer', fontSize: 14, color: '#888', marginBottom: -1 },
  tabActive: { color: '#1a1a18', borderBottomColor: '#1a1a18', fontWeight: 500 },
  panel: { background: '#fff', border: '1px solid #e5e5e3', borderRadius: 10, padding: '20px 24px' },
  empty: { textAlign: 'center', color: '#888', fontSize: 14, padding: '32px 0' },
  primaryBtn: { background: '#1a1a18', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  input: { padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, outline: 'none' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', fontSize: 12, color: '#888', padding: '8px 12px', borderBottom: '1px solid #eee', fontWeight: 500 },
  td: { padding: '12px', fontSize: 14, borderBottom: '1px solid #f0f0ef' },
  listRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f0f0ef' },
  removeBtn: { fontSize: 12, color: '#c00', background: 'none', border: 'none', cursor: 'pointer' },
  alertCard: { border: '1px solid #e5e5e3', borderRadius: 8, padding: '14px 16px', marginBottom: 12 },
  alertHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 },
  alertTicker: { fontWeight: 500, fontSize: 14 },
  alertType: { fontSize: 11, background: '#f0f0ef', color: '#666', borderRadius: 4, padding: '2px 8px' },
  alertSummary: { fontSize: 13, color: '#333', margin: '0 0 6px' },
  alertRisk: { fontSize: 12, color: '#b45', margin: 0 },
  sourceRow: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8, padding: '8px 10px', background: '#f9f9f8', borderRadius: 6 },
  sourceLabel: { fontSize: 11, color: '#888', fontWeight: 500 },
  sourceLink: { fontSize: 12, color: '#1a1a18', textDecoration: 'underline', cursor: 'pointer', lineHeight: 1.4 },
  brokerBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', marginBottom: 16, borderBottom: '1px solid #f0f0ef' },
  brokerConnected: { fontSize: 13, color: '#2a7a4b', fontWeight: 500 },
  connectBtn: { background: '#1a1a18', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  syncBtn: { background: 'none', color: '#1a1a18', border: '1px solid #ddd', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer' },
};