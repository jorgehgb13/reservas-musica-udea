// Ruta del servidor: usada por el botón "el correo no existe / simular
// rebote". Cancela una reserva que aún estaba "sin_verificar", liberando
// el espacio de inmediato.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json({ ok: false, message: 'Solicitud inválida.' }, { status: 400 });
  }

  const { reservationId } = body || {};
  if (!reservationId) {
    return NextResponse.json({ ok: false, message: 'Falta el identificador de la reserva.' }, { status: 400 });
  }

  try {
    const { error } = await supabaseAdmin
      .from('reservations')
      .update({ status: 'cancelada', cancel_reason: 'correo_no_verificado' })
      .eq('id', reservationId)
      .eq('status', 'sin_verificar');

    if (error) {
      console.error('[reservations/cancel-unverified] error:', error);
      return NextResponse.json({ ok: false, message: 'No se pudo cancelar la reserva.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[reservations/cancel-unverified] error inesperado:', err);
    return NextResponse.json({ ok: false, message: 'Ocurrió un error inesperado.' }, { status: 500 });
  }
}
