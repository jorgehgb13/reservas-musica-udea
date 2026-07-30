'use client';

import { useState } from 'react';

const TYPE_LABEL = { cubiculo: 'Cubículo', aula: 'Aula', auditorio: 'Auditorio' };
const STATUS_LABEL = {
  sin_verificar: 'Sin verificar',
  pendiente: 'Pendiente de aprobación',
  confirmada: 'Confirmada',
};
const STATUS_COLOR = {
  sin_verificar: { bg: '#FBF1D6', fg: '#6b5510' },
  pendiente: { bg: '#FBF1D6', fg: '#6b5510' },
  confirmada: { bg: '#E4F0EA', fg: '#084F39' },
};

function formatDayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const label = dt.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default function MisReservas() {
  const [email, setEmail] = useState('@udea.edu.co');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  async function handleLookup(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/reservations/mis-semana', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message || 'No se pudieron buscar tus reservas.');
        setLoading(false);
        return;
      }
      setResult(data);
    } catch (err) {
      setError('Ocurrió un error de conexión. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  // Agrupa las reservas encontradas por fecha, para mostrarlas día por día.
  const reservationsByDate = {};
  if (result?.reservations) {
    for (const r of result.reservations) {
      if (!reservationsByDate[r.date]) reservationsByDate[r.date] = [];
      reservationsByDate[r.date].push(r);
    }
  }
  const sortedDates = Object.keys(reservationsByDate).sort();

  return (
    <main style={{ maxWidth: 520, margin: '60px auto 0', padding: '0 16px' }}>
      <div style={{ textAlign: 'center', marginBottom: 30 }}>
        <div
          style={{
            width: 44, height: 44, borderRadius: '50%', background: '#0B6E4F',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'Georgia, serif', fontWeight: 600, fontSize: 14, margin: '0 auto 16px',
          }}
        >
          UdeA
        </div>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 24, margin: '0 0 6px' }}>
          Mis reservas de esta semana
        </h1>
        <p style={{ color: '#5B6B60', fontSize: 14 }}>
          Consulta tus reservas puntuales y recurrentes de la semana en curso.
        </p>
      </div>

      <form onSubmit={handleLookup} style={{ marginBottom: 24 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          Correo institucional
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              flex: 1, padding: 12, fontSize: 15, borderRadius: 8,
              border: '1px solid #DBDCCF', boxSizing: 'border-box',
            }}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '0 18px', fontSize: 14, fontWeight: 600, borderRadius: 8, border: '1px solid #0B6E4F',
              background: '#0B6E4F', color: '#fff', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Buscando...' : 'Ver'}
          </button>
        </div>
      </form>

      {error && (
        <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}

      {result && (
        <div>
          {result.weekStart && (
            <p style={{ fontSize: 12, color: '#5B6B60', marginBottom: 16 }}>
              Semana del {formatDayLabel(result.weekStart)} al {formatDayLabel(result.weekEnd)}
            </p>
          )}

          {sortedDates.length === 0 && (
            <div style={{ textAlign: 'center', padding: '30px 0', color: '#5B6B60', fontSize: 14 }}>
              No tienes reservas activas esta semana.
            </div>
          )}

          {sortedDates.map((date) => (
            <div key={date} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#16241C', marginBottom: 8 }}>
                {formatDayLabel(date)}
              </div>
              {reservationsByDate[date].map((r, idx) => {
                const colors = STATUS_COLOR[r.status] || { bg: '#eee', fg: '#333' };
                return (
                  <div
                    key={idx}
                    style={{
                      background: '#F5F4EC', border: '1px solid #DBDCCF', borderRadius: 8,
                      padding: 12, marginBottom: 8,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        {r.startTime} – {r.endTime}
                      </span>
                      <span style={{ background: colors.bg, color: colors.fg, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20 }}>
                        {STATUS_LABEL[r.status] || r.status}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: '#16241C' }}>
                      {TYPE_LABEL[r.roomType] || 'Espacio'} · {r.roomName || '—'}
                    </div>
                    {r.clase && (
                      <div style={{ fontSize: 12, color: '#5B6B60', fontStyle: 'italic', marginTop: 2 }}>
                        {r.clase}
                      </div>
                    )}
                    {r.isRecurring && (
                      <div style={{ fontSize: 11, color: '#5B6B60', marginTop: 2 }}>
                        ↻ Clase recurrente
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <a href="/" style={{ display: 'block', textAlign: 'center', marginTop: 16, fontSize: 13, color: '#5B6B60' }}>
        ← Volver al inicio
      </a>
    </main>
  );
}