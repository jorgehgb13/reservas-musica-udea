// Ruta de servidor: crea la reserva real en estado "sin_verificar", con un
// código de 6 dígitos. Antes de crear, vuelve a revisar sanciones y reserva
// activa (por si pasó tiempo entre el Paso 1 y este momento), y revisa
// conflictos de horario de forma amigable. La base de datos (restricción
// EXCLUDE) es la garantía final contra dos reservas al mismo tiempo.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { sendEmail, verificationEmailHtml } from '../../../../lib/email';
import { expireNoShowReservations } from '../../../../lib/expireNoShows';

const TYPE_APPROVAL = { cubiculo: false, aula: true, auditorio: true };
// Cubículos que, por excepción, también necesitan aprobación del
// administrador (igual que un aula), aunque su tipo sea "cubiculo".
const ROOM_CODES_REQUIRE_APPROVAL = ['25307', '25303'];

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

  const { userId, roomId, date, start, end } = body || {};

  if (!userId || !roomId || !date || !start || !end) {
    return NextResponse.json({ ok: false, message: 'Faltan datos para crear la reserva.' }, { status: 400 });
  }

  try {
    const { data: room, error: roomError } = await supabaseAdmin
      .from('rooms')
      .select('code, type')
      .eq('id', roomId)
      .maybeSingle();

    if (roomError || !room) {
      console.error('[reservations/create] error buscando espacio:', roomError);
      return NextResponse.json({ ok: false, message: 'No se pudo verificar el espacio. Intenta de nuevo.' }, { status: 500 });
    }

    const requiresApproval = !!TYPE_APPROVAL[room.type] || ROOM_CODES_REQUIRE_APPROVAL.includes(room.code);

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
        { ok: false, message: `Tu acceso a reservas está suspendido hasta el ${new Date(s.until).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}.` },
        { status: 403 }
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
        { ok: false, message: 'Ya tienes una reserva activa sin terminar. Espera a que termine para solicitar otra.' },
        { status: 403 }
      );
    }

    // Antes de revisar conflictos, liberamos cualquier reserva de este
    // espacio que ya venció (confirmada, sin asistencia, 15+ minutos
    // después de su hora de inicio) — así no choca con algo que en la
    // práctica ya está libre.
    await expireNoShowReservations(roomId);

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

    const emailSent = await sendVerificationEmailNow(userId, roomId, code, date, start, end);

    if (!emailSent) {
      // Sin correo real no hay forma de verificar, así que no dejamos una
      // reserva "sin_verificar" ocupando el horario indefinidamente.
      await supabaseAdmin.from('reservations').delete().eq('id', inserted.id);
      return NextResponse.json(
        { ok: false, message: 'No pudimos enviarte el correo de verificación. Revisa que tu correo esté bien escrito e intenta de nuevo.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, reservationId: inserted.id, expiresAt, requiresApproval });
  } catch (err) {
    console.error('[reservations/create] error inesperado:', err);
    return NextResponse.json({ ok: false, message: 'Ocurrió un error inesperado. Intenta de nuevo.' }, { status: 500 });
  }
}

// Envía el correo real de verificación y espera a que termine antes de
// responder — en Vercel, una tarea sin esperar puede cortarse apenas se
// responde. Devuelve true/false para que quien llama decida qué hacer si
// el correo no se pudo enviar (el código nunca se muestra en pantalla,
// así que sin correo real no hay forma de completar la verificación).
async function sendVerificationEmailNow(userId, roomId, code, date, start, end) {
  try {
    const [{ data: user }, { data: room }] = await Promise.all([
      supabaseAdmin.from('app_users').select('email').eq('id', userId).maybeSingle(),
      supabaseAdmin.from('rooms').select('name').eq('id', roomId).maybeSingle(),
    ]);
    if (!user?.email) return false;
    const result = await sendEmail({
      to: user.email,
      subject: 'Tu código para confirmar tu reserva — Reservas Música UdeA',
      html: verificationEmailHtml({ code, roomName: room?.name || 'el espacio', date, start, end }),
    });
    return result.ok;
  } catch (err) {
    console.error('[reservations/create] error enviando correo de verificación:', err);
    return false;
  }
}
