'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

const WEEKDAY_LABEL = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// Dada una fecha (YYYY-MM-DD), devuelve el lunes y el domingo de esa misma
// semana, usando siempre la hora de Colombia (-05:00).
function getWeekRange(dateStr) {
  const d = new Date(`${dateStr}T00:00:00-05:00`);
  const dayNum = d.getUTCDay(); // 0 = domingo, 1 = lunes, ... 6 = sábado
  const diffToMonday = dayNum === 0 ? -6 : 1 - dayNum;
  const monday = new Date(d.getTime() + diffToMonday * 24 * 60 * 60 * 1000);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    dates.push(new Date(monday.getTime() + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  return dates; // [lunes, martes, ..., domingo]
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00-05:00`);
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function formatDayShort(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

function toMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

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

// Convierte un Date a formato "YYYY-MM-DDTHH:mm" para inputs datetime-local,
// usando la hora local del navegador del administrador (Colombia).
function toLocalInputValue(dt) {
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}T${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}

const EMAIL_REGEX = /^[^\s@]+@udea\.edu\.co$/i;

const STATUS_LABEL = {
  sin_verificar: 'Sin verificar',
  pendiente: 'Pendiente',
  confirmada: 'Confirmada',
  cancelada: 'Cancelada',
  rechazada: 'Rechazada',
};

const STATUS_COLOR = {
  sin_verificar: { bg: '#EAE4F5', fg: '#5B3FA0' },
  pendiente: { bg: '#FBF1D6', fg: '#6b5510' },
  confirmada: { bg: '#E4F0EA', fg: '#084F39' },
  cancelada: { bg: '#eee', fg: '#888' },
  rechazada: { bg: '#F7E8E5', fg: '#A23E33' },
};

const ROOM_TYPE_LABEL = { cubiculo: 'Cubículos', aula: 'Aulas', auditorio: 'Auditorio' };
const ROOM_TYPE_ORDER = ['cubiculo', 'aula', 'auditorio'];
const OCCUPANCY_TABS = [
  { key: 'todos', label: 'Todos' },
  { key: 'cubiculo', label: 'Cubículos' },
  { key: 'aula', label: 'Aulas' },
  { key: 'auditorio', label: 'Auditorio' },
];

const OPERATING_START = 6; // 6:00 a.m.
const OPERATING_END = 20; // 8:00 p.m.
const OPERATING_START_MIN = OPERATING_START * 60;
const OPERATING_END_MIN = OPERATING_END * 60;
const OPERATING_TOTAL_MIN = OPERATING_END_MIN - OPERATING_START_MIN;
const HOUR_MARKS = Array.from({ length: OPERATING_END - OPERATING_START + 1 }, (_, i) => OPERATING_START + i);

function pctLeft(startTime) {
  const startMin = toMinutes(startTime.slice(0, 5));
  const pct = ((startMin - OPERATING_START_MIN) / OPERATING_TOTAL_MIN) * 100;
  return Math.min(100, Math.max(0, pct));
}

function pctWidth(startTime, endTime) {
  const startMin = Math.max(toMinutes(startTime.slice(0, 5)), OPERATING_START_MIN);
  const endMin = Math.min(toMinutes(endTime.slice(0, 5)), OPERATING_END_MIN);
  const pct = ((endMin - startMin) / OPERATING_TOTAL_MIN) * 100;
  return Math.max(0, pct);
}

const INSTRUMENT_TEMPLATE_HEADERS = ['Nombre', 'Numero de inventario'];

function validateInstrumentRow(row, rowNumber) {
  const norm = {};
  for (const key of Object.keys(row)) {
    norm[normalize(key)] = row[key];
  }
  const get = (header) => {
    const v = norm[normalize(header)];
    return v === undefined || v === null ? '' : String(v).trim();
  };

  const name = get('Nombre');
  const inventoryNumber = get('Numero de inventario');

  const errors = [];
  if (!name) errors.push('Falta el nombre.');
  if (!inventoryNumber) errors.push('Falta el número de inventario.');

  return {
    rowNumber,
    name,
    inventoryNumber,
    errors,
  };
}

export default function AdminHome() {
  const [session, setSession] = useState(undefined);
  const router = useRouter();

  const [view, setView] = useState('lista'); // 'lista' | 'ocupacion' | 'sanciones' | 'instrumentos' | 'semana'
  const [date, setDate] = useState(todayStr());
  const [reservations, setReservations] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState(null);
  const [actionId, setActionId] = useState(null);

  const [rooms, setRooms] = useState([]);
  const [roomsError, setRoomsError] = useState(null);
  const [occupancyType, setOccupancyType] = useState('todos');

  // ---------- Por semana ----------
  const [weekRoomId, setWeekRoomId] = useState('');
  const [weekAnchorDate, setWeekAnchorDate] = useState(todayStr());
  const [weekReservations, setWeekReservations] = useState([]);
  const [weekLoading, setWeekLoading] = useState(false);
  const [weekError, setWeekError] = useState(null);

  // ---------- Sanciones ----------
  const [sanctions, setSanctions] = useState([]);
  const [sanctionsLoading, setSanctionsLoading] = useState(false);
  const [sanctionsError, setSanctionsError] = useState(null);
  const [showAllSanctions, setShowAllSanctions] = useState(false);
  const [liftingId, setLiftingId] = useState(null);

  const [sEmail, setSEmail] = useState('@udea.edu.co');
  const [sName, setSName] = useState('');
  const [sReason, setSReason] = useState('');
  const [sUntil, setSUntil] = useState(() => toLocalInputValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));
  const [sSubmitting, setSSubmitting] = useState(false);
  const [sFormError, setSFormError] = useState(null);
  const [sFormSuccess, setSFormSuccess] = useState(null);
  const [sNeedsName, setSNeedsName] = useState(false);

  // ---------- Instrumentos ----------
  const [instruments, setInstruments] = useState([]);
  const [instrumentsLoading, setInstrumentsLoading] = useState(false);
  const [instrumentsError, setInstrumentsError] = useState(null);
  const [showInactiveInstruments, setShowInactiveInstruments] = useState(false);

  const [iName, setIName] = useState('');
  const [iInventoryNumber, setIInventoryNumber] = useState('');
  const [iSubmitting, setISubmitting] = useState(false);
  const [iFormError, setIFormError] = useState(null);
  const [iFormSuccess, setIFormSuccess] = useState(null);

  const [editingInstrumentId, setEditingInstrumentId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editInventoryNumber, setEditInventoryNumber] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState(null);
  const [toggleId, setToggleId] = useState(null);

  const instrumentFileInputRef = useRef(null);
  const [instrumentFileName, setInstrumentFileName] = useState(null);
  const [instrumentParsing, setInstrumentParsing] = useState(false);
  const [instrumentParsedRows, setInstrumentParsedRows] = useState([]);
  const [instrumentUploadError, setInstrumentUploadError] = useState(null);
  const [instrumentUploadProcessing, setInstrumentUploadProcessing] = useState(false);
  const [instrumentUploadResults, setInstrumentUploadResults] = useState(null);

  // ---------- Préstamos de instrumentos ----------
  const [instrumentLoansDate, setInstrumentLoansDate] = useState(todayStr());
  const [instrumentLoans, setInstrumentLoans] = useState([]);
  const [instrumentLoansLoading, setInstrumentLoansLoading] = useState(false);
  const [instrumentLoansError, setInstrumentLoansError] = useState(null);
  const [instrumentLoanActionId, setInstrumentLoanActionId] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === null) router.push('/admin/login');
  }, [session, router]);

  const loadReservations = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    const { data, error } = await supabase
      .from('reservations')
      .select('id, room_id, date, start_time, end_time, status, checked_in_at, rooms ( name, type ), app_users ( name, email )')
      .eq('date', date)
      .neq('status', 'cancelada')
      .neq('status', 'rechazada')
      .order('start_time', { ascending: true });

    if (error) {
      console.error('[admin] error cargando reservas:', error);
      setListError(`No se pudieron cargar las reservas: ${error.message}`);
      setReservations([]);
    } else {
      setReservations(data || []);
    }
    setLoadingList(false);
  }, [date]);

  useEffect(() => {
    if (session) loadReservations();
  }, [session, loadReservations]);

  useEffect(() => {
    if (!session) return;
    supabase
      .from('rooms')
      .select('id, code, name, type')
      .order('type', { ascending: true })
      .order('code', { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          console.error('[admin] error cargando espacios:', error);
          setRoomsError(`No se pudieron cargar los espacios: ${error.message}`);
        } else {
          setRooms(data || []);
        }
      });
  }, [session]);

  const loadWeekReservations = useCallback(async () => {
    if (!weekRoomId) {
      setWeekReservations([]);
      return;
    }
    setWeekLoading(true);
    setWeekError(null);

    const weekDates = getWeekRange(weekAnchorDate);
    const { data, error } = await supabase
      .from('reservations')
      .select('id, date, start_time, end_time, status, app_users ( name, email )')
      .eq('room_id', weekRoomId)
      .gte('date', weekDates[0])
      .lte('date', weekDates[6])
      .neq('status', 'cancelada')
      .neq('status', 'rechazada')
      .order('start_time', { ascending: true });

    if (error) {
      console.error('[admin] error cargando reservas de la semana:', error);
      setWeekError(`No se pudieron cargar las reservas: ${error.message}`);
      setWeekReservations([]);
    } else {
      setWeekReservations(data || []);
    }
    setWeekLoading(false);
  }, [weekRoomId, weekAnchorDate]);

  useEffect(() => {
    if (session && view === 'semana') loadWeekReservations();
  }, [session, view, loadWeekReservations]);

  const loadSanctions = useCallback(async () => {
    setSanctionsLoading(true);
    setSanctionsError(null);
    const { data, error } = await supabase
      .from('sanctions')
      .select('id, reason, until, created_at, app_users!sanctions_user_id_fkey ( name, email )')
      .order('until', { ascending: false });

    if (error) {
      console.error('[admin] error cargando sanciones:', error);
      setSanctionsError(`No se pudieron cargar las sanciones: ${error.message}`);
      setSanctions([]);
    } else {
      setSanctions(data || []);
    }
    setSanctionsLoading(false);
  }, []);

  useEffect(() => {
    if (session && view === 'sanciones') loadSanctions();
  }, [session, view, loadSanctions]);

  const loadInstruments = useCallback(async () => {
    setInstrumentsLoading(true);
    setInstrumentsError(null);
    const { data, error } = await supabase
      .from('instruments')
      .select('id, name, inventory_number, active')
      .order('name', { ascending: true });

    if (error) {
      console.error('[admin] error cargando instrumentos:', error);
      setInstrumentsError(`No se pudieron cargar los instrumentos: ${error.message}`);
      setInstruments([]);
    } else {
      setInstruments(data || []);
    }
    setInstrumentsLoading(false);
  }, []);

  useEffect(() => {
    if (session && view === 'instrumentos') loadInstruments();
  }, [session, view, loadInstruments]);

  const loadInstrumentLoans = useCallback(async () => {
    setInstrumentLoansLoading(true);
    setInstrumentLoansError(null);
    const { data, error } = await supabase
      .from('instrument_reservations')
      .select('id, date, start_time, end_time, status, instruments ( name ), app_users ( name, email )')
      .eq('date', instrumentLoansDate)
      .neq('status', 'cancelada')
      .order('start_time', { ascending: true });

    if (error) {
      console.error('[admin] error cargando préstamos:', error);
      setInstrumentLoansError(`No se pudieron cargar los préstamos: ${error.message}`);
      setInstrumentLoans([]);
    } else {
      setInstrumentLoans(data || []);
    }
    setInstrumentLoansLoading(false);
  }, [instrumentLoansDate]);

  useEffect(() => {
    if (session && view === 'instrumentos') loadInstrumentLoans();
  }, [session, view, loadInstrumentLoans]);

  // Cuando cambia el correo escrito, revisamos si ya existe esa persona
  // para no pedir el nombre otra vez si ya la tenemos registrada.
  useEffect(() => {
    const email = sEmail.trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      setSNeedsName(false);
      return;
    }
    let cancelled = false;
    supabase
      .from('app_users')
      .select('id, name')
      .eq('email', email)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) {
          setSNeedsName(false);
          setSName(data.name || '');
        } else {
          setSNeedsName(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sEmail]);

  async function handleCheckIn(id) {
    setActionId(id);
    const { error } = await supabase
      .from('reservations')
      .update({ checked_in_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error('[admin] error confirmando asistencia:', error);
      setListError(`No se pudo confirmar la asistencia: ${error.message}`);
    } else {
      await loadReservations();
    }
    setActionId(null);
  }

  async function handleCancel(id) {
    setActionId(id);
    const { error } = await supabase
      .from('reservations')
      .update({ status: 'cancelada' })
      .eq('id', id);
    if (error) {
      console.error('[admin] error cancelando:', error);
      setListError(`No se pudo cancelar la reserva: ${error.message}`);
    } else {
      await loadReservations();
    }
    setActionId(null);
  }

  async function handleApprove(id) {
    setActionId(id);
    const { error } = await supabase
      .from('reservations')
      .update({ status: 'confirmada' })
      .eq('id', id);
    if (error) {
      console.error('[admin] error aprobando:', error);
      setListError(`No se pudo aprobar la reserva: ${error.message}`);
    } else {
      await loadReservations();
    }
    setActionId(null);
  }

  async function handleReject(id) {
    setActionId(id);
    const { error } = await supabase
      .from('reservations')
      .update({ status: 'rechazada' })
      .eq('id', id);
    if (error) {
      console.error('[admin] error rechazando:', error);
      setListError(`No se pudo rechazar la reserva: ${error.message}`);
    } else {
      await loadReservations();
    }
    setActionId(null);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/admin/login');
  }

  async function handleCreateSanction(e) {
    e.preventDefault();
    setSFormError(null);
    setSFormSuccess(null);

    const email = sEmail.trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      setSFormError('Usa un correo institucional con dominio @udea.edu.co.');
      return;
    }
    if (sNeedsName && !sName.trim()) {
      setSFormError('Esta persona no está registrada todavía — ingresa su nombre completo.');
      return;
    }
    if (!sUntil) {
      setSFormError('Elige hasta cuándo dura la sanción.');
      return;
    }
    const untilIso = new Date(`${sUntil}:00-05:00`).toISOString();
    if (new Date(untilIso) <= new Date()) {
      setSFormError('La fecha de la sanción debe ser en el futuro.');
      return;
    }

    setSSubmitting(true);
    try {
      let userId;
      const { data: existingUser, error: findError } = await supabase
        .from('app_users')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (findError) {
        setSFormError(`No se pudo buscar el usuario: ${findError.message}`);
        setSSubmitting(false);
        return;
      }

      if (existingUser) {
        userId = existingUser.id;
      } else {
        const { data: newUser, error: insertUserError } = await supabase
          .from('app_users')
          .insert({ email, name: sName.trim() })
          .select('id')
          .single();
        if (insertUserError) {
          setSFormError(`No se pudo crear la persona: ${insertUserError.message}`);
          setSSubmitting(false);
          return;
        }
        userId = newUser.id;
      }

      const { error: insertSanctionError } = await supabase
        .from('sanctions')
        .insert({
          user_id: userId,
          reason: sReason.trim() || null,
          until: untilIso,
          created_by: session.user.id,
        });

      if (insertSanctionError) {
        setSFormError(`No se pudo crear la sanción: ${insertSanctionError.message}`);
        setSSubmitting(false);
        return;
      }

      setSFormSuccess('Sanción creada correctamente.');
      setSEmail('@udea.edu.co');
      setSName('');
      setSReason('');
      setSUntil(toLocalInputValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));
      await loadSanctions();
    } catch (err) {
      console.error('[admin] error inesperado creando sanción:', err);
      setSFormError('Ocurrió un error inesperado. Intenta de nuevo.');
    } finally {
      setSSubmitting(false);
    }
  }

  async function handleLiftSanction(id) {
    setLiftingId(id);
    const { error } = await supabase.from('sanctions').delete().eq('id', id);
    if (error) {
      console.error('[admin] error levantando sanción:', error);
      setSanctionsError(`No se pudo levantar la sanción: ${error.message}`);
    } else {
      await loadSanctions();
    }
    setLiftingId(null);
  }

  async function handleCreateInstrument(e) {
    e.preventDefault();
    setIFormError(null);
    setIFormSuccess(null);

    const name = iName.trim();
    const inventoryNumber = iInventoryNumber.trim();
    if (!name) {
      setIFormError('Escribe el nombre del instrumento.');
      return;
    }
    if (!inventoryNumber) {
      setIFormError('Escribe el número de inventario.');
      return;
    }

    setISubmitting(true);
    const { error } = await supabase
      .from('instruments')
      .insert({ name, inventory_number: inventoryNumber });

    if (error) {
      console.error('[admin] error creando instrumento:', error);
      if (error.code === '23505') {
        setIFormError('Ya existe un instrumento con ese número de inventario.');
      } else {
        setIFormError(`No se pudo crear el instrumento: ${error.message}`);
      }
      setISubmitting(false);
      return;
    }

    setIFormSuccess('Instrumento agregado correctamente.');
    setIName('');
    setIInventoryNumber('');
    setICategory('viento');
    await loadInstruments();
    setISubmitting(false);
  }

  async function handleToggleInstrumentActive(instrument) {
    setToggleId(instrument.id);
    const { error } = await supabase
      .from('instruments')
      .update({ active: !instrument.active })
      .eq('id', instrument.id);
    if (error) {
      console.error('[admin] error actualizando instrumento:', error);
      setInstrumentsError(`No se pudo actualizar el instrumento: ${error.message}`);
    } else {
      await loadInstruments();
    }
    setToggleId(null);
  }

  async function handleCancelInstrumentLoan(id) {
    setInstrumentLoanActionId(id);
    const { error } = await supabase
      .from('instrument_reservations')
      .update({ status: 'cancelada' })
      .eq('id', id);
    if (error) {
      console.error('[admin] error cancelando préstamo:', error);
      setInstrumentLoansError(`No se pudo cancelar el préstamo: ${error.message}`);
    } else {
      await loadInstrumentLoans();
    }
    setInstrumentLoanActionId(null);
  }

  function startEditInstrument(instrument) {
    setEditingInstrumentId(instrument.id);
    setEditName(instrument.name);
    setEditInventoryNumber(instrument.inventory_number);
    setEditError(null);
  }

  function cancelEditInstrument() {
    setEditingInstrumentId(null);
    setEditError(null);
  }

  async function saveEditInstrument(id) {
    const name = editName.trim();
    const inventoryNumber = editInventoryNumber.trim();
    if (!name || !inventoryNumber) {
      setEditError('El nombre y el número de inventario no pueden quedar vacíos.');
      return;
    }
    setEditSubmitting(true);
    setEditError(null);
    const { error } = await supabase
      .from('instruments')
      .update({ name, inventory_number: inventoryNumber })
      .eq('id', id);

    if (error) {
      console.error('[admin] error editando instrumento:', error);
      if (error.code === '23505') {
        setEditError('Ya existe un instrumento con ese número de inventario.');
      } else {
        setEditError(`No se pudo guardar: ${error.message}`);
      }
      setEditSubmitting(false);
      return;
    }

    setEditingInstrumentId(null);
    setEditSubmitting(false);
    await loadInstruments();
  }

  async function handleDownloadInstrumentTemplate() {
    const XLSX = await import('xlsx');
    const example = ['Violín 3/4', 'Cuerda', 'INV-0042'];
    const ws = XLSX.utils.aoa_to_sheet([INSTRUMENT_TEMPLATE_HEADERS, example]);
    ws['!cols'] = INSTRUMENT_TEMPLATE_HEADERS.map(() => ({ wch: 22 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Plantilla');
    XLSX.writeFile(wb, 'plantilla-instrumentos.xlsx');
  }

  async function handleInstrumentFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setInstrumentFileName(file.name);
    setInstrumentUploadResults(null);
    setInstrumentUploadError(null);
    setInstrumentParsedRows([]);
    setInstrumentParsing(true);

    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (rawRows.length === 0) {
        setInstrumentUploadError('El archivo no tiene filas de datos (solo encabezados, o está vacío).');
        setInstrumentParsing(false);
        return;
      }

      const validated = rawRows
        .map((row, idx) => validateInstrumentRow(row, idx + 2))
        .filter((row) => row.name || row.inventoryNumber);

      setInstrumentParsedRows(validated);
    } catch (err) {
      console.error('[admin] error leyendo archivo de instrumentos:', err);
      setInstrumentUploadError('No se pudo leer el archivo. Asegúrate de que sea un .xlsx válido y siga el formato de la plantilla.');
    } finally {
      setInstrumentParsing(false);
    }
  }

  async function handleConfirmInstrumentUpload() {
    const validRows = instrumentParsedRows.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) return;

    setInstrumentUploadProcessing(true);
    setInstrumentUploadResults(null);

    let created = 0;
    let skipped = 0;
    const rowResults = [];

    for (const row of validRows) {
      const { error } = await supabase
        .from('instruments')
        .insert({ name: row.name, inventory_number: row.inventoryNumber });

      if (error) {
        skipped += 1;
        rowResults.push({
          rowNumber: row.rowNumber,
          name: row.name,
          ok: false,
          error: error.code === '23505' ? 'Ya existe un instrumento con ese número de inventario.' : error.message,
        });
      } else {
        created += 1;
        rowResults.push({ rowNumber: row.rowNumber, name: row.name, ok: true });
      }
    }

    setInstrumentUploadResults({ created, skipped, rowResults });
    setInstrumentUploadProcessing(false);
    await loadInstruments();
  }

  function handleResetInstrumentUpload() {
    setInstrumentFileName(null);
    setInstrumentParsedRows([]);
    setInstrumentUploadResults(null);
    setInstrumentUploadError(null);
    if (instrumentFileInputRef.current) instrumentFileInputRef.current.value = '';
  }

  if (session === undefined) {
    return <main style={{ padding: 40, textAlign: 'center', color: '#5B6B60' }}>Cargando…</main>;
  }
  if (!session) {
    return null;
  }

  const reservationsByRoom = {};
  for (const r of reservations) {
    if (!reservationsByRoom[r.room_id]) reservationsByRoom[r.room_id] = [];
    reservationsByRoom[r.room_id].push(r);
  }

  const visibleRooms = occupancyType === 'todos' ? rooms : rooms.filter((r) => r.type === occupancyType);
  const roomGroups =
    occupancyType === 'todos'
      ? ROOM_TYPE_ORDER.map((t) => ({ type: t, rooms: rooms.filter((r) => r.type === t) })).filter((g) => g.rooms.length > 0)
      : [{ type: occupancyType, rooms: visibleRooms }];

  const now = new Date();
  const visibleSanctions = showAllSanctions ? sanctions : sanctions.filter((s) => new Date(s.until) > now);

  const visibleInstruments = instruments.filter((i) => {
    if (!showInactiveInstruments && !i.active) return false;
    return true;
  });

  const instrumentValidCount = instrumentParsedRows.filter((r) => r.errors.length === 0).length;
  const instrumentInvalidCount = instrumentParsedRows.length - instrumentValidCount;

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 22, margin: 0 }}>Panel de administrador</h1>
          <p style={{ color: '#5B6B60', fontSize: 13, margin: '4px 0 0' }}>
            Sesión iniciada como <strong>{session.user.email}</strong>
          </p>
        </div>
        <button onClick={handleLogout}
          style={{ padding: '8px 16px', background: 'transparent', border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
          Cerrar sesión
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid #DBDCCF', flexWrap: 'wrap' }}>
        <button
          onClick={() => setView('lista')}
          style={{
            padding: '10px 4px', fontSize: 14, fontWeight: 600, background: 'transparent', cursor: 'pointer',
            border: 'none', borderBottom: view === 'lista' ? '2px solid #0B6E4F' : '2px solid transparent',
            color: view === 'lista' ? '#0B6E4F' : '#5B6B60', marginRight: 20,
          }}
        >
          Reservas del día
        </button>
        <button
          onClick={() => setView('ocupacion')}
          style={{
            padding: '10px 4px', fontSize: 14, fontWeight: 600, background: 'transparent', cursor: 'pointer',
            border: 'none', borderBottom: view === 'ocupacion' ? '2px solid #0B6E4F' : '2px solid transparent',
            color: view === 'ocupacion' ? '#0B6E4F' : '#5B6B60', marginRight: 20,
          }}
        >
          Ocupación
        </button>
        <button
          onClick={() => setView('semana')}
          style={{
            padding: '10px 4px', fontSize: 14, fontWeight: 600, background: 'transparent', cursor: 'pointer',
            border: 'none', borderBottom: view === 'semana' ? '2px solid #0B6E4F' : '2px solid transparent',
            color: view === 'semana' ? '#0B6E4F' : '#5B6B60', marginRight: 20,
          }}
        >
          Por semana
        </button>
        <button
          onClick={() => setView('sanciones')}
          style={{
            padding: '10px 4px', fontSize: 14, fontWeight: 600, background: 'transparent', cursor: 'pointer',
            border: 'none', borderBottom: view === 'sanciones' ? '2px solid #0B6E4F' : '2px solid transparent',
            color: view === 'sanciones' ? '#0B6E4F' : '#5B6B60', marginRight: 20,
          }}
        >
          Sanciones
        </button>
        <button
          onClick={() => setView('instrumentos')}
          style={{
            padding: '10px 4px', fontSize: 14, fontWeight: 600, background: 'transparent', cursor: 'pointer',
            border: 'none', borderBottom: view === 'instrumentos' ? '2px solid #0B6E4F' : '2px solid transparent',
            color: view === 'instrumentos' ? '#0B6E4F' : '#5B6B60', marginRight: 20,
          }}
        >
          Instrumentos
        </button>
        <a
          href="/admin/carga-masiva"
          style={{
            padding: '10px 4px', fontSize: 14, fontWeight: 600, background: 'transparent', cursor: 'pointer',
            border: 'none', borderBottom: '2px solid transparent', color: '#5B6B60', textDecoration: 'none',
          }}
        >
          Carga masiva
        </a>
      </div>

      {(view === 'lista' || view === 'ocupacion') && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            style={{ padding: 8, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 14 }} />
          {view === 'lista' && (
            <span style={{ fontSize: 13, color: '#5B6B60' }}>
              {loadingList ? 'Cargando…' : `${reservations.length} reserva(s)`}
            </span>
          )}
        </div>
      )}

      {view === 'lista' && (
        <>
          {listError && (
            <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
              {listError}
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #DBDCCF' }}>
                  <th style={{ padding: 8 }}>Espacio</th>
                  <th style={{ padding: 8 }}>Horario</th>
                  <th style={{ padding: 8 }}>Solicitante</th>
                  <th style={{ padding: 8 }}>Estado</th>
                  <th style={{ padding: 8 }}></th>
                </tr>
              </thead>
              <tbody>
                {reservations.length === 0 && !loadingList && (
                  <tr>
                    <td colSpan={5} style={{ padding: 20, textAlign: 'center', color: '#5B6B60' }}>
                      Sin reservas para esta fecha.
                    </td>
                  </tr>
                )}
                {reservations.map((r) => {
                  const canCheckIn = r.status === 'confirmada' && !r.checked_in_at;
                  const canCancel = r.status !== 'cancelada';
                  const canApproveReject = r.status === 'pendiente';
                  const colors = STATUS_COLOR[r.status] || { bg: '#eee', fg: '#333' };
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid #DBDCCF' }}>
                      <td style={{ padding: 8 }}>{r.rooms?.name || '—'}</td>
                      <td style={{ padding: 8, fontFamily: 'monospace' }}>
                        {r.start_time?.slice(0, 5)}-{r.end_time?.slice(0, 5)}
                      </td>
                      <td style={{ padding: 8 }}>
                        {r.app_users?.name || '—'}
                        <br />
                        <span style={{ color: '#5B6B60', fontSize: 11 }}>{r.app_users?.email}</span>
                      </td>
                      <td style={{ padding: 8 }}>
                        <span style={{ background: colors.bg, color: colors.fg, fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20 }}>
                          {STATUS_LABEL[r.status] || r.status}
                        </span>
                        {r.checked_in_at && (
                          <div style={{ fontSize: 10, color: '#5B6B60', marginTop: 2 }}>asistió</div>
                        )}
                      </td>
                      <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                        {canApproveReject && (
                          <>
                            <button onClick={() => handleApprove(r.id)} disabled={actionId === r.id}
                              style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #0B6E4F', color: '#0B6E4F', borderRadius: 6, background: 'transparent', cursor: 'pointer', marginRight: 6 }}>
                              Aprobar
                            </button>
                            <button onClick={() => handleReject(r.id)} disabled={actionId === r.id}
                              style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #A23E33', color: '#A23E33', borderRadius: 6, background: 'transparent', cursor: 'pointer', marginRight: 6 }}>
                              Rechazar
                            </button>
                          </>
                        )}
                        {canCheckIn && (
                          <button onClick={() => handleCheckIn(r.id)} disabled={actionId === r.id}
                            style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #16241C', borderRadius: 6, background: 'transparent', cursor: 'pointer', marginRight: 6 }}>
                            Confirmar asistencia
                          </button>
                        )}
                        {canCancel && (
                          <button onClick={() => handleCancel(r.id)} disabled={actionId === r.id}
                            style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #A23E33', color: '#A23E33', borderRadius: 6, background: 'transparent', cursor: 'pointer' }}>
                            Cancelar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === 'ocupacion' && (
        <>
          {roomsError && (
            <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
              {roomsError}
            </div>
          )}
          {listError && (
            <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
              {listError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            {OCCUPANCY_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setOccupancyType(t.key)}
                style={{
                  padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 20, cursor: 'pointer',
                  border: occupancyType === t.key ? '1px solid #0B6E4F' : '1px solid #DBDCCF',
                  background: occupancyType === t.key ? '#0B6E4F' : '#fff',
                  color: occupancyType === t.key ? '#fff' : '#16241C',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
            {Object.entries(STATUS_COLOR)
              .filter(([key]) => key !== 'cancelada' && key !== 'rechazada')
              .map(([key, colors]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#5B6B60' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: colors.fg, display: 'inline-block' }} />
                  {STATUS_LABEL[key]}
                </div>
              ))}
          </div>

          {rooms.length === 0 && !roomsError && (
            <p style={{ color: '#5B6B60', fontSize: 13 }}>Cargando espacios…</p>
          )}

          {roomGroups.map((group) => (
            <div key={group.type} style={{ marginBottom: 28 }}>
              {occupancyType === 'todos' && (
                <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 15, margin: '0 0 10px' }}>
                  {ROOM_TYPE_LABEL[group.type]}
                </h3>
              )}

              <div style={{ display: 'flex', marginBottom: 6 }}>
                <div style={{ width: 130, flexShrink: 0 }} />
                <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#5B6B60' }}>
                  {HOUR_MARKS.map((h) => (
                    <span key={h}>{h}h</span>
                  ))}
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 560 }}>
                  {group.rooms.map((room) => {
                    const roomReservations = reservationsByRoom[room.id] || [];
                    return (
                      <div key={room.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                        <button
                          onClick={() => {
                            setWeekRoomId(room.id);
                            setWeekAnchorDate(date);
                            setView('semana');
                          }}
                          style={{
                            width: 130, flexShrink: 0, fontSize: 12, paddingRight: 8, overflow: 'hidden', textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap', textAlign: 'left', background: 'transparent', border: 'none', padding: 0,
                            color: '#0B6E4F', textDecoration: 'underline', cursor: 'pointer',
                          }}
                          title="Ver ocupación semanal de este espacio"
                        >
                          {room.name}
                        </button>
                        <div style={{ flex: 1, position: 'relative', height: 26, background: '#F5F4EC', borderRadius: 4 }}>
                          {roomReservations.map((r) => {
                            const colors = STATUS_COLOR[r.status] || { bg: '#eee', fg: '#333' };
                            const left = pctLeft(r.start_time);
                            const width = pctWidth(r.start_time, r.end_time);
                            return (
                              <div
                                key={r.id}
                                title={`${r.start_time.slice(0, 5)}-${r.end_time.slice(0, 5)} · ${r.app_users?.name || ''} · ${STATUS_LABEL[r.status] || r.status}`}
                                style={{
                                  position: 'absolute', top: 2, bottom: 2,
                                  left: `${left}%`, width: `${width}%`,
                                  background: colors.fg, borderRadius: 4,
                                  fontSize: 10, color: '#fff', display: 'flex', alignItems: 'center',
                                  justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap', padding: '0 4px',
                                }}
                              >
                                {r.start_time.slice(0, 5)}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {view === 'sanciones' && (
        <>
          <div style={{ background: '#F5F4EC', border: '1px solid #DBDCCF', borderRadius: 8, padding: 18, marginBottom: 26 }}>
            <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 16, margin: '0 0 14px' }}>Sancionar a alguien</h2>

            <form onSubmit={handleCreateSanction}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Correo institucional
                  </label>
                  <input
                    type="email"
                    value={sEmail}
                    onChange={(e) => setSEmail(e.target.value)}
                    required
                    style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Nombre {sNeedsName ? '(persona nueva, requerido)' : '(opcional)'}
                  </label>
                  <input
                    type="text"
                    value={sName}
                    onChange={(e) => setSName(e.target.value)}
                    required={sNeedsName}
                    style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Motivo (opcional, pero recomendado)
                </label>
                <input
                  type="text"
                  value={sReason}
                  onChange={(e) => setSReason(e.target.value)}
                  placeholder="Ej: no se presentó a 3 reservas seguidas"
                  style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Sancionado hasta
                </label>
                <input
                  type="datetime-local"
                  value={sUntil}
                  onChange={(e) => setSUntil(e.target.value)}
                  required
                  style={{ padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF' }}
                />
              </div>

              {sFormError && (
                <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
                  {sFormError}
                </div>
              )}
              {sFormSuccess && (
                <div style={{ background: '#E4F0EA', border: '1px solid #bcd9c9', color: '#084F39', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
                  {sFormSuccess}
                </div>
              )}

              <button
                type="submit"
                disabled={sSubmitting}
                style={{
                  padding: '9px 18px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: '1px solid #A23E33',
                  background: '#A23E33', color: '#fff', cursor: sSubmitting ? 'not-allowed' : 'pointer', opacity: sSubmitting ? 0.7 : 1,
                }}
              >
                {sSubmitting ? 'Guardando...' : 'Sancionar'}
              </button>
            </form>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 16, margin: 0 }}>
              {showAllSanctions ? 'Historial de sanciones' : 'Sanciones activas'}
            </h2>
            <button
              onClick={() => setShowAllSanctions((v) => !v)}
              style={{ padding: '6px 12px', fontSize: 12, borderRadius: 6, border: '1px solid #DBDCCF', background: '#fff', cursor: 'pointer' }}
            >
              {showAllSanctions ? 'Ver solo activas' : 'Ver historial completo'}
            </button>
          </div>

          {sanctionsError && (
            <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
              {sanctionsError}
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #DBDCCF' }}>
                  <th style={{ padding: 8 }}>Persona</th>
                  <th style={{ padding: 8 }}>Motivo</th>
                  <th style={{ padding: 8 }}>Hasta</th>
                  <th style={{ padding: 8 }}>Estado</th>
                  <th style={{ padding: 8 }}></th>
                </tr>
              </thead>
              <tbody>
                {visibleSanctions.length === 0 && !sanctionsLoading && (
                  <tr>
                    <td colSpan={5} style={{ padding: 20, textAlign: 'center', color: '#5B6B60' }}>
                      {showAllSanctions ? 'No hay sanciones registradas.' : 'No hay sanciones activas en este momento.'}
                    </td>
                  </tr>
                )}
                {visibleSanctions.map((s) => {
                  const isActive = new Date(s.until) > now;
                  return (
                    <tr key={s.id} style={{ borderBottom: '1px solid #DBDCCF' }}>
                      <td style={{ padding: 8 }}>
                        {s.app_users?.name || '—'}
                        <br />
                        <span style={{ color: '#5B6B60', fontSize: 11 }}>{s.app_users?.email}</span>
                      </td>
                      <td style={{ padding: 8 }}>{s.reason || '—'}</td>
                      <td style={{ padding: 8 }}>
                        {new Date(s.until).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
                      </td>
                      <td style={{ padding: 8 }}>
                        <span
                          style={{
                            background: isActive ? '#F7E8E5' : '#eee',
                            color: isActive ? '#A23E33' : '#888',
                            fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
                          }}
                        >
                          {isActive ? 'Activa' : 'Vencida'}
                        </span>
                      </td>
                      <td style={{ padding: 8 }}>
                        {isActive && (
                          <button
                            onClick={() => handleLiftSanction(s.id)}
                            disabled={liftingId === s.id}
                            style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #16241C', borderRadius: 6, background: 'transparent', cursor: 'pointer' }}
                          >
                            {liftingId === s.id ? 'Levantando...' : 'Levantar sanción'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === 'instrumentos' && (
        <>
          <div style={{ background: '#F5F4EC', border: '1px solid #DBDCCF', borderRadius: 8, padding: 18, marginBottom: 26 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
              <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 16, margin: 0 }}>Préstamos reservados</h2>
              <input
                type="date"
                value={instrumentLoansDate}
                onChange={(e) => setInstrumentLoansDate(e.target.value)}
                style={{ padding: 8, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 13 }}
              />
            </div>

            {instrumentLoansError && (
              <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
                {instrumentLoansError}
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #DBDCCF' }}>
                    <th style={{ padding: 8 }}>Instrumento</th>
                    <th style={{ padding: 8 }}>Horario</th>
                    <th style={{ padding: 8 }}>Solicitante</th>
                    <th style={{ padding: 8 }}>Estado</th>
                    <th style={{ padding: 8 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {instrumentLoans.length === 0 && !instrumentLoansLoading && (
                    <tr>
                      <td colSpan={5} style={{ padding: 20, textAlign: 'center', color: '#5B6B60' }}>
                        Sin préstamos reservados para esta fecha.
                      </td>
                    </tr>
                  )}
                  {instrumentLoans.map((loan) => {
                    const colors = STATUS_COLOR[loan.status] || { bg: '#eee', fg: '#333' };
                    return (
                      <tr key={loan.id} style={{ borderBottom: '1px solid #DBDCCF' }}>
                        <td style={{ padding: 8 }}>{loan.instruments?.name || '—'}</td>
                        <td style={{ padding: 8, fontFamily: 'monospace' }}>
                          {loan.start_time?.slice(0, 5)}-{loan.end_time?.slice(0, 5)}
                        </td>
                        <td style={{ padding: 8 }}>
                          {loan.app_users?.name || '—'}
                          <br />
                          <span style={{ color: '#5B6B60', fontSize: 11 }}>{loan.app_users?.email}</span>
                        </td>
                        <td style={{ padding: 8 }}>
                          <span style={{ background: colors.bg, color: colors.fg, fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20 }}>
                            {STATUS_LABEL[loan.status] || loan.status}
                          </span>
                        </td>
                        <td style={{ padding: 8 }}>
                          <button
                            onClick={() => handleCancelInstrumentLoan(loan.id)}
                            disabled={instrumentLoanActionId === loan.id}
                            style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #A23E33', color: '#A23E33', borderRadius: 6, background: 'transparent', cursor: 'pointer' }}
                          >
                            {instrumentLoanActionId === loan.id ? '...' : 'Cancelar'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ background: '#F5F4EC', border: '1px solid #DBDCCF', borderRadius: 8, padding: 18, marginBottom: 26 }}>
            <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 16, margin: '0 0 14px' }}>Agregar instrumento</h2>

            <form onSubmit={handleCreateInstrument}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Nombre
                  </label>
                  <input
                    type="text"
                    value={iName}
                    onChange={(e) => setIName(e.target.value)}
                    placeholder="Ej: Violín 3/4"
                    required
                    style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    N° de inventario
                  </label>
                  <input
                    type="text"
                    value={iInventoryNumber}
                    onChange={(e) => setIInventoryNumber(e.target.value)}
                    placeholder="Ej: INV-0042"
                    required
                    style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              {iFormError && (
                <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
                  {iFormError}
                </div>
              )}
              {iFormSuccess && (
                <div style={{ background: '#E4F0EA', border: '1px solid #bcd9c9', color: '#084F39', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
                  {iFormSuccess}
                </div>
              )}

              <button
                type="submit"
                disabled={iSubmitting}
                style={{
                  padding: '9px 18px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: '1px solid #0B6E4F',
                  background: '#0B6E4F', color: '#fff', cursor: iSubmitting ? 'not-allowed' : 'pointer', opacity: iSubmitting ? 0.7 : 1,
                }}
              >
                {iSubmitting ? 'Guardando...' : 'Agregar instrumento'}
              </button>
            </form>
          </div>

          <div style={{ background: '#F5F4EC', border: '1px solid #DBDCCF', borderRadius: 8, padding: 18, marginBottom: 26 }}>
            <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 16, margin: '0 0 6px' }}>O carga varios de una vez desde un Excel</h2>
            <p style={{ fontSize: 12, color: '#5B6B60', margin: '0 0 10px' }}>
              El archivo debe tener estas columnas exactas en la primera fila:
            </p>
            <div style={{ fontFamily: 'monospace', fontSize: 12, background: '#fff', border: '1px solid #DBDCCF', borderRadius: 6, padding: 10, marginBottom: 10, overflowX: 'auto', whiteSpace: 'nowrap' }}>
              {INSTRUMENT_TEMPLATE_HEADERS.join(' | ')}
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
              <button
                onClick={handleDownloadInstrumentTemplate}
                style={{ padding: '8px 16px', fontSize: 13, borderRadius: 6, border: '1px solid #0B6E4F', color: '#0B6E4F', background: 'transparent', cursor: 'pointer' }}
              >
                Descargar plantilla
              </button>
              <input
                ref={instrumentFileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleInstrumentFileChange}
                style={{ fontSize: 13 }}
              />
              {instrumentFileName && (
                <span style={{ fontSize: 12, color: '#5B6B60' }}>
                  {instrumentParsing ? 'Leyendo…' : instrumentFileName}
                </span>
              )}
            </div>

            {instrumentUploadError && (
              <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 10, borderRadius: 6, marginBottom: 14, fontSize: 12 }}>
                {instrumentUploadError}
              </div>
            )}

            {instrumentParsedRows.length > 0 && !instrumentUploadResults && (
              <div>
                <p style={{ fontSize: 13, color: '#5B6B60', marginBottom: 10 }}>
                  {instrumentValidCount} fila(s) lista(s) para cargar
                  {instrumentInvalidCount > 0 && (
                    <> · <span style={{ color: '#A23E33' }}>{instrumentInvalidCount} fila(s) con errores (no se cargarán)</span></>
                  )}
                </p>

                <div style={{ overflowX: 'auto', marginBottom: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid #DBDCCF' }}>
                        <th style={{ padding: 6 }}>Fila</th>
                        <th style={{ padding: 6 }}>Nombre</th>
                        <th style={{ padding: 6 }}>N° inventario</th>
                        <th style={{ padding: 6 }}>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {instrumentParsedRows.map((row) => (
                        <tr key={row.rowNumber} style={{ borderBottom: '1px solid #DBDCCF' }}>
                          <td style={{ padding: 6 }}>{row.rowNumber}</td>
                          <td style={{ padding: 6 }}>{row.name || '—'}</td>
                          <td style={{ padding: 6, fontFamily: 'monospace' }}>{row.inventoryNumber || '—'}</td>
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

                {instrumentInvalidCount > 0 && (
                  <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
                    <strong>Detalle de errores:</strong>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      {instrumentParsedRows.filter((r) => r.errors.length > 0).map((r) => (
                        <li key={r.rowNumber}>Fila {r.rowNumber}: {r.errors.join(' ')}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={handleConfirmInstrumentUpload}
                    disabled={instrumentUploadProcessing || instrumentValidCount === 0}
                    style={{
                      padding: '9px 18px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: '1px solid #0B6E4F',
                      background: '#0B6E4F', color: '#fff', cursor: instrumentUploadProcessing || instrumentValidCount === 0 ? 'not-allowed' : 'pointer',
                      opacity: instrumentUploadProcessing || instrumentValidCount === 0 ? 0.6 : 1,
                    }}
                  >
                    {instrumentUploadProcessing ? 'Cargando…' : `Confirmar carga (${instrumentValidCount})`}
                  </button>
                  <button
                    onClick={handleResetInstrumentUpload}
                    disabled={instrumentUploadProcessing}
                    style={{ padding: '9px 18px', fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', background: '#fff', cursor: 'pointer' }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {instrumentUploadResults && (
              <div>
                <div style={{ background: '#E4F0EA', border: '1px solid #bcd9c9', borderRadius: 6, padding: 12, marginBottom: 12, fontSize: 13, color: '#084F39' }}>
                  {instrumentUploadResults.created} instrumento(s) agregado(s)
                  {instrumentUploadResults.skipped > 0 && <> · {instrumentUploadResults.skipped} omitido(s)</>}
                </div>
                {instrumentUploadResults.skipped > 0 && (
                  <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {instrumentUploadResults.rowResults.filter((r) => !r.ok).map((r) => (
                        <li key={r.rowNumber}>Fila {r.rowNumber} ({r.name}): {r.error}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <button
                  onClick={handleResetInstrumentUpload}
                  style={{ padding: '8px 16px', fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', background: '#fff', cursor: 'pointer' }}
                >
                  Cargar otro archivo
                </button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#5B6B60', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showInactiveInstruments}
                onChange={(e) => setShowInactiveInstruments(e.target.checked)}
              />
              Mostrar inactivos
            </label>
          </div>

          {instrumentsError && (
            <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
              {instrumentsError}
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #DBDCCF' }}>
                  <th style={{ padding: 8 }}>Nombre</th>
                  <th style={{ padding: 8 }}>N° inventario</th>
                  <th style={{ padding: 8 }}>Estado</th>
                  <th style={{ padding: 8 }}></th>
                </tr>
              </thead>
              <tbody>
                {visibleInstruments.length === 0 && !instrumentsLoading && (
                  <tr>
                    <td colSpan={4} style={{ padding: 20, textAlign: 'center', color: '#5B6B60' }}>
                      No hay instrumentos que coincidan con este filtro.
                    </td>
                  </tr>
                )}
                {visibleInstruments.map((inst) => {
                  const isEditing = editingInstrumentId === inst.id;
                  if (isEditing) {
                    return (
                      <tr key={inst.id} style={{ borderBottom: '1px solid #DBDCCF', background: '#FBFAF3' }}>
                        <td style={{ padding: 8 }}>
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            style={{ width: '100%', padding: 6, fontSize: 12, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                          />
                        </td>
                        <td style={{ padding: 8 }}>
                          <input
                            type="text"
                            value={editInventoryNumber}
                            onChange={(e) => setEditInventoryNumber(e.target.value)}
                            style={{ width: '100%', padding: 6, fontSize: 12, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                          />
                        </td>
                        <td style={{ padding: 8 }} colSpan={2}>
                          {editError && (
                            <div style={{ color: '#A23E33', fontSize: 11, marginBottom: 6 }}>{editError}</div>
                          )}
                          <button
                            onClick={() => saveEditInstrument(inst.id)}
                            disabled={editSubmitting}
                            style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #0B6E4F', color: '#0B6E4F', borderRadius: 6, background: 'transparent', cursor: 'pointer', marginRight: 6 }}
                          >
                            {editSubmitting ? 'Guardando...' : 'Guardar'}
                          </button>
                          <button
                            onClick={cancelEditInstrument}
                            disabled={editSubmitting}
                            style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #DBDCCF', borderRadius: 6, background: 'transparent', cursor: 'pointer' }}
                          >
                            Cancelar
                          </button>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={inst.id} style={{ borderBottom: '1px solid #DBDCCF', opacity: inst.active ? 1 : 0.6 }}>
                      <td style={{ padding: 8 }}>{inst.name}</td>
                      <td style={{ padding: 8, fontFamily: 'monospace' }}>{inst.inventory_number}</td>
                      <td style={{ padding: 8 }}>
                        <span
                          style={{
                            background: inst.active ? '#E4F0EA' : '#eee',
                            color: inst.active ? '#084F39' : '#888',
                            fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
                          }}
                        >
                          {inst.active ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => startEditInstrument(inst)}
                          style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #16241C', borderRadius: 6, background: 'transparent', cursor: 'pointer', marginRight: 6 }}
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleToggleInstrumentActive(inst)}
                          disabled={toggleId === inst.id}
                          style={{
                            padding: '5px 10px', fontSize: 12, borderRadius: 6, background: 'transparent', cursor: 'pointer',
                            border: inst.active ? '1px solid #A23E33' : '1px solid #0B6E4F',
                            color: inst.active ? '#A23E33' : '#0B6E4F',
                          }}
                        >
                          {toggleId === inst.id ? '...' : inst.active ? 'Desactivar' : 'Activar'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === 'semana' && (
        <>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Espacio</label>
              <select
                value={weekRoomId}
                onChange={(e) => setWeekRoomId(e.target.value)}
                style={{ padding: 8, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 13, minWidth: 220 }}
              >
                <option value="">Selecciona un espacio…</option>
                {ROOM_TYPE_ORDER.map((t) => {
                  const roomsOfType = rooms.filter((r) => r.type === t);
                  if (roomsOfType.length === 0) return null;
                  return (
                    <optgroup key={t} label={ROOM_TYPE_LABEL[t]}>
                      {roomsOfType.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => setWeekAnchorDate((d) => addDays(d, -7))}
                style={{ padding: '8px 12px', fontSize: 13, borderRadius: 8, border: '1px solid #DBDCCF', background: '#fff', cursor: 'pointer' }}
              >
                ← Semana anterior
              </button>
              <input
                type="date"
                value={weekAnchorDate}
                onChange={(e) => setWeekAnchorDate(e.target.value)}
                style={{ padding: 8, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 13 }}
              />
              <button
                onClick={() => setWeekAnchorDate((d) => addDays(d, 7))}
                style={{ padding: '8px 12px', fontSize: 13, borderRadius: 8, border: '1px solid #DBDCCF', background: '#fff', cursor: 'pointer' }}
              >
                Semana siguiente →
              </button>
            </div>
          </div>

          {weekError && (
            <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
              {weekError}
            </div>
          )}

          {!weekRoomId && (
            <p style={{ color: '#5B6B60', fontSize: 13 }}>Elige un espacio arriba para ver su ocupación de la semana.</p>
          )}

          {weekRoomId && (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'flex', gap: 8, minWidth: 900 }}>
                {getWeekRange(weekAnchorDate).map((dayDate) => {
                  const dayReservations = weekReservations.filter((r) => r.date === dayDate);
                  const isToday = dayDate === todayStr();
                  const weekdayIndex = getWeekRange(weekAnchorDate).indexOf(dayDate);
                  return (
                    <div
                      key={dayDate}
                      style={{
                        flex: 1, minWidth: 120, border: '1px solid #DBDCCF', borderRadius: 8,
                        background: isToday ? '#FBFAF3' : '#fff', padding: 8,
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{WEEKDAY_LABEL[weekdayIndex]}</div>
                      <div style={{ fontSize: 11, color: '#5B6B60', marginBottom: 8 }}>{formatDayShort(dayDate)}</div>

                      {weekLoading && <div style={{ fontSize: 11, color: '#5B6B60' }}>…</div>}

                      {!weekLoading && dayReservations.length === 0 && (
                        <div style={{ fontSize: 11, color: '#5B6B60' }}>Libre</div>
                      )}

                      {dayReservations.map((r) => {
                        const colors = STATUS_COLOR[r.status] || { bg: '#eee', fg: '#333' };
                        return (
                          <div
                            key={r.id}
                            style={{
                              background: colors.bg, color: colors.fg, borderRadius: 6, padding: '4px 6px',
                              marginBottom: 6, fontSize: 11,
                            }}
                          >
                            <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                              {r.start_time?.slice(0, 5)}-{r.end_time?.slice(0, 5)}
                            </div>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.app_users?.name || '—'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
