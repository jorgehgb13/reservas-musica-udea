'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function toMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
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

const ROOM_TYPE_LABEL = { cubiculo: 'Cubículos', aula: 'Aulas', auditorio: 'Auditorio' };
const ROOM_TYPE_ORDER = ['cubiculo', 'aula', 'auditorio'];
const OCCUPANCY_TABS = [
  { key: 'todos', label: 'Todos' },
  { key: 'cubiculo', label: 'Cubículos' },
  { key: 'aula', label: 'Aulas' },
  { key: 'auditorio', label: 'Auditorio' },
];

const OPERATING_START = 6; // 6:00 a.m.
const OPERATING_END = 20; // 8:00 p.m.
const OPERATING_START_MIN = OPERATING_START * 60;
const OPERATING_END_MIN = OPERATING_END * 60;
const OPERATING_TOTAL_MIN = OPERATING_END_MIN - OPERATING_START_MIN;
const HOUR_MARKS = Array.from({ length: OPERATING_END - OPERATING_START + 1 }, (_, i) => OPERATING_START + i);

function pctLeft(startTime) {
  const startMin = toMinutes(startTime.slice(0, 5));
  const pct = ((startMin - OPERATING_START_MIN) / OPERATING_TOTAL_MIN) * 100;
  return Math.min(100, Math.max(0, pct));
}

function pctWidth(startTime, endTime) {
  const startMin = Math.max(toMinutes(startTime.slice(0, 5)), OPERATING_START_MIN);
  const endMin = Math.min(toMinutes(endTime.slice(0, 5)), OPERATING_END_MIN);
  const pct = ((endMin - startMin) / OPERATING_TOTAL_MIN) * 100;
  return Math.max(0, pct);
}

export default function AdminHome() {
  const [session, setSession] = useState(undefined);
  const router = useRouter();

  const [view, setView] = useState('lista'); // 'lista' | 'ocupacion'
  const [date, setDate] = useState(todayStr());
  const [reservations, setReservations] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState(null);
  const [actionId, setActionId] = useState(null);

  const [rooms, setRooms] = useState([]);
  const [roomsError, setRoomsError] = useState(null);
  const [occupancyType, setOccupancyType] = useState('todos');

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
      .select('id, room_id, date, start_time, end_time, status, checked_in_at, rooms ( name, type ), app_users ( name, email )')
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

  useEffect(() => {
    if (!session) return;
    supabase
      .from('rooms')
      .select('id, code, name, type')
      .order('type', { ascending: true })
      .order('code', { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          console.error('[admin] error cargando espacios:', error);
          setRoomsError(`No se pudieron cargar los espacios: ${error.message}`);
        } else {
          setRooms(data || []);
        }
      });
  }, [session]);

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

  const reservationsByRoom = {};
  for (const r of reservations) {
    if (!reservationsByRoom[r.room_id]) reservationsByRoom[r.room_id] = [];
    reservationsByRoom[r.room_id].push(r);
  }

  const visibleRooms = occupancyType === 'todos' ? rooms : rooms.filter((r) => r.type === occupancyType);
  const roomGroups =
    occupancyType === 'todos'
      ? ROOM_TYPE_ORDER.map((t) => ({ type: t, rooms: rooms.filter((r) => r.type === t) })).filter((g) => g.rooms.length > 0)
      : [{ type: occupancyType, rooms: visibleRooms }];

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

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid #DBDCCF' }}>
        <button
          onClick={() => setView('lista')}
          style={{
            padding: '10px 4px', fontSize: 14, fontWeight: 600, background: 'transparent', cursor: 'pointer',
            border: 'none', borderBottom: view === 'lista' ? '2px solid #0B6E4F' : '2px solid transparent',
            color: view === 'lista' ? '#0B6E4F' : '#5B6B60', marginRight: 20,
          }}
        >
          Reservas del día
        </button>
        <button
          onClick={() => setView('ocupacion')}
          style={{
            padding: '10px 4px', fontSize: 14, fontWeight: 600, background: 'transparent', cursor: 'pointer',
            border: 'none', borderBottom: view === 'ocupacion' ? '2px solid #0B6E4F' : '2px solid transparent',
            color: view === 'ocupacion' ? '#0B6E4F' : '#5B6B60',
          }}
        >
          Ocupación
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          style={{ padding: 8, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 14 }} />
        {view === 'lista' && (
          <span style={{ fontSize: 13, color: '#5B6B60' }}>
            {loadingList ? 'Cargando…' : `${reservations.length} reserva(s)`}
          </span>
        )}
      </div>

      {view === 'lista' && (
        <>
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
        </>
      )}

      {view === 'ocupacion' && (
        <>
          {roomsError && (
            <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
              {roomsError}
            </div>
          )}
          {listError && (
            <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
              {listError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            {OCCUPANCY_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setOccupancyType(t.key)}
                style={{
                  padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 20, cursor: 'pointer',
                  border: occupancyType === t.key ? '1px solid #0B6E4F' : '1px solid #DBDCCF',
                  background: occupancyType === t.key ? '#0B6E4F' : '#fff',
                  color: occupancyType === t.key ? '#fff' : '#16241C',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
            {Object.entries(STATUS_COLOR)
              .filter(([key]) => key !== 'cancelada' && key !== 'rechazada')
              .map(([key, colors]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#5B6B60' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: colors.fg, display: 'inline-block' }} />
                  {STATUS_LABEL[key]}
                </div>
              ))}
          </div>

          {rooms.length === 0 && !roomsError && (
            <p style={{ color: '#5B6B60', fontSize: 13 }}>Cargando espacios…</p>
          )}

          {roomGroups.map((group) => (
            <div key={group.type} style={{ marginBottom: 28 }}>
              {occupancyType === 'todos' && (
                <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 15, margin: '0 0 10px' }}>
                  {ROOM_TYPE_LABEL[group.type]}
                </h3>
              )}

              <div style={{ display: 'flex', marginBottom: 6 }}>
                <div style={{ width: 130, flexShrink: 0 }} />
                <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#5B6B60' }}>
                  {HOUR_MARKS.map((h) => (
                    <span key={h}>{h}h</span>
                  ))}
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 560 }}>
                  {group.rooms.map((room) => {
                    const roomReservations = reservationsByRoom[room.id] || [];
                    return (
                      <div key={room.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                        <div style={{ width: 130, flexShrink: 0, fontSize: 12, paddingRight: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {room.name}
                        </div>
                        <div style={{ flex: 1, position: 'relative', height: 26, background: '#F5F4EC', borderRadius: 4 }}>
                          {roomReservations.map((r) => {
                            const colors = STATUS_COLOR[r.status] || { bg: '#eee', fg: '#333' };
                            const left = pctLeft(r.start_time);
                            const width = pctWidth(r.start_time, r.end_time);
                            return (
                              <div
                                key={r.id}
                                title={`${r.start_time.slice(0, 5)}-${r.end_time.slice(0, 5)} · ${r.app_users?.name || ''} · ${STATUS_LABEL[r.status] || r.status}`}
                                style={{
                                  position: 'absolute', top: 2, bottom: 2,
                                  left: `${left}%`, width: `${width}%`,
                                  background: colors.fg, borderRadius: 4,
                                  fontSize: 10, color: '#fff', display: 'flex', alignItems: 'center',
                                  justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap', padding: '0 4px',
                                }}
                              >
                                {r.start_time.slice(0, 5)}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </main>
  );
}
