'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';

const TYPE_META = {
  cubiculo: { label: 'Cubículo', icon: '🎧', needsApproval: false },
  aula: { label: 'Aula', icon: '🎹', needsApproval: true },
};

// Cubículos que, por excepción, también necesitan aprobación del
// administrador (igual que un aula), aunque su tipo sea "cubiculo".
const ROOM_CODES_REQUIRE_APPROVAL = ['25307', '25303'];

// Avisos especiales que se muestran antes de poder enviar la reserva,
// según el espacio elegido (uso exclusivo de un área específica).
const ROOM_CODE_WARNINGS = {
  '25205': 'Tenga en cuenta que esta aula es de uso exclusivo del área de Piano.',
  '25206': 'Tenga en cuenta que esta aula es de uso exclusivo del área de Piano.',
  '25307': 'Tenga en cuenta que este espacio es para uso exclusivo del área de percusión.',
  '25303': 'Tenga en cuenta que este espacio es para uso exclusivo del área de percusión.',
};

function roomNeedsApproval(type, room) {
  return !!TYPE_META[type]?.needsApproval || ROOM_CODES_REQUIRE_APPROVAL.includes(room?.code);
}

const OPERATING_START = 6;
const OPERATING_END = 20;

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function addMinutes(time, mins) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${pad(hh)}:${pad(mm)}`;
}

function timeOptions(durationMin) {
  const opts = [];
  const lastStart = OPERATING_END * 60 - durationMin;
  for (let m = OPERATING_START * 60; m <= lastStart; m += 30) {
    opts.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  }
  return opts;
}

// Colombia siempre está en UTC-5 (no tiene horario de verano), así que
// podemos calcular la fecha/hora de Bogotá restando 5 horas al UTC actual.
function nowBogota() {
  const now = new Date();
  const shifted = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return {
    dateStr: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

// Igual que timeOptions, pero si la fecha elegida es hoy, quita los
// horarios que ya pasaron (para no confundir ni dejar enviar algo vencido).
function timeOptionsForDate(dateStr, durationMin) {
  const opts = timeOptions(durationMin);
  const { dateStr: todayBogota, minutes: nowMin } = nowBogota();
  if (dateStr !== todayBogota) return opts;
  const nextSlot = Math.ceil(nowMin / 30) * 30;
  return opts.filter((t) => minsOfDay(t) >= nextSlot);
}

function minsOfDay(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function todayStr() {
  return nowBogota().dateStr;
}

export default function Reservar() {
  const [step, setStep] = useState(1);

  // Paso 1
  const [name, setName] = useState('');
  const [email, setEmail] = useState('@udea.edu.co');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState(null);

  // Paso 2 y 3
  const [type, setType] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [roomId, setRoomId] = useState(null);
  const [date, setDate] = useState(todayStr());
  const [duration, setDuration] = useState(60);
  const [start, setStart] = useState('08:00');
  const [busy, setBusy] = useState([]);
  const [loadingAvailability, setLoadingAvailability] = useState(false);

  // Paso 4 y 5
  const [reservationId, setReservationId] = useState(null);
  const [codeInput, setCodeInput] = useState('');
  const [verifyError, setVerifyError] = useState(null);
  const [bounced, setBounced] = useState(false);
  const [finalStatus, setFinalStatus] = useState(null);

  // Cada vez que cambia la fecha o la duración, si la hora elegida ya no es
  // válida (por ejemplo, quedó en el pasado si la fecha es hoy), la
  // ajustamos a la próxima franja disponible.
  useEffect(() => {
    const opts = timeOptionsForDate(date, duration);
    if (opts.length === 0) return;
    if (!opts.includes(start)) setStart(opts[0]);
  }, [date, duration]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- PASO 1 ----------
  async function handleSubmitStep1(e) {
    e.preventDefault();
    setError(null);

    if (!accepted) {
      setError('Debes confirmar que eres estudiante activo y aceptar el reglamento.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/reservations/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message || 'No se pudo continuar. Intenta de nuevo.');
        setLoading(false);
        return;
      }
      setUserId(data.userId);
      setStep(2);
    } catch (err) {
      setError(`Error de conexión: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ---------- PASO 2: elegir tipo ----------
  async function selectType(t) {
    setType(t);
    setError(null);
    setLoading(true);
    try {
      const typesToFetch = t === 'aula' ? ['aula', 'auditorio'] : [t];
      const { data, error: fetchError } = await supabase
        .from('rooms')
        .select('id, code, name, type')
        .in('type', typesToFetch)
        .order('name', { ascending: true });

      if (fetchError) {
        setError(`No se pudo cargar la lista de espacios: ${fetchError.message}`);
        setLoading(false);
        return;
      }
      setRooms(data || []);
      setRoomId(data && data.length ? data[0].id : null);
      setStep(3);
    } catch (err) {
      setError(`Error de conexión: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ---------- PASO 3: cargar disponibilidad real cada vez que cambian sala/fecha ----------
  useEffect(() => {
    if (step !== 3 || !roomId || !date) return;
    let cancelled = false;

    async function loadAvailability() {
      setLoadingAvailability(true);
      try {
        await fetch('/api/reservations/expire-no-shows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId }),
        });
      } catch (err) {
        // si esta llamada falla no pasa nada grave, solo se ve un poco
        // menos al día — seguimos con la consulta de disponibilidad igual.
      }

      const { data, error: fetchError } = await supabase
        .from('reservations')
        .select('start_time, end_time, status')
        .eq('room_id', roomId)
        .eq('date', date)
        .in('status', ['confirmada', 'pendiente', 'sin_verificar']);

      if (cancelled) return;
      if (fetchError) {
        setError(`No se pudo cargar la disponibilidad: ${fetchError.message}`);
      } else {
        setBusy(data || []);
      }
      setLoadingAvailability(false);
    }

    loadAvailability();
    return () => {
      cancelled = true;
    };
  }, [step, roomId, date]);

  const end = start ? addMinutes(start, duration) : null;

  // ---------- PASO 4: crear la reserva real ----------
  async function handleCreateReservation() {
    setError(null);

    const { dateStr: todayBogota, minutes: nowMin } = nowBogota();
    if (date === todayBogota && minsOfDay(start) < nowMin) {
      setError('Ese horario ya pasó. Elige un horario que todavía no haya empezado.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/reservations/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, roomId, roomType: type, date, start, end }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message || 'No se pudo crear la reserva. Intenta de nuevo.');
        setLoading(false);
        return;
      }
      setReservationId(data.reservationId);
      setCodeInput('');
      setVerifyError(null);
      setBounced(false);
      setStep(5);
    } catch (err) {
      setError(`Error de conexión: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ---------- PASO 5: verificar el código ----------
  async function handleVerifyCode() {
    setVerifyError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/reservations/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservationId, code: codeInput.trim() }),
      });
      const data = await res.json();
      if (!data.ok) {
        setVerifyError(data.message || 'No se pudo verificar el código.');
        setLoading(false);
        return;
      }
      setFinalStatus(data.status);
      setStep(6);
    } catch (err) {
      setVerifyError(`Error de conexión: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSimulateBounce() {
    setLoading(true);
    try {
      await fetch('/api/reservations/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservationId }),
      });
    } catch (err) {
      // aunque falle el aviso al servidor, igual mostramos la pantalla de no confirmado
    } finally {
      setBounced(true);
      setLoading(false);
    }
  }

  // ================= RENDER =================

  if (step === 1) {
    return (
      <main style={{ maxWidth: 380, margin: '60px auto 0', padding: '0 16px' }}>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 20, marginBottom: 4 }}>Tus datos</h1>
        <p style={{ color: '#5B6B60', fontSize: 13, marginBottom: 16 }}>
          Solo necesitamos tu nombre y correo institucional.
        </p>

        <div style={{ background: '#FBF1D6', border: '1px solid #eadca0', color: '#6b5510', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
          Este servicio es exclusivo para estudiantes y profesores activos de la Universidad de Antioquia.
        </div>

        {error && (
          <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmitStep1}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: '#5B6B60', display: 'block', marginBottom: 4 }}>Nombre completo</label>
            <input type="text" required value={name} onChange={(e) => setName(e.target.value)}
              style={{ width: '100%', padding: 10, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: '#5B6B60', display: 'block', marginBottom: 4 }}>Correo institucional</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              onFocus={(e) => { if (e.target.value === '@udea.edu.co') e.target.setSelectionRange(0, 0); }}
              style={{ width: '100%', padding: 10, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: '#5B6B60', marginBottom: 18 }}>
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} style={{ marginTop: 2 }} />
            <span>Declaro que soy estudiante activo de la Universidad de Antioquia y acepto el reglamento de uso de los espacios.</span>
          </label>
          <button type="submit" disabled={loading}
            style={{ width: '100%', padding: 12, background: '#0B6E4F', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Verificando…' : 'Continuar'}
          </button>
        </form>
      </main>
    );
  }

  if (step === 2) {
    return (
      <main style={{ maxWidth: 420, margin: '60px auto 0', padding: '0 16px' }}>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 20, marginBottom: 4 }}>Tipo de espacio</h1>
        <p style={{ color: '#5B6B60', fontSize: 13, marginBottom: 16 }}>
          ¿Qué necesitas, {name.split(' ')[0]}?
        </p>
        {error && (
          <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
            {error}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {Object.keys(TYPE_META).map((t) => (
            <button
              key={t}
              onClick={() => selectType(t)}
              disabled={loading}
              style={{ border: '1px solid #DBDCCF', borderRadius: 12, padding: 16, textAlign: 'center', background: '#fff', cursor: loading ? 'default' : 'pointer' }}
            >
              <div style={{ fontSize: 26, marginBottom: 6 }}>{TYPE_META[t].icon}</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{TYPE_META[t].label}</div>
            </button>
          ))}
        </div>
        <button onClick={() => setStep(1)} style={{ marginTop: 16, background: 'transparent', border: 'none', color: '#5B6B60', fontSize: 12.5, cursor: 'pointer' }}>
          Atrás
        </button>
      </main>
    );
  }

  if (step === 3) {
    const dayStartMin = OPERATING_START * 60;
    const daySpan = (OPERATING_END - OPERATING_START) * 60;
    const currentRoom = rooms.find((r) => r.id === roomId);

    return (
      <main style={{ maxWidth: 420, margin: '40px auto 0', padding: '0 16px' }}>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 20, marginBottom: 4 }}>
          {TYPE_META[type]?.label}
        </h1>
        {roomNeedsApproval(type, currentRoom) && (
          <div style={{ background: '#FBF1D6', border: '1px solid #eadca0', color: '#6b5510', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 14 }}>
            Tu reserva quedará en firme solo si el administrador la autoriza.
          </div>
        )}
        {ROOM_CODE_WARNINGS[currentRoom?.code] && (
          <div style={{ background: '#EAE4F5', border: '1px solid #d6c9ef', color: '#5B3FA0', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 14 }}>
            {ROOM_CODE_WARNINGS[currentRoom.code]}
          </div>
        )}
        {error && (
          <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
            {error}
          </div>
        )}

        <label style={{ fontSize: 12, color: '#5B6B60', display: 'block', marginBottom: 4 }}>Elige el espacio</label>
        <select value={roomId || ''} onChange={(e) => setRoomId(e.target.value)}
          style={{ width: '100%', padding: 10, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 14, marginBottom: 12, boxSizing: 'border-box' }}>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>

        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, color: '#5B6B60', display: 'block', marginBottom: 4 }}>Fecha</label>
            <input type="date" min={todayStr()} value={date} onChange={(e) => setDate(e.target.value)}
              style={{ width: '100%', padding: 10, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, color: '#5B6B60', display: 'block', marginBottom: 4 }}>Duración</label>
            <select value={duration} onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              setDuration(val);
              const opts = timeOptionsForDate(date, val);
              if (!opts.includes(start)) setStart(opts[0] || start);
            }} style={{ width: '100%', padding: 10, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}>
              <option value={60}>1 hora</option>
              <option value={90}>1.5 horas</option>
              <option value={120}>2 horas (máx.)</option>
            </select>
          </div>
        </div>

        <label style={{ fontSize: 12, color: '#5B6B60', display: 'block', marginBottom: 4 }}>Hora de inicio</label>
        {timeOptionsForDate(date, duration).length === 0 ? (
          <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            Ya no queda ningún horario disponible hoy para esta duración. Elige otro día u otra duración.
          </div>
        ) : (
          <select value={start} onChange={(e) => setStart(e.target.value)}
            style={{ width: '100%', padding: 10, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 14, marginBottom: 16, boxSizing: 'border-box' }}>
            {timeOptionsForDate(date, duration).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}

        <div style={{ fontSize: 12, color: '#5B6B60', fontWeight: 500, marginBottom: 6 }}>
          Disponibilidad {loadingAvailability ? '· cargando…' : ''}
        </div>
        <div style={{ position: 'relative', height: 34, background: '#EDEFE6', borderRadius: 6, marginBottom: 10 }}>
          {busy.map((r, i) => {
            const s = minsOfDay(r.start_time.slice(0, 5));
            const en = minsOfDay(r.end_time.slice(0, 5));
            const left = ((s - dayStartMin) / daySpan) * 100;
            const width = ((en - s) / daySpan) * 100;
            const color = r.status === 'confirmada' ? '#A23E33' : '#C99B2E';
            return (
              <div key={i} title={`${r.start_time.slice(0, 5)}-${r.end_time.slice(0, 5)}`}
                style={{ position: 'absolute', top: 0, bottom: 0, left: `${left}%`, width: `${width}%`, background: color, borderRadius: 5 }} />
            );
          })}
          {start && end && (
            <div style={{
              position: 'absolute', top: 0, bottom: 0,
              left: `${((minsOfDay(start) - dayStartMin) / daySpan) * 100}%`,
              width: `${((minsOfDay(end) - minsOfDay(start)) / daySpan) * 100}%`,
              background: '#0B6E4F', opacity: 0.5, border: '2px solid #0B6E4F', borderRadius: 5,
            }} />
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#5B6B60', marginBottom: 20 }}>
          <span><span style={{ display: 'inline-block', width: 9, height: 9, background: '#A23E33', borderRadius: 2, marginRight: 4 }} />Ocupado</span>
          <span><span style={{ display: 'inline-block', width: 9, height: 9, background: '#C99B2E', borderRadius: 2, marginRight: 4 }} />Pendiente</span>
          <span><span style={{ display: 'inline-block', width: 9, height: 9, border: '2px solid #0B6E4F', borderRadius: 2, marginRight: 4 }} />Tu selección</span>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setStep(2)} style={{ background: 'transparent', border: 'none', color: '#5B6B60', fontSize: 12.5, cursor: 'pointer' }}>
            Atrás
          </button>
          <button onClick={() => setStep(4)} disabled={timeOptionsForDate(date, duration).length === 0}
            style={{
              flex: 1, padding: 12, background: '#0B6E4F', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
              cursor: timeOptionsForDate(date, duration).length === 0 ? 'not-allowed' : 'pointer',
              opacity: timeOptionsForDate(date, duration).length === 0 ? 0.6 : 1,
            }}>
            Revisar y confirmar
          </button>
        </div>
      </main>
    );
  }

  if (step === 4) {
    const selectedRoom = rooms.find((r) => r.id === roomId);
    return (
      <main style={{ maxWidth: 400, margin: '60px auto 0', padding: '0 16px' }}>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 20, marginBottom: 12 }}>Confirma tu reserva</h1>
        <table style={{ width: '100%', marginBottom: 14, fontSize: 14 }}>
          <tbody>
            <tr><td style={{ color: '#5B6B60', padding: '4px 0' }}>Espacio</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{selectedRoom?.name}</td></tr>
            <tr><td style={{ color: '#5B6B60', padding: '4px 0' }}>Fecha</td><td style={{ textAlign: 'right' }}>{date}</td></tr>
            <tr><td style={{ color: '#5B6B60', padding: '4px 0' }}>Horario</td><td style={{ textAlign: 'right' }}>{start} – {end}</td></tr>
            <tr><td style={{ color: '#5B6B60', padding: '4px 0' }}>Solicitante</td><td style={{ textAlign: 'right' }}>{name}</td></tr>
          </tbody>
        </table>

        {error && (
          <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
            {error}
          </div>
        )}
        {roomNeedsApproval(type, selectedRoom) && (
          <div style={{ background: '#FBF1D6', border: '1px solid #eadca0', color: '#6b5510', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
            Su reserva quedará en firme solo si el administrador la autoriza.
          </div>
        )}
        {ROOM_CODE_WARNINGS[selectedRoom?.code] && (
          <div style={{ background: '#EAE4F5', border: '1px solid #d6c9ef', color: '#5B3FA0', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
            {ROOM_CODE_WARNINGS[selectedRoom.code]}
          </div>
        )}
        <div style={{ background: '#E4F0EA', border: '1px solid #bfe0cf', color: '#084F39', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 18 }}>
          La reserva solo queda en firme si tu correo está activo y confirmas el código que te enviaremos.
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setStep(3)} disabled={loading} style={{ background: 'transparent', border: 'none', color: '#5B6B60', fontSize: 12.5, cursor: 'pointer' }}>
            Atrás
          </button>
          <button onClick={handleCreateReservation} disabled={loading}
            style={{ flex: 1, padding: 12, background: '#0B6E4F', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Guardando…' : roomNeedsApproval(type, selectedRoom) ? 'Enviar solicitud' : 'Confirmar reserva'}
          </button>
        </div>
      </main>
    );
  }

  if (step === 5) {
    if (bounced) {
      return (
        <main style={{ maxWidth: 400, margin: '60px auto 0', padding: '0 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 34 }}>✉️❌</div>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 19, margin: '8px 0 6px' }}>Reserva no confirmada</h1>
          <p style={{ color: '#5B6B60', fontSize: 13, marginBottom: 18 }}>
            Como el correo no existe (o nunca llegó el código), la reserva no quedó en firme y el espacio ya está
            libre nuevamente.
          </p>
          <a href="/" style={{ display: 'inline-block', padding: 12, background: '#0B6E4F', color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
            Volver al inicio
          </a>
        </main>
      );
    }

    return (
      <main style={{ maxWidth: 400, margin: '60px auto 0', padding: '0 16px' }}>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 20, marginBottom: 4 }}>Verifica tu correo</h1>
        <p style={{ color: '#5B6B60', fontSize: 13, marginBottom: 16 }}>
          Te enviamos un código de 6 dígitos a <strong>{email}</strong>. Tu reserva no queda en firme hasta que lo
          confirmes aquí. Tienes 10 minutos.
        </p>
        <div style={{ background: '#FBF1D6', border: '1px solid #eadca0', color: '#6b5510', padding: 10, borderRadius: 8, fontSize: 12, marginBottom: 16 }}>
          Si no lo ves en unos minutos, revisa tu carpeta de spam o correo no deseado — es probable que llegue ahí.
        </div>

        {verifyError && (
          <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
            {verifyError}
          </div>
        )}

        <input
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value)}
          maxLength={6}
          placeholder="000000"
          style={{ width: '100%', padding: 10, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 18, textAlign: 'center', letterSpacing: 4, marginBottom: 12, boxSizing: 'border-box', fontFamily: 'monospace' }}
        />
        <button onClick={handleVerifyCode} disabled={loading}
          style={{ width: '100%', padding: 12, background: '#0B6E4F', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, marginBottom: 10, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Verificando…' : 'Verificar y confirmar reserva'}
        </button>
        <button onClick={handleSimulateBounce} disabled={loading}
          style={{ width: '100%', padding: 8, background: 'transparent', border: 'none', color: '#5B6B60', fontSize: 12.5, cursor: loading ? 'default' : 'pointer', textDecoration: 'underline' }}>
          El correo no existe / no me llegó nada (simular rebote)
        </button>
      </main>
    );
  }

  // step === 6: éxito final
  return (
    <main style={{ maxWidth: 400, margin: '60px auto 0', padding: '0 16px', textAlign: 'center' }}>
      <div style={{ fontSize: 34 }}>✅</div>
      <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 19, margin: '8px 0 6px' }}>
        {finalStatus === 'pendiente' ? 'Solicitud enviada' : 'Reserva confirmada'}
      </h1>
      <p style={{ color: '#5B6B60', fontSize: 13, marginBottom: 18 }}>
        {finalStatus === 'pendiente'
          ? 'Tu solicitud quedó pendiente de autorización del administrador.'
          : 'Tu reserva quedó confirmada.'}
      </p>
      <a href="/" style={{ display: 'inline-block', padding: 12, background: '#0B6E4F', color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
        Volver al inicio
      </a>
    </main>
  );
}
