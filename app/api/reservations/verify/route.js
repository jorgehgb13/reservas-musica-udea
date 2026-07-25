// Ruta de servidor: confirma el código de verificación de 6 dígitos.
// Si coincide y no ha expirado, la reserva pasa de "sin_verificar" a
// "confirmada" o "pendiente" (según si el espacio necesita autorización).

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json({ ok: false, message: 'Solicitud inválida.' }, { status: 400 });
  }

  const { reservationId, code } = body || {};
  if (!reservationId || !code) {
    return NextResponse.json({ ok: false, message: 'Faltan datos.' }, { status: 400 });
  }

  try {
    const { data: res, error: findError } = await supabaseAdmin
      .from('reservations')
      .select('id, status, verification_code, verification_expires_at, requires_approval')
      .eq('id', reservationId)
      .maybeSingle();

    if (findError) {
      console.error('[reservations/verify] error buscando:', findError);
      return NextResponse.json({ ok: false, message: 'No se pudo verificar el código. Intenta de nuevo.' }, { status: 500 });
    }
    if (!res) {
      return NextResponse.json({ ok: false, message: 'No se encontró la reserva.' }, { status: 404 });
    }
    if (res.status !== 'sin_verificar') {
      return NextResponse.json({ ok: false, message: 'Esta reserva ya no está pendiente de verificación.' }, { status: 409 });
    }
    if (new Date(res.verification_expires_at) < new Date()) {
      return NextResponse.json({ ok: false, message: 'El código expiró. Tu reserva ya no se pudo confirmar.' }, { status: 410 });
    }
    if (res.verification_code !== code) {
      return NextResponse.json({ ok: false, message: 'El código no coincide. Verifica e intenta de nuevo.' }, { status: 400 });
    }

    const newStatus = res.requires_approval ? 'pendiente' : 'confirmada';
    const { error: updateError } = await supabaseAdmin
      .from('reservations')
      .update({ status: newStatus })
      .eq('id', reservationId);

    if (updateError) {
      console.error('[reservations/verify] error actualizando:', updateError);
      return NextResponse.json({ ok: false, message: 'No se pudo confirmar la reserva. Intenta de nuevo.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, status: newStatus });
  } catch (err) {
    console.error('[reservations/verify] error inesperado:', err);
    return NextResponse.json({ ok: false, message: 'Ocurrió un error inesperado.' }, { status: 500 });
  }
}
