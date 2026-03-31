'use client';
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import api from '../../lib/api';

export default function LoginPage() {
  const [step, setStep]         = useState('login'); // 'login' | '2fa'
  const [userId, setUserId]     = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode]         = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [resent, setResent]     = useState(false);

  const router       = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    const user  = searchParams.get('user');
    if (token && user) {
      localStorage.setItem('token', token);
      localStorage.setItem('user', user);
      router.push('/dashboard');
    }
    const err = searchParams.get('error');
    if (err === 'google') setError('Google sign-in failed. Please try again.');

    const uid   = searchParams.get('userId');
    const isNew = searchParams.get('newAccount');
    if (uid && isNew) {
      setUserId(uid);
      setStep('2fa');
    }
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      if (res.data.requires2FA) {
        setUserId(res.data.userId);
        setStep('2fa');
      } else {
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        router.push('/dashboard');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed.');
    } finally { setLoading(false); }
  }

  async function handleVerify(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await api.post('/auth/verify-2fa', { userId, code });
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      router.push('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Verification failed.');
    } finally { setLoading(false); }
  }

  async function handleResend() {
    try {
      await api.post('/auth/resend-2fa', { userId });
      setResent(true);
      setTimeout(() => setResent(false), 5000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to resend code.');
    }
  }

  function handleGoogleLogin() {
    window.location.href = 'http://localhost:4000/api/auth/google';
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.brand}>TrendEdge AI</div>

        {step === 'login' && (
          <>
            <h1 style={s.title}>Sign in</h1>

            {/* Google button */}
            <button style={s.googleBtn} onClick={handleGoogleLogin}>
              <svg width="18" height="18" viewBox="0 0 18 18" style={{marginRight:8,flexShrink:0}}>
                <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
                <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
                <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/>
                <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/>
              </svg>
              Continue with Google
            </button>

            {/* Divider */}
            <div style={s.divider}>
              <div style={{flex:1,height:1,background:'#eee'}}/>
              <span style={s.dividerText}>or sign in with email</span>
              <div style={{flex:1,height:1,background:'#eee'}}/>
            </div>

            {/* Email/password form */}
            <form onSubmit={handleLogin} style={{display:'flex',flexDirection:'column',gap:12}}>
              <div>
                <label style={s.label}>Email</label>
                <input
                  style={s.input}
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div>
                <label style={s.label}>Password</label>
                <input
                  style={s.input}
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
              {error && <div style={s.error}>{error}</div>}
              <button style={s.btn} type="submit" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </form>

            <p style={s.footer}>
              Don't have an account?{' '}
              <a href="/register" style={s.link}>Create one</a>
            </p>
          </>
        )}

        {step === '2fa' && (
          <>
            <div style={{fontSize:32,marginBottom:8,textAlign:'center'}}>📱</div>
            <h1 style={s.title}>Check your phone</h1>
            <p style={{fontSize:13,color:'#888',textAlign:'center',marginBottom:24}}>
              We sent a 6-digit code to your email address. Enter it below to continue.
            </p>

            <form onSubmit={handleVerify} style={{display:'flex',flexDirection:'column',gap:12}}>
              <input
                style={{...s.input,textAlign:'center',fontSize:24,letterSpacing:'0.3em',fontWeight:600}}
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                required
                autoFocus
              />
              {error  && <div style={s.error}>{error}</div>}
              {resent && <div style={s.success}>✅ New code sent!</div>}
              <button style={s.btn} type="submit" disabled={loading || code.length !== 6}>
                {loading ? 'Verifying...' : 'Verify'}
              </button>
            </form>

            <div style={{display:'flex',justifyContent:'space-between',marginTop:16}}>
              <button style={s.ghostBtn} onClick={() => { setStep('login'); setCode(''); setError(''); }}>
                ← Back
              </button>
              <button style={s.ghostBtn} onClick={handleResend}>
                Resend code
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const s = {
  page:        { minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f9f9f8', fontFamily:'system-ui, sans-serif' },
  card:        { background:'#fff', border:'1px solid #e5e5e3', borderRadius:14, padding:'40px 36px', width:'100%', maxWidth:400 },
  brand:       { fontSize:13, fontWeight:600, color:'#888', textAlign:'center', marginBottom:24, letterSpacing:'0.05em', textTransform:'uppercase' },
  title:       { fontSize:22, fontWeight:600, margin:'0 0 24px', textAlign:'center' },
  label:       { display:'block', fontSize:12, color:'#888', marginBottom:6, fontWeight:500 },
  input:       { width:'100%', padding:'10px 12px', border:'1px solid #ddd', borderRadius:8, fontSize:14, outline:'none', boxSizing:'border-box' },
  btn:         { background:'#1a1a18', color:'#fff', border:'none', borderRadius:8, padding:'11px', fontSize:14, fontWeight:500, cursor:'pointer', width:'100%' },
  ghostBtn:    { background:'none', border:'none', color:'#888', fontSize:13, cursor:'pointer', padding:'4px 0' },
  googleBtn:   { width:'100%', display:'flex', alignItems:'center', justifyContent:'center', padding:'10px', border:'1px solid #ddd', borderRadius:8, background:'#fff', fontSize:14, fontWeight:500, cursor:'pointer', marginBottom:4 },
  divider:     { display:'flex', alignItems:'center', gap:12, margin:'16px 0' },
  dividerText: { fontSize:12, color:'#aaa', whiteSpace:'nowrap' },
  error:       { background:'#fce4ec', color:'#c0392b', borderRadius:7, padding:'10px 14px', fontSize:13 },
  success:     { background:'#e8f5e9', color:'#2a7a4b', borderRadius:7, padding:'10px 14px', fontSize:13 },
  footer:      { fontSize:13, color:'#888', textAlign:'center', marginTop:20 },
  link:        { color:'#1a1a18', fontWeight:500 },
};