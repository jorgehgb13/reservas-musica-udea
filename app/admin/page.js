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

// Horas disponibles cada 30 minutos (00:00 a 23:30), para los selectores
// de "Reserva manual" — así nunca se puede escribir una hora suelta.
const HALF_HOUR_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? '00' : '30';
  return `${String(h).padStart(2, '0')}:${m}`;
});
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

const RECUR_DAY_OPTIONS = [
  { code: 1, label: 'L' }, // Lunes
  { code: 2, label: 'M' }, // Martes
  { code: 3, label: 'W' }, // Miércoles
  { code: 4, label: 'J' }, // Jueves
  { code: 5, label: 'V' }, // Viernes
  { code: 6, label: 'S' }, // Sábado
  { code: 0, label: 'D' }, // Domingo
];

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

  const [view, setView] = useState('lista'); // 'lista' | 'ocupacion' | 'sanciones' | 'instrumentos' | 'semana' | 'estadisticas' | 'aprobaciones' | 'manual' | 'asistencia'
  const [date, setDate] = useState(todayStr());
  const [reservations, setReservations] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState(null);
  const [actionId, setActionId] = useState(null);

  // ---------- Aprobaciones pendientes ----------
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [pendingApprovalsLoading, setPendingApprovalsLoading] = useState(false);
  const [pendingApprovalsError, setPendingApprovalsError] = useState(null);
  const [pendingActionId, setPendingActionId] = useState(null);
  const [pendingInstrumentLoans, setPendingInstrumentLoans] = useState([]);
  const [pendingInstrumentLoansLoading, setPendingInstrumentLoansLoading] = useState(false);
  const [pendingInstrumentLoansError, setPendingInstrumentLoansError] = useState(null);

  // ---------- Reserva manual (sin restricciones) ----------
  const [manualEmail, setManualEmail] = useState('@udea.edu.co');
  const [manualName, setManualName] = useState('');
  const [manualNeedsName, setManualNeedsName] = useState(false);
  const [manualRoomId, setManualRoomId] = useState('');
  const [manualClase, setManualClase] = useState('');
  const [manualDate, setManualDate] = useState(todayStr());
  const [manualStart, setManualStart] = useState('08:00');
  const [manualEnd, setManualEnd] = useState('10:00');
  const [manualNotes, setManualNotes] = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualFormError, setManualFormError] = useState(null);
  const [manualFormWarning, setManualFormWarning] = useState(null);
  const [manualFormSuccess, setManualFormSuccess] = useState(null);
  const [manualIsRecurring, setManualIsRecurring] = useState(false);
  const [manualRecurDays, setManualRecurDays] = useState([]);
  const [manualRecurDateFrom, setManualRecurDateFrom] = useState(todayStr());
  const [manualRecurDateTo, setManualRecurDateTo] = useState(todayStr());

  // ---------- Bloquear espacio ----------
  const [blockRoomId, setBlockRoomId] = useState('');
  const [blockDateFrom, setBlockDateFrom] = useState(todayStr());
  const [blockDateTo, setBlockDateTo] = useState(todayStr());
  const [blockReason, setBlockReason] = useState('');
  const [blockSubmitting, setBlockSubmitting] = useState(false);
  const [blockError, setBlockError] = useState(null);
  const [blockResults, setBlockResults] = useState(null);

  // ---------- Asistencia por persona ----------
  const [attFrom, setAttFrom] = useState(addDays(todayStr(), -180));
  const [attTo, setAttTo] = useState(todayStr());
  const [attLoading, setAttLoading] = useState(false);
  const [attError, setAttError] = useState(null);
  const [attRows, setAttRows] = useState([]);
  const [attSearch, setAttSearch] = useState('');

  // ---------- Depurar datos antiguos ----------
  const [purgeConfirming, setPurgeConfirming] = useState(false);
  const [purgeRunning, setPurgeRunning] = useState(false);
  const [purgeResult, setPurgeResult] = useState(null);
  const [purgeError, setPurgeError] = useState(null);

  const [rooms, setRooms] = useState([]);
  const [roomsError, setRoomsError] = useState(null);
  const [occupancyType, setOccupancyType] = useState('todos');

  // ---------- Por semana ----------
  const [weekRoomId, setWeekRoomId] = useState('');
  const [weekAnchorDate, setWeekAnchorDate] = useState(todayStr());
  const [weekReservations, setWeekReservations] = useState([]);
  const [weekLoading, setWeekLoading] = useState(false);
  const [weekError, setWeekError] = useState(null);

  // ---------- Modal de crear/editar/mover desde "Por semana" ----------
  const [weekModalOpen, setWeekModalOpen] = useState(false);
  const [weekModalMode, setWeekModalMode] = useState('create'); // 'create' | 'edit'
  const [weekModalReservationId, setWeekModalReservationId] = useState(null);
  const [weekModalRecurringTemplateId, setWeekModalRecurringTemplateId] = useState(null);
  const [weekModalStatus, setWeekModalStatus] = useState(null);
  const [weekModalEmail, setWeekModalEmail] = useState('@udea.edu.co');
  const [weekModalName, setWeekModalName] = useState('');
  const [weekModalNeedsName, setWeekModalNeedsName] = useState(false);
  const [weekModalRoomId, setWeekModalRoomId] = useState('');
  const [weekModalDate, setWeekModalDate] = useState(todayStr());
  const [weekModalStart, setWeekModalStart] = useState('08:00');
  const [weekModalEnd, setWeekModalEnd] = useState('10:00');
  const [weekModalClase, setWeekModalClase] = useState('');
  const [weekModalRecurDays, setWeekModalRecurDays] = useState([]);
  const [weekModalRecurDateFrom, setWeekModalRecurDateFrom] = useState(todayStr());
  const [weekModalRecurDateTo, setWeekModalRecurDateTo] = useState(todayStr());
  const [weekModalRecurUserId, setWeekModalRecurUserId] = useState(null);
  const [weekModalSubmitting, setWeekModalSubmitting] = useState(false);
  const [weekModalError, setWeekModalError] = useState(null);

  // ---------- Estadísticas ----------
  const [statsFrom, setStatsFrom] = useState(addDays(todayStr(), -30));
  const [statsTo, setStatsTo] = useState(todayStr());
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState(null);
  const [statsReservations, setStatsReservations] = useState([]);
  const [statsInstrumentLoans, setStatsInstrumentLoans] = useState([]);
  const [statsActiveSanctions, setStatsActiveSanctions] = useState(0);

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

    try {
      await fetch('/api/reservations/expire-no-shows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    } catch (err) {
      // si falla, seguimos igual — no es crítico para cargar la lista
    }

    const { data, error } = await supabase
      .from('reservations')
      .select('id, room_id, date, start_time, end_time, status, clase, checked_in_at, returned_at, auto_cancelled, cancel_reason, rooms ( name, type ), app_users ( name, email )')
      .eq('date', date)
      .neq('status', 'rechazada')
      .or('status.neq.cancelada,cancel_reason.eq.no_asistio')
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

  const loadPendingApprovals = useCallback(async () => {
    setPendingApprovalsLoading(true);
    setPendingApprovalsError(null);
    const { data, error } = await supabase
      .from('reservations')
      .select('id, date, start_time, end_time, status, clase, rooms ( name ), app_users ( name, email )')
      .eq('status', 'pendiente')
      .order('date', { ascending: true })
      .order('start_time', { ascending: true });

    if (error) {
      console.error('[admin] error cargando aprobaciones pendientes:', error);
      setPendingApprovalsError(`No se pudieron cargar las aprobaciones pendientes: ${error.message}`);
      setPendingApprovals([]);
    } else {
      setPendingApprovals(data || []);
    }
    setPendingApprovalsLoading(false);
  }, []);

  useEffect(() => {
    if (session) loadPendingApprovals();
  }, [session, view, loadPendingApprovals]);

  const loadPendingInstrumentLoans = useCallback(async () => {
    setPendingInstrumentLoansLoading(true);
    setPendingInstrumentLoansError(null);
    const { data, error } = await supabase
      .from('instrument_reservations')
      .select('id, date, start_time, end_time, status, instruments ( name, inventory_number ), app_users ( name, email )')
      .eq('status', 'pendiente')
      .order('date', { ascending: true })
      .order('start_time', { ascending: true });

    if (error) {
      console.error('[admin] error cargando préstamos pendientes:', error);
      setPendingInstrumentLoansError(`No se pudieron cargar los préstamos pendientes: ${error.message}`);
      setPendingInstrumentLoans([]);
    } else {
      setPendingInstrumentLoans(data || []);
    }
    setPendingInstrumentLoansLoading(false);
  }, []);

  useEffect(() => {
    if (session) loadPendingInstrumentLoans();
  }, [session, view, loadPendingInstrumentLoans]);

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
      .select('id, date, start_time, end_time, status, clase, recurring_template_id, app_users ( name, email )')
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

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);

    const [reservationsRes, loansRes, sanctionsRes] = await Promise.all([
      supabase
        .from('reservations')
        .select('id, status, date, start_time, end_time, checked_in_at, cancel_reason, room_id, rooms ( name, type )')
        .gte('date', statsFrom)
        .lte('date', statsTo),
      supabase
        .from('instrument_reservations')
        .select('id, status, date, instrument_id, instruments ( name )')
        .gte('date', statsFrom)
        .lte('date', statsTo),
      supabase
        .from('sanctions')
        .select('id', { count: 'exact', head: true })
        .gt('until', new Date().toISOString()),
    ]);

    if (reservationsRes.error || loansRes.error || sanctionsRes.error) {
      const err = reservationsRes.error || loansRes.error || sanctionsRes.error;
      console.error('[admin] error cargando estadísticas:', err);
      setStatsError(`No se pudieron cargar las estadísticas: ${err.message}`);
      setStatsReservations([]);
      setStatsInstrumentLoans([]);
      setStatsActiveSanctions(0);
      setStatsLoading(false);
      return;
    }

    setStatsReservations(reservationsRes.data || []);
    setStatsInstrumentLoans(loansRes.data || []);
    setStatsActiveSanctions(sanctionsRes.count || 0);
    setStatsLoading(false);
  }, [statsFrom, statsTo]);

  useEffect(() => {
    if (session && view === 'estadisticas') loadStats();
  }, [session, view, loadStats]);

  const loadAttendance = useCallback(async () => {
    setAttLoading(true);
    setAttError(null);

    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('reservations')
      .select('id, date, end_time, status, checked_in_at, cancel_reason, notes, recurring_template_id, user_id, app_users ( name, email )')
      .gte('date', attFrom)
      .lte('date', attTo);

    if (error) {
      console.error('[admin] error cargando asistencia:', error);
      setAttError(`No se pudo cargar la asistencia: ${error.message}`);
      setAttRows([]);
      setAttLoading(false);
      return;
    }

    const now = new Date();
    const byUser = {};

    for (const r of data || []) {
      // Los bloqueos de espacio (creados desde "Reserva manual") no son
      // asistencia de una persona real — se excluyen del cálculo.
      if (r.notes && r.notes.startsWith('Bloqueado por administrador')) continue;

      const endDt = new Date(`${r.date}T${r.end_time}-05:00`);
      const completed = (r.status === 'confirmada' && endDt < now) || (r.status === 'cancelada' && r.cancel_reason === 'no_asistio');
      if (!completed) continue;

      const key = r.user_id;
      if (!byUser[key]) {
        byUser[key] = {
          userId: key,
          name: r.app_users?.name || '—',
          email: r.app_users?.email || '—',
          recTotal: 0,
          recAttended: 0,
          adhocTotal: 0,
          adhocAttended: 0,
        };
      }
      const attended = !!r.checked_in_at;
      if (r.recurring_template_id) {
        byUser[key].recTotal += 1;
        if (attended) byUser[key].recAttended += 1;
      } else {
        byUser[key].adhocTotal += 1;
        if (attended) byUser[key].adhocAttended += 1;
      }
    }

    const rows = Object.values(byUser).map((u) => {
      const total = u.recTotal + u.adhocTotal;
      const attended = u.recAttended + u.adhocAttended;
      return {
        ...u,
        recPct: u.recTotal > 0 ? Math.round((u.recAttended / u.recTotal) * 100) : null,
        adhocPct: u.adhocTotal > 0 ? Math.round((u.adhocAttended / u.adhocTotal) * 100) : null,
        totalPct: total > 0 ? Math.round((attended / total) * 100) : null,
      };
    });
    rows.sort((a, b) => a.name.localeCompare(b.name));

    setAttRows(rows);
    setAttLoading(false);
  }, [attFrom, attTo]);

  useEffect(() => {
    if (session && view === 'asistencia') loadAttendance();
  }, [session, view, loadAttendance]);

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
      .select('id, date, start_time, end_time, status, instruments ( name, inventory_number ), app_users ( name, email )')
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

  useEffect(() => {
    const email = manualEmail.trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      setManualNeedsName(false);
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
          setManualNeedsName(false);
          setManualName(data.name || '');
        } else {
          setManualNeedsName(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [manualEmail]);

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

  async function handleFinishReservation(id) {
    setActionId(id);
    const { error } = await supabase
      .from('reservations')
      .update({ returned_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error('[admin] error terminando reserva:', error);
      setListError(`No se pudo marcar como terminada: ${error.message}`);
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

  async function handlePendingApprove(id) {
    setPendingActionId(id);
    const { error } = await supabase
      .from('reservations')
      .update({ status: 'confirmada' })
      .eq('id', id);
    if (error) {
      console.error('[admin] error aprobando:', error);
      setPendingApprovalsError(`No se pudo aprobar la reserva: ${error.message}`);
    } else {
      await loadPendingApprovals();
    }
    setPendingActionId(null);
  }

  async function handlePendingReject(id) {
    setPendingActionId(id);
    const { error } = await supabase
      .from('reservations')
      .update({ status: 'rechazada' })
      .eq('id', id);
    if (error) {
      console.error('[admin] error rechazando:', error);
      setPendingApprovalsError(`No se pudo rechazar la reserva: ${error.message}`);
    } else {
      await loadPendingApprovals();
    }
    setPendingActionId(null);
  }

  async function handleCreateManualReservation(e) {
    e.preventDefault();
    setManualFormError(null);
    setManualFormWarning(null);
    setManualFormSuccess(null);

    const email = manualEmail.trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      setManualFormError('Usa un correo institucional con dominio @udea.edu.co.');
      return;
    }
    if (manualNeedsName && !manualName.trim()) {
      setManualFormError('Esta persona no está registrada todavía — ingresa su nombre completo.');
      return;
    }
    if (!manualRoomId) {
      setManualFormError('Elige un espacio.');
      return;
    }
    if (!manualStart || !manualEnd || manualEnd <= manualStart) {
      setManualFormError('La hora de fin debe ser después de la hora de inicio.');
      return;
    }
    if (manualIsRecurring) {
      if (manualRecurDays.length === 0) {
        setManualFormError('Elige al menos un día de la semana (L, M, W, J, V, S o D).');
        return;
      }
      if (!manualRecurDateFrom || !manualRecurDateTo || manualRecurDateTo < manualRecurDateFrom) {
        setManualFormError('La fecha de fin debe ser igual o posterior a la fecha de inicio.');
        return;
      }
    }

    setManualSubmitting(true);
    try {
      let userId;
      const { data: existingUser, error: findError } = await supabase
        .from('app_users')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (findError) {
        setManualFormError(`No se pudo buscar el usuario: ${findError.message}`);
        setManualSubmitting(false);
        return;
      }

      if (existingUser) {
        userId = existingUser.id;
      } else {
        const { data: newUser, error: insertUserError } = await supabase
          .from('app_users')
          .insert({ email, name: manualName.trim() })
          .select('id')
          .single();
        if (insertUserError) {
          setManualFormError(`No se pudo crear la persona: ${insertUserError.message}`);
          setManualSubmitting(false);
          return;
        }
        userId = newUser.id;
      }

      if (manualIsRecurring) {
        // ---------- Reserva recurrente ----------
        const { data: templateData, error: templateError } = await supabase
          .from('recurring_templates')
          .insert({
            room_id: manualRoomId,
            materia: manualClase.trim() || null,
            docente: manualName.trim() || null,
            user_id: userId,
            days_of_week: manualRecurDays,
            start_time: manualStart,
            end_time: manualEnd,
            date_from: manualRecurDateFrom,
            date_to: manualRecurDateTo,
            origin: 'admin-recurrente-manual',
          })
          .select('id')
          .single();

        if (templateError) {
          setManualFormError(`No se pudo crear la clase recurrente: ${templateError.message}`);
          setManualSubmitting(false);
          return;
        }

        const occurrences = computeOccurrences(manualRecurDateFrom, manualRecurDateTo, manualRecurDays);

        // Advertencia: revisa si alguna de esas fechas ya tiene una reserva
        // puntual o recurrente activa en ese mismo espacio y horario.
        const { data: conflictReservations, error: conflictError } = await supabase
          .from('reservations')
          .select('id, date')
          .eq('room_id', manualRoomId)
          .eq('start_time', manualStart)
          .eq('end_time', manualEnd)
          .in('date', occurrences)
          .neq('status', 'cancelada')
          .neq('status', 'rechazada');

        if (conflictError) {
          setManualFormError(`No se pudo verificar la disponibilidad: ${conflictError.message}`);
          setManualSubmitting(false);
          return;
        }

        const conflictDates = new Set((conflictReservations || []).map((r) => r.date));
        const datesToCreate = occurrences.filter((d) => !conflictDates.has(d));

        let created = 0;
        if (datesToCreate.length > 0) {
          const newRows = datesToCreate.map((date) => ({
            room_id: manualRoomId,
            user_id: userId,
            date,
            start_time: manualStart,
            end_time: manualEnd,
            status: 'confirmada',
            requires_approval: false,
            forced: true,
            recurring_template_id: templateData.id,
            clase: manualClase.trim() || null,
            notes: manualNotes.trim() || null,
          }));

          const { error: bulkInsertError } = await supabase.from('reservations').insert(newRows);
          if (!bulkInsertError) {
            created = newRows.length;
          } else {
            for (const newRow of newRows) {
              const { error } = await supabase.from('reservations').insert(newRow);
              if (!error) created += 1;
            }
          }
        }

        if (conflictDates.size === 0) {
          setManualFormSuccess(`Clase recurrente creada correctamente: ${created} reserva(s) confirmada(s).`);
        } else {
          const formattedDates = [...conflictDates].sort().join(', ');
          setManualFormWarning(
            `⚠️ La clase recurrente se creó, con ${created} reserva(s) confirmada(s). Pero ${conflictDates.size} fecha(s) ya tenían algo reservado en ese espacio y horario (puntual o recurrente) y se omitieron: ${formattedDates}. Revísalas manualmente.`
          );
        }

        setManualEmail('@udea.edu.co');
        setManualName('');
        setManualClase('');
        setManualNotes('');
        setManualIsRecurring(false);
        setManualRecurDays([]);
        await loadReservations();
        return;
      }

      // ---------- Reserva puntual (un solo día) ----------
      const { error: insertError } = await supabase.from('reservations').insert({
        room_id: manualRoomId,
        user_id: userId,
        date: manualDate,
        start_time: manualStart,
        end_time: manualEnd,
        status: 'confirmada',
        requires_approval: false,
        forced: true,
        notes: manualNotes.trim() || null,
        clase: manualClase.trim() || null,
      });

      if (insertError) {
        if (insertError.code === '23P01') {
          setManualFormError('Ese espacio ya está ocupado en ese horario. Elige otro horario, o cancela la reserva existente primero.');
        } else {
          setManualFormError(`No se pudo crear la reserva: ${insertError.message}`);
        }
        setManualSubmitting(false);
        return;
      }

      setManualFormSuccess('Reserva creada y confirmada correctamente.');
      setManualEmail('@udea.edu.co');
      setManualName('');
      setManualClase('');
      setManualNotes('');
      await loadReservations();
    } catch (err) {
      console.error('[admin] error inesperado creando reserva manual:', err);
      setManualFormError('Ocurrió un error inesperado. Intenta de nuevo.');
    } finally {
      setManualSubmitting(false);
    }
  }

  // ---------- Modal de "Por semana": crear, editar, mover, eliminar ----------

  function openWeekCreateModal(dayDate) {
    setWeekModalMode('create');
    setWeekModalReservationId(null);
    setWeekModalRecurringTemplateId(null);
    setWeekModalStatus(null);
    setWeekModalEmail('@udea.edu.co');
    setWeekModalName('');
    setWeekModalNeedsName(false);
    setWeekModalRoomId(weekRoomId);
    setWeekModalDate(dayDate);
    setWeekModalStart('08:00');
    setWeekModalEnd('10:00');
    setWeekModalClase('');
    setWeekModalError(null);
    setWeekModalOpen(true);
  }

  async function openWeekEditModal(r) {
    setWeekModalMode('edit');
    setWeekModalReservationId(r.id);
    setWeekModalRecurringTemplateId(r.recurring_template_id || null);
    setWeekModalStatus(r.status);
    setWeekModalEmail(r.app_users?.email || '');
    setWeekModalName(r.app_users?.name || '');
    setWeekModalNeedsName(false);
    setWeekModalRoomId(weekRoomId);
    setWeekModalDate(r.date);
    setWeekModalStart((r.start_time || '').slice(0, 5));
    setWeekModalEnd((r.end_time || '').slice(0, 5));
    setWeekModalClase(r.clase || '');
    setWeekModalRecurDays([]);
    setWeekModalRecurDateFrom(r.date);
    setWeekModalRecurDateTo(r.date);
    setWeekModalRecurUserId(null);
    setWeekModalError(null);
    setWeekModalOpen(true);

    // Si es parte de una clase recurrente, trae el patrón completo
    // (días de la semana, rango de fechas, usuario) para poder editarlo.
    if (r.recurring_template_id) {
      const { data: template, error } = await supabase
        .from('recurring_templates')
        .select('days_of_week, date_from, date_to, user_id')
        .eq('id', r.recurring_template_id)
        .maybeSingle();

      if (!error && template) {
        setWeekModalRecurDays(template.days_of_week || []);
        setWeekModalRecurDateFrom(template.date_from || r.date);
        setWeekModalRecurDateTo(template.date_to || r.date);
        setWeekModalRecurUserId(template.user_id || null);
      }
    }
  }

  function closeWeekModal() {
    if (weekModalSubmitting) return;
    setWeekModalOpen(false);
  }

  async function handleWeekModalSubmit(e) {
    e.preventDefault();
    setWeekModalError(null);

    if (!weekModalRoomId) {
      setWeekModalError('Elige un espacio.');
      return;
    }
    if (!weekModalStart || !weekModalEnd || weekModalEnd <= weekModalStart) {
      setWeekModalError('La hora de fin debe ser después de la hora de inicio.');
      return;
    }

    setWeekModalSubmitting(true);
    try {
      if (weekModalMode === 'edit') {
        const { error: updateError } = await supabase
          .from('reservations')
          .update({
            room_id: weekModalRoomId,
            date: weekModalDate,
            start_time: weekModalStart,
            end_time: weekModalEnd,
            clase: weekModalClase.trim() || null,
          })
          .eq('id', weekModalReservationId);

        if (updateError) {
          if (updateError.code === '23P01') {
            setWeekModalError('Ese espacio ya está ocupado en ese horario. Elige otra fecha/hora.');
          } else {
            setWeekModalError(`No se pudo actualizar la reserva: ${updateError.message}`);
          }
          setWeekModalSubmitting(false);
          return;
        }
      } else {
        const email = weekModalEmail.trim().toLowerCase();
        if (!EMAIL_REGEX.test(email)) {
          setWeekModalError('Usa un correo institucional con dominio @udea.edu.co.');
          setWeekModalSubmitting(false);
          return;
        }

        let userId;
        const { data: existingUser, error: findError } = await supabase
          .from('app_users')
          .select('id')
          .eq('email', email)
          .maybeSingle();

        if (findError) {
          setWeekModalError(`No se pudo buscar el usuario: ${findError.message}`);
          setWeekModalSubmitting(false);
          return;
        }

        if (existingUser) {
          userId = existingUser.id;
        } else {
          if (!weekModalName.trim()) {
            setWeekModalNeedsName(true);
            setWeekModalError('Esta persona no está registrada todavía — ingresa su nombre completo.');
            setWeekModalSubmitting(false);
            return;
          }
          const { data: newUser, error: insertUserError } = await supabase
            .from('app_users')
            .insert({ email, name: weekModalName.trim() })
            .select('id')
            .single();
          if (insertUserError) {
            setWeekModalError(`No se pudo crear la persona: ${insertUserError.message}`);
            setWeekModalSubmitting(false);
            return;
          }
          userId = newUser.id;
        }

        const { error: insertError } = await supabase.from('reservations').insert({
          room_id: weekModalRoomId,
          user_id: userId,
          date: weekModalDate,
          start_time: weekModalStart,
          end_time: weekModalEnd,
          status: 'confirmada',
          requires_approval: false,
          forced: true,
          clase: weekModalClase.trim() || null,
        });

        if (insertError) {
          if (insertError.code === '23P01') {
            setWeekModalError('Ese espacio ya está ocupado en ese horario. Elige otro horario.');
          } else {
            setWeekModalError(`No se pudo crear la reserva: ${insertError.message}`);
          }
          setWeekModalSubmitting(false);
          return;
        }
      }

      setWeekModalOpen(false);
      await loadWeekReservations();
    } catch (err) {
      console.error('[admin] error inesperado en el modal de la semana:', err);
      setWeekModalError('Ocurrió un error inesperado. Intenta de nuevo.');
    } finally {
      setWeekModalSubmitting(false);
    }
  }

  async function handleWeekModalDeleteOne() {
    if (!weekModalReservationId) return;
    if (!window.confirm('¿Cancelar esta reserva (solo esta fecha)? Esta acción no se puede deshacer.')) return;

    setWeekModalSubmitting(true);
    setWeekModalError(null);
    const { error } = await supabase
      .from('reservations')
      .update({ status: 'cancelada' })
      .eq('id', weekModalReservationId);

    if (error) {
      setWeekModalError(`No se pudo cancelar la reserva: ${error.message}`);
      setWeekModalSubmitting(false);
      return;
    }

    setWeekModalOpen(false);
    setWeekModalSubmitting(false);
    await loadWeekReservations();
  }

  async function handleWeekModalDeleteAllRecurring() {
    if (!weekModalRecurringTemplateId) return;
    if (
      !window.confirm(
        '¿Cancelar TODAS las reservas recurrentes de esta clase (mismo usuario, horario y espacio, en todas las fechas)? Esta acción no se puede deshacer.'
      )
    ) {
      return;
    }

    setWeekModalSubmitting(true);
    setWeekModalError(null);
    const { error } = await supabase
      .from('reservations')
      .update({ status: 'cancelada' })
      .eq('recurring_template_id', weekModalRecurringTemplateId)
      .neq('status', 'cancelada')
      .neq('status', 'rechazada');

    if (error) {
      setWeekModalError(`No se pudieron cancelar las reservas: ${error.message}`);
      setWeekModalSubmitting(false);
      return;
    }

    setWeekModalOpen(false);
    setWeekModalSubmitting(false);
    await loadWeekReservations();
  }

  async function handleWeekModalEditAllRecurring() {
    if (!weekModalRecurringTemplateId) return;
    if (!weekModalRoomId) {
      setWeekModalError('Elige un espacio.');
      return;
    }
    if (!weekModalStart || !weekModalEnd || weekModalEnd <= weekModalStart) {
      setWeekModalError('La hora de fin debe ser después de la hora de inicio.');
      return;
    }
    if (weekModalRecurDays.length === 0) {
      setWeekModalError('Elige al menos un día de la semana (L, M, W, J, V, S o D).');
      return;
    }
    if (!weekModalRecurDateFrom || !weekModalRecurDateTo || weekModalRecurDateTo < weekModalRecurDateFrom) {
      setWeekModalError('La fecha de fin debe ser igual o posterior a la fecha de inicio.');
      return;
    }
    if (
      !window.confirm(
        'Esto va a reemplazar TODA la clase recurrente (espacio, horario, clase, días de la semana y rango de fechas). Las fechas que ya no apliquen se cancelan y se crean las que falten. ¿Continuar?'
      )
    ) {
      return;
    }

    setWeekModalSubmitting(true);
    setWeekModalError(null);

    try {
      const newOccurrences = computeOccurrences(weekModalRecurDateFrom, weekModalRecurDateTo, weekModalRecurDays);
      const newOccurrenceSet = new Set(newOccurrences);

      const { data: existingReservations, error: existingError } = await supabase
        .from('reservations')
        .select('id, date')
        .eq('recurring_template_id', weekModalRecurringTemplateId)
        .neq('status', 'cancelada')
        .neq('status', 'rechazada');

      if (existingError) {
        setWeekModalError(`No se pudo leer la serie: ${existingError.message}`);
        setWeekModalSubmitting(false);
        return;
      }

      const existingByDate = new Map((existingReservations || []).map((r) => [r.date, r.id]));

      // Fechas que ya no encajan en el nuevo patrón (días/rango) → se cancelan.
      const idsToCancel = (existingReservations || [])
        .filter((r) => !newOccurrenceSet.has(r.date))
        .map((r) => r.id);

      // Fechas del nuevo patrón que ya existían → se actualizan (espacio/hora/clase).
      const datesToUpdate = newOccurrences.filter((d) => existingByDate.has(d));
      // Fechas del nuevo patrón que son nuevas → hay que crearlas.
      const datesToCreate = newOccurrences.filter((d) => !existingByDate.has(d));

      // Revisa conflictos con OTRAS reservas (de otra serie o puntuales)
      // solo para las fechas nuevas que hay que crear.
      let conflictDates = new Set();
      if (datesToCreate.length > 0) {
        const { data: conflictRows, error: conflictError } = await supabase
          .from('reservations')
          .select('id, date')
          .eq('room_id', weekModalRoomId)
          .eq('start_time', weekModalStart)
          .eq('end_time', weekModalEnd)
          .in('date', datesToCreate)
          .neq('status', 'cancelada')
          .neq('status', 'rechazada')
          .neq('recurring_template_id', weekModalRecurringTemplateId);

        if (conflictError) {
          setWeekModalError(`No se pudo revisar conflictos: ${conflictError.message}`);
          setWeekModalSubmitting(false);
          return;
        }
        conflictDates = new Set((conflictRows || []).map((r) => r.date));
      }

      const finalDatesToCreate = datesToCreate.filter((d) => !conflictDates.has(d));

      // 1. Actualiza la plantilla con el nuevo patrón completo.
      const { error: templateUpdateError } = await supabase
        .from('recurring_templates')
        .update({
          room_id: weekModalRoomId,
          start_time: weekModalStart,
          end_time: weekModalEnd,
          materia: weekModalClase.trim() || null,
          days_of_week: weekModalRecurDays,
          date_from: weekModalRecurDateFrom,
          date_to: weekModalRecurDateTo,
        })
        .eq('id', weekModalRecurringTemplateId);

      if (templateUpdateError) {
        setWeekModalError(`No se pudo actualizar la plantilla: ${templateUpdateError.message}`);
        setWeekModalSubmitting(false);
        return;
      }

      // 2. Cancela las fechas que ya no aplican con el nuevo patrón.
      if (idsToCancel.length > 0) {
        const { error: cancelError } = await supabase
          .from('reservations')
          .update({ status: 'cancelada', cancel_reason: 'Ajuste de patrón recurrente' })
          .in('id', idsToCancel);

        if (cancelError) {
          setWeekModalError(`No se pudieron cancelar las fechas antiguas: ${cancelError.message}`);
          setWeekModalSubmitting(false);
          return;
        }
      }

      // 3. Actualiza las fechas que ya existían y siguen aplicando.
      const idsToUpdate = datesToUpdate.map((d) => existingByDate.get(d));
      if (idsToUpdate.length > 0) {
        const { error: bulkUpdateError } = await supabase
          .from('reservations')
          .update({
            room_id: weekModalRoomId,
            start_time: weekModalStart,
            end_time: weekModalEnd,
            clase: weekModalClase.trim() || null,
          })
          .in('id', idsToUpdate);

        if (bulkUpdateError) {
          setWeekModalError(`No se pudieron actualizar las fechas existentes: ${bulkUpdateError.message}`);
          setWeekModalSubmitting(false);
          return;
        }
      }

      // 4. Crea las fechas nuevas del patrón que todavía no existían (sin conflicto).
      let created = 0;
      if (finalDatesToCreate.length > 0) {
        const newRows = finalDatesToCreate.map((date) => ({
          room_id: weekModalRoomId,
          user_id: weekModalRecurUserId,
          date,
          start_time: weekModalStart,
          end_time: weekModalEnd,
          status: 'confirmada',
          requires_approval: false,
          forced: true,
          recurring_template_id: weekModalRecurringTemplateId,
          clase: weekModalClase.trim() || null,
        }));

        const { error: insertError } = await supabase.from('reservations').insert(newRows);
        if (insertError) {
          setWeekModalError(
            `Se actualizó la plantilla, pero no se pudieron crear algunas fechas nuevas: ${insertError.message}`
          );
          setWeekModalSubmitting(false);
          await loadWeekReservations();
          return;
        }
        created = newRows.length;
      }

      window.alert(
        `Serie actualizada: ${created} fecha(s) nueva(s) creada(s), ${idsToUpdate.length} fecha(s) existente(s) actualizada(s), ${idsToCancel.length} fecha(s) antigua(s) cancelada(s)` +
          (conflictDates.size > 0
            ? `. ${conflictDates.size} fecha(s) no se pudieron crear porque ya estaban ocupadas: ${[...conflictDates].join(', ')}.`
            : '.')
      );

      setWeekModalOpen(false);
      setWeekModalSubmitting(false);
      await loadWeekReservations();
    } catch (err) {
      console.error('[admin] error inesperado editando toda la serie:', err);
      setWeekModalError('Ocurrió un error inesperado. Intenta de nuevo.');
      setWeekModalSubmitting(false);
    }
  }

  async function handleBlockRoom(e) {
    e.preventDefault();
    setBlockError(null);
    setBlockResults(null);

    if (!blockRoomId) {
      setBlockError('Elige un espacio.');
      return;
    }
    if (blockDateTo < blockDateFrom) {
      setBlockError('La fecha final debe ser igual o posterior a la fecha inicial.');
      return;
    }

    setBlockSubmitting(true);
    try {
      const dates = [];
      let cursor = blockDateFrom;
      let guard = 0;
      while (cursor <= blockDateTo && guard < 366) {
        dates.push(cursor);
        cursor = addDays(cursor, 1);
        guard += 1;
      }

      const startTime = `${pad2(OPERATING_START)}:00`;
      const endTime = `${pad2(OPERATING_END)}:00`;
      const noteText = `Bloqueado por administrador${blockReason.trim() ? `: ${blockReason.trim()}` : ''}`;

      let blocked = 0;
      const skippedDates = [];

      for (const d of dates) {
        const { error } = await supabase.from('reservations').insert({
          room_id: blockRoomId,
          user_id: session.user.id,
          date: d,
          start_time: startTime,
          end_time: endTime,
          status: 'confirmada',
          requires_approval: false,
          forced: true,
          notes: noteText,
        });
        if (error) {
          skippedDates.push(d);
        } else {
          blocked += 1;
        }
      }

      setBlockResults({ blocked, skippedDates, total: dates.length });
      setBlockReason('');
      await loadReservations();
    } catch (err) {
      console.error('[admin] error inesperado bloqueando espacio:', err);
      setBlockError('Ocurrió un error inesperado. Intenta de nuevo.');
    } finally {
      setBlockSubmitting(false);
    }
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
      await loadPendingInstrumentLoans();
    }
    setInstrumentLoanActionId(null);
  }

  async function handleApproveInstrumentLoan(id) {
    setInstrumentLoanActionId(id);
    const { error } = await supabase
      .from('instrument_reservations')
      .update({ status: 'confirmada' })
      .eq('id', id);
    if (error) {
      console.error('[admin] error aprobando préstamo:', error);
      setInstrumentLoansError(`No se pudo aprobar el préstamo: ${error.message}`);
    } else {
      await loadInstrumentLoans();
      await loadPendingInstrumentLoans();
    }
    setInstrumentLoanActionId(null);
  }

  async function handleRejectInstrumentLoan(id) {
    setInstrumentLoanActionId(id);
    const { error } = await supabase
      .from('instrument_reservations')
      .update({ status: 'rechazada' })
      .eq('id', id);
    if (error) {
      console.error('[admin] error rechazando préstamo:', error);
      setInstrumentLoansError(`No se pudo rechazar el préstamo: ${error.message}`);
    } else {
      await loadInstrumentLoans();
      await loadPendingInstrumentLoans();
    }
    setInstrumentLoanActionId(null);
  }

  async function handleDownloadStats() {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();

    const resumenRows = [
      ['Periodo', `${statsFrom} a ${statsTo}`],
      ['Solicitudes de espacio', statsTotal],
      ['Préstamos de instrumentos', statsInstrumentTotal],
      ['Tasa de inasistencia', noShowRate === null ? 'Sin datos' : `${noShowRate}% (${noShows.length} de ${completedConfirmed.length})`],
      ['Sanciones activas hoy', statsActiveSanctions],
    ];
    const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
    wsResumen['!cols'] = [{ wch: 26 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

    const estadoRows = [
      ['Estado', 'Cantidad'],
      ...Object.keys(STATUS_LABEL).map((k) => [STATUS_LABEL[k], statsByStatus[k] || 0]),
    ];
    const wsEstado = XLSX.utils.aoa_to_sheet(estadoRows);
    XLSX.utils.book_append_sheet(wb, wsEstado, 'Por estado');

    const tipoRows = [
      ['Tipo de espacio', 'Cantidad'],
      ...ROOM_TYPE_ORDER.map((t) => [ROOM_TYPE_LABEL[t], statsByType[t] || 0]),
    ];
    const wsTipo = XLSX.utils.aoa_to_sheet(tipoRows);
    XLSX.utils.book_append_sheet(wb, wsTipo, 'Por tipo de espacio');

    const roomsRows = [['Espacio', 'Solicitudes'], ...topRooms.map(([name, count]) => [name, count])];
    const wsRooms = XLSX.utils.aoa_to_sheet(roomsRows);
    XLSX.utils.book_append_sheet(wb, wsRooms, 'Espacios mas solicitados');

    const instrRows = [['Instrumento', 'Préstamos'], ...topInstruments.map(([name, count]) => [name, count])];
    const wsInstr = XLSX.utils.aoa_to_sheet(instrRows);
    XLSX.utils.book_append_sheet(wb, wsInstr, 'Instrumentos mas solicitados');

    XLSX.writeFile(wb, `estadisticas-${statsFrom}-a-${statsTo}.xlsx`);
  }

  async function handleDownloadAttendance() {
    const XLSX = await import('xlsx');
    const rows = [
      ['Nombre', 'Correo', 'Recurrentes programadas', 'Recurrentes asistidas', '% asistencia recurrentes',
        'Puntuales programadas', 'Puntuales asistidas', '% asistencia puntuales', '% asistencia total'],
      ...attRows.map((u) => [
        u.name, u.email, u.recTotal, u.recAttended, u.recPct === null ? '—' : `${u.recPct}%`,
        u.adhocTotal, u.adhocAttended, u.adhocPct === null ? '—' : `${u.adhocPct}%`,
        u.totalPct === null ? '—' : `${u.totalPct}%`,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 24 }, { wch: 26 }, { wch: 20 }, { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Asistencia por persona');
    XLSX.writeFile(wb, `asistencia-${attFrom}-a-${attTo}.xlsx`);
  }

  async function handlePurgeOldData() {
    setPurgeRunning(true);
    setPurgeError(null);
    setPurgeResult(null);

    const cutoff = addDays(todayStr(), -365);

    const [resResult, loanResult] = await Promise.all([
      supabase.from('reservations').delete().lt('date', cutoff).select('id'),
      supabase.from('instrument_reservations').delete().lt('date', cutoff).select('id'),
    ]);

    if (resResult.error || loanResult.error) {
      const err = resResult.error || loanResult.error;
      console.error('[admin] error depurando datos antiguos:', err);
      setPurgeError(`No se pudo depurar: ${err.message}`);
      setPurgeRunning(false);
      return;
    }

    setPurgeResult({
      reservations: (resResult.data || []).length,
      loans: (loanResult.data || []).length,
      cutoff,
    });
    setPurgeConfirming(false);
    setPurgeRunning(false);
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

  // ---------- Cálculos de Estadísticas ----------
  const statsTotal = statsReservations.length;

  const statsByStatus = {};
  for (const r of statsReservations) {
    statsByStatus[r.status] = (statsByStatus[r.status] || 0) + 1;
  }

  const statsByType = { cubiculo: 0, aula: 0, auditorio: 0 };
  for (const r of statsReservations) {
    const t = r.rooms?.type;
    if (t && t in statsByType) statsByType[t] += 1;
  }

  const roomCounts = {};
  for (const r of statsReservations) {
    if (!['confirmada', 'pendiente', 'sin_verificar'].includes(r.status)) continue;
    const name = r.rooms?.name || 'Espacio';
    roomCounts[name] = (roomCounts[name] || 0) + 1;
  }
  const topRooms = Object.entries(roomCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topRoomsMax = topRooms.length > 0 ? topRooms[0][1] : 0;

  const statsNow = new Date();
  // Cuenta como "debía haber pasado" tanto las confirmadas que ya terminaron
  // como las que el sistema canceló automáticamente por inasistencia
  // (aunque su estado final ya no sea "confirmada").
  const completedConfirmed = statsReservations.filter(
    (r) =>
      (r.status === 'confirmada' && new Date(`${r.date}T${r.end_time}-05:00`) < statsNow) ||
      (r.status === 'cancelada' && r.cancel_reason === 'no_asistio')
  );
  const noShows = completedConfirmed.filter((r) => !r.checked_in_at);
  const noShowRate = completedConfirmed.length > 0 ? Math.round((noShows.length / completedConfirmed.length) * 100) : null;

  const statsInstrumentTotal = statsInstrumentLoans.length;
  const instrumentCounts = {};
  for (const l of statsInstrumentLoans) {
    if (!['confirmada', 'sin_verificar'].includes(l.status)) continue;
    const name = l.instruments?.name || 'Instrumento';
    instrumentCounts[name] = (instrumentCounts[name] || 0) + 1;
  }
  const topInstruments = Object.entries(instrumentCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topInstrumentsMax = topInstruments.length > 0 ? topInstruments[0][1] : 0;

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
          onClick={() => setView('aprobaciones')}
          style={{
            padding: '10px 4px', fontSize: 14, fontWeight: 600, background: 'transparent', cursor: 'pointer',
            border: 'none', borderBottom: view === 'aprobaciones' ? '2px solid #0B6E4F' : '2px solid transparent',
            color: view === 'aprobaciones' ? '#0B6E4F' : '#5B6B60', marginRight: 20,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          Aprobaciones
          {(pendingApprovals.length + pendingInstrumentLoans.length) > 0 && (
            <span
              style={{
                background: '#A23E33', color: '#fff', fontSize: 11, fontWeight: 700,
                minWidth: 18, height: 18, borderRadius: 9, display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center', padding: '0 5px',
              }}
              title={`${pendingApprovals.length + pendingInstrumentLoans.length} solicitud(es) pendiente(s) de aprobación`}
            >
              {pendingApprovals.length + pendingInstrumentLoans.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setView('manual')}
          style={{
            padding: '10px 4px', fontSize: 14, fontWeight: 600, background: 'transparent', cursor: 'pointer',
            border: 'none', borderBottom: view === 'manual' ? '2px solid #0B6E4F' : '2px solid transparent',
            color: view === 'manual' ? '#0B6E4F' : '#5B6B60', marginRight: 20,
          }}
        >
          Reserva manual
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
        <button
          onClick={() => setView('estadisticas')}
          style={{
            padding: '10px 4px', fontSize: 14, fontWeight: 600, background: 'transparent', cursor: 'pointer',
            border: 'none', borderBottom: view === 'estadisticas' ? '2px solid #0B6E4F' : '2px solid transparent',
            color: view === 'estadisticas' ? '#0B6E4F' : '#5B6B60', marginRight: 20,
          }}
        >
          Estadísticas
        </button>
        <button
          onClick={() => setView('asistencia')}
          style={{
            padding: '10px 4px', fontSize: 14, fontWeight: 600, background: 'transparent', cursor: 'pointer',
            border: 'none', borderBottom: view === 'asistencia' ? '2px solid #0B6E4F' : '2px solid transparent',
            color: view === 'asistencia' ? '#0B6E4F' : '#5B6B60', marginRight: 20,
          }}
        >
          Asistencia
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
                  <th style={{ padding: 8 }}>Clase</th>
                  <th style={{ padding: 8 }}>Solicitante</th>
                  <th style={{ padding: 8 }}>Estado</th>
                  <th style={{ padding: 8 }}></th>
                </tr>
              </thead>
              <tbody>
                {reservations.length === 0 && !loadingList && (
                  <tr>
                    <td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#5B6B60' }}>
                      Sin reservas para esta fecha.
                    </td>
                  </tr>
                )}
                {reservations.map((r) => {
                  const canCheckIn = r.status === 'confirmada' && !r.checked_in_at;
                  const canFinish = r.status === 'confirmada' && !r.returned_at;
                  const canCancel = r.status !== 'cancelada';
                  const canApproveReject = r.status === 'pendiente';

                  const startDt = new Date(`${r.date}T${r.start_time}-05:00`);
                  const minutesSinceStart = (now - startDt) / 60000;
                  const isNoShow =
                    !r.checked_in_at &&
                    minutesSinceStart > 20 &&
                    (r.status === 'confirmada' || (r.status === 'cancelada' && r.cancel_reason === 'no_asistio'));

                  const colors = isNoShow ? { bg: '#F7E8E5', fg: '#A23E33' } : STATUS_COLOR[r.status] || { bg: '#eee', fg: '#333' };
                  const statusLabel = isNoShow ? 'No asistida' : STATUS_LABEL[r.status] || r.status;
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid #DBDCCF' }}>
                      <td style={{ padding: 8 }}>{r.rooms?.name || '—'}</td>
                      <td style={{ padding: 8, fontFamily: 'monospace' }}>
                        {r.start_time?.slice(0, 5)}-{r.end_time?.slice(0, 5)}
                      </td>
                      <td style={{ padding: 8 }}>{r.clase || '—'}</td>
                      <td style={{ padding: 8 }}>
                        {r.app_users?.name || '—'}
                        <br />
                        <span style={{ color: '#5B6B60', fontSize: 11 }}>{r.app_users?.email}</span>
                      </td>
                      <td style={{ padding: 8 }}>
                        <span style={{ background: colors.bg, color: colors.fg, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20 }}>
                          {statusLabel}
                        </span>
                        {r.checked_in_at && (
                          <div style={{ fontSize: 10, color: '#5B6B60', marginTop: 2 }}>asistió</div>
                        )}
                        {r.returned_at && (
                          <div style={{ fontSize: 10, color: '#5B6B60', marginTop: 2 }}>espacio entregado</div>
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
                        {canFinish && (
                          <button onClick={() => handleFinishReservation(r.id)} disabled={actionId === r.id}
                            style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #5B3FA0', color: '#5B3FA0', borderRadius: 6, background: 'transparent', cursor: 'pointer', marginRight: 6 }}>
                            Terminar reserva
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

      {view === 'aprobaciones' && (
        <>
          <p style={{ fontSize: 13, color: '#5B6B60', marginBottom: 16 }}>
            Todas las solicitudes de aula o auditorio que están esperando tu aprobación, sin importar la fecha.
          </p>

          {pendingApprovalsError && (
            <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
              {pendingApprovalsError}
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #DBDCCF' }}>
                  <th style={{ padding: 8 }}>Espacio</th>
                  <th style={{ padding: 8 }}>Fecha</th>
                  <th style={{ padding: 8 }}>Horario</th>
                  <th style={{ padding: 8 }}>Clase</th>
                  <th style={{ padding: 8 }}>Solicitante</th>
                  <th style={{ padding: 8 }}></th>
                </tr>
              </thead>
              <tbody>
                {pendingApprovals.length === 0 && !pendingApprovalsLoading && (
                  <tr>
                    <td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#5B6B60' }}>
                      No hay solicitudes pendientes de aprobación. 🎉
                    </td>
                  </tr>
                )}
                {pendingApprovals.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #DBDCCF' }}>
                    <td style={{ padding: 8 }}>{r.rooms?.name || '—'}</td>
                    <td style={{ padding: 8 }}>{r.date}</td>
                    <td style={{ padding: 8, fontFamily: 'monospace' }}>
                      {r.start_time?.slice(0, 5)}-{r.end_time?.slice(0, 5)}
                    </td>
                    <td style={{ padding: 8 }}>{r.clase || '—'}</td>
                    <td style={{ padding: 8 }}>
                      {r.app_users?.name || '—'}
                      <br />
                      <span style={{ color: '#5B6B60', fontSize: 11 }}>{r.app_users?.email}</span>
                    </td>
                    <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                      <button onClick={() => handlePendingApprove(r.id)} disabled={pendingActionId === r.id}
                        style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #0B6E4F', color: '#0B6E4F', borderRadius: 6, background: 'transparent', cursor: 'pointer', marginRight: 6 }}>
                        {pendingActionId === r.id ? '...' : 'Aprobar'}
                      </button>
                      <button onClick={() => handlePendingReject(r.id)} disabled={pendingActionId === r.id}
                        style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #A23E33', color: '#A23E33', borderRadius: 6, background: 'transparent', cursor: 'pointer' }}>
                        {pendingActionId === r.id ? '...' : 'Rechazar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 16, margin: '28px 0 10px' }}>Préstamos de instrumentos</h2>
          <p style={{ fontSize: 13, color: '#5B6B60', marginBottom: 16 }}>
            Todos los préstamos de instrumentos que están esperando tu aprobación, sin importar la fecha.
          </p>

          {pendingInstrumentLoansError && (
            <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
              {pendingInstrumentLoansError}
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #DBDCCF' }}>
                  <th style={{ padding: 8 }}>Instrumento</th>
                  <th style={{ padding: 8 }}>Inventario</th>
                  <th style={{ padding: 8 }}>Fecha</th>
                  <th style={{ padding: 8 }}>Horario</th>
                  <th style={{ padding: 8 }}>Solicitante</th>
                  <th style={{ padding: 8 }}></th>
                </tr>
              </thead>
              <tbody>
                {pendingInstrumentLoans.length === 0 && !pendingInstrumentLoansLoading && (
                  <tr>
                    <td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#5B6B60' }}>
                      No hay préstamos de instrumentos pendientes de aprobación. 🎉
                    </td>
                  </tr>
                )}
                {pendingInstrumentLoans.map((loan) => (
                  <tr key={loan.id} style={{ borderBottom: '1px solid #DBDCCF' }}>
                    <td style={{ padding: 8 }}>{loan.instruments?.name || '—'}</td>
                    <td style={{ padding: 8, fontFamily: 'monospace' }}>{loan.instruments?.inventory_number || '—'}</td>
                    <td style={{ padding: 8 }}>{loan.date}</td>
                    <td style={{ padding: 8, fontFamily: 'monospace' }}>
                      {loan.start_time?.slice(0, 5)}-{loan.end_time?.slice(0, 5)}
                    </td>
                    <td style={{ padding: 8 }}>
                      {loan.app_users?.name || '—'}
                      <br />
                      <span style={{ color: '#5B6B60', fontSize: 11 }}>{loan.app_users?.email}</span>
                    </td>
                    <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                      <button onClick={() => handleApproveInstrumentLoan(loan.id)} disabled={instrumentLoanActionId === loan.id}
                        style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #0B6E4F', color: '#0B6E4F', borderRadius: 6, background: 'transparent', cursor: 'pointer', marginRight: 6 }}>
                        {instrumentLoanActionId === loan.id ? '...' : 'Aprobar'}
                      </button>
                      <button onClick={() => handleRejectInstrumentLoan(loan.id)} disabled={instrumentLoanActionId === loan.id}
                        style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #A23E33', color: '#A23E33', borderRadius: 6, background: 'transparent', cursor: 'pointer' }}>
                        {instrumentLoanActionId === loan.id ? '...' : 'Rechazar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === 'manual' && (
        <>
          <div style={{ background: '#F5F4EC', border: '1px solid #DBDCCF', borderRadius: 8, padding: 18, marginBottom: 26 }}>
            <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 16, margin: '0 0 6px' }}>Crear reserva sin restricciones</h2>
            <p style={{ fontSize: 12, color: '#5B6B60', margin: '0 0 14px' }}>
              Se crea directamente confirmada, sin límite de duración ni de una-reserva-a-la-vez. La única restricción que se mantiene es que el espacio esté libre en ese horario.
            </p>

            <form onSubmit={handleCreateManualReservation}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Correo institucional</label>
                  <input
                    type="email"
                    value={manualEmail}
                    onChange={(e) => setManualEmail(e.target.value)}
                    required
                    style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Nombre {manualNeedsName ? '(persona nueva, requerido)' : '(opcional)'}
                  </label>
                  <input
                    type="text"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    required={manualNeedsName}
                    style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Espacio</label>
                <select
                  value={manualRoomId}
                  onChange={(e) => setManualRoomId(e.target.value)}
                  required
                  style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
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

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Clase (opcional)</label>
                <input
                  type="text"
                  value={manualClase}
                  onChange={(e) => setManualClase(e.target.value)}
                  placeholder="Ej: Coro, Piano nivel 2, Ensayo orquesta"
                  style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <button
                  type="button"
                  onClick={() => setManualIsRecurring((v) => !v)}
                  style={{
                    padding: '8px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                    border: manualIsRecurring ? '1px solid #0B6E4F' : '1px solid #DBDCCF',
                    background: manualIsRecurring ? '#0B6E4F' : '#fff',
                    color: manualIsRecurring ? '#fff' : '#1E2A22', cursor: 'pointer',
                  }}
                >
                  {manualIsRecurring ? '✓ Reserva recurrente' : 'Reserva recurrente'}
                </button>
                {manualIsRecurring && (
                  <p style={{ fontSize: 11, color: '#5B6B60', margin: '6px 0 0' }}>
                    Se repite en los días elegidos, entre la fecha de inicio y la fecha de fin, con el mismo horario.
                  </p>
                )}
              </div>

              {manualIsRecurring ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Fecha inicio</label>
                      <input
                        type="date"
                        value={manualRecurDateFrom}
                        onChange={(e) => setManualRecurDateFrom(e.target.value)}
                        required
                        style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Fecha fin</label>
                      <input
                        type="date"
                        value={manualRecurDateTo}
                        onChange={(e) => setManualRecurDateTo(e.target.value)}
                        required
                        style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Días de la semana</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {RECUR_DAY_OPTIONS.map((d) => {
                        const selected = manualRecurDays.includes(d.code);
                        return (
                          <button
                            key={d.code}
                            type="button"
                            onClick={() =>
                              setManualRecurDays((prev) =>
                                prev.includes(d.code) ? prev.filter((c) => c !== d.code) : [...prev, d.code]
                              )
                            }
                            style={{
                              width: 36, height: 36, borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                              border: selected ? '1px solid #0B6E4F' : '1px solid #DBDCCF',
                              background: selected ? '#0B6E4F' : '#fff',
                              color: selected ? '#fff' : '#1E2A22',
                            }}
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>
                    <p style={{ fontSize: 11, color: '#5B6B60', margin: '6px 0 0' }}>
                      L=lunes, M=martes, W=miércoles, J=jueves, V=viernes, S=sábado, D=domingo. Puedes elegir uno o varios.
                    </p>
                  </div>
                </>
              ) : (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Fecha</label>
                  <input
                    type="date"
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    required
                    style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                  />
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Hora inicio</label>
                  <select
                    value={manualStart}
                    onChange={(e) => setManualStart(e.target.value)}
                    required
                    style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                  >
                    {HALF_HOUR_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Hora fin</label>
                  <select
                    value={manualEnd}
                    onChange={(e) => setManualEnd(e.target.value)}
                    required
                    style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                  >
                    {HALF_HOUR_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Nota (opcional)</label>
                <input
                  type="text"
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                  placeholder="Ej: ensayo especial autorizado por dirección"
                  style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                />
              </div>

              {manualFormError && (
                <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
                  {manualFormError}
                </div>
              )}
              {manualFormWarning && (
                <div style={{ background: '#FCF3D9', border: '1px solid #E9CD70', color: '#7A5B00', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
                  {manualFormWarning}
                </div>
              )}
              {manualFormSuccess && (
                <div style={{ background: '#E4F0EA', border: '1px solid #bcd9c9', color: '#084F39', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
                  {manualFormSuccess}
                </div>
              )}

              <button
                type="submit"
                disabled={manualSubmitting}
                style={{
                  padding: '9px 18px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: '1px solid #0B6E4F',
                  background: '#0B6E4F', color: '#fff', cursor: manualSubmitting ? 'not-allowed' : 'pointer', opacity: manualSubmitting ? 0.7 : 1,
                }}
              >
                {manualSubmitting ? 'Guardando...' : manualIsRecurring ? 'Crear clase recurrente' : 'Crear reserva confirmada'}
              </button>
            </form>
          </div>

          <div style={{ background: '#F5F4EC', border: '1px solid #DBDCCF', borderRadius: 8, padding: 18, marginBottom: 26 }}>
            <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 16, margin: '0 0 6px' }}>Bloquear espacio</h2>
            <p style={{ fontSize: 12, color: '#5B6B60', margin: '0 0 14px' }}>
              Ocupa el espacio de 6:00 a.m. a 8:00 p.m. en cada día del rango, para que nadie pueda reservarlo (ej. mantenimiento). Si algún día ya tiene algo reservado, ese día se omite y se reporta.
            </p>

            <form onSubmit={handleBlockRoom}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Espacio</label>
                <select
                  value={blockRoomId}
                  onChange={(e) => setBlockRoomId(e.target.value)}
                  required
                  style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Desde</label>
                  <input
                    type="date"
                    value={blockDateFrom}
                    onChange={(e) => setBlockDateFrom(e.target.value)}
                    required
                    style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Hasta</label>
                  <input
                    type="date"
                    value={blockDateTo}
                    onChange={(e) => setBlockDateTo(e.target.value)}
                    required
                    style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Motivo (opcional)</label>
                <input
                  type="text"
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="Ej: mantenimiento eléctrico"
                  style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                />
              </div>

              {blockError && (
                <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
                  {blockError}
                </div>
              )}
              {blockResults && (
                <div style={{ background: '#E4F0EA', border: '1px solid #bcd9c9', color: '#084F39', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
                  {blockResults.blocked} de {blockResults.total} día(s) bloqueado(s) correctamente.
                  {blockResults.skippedDates.length > 0 && (
                    <> Días que ya tenían algo y no se pudieron bloquear: {blockResults.skippedDates.join(', ')}.</>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={blockSubmitting}
                style={{
                  padding: '9px 18px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: '1px solid #A23E33',
                  color: '#A23E33', background: 'transparent', cursor: blockSubmitting ? 'not-allowed' : 'pointer', opacity: blockSubmitting ? 0.7 : 1,
                }}
              >
                {blockSubmitting ? 'Bloqueando...' : 'Bloquear espacio'}
              </button>
            </form>
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
                    <th style={{ padding: 8 }}>Inventario</th>
                    <th style={{ padding: 8 }}>Horario</th>
                    <th style={{ padding: 8 }}>Solicitante</th>
                    <th style={{ padding: 8 }}>Estado</th>
                    <th style={{ padding: 8 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {instrumentLoans.length === 0 && !instrumentLoansLoading && (
                    <tr>
                      <td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#5B6B60' }}>
                        Sin préstamos reservados para esta fecha.
                      </td>
                    </tr>
                  )}
                  {instrumentLoans.map((loan) => {
                    const colors = STATUS_COLOR[loan.status] || { bg: '#eee', fg: '#333' };
                    return (
                      <tr key={loan.id} style={{ borderBottom: '1px solid #DBDCCF' }}>
                        <td style={{ padding: 8 }}>{loan.instruments?.name || '—'}</td>
                        <td style={{ padding: 8, fontFamily: 'monospace' }}>{loan.instruments?.inventory_number || '—'}</td>
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
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {loan.status === 'pendiente' && (
                              <>
                                <button
                                  onClick={() => handleApproveInstrumentLoan(loan.id)}
                                  disabled={instrumentLoanActionId === loan.id}
                                  style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #0B6E4F', color: '#fff', background: '#0B6E4F', borderRadius: 6, cursor: 'pointer' }}
                                >
                                  {instrumentLoanActionId === loan.id ? '...' : 'Aprobar'}
                                </button>
                                <button
                                  onClick={() => handleRejectInstrumentLoan(loan.id)}
                                  disabled={instrumentLoanActionId === loan.id}
                                  style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #A23E33', color: '#A23E33', borderRadius: 6, background: 'transparent', cursor: 'pointer' }}
                                >
                                  Rechazar
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => handleCancelInstrumentLoan(loan.id)}
                              disabled={instrumentLoanActionId === loan.id}
                              style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #A23E33', color: '#A23E33', borderRadius: 6, background: 'transparent', cursor: 'pointer' }}
                            >
                              {instrumentLoanActionId === loan.id ? '...' : 'Cancelar'}
                            </button>
                          </div>
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
                      onClick={() => openWeekCreateModal(dayDate)}
                      style={{
                        flex: 1, minWidth: 120, border: '1px solid #DBDCCF', borderRadius: 8,
                        background: isToday ? '#FBFAF3' : '#fff', padding: 8, cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{WEEKDAY_LABEL[weekdayIndex]}</div>
                      <div style={{ fontSize: 11, color: '#5B6B60', marginBottom: 8 }}>{formatDayShort(dayDate)}</div>

                      {weekLoading && <div style={{ fontSize: 11, color: '#5B6B60' }}>…</div>}

                      {!weekLoading && dayReservations.length === 0 && (
                        <div style={{ fontSize: 11, color: '#5B6B60' }}>Libre — clic para reservar</div>
                      )}

                      {dayReservations.map((r) => {
                        const colors = STATUS_COLOR[r.status] || { bg: '#eee', fg: '#333' };
                        return (
                          <div
                            key={r.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              openWeekEditModal(r);
                            }}
                            style={{
                              background: colors.bg, color: colors.fg, borderRadius: 6, padding: '4px 6px',
                              marginBottom: 6, fontSize: 11, cursor: 'pointer',
                            }}
                          >
                            <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                              {r.start_time?.slice(0, 5)}-{r.end_time?.slice(0, 5)}
                            </div>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.app_users?.name || '—'}
                            </div>
                            {r.clase && (
                              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'italic' }}>
                                {r.clase}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {weekModalOpen && (
            <div
              onClick={closeWeekModal}
              style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', zIndex: 1000, padding: 16,
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: '#fff', borderRadius: 10, padding: 22, width: '100%', maxWidth: 440,
                  maxHeight: '90vh', overflowY: 'auto',
                }}
              >
                <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 16, margin: '0 0 4px' }}>
                  {weekModalMode === 'create' ? 'Nueva reserva' : 'Editar / mover reserva'}
                </h2>
                <p style={{ fontSize: 12, color: '#5B6B60', margin: '0 0 16px' }}>
                  {weekModalMode === 'create'
                    ? 'Se crea directamente confirmada en el espacio y día seleccionados.'
                    : 'Puedes cambiar la fecha, hora, espacio o clase. También puedes cancelarla.'}
                  {weekModalMode === 'edit' && weekModalRecurringTemplateId && (
                    <>
                      {' '}
                      <strong>Esta reserva es parte de una clase recurrente.</strong> "Guardar cambios" solo afecta esta fecha. Para cambiar espacio, horario o clase en TODA la serie, ajusta los campos de abajo y usa "Aplicar a toda la serie".
                    </>
                  )}
                </p>

                <form onSubmit={handleWeekModalSubmit}>
                  {weekModalMode === 'create' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Correo institucional</label>
                        <input
                          type="email"
                          value={weekModalEmail}
                          onChange={(e) => setWeekModalEmail(e.target.value)}
                          required
                          style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                          Nombre {weekModalNeedsName ? '(persona nueva, requerido)' : '(opcional)'}
                        </label>
                        <input
                          type="text"
                          value={weekModalName}
                          onChange={(e) => setWeekModalName(e.target.value)}
                          required={weekModalNeedsName}
                          style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                        />
                      </div>
                    </div>
                  )}

                  {weekModalMode === 'edit' && (
                    <div style={{ marginBottom: 12, fontSize: 13 }}>
                      <strong>{weekModalName || '—'}</strong>
                      <br />
                      <span style={{ color: '#5B6B60', fontSize: 12 }}>{weekModalEmail}</span>
                      {weekModalStatus && (
                        <span style={{ marginLeft: 8, fontSize: 11, color: '#5B6B60' }}>
                          (estado: {STATUS_LABEL[weekModalStatus] || weekModalStatus})
                        </span>
                      )}
                    </div>
                  )}

                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Espacio</label>
                    <select
                      value={weekModalRoomId}
                      onChange={(e) => setWeekModalRoomId(e.target.value)}
                      required
                      style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
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
                    {weekModalMode === 'edit' && (
                      <p style={{ fontSize: 11, color: '#5B6B60', margin: '4px 0 0' }}>
                        Cambiar el espacio y/o la fecha/hora aquí abajo mueve la reserva.
                      </p>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Fecha</label>
                      <input
                        type="date"
                        value={weekModalDate}
                        onChange={(e) => setWeekModalDate(e.target.value)}
                        required
                        style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Hora inicio</label>
                      <select
                        value={weekModalStart}
                        onChange={(e) => setWeekModalStart(e.target.value)}
                        required
                        style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                      >
                        {HALF_HOUR_OPTIONS.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Hora fin</label>
                      <select
                        value={weekModalEnd}
                        onChange={(e) => setWeekModalEnd(e.target.value)}
                        required
                        style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                      >
                        {HALF_HOUR_OPTIONS.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Clase (opcional)</label>
                    <input
                      type="text"
                      value={weekModalClase}
                      onChange={(e) => setWeekModalClase(e.target.value)}
                      placeholder="Ej: Coro, Piano nivel 2, Ensayo orquesta"
                      style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                    />
                  </div>

                  {weekModalMode === 'edit' && weekModalRecurringTemplateId && (
                    <div style={{ marginBottom: 14, padding: 12, background: '#F5F4EC', border: '1px solid #DBDCCF', borderRadius: 8 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 10px' }}>
                        Patrón de la clase recurrente
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
                        <div>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Fecha inicio</label>
                          <input
                            type="date"
                            value={weekModalRecurDateFrom}
                            onChange={(e) => setWeekModalRecurDateFrom(e.target.value)}
                            style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                          />
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Fecha fin</label>
                          <input
                            type="date"
                            value={weekModalRecurDateTo}
                            onChange={(e) => setWeekModalRecurDateTo(e.target.value)}
                            style={{ width: '100%', padding: 9, fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', boxSizing: 'border-box' }}
                          />
                        </div>
                      </div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Días de la semana</label>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {RECUR_DAY_OPTIONS.map((d) => {
                          const selected = weekModalRecurDays.includes(d.code);
                          return (
                            <button
                              key={d.code}
                              type="button"
                              onClick={() =>
                                setWeekModalRecurDays((prev) =>
                                  prev.includes(d.code) ? prev.filter((c) => c !== d.code) : [...prev, d.code]
                                )
                              }
                              style={{
                                width: 32, height: 32, borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                border: selected ? '1px solid #0B6E4F' : '1px solid #DBDCCF',
                                background: selected ? '#0B6E4F' : '#fff',
                                color: selected ? '#fff' : '#1E2A22',
                              }}
                            >
                              {d.label}
                            </button>
                          );
                        })}
                      </div>
                      <p style={{ fontSize: 11, color: '#5B6B60', margin: '8px 0 0' }}>
                        Estos campos, junto con el espacio, la hora y la clase de arriba, se aplican a TODA la serie
                        al presionar "Aplicar a toda la serie". Las fechas que dejen de encajar en el nuevo rango o
                        días se cancelan; las que falten se crean.
                      </p>
                    </div>
                  )}

                  {weekModalError && (
                    <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
                      {weekModalError}
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {weekModalMode === 'edit' && weekModalRecurringTemplateId && (
                        <>
                          <button
                            type="button"
                            onClick={handleWeekModalDeleteOne}
                            disabled={weekModalSubmitting}
                            style={{
                              padding: '9px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid #A23E33',
                              color: '#A23E33', background: 'transparent', cursor: weekModalSubmitting ? 'not-allowed' : 'pointer',
                            }}
                          >
                            Eliminar solo esta fecha
                          </button>
                          <button
                            type="button"
                            onClick={handleWeekModalDeleteAllRecurring}
                            disabled={weekModalSubmitting}
                            style={{
                              padding: '9px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid #A23E33',
                              color: '#fff', background: '#A23E33', cursor: weekModalSubmitting ? 'not-allowed' : 'pointer',
                            }}
                          >
                            Eliminar todas las recurrentes
                          </button>
                          <button
                            type="button"
                            onClick={handleWeekModalEditAllRecurring}
                            disabled={weekModalSubmitting}
                            style={{
                              padding: '9px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid #0B6E4F',
                              color: '#fff', background: '#0B6E4F', cursor: weekModalSubmitting ? 'not-allowed' : 'pointer',
                            }}
                          >
                            Aplicar a toda la serie
                          </button>
                        </>
                      )}
                      {weekModalMode === 'edit' && !weekModalRecurringTemplateId && (
                        <button
                          type="button"
                          onClick={handleWeekModalDeleteOne}
                          disabled={weekModalSubmitting}
                          style={{
                            padding: '9px 16px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: '1px solid #A23E33',
                            color: '#A23E33', background: 'transparent', cursor: weekModalSubmitting ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Eliminar reserva
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={closeWeekModal}
                        disabled={weekModalSubmitting}
                        style={{ padding: '9px 16px', fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', background: '#fff', cursor: 'pointer' }}
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={weekModalSubmitting}
                        style={{
                          padding: '9px 16px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: '1px solid #0B6E4F',
                          background: '#0B6E4F', color: '#fff', cursor: weekModalSubmitting ? 'not-allowed' : 'pointer', opacity: weekModalSubmitting ? 0.7 : 1,
                        }}
                      >
                        {weekModalSubmitting ? 'Guardando...' : weekModalMode === 'create' ? 'Crear reserva' : 'Guardar cambios'}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}

      {view === 'estadisticas' && (
        <>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 24 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Desde</label>
              <input
                type="date"
                value={statsFrom}
                onChange={(e) => setStatsFrom(e.target.value)}
                style={{ padding: 8, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 13 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Hasta</label>
              <input
                type="date"
                value={statsTo}
                onChange={(e) => setStatsTo(e.target.value)}
                style={{ padding: 8, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 13 }}
              />
            </div>
            <button
              onClick={handleDownloadStats}
              disabled={statsLoading || statsTotal + statsInstrumentTotal === 0}
              style={{
                padding: '9px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid #0B6E4F',
                color: '#0B6E4F', background: 'transparent', cursor: 'pointer',
                opacity: statsLoading || statsTotal + statsInstrumentTotal === 0 ? 0.5 : 1,
              }}
            >
              Descargar Excel
            </button>
            {statsLoading && <span style={{ fontSize: 13, color: '#5B6B60' }}>Cargando…</span>}
          </div>

          {statsError && (
            <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 20, fontSize: 13 }}>
              {statsError}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 28 }}>
            <div style={{ background: '#F5F4EC', border: '1px solid #DBDCCF', borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'Georgia, serif' }}>{statsTotal}</div>
              <div style={{ fontSize: 12, color: '#5B6B60' }}>Solicitudes de espacio</div>
            </div>
            <div style={{ background: '#F5F4EC', border: '1px solid #DBDCCF', borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'Georgia, serif' }}>{statsInstrumentTotal}</div>
              <div style={{ fontSize: 12, color: '#5B6B60' }}>Préstamos de instrumentos</div>
            </div>
            <div style={{ background: '#F5F4EC', border: '1px solid #DBDCCF', borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'Georgia, serif' }}>
                {noShowRate === null ? '—' : `${noShowRate}%`}
              </div>
              <div style={{ fontSize: 12, color: '#5B6B60' }}>
                Tasa de inasistencia{noShowRate !== null && ` (${noShows.length}/${completedConfirmed.length})`}
              </div>
            </div>
            <div style={{ background: '#F5F4EC', border: '1px solid #DBDCCF', borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'Georgia, serif' }}>{statsActiveSanctions}</div>
              <div style={{ fontSize: 12, color: '#5B6B60' }}>Sanciones activas hoy</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 28 }}>
            <div>
              <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 15, margin: '0 0 12px' }}>Solicitudes por estado</h3>
              {Object.keys(STATUS_LABEL).map((key) => {
                const count = statsByStatus[key] || 0;
                const pct = statsTotal > 0 ? (count / statsTotal) * 100 : 0;
                const colors = STATUS_COLOR[key] || { bg: '#eee', fg: '#333' };
                return (
                  <div key={key} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                      <span>{STATUS_LABEL[key]}</span>
                      <span style={{ color: '#5B6B60' }}>{count}</span>
                    </div>
                    <div style={{ height: 8, background: '#F5F4EC', borderRadius: 4 }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: colors.fg, borderRadius: 4 }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div>
              <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 15, margin: '0 0 12px' }}>Solicitudes por tipo de espacio</h3>
              {ROOM_TYPE_ORDER.map((t) => {
                const count = statsByType[t] || 0;
                const pct = statsTotal > 0 ? (count / statsTotal) * 100 : 0;
                return (
                  <div key={t} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                      <span>{ROOM_TYPE_LABEL[t]}</span>
                      <span style={{ color: '#5B6B60' }}>{count}</span>
                    </div>
                    <div style={{ height: 8, background: '#F5F4EC', borderRadius: 4 }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: '#0B6E4F', borderRadius: 4 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div>
              <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 15, margin: '0 0 12px' }}>Espacios más solicitados</h3>
              {topRooms.length === 0 && (
                <p style={{ fontSize: 13, color: '#5B6B60' }}>Sin datos en este periodo.</p>
              )}
              {topRooms.map(([name, count]) => (
                <div key={name} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span>{name}</span>
                    <span style={{ color: '#5B6B60' }}>{count}</span>
                  </div>
                  <div style={{ height: 8, background: '#F5F4EC', borderRadius: 4 }}>
                    <div style={{ height: '100%', width: `${(count / topRoomsMax) * 100}%`, background: '#0B6E4F', borderRadius: 4 }} />
                  </div>
                </div>
              ))}
            </div>

            <div>
              <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 15, margin: '0 0 12px' }}>Instrumentos más solicitados</h3>
              {topInstruments.length === 0 && (
                <p style={{ fontSize: 13, color: '#5B6B60' }}>Sin datos en este periodo.</p>
              )}
              {topInstruments.map(([name, count]) => (
                <div key={name} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span>{name}</span>
                    <span style={{ color: '#5B6B60' }}>{count}</span>
                  </div>
                  <div style={{ height: 8, background: '#F5F4EC', borderRadius: 4 }}>
                    <div style={{ height: '100%', width: `${(count / topInstrumentsMax) * 100}%`, background: '#5B3FA0', borderRadius: 4 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {view === 'asistencia' && (
        <>
          <p style={{ fontSize: 13, color: '#5B6B60', marginBottom: 16 }}>
            Asistencia por persona — cuánto de lo programado realmente se dictó, separando clases recurrentes (carga masiva) de reservas puntuales (por si alguien reprograma una clase perdida como reserva suelta).
          </p>

          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Desde</label>
              <input type="date" value={attFrom} onChange={(e) => setAttFrom(e.target.value)}
                style={{ padding: 8, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 13 }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Hasta</label>
              <input type="date" value={attTo} onChange={(e) => setAttTo(e.target.value)}
                style={{ padding: 8, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 13 }} />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Buscar por correo o nombre</label>
              <input type="text" value={attSearch} onChange={(e) => setAttSearch(e.target.value)}
                placeholder="Ej: jorge.gomezb@udea.edu.co"
                style={{ width: '100%', padding: 8, border: '1px solid #DBDCCF', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <button
              onClick={handleDownloadAttendance}
              disabled={attLoading || attRows.length === 0}
              style={{
                padding: '9px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid #0B6E4F',
                color: '#0B6E4F', background: 'transparent', cursor: 'pointer',
                opacity: attLoading || attRows.length === 0 ? 0.5 : 1,
              }}
            >
              Descargar Excel
            </button>
            {attLoading && <span style={{ fontSize: 13, color: '#5B6B60' }}>Cargando…</span>}
          </div>

          {attError && (
            <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 12, borderRadius: 8, marginBottom: 20, fontSize: 13 }}>
              {attError}
            </div>
          )}

          <div style={{ overflowX: 'auto', marginBottom: 32 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #DBDCCF' }}>
                  <th style={{ padding: 8 }}>Persona</th>
                  <th style={{ padding: 8 }}>Recurrentes</th>
                  <th style={{ padding: 8 }}>% recurrentes</th>
                  <th style={{ padding: 8 }}>Puntuales</th>
                  <th style={{ padding: 8 }}>% puntuales</th>
                  <th style={{ padding: 8 }}>% total</th>
                </tr>
              </thead>
              <tbody>
                {attRows
                  .filter((u) => {
                    const q = attSearch.trim().toLowerCase();
                    if (!q) return true;
                    return u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q);
                  })
                  .map((u) => (
                    <tr key={u.userId} style={{ borderBottom: '1px solid #DBDCCF' }}>
                      <td style={{ padding: 8 }}>
                        {u.name}
                        <br />
                        <span style={{ color: '#5B6B60', fontSize: 11 }}>{u.email}</span>
                      </td>
                      <td style={{ padding: 8 }}>{u.recAttended}/{u.recTotal}</td>
                      <td style={{ padding: 8, fontWeight: 600, color: u.recPct !== null && u.recPct < 70 ? '#A23E33' : '#16241C' }}>
                        {u.recPct === null ? '—' : `${u.recPct}%`}
                      </td>
                      <td style={{ padding: 8 }}>{u.adhocAttended}/{u.adhocTotal}</td>
                      <td style={{ padding: 8 }}>{u.adhocPct === null ? '—' : `${u.adhocPct}%`}</td>
                      <td style={{ padding: 8, fontWeight: 700 }}>{u.totalPct === null ? '—' : `${u.totalPct}%`}</td>
                    </tr>
                  ))}
                {attRows.length === 0 && !attLoading && (
                  <tr>
                    <td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#5B6B60' }}>
                      Sin datos en este periodo.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ background: '#F5F4EC', border: '1px solid #DBDCCF', borderRadius: 8, padding: 18 }}>
            <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 16, margin: '0 0 6px' }}>Depurar datos antiguos</h2>
            <p style={{ fontSize: 12, color: '#5B6B60', margin: '0 0 14px' }}>
              El sistema solo necesita guardar los últimos 12 meses de reservas y préstamos de instrumentos. Este botón borra permanentemente todo lo anterior a esa fecha, para liberar espacio si hace falta. No afecta las cuentas de usuarios ni las sanciones.
            </p>

            {purgeError && (
              <div style={{ background: '#F7E8E5', border: '1px solid #e6bdb6', color: '#A23E33', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
                {purgeError}
              </div>
            )}
            {purgeResult && (
              <div style={{ background: '#E4F0EA', border: '1px solid #bcd9c9', color: '#084F39', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
                Se borraron {purgeResult.reservations} reserva(s) y {purgeResult.loans} préstamo(s) de instrumentos anteriores al {purgeResult.cutoff}.
              </div>
            )}

            {!purgeConfirming ? (
              <button
                onClick={() => setPurgeConfirming(true)}
                style={{ padding: '9px 18px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: '1px solid #A23E33', color: '#A23E33', background: 'transparent', cursor: 'pointer' }}
              >
                Depurar datos de hace más de 12 meses
              </button>
            ) : (
              <div>
                <div style={{ background: '#FBF1D6', border: '1px solid #eadca0', color: '#6b5510', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
                  Esta acción no se puede deshacer. ¿Confirmas que quieres borrar permanentemente todas las reservas y préstamos anteriores al {addDays(todayStr(), -365)}?
                </div>
                <button
                  onClick={handlePurgeOldData}
                  disabled={purgeRunning}
                  style={{ padding: '9px 18px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: '1px solid #A23E33', background: '#A23E33', color: '#fff', cursor: 'pointer', marginRight: 8 }}
                >
                  {purgeRunning ? 'Borrando...' : 'Sí, borrar permanentemente'}
                </button>
                <button
                  onClick={() => setPurgeConfirming(false)}
                  disabled={purgeRunning}
                  style={{ padding: '9px 18px', fontSize: 13, borderRadius: 6, border: '1px solid #DBDCCF', background: '#fff', cursor: 'pointer' }}
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}