'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';

const TYPE_META = {
  cubiculo: { label: 'Cubículo', icon: '🎧', needsApproval: false },
  aula: { label: 'Aula', icon: '🎹', needsApproval: true },
  auditorio: { label: 'Auditorio', icon: '🎭', needsApproval: true },
};

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

function minsOfDay(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function Reservar() {
  const [step, setStep] = useState(1);

  // Paso 1
  const [name, setName] = useState('');
  const [email, setEmail] = useState('@udea.edu.co');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // Paso 2 y 3
  const [type, setType] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [roomId, setRoomId] = useState(null);
  const [date, setDate] = useState(todayStr());
  const [duration, setDuration] = useState(60);
  const [start, setStart] = useState('08:00');
  const [busy, setBusy] = useState([]);
  const [loadingAvailability, setLoadingAvailability] = useState(false);

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
      const { data, error: fetchError } = await supabase
        .from('rooms')
        .select('id, code, name, type')
        .eq('type', t)
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

  // ---------- RENDER ----------
  if (step === 1) {
    return (
      <main style={{ maxWidth: 380, margin: '60px auto 0', padding: '0 16px' }}>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 20, marginBottom: 4 }}>Tus datos</h1>
        <p style={{ color: '#5B6B60', fontSize: 13, marginBottom: 16 }}>
          Solo necesitamos tu nombre y correo institucional.
        </p>

        <div style={{ background: '#FBF1D6', border: '1px solid #eadca0', color: '#6b5510', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
          Este servicio es exclusivo para estudiantes activos de la Universidad de Antioquia.
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
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

  // step === 3
  const dayStartMin = OPERATING_START * 60;
  const daySpan = (OPERATING_END - OPERATING_START) * 60;

  return (
    <main style={{ maxWidth: 420, margin: '40px auto 0', padding: '0 16px' }}>
      <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 20, marginBottom: 4 }}>
        {TYPE_META[type]?.label}
      </h1>
      {TYPE_META[type]?.needsApproval && (
        <div style={{ background: '#FBF1D6', border: '1px solid #eadca0', color: '#6b5510', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 14 }}>
          Tu reserva quedará en firme solo si el administrador la autoriza.
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
            const opts = timeOptions(val);
            if (!opts.includes(start)) setStart(opts[0]);
          }} style={{ width: '100%', padding: 10, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}>
            <option value={60}>1 hora</option>
            <option value={90}>1.5 horas</option>
            <option value={120}>2 horas (máx.)</option>
          </select>
        </div>
      </div>

      <label style={{ fontSize: 12, color: '#5B6B60', display: 'block', marginBottom: 4 }}>Hora de inicio</label>
      <select value={start} onChange={(e) => setStart(e.target.value)}
        style={{ width: '100%', padding: 10, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 14, marginBottom: 16, boxSizing: 'border-box' }}>
        {timeOptions(duration).map((t) => (
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
        <button disabled
          style={{ flex: 1, padding: 12, background: '#0B6E4F', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, opacity: 0.6, cursor: 'not-allowed' }}>
          Revisar y confirmar (próximo paso)
        </button>
      </div>
    </main>
  );
}
