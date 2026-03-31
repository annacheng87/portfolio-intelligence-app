'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '../../lib/api';

export default function RegisterPage() {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [confirm, setConfirm]         = useState('');
  const [error, setError]             = useState('');
  const [loading, setLoading]         = useState(false);
  const router = useRouter();

  async function handleRegister(e) {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 8)  { setError('Password must be at least 8 characters.'); return; }
    setLoading(true);
    try {
      const res = await api.post('/auth/register', { displayName, email, password });
      router.push(`/login?userId=${res.data.userId}&newAccount=1`);
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed.');
    } finally { setLoading(false); }
  }

  function handleGoogleLogin() {
    window.location.href = 'http://localhost:4000/api/auth/google';
  }

  return (
    <div style={s.page}>
      <div style={s.grid}/>
      <div style={s.card}>
        <div style={s.logoRow}>
          <div style={s.logoIcon}>↗</div>
          <span style={s.logoText}>TrendEdge AI</span>
        </div>

        <h1 style={s.title}>Create your account</h1>
        <p style={s.subtitle}>Join thousands of traders using AI-powered portfolio intelligence</p>

        <button style={s.googleBtn} onClick={handleGoogleLogin}>
          <svg width="18" height="18" viewBox="0 0 18 18" style={{marginRight:10,flexShrink:0}}>
            <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
            <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
            <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/>
            <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/>
          </svg>
          Continue with Google
        </button>

        <div style={s.divider}>
          <div style={{flex:1,height:1,background:'#2a2a2a'}}/>
          <span style={s.dividerText}>or register with email</span>
          <div style={{flex:1,height:1,background:'#2a2a2a'}}/>
        </div>

        <form onSubmit={handleRegister} style={{display:'flex',flexDirection:'column',gap:14}}>
          <div>
            <label style={s.label}>Display name</label>
            <input style={s.input} type="text" value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="e.g. Alex Chen" required/>
          </div>
          <div>
            <label style={s.label}>Email address</label>
            <input style={s.input} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" required/>
          </div>
          <div>
            <label style={s.label}>Password</label>
            <input style={s.input} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Min. 8 characters" required/>
          </div>
          <div>
            <label style={s.label}>Confirm password</label>
            <input style={s.input} type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="••••••••" required/>
          </div>
          {error && <div style={s.error}>{error}</div>}
          <button style={s.btn} type="submit" disabled={loading}>
            {loading ? 'Creating account...' : 'Create account →'}
          </button>
        </form>

        <p style={s.footer}>
          Already have an account?{' '}
          <a href="/login" style={s.link}>Sign in</a>
        </p>

        <div style={s.securityBadge}>SECURE PROFESSIONAL TRADING ENVIRONMENT</div>
      </div>
    </div>
  );
}

const s = {
  page: { minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#0a0a0a',fontFamily:'"DM Sans",system-ui,sans-serif',position:'relative',overflow:'hidden' },
  grid: { position:'fixed',inset:0,backgroundImage:`linear-gradient(rgba(0,200,83,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,200,83,0.03) 1px,transparent 1px)`,backgroundSize:'40px 40px',pointerEvents:'none' },
  card: { position:'relative',background:'#111111',border:'1px solid #2a2a2a',borderRadius:20,padding:'40px 36px',width:'100%',maxWidth:420,boxShadow:'0 24px 80px rgba(0,0,0,0.6)' },
  logoRow: { display:'flex',alignItems:'center',justifyContent:'center',gap:10,marginBottom:28 },
  logoIcon: { width:36,height:36,borderRadius:10,background:'#00c853',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,color:'#000',fontWeight:700 },
  logoText: { fontSize:17,fontWeight:700,color:'#ffffff',letterSpacing:'-0.02em' },
  title: { fontSize:22,fontWeight:700,color:'#ffffff',textAlign:'center',margin:'0 0 8px',letterSpacing:'-0.02em' },
  subtitle: { fontSize:13,color:'#666',textAlign:'center',margin:'0 0 28px',lineHeight:1.5 },
  label: { display:'block',fontSize:11,fontWeight:600,color:'#555',marginBottom:7,textTransform:'uppercase',letterSpacing:'0.06em' },
  input: { width:'100%',padding:'11px 14px',background:'#1a1a1a',border:'1px solid #2a2a2a',borderRadius:10,fontSize:14,color:'#ffffff',outline:'none',boxSizing:'border-box',transition:'border-color 0.15s' },
  btn: { background:'#00c853',color:'#000',border:'none',borderRadius:10,padding:'13px',fontSize:14,fontWeight:700,cursor:'pointer',width:'100%',letterSpacing:'0.01em',transition:'opacity 0.2s' },
  googleBtn: { width:'100%',display:'flex',alignItems:'center',justifyContent:'center',padding:'12px',background:'#ffffff',border:'1px solid #ffffff',borderRadius:10,fontSize:14,fontWeight:600,cursor:'pointer',color:'#000',marginBottom:8,transition:'opacity 0.2s' },
  divider: { display:'flex',alignItems:'center',gap:12,margin:'20px 0' },
  dividerText: { fontSize:11,color:'#444',whiteSpace:'nowrap',textTransform:'uppercase',letterSpacing:'0.06em' },
  error: { background:'rgba(255,59,59,0.12)',border:'1px solid rgba(255,59,59,0.3)',color:'#ff3b3b',borderRadius:8,padding:'10px 14px',fontSize:13 },
  footer: { fontSize:13,color:'#555',textAlign:'center',marginTop:20 },
  link: { color:'#00c853',fontWeight:600,textDecoration:'none' },
  securityBadge: { fontSize:10,fontWeight:700,color:'#333',textAlign:'center',letterSpacing:'0.1em',marginTop:24,textTransform:'uppercase' },
};