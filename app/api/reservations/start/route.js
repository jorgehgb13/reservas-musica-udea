// Ruta del servidor: recibe nombre + correo del formulario público,
// verifica sanciones y reservas activas (con permisos completos, de forma
// segura), y guarda/actualiza el registro del usuario. Nunca expone la
// clave secreta al navegador — todo esto corre en el servidor de Vercel.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

const EMAIL_REGEX = /^[^\s@]+@udea\.edu\.co$/i;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: 'bad_request', message: 'Solicitud inválida.' },
      { status: 400 }
    );
  }

  const name = (body?.name || '').trim();
  const email = (body?.email || '').trim().toLowerCase();

  if (!name) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_name', message: 'Ingresa tu nombre completo.' },
      { status: 400 }
    );
  }
  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_email', message: 'Usa tu correo institucional con dominio @udea.edu.co.' },
      { status: 400 }
    );
  }

  try {
    const { data: existingUser, error: findError } = await supabaseAdmin
      .from('app_users')
      .select('id, is_admin')
      .eq('email', email)
      .maybeSingle();

    if (findError) {
      console.error('[reservations/start] error buscando usuario:', findError);
      return NextResponse.json(
        { ok: false, reason: 'server_error', message: 'No se pudo verificar tu correo. Intenta de nuevo.' },
        { status: 500 }
      );
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
        console.error('[reservations/start] error revisando sanciones:', sanctionError);
        return NextResponse.json(
          { ok: false, reason: 'server_error', message: 'No se pudo verificar tu correo. Intenta de nuevo.' },
          { status: 500 }
        );
      }

      if (activeSanctions && activeSanctions.length > 0) {
        const s = activeSanctions[0];
        return NextResponse.json(
          {
            ok: false,
            reason: 'sanctioned',
            message: `Tu acceso a reservas está suspendido hasta el ${new Date(s.until).toLocaleString('es-CO')}${s.reason ? ` — Motivo: ${s.reason}` : ''}.`,
          },
          { status: 403 }
        );
      }

      const { data: roomReservations, error: resError } = await supabaseAdmin
        .from('reservations')
        .select('date, end_time, status, rooms ( name )')
        .eq('user_id', userId)
        .in('status', ['confirmada', 'pendiente', 'sin_verificar']);

      if (resError) {
        console.error('[reservations/start] error revisando reservas activas:', resError);
        return NextResponse.json(
          { ok: false, reason: 'server_error', message: 'No se pudo verificar tu correo. Intenta de nuevo.' },
          { status: 500 }
        );
      }

      const now = new Date();
      const active = (roomReservations || []).find(
        (r) => new Date(`${r.date}T${r.end_time}-05:00`) > now
      );

      if (active) {
        return NextResponse.json(
          {
            ok: false,
            reason: 'active_reservation',
            message: `Ya tienes una reserva activa en ${active.rooms?.name || 'un espacio'} que termina el ${new Date(`${active.date}T${active.end_time}-05:00`).toLocaleString('es-CO')}. Podrás solicitar una nueva cuando termine.`,
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
      console.error('[reservations/start] error guardando usuario:', upsertError);
      return NextResponse.json(
        { ok: false, reason: 'server_error', message: 'No se pudo guardar tus datos. Intenta de nuevo.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, userId: upsertedUser.id });
  } catch (err) {
    console.error('[reservations/start] error inesperado:', err);
    return NextResponse.json(
      { ok: false, reason: 'server_error', message: 'Ocurrió un error inesperado. Intenta de nuevo.' },
      { status: 500 }
    );
  }
}
