export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <main style={{ maxWidth: 480, margin: '60px auto 0', textAlign: 'center', padding: '0 16px' }}>
      <div
        style={{
          width: 44, height: 44, borderRadius: '50%', background: '#0B6E4F',
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'Georgia, serif', fontWeight: 600, fontSize: 14, margin: '0 auto 16px',
        }}
      >
        UdeA
      </div>

      <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 26, margin: '0 0 6px' }}>
        Reserva tu espacio de práctica
      </h1>
      <p style={{ color: '#5B6B60', fontSize: 14, marginBottom: 34 }}>
        Cubículos, aulas y auditorio del Departamento de Música
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 300, margin: '0 auto' }}>
        <button
          disabled
          style={{
            padding: 14, fontSize: 15, borderRadius: 8, border: '1px solid #0B6E4F',
            background: '#0B6E4F', color: '#fff', opacity: 0.6, cursor: 'not-allowed',
          }}
        >
          Solicitar una reserva
        </button>
        <button
          disabled
          style={{
            padding: 10, fontSize: 13, borderRadius: 8, border: '1px solid #DBDCCF',
            background: '#fff', color: '#16241C', opacity: 0.6, cursor: 'not-allowed',
          }}
        >
          Cancelar mi reserva
        </button>
        <button
          disabled
          style={{
            padding: 10, fontSize: 13, borderRadius: 8, border: '1px solid transparent',
            background: 'transparent', color: '#5B6B60', opacity: 0.6, cursor: 'not-allowed',
          }}
        >
          Soy administrador
        </button>
      </div>

      <p style={{ color: '#5B6B60', fontSize: 12, marginTop: 40 }}>
        (Los botones aún no funcionan — esto solo confirma que el diseño se ve bien.)
      </p>
    </main>
  );
}
