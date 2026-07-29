'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';

const EMAIL_REGEX = /^[^\s@]+@udea\.edu\.co$/i;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// La hora en el Excel es solo el número (7, 9, 14...), siempre en punto.
// Esto la convierte al formato "HH:00" que usa el resto del sistema.
function parseHour(raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 23) return null;
  return `${pad2(n)}:00`;
}

// Miércoles se marca con "W" (para no confundirlo con "M" de martes).
// Se acepta "X" también, por si algún archivo viejo lo sigue usando.
const DAY_MAP = {
  D: 0, DOM: 0,
  L: 1, LUN: 1,
  M: 2, MAR: 2,
  W: 3, MIE: 3, X: 3,
  J: 4, JUE: 4,
  V: 5, VIE: 5,
  S: 6, SAB: 6,
};
const DAY_NAME = { 0: 'domingo', 1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábado' };

const EXPECTED_HEADERS = ['Curso', 'Dia 1', 'Dia 2', 'Horario inicio', 'Horario fin', 'Aula', 'Docente', 'Correo', 'Fecha inicio', 'Fecha fin'];

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

function parseDay(raw) {
  if (!raw) return null;
  const t = String(raw).trim();
  if (/^[0-6]$/.test(t)) return Number(t);
  const key = t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  if (key in DAY_MAP) return DAY_MAP[key];
  if (key.slice(0, 3) in DAY_MAP) return DAY_MAP[key.slice(0, 3)];
  if (key.slice(0, 1) in DAY_MAP) return DAY_MAP[key.slice(0, 1)];
  return null;
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

  const roomCode = get('Aula');
  const materia = get('Curso');
  const docente = get('Docente');
  const correo = get('Correo').toLowerCase();
  const dia1Raw = get('Dia 1');
  const dia2Raw = get('Dia 2');
  const horaInicioRaw = get('Horario inicio');
  const horaFinRaw = get('Horario fin');
  const horaInicio = parseHour(horaInicioRaw);
  const horaFin = parseHour(horaFinRaw);
  const fechaInicio = toDateStr(norm[normalize('Fecha inicio')]);
  const fechaFin = toDateStr(norm[normalize('Fecha fin')]);

  const errors = [];
  const room = roomsByCode[roomCode];

  if (!roomCode) errors.push('Falta el código del aula/espacio.');
  else if (!room) errors.push(`No existe ningún espacio con el código "${roomCode}".`);

  if (!materia) errors.push('Falta el nombre del curso.');
  if (!docente) errors.push('Falta el nombre del docente.');
  if (!EMAIL_REGEX.test(correo)) errors.push('El correo del docente debe ser institucional (@udea.edu.co).');

  const day1 = parseDay(dia1Raw);
  const day2 = dia2Raw ? parseDay(dia2Raw) : null;
  if (day1 === null) errors.push('"Dia 1" no se pudo interpretar (usa L, M, W, J, V, S o D).');
  if (dia2Raw && day2 === null) errors.push('"Dia 2" no se pudo interpretar (usa L, M, W, J, V, S o D).');
  const days = Array.from(new Set([day1, day2].filter((d) => d !== null && d !== undefined))).sort();

  if (horaInicio === null) errors.push('Horario de inicio inválido (escribe solo la hora, ej. 14 para las 2pm).');
  if (horaFin === null) errors.push('Horario de fin inválido (escribe solo la hora, ej. 16 para las 4pm).');
  if (horaInicio !== null && horaFin !== null && horaFin <= horaInicio) {
    errors.push('El horario de fin debe ser después del horario de inicio.');
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
  const [processingProgress, setProcessingProgress] = useState({ done: 0, total: 0 });
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
    const example = ['Armonía I', 'L', 'W', '14', '16', '25214', 'Prof. Juan Pérez', 'juan.perez@udea.edu.co', '2026-08-03', '2026-11-28'];
    const ws = XLSX.utils.aoa_to_sheet([EXPECTED_HEADERS, example]);
    ws['!cols'] = EXPECTED_HEADERS.map(() => ({ wch: 18 }));
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

      const validated = rawRows
        .map((row, idx) => validateRow(row, idx + 2, roomsByCode))
        .filter((row) => row.materia || row.docente || row.roomCode); // ignora filas totalmente vacías

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
    setProcessingProgress({ done: 0, total: validRows.length });

    let templatesCreated = 0;
    let templatesUpdated = 0;
    let reservationsCreated = 0;
    let reservationsUpdated = 0;
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

        // Busca si esta misma clase (mismo espacio, horario y rango de fechas)
        // ya se había cargado antes, para no crear una plantilla duplicada.
        const { data: candidateTemplates, error: findTemplateError } = await supabase
          .from('recurring_templates')
          .select('id, days_of_week')
          .eq('room_id', row.room.id)
          .eq('start_time', row.horaInicio)
          .eq('end_time', row.horaFin)
          .eq('date_from', row.fechaInicio)
          .eq('date_to', row.fechaFin);
        if (findTemplateError) throw findTemplateError;

        const sortedRowDays = [...row.days].sort().join(',');
        const matchingTemplate = (candidateTemplates || []).find(
          (t) => [...(t.days_of_week || [])].sort().join(',') === sortedRowDays
        );

        let templateId;
        let templateIsNew = false;

        if (matchingTemplate) {
          templateId = matchingTemplate.id;
          const { error: updateTemplateError } = await supabase
            .from('recurring_templates')
            .update({ materia: row.materia, docente: row.docente, user_id: userId })
            .eq('id', templateId);
          if (updateTemplateError) throw updateTemplateError;
          templatesUpdated += 1;
        } else {
          const { data: templateData, error: templateError } = await supabase
            .from('recurring_templates')
            .insert({
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
            })
            .select('id')
            .single();
          if (templateError) throw templateError;
          templateId = templateData.id;
          templateIsNew = true;
          templatesCreated += 1;
        }

        const occurrences = computeOccurrences(row.fechaInicio, row.fechaFin, row.days);
        let created = 0;
        let updated = 0;
        let skipped = 0;

        // Un solo viaje a la base de datos para saber cuáles de estas fechas
        // ya tienen una reserva activa en ese espacio y horario.
        const { data: existingReservations, error: findResError } = await supabase
          .from('reservations')
          .select('id, date')
          .eq('room_id', row.room.id)
          .eq('start_time', row.horaInicio)
          .eq('end_time', row.horaFin)
          .in('date', occurrences)
          .neq('status', 'cancelada')
          .neq('status', 'rechazada');
        if (findResError) throw findResError;

        const existingByDate = new Map((existingReservations || []).map((r) => [r.date, r.id]));
        const existingIds = (existingReservations || []).map((r) => r.id);
        const missingDates = occurrences.filter((d) => !existingByDate.has(d));

        if (existingIds.length > 0) {
          const { error: bulkUpdateError } = await supabase
            .from('reservations')
            .update({ clase: row.materia, recurring_template_id: templateId })
            .in('id', existingIds);

          if (!bulkUpdateError) {
            updated += existingIds.length;
          } else {
            // Si la actualización en bloque falla, se intenta una por una
            // para no perder todo el avance de esta fila.
            for (const id of existingIds) {
              const { error } = await supabase
                .from('reservations')
                .update({ clase: row.materia, recurring_template_id: templateId })
                .eq('id', id);
              if (error) skipped += 1;
              else updated += 1;
            }
          }
        }

        if (missingDates.length > 0) {
          const newRows = missingDates.map((date) => ({
            room_id: row.room.id,
            user_id: userId,
            date,
            start_time: row.horaInicio,
            end_time: row.horaFin,
            status: 'confirmada',
            requires_approval: false,
            forced: true,
            recurring_template_id: templateId,
            clase: row.materia,
          }));

          const { error: bulkInsertError } = await supabase.from('reservations').insert(newRows);

          if (!bulkInsertError) {
            created += newRows.length;
          } else {
            // Si la creación en bloque falla (por ejemplo, un choque de
            // horario puntual), se intenta fecha por fecha para saber
            // exactamente cuáles sí se pudieron crear.
            for (const newRow of newRows) {
              const { error } = await supabase.from('reservations').insert(newRow);
              if (error) skipped += 1;
              else created += 1;
            }
          }
        }

        reservationsCreated += created;
        reservationsUpdated += updated;
        reservationsSkipped += skipped;
        rowResults.push({
          rowNumber: row.rowNumber,
          materia: row.materia,
          docente: row.docente,
          roomName: row.room.name,
          templateIsNew,
          created,
          updated,
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
      setProcessingProgress((p) => ({ done: p.done + 1, total: p.total }));
    }

    setResults({
      templatesCreated,
      templatesUpdated,
      reservationsCreated,
      reservationsUpdated,
      reservationsSkipped,
      rowResults,
    });
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
          <li><strong>Aula</strong>: el código exacto del cubículo, aula o auditorio (ej. 25214).</li>
          <li><strong>Dia 1 / Dia 2</strong>: una letra por columna — L, M, W, J, V, S, D (W = miércoles). "Dia 2" es opcional si el curso solo es un día a la semana.</li>
          <li><strong>Horario inicio / Horario fin</strong>: solo el número de la hora, en punto (ej. 7, 9, 14). No se admiten minutos.</li>
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
                  <th style={{ padding: 6 }}>Aula</th>
                  <th style={{ padding: 6 }}>Curso</th>
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
              {processing ? `Procesando fila ${processingProgress.done} de ${processingProgress.total}…` : `Confirmar carga (${validCount} fila${validCount === 1 ? '' : 's'})`}
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
              {results.templatesCreated} materia(s) nueva(s) · {results.templatesUpdated} materia(s) ya existente(s) actualizada(s)
              <br />
              {results.reservationsCreated} clase(s) reservada(s) nueva(s) · {results.reservationsUpdated} reserva(s) existente(s) actualizada(s) con el nombre de la clase
              {results.reservationsSkipped > 0 && <> · {results.reservationsSkipped} omitida(s) por un problema al guardar</>}
            </p>
          </div>

          <div style={{ overflowX: 'auto', marginBottom: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #DBDCCF' }}>
                  <th style={{ padding: 6 }}>Fila</th>
                  <th style={{ padding: 6 }}>Curso</th>
                  <th style={{ padding: 6 }}>Docente</th>
                  <th style={{ padding: 6 }}>Aula</th>
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
                          {!r.templateIsNew && <span style={{ color: '#5B6B60' }}>materia ya existía · </span>}
                          {r.created > 0 && <>{r.created} clase(s) nueva(s)</>}
                          {r.created > 0 && r.updated > 0 && ' · '}
                          {r.updated > 0 && <>{r.updated} actualizada(s)</>}
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
