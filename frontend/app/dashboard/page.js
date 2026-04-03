'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend } from 'chart.js';
import api, { getGlobalLeaderboard, toggleLeaderboardOptIn, getMyInviteCode, redeemFriendCode, getFriends, removeFriend, getFriendsLeaderboard } from '../../lib/api';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

const DARK  = { bg:'#0a0a0a',surface:'#111111',surface2:'#1a1a1a',border:'#2a2a2a',text:'#ffffff',textMuted:'#888888',textDim:'#555555',green:'#00c853',greenDim:'#1a3a1a',red:'#ff3b3b',redDim:'#3a1a1a',accent:'#00c853',navBg:'#0d0d0d',navActive:'#1a1a1a',inputBg:'#1a1a1a' };
const LIGHT = { bg:'#f4f4f2',surface:'#ffffff',surface2:'#f8f8f6',border:'#e0e0dc',text:'#0a0a0a',textMuted:'#666666',textDim:'#aaaaaa',green:'#00a846',greenDim:'#e8f5ee',red:'#d93025',redDim:'#fce8e8',accent:'#00a846',navBg:'#ffffff',navActive:'#f0f0ee',inputBg:'#f4f4f2' };

const ALERT_CATEGORIES = [
  { group:'Real-time alerts', items:[
    { key:'large_holding_move', label:'Large holding move', desc:'Alert when a stock moves above your threshold', defaultThreshold:5, unit:'%' },
    { key:'portfolio_value_change', label:'Portfolio value change', desc:'Alert when your total portfolio moves beyond a threshold', defaultThreshold:2, unit:'%' },
    { key:'drawdown', label:'Drawdown alert', desc:'Alert when portfolio drops from a recent 30-day high', defaultThreshold:5, unit:'%' },
    { key:'watchlist_price_target', label:'Watchlist price target', desc:'Alert when a watchlist stock crosses your price target', defaultThreshold:null, unit:null },
    { key:'major_news', label:'Major news', desc:'Alert when major news hits a held or watchlisted stock', defaultThreshold:null, unit:null },
    { key:'earnings', label:'Earnings alerts', desc:'Pre-earnings reminder and post-earnings alert', defaultThreshold:null, unit:null },
    { key:'volume_spike', label:'Volume spike', desc:'Alert when a stock sees unusually high trading volume', defaultThreshold:2, unit:'x' },
  ]},
  { group:'Digest alerts', items:[
    { key:'concentration_risk', label:'Concentration risk', desc:'Alert when one holding exceeds a large % of portfolio', defaultThreshold:25, unit:'%' },
    { key:'cost_basis_deviation', label:'Cost basis deviation', desc:'Alert when a holding moves significantly from cost basis', defaultThreshold:15, unit:'%' },
    { key:'dividend_corporate', label:'Dividends & corporate', desc:'Ex-dividend dates, splits, mergers', defaultThreshold:null, unit:null },
    { key:'reddit_alignment', label:'Reddit + price + news', desc:'Multi-signal: Reddit buzz, price move, and news align', defaultThreshold:null, unit:null },
    { key:'watchlist_move', label:'Watchlist daily move', desc:'Alert when a watchlist stock moves sharply', defaultThreshold:5, unit:'%' },
    { key:'watchlist_news', label:'Watchlist news', desc:'News on watchlist stocks', defaultThreshold:null, unit:null },
  ]},
  { group:'Leaderboard alerts', items:[
    { key:'rank_passed', label:'Someone passes your rank', desc:'Alert when your leaderboard rank drops', defaultThreshold:null, unit:null },
    { key:'top_3_entered', label:'You enter top 3 or top 10', desc:'Alert when you move into the top rankings', defaultThreshold:null, unit:null },
    { key:'streak_milestone', label:'Streaks & milestones', desc:'Performance streaks and milestones', defaultThreshold:null, unit:null },
  ]},
  { group:'Digests', items:[
    { key:'daily_digest', label:'Daily digest email', desc:'One email after market close with daily summary', defaultThreshold:null, unit:null },
    { key:'weekly_digest', label:'Weekly digest email', desc:'Saturday morning recap of the full week', defaultThreshold:null, unit:null },
    { key:'sms_realtime', label:'SMS for real-time alerts', desc:'Short SMS for real-time alerts only', defaultThreshold:null, unit:null },
  ]},
];

const TIERS = [
  { name:'Bronze',  min:0,    max:500,  color:'#cd7f32', bg:'rgba(205,127,50,0.15)',  icon:'🥉' },
  { name:'Silver',  min:500,  max:1500, color:'#aaaaaa', bg:'rgba(170,170,170,0.15)', icon:'🥈' },
  { name:'Gold',    min:1500, max:3000, color:'#ffd700', bg:'rgba(255,215,0,0.15)',   icon:'🥇' },
  { name:'Plat',    min:3000, max:6000, color:'#00d4ff', bg:'rgba(0,212,255,0.15)',   icon:'💎' },
  { name:'Diamond', min:6000, max:9999, color:'#b388ff', bg:'rgba(179,136,255,0.15)', icon:'👑' },
];
const CHALLENGES = [
  { id:'first_trade',    label:'First Trade',       desc:'Place your first order',                icon:'🎯', xp:100,  done:false },
  { id:'green_3',        label:'3-Day Streak',       desc:'3 consecutive green days',             icon:'🔥', xp:150,  done:false },
  { id:'diversified',    label:'Diversified',        desc:'Hold 5+ different tickers',            icon:'🌐', xp:200,  done:false },
  { id:'watchlist_10',   label:'Watchlist Pro',      desc:'Add 10 tickers to watchlist',          icon:'👁',  xp:75,   done:false },
  { id:'leaderboard_10', label:'Top 10',             desc:'Reach top 10 on the leaderboard',      icon:'🏆', xp:500,  done:false },
  { id:'invite_friend',  label:'Invite a Friend',    desc:'Get someone to join via your code',    icon:'🤝', xp:250,  done:false },
];

