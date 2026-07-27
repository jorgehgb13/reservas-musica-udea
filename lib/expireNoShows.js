// Libera automáticamente el espacio de una reserva "confirmada" si pasaron
// más de 15 minutos desde su hora de inicio y nadie marcó "Confirmar
// asistencia". La reserva pasa a "cancelada" con cancel_reason = 'no_asistio'
// y auto_cancelled = true, para poder diferenciarla de una cancelación
// normal (y para que las estadísticas la cuenten como inasistencia).
//
// Esto se ejecuta de forma "perezosa" (no hay un proceso corriendo todo el
// tiempo): cada vez que alguien consulta disponibilidad, crea una reserva,
// o el administrador abre "Reservas del día", se revisa primero si hay
// reservas vencidas y se liberan en ese momento.

import { supabaseAdmin } from './supabaseAdmin';

const GRACE_MINUTES = 15;

function todayBogota() {
  const now = new Date();
  const shifted = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export async function expireNoShowReservations(roomId = null) {
  const cutoff = new Date(Date.now() - GRACE_MINUTES * 60 * 1000);

  let query = supabaseAdmin
    .from('reservations')
    .select('id, date, start_time')
    .eq('status', 'confirmada')
    .is('checked_in_at', null)
    .lte('date', todayBogota());

  if (roomId) query = query.eq('room_id', roomId);

  const { data, error } = await query;
  if (error) {
    console.error('[expireNoShows] error buscando candidatas:', error);
    return { expired: 0 };
  }

  const toExpire = (data || []).filter((r) => {
    const startDt = new Date(`${r.date}T${r.start_time}-05:00`);
    return startDt < cutoff;
  });

  if (toExpire.length === 0) return { expired: 0 };

  const ids = toExpire.map((r) => r.id);
  const { error: updateError } = await supabaseAdmin
    .from('reservations')
    .update({ status: 'cancelada', auto_cancelled: true, cancel_reason: 'no_asistio' })
    .in('id', ids);

  if (updateError) {
    console.error('[expireNoShows] error actualizando:', updateError);
    return { expired: 0 };
  }

  return { expired: ids.length };
}
