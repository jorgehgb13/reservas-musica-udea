import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

// Esta ruta no hace nada visible para los usuarios — solo hace una consulta
// mínima y sin costo a la base de datos (contar cuántos espacios hay) para
// que Supabase la registre como "actividad real" y no pause el proyecto por
// inactividad. Vercel la visita solo, una vez al día, gracias a vercel.json.
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  }

  const { error } = await supabaseAdmin.from('rooms').select('id').limit(1);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, checkedAt: new Date().toISOString() });
}