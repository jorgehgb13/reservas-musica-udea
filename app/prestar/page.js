'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';

const OPERATING_START = 6;
const OPERATING_END = 20;
const MAX_DURATION_MIN = 240; // 4 horas

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

export default function PrestarInstrumento() {
  const [step, setStep] = useState(1);

  // Paso 1
  const [name, setName] = useState('');
  const [email, setEmail] = useState('@udea.edu.co');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState(null);

  // Paso 2
  const [instruments, setInstruments] = useState([]);
  const [instrumentId, setInstrumentId] = useState(null);
  const [date, setDate] = useState(todayStr());
  const [duration, setDuration] = useState(60);
  const [start, setStart] = useState('08:00');
  const [busy, setBusy] = useState([]);
  const [loadingAvailability, setLoadingAvailability] = useState(false);

  // Paso 3 y 4
  const [reservationId, setReservationId] = useState(null);
  const [codeInput, setCodeInput] = useState('');
  const [verifyError, setVerifyError] = useState(null);
  const [bounced, setBounced] = useState(false);

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
      const res = await fetch('/api/instruments/start', {
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

      const { data: instrumentsData, error: fetchError } = await supabase
        .from('instruments')
        .select('id, name, category, inventory_number')
        .eq('active', true)
        .order('name', { ascending: true });

      if (fetchError) {
        setError(`No se pudo cargar la lista de instrumentos: ${fetchError.message}`);
        setLoading(false);
        return;
      }
      if (!instrumentsData || instrumentsData.length === 0) {
        setError('No hay instrumentos disponibles por ahora.');
        setLoading(false);
        return;
      }
      setInstruments(instrumentsData);
      setInstrumentId(instrumentsData[0].id);
      setStep(2);
    } catch (err) {
      setError(`Error de conexión: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ---------- PASO 2: disponibilidad real cada vez que cambia instrumento/fecha ----------
  useEffect(() => {
    if (step !== 2 || !instrumentId || !date) return;
    let cancelled = false;

    async function loadAvailability() {
      setLoadingAvailability(true);
      const { data, error: fetchError } = await supabase
        .from('instrument_reservations')
        .select('start_time, end_time, status')
        .eq('instrument_id', instrumentId)
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
  }, [step, instrumentId, date]);

  // Cada vez que cambia la fecha o la duración, si la hora elegida ya no es
  // válida (por ejemplo, quedó en el pasado si la fecha es hoy), la
  // ajustamos a la próxima franja disponible.
  useEffect(() => {
    const opts = timeOptionsForDate(date, duration);
    if (opts.length === 0) return;
    if (!opts.includes(start)) setStart(opts[0]);
  }, [date, duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const end = start ? addMinutes(start, duration) : null;
  const hasConflict = start && end
    ? busy.some((r) => {
        const s = minsOfDay(r.start_time.slice(0, 5));
        const e = minsOfDay(r.end_time.slice(0, 5));
        return minsOfDay(start) < e && s < minsOfDay(end);
      })
    : false;

  // ---------- PASO 3: crear el préstamo real ----------
  async function handleCreateLoan() {
    setError(null);

    const { dateStr: todayBogota, minutes: nowMin } = nowBogota();
    if (date === todayBogota && minsOfDay(start) < nowMin) {
      setError('Ese horario ya pasó. Elige un horario que todavía no haya empezado.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/instruments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, instrumentId, date, start, end }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message || 'No se pudo crear el préstamo. Intenta de nuevo.');
        setLoading(false);
        return;
      }
      setReservationId(data.reservationId);
      setCodeInput('');
      setVerifyError(null);
      setBounced(false);
      setStep(4);
    } catch (err) {
      setError(`Error de conexión: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ---------- PASO 4: verificar el código ----------
  async function handleVerifyCode() {
    setVerifyError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/instruments/verify', {
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
      setStep(5);
    } catch (err) {
      setVerifyError(`Error de conexión: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSimulateBounce() {
    setLoading(true);
    try {
      await fetch('/api/instruments/cancel', {
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
          Los préstamos duran máximo 4 horas y son independientes de tus reservas de espacio.
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
            <span>Declaro que soy estudiante o profesor activo de la Universidad de Antioquia y acepto el reglamento de préstamo de instrumentos.</span>
          </label>
          <button type="submit" disabled={loading}
            style={{ width: '100%', padding: 12, background: '#0B6E4F', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Verificando…' : 'Continuar'}
          </button>
        </form>

        <a href="/" style={{ display: 'block', textAlign: 'center', marginTop: 16, fontSize: 13, color: '#5B6B60' }}>
          ← Volver al inicio
        </a>
      </main>
    );
  }

  if (step === 2) {
    const dayStartMin = OPERATING_START * 60;
    const daySpan = (OPERATING_END - OPERATING_START) * 60;

    return (
      <main style={{ maxWidth: 420, margin: '40px auto 0', padding: '0 16px' }}>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 20, marginBottom: 4 }}>Elige el instrumento</h1>
        <p style={{ color: '#5B6B60', fontSize: 13, marginBottom: 16 }}>
          Estos son los instrumentos disponibles ahora mismo.
        </p>
        {error && (
          <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
            {error}
          </div>
        )}

        <label style={{ fontSize: 12, color: '#5B6B60', display: 'block', marginBottom: 4 }}>Instrumento</label>
        <select value={instrumentId || ''} onChange={(e) => setInstrumentId(e.target.value)}
          style={{ width: '100%', padding: 10, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 14, marginBottom: 12, boxSizing: 'border-box' }}>
          {instruments.map((i) => (
            <option key={i.id} value={i.id}>{i.name} — Inv. {i.inventory_number}</option>
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
              if (!opts.includes(start)) setStart(opts[0]);
            }} style={{ width: '100%', padding: 10, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}>
              <option value={60}>1 hora</option>
              <option value={120}>2 horas</option>
              <option value={180}>3 horas</option>
              <option value={240}>4 horas (máx.)</option>
            </select>
          </div>
        </div>

        <label style={{ fontSize: 12, color: '#5B6B60', display: 'block', marginBottom: 4 }}>Hora de inicio</label>
        <select value={start} onChange={(e) => setStart(e.target.value)}
          style={{ width: '100%', padding: 10, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 14, marginBottom: 16, boxSizing: 'border-box' }}>
          {timeOptionsForDate(date, duration).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <div style={{ fontSize: 12, color: '#5B6B60', fontWeight: 500, marginBottom: 6 }}>
          Disponibilidad {loadingAvailability ? '· cargando…' : ''}
        </div>
        <div style={{ position: 'relative', height: 34, background: '#EDEFE6', borderRadius: 6, marginBottom: 10 }}>
          {busy.map((r, i) => {
            const s = minsOfDay(r.start_time.slice(0, 5));
            const en = minsOfDay(r.end_time.slice(0, 5));
            const left = ((s - dayStartMin) / daySpan) * 100;
            const width = ((en - s) / daySpan) * 100;
            return (
              <div key={i} title={`${r.start_time.slice(0, 5)}-${r.end_time.slice(0, 5)}`}
                style={{ position: 'absolute', top: 0, bottom: 0, left: `${left}%`, width: `${width}%`, background: '#A23E33', borderRadius: 5 }} />
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
          <span><span style={{ display: 'inline-block', width: 9, height: 9, border: '2px solid #0B6E4F', borderRadius: 2, marginRight: 4 }} />Tu selección</span>
        </div>

        {hasConflict && (
          <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            ⚠️ Este instrumento ya está prestado en ese horario. Elige otra hora, fecha o instrumento.
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setStep(1)} style={{ background: 'transparent', border: 'none', color: '#5B6B60', fontSize: 12.5, cursor: 'pointer' }}>
            Atrás
          </button>
          <button onClick={() => setStep(3)} disabled={hasConflict}
            style={{
              flex: 1, padding: 12, background: hasConflict ? '#B9C4BB' : '#0B6E4F', color: '#fff', border: 'none',
              borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: hasConflict ? 'not-allowed' : 'pointer',
            }}>
            Revisar y confirmar
          </button>
        </div>
      </main>
    );
  }

  if (step === 3) {
    const selectedInstrument = instruments.find((i) => i.id === instrumentId);
    return (
      <main style={{ maxWidth: 400, margin: '60px auto 0', padding: '0 16px' }}>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 20, marginBottom: 12 }}>Confirma tu préstamo</h1>
        <table style={{ width: '100%', marginBottom: 14, fontSize: 14 }}>
          <tbody>
            <tr><td style={{ color: '#5B6B60', padding: '4px 0' }}>Instrumento</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{selectedInstrument?.name} (Inv. {selectedInstrument?.inventory_number})</td></tr>
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
        <div style={{ background: '#E4F0EA', border: '1px solid #bfe0cf', color: '#084F39', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 18 }}>
          El préstamo solo queda registrado si tu correo está activo y confirmas el código que te enviaremos. Luego, un administrador debe aprobarlo antes de que quede en firme.
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setStep(2)} disabled={loading} style={{ background: 'transparent', border: 'none', color: '#5B6B60', fontSize: 12.5, cursor: 'pointer' }}>
            Atrás
          </button>
          <button onClick={handleCreateLoan} disabled={loading}
            style={{ flex: 1, padding: 12, background: '#0B6E4F', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Guardando…' : 'Confirmar préstamo'}
          </button>
        </div>
      </main>
    );
  }

  if (step === 4) {
    if (bounced) {
      return (
        <main style={{ maxWidth: 400, margin: '60px auto 0', padding: '0 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 34 }}>✉️❌</div>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 19, margin: '8px 0 6px' }}>Préstamo no confirmado</h1>
          <p style={{ color: '#5B6B60', fontSize: 13, marginBottom: 18 }}>
            Como el correo no existe (o nunca llegó el código), el préstamo no quedó en firme y el instrumento ya está
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
          Te enviamos un código de 6 dígitos a <strong>{email}</strong>. Tu préstamo no queda en firme hasta que lo
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
          {loading ? 'Verificando…' : 'Verificar y confirmar préstamo'}
        </button>
        <button onClick={handleSimulateBounce} disabled={loading}
          style={{ width: '100%', padding: 8, background: 'transparent', border: 'none', color: '#5B6B60', fontSize: 12.5, cursor: loading ? 'default' : 'pointer', textDecoration: 'underline' }}>
          El correo no existe / no me llegó nada (simular rebote)
        </button>
      </main>
    );
  }

  // step === 5: éxito final
  return (
    <main style={{ maxWidth: 400, margin: '60px auto 0', padding: '0 16px', textAlign: 'center' }}>
      <div style={{ fontSize: 34 }}>⏳</div>
      <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 19, margin: '8px 0 6px' }}>Préstamo registrado — pendiente de aprobación</h1>
      <p style={{ color: '#5B6B60', fontSize: 13, marginBottom: 18 }}>
        Tu correo quedó verificado y tu préstamo está pendiente de aprobación por parte del administrador. Te
        recomendamos confirmar antes de ir a recogerlo.
      </p>
      <a href="/" style={{ display: 'inline-block', padding: 12, background: '#0B6E4F', color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
        Volver al inicio
      </a>
    </main>
  );
}