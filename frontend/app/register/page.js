'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import api from '../../lib/api';

export default function RegisterPage() {
  const [form, setForm] = useState({ email: '', password: '', displayName: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/register', form);
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      router.push('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.title}>Create your account</h1>
        <p style={s.subtitle}>Start tracking your portfolio</p>
        {error && <div style={s.error}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={s.label}>Display name</label>
          <input style={s.input} value={form.displayName}
            onChange={e => setForm({...form, displayName: e.target.value})}
            placeholder="e.g. Alex" required />
          <label style={s.label}>Email</label>
          <input style={s.input} type="email" value={form.email}
            onChange={e => setForm({...form, email: e.target.value})}
            placeholder="you@example.com" required />
          <label style={s.label}>Password</label>
          <input style={s.input} type="password" value={form.password}
            onChange={e => setForm({...form, password: e.target.value})}
            placeholder="At least 8 characters" required />
          <button style={s.button} type="submit" disabled={loading}>
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>
        <p style={s.footerText}>
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

const s = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9f9f8', fontFamily: 'system-ui, sans-serif' },
  card: { background: '#fff', border: '1px solid #e5e5e3', borderRadius: 12, padding: '40px 36px', width: '100%', maxWidth: 400 },
  title: { margin: '0 0 4px', fontSize: 22, fontWeight: 500 },
  subtitle: { margin: '0 0 28px', fontSize: 14, color: '#888' },
  label: { display: 'block', fontSize: 13, fontWeight: 500, color: '#444', marginBottom: 6 },
  input: { display: 'block', width: '100%', padding: '10px 12px', marginBottom: 18, border: '1px solid #ddd', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', outline: 'none' },
  button: { width: '100%', padding: 11, background: '#1a1a18', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer' },
  error: { background: '#fff0f0', border: '1px solid #fcc', color: '#c00', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 18 },
  footerText: { textAlign: 'center', fontSize: 13, color: '#888', marginTop: 20 },
};