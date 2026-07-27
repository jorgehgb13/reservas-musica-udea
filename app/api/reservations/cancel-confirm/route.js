// Ruta de servidor: Paso 2 de "Cancelar mi reserva".
// Confirma el código de 6 dígitos generado por /lookup-active y, si coincide
// y no ha expirado, cancela la reserva (status = 'cancelada'). Este es el
// paso que de verdad libera el horario para que otra persona lo tome.

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
      .select('id, status, verification_code, verification_expires_at')
      .eq('id', reservationId)
      .maybeSingle();

    if (findError) {
      console.error('[reservations/cancel-confirm] error buscando:', findError);
      return NextResponse.json({ ok: false, message: 'No se pudo verificar el código. Intenta de nuevo.' }, { status: 500 });
    }
    if (!res) {
      return NextResponse.json({ ok: false, message: 'No se encontró la reserva.' }, { status: 404 });
    }
    if (res.status === 'cancelada' || res.status === 'rechazada') {
      return NextResponse.json({ ok: false, message: 'Esta reserva ya no está activa.' }, { status: 409 });
    }
    if (!res.verification_expires_at || new Date(res.verification_expires_at) < new Date()) {
      return NextResponse.json({ ok: false, message: 'El código expiró. Vuelve a buscar tu reserva para generar uno nuevo.' }, { status: 410 });
    }
    if (res.verification_code !== code) {
      return NextResponse.json({ ok: false, message: 'El código no coincide. Verifica e intenta de nuevo.' }, { status: 400 });
    }

    const { error: updateError } = await supabaseAdmin
      .from('reservations')
      .update({ status: 'cancelada', cancel_reason: 'Cancelada por el estudiante' })
      .eq('id', reservationId);

    if (updateError) {
      console.error('[reservations/cancel-confirm] error cancelando:', updateError);
      return NextResponse.json({ ok: false, message: 'No se pudo cancelar la reserva. Intenta de nuevo.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[reservations/cancel-confirm] error inesperado:', err);
    return NextResponse.json({ ok: false, message: 'Ocurrió un error inesperado.' }, { status: 500 });
  }
}
