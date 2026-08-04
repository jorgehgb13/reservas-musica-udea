'use client';

import { useState } from 'react';

const TYPE_LABEL = { cubiculo: 'Cubículo', aula: 'Aula', auditorio: 'Auditorio' };
const STATUS_LABEL = { sin_verificar: 'Sin verificar', pendiente: 'Pendiente de aprobación', confirmada: 'Confirmada' };

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function Cancelar() {
  const [step, setStep] = useState(1);

  const [email, setEmail] = useState('@udea.edu.co');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [reservationId, setReservationId] = useState(null);
  const [reservation, setReservation] = useState(null);
  const [reused, setReused] = useState(false);

  const [code, setCode] = useState('');
  const [confirmError, setConfirmError] = useState(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  async function handleLookup(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/reservations/lookup-active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message || 'No se pudo buscar tu reserva.');
        setLoading(false);
        return;
      }
      setReservationId(data.reservationId);
      setReservation(data.reservation);
      setReused(!!data.reused);
      setStep(2);
    } catch (err) {
      setError('Ocurrió un error de conexión. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(e) {
    e.preventDefault();
    setConfirmError(null);
    setConfirmLoading(true);
    try {
      const res = await fetch('/api/reservations/cancel-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservationId, code: code.trim() }),
      });
      const data = await res.json();
      if (!data.ok) {
        setConfirmError(data.message || 'No se pudo cancelar la reserva.');
        setConfirmLoading(false);
        return;
      }
      setStep(3);
    } catch (err) {
      setConfirmError('Ocurrió un error de conexión. Intenta de nuevo.');
    } finally {
      setConfirmLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: '60px auto 0', padding: '0 16px' }}>
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
          Cancelar mi reserva
        </h1>
        <p style={{ color: '#5B6B60', fontSize: 14 }}>
          Libera el espacio para que otra persona pueda tomarlo.
        </p>
      </div>

      {step === 1 && (
        <form onSubmit={handleLookup}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Correo institucional
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              width: '100%', padding: 12, fontSize: 15, borderRadius: 8,
              border: '1px solid #DBDCCF', boxSizing: 'border-box', marginBottom: 16,
            }}
          />

          {error && (
            <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: 14, fontSize: 15, borderRadius: 8, border: '1px solid #0B6E4F',
              background: '#0B6E4F', color: '#fff', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Buscando...' : 'Buscar mi reserva'}
          </button>

          <a href="/" style={{ display: 'block', textAlign: 'center', marginTop: 16, fontSize: 13, color: '#5B6B60' }}>
            ← Volver al inicio
          </a>
        </form>
      )}

      {step === 2 && reservation && (
        <form onSubmit={handleConfirm}>
          <div style={{ background: '#F5F4EC', border: '1px solid #DBDCCF', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: '#5B6B60', marginBottom: 4 }}>
              {TYPE_LABEL[reservation.roomType] || 'Espacio'} · {STATUS_LABEL[reservation.status] || reservation.status}
            </div>
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>{reservation.roomName}</div>
            <div style={{ fontSize: 14, color: '#16241C' }}>
              {formatDate(reservation.date)}, {reservation.startTime} – {reservation.endTime}
            </div>
          </div>

          <div style={{ background: '#E4F0EA', border: '1px solid #bfe0cf', color: '#084F39', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
            {reused
              ? 'Ya te habíamos enviado un código hace un momento y todavía es válido — revisa tu correo (incluida la carpeta de spam) e ingrésalo abajo.'
              : 'Te enviamos un código de 6 dígitos a tu correo. Ingrésalo abajo para confirmar la cancelación.'}
          </div>
          <div style={{ background: '#FBF1D6', border: '1px solid #eadca0', color: '#6b5510', padding: 10, borderRadius: 8, fontSize: 12, marginBottom: 16 }}>
            Si no lo ves en unos minutos, revisa tu carpeta de spam o correo no deseado — es probable que llegue ahí.
          </div>

          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Ingresa el código de 6 dígitos
          </label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            required
            style={{
              width: '100%', padding: 12, fontSize: 18, letterSpacing: 4, textAlign: 'center', borderRadius: 8,
              border: '1px solid #DBDCCF', boxSizing: 'border-box', marginBottom: 16,
            }}
          />

          {confirmError && (
            <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
              {confirmError}
            </div>
          )}

          <button
            type="submit"
            disabled={confirmLoading || code.length !== 6}
            style={{
              width: '100%', padding: 14, fontSize: 15, borderRadius: 8, border: '1px solid #A23E33',
              background: '#A23E33', color: '#fff', cursor: confirmLoading ? 'not-allowed' : 'pointer',
              opacity: confirmLoading || code.length !== 6 ? 0.6 : 1,
            }}
          >
            {confirmLoading ? 'Cancelando...' : 'Confirmar cancelación'}
          </button>

          <a
            href="/"
            style={{ display: 'block', textAlign: 'center', marginTop: 16, fontSize: 13, color: '#5B6B60' }}
          >
            No cancelar, volver al inicio
          </a>
        </form>
      )}

      {step === 3 && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 20, marginBottom: 8 }}>
            Tu reserva fue cancelada
          </h2>
          <p style={{ color: '#5B6B60', fontSize: 14, marginBottom: 24 }}>
            El espacio ya quedó libre para que otra persona lo reserve.
          </p>
          <a
            href="/"
            style={{
              display: 'inline-block', padding: '12px 24px', fontSize: 14, borderRadius: 8,
              border: '1px solid #0B6E4F', background: '#0B6E4F', color: '#fff', textDecoration: 'none',
            }}
          >
            Volver al inicio
          </a>
        </div>
      )}
    </main>
  );
}