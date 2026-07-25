// Ruta de servidor: crea la reserva real en estado "sin_verificar", con un
// código de 6 dígitos. Antes de crear, vuelve a revisar sanciones y reserva
// activa (por si pasó tiempo entre el Paso 1 y este momento), y revisa
// conflictos de horario de forma amigable. La base de datos (restricción
// EXCLUDE) es la garantía final contra dos reservas al mismo tiempo.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

const TYPE_APPROVAL = { cubiculo: false, aula: true, auditorio: true };

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function toMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json({ ok: false, message: 'Solicitud inválida.' }, { status: 400 });
  }

  const { userId, roomId, roomType, date, start, end } = body || {};

  if (!userId || !roomId || !date || !start || !end) {
    return NextResponse.json({ ok: false, message: 'Faltan datos para crear la reserva.' }, { status: 400 });
  }

  const requiresApproval = !!TYPE_APPROVAL[roomType];

  try {
    const { data: activeSanctions, error: sanctionError } = await supabaseAdmin
      .from('sanctions')
      .select('reason, until')
      .eq('user_id', userId)
      .gt('until', new Date().toISOString())
      .limit(1);

    if (sanctionError) {
      console.error('[reservations/create] error sanciones:', sanctionError);
      return NextResponse.json({ ok: false, message: 'No se pudo verificar tu cuenta. Intenta de nuevo.' }, { status: 500 });
    }
    if (activeSanctions && activeSanctions.length > 0) {
      const s = activeSanctions[0];
      return NextResponse.json(
        { ok: false, message: message: `Tu acceso a reservas está { ok: false, message: `Tu acceso a reservas está suspendido hasta el ${new Date(s.until).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}.` },
        
      );
    }

    const { data: existingActive, error: activeError } = await supabaseAdmin
      .from('reservations')
      .select('date, end_time')
      .eq('user_id', userId)
      .in('status', ['confirmada', 'pendiente', 'sin_verificar']);

    if (activeError) {
      console.error('[reservations/create] error reserva activa:', activeError);
      return NextResponse.json({ ok: false, message: 'No se pudo verificar tu cuenta. Intenta de nuevo.' }, { status: 500 });
    }

    const now = new Date();
    const hasActive = (existingActive || []).some((r) => new Date(`${r.date}T${r.end_time}-05:00`) > now);
    if (hasActive) {
      return NextResponse.json(
        { ok: false, message: 'message: `Ya tienes una reserva activa en ${active.rooms?.name || 'un espacio'} que termina el ${new Date(`${active.date}T${active.end_time}-05:00`).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}. Podrás solicitar una nueva cuando termine.`,
        { status: 403 }
      );
    }

    const { data: conflicts, error: conflictError } = await supabaseAdmin
      .from('reservations')
      .select('start_time, end_time')
      .eq('room_id', roomId)
      .eq('date', date)
      .in('status', ['confirmada', 'pendiente', 'sin_verificar']);

    if (conflictError) {
      console.error('[reservations/create] error conflictos:', conflictError);
      return NextResponse.json({ ok: false, message: 'No se pudo revisar la disponibilidad. Intenta de nuevo.' }, { status: 500 });
    }

    const startMin = toMinutes(start);
    const endMin = toMinutes(end);
    const overlaps = (conflicts || []).some((r) => {
      const rs = toMinutes(r.start_time.slice(0, 5));
      const re = toMinutes(r.end_time.slice(0, 5));
      return startMin < re && rs < endMin;
    });

    if (overlaps) {
      return NextResponse.json(
        { ok: false, message: 'Ese horario ya no está disponible en este espacio. Elige otro horario u otro espacio.' },
        { status: 409 }
      );
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('reservations')
      .insert({
        room_id: roomId,
        user_id: userId,
        date,
        start_time: start,
        end_time: end,
        status: 'sin_verificar',
        requires_approval: requiresApproval,
        verification_code: code,
        verification_expires_at: expiresAt,
      })
      .select('id')
      .single();

    if (insertError) {
      if (insertError.code === '23P01') {
        return NextResponse.json(
          { ok: false, message: 'Ese horario se acaba de ocupar por otra persona. Elige otro horario u otro espacio.' },
          { status: 409 }
        );
      }
      console.error('[reservations/create] error insertando:', insertError);
      return NextResponse.json({ ok: false, message: 'No se pudo crear la reserva. Intenta de nuevo.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, reservationId: inserted.id, code, expiresAt, requiresApproval });
  } catch (err) {
    console.error('[reservations/create] error inesperado:', err);
    return NextResponse.json({ ok: false, message: 'Ocurrió un error inesperado. Intenta de nuevo.' }, { status: 500 });
  }
}
