// Ruta de servidor: confirma el código de verificación de 6 dígitos del
// préstamo de instrumento. Si coincide y no ha expirado, pasa a "pendiente"
// — todos los préstamos de instrumentos requieren aprobación del
// administrador antes de quedar confirmados.

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
      .from('instrument_reservations')
      .select('id, status, verification_code, verification_expires_at')
      .eq('id', reservationId)
      .maybeSingle();

    if (findError) {
      console.error('[instruments/verify] error buscando:', findError);
      return NextResponse.json({ ok: false, message: 'No se pudo verificar el código. Intenta de nuevo.' }, { status: 500 });
    }
    if (!res) {
      return NextResponse.json({ ok: false, message: 'No se encontró el préstamo.' }, { status: 404 });
    }
    if (res.status !== 'sin_verificar') {
      return NextResponse.json({ ok: false, message: 'Este préstamo ya no está pendiente de verificación.' }, { status: 409 });
    }
    if (new Date(res.verification_expires_at) < new Date()) {
      return NextResponse.json({ ok: false, message: 'El código expiró. Tu préstamo ya no se pudo confirmar.' }, { status: 410 });
    }
    if (res.verification_code !== code) {
      return NextResponse.json({ ok: false, message: 'El código no coincide. Verifica e intenta de nuevo.' }, { status: 400 });
    }

    const { error: updateError } = await supabaseAdmin
      .from('instrument_reservations')
      .update({ status: 'pendiente' })
      .eq('id', reservationId);

    if (updateError) {
      console.error('[instruments/verify] error actualizando:', updateError);
      return NextResponse.json({ ok: false, message: 'No se pudo confirmar el préstamo. Intenta de nuevo.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[instruments/verify] error inesperado:', err);
    return NextResponse.json({ ok: false, message: 'Ocurrió un error inesperado.' }, { status: 500 });
  }
}