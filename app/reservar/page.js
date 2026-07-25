'use client';

import { useState } from 'react';

export default function Reservar() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('@udea.edu.co');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  async function handleSubmit(e) {
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
      setResult(data);
    } catch (err) {
      setError(`Error de conexión: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <main style={{ maxWidth: 420, margin: '60px auto 0', padding: '0 16px', textAlign: 'center' }}>
        <div style={{ background: '#E4F0EA', border: '1px solid #bfe0cf', color: '#084F39', padding: 16, borderRadius: 8, fontSize: 14 }}>
          ✅ Tus datos quedaron guardados correctamente, y no tienes ninguna reserva activa ni sanción pendiente.
        </div>
        <p style={{ color: '#5B6B60', fontSize: 12.5, marginTop: 16 }}>
          (Fin del Paso 1. La selección de espacio, fecha y horario se agrega en el siguiente paso.)
        </p>
      </main>
    );
  }

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

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#5B6B60', display: 'block', marginBottom: 4 }}>Nombre completo</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ width: '100%', padding: 10, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: '#5B6B60', display: 'block', marginBottom: 4 }}>Correo institucional</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onFocus={(e) => {
              if (e.target.value === '@udea.edu.co') e.target.setSelectionRange(0, 0);
            }}
            style={{ width: '100%', padding: 10, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
          />
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: '#5B6B60', marginBottom: 18 }}>
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            Declaro que soy estudiante activo de la Universidad de Antioquia y acepto el reglamento de uso
            de los espacios.
          </span>
        </label>
        <button
          type="submit"
          disabled={loading}
          style={{ width: '100%', padding: 12, background: '#0B6E4F', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1 }}
        >
          {loading ? 'Verificando…' : 'Continuar'}
        </button>
      </form>
    </main>
  );
}
