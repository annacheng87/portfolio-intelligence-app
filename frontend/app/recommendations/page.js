'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import api from '../../lib/api';

const DARK  = { bg:'#0a0a0a',surface:'#111111',surface2:'#1a1a1a',border:'#2a2a2a',text:'#ffffff',textMuted:'#888888',textDim:'#555555',green:'#00c853',greenDim:'#1a3a1a',red:'#ff3b3b',redDim:'#3a1a1a',accent:'#00c853',navBg:'#0d0d0d',navActive:'#1a1a1a',inputBg:'#1a1a1a' };
const LIGHT = { bg:'#f4f4f2',surface:'#ffffff',surface2:'#f8f8f6',border:'#e0e0dc',text:'#0a0a0a',textMuted:'#666666',textDim:'#aaaaaa',green:'#00a846',greenDim:'#e8f5ee',red:'#d93025',redDim:'#fce8e8',accent:'#00a846',navBg:'#ffffff',navActive:'#f0f0ee',inputBg:'#f4f4f2' };

function RecCard({ rec, t }) {
  const isNew = rec.recType === 'new_pick';
  const labelColor = rec.label === 'bullish' ? t.green : rec.label === 'bearish' ? t.red : '#f0a500';
  const labelBg    = rec.label === 'bullish' ? t.greenDim : rec.label === 'bearish' ? t.redDim : '#f0a50022';

  return (
    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: t.text }}>{rec.ticker}</span>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: isNew ? `${t.accent}22` : t.surface2, color: isNew ? t.accent : t.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {isNew ? '+ New Pick' : '↑ Add More'}
          </span>
          {rec.label && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: labelBg, color: labelColor, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {rec.label}
            </span>
          )}
        </div>
        {rec.signalScore && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: labelColor }}>{Math.round(rec.signalScore)}</div>
            <div style={{ fontSize: 10, color: t.textDim }}>signal</div>
          </div>
        )}
      </div>
      <p style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.6, margin: 0, marginBottom: 12 }}>{rec.reasoning}</p>
      <div style={{ fontSize: 11, color: t.textDim }}>
        Updated {new Date(rec.computedAt).toLocaleString()}
      </div>
    </div>
  );
}

export default function RecommendationsPage() {
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(true);
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);
  const [computeStatus, setComputeStatus] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const t = darkMode ? DARK : LIGHT;

  useEffect(() => { fetchRecs(); }, []);

  async function fetchRecs() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/recommendations');
      setRecs(res.data.recommendations || []);
    } catch (err) {
      setError('Failed to load recommendations.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCompute() {
    setComputing(true);
    setComputeStatus('Analysing your portfolio...');
    setError(null);
    try {
      await api.post('/recommendations/compute');
      setComputeStatus('Claude is generating recommendations...');
      await new Promise(r => setTimeout(r, 12000));
      setComputeStatus('Loading results...');
      await fetchRecs();
      setComputeStatus('Done!');
      setTimeout(() => setComputeStatus(null), 3000);
    } catch (err) {
      setError('Computation failed. Check backend logs.');
      setComputeStatus(null);
    } finally {
      setComputing(false);
    }
  }

  const newPicks = recs.filter(r => r.recType === 'new_pick');
  const addMore  = recs.filter(r => r.recType === 'add_more');
  const filtered = filter === 'all' ? recs : filter === 'new' ? newPicks : addMore;

  return (
    <div style={{ minHeight: '100vh', background: t.bg, color: t.text, fontFamily: '"DM Sans",system-ui,sans-serif', padding: 32 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => router.push('/dashboard')} style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: 8, padding: '6px 12px', color: t.textMuted, cursor: 'pointer', fontSize: 13 }}>← Back</button>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Recommendations</h1>
            <p style={{ fontSize: 13, color: t.textMuted, margin: 0, marginTop: 4 }}>AI-powered stock picks based on your portfolio gaps and signal scores</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setDarkMode(d => !d)} style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: 8, padding: '6px 12px', color: t.textMuted, cursor: 'pointer', fontSize: 13 }}>{darkMode ? '☀️ Light' : '🌙 Dark'}</button>
          <button onClick={handleCompute} disabled={computing} style={{ background: t.accent, border: 'none', borderRadius: 8, padding: '8px 20px', color: '#000', cursor: computing ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: computing ? 0.7 : 1 }}>{computing ? 'Computing...' : '✦ Generate'}</button>
        </div>
      </div>

      {/* Status banners */}
      {computeStatus && <div style={{ background: t.surface, border: `1px solid ${t.accent}44`, borderRadius: 10, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: t.accent }}>✦ {computeStatus}</div>}
      {error && <div style={{ background: t.redDim, border: `1px solid ${t.red}`, borderRadius: 10, padding: '12px 16px', marginBottom: 24, fontSize: 13, color: t.red }}>{error}</div>}

      {/* Summary strip */}
      {recs.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'New Picks', count: newPicks.length, color: t.accent, bg: `${t.accent}22` },
            { label: 'Add More', count: addMore.length,  color: '#f0a500', bg: '#f0a50022' },
          ].map(c => (
            <div key={c.label} style={{ background: c.bg, border: `1px solid ${c.color}44`, borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: c.color, fontWeight: 600 }}>{c.label}</span>
              <span style={{ fontSize: 24, fontWeight: 800, color: c.color }}>{c.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      {recs.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
          {[
            { key: 'all', label: 'All' },
            { key: 'new', label: '+ New Picks' },
            { key: 'add', label: '↑ Add More' },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} style={{ padding: '6px 16px', borderRadius: 8, border: `1px solid ${t.border}`, background: filter === f.key ? t.accent : 'transparent', color: filter === f.key ? '#000' : t.textMuted, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{f.label}</button>
          ))}
        </div>
      )}

      {/* Cards */}
      {loading ? (
        <div style={{ color: t.textMuted, fontSize: 13 }}>Loading...</div>
      ) : recs.length === 0 ? (
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: 24, color: t.textMuted, fontSize: 13 }}>
          No recommendations yet. Click <b>✦ Generate</b> to get AI-powered stock picks based on your portfolio.
          <div style={{ marginTop: 12, fontSize: 12, color: t.textDim }}>Note: Run Signal Fusion first for best results.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))', gap: 16 }}>
          {filtered.map(rec => <RecCard key={rec.id} rec={rec} t={t} />)}
        </div>
      )}
    </div>
  );
}