function getTier(xp){ return TIERS.slice().reverse().find(t=>xp>=t.min)||TIERS[0]; }
function getNextTier(xp){ const i=TIERS.findIndex(t=>xp<t.max); return i>=0?TIERS[i]:TIERS[TIERS.length-1]; }
function fmt(n,d=2){if(n==null)return'—';return parseFloat(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});}
function fmtDollar(n){if(n==null)return'—';const abs=Math.abs(parseFloat(n));const sign=parseFloat(n)<0?'-':'';return`${sign}$${abs.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;}
function fmtPct(n){if(n==null)return'—';const sign=parseFloat(n)>=0?'+':'';return`${sign}${parseFloat(n).toFixed(2)}%`;}
function pctColor(n,t){if(n==null)return t.textMuted;return parseFloat(n)>=0?t.green:t.red;}
function timeAgo(ts){if(!ts)return'';const s=Math.floor((Date.now()-new Date(ts))/1000);if(s<60)return`${s}s ago`;if(s<3600)return`${Math.floor(s/60)}m ago`;if(s<86400)return`${Math.floor(s/3600)}h ago`;return`${Math.floor(s/86400)}d ago`;}

const ORDER_TYPES=['Market','Limit','Stop'];
const TIMEFRAMES=[
  {label:'1D',days:1},{label:'1W',days:7},{label:'1M',days:30},
  {label:'3M',days:90},{label:'1Y',days:365},{label:'ALL',days:999},
];
const NAV_ITEMS=[
  {id:'dashboard',  label:'Dashboard',   icon:'▦'},
  {id:'performance',label:'Performance', icon:'↗'},
  {id:'trade',      label:'Trade',       icon:'⊞'},
  {id:'social',     label:'Social',      icon:'◎'},
  {id:'alerts',     label:'Alerts',      icon:'◉'},
  {id:'macro',      label:'Macro Alerts',icon:'⬡', href:'/macro-alerts'},
  {id:'settings',   label:'Settings',    icon:'⊙'},
];

// ─── Social Tab ────────────────────────────────────────────────────────────────
function SocialTab({t, user}){
  const[view,setView]=useState('global');
  const[globalData,setGlobalData]=useState([]);
  const[friendsData,setFriendsData]=useState([]);
  const[optedIn,setOptedIn]=useState(false);
  const[friends,setFriends]=useState([]);
  const[loading,setLoading]=useState(true);
  const[prevRank,setPrevRank]=useState(null);
  const[rankDelta,setRankDelta]=useState(null);
  // Mock XP/streak — in production these would come from the API
  const xp=1240; const streak=4; const tier=getTier(xp); const nextTier=getNextTier(xp);
  const xpPct=Math.round(((xp-tier.min)/(nextTier.max-tier.min))*100);

  useEffect(()=>{loadAll();},[]);
  async function loadAll(){
    setLoading(true);
    try{
      const[g,f,me,fr]=await Promise.all([getGlobalLeaderboard(),getFriendsLeaderboard(),api.get('/auth/me'),getFriends()]);
      const myEntry=g.data.find(r=>r.isYou);
      if(myEntry&&prevRank!==null&&myEntry.rank!==prevRank) setRankDelta(prevRank-myEntry.rank);
      if(myEntry) setPrevRank(myEntry.rank);
      setGlobalData(g.data);setFriendsData(f.data);setOptedIn(me.data.user?.leaderboardOptIn??false);setFriends(fr.data);
    }catch(e){console.error(e);}finally{setLoading(false);}
  }
  async function handleToggleOptIn(){const next=!optedIn;setOptedIn(next);try{await toggleLeaderboardOptIn(next);loadAll();}catch{setOptedIn(!next);}}
  async function handleRemove(id,name){if(!confirm(`Remove ${name}?`))return;try{await removeFriend(id);setFriends(p=>p.filter(f=>f.id!==id));}catch{alert('Failed.');}}
  const rows=view==='global'?globalData:friendsData;
  const myEntry=rows.find(r=>r.isYou);

  return(
    <div style={{display:'flex',flexDirection:'column',gap:20}}>

      {/* XP / Tier bar */}
      <div style={{background:t.surface,border:`1px solid ${tier.color}44`,borderRadius:16,padding:20,display:'flex',alignItems:'center',gap:20}}>
        <div style={{width:56,height:56,borderRadius:16,background:tier.bg,border:`2px solid ${tier.color}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:26,flexShrink:0}}>{tier.icon}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
            <div>
              <span style={{fontSize:15,fontWeight:700,color:tier.color}}>{tier.name}</span>
              <span style={{fontSize:12,color:t.textMuted,marginLeft:8}}>Level {Math.floor(xp/100)+1}</span>
            </div>
            <span style={{fontSize:12,color:t.textMuted}}>{xp} / {nextTier.max} XP</span>
          </div>
          <div style={{height:6,background:t.surface2,borderRadius:3,overflow:'hidden'}}>
            <div style={{width:`${xpPct}%`,height:'100%',background:`linear-gradient(90deg,${tier.color},${nextTier.color||tier.color})`,borderRadius:3,transition:'width 0.6s ease'}}/>
          </div>
          <div style={{fontSize:11,color:t.textDim,marginTop:4}}>{nextTier.max-xp} XP to {nextTier.name}</div>
        </div>
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4,flexShrink:0}}>
          <div style={{fontSize:22}}>🔥</div>
          <div style={{fontSize:18,fontWeight:700,color:'#ff6b35'}}>{streak}</div>
          <div style={{fontSize:10,color:t.textMuted,textTransform:'uppercase',letterSpacing:'0.06em'}}>Streak</div>
        </div>
      </div>

      {/* Challenges */}
      <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:16,padding:20}}>
        <div style={{fontSize:13,fontWeight:700,color:t.text,marginBottom:14,display:'flex',alignItems:'center',gap:8}}>
          <span>🎖</span> Challenges
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
          {CHALLENGES.map(ch=>(
            <div key={ch.id} style={{background:ch.done?`${t.accent}11`:t.surface2,border:`1px solid ${ch.done?t.accent:t.border}`,borderRadius:12,padding:'12px 10px',textAlign:'center',opacity:ch.done?1:0.7,transition:'all 0.2s'}}>
              <div style={{fontSize:22,marginBottom:4}}>{ch.icon}</div>
              <div style={{fontSize:11,fontWeight:600,color:ch.done?t.accent:t.text,marginBottom:2}}>{ch.label}</div>
              <div style={{fontSize:10,color:t.textMuted,marginBottom:6,lineHeight:1.3}}>{ch.desc}</div>
              <div style={{fontSize:10,fontWeight:700,color:'#ffd700'}}>+{ch.xp} XP</div>
            </div>
          ))}
        </div>
      </div>

      {/* Leaderboard */}
      <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:16,padding:24}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:20}}>🏆</span>
            <span style={{fontSize:15,fontWeight:600,color:t.text}}>Leaderboard</span>
            {rankDelta!==null&&rankDelta!==0&&(
              <span style={{fontSize:12,fontWeight:700,padding:'3px 8px',borderRadius:8,background:rankDelta>0?`${t.green}22`:`${t.red}22`,color:rankDelta>0?t.green:t.red}}>
                {rankDelta>0?`↑${rankDelta} spots`:`↓${Math.abs(rankDelta)} spots`}
              </span>
            )}
          </div>
          <div style={{display:'flex',gap:6}}>
            {['global','friends'].map(v=>(
              <button key={v} onClick={()=>setView(v)} style={{padding:'5px 14px',borderRadius:8,border:`1px solid ${t.border}`,background:view===v?t.accent:'transparent',color:view===v?'#000':t.textMuted,fontSize:12,fontWeight:600,cursor:'pointer',textTransform:'capitalize'}}>{v==='global'?'Global':'Friends'}</button>
            ))}
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
          <span style={{fontSize:12,color:t.textMuted}}>Show my performance on leaderboard</span>
          <div onClick={handleToggleOptIn} style={{width:36,height:20,borderRadius:10,background:optedIn?t.accent:'#333',position:'relative',cursor:'pointer',transition:'background 0.2s',flexShrink:0}}>
            <div style={{position:'absolute',top:3,left:optedIn?18:2,width:14,height:14,borderRadius:7,background:'#fff',transition:'left 0.2s'}}/>
          </div>
        </div>
        {myEntry&&(
          <div style={{background:t.greenDim,border:`1px solid ${t.accent}33`,borderRadius:10,padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:13,fontWeight:600,color:t.accent}}>Your rank: #{myEntry.rank}</span>
              <span style={{fontSize:11,color:tier.color,background:tier.bg,padding:'2px 8px',borderRadius:6,fontWeight:700}}>{tier.icon} {tier.name}</span>
            </div>
            <span style={{fontSize:13,fontWeight:700,color:pctColor(myEntry.dailyPctChange,t)}}>{fmtPct(myEntry.dailyPctChange)} today</span>
          </div>
        )}
        {loading?<div style={{textAlign:'center',color:t.textMuted,padding:'32px 0'}}>Loading...</div>
        :rows.length===0?<div style={{textAlign:'center',color:t.textMuted,padding:'32px 0'}}>No leaderboard data yet.</div>
        :(
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr>{['Rank','Trader','Tier','Daily Return'].map(h=>(<th key={h} style={{textAlign:h==='Daily Return'?'right':'left',fontSize:11,color:t.textDim,padding:'6px 10px',textTransform:'uppercase',letterSpacing:'0.06em'}}>{h}</th>))}</tr></thead>
            <tbody>
              {rows.map(row=>{
                const rowTier=getTier(row.xp||0);
                return(
                  <tr key={row.userId} style={{background:row.isYou?`${t.accent}11`:'transparent',transition:'background 0.2s'}}>
                    <td style={{padding:'10px',fontSize:16}}>{row.rank===1?'🥇':row.rank===2?'🥈':row.rank===3?'🥉':`#${row.rank}`}</td>
                    <td style={{padding:'10px',fontSize:13,color:t.text,fontWeight:row.isYou?600:400}}>
                      {row.displayName}
                      {row.isYou&&<span style={{marginLeft:6,fontSize:10,color:t.accent,background:`${t.accent}22`,padding:'2px 6px',borderRadius:4}}>you</span>}
                    </td>
                    <td style={{padding:'10px'}}><span style={{fontSize:11,color:rowTier.color,background:rowTier.bg,padding:'2px 8px',borderRadius:6,fontWeight:600}}>{rowTier.icon} {rowTier.name}</span></td>
                    <td style={{padding:'10px',textAlign:'right',fontSize:13,fontWeight:600,color:pctColor(row.dailyPctChange,t)}}>{fmtPct(row.dailyPctChange)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Friends list */}
      <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:16,padding:20}}>
        <div style={{fontSize:13,fontWeight:700,color:t.text,marginBottom:14}}>Friends ({friends.length})</div>
        {friends.length===0
          ?<div style={{color:t.textMuted,fontSize:13,textAlign:'center',padding:'16px 0'}}>No friends yet — invite someone from Settings!</div>
          :friends.map(f=>{
            const fTier=getTier(f.xp||0);
            return(
              <div key={f.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:`1px solid ${t.border}`}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:32,height:32,borderRadius:'50%',background:`${fTier.color}33`,border:`2px solid ${fTier.color}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}>{fTier.icon}</div>
                  <div>
                    <div style={{fontSize:13,fontWeight:500,color:t.text}}>{f.displayName||'Anonymous'}</div>
                    <div style={{fontSize:11,color:fTier.color}}>{fTier.name} · {f.xp||0} XP</div>
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:12,color:t.textMuted}}>{f.leaderboardOptIn?'📊 Public':'🔒 Private'}</span>
                  <button onClick={()=>handleRemove(f.id,f.displayName)} style={{fontSize:11,color:t.red,background:'none',border:'none',cursor:'pointer'}}>Remove</button>
                </div>
              </div>
            );
          })
        }
      </div>
    </div>
  );
}

// ─── Alert Card ────────────────────────────────────────────────────────────────
function AlertCard({alert,t}){
  const isReddit=alert.alertType==='reddit_alignment'||!!alert.redditUrl;
  const hasNews=!!alert.newsUrl||!!alert.newsHeadline;
  const ago=timeAgo(alert.triggeredAt);
  if(isReddit){
    return(
      <div style={{background:t.surface2,border:`1px solid ${t.border}`,borderRadius:14,padding:16,opacity:alert.isRead?0.55:1,transition:'opacity 0.2s'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
          <div style={{width:28,height:28,borderRadius:8,background:'#ff4500',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,flexShrink:0}}>🤖</div>
          <div>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <span style={{fontSize:11,fontWeight:700,color:'#ff4500'}}>r/wallstreetbets</span>
              <span style={{fontSize:10,color:t.textDim}}>· {ago}</span>
            </div>
            <div style={{fontSize:10,color:t.textDim}}>Reddit Sentiment Alert</div>
          </div>
          <span style={{marginLeft:'auto',fontSize:12,fontWeight:700,color:t.text,background:`${t.accent}22`,padding:'2px 8px',borderRadius:6}}>{alert.ticker}</span>
        </div>
        {alert.redditTitle&&<div style={{fontSize:13,fontWeight:600,color:t.text,marginBottom:6,lineHeight:1.4}}>{alert.redditTitle}</div>}
        <div style={{fontSize:12,color:t.textMuted,lineHeight:1.5,marginBottom:10}}>{alert.plainEnglishSummary}</div>
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <button style={{display:'flex',alignItems:'center',gap:4,background:'none',border:'none',color:t.textDim,fontSize:12,cursor:'pointer',padding:0}}>
            <span>▲</span><span>Vote</span>
          </button>
          {alert.redditUrl&&<a href={alert.redditUrl} target="_blank" rel="noreferrer" style={{fontSize:12,color:t.accent,textDecoration:'none'}}>View post →</a>}
        </div>
      </div>
    );
  }
  if(hasNews){
    return(
      <div style={{background:t.surface2,border:`1px solid ${t.border}`,borderRadius:14,padding:16,opacity:alert.isRead?0.55:1,transition:'opacity 0.2s'}}>
        <div style={{display:'flex',alignItems:'flex-start',gap:12}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
              <span style={{fontSize:10,fontWeight:700,color:t.accent,textTransform:'uppercase',letterSpacing:'0.06em'}}>📰 News Alert</span>
              <span style={{fontSize:10,color:t.textDim}}>· {alert.ticker}</span>
              <span style={{fontSize:10,color:t.textDim}}>· {ago}</span>
            </div>
            {alert.newsHeadline&&<div style={{fontSize:13,fontWeight:600,color:t.text,marginBottom:6,lineHeight:1.4}}>{alert.newsHeadline}</div>}
            <div style={{fontSize:12,color:t.textMuted,lineHeight:1.5,marginBottom:10}}>{alert.plainEnglishSummary}</div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:11,padding:'2px 8px',borderRadius:6,background:t.surface,color:t.textMuted,border:`1px solid ${t.border}`}}>{alert.alertType.replace(/_/g,' ')}</span>
              {alert.newsUrl&&<a href={alert.newsUrl} target="_blank" rel="noreferrer" style={{fontSize:12,color:t.accent,textDecoration:'none'}}>Read article →</a>}
            </div>
          </div>
        </div>
      </div>
    );
  }
  // Generic alert
  return(
    <div style={{background:t.surface2,border:`1px solid ${t.border}`,borderRadius:14,padding:14,opacity:alert.isRead?0.55:1}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
        <span style={{fontWeight:700,fontSize:14,color:t.text}}>{alert.ticker}</span>
        <span style={{fontSize:11,background:t.surface,color:t.textMuted,padding:'2px 8px',borderRadius:6,border:`1px solid ${t.border}`}}>{alert.alertType.replace(/_/g,' ')}</span>
        <span style={{marginLeft:'auto',fontSize:11,color:t.textDim}}>{ago}</span>
      </div>
      <div style={{fontSize:13,color:t.textMuted,lineHeight:1.5}}>{alert.plainEnglishSummary}</div>
    </div>
  );
}

// ─── Dashboard Page ────────────────────────────────────────────────────────────
export default function DashboardPage(){
  const[darkMode,setDarkMode]=useState(true);
  const[user,setUser]=useState(null);
  const[showProfileMenu,setShowProfileMenu]=useState(false);
  const[activeNav,setActiveNav]=useState('dashboard');
  const[holdings,setHoldings]=useState([]);
  const[performance,setPerformance]=useState(null);
  const[perfLoading,setPerfLoading]=useState(false);
  const[watchlist,setWatchlist]=useState([]);
  const[newTicker,setNewTicker]=useState('');
  const[alerts,setAlerts]=useState([]);
  const[brokerStatus,setBrokerStatus]=useState(null);
  const[prefs,setPrefs]=useState({});
  const[prefsSaving,setPrefsSaving]=useState(false);
  const[prefsSaved,setPrefsSaved]=useState(false);
  const[chartRange,setChartRange]=useState('1M');
  const[allSnapshots,setAllSnapshots]=useState([]);
  const[tradeAccounts,setTradeAccounts]=useState([]);
  const[tradeAccountsLoading,setTradeAccountsLoading]=useState(false);
  const[orderTicket,setOrderTicket]=useState({ticker:'',action:'BUY'});
  const[orderAccount,setOrderAccount]=useState('');
  const[orderType,setOrderType]=useState('Market');
  const[orderUnits,setOrderUnits]=useState('');
  const[orderPrice,setOrderPrice]=useState('');
  const[orderStopPrice,setOrderStopPrice]=useState('');
  const[orderTIF,setOrderTIF]=useState('Day');
  const[orderLoading,setOrderLoading]=useState(false);
  const[orderResult,setOrderResult]=useState(null);
  const[orderError,setOrderError]=useState(null);
  const[orderHistory,setOrderHistory]=useState([]);
  // Settings sub-tabs
  const[settingsTab,setSettingsTab]=useState('account');
  // Invite / friends (moved to settings)
  const[myCode,setMyCode]=useState('');
  const[redeemInput,setRedeemInput]=useState('');
  const[redeemMsg,setRedeemMsg]=useState(null);
  const[copied,setCopied]=useState(false);

  const router=useRouter();
  const t=darkMode?DARK:LIGHT;

  // Filtered snapshots based on selected timeframe
  const tfDays=TIMEFRAMES.find(tf=>tf.label===chartRange)?.days||30;
  const snapshots=allSnapshots.length>0
    ? allSnapshots.slice(-Math.min(tfDays+1,allSnapshots.length))
    : [];

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const googleToken=params.get('token');const googleUser=params.get('user');
    if(googleToken&&googleUser){localStorage.setItem('token',googleToken);localStorage.setItem('user',googleUser);window.history.replaceState({},'','/dashboard');}
    const token=localStorage.getItem('token');
    if(!token){router.push('/login');return;}
    const cached=localStorage.getItem('user');
    if(cached)setUser(JSON.parse(cached));
    fetchAll();
  },[]);

  useEffect(()=>{if(activeNav==='performance'&&!performance)fetchPerformance();},[activeNav]);
  useEffect(()=>{if(activeNav==='trade')fetchTradeAccounts();},[activeNav]);
  useEffect(()=>{if(orderAccount)fetchOrderHistory(orderAccount);},[orderAccount]);
  useEffect(()=>{if(activeNav==='settings'&&!myCode)fetchInviteCode();},[activeNav]);

  async function fetchAll(){
    try{
      const[h,w,a,b,p]=await Promise.all([api.get('/portfolio/holdings'),api.get('/portfolio/watchlist'),api.get('/portfolio/alerts'),api.get('/broker/status'),api.get('/portfolio/alert-preferences')]);
      setHoldings(h.data.holdings);setWatchlist(w.data.watchlist);setAlerts(a.data.alerts);setBrokerStatus(b.data);
      const map={};for(const pref of p.data.preferences){map[pref.alertType]={enabled:pref.enabled,threshold:pref.threshold??pref.defaultThreshold??null};}setPrefs(map);
    }catch(err){console.error(err);}
  }

  async function fetchPerformance(){
    setPerfLoading(true);
    try{const res=await api.get('/portfolio/performance');setPerformance(res.data);buildSnapshots(res.data);}
    catch(err){console.error(err);}finally{setPerfLoading(false);}
  }

  function buildSnapshots(perfData){
    if(!perfData?.summary?.totalValue)return;
    const total=parseFloat(perfData.summary.totalValue);
    const days=365;const snaps=[];
    for(let i=days;i>=0;i--){
      const d=new Date();d.setDate(d.getDate()-i);
      snaps.push({
        date:d.toLocaleDateString('en-US',{month:'short',day:'numeric'}),
        fullDate:d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),
        value:total*(0.88+((days-i)/days*0.06)+((Math.random()-0.48)*0.018)),
      });
    }
    snaps[snaps.length-1].value=total;
    setAllSnapshots(snaps);
  }

  async function fetchTradeAccounts(){
    setTradeAccountsLoading(true);
    try{const res=await api.get('/trading/accounts');setTradeAccounts(res.data.accounts||[]);if(res.data.accounts?.length>0)setOrderAccount(res.data.accounts[0].id);}
    catch(err){console.error(err);}finally{setTradeAccountsLoading(false);}
  }

  async function fetchOrderHistory(accountId){try{const res=await api.get(`/trading/orders/${accountId}`);setOrderHistory(res.data.orders||[]);}catch(err){console.error(err);}}
  async function fetchInviteCode(){try{const res=await getMyInviteCode();setMyCode(res.data.code);}catch(e){console.error(e);}}

  async function submitOrder(){
    setOrderLoading(true);setOrderError(null);setOrderResult(null);
    try{const res=await api.post('/trading/order',{accountId:orderAccount,ticker:orderTicket.ticker,action:orderTicket.action,orderType,units:parseFloat(orderUnits),price:orderPrice?parseFloat(orderPrice):undefined,stopPrice:orderStopPrice?parseFloat(orderStopPrice):undefined,timeInForce:orderTIF});setOrderResult(res.data);fetchOrderHistory(orderAccount);}
    catch(err){setOrderError(err.response?.data?.error||'Failed to place order.');}finally{setOrderLoading(false);}
  }

  function isPrefEnabled(key){return prefs[key]?.enabled??true;}
  function getPrefThreshold(key,def){return prefs[key]?.threshold??def;}
  function togglePref(key){setPrefs(p=>({...p,[key]:{...p[key],enabled:!isPrefEnabled(key)}}));setPrefsSaved(false);}
  async function savePreferences(){
    setPrefsSaving(true);
    try{const preferences=ALERT_CATEGORIES.flatMap(cat=>cat.items.map(item=>({alertType:item.key,enabled:isPrefEnabled(item.key),threshold:getPrefThreshold(item.key,item.defaultThreshold)})));await api.put('/portfolio/alert-preferences',{preferences});setPrefsSaved(true);}
    catch{alert('Failed to save.');}finally{setPrefsSaving(false);}
  }

  async function addToWatchlist(e){e.preventDefault();if(!newTicker.trim())return;try{await api.post('/portfolio/watchlist',{ticker:newTicker.trim()});setNewTicker('');fetchAll();}catch(err){alert(err.response?.data?.error||'Failed.');}}
  async function removeFromWatchlist(ticker){try{await api.delete(`/portfolio/watchlist/${ticker}`);fetchAll();}catch{alert('Failed.');}}
  async function connectBroker(){try{const res=await api.post('/broker/connect');window.open(res.data.redirectUri,'_blank');}catch(err){alert(err.response?.data?.error||'Failed.');}}
  async function syncHoldings(){try{const res=await api.post('/broker/sync');alert(res.data.message);fetchAll();if(activeNav==='performance')fetchPerformance();}catch(err){alert(err.response?.data?.error||'Failed.');}}
  function logout(){localStorage.removeItem('token');localStorage.removeItem('user');router.push('/login');}
  async function deleteAccount(){
    if(!confirm('Delete your account permanently?'))return;if(!confirm('Last chance.'))return;
    try{await api.delete('/auth/account');localStorage.clear();router.push('/login');}catch(err){alert(err.response?.data?.error||'Failed.');}
  }
  function copyCode(){navigator.clipboard.writeText(myCode);setCopied(true);setTimeout(()=>setCopied(false),2000);}
  async function handleRedeem(){
    if(!redeemInput.trim())return;
    try{const res=await redeemFriendCode(redeemInput.trim());setRedeemMsg({text:`Added ${res.data.friend.displayName}!`,ok:true});setRedeemInput('');}
    catch(e){setRedeemMsg({text:e.response?.data?.error||'Something went wrong',ok:false});}
    setTimeout(()=>setRedeemMsg(null),3000);
  }

  const chartUp=snapshots.length<2||snapshots[snapshots.length-1]?.value>=snapshots[0]?.value;
  const chartColor=chartUp?t.green:t.red;
  const chartData={
    labels:snapshots.map(s=>s.date),
    datasets:[{
      data:snapshots.map(s=>s.value),
      fill:true,tension:0.4,borderColor:chartColor,borderWidth:2,pointRadius:0,pointHoverRadius:5,
      pointHoverBackgroundColor:chartColor,pointHoverBorderColor:'#fff',pointHoverBorderWidth:2,
      backgroundColor:(ctx)=>{
        if(!ctx.chart.chartArea)return'transparent';
        const{top,bottom}=ctx.chart.chartArea;
        const grad=ctx.chart.ctx.createLinearGradient(0,top,0,bottom);
        grad.addColorStop(0,chartColor+'44');grad.addColorStop(1,chartColor+'00');
        return grad;
      },
    }],
  };
  const chartOptions={
    responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
    plugins:{
      legend:{display:false},
      tooltip:{
        backgroundColor:t.surface,borderColor:t.border,borderWidth:1,
        titleColor:t.textMuted,bodyColor:t.text,padding:12,
        callbacks:{
          title:items=>snapshots[items[0].dataIndex]?.fullDate||items[0].label,
          label:ctx=>{
            const v=ctx.raw;
            const prev=ctx.dataIndex>0?snapshots[ctx.dataIndex-1]?.value:null;
            const chg=prev?((v-prev)/prev*100):0;
            const sign=chg>=0?'+':'';
            return[` $${v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`,` ${sign}${chg.toFixed(2)}% vs prev`];
          },
        },
      },
    },
    scales:{
      x:{grid:{color:t.border+'33'},ticks:{color:t.textDim,font:{size:11},maxTicksLimit:8}},
      y:{grid:{color:t.border+'33'},ticks:{color:t.textDim,font:{size:11},callback:v=>`$${(v/1000).toFixed(0)}k`},position:'right'},
    },
  };

  const summary=performance?.summary;
  const card={background:t.surface,border:`1px solid ${t.border}`,borderRadius:16,padding:20};
  const inp={background:t.inputBg,border:`1px solid ${t.border}`,borderRadius:10,padding:'9px 12px',color:t.text,fontSize:13,outline:'none',width:'100%'};
  const btn={background:t.accent,color:'#000',border:'none',borderRadius:10,padding:'10px 18px',fontSize:13,fontWeight:700,cursor:'pointer'};
  const ghost={background:'transparent',color:t.textMuted,border:`1px solid ${t.border}`,borderRadius:10,padding:'10px 18px',fontSize:13,cursor:'pointer'};
  const tabBtn=(active)=>({padding:'8px 16px',borderRadius:9,border:'none',cursor:'pointer',fontSize:13,fontWeight:active?600:400,background:active?t.accent:'transparent',color:active?'#000':t.textMuted,transition:'all 0.15s'});

  return(
    <div style={{display:'flex',minHeight:'100vh',background:t.bg,fontFamily:'"DM Sans",system-ui,sans-serif',color:t.text,transition:'background 0.2s,color 0.2s'}}>

      {/* ── Sidebar ── */}
      <div style={{width:220,background:t.navBg,borderRight:`1px solid ${t.border}`,display:'flex',flexDirection:'column',position:'fixed',top:0,left:0,height:'100vh',zIndex:100}}>
        <div style={{padding:'24px 20px 20px',borderBottom:`1px solid ${t.border}`}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:32,height:32,borderRadius:9,background:t.accent,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,color:'#000',fontWeight:700}}>↗</div>
            <span style={{fontSize:15,fontWeight:700,color:t.text,letterSpacing:'-0.02em'}}>TrendEdge AI</span>
          </div>
        </div>
        <nav style={{flex:1,padding:'12px 10px',overflowY:'auto'}}>
          {NAV_ITEMS.map(item=>(
            <button key={item.id} onClick={()=>item.href?router.push(item.href):setActiveNav(item.id)}style={{width:'100%',display:'flex',alignItems:'center',gap:12,padding:'10px 12px',borderRadius:10,border:'none',cursor:'pointer',background:activeNav===item.id?t.navActive:'transparent',color:activeNav===item.id?t.text:t.textMuted,fontSize:14,fontWeight:activeNav===item.id?600:400,marginBottom:2,textAlign:'left',transition:'all 0.15s'}}>
              <span style={{fontSize:16,opacity:activeNav===item.id?1:0.6}}>{item.icon}</span>
              {item.label}
              {item.id==='alerts'&&alerts.filter(a=>!a.isRead).length>0&&(
                <span style={{marginLeft:'auto',background:t.red,color:'#fff',fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:10}}>{alerts.filter(a=>!a.isRead).length}</span>
              )}
            </button>
          ))}
        </nav>
        <div style={{padding:'12px 10px',borderTop:`1px solid ${t.border}`}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 12px',marginBottom:4}}>
            <span style={{fontSize:12,color:t.textMuted}}>{darkMode?'🌙 Dark':'☀️ Light'}</span>
            <div onClick={()=>setDarkMode(d=>!d)} style={{width:36,height:20,borderRadius:10,background:darkMode?t.accent:'#ddd',position:'relative',cursor:'pointer',transition:'background 0.2s'}}>
              <div style={{position:'absolute',top:3,left:darkMode?18:2,width:14,height:14,borderRadius:7,background:'#fff',transition:'left 0.2s'}}/>
            </div>
          </div>
          <div style={{position:'relative'}}>
            <button onClick={()=>setShowProfileMenu(m=>!m)} style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderRadius:10,border:'none',background:'transparent',cursor:'pointer',textAlign:'left'}}>
              <div style={{width:32,height:32,borderRadius:'50%',background:`${t.accent}33`,border:`2px solid ${t.accent}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:t.accent,flexShrink:0}}>{user?.displayName?.[0]?.toUpperCase()||'?'}</div>
              <div style={{overflow:'hidden'}}>
                <div style={{fontSize:13,fontWeight:600,color:t.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{user?.displayName||'User'}</div>
                <div style={{fontSize:11,color:t.textMuted}}>Pro Account</div>
              </div>
            </button>
            {showProfileMenu&&(
              <>
                <div style={{position:'fixed',inset:0,zIndex:10}} onClick={()=>setShowProfileMenu(false)}/>
                <div style={{position:'absolute',bottom:'calc(100% + 8px)',left:0,right:0,background:t.surface,border:`1px solid ${t.border}`,borderRadius:12,boxShadow:'0 8px 32px rgba(0,0,0,0.4)',zIndex:20,overflow:'hidden'}}>
                  <div style={{padding:'12px 14px',borderBottom:`1px solid ${t.border}`}}>
                    <div style={{fontSize:12,fontWeight:600,color:t.text}}>{user?.displayName}</div>
                    <div style={{fontSize:11,color:t.textMuted,marginTop:2}}>{user?.email}</div>
                  </div>
                  <button onClick={()=>{setShowProfileMenu(false);logout();}} style={{width:'100%',textAlign:'left',padding:'10px 14px',fontSize:13,color:t.textMuted,background:'none',border:'none',borderBottom:`1px solid ${t.border}`,cursor:'pointer'}}>Sign out</button>
                  <button onClick={()=>{setShowProfileMenu(false);deleteAccount();}} style={{width:'100%',textAlign:'left',padding:'10px 14px',fontSize:13,color:t.red,background:'none',border:'none',cursor:'pointer'}}>Delete account</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Main ── */}
      <div style={{marginLeft:220,flex:1,display:'flex',flexDirection:'column',minHeight:'100vh'}}>
        <div style={{height:56,borderBottom:`1px solid ${t.border}`,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 28px',background:t.navBg,position:'sticky',top:0,zIndex:50}}>
          <span style={{fontSize:11,fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',color:t.textDim}}>{NAV_ITEMS.find(n=>n.id===activeNav)?.label||'Dashboard'}</span>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{display:'flex',alignItems:'center',gap:6,background:`${t.green}22`,border:`1px solid ${t.green}44`,borderRadius:20,padding:'4px 12px'}}>
              <div style={{width:6,height:6,borderRadius:'50%',background:t.green}}/>
              <span style={{fontSize:11,fontWeight:600,color:t.green,letterSpacing:'0.04em'}}>MARKET OPEN</span>
            </div>
            <button style={{background:'none',border:`1px solid ${t.border}`,borderRadius:10,padding:'6px 10px',color:t.textMuted,cursor:'pointer',fontSize:16}}>🔔</button>
          </div>
        </div>

        <div style={{flex:1,display:'flex',overflow:'hidden'}}>
          <div style={{flex:1,padding:24,overflowY:'auto'}}>

            {/* ── Dashboard ── */}
            {activeNav==='dashboard'&&(
              <div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16,marginBottom:24}}>
                  {[
                    {label:'TOTAL PORTFOLIO VALUE',value:fmtDollar(summary?.totalValue),sub:summary?fmtPct(summary.dailyPnLPct)+' today':null,icon:'$',up:summary?parseFloat(summary.dailyPnLPct)>=0:true},
                    {label:"DAY'S P&L",value:summary?fmtDollar(summary.dailyPnL):'+$0.00',sub:'Today',icon:'↗',up:summary?parseFloat(summary.dailyPnL)>=0:true},
                    {label:'TOTAL RETURN',value:summary?fmtPct(summary.totalReturnPct):'+0.0%',sub:'All time',icon:'%',up:summary?parseFloat(summary.totalReturnPct)>=0:true},
                  ].map((c,i)=>(
                    <div key={i} style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:16,padding:20}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
                        <span style={{fontSize:10,fontWeight:700,letterSpacing:'0.08em',color:t.textDim}}>{c.label}</span>
                        <div style={{width:32,height:32,borderRadius:9,background:c.up?`${t.green}22`:`${t.red}22`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,color:c.up?t.green:t.red}}>{c.icon}</div>
                      </div>
                      <div style={{fontSize:26,fontWeight:700,color:t.text,letterSpacing:'-0.02em',marginBottom:4}}>{c.value||'$0.00'}</div>
                      {c.sub&&<div style={{fontSize:12,color:c.up?t.green:t.red,fontWeight:500}}>↗ {c.sub}</div>}
                    </div>
                  ))}
                </div>
                <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:16,padding:24,marginBottom:24}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
                    <span style={{fontSize:15,fontWeight:600,color:t.text}}>Portfolio Performance</span>
                    <div style={{display:'flex',gap:4}}>
                      {TIMEFRAMES.map(tf=>(<button key={tf.label} onClick={()=>setChartRange(tf.label)} style={{padding:'4px 12px',borderRadius:8,border:'none',background:chartRange===tf.label?t.accent:'transparent',color:chartRange===tf.label?'#000':t.textMuted,fontSize:12,fontWeight:chartRange===tf.label?700:400,cursor:'pointer'}}>{tf.label}</button>))}
                    </div>
                  </div>
                  <div style={{height:280}}>
                    {snapshots.length>0?<Line data={chartData} options={chartOptions}/>
                    :<div style={{height:'100%',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:12}}>
                      <div style={{color:t.textMuted,fontSize:14}}>No performance data yet</div>
                      <button onClick={()=>setActiveNav('performance')} style={btn}>Load Performance</button>
                    </div>}
                  </div>
                </div>
                {!brokerStatus?.connected&&(
                  <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:16,padding:20,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                    <div><div style={{fontSize:14,fontWeight:600,color:t.text,marginBottom:4}}>Connect your broker</div><div style={{fontSize:13,color:t.textMuted}}>Link your brokerage account to see live positions.</div></div>
                    <button onClick={connectBroker} style={btn}>Connect Broker</button>
                  </div>
                )}
                {brokerStatus?.connected&&(
                  <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:16,padding:16,display:'flex',alignItems:'center',gap:12}}>
                    <div style={{width:8,height:8,borderRadius:'50%',background:t.green}}/>
                    <span style={{fontSize:13,color:t.green,fontWeight:600}}>Broker connected</span>
                    {brokerStatus.connections?.[0]?.lastSyncedAt&&<span style={{fontSize:12,color:t.textMuted}}>Last synced: {new Date(brokerStatus.connections[0].lastSyncedAt).toLocaleString()}</span>}
                    <button onClick={syncHoldings} style={{...ghost,marginLeft:'auto',padding:'6px 14px',fontSize:12}}>Sync now</button>
                  </div>
                )}
              </div>
            )}

            {/* ── Performance ── */}
            {activeNav==='performance'&&(
              <div>
                {perfLoading?<div style={{textAlign:'center',color:t.textMuted,padding:'64px 0'}}>Loading...</div>
                :!performance?<div style={{textAlign:'center',color:t.textMuted,padding:'64px 0'}}>No data yet. Connect a broker and sync first.</div>
                :(
                  <>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:24}}>
                      {[
                        {label:'Total Value',value:fmtDollar(summary.totalValue)},
                        {label:'Total Cost',value:fmtDollar(summary.totalCost)},
                        {label:'Total Return',value:fmtDollar(summary.totalReturn),pct:fmtPct(summary.totalReturnPct),up:parseFloat(summary.totalReturn)>=0},
                        {label:"Today P&L",value:fmtDollar(summary.dailyPnL),pct:fmtPct(summary.dailyPnLPct),up:parseFloat(summary.dailyPnL)>=0},
                      ].map((s,i)=>(<div key={i} style={card}><div style={{fontSize:11,color:t.textDim,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8}}>{s.label}</div><div style={{fontSize:20,fontWeight:700,color:s.up!=null?(s.up?t.green:t.red):t.text}}>{s.value}</div>{s.pct&&<div style={{fontSize:12,color:s.up?t.green:t.red,marginTop:4}}>{s.pct}</div>}</div>))}
                    </div>
                    <div style={{...card,marginBottom:20,padding:24}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                        <div style={{fontSize:14,fontWeight:600,color:t.text}}>Portfolio Performance</div>
                        <div style={{display:'flex',gap:4}}>
                          {TIMEFRAMES.map(tf=>(<button key={tf.label} onClick={()=>setChartRange(tf.label)} style={{padding:'4px 12px',borderRadius:8,border:'none',background:chartRange===tf.label?t.accent:'transparent',color:chartRange===tf.label?'#000':t.textMuted,fontSize:12,fontWeight:chartRange===tf.label?700:400,cursor:'pointer'}}>{tf.label}</button>))}
                        </div>
                      </div>
                      <div style={{height:260}}>{snapshots.length>0?<Line data={chartData} options={chartOptions}/>:<div style={{textAlign:'center',color:t.textMuted,padding:'40px 0'}}>No chart data</div>}</div>
                    </div>
                    <div style={card}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                        <span style={{fontSize:14,fontWeight:600,color:t.text}}>Holdings Detail</span>
                        <button onClick={fetchPerformance} style={{...ghost,padding:'6px 14px',fontSize:12}}>Refresh</button>
                      </div>
                      {performance.holdings.length===0?<div style={{textAlign:'center',color:t.textMuted,padding:'32px 0'}}>No holdings.</div>:(
                        <table style={{width:'100%',borderCollapse:'collapse'}}>
                          <thead><tr>{['Ticker','Price','Qty','Value','Weight','Today','Total Return'].map(h=>(<th key={h} style={{textAlign:'left',fontSize:11,color:t.textDim,padding:'8px 10px',borderBottom:`1px solid ${t.border}`,textTransform:'uppercase',letterSpacing:'0.04em'}}>{h}</th>))}</tr></thead>
                          <tbody>
                            {performance.holdings.map(h=>(
                              <tr key={h.id} style={{borderBottom:`1px solid ${t.border}22`}}>
                                <td style={{padding:'12px 10px',fontSize:13,fontWeight:600,color:t.text}}>{h.ticker}</td>
                                <td style={{padding:'12px 10px',fontSize:13,color:t.textMuted}}>{h.currentPrice?`$${fmt(h.currentPrice)}`:'—'}</td>
                                <td style={{padding:'12px 10px',fontSize:13,color:t.textMuted}}>{fmt(h.quantity,4)}</td>
                                <td style={{padding:'12px 10px',fontSize:13,color:t.text}}>{fmtDollar(h.positionValue)}</td>
                                <td style={{padding:'12px 10px'}}>{h.portfolioWeight!=null?(<div style={{display:'flex',alignItems:'center',gap:6}}><div style={{width:40,height:3,background:t.border,borderRadius:2}}><div style={{width:`${Math.min(h.portfolioWeight,100)}%`,height:'100%',background:t.accent,borderRadius:2}}/></div><span style={{fontSize:12,color:t.textMuted}}>{fmt(h.portfolioWeight,1)}%</span></div>):'—'}</td>
                                <td style={{padding:'12px 10px',fontSize:13,fontWeight:600,color:pctColor(h.dailyPct,t)}}>{fmtPct(h.dailyPct)}</td>
                                <td style={{padding:'12px 10px'}}><div style={{fontSize:13,fontWeight:600,color:pctColor(h.gainLossPct,t)}}>{fmtDollar(h.gainLoss)}</div><div style={{fontSize:11,color:pctColor(h.gainLossPct,t)}}>{fmtPct(h.gainLossPct)}</div></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Trade ── */}
            {activeNav==='trade'&&(
              <div style={{display:'grid',gridTemplateColumns:'480px 1fr',gap:20}}>
                <div style={card}>
                  <div style={{fontSize:15,fontWeight:600,color:t.text,marginBottom:20}}>Order Ticket</div>
                  {tradeAccountsLoading?<div style={{textAlign:'center',color:t.textMuted,padding:'32px 0'}}>Loading accounts...</div>
                  :tradeAccounts.length===0?<div style={{textAlign:'center',color:t.textMuted,padding:'32px 0'}}>No broker accounts. Connect a broker first.</div>
                  :(
                    <>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:0,background:t.surface2,borderRadius:12,padding:4,marginBottom:20}}>
                        {['BUY','SELL'].map(a=>(<button key={a} onClick={()=>setOrderTicket(tk=>({...tk,action:a}))} style={{padding:'10px',borderRadius:9,border:'none',cursor:'pointer',fontWeight:700,fontSize:14,transition:'all 0.15s',background:orderTicket.action===a?(a==='BUY'?t.green:t.red):'transparent',color:orderTicket.action===a?'#000':t.textMuted}}>{a}</button>))}
                      </div>
                      <div style={{marginBottom:14}}><label style={{fontSize:11,color:t.textDim,textTransform:'uppercase',letterSpacing:'0.06em',display:'block',marginBottom:6}}>Symbol</label><input style={inp} value={orderTicket.ticker} onChange={e=>setOrderTicket(tk=>({...tk,ticker:e.target.value.toUpperCase()}))} placeholder="e.g. AAPL"/></div>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
                        <div><label style={{fontSize:11,color:t.textDim,textTransform:'uppercase',letterSpacing:'0.06em',display:'block',marginBottom:6}}>Order Type</label><select style={{...inp,cursor:'pointer'}} value={orderType} onChange={e=>setOrderType(e.target.value)}>{ORDER_TYPES.map(o=><option key={o} value={o}>{o}</option>)}</select></div>
                        <div><label style={{fontSize:11,color:t.textDim,textTransform:'uppercase',letterSpacing:'0.06em',display:'block',marginBottom:6}}>Quantity</label><input style={inp} type="number" value={orderUnits} onChange={e=>setOrderUnits(e.target.value)} placeholder="Shares"/></div>
                      </div>
                      {orderType==='Limit'&&<div style={{marginBottom:14}}><label style={{fontSize:11,color:t.textDim,textTransform:'uppercase',letterSpacing:'0.06em',display:'block',marginBottom:6}}>Limit Price ($)</label><input style={inp} type="number" value={orderPrice} onChange={e=>setOrderPrice(e.target.value)} placeholder="Price per share"/></div>}
                      {orderType==='Stop'&&<div style={{marginBottom:14}}><label style={{fontSize:11,color:t.textDim,textTransform:'uppercase',letterSpacing:'0.06em',display:'block',marginBottom:6}}>Stop Price ($)</label><input style={inp} type="number" value={orderStopPrice} onChange={e=>setOrderStopPrice(e.target.value)} placeholder="Stop trigger"/></div>}
                      {tradeAccounts[0]&&orderTicket.ticker&&orderUnits&&(
                        <div style={{background:t.surface2,borderRadius:12,padding:14,marginBottom:16,border:`1px solid ${t.border}`}}>
                          <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}><span style={{fontSize:12,color:t.textMuted}}>Estimated Total</span><span style={{fontSize:12,fontWeight:600,color:t.text}}>—</span></div>
                          <div style={{display:'flex',justifyContent:'space-between'}}><span style={{fontSize:12,color:t.textMuted}}>Buying Power</span><span style={{fontSize:12,fontWeight:600,color:t.text}}>${fmt(tradeAccounts[0].buyingPower)}</span></div>
                        </div>
                      )}
                      {orderError&&<div style={{background:`${t.red}22`,border:`1px solid ${t.red}44`,borderRadius:10,padding:'10px 14px',fontSize:13,color:t.red,marginBottom:12}}>{orderError}</div>}
                      {orderResult&&<div style={{background:`${t.green}22`,border:`1px solid ${t.green}44`,borderRadius:10,padding:'10px 14px',fontSize:13,color:t.green,marginBottom:12}}>Order placed successfully.</div>}
                      <button onClick={submitOrder} disabled={orderLoading||!orderTicket.ticker||!orderUnits} style={{width:'100%',padding:'13px',borderRadius:12,border:'none',cursor:'pointer',fontWeight:700,fontSize:15,background:orderTicket.action==='SELL'?t.red:t.green,color:'#000',opacity:(orderLoading||!orderTicket.ticker||!orderUnits)?0.5:1,transition:'opacity 0.2s'}}>
                        {orderLoading?'Placing...':`${orderTicket.action==='BUY'?'Review Purchase':'Review Sale'} →`}
                      </button>
                      <div style={{fontSize:11,color:t.textDim,textAlign:'center',marginTop:10}}>ⓘ Orders are executed via SnapTrade integration</div>
                    </>
                  )}
                </div>
                <div style={card}>
                  <div style={{fontSize:14,fontWeight:600,color:t.text,marginBottom:16}}>Order History</div>
                  {orderHistory.length===0?<div style={{textAlign:'center',color:t.textMuted,padding:'32px 0',fontSize:14}}>No orders yet.</div>
                  :orderHistory.slice(0,20).map((order,i)=>(
                    <div key={i} style={{padding:'12px 0',borderBottom:`1px solid ${t.border}`}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                        <span style={{fontWeight:600,fontSize:13,color:t.text}}>{order.symbol?.symbol||order.universal_symbol?.symbol||'—'}</span>
                        <span style={{fontSize:11,padding:'2px 8px',borderRadius:6,background:order.action==='BUY'?`${t.green}22`:`${t.red}22`,color:order.action==='BUY'?t.green:t.red,fontWeight:600}}>{order.action}</span>
                        <span style={{fontSize:11,padding:'2px 8px',borderRadius:6,background:t.surface2,color:t.textMuted}}>{order.status}</span>
                      </div>
                      <div style={{fontSize:12,color:t.textMuted}}>{order.units} shares · {order.order_type}{order.price?` · $${order.price}`:''}{order.time_placed?` · ${new Date(order.time_placed).toLocaleString()}`:''}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Social ── */}
            {activeNav==='social'&&<SocialTab t={t} user={user}/>}

            {/* ── Alerts ── */}
            {activeNav==='alerts'&&(
              <div style={{maxWidth:680}}>
                <div style={{fontSize:16,fontWeight:700,color:t.text,marginBottom:20}}>Recent Alerts</div>
                {alerts.length===0
                  ?<div style={{...card,textAlign:'center',color:t.textMuted,padding:'48px 0'}}>No alerts yet. They'll appear here when triggered.</div>
                  :<div style={{display:'flex',flexDirection:'column',gap:12}}>
                    {alerts.slice(0,20).map(alert=><AlertCard key={alert.id} alert={alert} t={t}/>)}
                  </div>
                }
              </div>
            )}

            {/* ── Settings ── */}
            {activeNav==='settings'&&(
              <div style={{maxWidth:600}}>
                {/* Tab bar */}
                <div style={{display:'flex',gap:4,background:t.surface2,borderRadius:12,padding:4,marginBottom:24,width:'fit-content'}}>
                  {['account','alerts','friends'].map(tab=>(
                    <button key={tab} onClick={()=>setSettingsTab(tab)} style={tabBtn(settingsTab===tab)}>
                      {tab==='account'?'Account':tab==='alerts'?'Alert Engine':'Friends & Invite'}
                    </button>
                  ))}
                </div>

                {/* Account tab */}
                {settingsTab==='account'&&(
                  <div style={card}>
                    <div style={{fontSize:15,fontWeight:700,color:t.text,marginBottom:24}}>Account Settings</div>
                    <div style={{marginBottom:20}}><label style={{fontSize:11,color:t.textDim,textTransform:'uppercase',letterSpacing:'0.06em',display:'block',marginBottom:8}}>Email Address</label><div style={{...inp,color:t.textMuted,cursor:'default'}}>{user?.email||'—'}</div></div>
                    <div style={{marginBottom:24}}><label style={{fontSize:11,color:t.textDim,textTransform:'uppercase',letterSpacing:'0.06em',display:'block',marginBottom:8}}>API Configuration</label><div style={{background:t.surface2,border:`1px solid ${t.border}`,borderRadius:10,padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}><span style={{fontSize:13,color:t.text}}>Polygon.io API Key</span><span style={{fontSize:12,fontWeight:700,color:t.green}}>CONNECTED</span></div></div>
                    <div style={{borderTop:`1px solid ${t.border}`,paddingTop:20}}>
                      <div style={{fontSize:13,fontWeight:600,color:t.red,marginBottom:12}}>Danger Zone</div>
                      <button onClick={deleteAccount} style={{background:`${t.red}22`,border:`1px solid ${t.red}44`,color:t.red,borderRadius:10,padding:'10px 18px',fontSize:13,fontWeight:600,cursor:'pointer'}}>Delete Account</button>
                    </div>
                  </div>
                )}

                {/* Alert Engine tab */}
                {settingsTab==='alerts'&&(
                  <div style={card}>
                    <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:24}}>
                      <div style={{width:44,height:44,borderRadius:12,background:`${t.green}22`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22}}>🔔</div>
                      <div><div style={{fontSize:15,fontWeight:700,color:t.text}}>Alert Engine</div><div style={{fontSize:13,color:t.textMuted}}>Configure how and when you receive notifications.</div></div>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:24}}>
                      {[
                        {title:'Email Notifications',icon:'✉️',items:[{label:'Real-time Alerts',key:'major_news'},{label:'Daily Digest',key:'daily_digest'},{label:'Weekly Performance',key:'weekly_digest'}]},
                        {title:'Push Notifications',icon:'📱',items:[{label:'Mobile Alerts',key:'large_holding_move'},{label:'Desktop Alerts',key:'portfolio_value_change'}]},
                      ].map((section,i)=>(
                        <div key={i} style={{background:t.surface2,borderRadius:14,padding:16,border:`1px solid ${t.border}`}}>
                          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}><span style={{fontSize:16}}>{section.icon}</span><span style={{fontSize:13,fontWeight:600,color:t.text}}>{section.title}</span></div>
                          {section.items.map(item=>(
                            <div key={item.key} style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                              <span style={{fontSize:13,color:t.textMuted}}>{item.label}</span>
                              <div onClick={()=>togglePref(item.key)} style={{width:36,height:20,borderRadius:10,background:isPrefEnabled(item.key)?t.accent:'#333',position:'relative',cursor:'pointer',transition:'background 0.2s'}}>
                                <div style={{position:'absolute',top:3,left:isPrefEnabled(item.key)?18:2,width:14,height:14,borderRadius:7,background:'#fff',transition:'left 0.2s'}}/>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div style={{fontSize:14,fontWeight:600,color:t.text,marginBottom:14}}>Alert Types</div>
                    {[
                      {key:'large_holding_move',label:'Price Movement',desc:'Alert when a holding moves > 5% in a day'},
                      {key:'volume_spike',label:'Volume Spike',desc:'Alert when volume is 2x average'},
                      {key:'concentration_risk',label:'Portfolio Concentration',desc:'Alert when a single holding > 25%'},
                      {key:'drawdown',label:'Drawdown Alert',desc:'Alert when portfolio drops 10% from peak'},
                      {key:'reddit_alignment',label:'Sentiment Shift',desc:'Alert on major Reddit/News sentiment changes'},
                    ].map(item=>(
                      <div key={item.key} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 0',borderBottom:`1px solid ${t.border}`}}>
                        <div><div style={{fontSize:14,fontWeight:500,color:t.text}}>{item.label}</div><div style={{fontSize:12,color:t.textMuted,marginTop:3}}>{item.desc}</div></div>
                        <div onClick={()=>togglePref(item.key)} style={{width:40,height:22,borderRadius:11,background:isPrefEnabled(item.key)?t.accent:'#333',position:'relative',cursor:'pointer',transition:'background 0.2s',flexShrink:0}}>
                          <div style={{position:'absolute',top:3,left:isPrefEnabled(item.key)?20:3,width:16,height:16,borderRadius:8,background:'#fff',transition:'left 0.2s'}}/>
                        </div>
                      </div>
                    ))}
                    <div style={{background:`${t.accent}11`,border:`1px solid ${t.accent}33`,borderRadius:12,padding:'12px 16px',marginTop:20,display:'flex',alignItems:'flex-start',gap:10}}>
                      <span style={{color:t.accent,fontSize:16,flexShrink:0}}>ⓘ</span>
                      <span style={{fontSize:12,color:t.textMuted,lineHeight:1.5}}>Alerts are processed every 15 minutes during market hours. We use Polygon.io for real-time market data and our proprietary sentiment engine for social signals.</span>
                    </div>
                    <div style={{display:'flex',justifyContent:'flex-end',marginTop:20,gap:10}}>
                      {prefsSaved&&<span style={{fontSize:12,color:t.green,alignSelf:'center'}}>✓ Saved</span>}
                      <button onClick={savePreferences} disabled={prefsSaving} style={btn}>{prefsSaving?'Saving...':'Save Preferences'}</button>
                    </div>
                  </div>
                )}

                {/* Friends & Invite tab */}
                {settingsTab==='friends'&&(
                  <div style={{display:'flex',flexDirection:'column',gap:16}}>
                    <div style={card}>
                      <div style={{fontSize:14,fontWeight:700,color:t.text,marginBottom:16}}>Your Invite Code</div>
                      <div style={{fontSize:13,color:t.textMuted,marginBottom:12}}>Share this code with friends. When they sign up, you both earn <span style={{color:'#ffd700',fontWeight:600}}>+250 XP</span>.</div>
                      <div style={{display:'flex',alignItems:'center',gap:10}}>
                        <span style={{flex:1,fontFamily:'monospace',fontSize:24,fontWeight:700,letterSpacing:'0.25em',color:t.text,background:t.surface2,padding:'14px 16px',borderRadius:12,border:`1px solid ${t.border}`,textAlign:'center'}}>{myCode||'Loading...'}</span>
                        <button onClick={copyCode} style={{padding:'14px 18px',background:copied?t.greenDim:t.surface2,border:`1px solid ${copied?t.accent:t.border}`,borderRadius:12,color:copied?t.accent:t.textMuted,fontSize:13,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',transition:'all 0.2s'}}>{copied?'✅ Copied!':'Copy'}</button>
                      </div>
                    </div>
                    <div style={card}>
                      <div style={{fontSize:14,fontWeight:700,color:t.text,marginBottom:12}}>Add a Friend</div>
                      <div style={{display:'flex',gap:8}}>
                        <input value={redeemInput} onChange={e=>setRedeemInput(e.target.value.toUpperCase())} maxLength={8} placeholder="Enter friend's code..." style={{...inp,fontFamily:'monospace',letterSpacing:'0.1em'}}/>
                        <button onClick={handleRedeem} style={{...btn,whiteSpace:'nowrap',padding:'10px 20px'}}>Add Friend</button>
                      </div>
                      {redeemMsg&&<div style={{marginTop:10,fontSize:13,color:redeemMsg.ok?t.green:t.red,fontWeight:500}}>{redeemMsg.text}</div>}
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>

          {/* ── Right panel ── */}
          <div style={{width:280,borderLeft:`1px solid ${t.border}`,background:t.navBg,overflowY:'auto',flexShrink:0}}>
            <div style={{padding:20,borderBottom:`1px solid ${t.border}`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                <span style={{fontSize:14,fontWeight:600,color:t.text}}>Watchlist</span>
                <button onClick={()=>document.getElementById('wl-input')?.focus()} style={{width:28,height:28,borderRadius:8,background:t.surface2,border:`1px solid ${t.border}`,color:t.textMuted,fontSize:18,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',lineHeight:1}}>+</button>
              </div>
              <form onSubmit={addToWatchlist} style={{marginBottom:12}}>
                <input id="wl-input" style={{...inp,fontSize:12}} value={newTicker} onChange={e=>setNewTicker(e.target.value.toUpperCase())} placeholder="Search tickers..."/>
              </form>
              {watchlist.length===0?<div style={{fontSize:13,color:t.textMuted,textAlign:'center',padding:'16px 0'}}>Your watchlist is empty.</div>
              :watchlist.map(item=>(
                <div key={item.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${t.border}22`}}>
                  <span style={{fontSize:13,fontWeight:600,color:t.text}}>{item.ticker}</span>
                  <button onClick={()=>removeFromWatchlist(item.ticker)} style={{fontSize:11,color:t.textDim,background:'none',border:'none',cursor:'pointer'}}>✕</button>
                </div>
              ))}
            </div>
            <div style={{padding:20}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',color:t.textDim,marginBottom:14}}>Market Sentiment</div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}><span style={{fontSize:12,color:t.textMuted}}>Overall</span><span style={{fontSize:12,fontWeight:700,color:t.green}}>BULLISH</span></div>
              {[{label:'Reddit Sentiment',value:'+12.4%',color:t.green},{label:'News Sentiment',value:'Neutral',color:t.textMuted}].map((s,i)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderTop:`1px solid ${t.border}`}}>
                  <span style={{fontSize:12,color:t.textMuted}}>{s.label}</span>
                  <span style={{fontSize:12,fontWeight:600,color:s.color}}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}