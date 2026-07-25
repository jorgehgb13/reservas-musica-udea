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
  const [reservations, setReservations] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState(null);
  const [actionId, setActionId] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === null) router.push('/admin/login');
  }, [session, router]);

  const loadReservations = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    const { data, error } = await supabase
      .from('reservations')
      .select('id, date, start_time, end_time, status, checked_in_at, rooms ( name ), app_users ( name, email )')
      .eq('date', date)
      .neq('status', 'cancelada')
      .neq('status', 'rechazada')
      .order('start_time', { ascending: true });

    if (error) {
      console.error('[admin] error cargando reservas:', error);
      setListError(`No se pudieron cargar las reservas: ${error.message}`);
      setReservations([]);
    } else {
      setReservations(data || []);
    }
    setLoadingList(false);
  }, [date]);

  useEffect(() => {
    if (session) loadReservations();
  }, [session, loadReservations]);

  async function handleCheckIn(id) {
    setActionId(id);
    const { error } = await supabase
      .from('reservations')
      .update({ checked_in_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error('[admin] error confirmando asistencia:', error);
      setListError(`No se pudo confirmar la asistencia: ${error.message}`);
    } else {
      await loadReservations();
    }
    setActionId(null);
  }

  async function handleCancel(id) {
    setActionId(id);
    const { error } = await supabase
      .from('reservations')
      .update({ status: 'cancelada' })
      .eq('id', id);
    if (error) {
      console.error('[admin] error cancelando:', error);
      setListError(`No se pudo cancelar la reserva: ${error.message}`);
    } else {
      await loadReservations();
    }
    setActionId(null);
  }

  async function handleApprove(id) {
    setActionId(id);
    const { error } = await supabase
      .from('reservations')
      .update({ status: 'confirmada' })
      .eq('id', id);
    if (error) {
      console.error('[admin] error aprobando:', error);
      setListError(`No se pudo aprobar la reserva: ${error.message}`);
    } else {
      await loadReservations();
    }
    setActionId(null);
  }

  async function handleReject(id) {
    setActionId(id);
    const { error } = await supabase
      .from('reservations')
      .update({ status: 'rechazada' })
      .eq('id', id);
    if (error) {
      console.error('[admin] error rechazando:', error);
      setListError(`No se pudo rechazar la reserva: ${error.message}`);
    } else {
      await loadReservations();
    }
    setActionId(null);
  }

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
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
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
          {loadingList ? 'Cargando…' : `${reservations.length} reserva(s)`}
        </span>
      </div>

      {listError && (
        <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
          {listError}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #DBDCCF' }}>
              <th style={{ padding: 8 }}>Espacio</th>
              <th style={{ padding: 8 }}>Horario</th>
              <th style={{ padding: 8 }}>Solicitante</th>
              <th style={{ padding: 8 }}>Estado</th>
              <th style={{ padding: 8 }}></th>
            </tr>
          </thead>
          <tbody>
            {reservations.length === 0 && !loadingList && (
              <tr>
                <td colSpan={5} style={{ padding: 20, textAlign: 'center', color: '#5B6B60' }}>
                  Sin reservas para esta fecha.
                </td>
              </tr>
            )}
            {reservations.map((r) => {
              const canCheckIn = r.status === 'confirmada' && !r.checked_in_at;
              const canCancel = r.status !== 'cancelada';
              const canApproveReject = r.status === 'pendiente';
              const colors = STATUS_COLOR[r.status] || { bg: '#eee', fg: '#333' };
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid #DBDCCF' }}>
                  <td style={{ padding: 8 }}>{r.rooms?.name || '—'}</td>
                  <td style={{ padding: 8, fontFamily: 'monospace' }}>
                    {r.start_time?.slice(0, 5)}-{r.end_time?.slice(0, 5)}
                  </td>
                  <td style={{ padding: 8 }}>
                    {r.app_users?.name || '—'}
                    <br />
                    <span style={{ color: '#5B6B60', fontSize: 11 }}>{r.app_users?.email}</span>
                  </td>
                  <td style={{ padding: 8 }}>
                    <span style={{ background: colors.bg, color: colors.fg, fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20 }}>
                      {STATUS_LABEL[r.status] || r.status}
                    </span>
                    {r.checked_in_at && (
                      <div style={{ fontSize: 10, color: '#5B6B60', marginTop: 2 }}>asistió</div>
                    )}
                  </td>
                  <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                    {canApproveReject && (
                      <>
                        <button onClick={() => handleApprove(r.id)} disabled={actionId === r.id}
                          style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #0B6E4F', color: '#0B6E4F', borderRadius: 6, background: 'transparent', cursor: 'pointer', marginRight: 6 }}>
                          Aprobar
                        </button>
                        <button onClick={() => handleReject(r.id)} disabled={actionId === r.id}
                          style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #A23E33', color: '#A23E33', borderRadius: 6, background: 'transparent', cursor: 'pointer', marginRight: 6 }}>
                          Rechazar
                        </button>
                      </>
                    )}
                    {canCheckIn && (
                      <button onClick={() => handleCheckIn(r.id)} disabled={actionId === r.id}
                        style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #16241C', borderRadius: 6, background: 'transparent', cursor: 'pointer', marginRight: 6 }}>
                        Confirmar asistencia
                      </button>
                    )}
                    {canCancel && (
                      <button onClick={() => handleCancel(r.id)} disabled={actionId === r.id}
                        style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #A23E33', color: '#A23E33', borderRadius: 6, background: 'transparent', cursor: 'pointer' }}>
                        Cancelar
                      </button>
                    )}
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
