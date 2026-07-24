'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) setReady(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(`No se pudo actualizar la contraseña: ${updateError.message}`);
        setLoading(false);
        return;
      }
      setDone(true);
      setTimeout(() => router.push('/admin/login'), 2500);
    } catch (err) {
      setError(`Error de conexión: ${err.message}`);
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: '80px auto 0', padding: '0 16px' }}>
      <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 20, marginBottom: 16 }}>Nueva contraseña</h1>

      {!ready && !done && (
        <p style={{ color: '#5B6B60', fontSize: 13 }}>
          Verificando el enlace de recuperación… Si llegaste aquí directamente (no desde el correo),
          este enlace no es válido.
        </p>
      )}

      {done && (
        <div style={{ background: '#E4F0EA', border: '1px solid #bfe0cf', color: '#084F39', padding: 12, borderRadius: 8, fontSize: 13 }}>
          Contraseña actualizada. Te llevaremos a la pantalla de inicio de sesión…
        </div>
      )}

      {ready && !done && (
        <form onSubmit={handleSubmit}>
          {error && (
            <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
              {error}
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: '#5B6B60', display: 'block', marginBottom: 4 }}>Nueva contraseña</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%', padding: 10, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: '#5B6B60', display: 'block', marginBottom: 4 }}>Confirma la contraseña</label>
            <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)}
              style={{ width: '100%', padding: 10, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
          </div>
          <button type="submit" disabled={loading}
            style={{ width: '100%', padding: 12, background: '#0B6E4F', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Guardando…' : 'Guardar nueva contraseña'}
          </button>
        </form>
      )}
    </main>
  );
}
