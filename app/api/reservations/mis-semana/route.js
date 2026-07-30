import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@udea\.edu\.co$/;

// Lunes a domingo de la semana que contiene "hoy" (hora de Colombia).
function getCurrentWeekDates() {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const anchor = new Date(`${todayStr}T00:00:00-05:00`);
  const dayNum = anchor.getUTCDay(); // 0 = domingo, 1 = lunes, ... 6 = sábado
  const diffToMonday = dayNum === 0 ? -6 : 1 - dayNum;
  const monday = new Date(anchor.getTime() + diffToMonday * 24 * 60 * 60 * 1000);

  const dates = [];
  for (let i = 0; i < 7; i += 1) {
    const dt = new Date(monday.getTime() + i * 24 * 60 * 60 * 1000);
    dates.push(dt.toISOString().slice(0, 10));
  }
  return dates;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json({ ok: false, message: 'Solicitud inválida.' }, { status: 400 });
  }

  const email = (body?.email || '').trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json(
      { ok: false, message: 'Usa un correo institucional con dominio @udea.edu.co.' },
      { status: 400 }
    );
  }

  try {
    const { data: user, error: userError } = await supabaseAdmin
      .from('app_users')
      .select('id, name')
      .eq('email', email)
      .maybeSingle();

    if (userError) {
      console.error('[reservations/mis-semana] error buscando usuario:', userError);
      return NextResponse.json({ ok: false, message: 'No se pudo verificar tu correo. Intenta de nuevo.' }, { status: 500 });
    }

    if (!user) {
      return NextResponse.json({ ok: true, name: null, weekStart: null, weekEnd: null, reservations: [] });
    }

    const weekDates = getCurrentWeekDates();

    const { data: reservations, error: resError } = await supabaseAdmin
      .from('reservations')
      .select('date, start_time, end_time, status, clase, recurring_template_id, rooms ( name, type )')
      .eq('user_id', user.id)
      .in('date', weekDates)
      .not('status', 'in', '(cancelada,rechazada)')
      .order('date', { ascending: true })
      .order('start_time', { ascending: true });

    if (resError) {
      console.error('[reservations/mis-semana] error buscando reservas:', resError);
      return NextResponse.json({ ok: false, message: 'No se pudo buscar tus reservas. Intenta de nuevo.' }, { status: 500 });
    }

    const formatted = (reservations || []).map((r) => ({
      date: r.date,
      startTime: (r.start_time || '').slice(0, 5),
      endTime: (r.end_time || '').slice(0, 5),
      status: r.status,
      clase: r.clase,
      isRecurring: !!r.recurring_template_id,
      roomName: r.rooms?.name || null,
      roomType: r.rooms?.type || null,
    }));

    return NextResponse.json({
      ok: true,
      name: user.name,
      weekStart: weekDates[0],
      weekEnd: weekDates[6],
      reservations: formatted,
    });
  } catch (err) {
    console.error('[reservations/mis-semana] error inesperado:', err);
    return NextResponse.json({ ok: false, message: 'Ocurrió un error inesperado. Intenta de nuevo.' }, { status: 500 });
  }
}