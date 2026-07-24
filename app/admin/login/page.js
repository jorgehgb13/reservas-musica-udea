'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';

export default function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const router = useRouter();

  async function handleLogin(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(
          signInError.message === 'Invalid login credentials'
            ? 'Correo o contraseña incorrectos.'
            : `No se pudo iniciar sesión: ${signInError.message}`
        );
        setLoading(false);
        return;
      }
      router.push('/admin');
    } catch (err) {
      setError(`Error de conexión: ${err.message}`);
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    if (!email) {
      setError('Escribe tu correo arriba primero, y luego haz clic en "Olvidé mi contraseña".');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/admin/reset-password`,
      });
      if (resetError) {
        setError(`No se pudo enviar el correo de recuperación: ${resetError.message}`);
      } else {
        setResetSent(true);
      }
    } catch (err) {
      setError(`Error de conexión: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: '80px auto 0', padding: '0 16px' }}>
      <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 20, marginBottom: 4 }}>
        Panel de administrador
      </h1>
      <p style={{ color: '#5B6B60', fontSize: 13, marginBottom: 20 }}>Depto. de Música — UdeA</p>

      {error && (
        <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}
      {resetSent && (
        <div style={{ background: '#E4F0EA', border: '1px solid #bfe0cf', color: '#084F39', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
          Te enviamos un correo a <strong>{email}</strong> con instrucciones para restablecer tu contraseña.
        </div>
      )}

      <form onSubmit={handleLogin}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#5B6B60', display: 'block', marginBottom: 4 }}>Correo</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%', padding: 10, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: '#5B6B60', display: 'block', marginBottom: 4 }}>Contraseña</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: '100%', padding: 10, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          style={{ width: '100%', padding: 12, background: '#0B6E4F', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1 }}
        >
          {loading ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>

      <button
        onClick={handleForgotPassword}
        disabled={loading}
        style={{ width: '100%', marginTop: 10, padding: 8, background: 'transparent', border: 'none', color: '#5B6B60', fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline' }}
      >
        Olvidé mi contraseña
      </button>
    </main>
  );
}
