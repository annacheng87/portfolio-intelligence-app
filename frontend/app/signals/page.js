'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import api from '../../lib/api';

const DARK  = { bg:'#0a0a0a',surface:'#111111',surface2:'#1a1a1a',border:'#2a2a2a',text:'#ffffff',textMuted:'#888888',textDim:'#555555',green:'#00c853',greenDim:'#1a3a1a',red:'#ff3b3b',redDim:'#3a1a1a',accent:'#00c853',navBg:'#0d0d0d',navActive:'#1a1a1a',inputBg:'#1a1a1a' };
const LIGHT = { bg:'#f4f4f2',surface:'#ffffff',surface2:'#f8f8f6',border:'#e0e0dc',text:'#0a0a0a',textMuted:'#666666',textDim:'#aaaaaa',green:'#00a846',greenDim:'#e8f5ee',red:'#d93025',redDim:'#fce8e8',accent:'#00a846',navBg:'#ffffff',navActive:'#f0f0ee',inputBg:'#f4f4f2' };

function ScoreBar({ score, t }) {
  const color = score >= 65 ? t.green : score <= 35 ? t.red : '#f0a500';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: t.surface2, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 28, textAlign: 'right' }}>{score}</span>
    </div>
  );
}

function SignalCard({ signal, t }) {
  const labelColor = signal.label === 'bullish' ? t.green : signal.label === 'bearish' ? t.red : '#f0a500';
  const labelBg    = signal.label === 'bullish' ? t.greenDim : signal.label === 'bearish' ? t.redDim : '#f0a50022';
  const scores = [
    { label: 'Price',     value: signal.priceScore },
    { label: 'Volume',    value: signal.volumeScore },
    { label: 'News',      value: signal.newsScore },
    { label: 'Reddit',    value: signal.redditScore },
    { label: 'Polymarket',value: signal.polyScore },
  ];

  return (
    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: t.text }}>{signal.ticker}</span>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: labelBg, color: labelColor, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{signal.label}</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: labelColor }}>{signal.compositeScore}</div>
          <div style={{ fontSize: 10, color: t.textDim }}>/ 100</div>
        </div>
      </div>

      {/* Composite bar */}
      <div style={{ marginBottom: 14 }}>
        <ScoreBar score={signal.compositeScore} t={t} />
      </div>

      {/* Sub-scores */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {scores.map(s => s.value != null && (
          <div key={s.label} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: t.textDim }}>{s.label}</span>
            <ScoreBar score={parseFloat(s.value)} t={t} />
          </div>
        ))}
      </div>

      <div style={{ fontSize: 10, color: t.textDim, marginTop: 12 }}>
        Updated {new Date(signal.computedAt).toLocaleString()}
      </div>
    </div>
  );
}

export default function SignalsPage() {
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(true);
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);
  const [computeStatus, setComputeStatus] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const t = darkMode ? DARK : LIGHT;

  useEffect(() => { fetchSignals(); }, []);

  async function fetchSignals() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/signals');
      setSignals(res.data.signals || []);
    } catch (err) {
      setError('Failed to load signals. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCompute() {
    setComputing(true);
    setComputeStatus('Computing signals...');
    setError(null);
    try {
      await api.post('/signals/compute');
      setComputeStatus('Processing sentiment & market data...');
      await new Promise(r => setTimeout(r, 12000));
      setComputeStatus('Loading results...');
      await fetchSignals();
      setComputeStatus('Done!');
      setTimeout(() => setComputeStatus(null), 3000);
    } catch (err) {
      setError('Computation failed. Check backend logs.');
      setComputeStatus(null);
    } finally {
      setComputing(false);
    }
  }

  const filtered = signals.filter(s =>
    filter === 'all' ? true :
    filter === 'bullish' ? s.label === 'bullish' :
    filter === 'bearish' ? s.label === 'bearish' :
    s.label === 'neutral'
  );

  const counts = {
    bullish: signals.filter(s => s.label === 'bullish').length,
    neutral: signals.filter(s => s.label === 'neutral').length,
    bearish: signals.filter(s => s.label === 'bearish').length,
  };

  return (
    <div style={{ minHeight: '100vh', background: t.bg, color: t.text, fontFamily: '"DM Sans",system-ui,sans-serif', padding: 32 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => router.push('/dashboard')} style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: 8, padding: '6px 12px', color: t.textMuted, cursor: 'pointer', fontSize: 13 }}>← Back</button>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Signal Fusion</h1>
            <p style={{ fontSize: 13, color: t.textMuted, margin: 0, marginTop: 4 }}>Composite buy/hold/sell signals from price, sentiment & prediction markets</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setDarkMode(d => !d)} style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: 8, padding: '6px 12px', color: t.textMuted, cursor: 'pointer', fontSize: 13 }}>{darkMode ? '☀️ Light' : '🌙 Dark'}</button>
          <button onClick={handleCompute} disabled={computing} style={{ background: t.accent, border: 'none', borderRadius: 8, padding: '8px 20px', color: '#000', cursor: computing ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: computing ? 0.7 : 1 }}>{computing ? 'Computing...' : '⟳ Compute'}</button>
        </div>
      </div>

      {/* Status banners */}
      {computeStatus && <div style={{ background: t.surface, border: `1px solid ${t.accent}44`, borderRadius: 10, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: t.accent }}>⟳ {computeStatus}</div>}
      {error && <div style={{ background: t.redDim, border: `1px solid ${t.red}`, borderRadius: 10, padding: '12px 16px', marginBottom: 24, fontSize: 13, color: t.red }}>{error}</div>}

      {/* Summary strip */}
      {signals.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Bullish', count: counts.bullish, color: t.green, bg: t.greenDim },
            { label: 'Neutral', count: counts.neutral, color: '#f0a500', bg: '#f0a50022' },
            { label: 'Bearish', count: counts.bearish, color: t.red, bg: t.redDim },
          ].map(c => (
            <div key={c.label} style={{ background: c.bg, border: `1px solid ${c.color}44`, borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: c.color, fontWeight: 600 }}>{c.label}</span>
              <span style={{ fontSize: 24, fontWeight: 800, color: c.color }}>{c.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      {signals.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
          {['all', 'bullish', 'neutral', 'bearish'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ padding: '6px 16px', borderRadius: 8, border: `1px solid ${t.border}`, background: filter === f ? t.accent : 'transparent', color: filter === f ? '#000' : t.textMuted, fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>{f}</button>
          ))}
        </div>
      )}

      {/* Signal cards */}
      {loading ? (
        <div style={{ color: t.textMuted, fontSize: 13 }}>Loading...</div>
      ) : signals.length === 0 ? (
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: 24, color: t.textMuted, fontSize: 13 }}>
          No signals yet. Click <b>⟳ Compute</b> to run signal fusion across your portfolio and watchlist.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 16 }}>
          {filtered.map(signal => (
            <SignalCard key={signal.id} signal={signal} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}