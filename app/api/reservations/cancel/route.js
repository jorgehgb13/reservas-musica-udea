// Ruta de servidor: cancela una reserva (usada para "el correo no existe /
// simular rebote", y más adelante para la autocancelación del estudiante).

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
    return NextResponse.json({ ok: false, message: 'Falta el id de la reserva.' }, { status: 400 });
  }

  try {
    const { error } = await supabaseAdmin
      .from('reservations')
      .update({ status: 'cancelada' })
      .eq('id', reservationId);

    if (error) {
      console.error('[reservations/cancel] error:', error);
      return NextResponse.json({ ok: false, message: 'No se pudo cancelar.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[reservations/cancel] error inesperado:', err);
    return NextResponse.json({ ok: false, message: 'Ocurrió un error inesperado.' }, { status: 500 });
  }
}
