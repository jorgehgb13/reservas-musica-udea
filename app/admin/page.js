'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

export default function AdminHome() {
  const [session, setSession] = useState(undefined);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === null) router.push('/admin/login');
  }, [session, router]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/admin/login');
  }

  if (session === undefined) {
    return <main style={{ padding: 40, textAlign: 'center', color: '#5B6B60' }}>Cargando…</main>;
  }
  if (!session) {
    return null;
  }

  return (
    <main style={{ maxWidth: 480, margin: '60px auto 0', padding: '0 16px' }}>
      <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 22, marginBottom: 6 }}>Panel de administrador</h1>
      <p style={{ color: '#5B6B60', fontSize: 14, marginBottom: 20 }}>
        Sesión iniciada como <strong>{session.user.email}</strong>.
      </p>
      <div style={{ background: '#E4F0EA', border: '1px solid #bfe0cf', color: '#084F39', padding: 14, borderRadius: 8, fontSize: 13, marginBottom: 20 }}>
        ✅ El inicio de sesión real está funcionando. Las demás funciones del panel (Hoy, Ocupación,
        Sanciones, etc.) se irán agregando aquí en los próximos pasos.
      </div>
      <button onClick={handleLogout}
        style={{ padding: '8px 16px', background: 'transparent', border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
        Cerrar sesión
      </button>
    </main>
  );
}
