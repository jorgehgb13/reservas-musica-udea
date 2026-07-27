// PÁGINA DE INICIO — reemplaza la página de prueba.
// Por ahora los botones no hacen nada todavía (eso viene en el siguiente
// paso); esto solo confirma que el diseño se ve correcto en producción.

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
        <a
          href="/reservar"
          style={{
            padding: 14, fontSize: 15, borderRadius: 8, border: '1px solid #0B6E4F',
            background: '#0B6E4F', color: '#fff', textDecoration: 'none', display: 'block', boxSizing: 'border-box',
          }}
        >
          Solicitar una reserva
        </a>
        <a
          href="/prestar"
          style={{
            padding: 10, fontSize: 13, borderRadius: 8, border: '1px solid #DBDCCF',
            background: '#fff', color: '#16241C', textDecoration: 'none', display: 'block', boxSizing: 'border-box',
          }}
        >
          Prestar un instrumento
        </a>
        <a
          href="/cancelar"
          style={{
            padding: 10, fontSize: 13, borderRadius: 8, border: '1px solid #DBDCCF',
            background: '#fff', color: '#16241C', textDecoration: 'none', display: 'block', boxSizing: 'border-box',
          }}
        >
          Cancelar mi reserva
        </a>
        <a
          href="/admin/login"
          style={{
            padding: 10, fontSize: 13, borderRadius: 8, border: '1px solid transparent',
            background: 'transparent', color: '#5B6B60', textDecoration: 'none', display: 'block',
          }}
        >
          Soy administrador
        </a>
      </div>
    </main>
  );
}
