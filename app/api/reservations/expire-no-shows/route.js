// Ruta de servidor: expone expireNoShowReservations para que la puedan
// llamar páginas del navegador (que no tienen acceso directo a la clave
// de servicio). Se llama de forma "silenciosa" antes de mostrar
// disponibilidad o antes de crear una reserva.

import { NextResponse } from 'next/server';
import { expireNoShowReservations } from '../../../../lib/expireNoShows';

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch (err) {
    body = {};
  }

  const result = await expireNoShowReservations(body?.roomId || null);
  return NextResponse.json({ ok: true, ...result });
}
