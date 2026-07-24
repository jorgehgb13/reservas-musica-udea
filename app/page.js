// PÁGINA DE PRUEBA — Paso 1 de la reconstrucción.
// Su único objetivo es demostrar que el sitio web puede leer datos reales
// desde Supabase. No tiene formularios ni lógica de reservas todavía;
// eso viene en el siguiente paso, una vez confirmemos que esta conexión
// funciona sin errores.

import { supabase } from '../lib/supabaseClient';

// Fuerza a Next.js a consultar datos frescos en cada visita (nada de caché
// mientras estamos probando), para evitar confusiones de "no veo el cambio".
export const dynamic = 'force-dynamic';

export default async function Home() {
  // Manejo de errores explícito: si algo falla (credenciales mal puestas,
  // tabla no existe, sin internet hacia Supabase), lo mostramos con
  // claridad en vez de que la página se rompa en blanco.
  let rooms = [];
  let errorMessage = null;

  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('id, code, name, type')
      .order('code', { ascending: true });

    if (error) {
      errorMessage = `Error de Supabase: ${error.message}`;
    } else {
      rooms = data || [];
    }
  } catch (err) {
    errorMessage = `Error de conexión: ${err.message}`;
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22 }}>Prueba de conexión — Depto. de Música UdeA</h1>
      <p style={{ color: '#5B6B60', fontSize: 14 }}>
        Esta página confirma que el sitio web puede leer la tabla <code>rooms</code> directamente
        desde la base de datos real en Supabase.
      </p>

      {errorMessage && (
        <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 14, borderRadius: 8, marginTop: 16 }}>
          <strong>Algo falló:</strong> {errorMessage}
        </div>
      )}

      {!errorMessage && rooms.length === 0 && (
        <div style={{ background: '#FBF1D6', border: '1px solid #eadca0', color: '#6b5510', padding: 14, borderRadius: 8, marginTop: 16 }}>
          La conexión funcionó, pero la tabla <code>rooms</code> está vacía. Eso es normal si aún no
          has cargado las aulas — este mensaje confirma que la conexión en sí está bien.
        </div>
      )}

      {!errorMessage && rooms.length > 0 && (
        <div style={{ background: '#E4F0EA', border: '1px solid #bfe0cf', color: '#084F39', padding: 14, borderRadius: 8, marginTop: 16 }}>
          ✅ Conexión exitosa. Se encontraron {rooms.length} espacio(s) en la base de datos.
        </div>
      )}

      {rooms.length > 0 && (
        <table style={{ width: '100%', marginTop: 20, borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #DBDCCF' }}>
              <th style={{ padding: 8 }}>Código</th>
              <th style={{ padding: 8 }}>Nombre</th>
              <th style={{ padding: 8 }}>Tipo</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #DBDCCF' }}>
                <td style={{ padding: 8 }}>{r.code}</td>
                <td style={{ padding: 8 }}>{r.name}</td>
                <td style={{ padding: 8 }}>{r.type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
