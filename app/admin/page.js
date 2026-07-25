'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

const STATUS_LABEL = {
  sin_verificar: 'Sin verificar',
  pendiente: 'Pendiente',
  confirmada: 'Confirmada',
  cancelada: 'Cancelada',
  rechazada: 'Rechazada',
};

const STATUS_COLOR = {
  sin_verificar: { bg: '#EAE4F5', fg: '#5B3FA0' },
  pendiente: { bg: '#FBF1D6', fg: '#6b5510' },
  confirmada: { bg: '#E4F0EA', fg: '#084F39' },
  cancelada: { bg: '#eee', fg: '#888' },
  rechazada: { bg: '#F7E8E5', fg: '#A23E33' },
};

export default function AdminHome() {
  const [session, setSession] = useState(undefined);
  const router = useRouter();

  const [date, setDate] = useState(todayStr());
  const [rows, setRows] = useState([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === null) router.push('/admin/login');
  }, [session, router]);

  const loadReservations = useCallback(async () => {
    setLoadingRows(true);
    setActionError(null);
    const { data, error } = await supabase
      .from('reservations')
      .select('id, date, start_time, end_time, status, checked_in_at, rooms ( name ), app_users ( name, email )')
      .eq('date', date)
      .neq('status', 'cancelada')
      .neq('status', 'rechazada')
      .order('start_time', { ascending: true });

    if (error) {
      console.error(error);
      setActionError(`No se pudieron cargar las reservas: ${error.message}`);
      setRows([]);
    } else {
      setRows(data || []);
    }
    setLoadingRows(false);
  }, [date]);

  useEffect(() => {
    if (session) loadReservations();
  }, [session, date, loadReservations]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/admin/login');
  }

  async function handleCheckIn(id) {
    setBusyId(id);
    setActionError(null);
    const { error } = await supabase
      .from('reservations')
      .update({ checked_in_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error(error);
      setActionError(`No se pudo confirmar la asistencia: ${error.message}`);
    } else {
      await loadReservations();
    }
    setBusyId(null);
  }

  async function handleCancel(id) {
    setBusyId(id);
    setActionError(null);
    const { error } = await supabase
      .from('reservations')
      .update({ status: 'cancelada' })
      .eq('id', id);
    if (error) {
      console.error(error);
      setActionError(`No se pudo cancelar la reserva: ${error.message}`);
    } else {
      await loadReservations();
    }
    setBusyId(null);
  }

  if (session === undefined) {
    return <main style={{ padding: 40, textAlign: 'center', color: '#5B6B60' }}>Cargando…</main>;
  }
  if (!session) {
    return null;
  }

  return (
    <main style={{ maxWidth: 900, margin: '40px auto 0', padding: '0 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 22, margin: 0 }}>Panel de administrador</h1>
          <p style={{ color: '#5B6B60', fontSize: 13, margin: '4px 0 0' }}>
            Sesión iniciada como <strong>{session.user.email}</strong>
          </p>
        </div>
        <button onClick={handleLogout}
          style={{ padding: '8px 16px', background: 'transparent', border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
          Cerrar sesión
        </button>
      </div>

      <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 18, marginBottom: 10 }}>Reservas del día</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          style={{ padding: 8, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 14 }} />
        <span style={{ fontSize: 13, color: '#5B6B60' }}>
          {loadingRows ? 'Cargando…' : `${rows.length} reserva(s)`}
        </span>
      </div>

      {actionError && (
        <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
          {actionError}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #DBDCCF' }}>
              <th style={{ padding: '8px 6px', color: '#5B6B60', fontWeight: 500 }}>Espacio</th>
              <th style={{ padding: '8px 6px', color: '#5B6B60', fontWeight: 500 }}>Horario</th>
              <th style={{ padding: '8px 6px', color: '#5B6B60', fontWeight: 500 }}>Solicitante</th>
              <th style={{ padding: '8px 6px', color: '#5B6B60', fontWeight: 500 }}>Estado</th>
              <th style={{ padding: '8px 6px', color: '#5B6B60', fontWeight: 500 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loadingRows && (
              <tr>
                <td colSpan={5} style={{ padding: 20, textAlign: 'center', color: '#5B6B60' }}>
                  Sin reservas para esta fecha.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const colors = STATUS_COLOR[r.status] || { bg: '#eee', fg: '#333' };
              const canCheckIn = r.status === 'confirmada' && !r.checked_in_at;
              const isBusy = busyId === r.id;
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid #DBDCCF' }}>
                  <td style={{ padding: '9px 6px' }}>{r.rooms?.name || '—'}</td>
                  <td style={{ padding: '9px 6px', fontFamily: 'monospace' }}>
                    {r.start_time?.slice(0, 5)}-{r.end_time?.slice(0, 5)}
                  </td>
                  <td style={{ padding: '9px 6px' }}>
                    {r.app_users?.name || '—'}
                    <br />
                    <span style={{ color: '#5B6B60', fontSize: 11 }}>{r.app_users?.email}</span>
                  </td>
                  <td style={{ padding: '9px 6px' }}>
                    <span style={{ background: colors.bg, color: colors.fg, fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20 }}>
                      {STATUS_LABEL[r.status] || r.status}
                    </span>
                    {r.checked_in_at && (
                      <div style={{ fontSize: 10, color: '#5B6B60', marginTop: 2 }}>asistió</div>
                    )}
                  </td>
                  <td style={{ padding: '9px 6px', whiteSpace: 'nowrap' }}>
                    {canCheckIn && (
                      <button onClick={() => handleCheckIn(r.id)} disabled={isBusy}
                        style={{ marginRight: 6, padding: '5px 10px', fontSize: 12, border: '1px solid #16241C', borderRadius: 6, background: 'transparent', cursor: isBusy ? 'default' : 'pointer', opacity: isBusy ? 0.6 : 1 }}>
                        Confirmar asistencia
                      </button>
                    )}
                    <button onClick={() => handleCancel(r.id)} disabled={isBusy}
                      style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #A23E33', color: '#A23E33', borderRadius: 6, background: 'transparent', cursor: isBusy ? 'default' : 'pointer', opacity: isBusy ? 0.6 : 1 }}>
                      Cancelar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
