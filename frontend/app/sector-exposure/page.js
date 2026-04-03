'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import api from '../../lib/api';

const DARK  = { bg:'#0a0a0a',surface:'#111111',surface2:'#1a1a1a',border:'#2a2a2a',text:'#ffffff',textMuted:'#888888',textDim:'#555555',green:'#00c853',greenDim:'#1a3a1a',red:'#ff3b3b',redDim:'#3a1a1a',accent:'#00c853',navBg:'#0d0d0d',navActive:'#1a1a1a',inputBg:'#1a1a1a' };
const LIGHT = { bg:'#f4f4f2',surface:'#ffffff',surface2:'#f8f8f6',border:'#e0e0dc',text:'#0a0a0a',textMuted:'#666666',textDim:'#aaaaaa',green:'#00a846',greenDim:'#e8f5ee',red:'#d93025',redDim:'#fce8e8',accent:'#00a846',navBg:'#ffffff',navActive:'#f0f0ee',inputBg:'#f4f4f2' };

function fmt(n, d=2) { if (n == null) return '—'; return parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function fmtDollar(n) { if (n == null) return '—'; const abs = Math.abs(parseFloat(n)); const sign = parseFloat(n) < 0 ? '-' : ''; return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function pctColor(n, t) { if (n == null) return t.textMuted; return parseFloat(n) >= 0 ? t.green : t.red; }

function DonutChart({ sectors, size = 200, t }) {
  const total = sectors.reduce((s, sec) => s + sec.weightPct, 0);
  if (total === 0) return null;

 const slices = sectors.reduce((acc, sec) => {
  const prevEnd = acc.length ? acc[acc.length - 1].endDeg : 0;
  const endDeg = prevEnd + (sec.weightPct / total) * 360;

  acc.push({
    ...sec,
    startDeg: prevEnd,
    endDeg,
  });

  return acc;
}, []);

  function polarToCartesian(cx, cy, r, deg) {
    const rad = (deg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function describeArc(cx, cy, r, startDeg, endDeg) {
    if (endDeg - startDeg >= 360) endDeg = startDeg + 359.99;
    const start = polarToCartesian(cx, cy, r, startDeg);
    const end   = polarToCartesian(cx, cy, r, endDeg);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
  }

  const cx = size / 2;
  const cy = size / 2;
  const r  = size / 2 - 16;
  const inner = r * 0.80;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size}>
          {slices.map((s, i) => (
            <path
              key={i}
              d={describeArc(cx, cy, r, s.startDeg, s.endDeg)}
              fill="none"
              stroke={s.color}
              strokeWidth={r - inner}
              strokeLinecap="butt"
              opacity={0.9}
            />
          ))}
          <circle cx={cx} cy={cy} r={inner} fill="transparent" />
        </svg>
        {/* Center label */}
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 4 }}>Sectors</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: t.text }}>{sectors.length}</div>
        </div>
      </div>

      {/* Legend row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px 20px', maxWidth: 500 }}>
        {sectors.map(s => (
          <div key={s.sector} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: t.textMuted }}>{s.sector}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>{fmt(s.weightPct, 1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SectorExposurePage() {
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const t = darkMode ? DARK : LIGHT;

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/portfolio/sector-exposure');
      setData(res.data.data);
    } catch (err) {
      setError('Failed to load sector exposure. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  }

  const sectors = data?.sectors || [];

  return (
    <div style={{ minHeight: '100vh', background: t.bg, color: t.text, fontFamily: '"DM Sans",system-ui,sans-serif', padding: 32 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => router.push('/dashboard')} style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: 8, padding: '6px 12px', color: t.textMuted, cursor: 'pointer', fontSize: 13 }}>← Back</button>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Sector Exposure</h1>
            <p style={{ fontSize: 13, color: t.textMuted, margin: 0, marginTop: 4 }}>Portfolio breakdown by sector and industry</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setDarkMode(d => !d)} style={{ background: 'none', border: `1px solid ${t.border}`, borderRadius: 8, padding: '6px 12px', color: t.textMuted, cursor: 'pointer', fontSize: 13 }}>{darkMode ? '☀️ Light' : '🌙 Dark'}</button>
          <button onClick={fetchData} style={{ background: t.accent, border: 'none', borderRadius: 8, padding: '8px 20px', color: '#000', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>⟳ Refresh</button>
        </div>
      </div>

      {error && (
        <div style={{ background: t.redDim, border: `1px solid ${t.red}`, borderRadius: 10, padding: '12px 16px', marginBottom: 24, fontSize: 13, color: t.red }}>{error}</div>
      )}

      {loading ? (
        <div style={{ color: t.textMuted, fontSize: 13 }}>Loading...</div>
      ) : sectors.length === 0 ? (
        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: 24, color: t.textMuted, fontSize: 13 }}>
          No holdings found. Connect a broker and sync your portfolio first.
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 40 }}>
            {[
              { label: 'Total Portfolio', value: fmtDollar(data?.totalPortfolio) },
              { label: 'Sectors',         value: sectors.length },
              { label: 'Last Updated',    value: data?.lastComputedAt ? new Date(data.lastComputedAt).toLocaleTimeString() : '—' },
            ].map((c, i) => (
              <div key={i} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: '16px 20px' }}>
                <div style={{ fontSize: 11, color: t.textDim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{c.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: t.text }}>{c.value}</div>
              </div>
            ))}
          </div>

          {/* Donut — centered, full width */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 48 }}>
            <DonutChart sectors={sectors} size={340} t={t} />
          </div>

          {/* Sector cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 16 }}>
            {sectors.map(s => (
              <div
                key={s.sector}
                onClick={() => setSelected(selected === s.sector ? null : s.sector)}
                style={{ background: t.surface, border: `1px solid ${selected === s.sector ? s.color : t.border}`, borderRadius: 14, padding: '16px 20px', cursor: 'pointer', transition: 'border-color 0.2s' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 4, background: s.color }} />
                    <span style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{s.sector}</span>
                  </div>
                  <span style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{fmt(s.weightPct, 1)}%</span>
                </div>

                <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 10 }}>{s.tickers.join(', ')}</div>

                <div style={{ height: 4, background: t.surface2, borderRadius: 2, marginBottom: 14, overflow: 'hidden' }}>
                  <div style={{ width: `${s.weightPct}%`, height: '100%', background: s.color, borderRadius: 2, transition: 'width 0.6s ease' }} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                  {[
                    { label: 'Market Value', value: fmtDollar(s.totalValue),  color: t.text },
                    { label: "Today's P&L",  value: fmtDollar(s.dailyPnl),   color: pctColor(s.dailyPnl, t) },
                    { label: 'Total P&L',    value: fmtDollar(s.totalPnl),   color: pctColor(s.totalPnl, t) },
                  ].map((stat, i) => (
                    <div key={i}>
                      <div style={{ fontSize: 10, color: t.textDim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{stat.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: stat.color }}>{stat.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {data?.metadataMissing?.length > 0 && (
            <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, padding: '10px 16px', marginTop: 20, fontSize: 12, color: t.textMuted }}>
              ⚠ Sector data unavailable for: <b>{data.metadataMissing.join(', ')}</b> — showing as Unknown.
            </div>
          )}
        </>
      )}
    </div>
  );
}