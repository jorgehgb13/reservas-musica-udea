// Ruta de servidor: Paso 1 de "Cancelar mi reserva".
// Recibe el correo institucional, busca si esa persona tiene una reserva de
// espacio activa (confirmada, pendiente o sin_verificar y que no haya
// terminado), y genera un código de 6 dígitos para confirmar que quiere
// cancelarla (mismo patrón que la verificación al crear una reserva).
// Nunca revela si el correo existe o no en app_users de forma explícita
// para no filtrar información — solo dice si hay o no una reserva activa.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { sendEmail, cancelEmailHtml } from '../../../../lib/email';

const EMAIL_REGEX = /^[^\s@]+@udea\.edu\.co$/i;

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json({ ok: false, message: 'Solicitud inválida.' }, { status: 400 });
  }

  const email = (body?.email || '').trim().toLowerCase();

  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json(
      { ok: false, message: 'Usa tu correo institucional con dominio @udea.edu.co.' },
      { status: 400 }
    );
  }

  try {
    const { data: user, error: userError } = await supabaseAdmin
      .from('app_users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (userError) {
      console.error('[reservations/lookup-active] error buscando usuario:', userError);
      return NextResponse.json({ ok: false, message: 'No se pudo verificar tu correo. Intenta de nuevo.' }, { status: 500 });
    }

    if (!user) {
      return NextResponse.json(
        { ok: false, message: 'No encontramos ninguna reserva activa con ese correo.' },
        { status: 404 }
      );
    }

    const { data: reservations, error: resError } = await supabaseAdmin
      .from('reservations')
      .select('id, date, start_time, end_time, status, rooms ( name, type )')
      .eq('user_id', user.id)
      .in('status', ['confirmada', 'pendiente', 'sin_verificar'])
      .order('created_at', { ascending: false });

    if (resError) {
      console.error('[reservations/lookup-active] error buscando reservas:', resError);
      return NextResponse.json({ ok: false, message: 'No se pudo verificar tu reserva. Intenta de nuevo.' }, { status: 500 });
    }

    const now = new Date();
    const active = (reservations || []).find(
      (r) => new Date(`${r.date}T${r.end_time}-05:00`) > now
    );

    if (!active) {
      return NextResponse.json(
        { ok: false, message: 'No encontramos ninguna reserva activa con ese correo.' },
        { status: 404 }
      );
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const emailResult = await sendEmail({
      to: email,
      subject: 'Tu código para cancelar tu reserva — Reservas Música UdeA',
      html: cancelEmailHtml({
        code,
        roomName: active.rooms?.name || 'el espacio',
        date: active.date,
        start: active.start_time?.slice(0, 5),
        end: active.end_time?.slice(0, 5),
      }),
    });

    if (!emailResult.ok) {
      return NextResponse.json(
        { ok: false, message: 'No pudimos enviarte el correo con el código. Intenta de nuevo en unos minutos.' },
        { status: 502 }
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from('reservations')
      .update({ verification_code: code, verification_expires_at: expiresAt })
      .eq('id', active.id);

    if (updateError) {
      console.error('[reservations/lookup-active] error guardando código:', updateError);
      return NextResponse.json({ ok: false, message: 'No se pudo generar el código. Intenta de nuevo.' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      reservationId: active.id,
      expiresAt,
      reservation: {
        roomName: active.rooms?.name || 'Espacio',
        roomType: active.rooms?.type || null,
        date: active.date,
        startTime: active.start_time?.slice(0, 5),
        endTime: active.end_time?.slice(0, 5),
        status: active.status,
      },
    });
  } catch (err) {
    console.error('[reservations/lookup-active] error inesperado:', err);
    return NextResponse.json({ ok: false, message: 'Ocurrió un error inesperado. Intenta de nuevo.' }, { status: 500 });
  }
}
