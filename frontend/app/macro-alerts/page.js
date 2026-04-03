'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import api from '../../lib/api';

const DARK  = { bg:'#0a0a0a',surface:'#111111',surface2:'#1a1a1a',border:'#2a2a2a',text:'#ffffff',textMuted:'#888888',textDim:'#555555',green:'#00c853',greenDim:'#1a3a1a',red:'#ff3b3b',redDim:'#3a1a1a',accent:'#00c853',navBg:'#0d0d0d',navActive:'#1a1a1a',inputBg:'#1a1a1a' };
const LIGHT = { bg:'#f4f4f2',surface:'#ffffff',surface2:'#f8f8f6',border:'#e0e0dc',text:'#0a0a0a',textMuted:'#666666',textDim:'#aaaaaa',green:'#00a846',greenDim:'#e8f5ee',red:'#d93025',redDim:'#fce8e8',accent:'#00a846',navBg:'#ffffff',navActive:'#f0f0ee',inputBg:'#f4f4f2' };

export default function MacroAlertsPage() {
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(true);
  const [events, setEvents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [error, setError] = useState(null);
  const t = darkMode ? DARK : LIGHT;

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const [eventsRes, alertsRes] = await Promise.all([
        api.get('/polymarket/relevant-events'),
        api.get('/polymarket/alerts'),
      ]);
      setEvents(eventsRes.data.events || []);
      setAlerts(alertsRes.data.alerts || []);
    } catch (err) {
      setError('Failed to load data. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncStatus('Starting sync...');
    setError(null);
    try {
      await api.post('/polymarket/jobs/sync-polymarket');
      setSyncStatus('Syncing events (this takes ~15s)...');
      await new Promise(r => setTimeout(r, 8000));
      setSyncStatus('Mapping events to tickers...');
      await new Promise(r => setTimeout(r, 7000));
      setSyncStatus('Loading results...');
      await fetchData();
      setSyncStatus('Done!');
      setTimeout(() => setSyncStatus(null), 3000);
    } catch (err) {
      setError('Sync failed. Check backend logs.');
      setSyncStatus(null);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div style={{minHeight:'100vh',background:t.bg,color:t.text,fontFamily:'"DM Sans",system-ui,sans-serif',padding:32}}>

      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:32}}>
        <div style={{display:'flex',alignItems:'center',gap:16}}>
          <button onClick={()=>router.push('/dashboard')} style={{background:'none',border:`1px solid ${t.border}`,borderRadius:8,padding:'6px 12px',color:t.textMuted,cursor:'pointer',fontSize:13}}>← Back</button>
          <div>
            <h1 style={{fontSize:24,fontWeight:700,margin:0,letterSpacing:'-0.02em'}}>Macro Alerts</h1>
            <p style={{fontSize:13,color:t.textMuted,margin:0,marginTop:4}}>Polymarket event probabilities mapped to your portfolio</p>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <button onClick={()=>setDarkMode(d=>!d)} style={{background:'none',border:`1px solid ${t.border}`,borderRadius:8,padding:'6px 12px',color:t.textMuted,cursor:'pointer',fontSize:13}}>{darkMode?'☀️ Light':'🌙 Dark'}</button>
          <button onClick={handleSync} disabled={syncing} style={{background:t.accent,border:'none',borderRadius:8,padding:'8px 20px',color:'#000',cursor:syncing?'not-allowed':'pointer',fontSize:13,fontWeight:600,opacity:syncing?0.7:1}}>{syncing?'Syncing...':'⟳ Sync'}</button>
        </div>
      </div>

      {/* Status banners */}
      {syncStatus&&<div style={{background:t.surface,border:`1px solid ${t.accent}44`,borderRadius:10,padding:'10px 16px',marginBottom:16,fontSize:13,color:t.accent}}>⟳ {syncStatus}</div>}
      {error&&<div style={{background:t.redDim,border:`1px solid ${t.red}`,borderRadius:10,padding:'12px 16px',marginBottom:24,fontSize:13,color:t.red}}>{error}</div>}

      {/* Active Alerts */}
      <div style={{marginBottom:32}}>
        <h2 style={{fontSize:11,fontWeight:600,marginBottom:16,color:t.textMuted,letterSpacing:'0.05em',textTransform:'uppercase'}}>⚠ Active Alerts</h2>
        {loading ? (
          <div style={{color:t.textMuted,fontSize:13}}>Loading...</div>
        ) : alerts.length === 0 ? (
          <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,padding:24,color:t.textMuted,fontSize:13}}>No alerts yet. Click Sync to fetch latest Polymarket data.</div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {alerts.map(alert=>(
              <div key={alert.id} style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,padding:'16px 20px'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                  <span style={{fontWeight:600,fontSize:14}}>{alert.ticker}</span>
                  <span style={{fontSize:11,color:t.textMuted,background:t.surface2,padding:'2px 8px',borderRadius:20}}>{alert.alertType}</span>
                </div>
                <p style={{fontSize:13,color:t.textMuted,margin:0,marginBottom:8}}>{alert.message}</p>
                <div style={{display:'flex',gap:16,fontSize:11,color:t.textDim}}>
                  <span>Shift: <b style={{color:t.red}}>+{(parseFloat(alert.shiftMagnitude||0)*100).toFixed(1)}%</b></span>
                  <span>{new Date(alert.createdAt).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Relevant Events */}
      <div>
        <h2 style={{fontSize:11,fontWeight:600,marginBottom:16,color:t.textMuted,letterSpacing:'0.05em',textTransform:'uppercase'}}>📊 Relevant Events</h2>
        {loading ? (
          <div style={{color:t.textMuted,fontSize:13}}>Loading...</div>
        ) : events.length === 0 ? (
          <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,padding:24,color:t.textMuted,fontSize:13}}>No events mapped yet. Click Sync to pull from Polymarket.</div>
        ) : (
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:16}}>
            {events.map(item=>(
              <div key={item.event.id} style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,padding:'16px 20px'}}>

                {/* Clickable event title */}
                <a
                  href={item.event.slug
                    ? `https://polymarket.com/event/${item.event.slug}`
                    : `https://news.google.com/search?q=${encodeURIComponent(item.event.title)}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{fontWeight:600,fontSize:14,marginBottom:6,color:t.text,textDecoration:'none',display:'block',cursor:'pointer'}}
                  onMouseEnter={e=>e.currentTarget.style.color=t.accent}
                  onMouseLeave={e=>e.currentTarget.style.color=t.text}
                >
                  {item.event.title} ↗
                </a>

                <div style={{fontSize:12,color:t.textMuted,marginBottom:12}}>{item.event.category}</div>

                {item.event.markets?.slice(0,2).map(m=>(
                  <div key={m.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                    <span style={{fontSize:12,color:t.textMuted,flex:1,marginRight:8}}>{m.question?.slice(0,50)}...</span>
                    <span style={{fontSize:13,fontWeight:700,color:parseFloat(m.currentYesProb)>0.6?t.green:parseFloat(m.currentYesProb)<0.4?t.red:t.text}}>
                      {(parseFloat(m.currentYesProb||0)*100).toFixed(0)}%
                    </span>
                  </div>
                ))}

                {item.matchedTickers?.length>0&&(
                  <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${t.border}`,display:'flex',gap:6,flexWrap:'wrap'}}>
                    {item.matchedTickers.map(ticker=>(
                      <span key={ticker} style={{fontSize:11,background:t.surface2,border:`1px solid ${t.border}`,borderRadius:6,padding:'2px 8px',color:t.textMuted}}>{ticker}</span>
                    ))}
                  </div>
                )}

              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}