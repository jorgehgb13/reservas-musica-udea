// Ruta del servidor: recibe nombre + correo del formulario de préstamo de
// instrumentos, revisa sanciones y préstamos de instrumento activos (esto es
// independiente de las reservas de espacio — alguien puede tener un espacio
// reservado y un instrumento prestado al mismo tiempo, sin problema).

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

const EMAIL_REGEX = /^[^\s@]+@udea\.edu\.co$/i;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json({ ok: false, message: 'Solicitud inválida.' }, { status: 400 });
  }

  const name = (body?.name || '').trim();
  const email = (body?.email || '').trim().toLowerCase();

  if (!name) {
    return NextResponse.json({ ok: false, message: 'Ingresa tu nombre completo.' }, { status: 400 });
  }
  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json(
      { ok: false, message: 'Usa tu correo institucional con dominio @udea.edu.co.' },
      { status: 400 }
    );
  }

  try {
    const { data: existingUser, error: findError } = await supabaseAdmin
      .from('app_users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (findError) {
      console.error('[instruments/start] error buscando usuario:', findError);
      return NextResponse.json({ ok: false, message: 'No se pudo verificar tu correo. Intenta de nuevo.' }, { status: 500 });
    }

    const userId = existingUser?.id;

    if (userId) {
      const { data: activeSanctions, error: sanctionError } = await supabaseAdmin
        .from('sanctions')
        .select('reason, until')
        .eq('user_id', userId)
        .gt('until', new Date().toISOString())
        .order('until', { ascending: false })
        .limit(1);

      if (sanctionError) {
        console.error('[instruments/start] error revisando sanciones:', sanctionError);
        return NextResponse.json({ ok: false, message: 'No se pudo verificar tu correo. Intenta de nuevo.' }, { status: 500 });
      }

      if (activeSanctions && activeSanctions.length > 0) {
        const s = activeSanctions[0];
        return NextResponse.json(
          {
            ok: false,
            message: `Tu acceso está suspendido hasta el ${new Date(s.until).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}${s.reason ? ` — Motivo: ${s.reason}` : ''}.`,
          },
          { status: 403 }
        );
      }

      const { data: activeLoans, error: loanError } = await supabaseAdmin
        .from('instrument_reservations')
        .select('date, end_time, status, instruments ( name )')
        .eq('user_id', userId)
        .in('status', ['confirmada', 'sin_verificar']);

      if (loanError) {
        console.error('[instruments/start] error revisando préstamos activos:', loanError);
        return NextResponse.json({ ok: false, message: 'No se pudo verificar tu correo. Intenta de nuevo.' }, { status: 500 });
      }

      const now = new Date();
      const active = (activeLoans || []).find(
        (r) => new Date(`${r.date}T${r.end_time}-05:00`) > now
      );

      if (active) {
        return NextResponse.json(
          {
            ok: false,
            message: `Ya tienes un préstamo activo de ${active.instruments?.name || 'un instrumento'} que termina el ${new Date(`${active.date}T${active.end_time}-05:00`).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}. Podrás solicitar otro cuando termine.`,
          },
          { status: 403 }
        );
      }
    }

    const upsertPayload = userId ? { id: userId, email, name } : { email, name };
    const { data: upsertedUser, error: upsertError } = await supabaseAdmin
      .from('app_users')
      .upsert(upsertPayload, { onConflict: 'email' })
      .select('id')
      .single();

    if (upsertError) {
      console.error('[instruments/start] error guardando usuario:', upsertError);
      return NextResponse.json({ ok: false, message: 'No se pudo guardar tus datos. Intenta de nuevo.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, userId: upsertedUser.id });
  } catch (err) {
    console.error('[instruments/start] error inesperado:', err);
    return NextResponse.json({ ok: false, message: 'Ocurrió un error inesperado. Intenta de nuevo.' }, { status: 500 });
  }
}
