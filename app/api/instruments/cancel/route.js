// Ruta de servidor: cancela un préstamo de instrumento (usada para
// "el correo no existe / simular rebote", igual que con las reservas de espacio).

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
    return NextResponse.json({ ok: false, message: 'Falta el id del préstamo.' }, { status: 400 });
  }

  try {
    const { error } = await supabaseAdmin
      .from('instrument_reservations')
      .update({ status: 'cancelada' })
      .eq('id', reservationId);

    if (error) {
      console.error('[instruments/cancel] error:', error);
      return NextResponse.json({ ok: false, message: 'No se pudo cancelar.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[instruments/cancel] error inesperado:', err);
    return NextResponse.json({ ok: false, message: 'Ocurrió un error inesperado.' }, { status: 500 });
  }
}
