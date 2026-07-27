'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';

const EMAIL_REGEX = /^[^\s@]+@udea\.edu\.co$/i;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const DAY_MAP = {
  D: 0, DOM: 0,
  L: 1, LUN: 1,
  M: 2, MAR: 2,
  X: 3, MIE: 3,
  J: 4, JUE: 4,
  V: 5, VIE: 5,
  S: 6, SAB: 6,
};
const DAY_NAME = { 0: 'domingo', 1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábado' };

const EXPECTED_HEADERS = ['Espacio', 'Materia', 'Docente', 'Correo docente', 'Dias', 'Hora inicio', 'Hora fin', 'Fecha inicio', 'Fecha fin'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function toDateStr(val) {
  if (val instanceof Date) {
    return `${val.getFullYear()}-${pad2(val.getMonth() + 1)}-${pad2(val.getDate())}`;
  }
  return String(val ?? '').trim();
}

function parseDays(raw) {
  if (!raw) return [];
  const tokens = String(raw).split(/[,\s/]+/).map((t) => t.trim()).filter(Boolean);
  const days = new Set();
  for (const t of tokens) {
    if (/^[0-6]$/.test(t)) {
      days.add(Number(t));
      continue;
    }
    const key = t
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
    if (key in DAY_MAP) days.add(DAY_MAP[key]);
    else if (key.slice(0, 3) in DAY_MAP) days.add(DAY_MAP[key.slice(0, 3)]);
    else if (key.slice(0, 1) in DAY_MAP) days.add(DAY_MAP[key.slice(0, 1)]);
  }
  return Array.from(days).sort();
}

// Calcula todas las fechas concretas entre dos fechas (incluidas) que caen en
// alguno de los días de la semana indicados, usando siempre la hora de
// Colombia (-05:00) para que no se corra un día por el huso horario.
function computeOccurrences(dateFromStr, dateToStr, days) {
  const dates = [];
  let cursor = new Date(`${dateFromStr}T00:00:00-05:00`);
  const end = new Date(`${dateToStr}T00:00:00-05:00`);
  let guard = 0;
  while (cursor <= end && guard < 2000) {
    if (days.includes(cursor.getUTCDay())) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    guard += 1;
  }
  return dates;
}

function validateRow(row, rowNumber, roomsByCode) {
  const norm = {};
  for (const key of Object.keys(row)) {
    norm[normalize(key)] = row[key];
  }
  const get = (header) => {
    const v = norm[normalize(header)];
    return v === undefined || v === null ? '' : String(v).trim();
  };

  const roomCode = get('Espacio');
  const materia = get('Materia');
  const docente = get('Docente');
  const correo = get('Correo docente').toLowerCase();
  const diasRaw = get('Dias');
  const horaInicio = get('Hora inicio');
  const horaFin = get('Hora fin');
  const fechaInicio = toDateStr(norm[normalize('Fecha inicio')]);
  const fechaFin = toDateStr(norm[normalize('Fecha fin')]);

  const errors = [];
  const room = roomsByCode[roomCode];

  if (!roomCode) errors.push('Falta el código del espacio.');
  else if (!room) errors.push(`No existe ningún espacio con el código "${roomCode}".`);

  if (!materia) errors.push('Falta la materia.');
  if (!docente) errors.push('Falta el nombre del docente.');
  if (!EMAIL_REGEX.test(correo)) errors.push('El correo del docente debe ser institucional (@udea.edu.co).');

  const days = parseDays(diasRaw);
  if (days.length === 0) errors.push('No se pudieron interpretar los días (usa L, M, X, J, V, S, D).');

  if (!TIME_REGEX.test(horaInicio)) errors.push('Hora de inicio inválida (usa HH:MM, ej. 14:00).');
  if (!TIME_REGEX.test(horaFin)) errors.push('Hora de fin inválida (usa HH:MM, ej. 16:00).');
  if (TIME_REGEX.test(horaInicio) && TIME_REGEX.test(horaFin) && horaFin <= horaInicio) {
    errors.push('La hora de fin debe ser después de la hora de inicio.');
  }

  if (!DATE_REGEX.test(fechaInicio)) errors.push('Fecha de inicio inválida (usa AAAA-MM-DD).');
  if (!DATE_REGEX.test(fechaFin)) errors.push('Fecha de fin inválida (usa AAAA-MM-DD).');
  if (DATE_REGEX.test(fechaInicio) && DATE_REGEX.test(fechaFin) && fechaFin < fechaInicio) {
    errors.push('La fecha de fin debe ser igual o posterior a la fecha de inicio.');
  }

  return {
    rowNumber,
    roomCode,
    room,
    materia,
    docente,
    correo,
    days,
    diasTexto: days.map((d) => DAY_NAME[d]).join(', '),
    horaInicio,
    horaFin,
    fechaInicio,
    fechaFin,
    errors,
  };
}

export default function CargaMasiva() {
  const [session, setSession] = useState(undefined);
  const router = useRouter();
  const fileInputRef = useRef(null);

  const [rooms, setRooms] = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(true);

  const [fileName, setFileName] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parsedRows, setParsedRows] = useState([]);
  const [globalError, setGlobalError] = useState(null);

  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === null) router.push('/admin/login');
  }, [session, router]);

  useEffect(() => {
    if (!session) return;
    supabase
      .from('rooms')
      .select('id, code, name, type')
      .then(({ data, error }) => {
        if (!error) setRooms(data || []);
        setRoomsLoading(false);
      });
  }, [session]);

  const roomsByCode = {};
  for (const r of rooms) roomsByCode[r.code] = r;

  async function handleDownloadTemplate() {
    const XLSX = await import('xlsx');
    const example = ['25214', 'Armonía I', 'Prof. Juan Pérez', 'juan.perez@udea.edu.co', 'L,X', '14:00', '16:00', '2026-08-03', '2026-11-28'];
    const ws = XLSX.utils.aoa_to_sheet([EXPECTED_HEADERS, example]);
    ws['!cols'] = EXPECTED_HEADERS.map(() => ({ wch: 20 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Plantilla');
    XLSX.writeFile(wb, 'plantilla-carga-masiva.xlsx');
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResults(null);
    setGlobalError(null);
    setParsedRows([]);
    setParsing(true);

    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (rawRows.length === 0) {
        setGlobalError('El archivo no tiene filas de datos (solo encabezados, o está vacío).');
        setParsing(false);
        return;
      }

      const validated = rawRows.map((row, idx) => validateRow(row, idx + 2, roomsByCode));
      setParsedRows(validated);
    } catch (err) {
      console.error('[carga-masiva] error leyendo archivo:', err);
      setGlobalError('No se pudo leer el archivo. Asegúrate de que sea un .xlsx válido y siga el formato de la plantilla.');
    } finally {
      setParsing(false);
    }
  }

  async function handleConfirmUpload() {
    const validRows = parsedRows.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) return;

    setProcessing(true);
    setResults(null);

    let templatesCreated = 0;
    let reservationsCreated = 0;
    let reservationsSkipped = 0;
    const rowResults = [];

    for (const row of validRows) {
      try {
        let userId;
        const { data: existingUser, error: findError } = await supabase
          .from('app_users')
          .select('id')
          .eq('email', row.correo)
          .maybeSingle();
        if (findError) throw findError;

        if (existingUser) {
          userId = existingUser.id;
        } else {
          const { data: newUser, error: insertUserError } = await supabase
            .from('app_users')
            .insert({ email: row.correo, name: row.docente })
            .select('id')
            .single();
          if (insertUserError) throw insertUserError;
          userId = newUser.id;
        }

        const { error: templateError } = await supabase.from('recurring_templates').insert({
          room_id: row.room.id,
          materia: row.materia,
          docente: row.docente,
          user_id: userId,
          days_of_week: row.days,
          start_time: row.horaInicio,
          end_time: row.horaFin,
          date_from: row.fechaInicio,
          date_to: row.fechaFin,
          origin: 'admin-recurrente-excel',
        });
        if (templateError) throw templateError;
        templatesCreated += 1;

        const occurrences = computeOccurrences(row.fechaInicio, row.fechaFin, row.days);
        let created = 0;
        let skipped = 0;

        for (const date of occurrences) {
          const { error: resError } = await supabase.from('reservations').insert({
            room_id: row.room.id,
            user_id: userId,
            date,
            start_time: row.horaInicio,
            end_time: row.horaFin,
            status: 'confirmada',
            requires_approval: false,
            forced: true,
          });
          if (resError) {
            skipped += 1;
          } else {
            created += 1;
          }
        }

        reservationsCreated += created;
        reservationsSkipped += skipped;
        rowResults.push({
          rowNumber: row.rowNumber,
          materia: row.materia,
          docente: row.docente,
          roomName: row.room.name,
          created,
          skipped,
          ok: true,
        });
      } catch (err) {
        console.error('[carga-masiva] error procesando fila:', err);
        rowResults.push({
          rowNumber: row.rowNumber,
          materia: row.materia,
          docente: row.docente,
          ok: false,
          error: err.message || 'Error desconocido',
        });
      }
    }

    setResults({ templatesCreated, reservationsCreated, reservationsSkipped, rowResults });
    setProcessing(false);
  }

  function handleReset() {
    setFileName(null);
    setParsedRows([]);
    setResults(null);
    setGlobalError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  if (session === undefined) {
    return <main style={{ padding: 40, textAlign: 'center', color: '#5B6B60' }}>Cargando…</main>;
  }
  if (!session) {
    return null;
  }

  const validCount = parsedRows.filter((r) => r.errors.length === 0).length;
  const invalidCount = parsedRows.length - validCount;

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ marginBottom: 20 }}>
        <a href="/admin" style={{ fontSize: 13, color: '#5B6B60', textDecoration: 'none' }}>
          ← Volver al panel
        </a>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 22, margin: '8px 0 0' }}>
          Carga masiva de reservas recurrentes
        </h1>
        <p style={{ color: '#5B6B60', fontSize: 13, margin: '4px 0 0' }}>
          Sube un Excel con las clases fijas de los docentes y el sistema crea todas las reservas de una vez, respetando lo que ya esté ocupado.
        </p>
      </div>

      <div style={{ background: '#F5F4EC', border: '1px solid #DBDCCF', borderRadius: 8, padding: 18, marginBottom: 24 }}>
        <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 15, margin: '0 0 10px' }}>1. Prepara el archivo</h2>
        <p style={{ fontSize: 13, color: '#5B6B60', margin: '0 0 10px' }}>
          El Excel debe tener estas columnas exactas en la primera fila:
        </p>
        <div style={{ fontFamily: 'monospace', fontSize: 12, background: '#fff', border: '1px solid #DBDCCF', borderRadius: 6, padding: 10, marginBottom: 10, overflowX: 'auto', whiteSpace: 'nowrap' }}>
          {EXPECTED_HEADERS.join(' | ')}
        </div>
        <ul style={{ fontSize: 12, color: '#5B6B60', margin: '0 0 12px', paddingLeft: 18 }}>
          <li><strong>Espacio</strong>: el código exacto del cubículo, aula o auditorio (ej. 25214).</li>
          <li><strong>Dias</strong>: letras separadas por coma — L, M, X, J, V, S, D (X = miércoles).</li>
          <li><strong>Hora inicio / Hora fin</strong>: formato 24 horas, ej. 14:00.</li>
          <li><strong>Fecha inicio / Fecha fin</strong>: formato AAAA-MM-DD, ej. 2026-08-03.</li>
        </ul>
        <button
          onClick={handleDownloadTemplate}
          style={{ padding: '8px 16px', fontSize: 13, borderRadius: 6, border: '1px solid #0B6E4F', color: '#0B6E4F', background: 'transparent', cursor: 'pointer' }}
        >
          Descargar plantilla de ejemplo
        </button>
      </div>

      <div style={{ background: '#F5F4EC', border: '1px solid #DBDCCF', borderRadius: 8, padding: 18, marginBottom: 24 }}>
        <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 15, margin: '0 0 10px' }}>2. Sube el archivo</h2>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileChange}
          style={{ fontSize: 13 }}
        />
        {fileName && (
          <span style={{ fontSize: 12, color: '#5B6B60', marginLeft: 10 }}>
            {parsing ? 'Leyendo…' : fileName}
          </span>
        )}
        {roomsLoading && (
          <p style={{ fontSize: 12, color: '#5B6B60', marginTop: 8 }}>Cargando lista de espacios…</p>
        )}
      </div>

      {globalError && (
        <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 20, fontSize: 13 }}>
          {globalError}
        </div>
      )}

      {parsedRows.length > 0 && !results && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 15, margin: '0 0 10px' }}>3. Revisa antes de confirmar</h2>
          <p style={{ fontSize: 13, color: '#5B6B60', marginBottom: 12 }}>
            {validCount} fila(s) lista(s) para cargar
            {invalidCount > 0 && <> · <span style={{ color: '#A23E33' }}>{invalidCount} fila(s) con errores (no se cargarán)</span></>}
          </p>

          <div style={{ overflowX: 'auto', marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #DBDCCF' }}>
                  <th style={{ padding: 6 }}>Fila</th>
                  <th style={{ padding: 6 }}>Espacio</th>
                  <th style={{ padding: 6 }}>Materia</th>
                  <th style={{ padding: 6 }}>Docente</th>
                  <th style={{ padding: 6 }}>Días</th>
                  <th style={{ padding: 6 }}>Horario</th>
                  <th style={{ padding: 6 }}>Periodo</th>
                  <th style={{ padding: 6 }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((row) => (
                  <tr key={row.rowNumber} style={{ borderBottom: '1px solid #DBDCCF' }}>
                    <td style={{ padding: 6 }}>{row.rowNumber}</td>
                    <td style={{ padding: 6 }}>{row.room?.name || row.roomCode || '—'}</td>
                    <td style={{ padding: 6 }}>{row.materia || '—'}</td>
                    <td style={{ padding: 6 }}>{row.docente || '—'}</td>
                    <td style={{ padding: 6 }}>{row.diasTexto || '—'}</td>
                    <td style={{ padding: 6, fontFamily: 'monospace' }}>{row.horaInicio}-{row.horaFin}</td>
                    <td style={{ padding: 6 }}>{row.fechaInicio} a {row.fechaFin}</td>
                    <td style={{ padding: 6 }}>
                      {row.errors.length === 0 ? (
                        <span style={{ background: '#E4F0EA', color: '#084F39', fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20 }}>
                          Lista
                        </span>
                      ) : (
                        <span style={{ background: '#F7E8E5', color: '#A23E33', fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20 }}
                          title={row.errors.join(' ')}>
                          Error
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {invalidCount > 0 && (
            <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 12 }}>
              <strong>Detalle de errores:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {parsedRows.filter((r) => r.errors.length > 0).map((r) => (
                  <li key={r.rowNumber}>Fila {r.rowNumber}: {r.errors.join(' ')}</li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={handleConfirmUpload}
              disabled={processing || validCount === 0}
              style={{
                padding: '10px 20px', fontSize: 14, fontWeight: 600, borderRadius: 8, border: '1px solid #0B6E4F',
                background: '#0B6E4F', color: '#fff', cursor: processing || validCount === 0 ? 'not-allowed' : 'pointer',
                opacity: processing || validCount === 0 ? 0.6 : 1,
              }}
            >
              {processing ? 'Cargando…' : `Confirmar carga (${validCount} fila${validCount === 1 ? '' : 's'})`}
            </button>
            <button
              onClick={handleReset}
              disabled={processing}
              style={{ padding: '10px 20px', fontSize: 14, borderRadius: 8, border: '1px solid #DBDCCF', background: '#fff', cursor: 'pointer' }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {results && (
        <div>
          <div style={{ background: '#E4F0EA', border: '1px solid #bcd9c9', borderRadius: 8, padding: 18, marginBottom: 20 }}>
            <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 16, margin: '0 0 8px', color: '#084F39' }}>Carga terminada</h2>
            <p style={{ fontSize: 13, color: '#084F39', margin: 0 }}>
              {results.templatesCreated} materia(s) recurrente(s) creada(s) · {results.reservationsCreated} clase(s) reservada(s)
              {results.reservationsSkipped > 0 && <> · {results.reservationsSkipped} omitida(s) por choque de horario con algo que ya estaba ocupado</>}
            </p>
          </div>

          <div style={{ overflowX: 'auto', marginBottom: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #DBDCCF' }}>
                  <th style={{ padding: 6 }}>Fila</th>
                  <th style={{ padding: 6 }}>Materia</th>
                  <th style={{ padding: 6 }}>Docente</th>
                  <th style={{ padding: 6 }}>Espacio</th>
                  <th style={{ padding: 6 }}>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {results.rowResults.map((r) => (
                  <tr key={r.rowNumber} style={{ borderBottom: '1px solid #DBDCCF' }}>
                    <td style={{ padding: 6 }}>{r.rowNumber}</td>
                    <td style={{ padding: 6 }}>{r.materia}</td>
                    <td style={{ padding: 6 }}>{r.docente}</td>
                    <td style={{ padding: 6 }}>{r.roomName || '—'}</td>
                    <td style={{ padding: 6 }}>
                      {r.ok ? (
                        <>
                          {r.created} clase(s) creada(s)
                          {r.skipped > 0 && <span style={{ color: '#A23E33' }}> · {r.skipped} omitida(s)</span>}
                        </>
                      ) : (
                        <span style={{ color: '#A23E33' }}>No se pudo crear: {r.error}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={handleReset}
            style={{ padding: '10px 20px', fontSize: 14, borderRadius: 8, border: '1px solid #DBDCCF', background: '#fff', cursor: 'pointer' }}
          >
            Cargar otro archivo
          </button>
        </div>
      )}
    </main>
  );
}
