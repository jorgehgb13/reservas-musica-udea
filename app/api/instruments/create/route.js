// Ruta de servidor: crea el préstamo de instrumento real en estado
// "sin_verificar", con un código de 6 dígitos, y envía ese código por
// correo real (Resend). Máximo 4 horas por préstamo. Igual que con las
// reservas de espacio, si el correo no se puede enviar, no se deja el
// préstamo a medias ocupando el horario del instrumento.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { sendEmail, instrumentVerificationEmailHtml } from '../../../../lib/email';

const MAX_DURATION_MIN = 240; // 4 horas

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

  const { userId, instrumentId, date, start, end } = body || {};

  if (!userId || !instrumentId || !date || !start || !end) {
    return NextResponse.json({ ok: false, message: 'Faltan datos para crear el préstamo.' }, { status: 400 });
  }

  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  if (endMin - startMin > MAX_DURATION_MIN) {
    return NextResponse.json({ ok: false, message: 'El préstamo no puede durar más de 4 horas.' }, { status: 400 });
  }

  try {
    const { data: activeSanctions, error: sanctionError } = await supabaseAdmin
      .from('sanctions')
      .select('reason, until')
      .eq('user_id', userId)
      .gt('until', new Date().toISOString())
      .limit(1);

    if (sanctionError) {
      console.error('[instruments/create] error sanciones:', sanctionError);
      return NextResponse.json({ ok: false, message: 'No se pudo verificar tu cuenta. Intenta de nuevo.' }, { status: 500 });
    }
    if (activeSanctions && activeSanctions.length > 0) {
      const s = activeSanctions[0];
      return NextResponse.json(
        { ok: false, message: `Tu acceso está suspendido hasta el ${new Date(s.until).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}.` },
        { status: 403 }
      );
    }

    const { data: existingActive, error: activeError } = await supabaseAdmin
      .from('instrument_reservations')
      .select('date, end_time')
      .eq('user_id', userId)
      .in('status', ['confirmada', 'sin_verificar']);

    if (activeError) {
      console.error('[instruments/create] error préstamo activo:', activeError);
      return NextResponse.json({ ok: false, message: 'No se pudo verificar tu cuenta. Intenta de nuevo.' }, { status: 500 });
    }

    const now = new Date();
    const hasActive = (existingActive || []).some((r) => new Date(`${r.date}T${r.end_time}-05:00`) > now);
    if (hasActive) {
      return NextResponse.json(
        { ok: false, message: 'Ya tienes un préstamo activo sin terminar. Espera a que termine para solicitar otro.' },
        { status: 403 }
      );
    }

    const { data: conflicts, error: conflictError } = await supabaseAdmin
      .from('instrument_reservations')
      .select('start_time, end_time')
      .eq('instrument_id', instrumentId)
      .eq('date', date)
      .in('status', ['confirmada', 'sin_verificar']);

    if (conflictError) {
      console.error('[instruments/create] error conflictos:', conflictError);
      return NextResponse.json({ ok: false, message: 'No se pudo revisar la disponibilidad. Intenta de nuevo.' }, { status: 500 });
    }

    const overlaps = (conflicts || []).some((r) => {
      const rs = toMinutes(r.start_time.slice(0, 5));
      const re = toMinutes(r.end_time.slice(0, 5));
      return startMin < re && rs < endMin;
    });

    if (overlaps) {
      return NextResponse.json(
        { ok: false, message: 'Ese horario ya no está disponible para este instrumento. Elige otro horario u otro instrumento.' },
        { status: 409 }
      );
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('instrument_reservations')
      .insert({
        instrument_id: instrumentId,
        user_id: userId,
        date,
        start_time: start,
        end_time: end,
        status: 'sin_verificar',
        verification_code: code,
        verification_expires_at: expiresAt,
      })
      .select('id')
      .single();

    if (insertError) {
      if (insertError.code === '23P01') {
        return NextResponse.json(
          { ok: false, message: 'Ese horario se acaba de ocupar por otra persona. Elige otro horario u otro instrumento.' },
          { status: 409 }
        );
      }
      console.error('[instruments/create] error insertando:', insertError);
      return NextResponse.json({ ok: false, message: 'No se pudo crear el préstamo. Intenta de nuevo.' }, { status: 500 });
    }

    const emailSent = await sendInstrumentEmailNow(userId, instrumentId, code, date, start, end);

    if (!emailSent) {
      await supabaseAdmin.from('instrument_reservations').delete().eq('id', inserted.id);
      return NextResponse.json(
        { ok: false, message: 'No pudimos enviarte el correo de verificación. Revisa que tu correo esté bien escrito e intenta de nuevo.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, reservationId: inserted.id, expiresAt });
  } catch (err) {
    console.error('[instruments/create] error inesperado:', err);
    return NextResponse.json({ ok: false, message: 'Ocurrió un error inesperado. Intenta de nuevo.' }, { status: 500 });
  }
}

async function sendInstrumentEmailNow(userId, instrumentId, code, date, start, end) {
  try {
    const [{ data: user }, { data: instrument }] = await Promise.all([
      supabaseAdmin.from('app_users').select('email').eq('id', userId).maybeSingle(),
      supabaseAdmin.from('instruments').select('name').eq('id', instrumentId).maybeSingle(),
    ]);
    if (!user?.email) return false;
    const result = await sendEmail({
      to: user.email,
      subject: 'Tu código para confirmar tu préstamo — Reservas Música UdeA',
      html: instrumentVerificationEmailHtml({ code, instrumentName: instrument?.name || 'el instrumento', date, start, end }),
    });
    return result.ok;
  } catch (err) {
    console.error('[instruments/create] error enviando correo:', err);
    return false;
  }
}
