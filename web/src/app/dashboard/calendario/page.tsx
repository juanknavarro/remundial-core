'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
  Search,
  RefreshCw,
  Clock,
  CheckCircle2,
  DollarSign,
  User,
  Users,
  AlertCircle,
  Sparkles,
  TrendingUp,
  X,
  Phone,
  CreditCard,
  Building2,
  HelpCircle,
  FileSpreadsheet,
} from 'lucide-react';
import { formatCOP, cn } from '@/lib/utils';
import { api } from '@/lib/api';

interface ItemCuotaCalendario {
  id_contrato: string;
  codigo_contrato: string;
  cliente_nombre: string;
  cliente_cedula: string;
  cliente_telefono: string;
  cobrador_nombre: string;
  numero_cuota: number;
  total_cuotas: number;
  cuota_texto: string;
  valor_cuota: number;
  pagada: boolean;
  estado: 'pagada' | 'pendiente' | 'vencida' | 'hoy' | 'futura';
}

interface DiaCalendarioData {
  fecha: string; // 'YYYY-MM-DD'
  dia: number;
  total_programado: number;
  total_recaudado: number;
  total_pendiente: number;
  cuotas_totales: number;
  cuotas_pagadas: number;
  cuotas_pendientes: number;
  items: ItemCuotaCalendario[];
}

interface MetricasMesData {
  total_programado: number;
  total_recaudado: number;
  total_pendiente: number;
  cuotas_totales: number;
  cuotas_pagadas: number;
  cuotas_pendientes: number;
  dias_con_actividad: number;
  porcentaje_recaudo: number;
}

interface CalendarioResponse {
  year: number;
  month: number;
  nombre_mes: string;
  metricas_mes: MetricasMesData;
  filtros: {
    year: number;
    month: number;
    cobrador_id: string | null;
    search: string | null;
  };
  dias: Record<string, DiaCalendarioData>;
}

interface CobradorOption {
  id: string;
  nombre: string;
  telefono?: string;
}

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const MESES_NOMBRES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

export default function CalendarioCarteraPage() {
  const hoy = useMemo(() => new Date(), []);
  const [currentYear, setCurrentYear] = useState<number>(hoy.getFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(hoy.getMonth() + 1); // 1..12

  // Filtros
  const [cobradores, setCobradores] = useState<CobradorOption[]>([]);
  const [selectedCobrador, setSelectedCobrador] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'pendientes' | 'pagadas'>('todos');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Datos y Estados
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [calendarData, setCalendarData] = useState<CalendarioResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Selección de día para panel lateral / modal de auditoría
  const [selectedDayDate, setSelectedDayDate] = useState<string | null>(null);

  // Tooltip flotante al hacer hover
  const [hoveredDay, setHoveredDay] = useState<DiaCalendarioData | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Cargar lista de cobradores
  const fetchCobradores = useCallback(async () => {
    try {
      const res = await api.get('/usuarios?rol=cobrador');
      if (res.data && Array.isArray(res.data)) {
        setCobradores(res.data);
      }
    } catch (err) {
      console.warn('Error cargando cobradores:', err);
    }
  }, []);

  // Cargar datos del calendario
  const fetchCalendar = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);

      const params = new URLSearchParams();
      params.append('year', currentYear.toString());
      params.append('month', currentMonth.toString());
      if (selectedCobrador) params.append('cobrador_id', selectedCobrador);
      if (searchTerm.trim()) params.append('search', searchTerm.trim());

      const res = await api.get(`/reportes/calendario?${params.toString()}`);
      if (res.data) {
        setCalendarData(res.data);
      }
    } catch (err: any) {
      console.error('Error al cargar calendario de cartera:', err);
      setErrorMessage(err.message || 'No se pudo cargar la agenda del calendario.');
    } finally {
      setIsLoading(false);
    }
  }, [currentYear, currentMonth, selectedCobrador, searchTerm]);

  useEffect(() => {
    fetchCobradores();
  }, [fetchCobradores]);

  useEffect(() => {
    fetchCalendar();
  }, [fetchCalendar]);

  // Navegación de mes
  const handlePrevMonth = () => {
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
    setSelectedDayDate(null);
  };

  const handleNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
    setSelectedDayDate(null);
  };

  const handleCurrentMonth = () => {
    const now = new Date();
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth() + 1);
    setSelectedDayDate(null);
  };

  // Cadena ISO de hoy para destacar
  const todayStr = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, []);

  // Generación de celdas del calendario
  const calendarGrid = useMemo(() => {
    // Primer día del mes actual
    const firstDayDate = new Date(currentYear, currentMonth - 1, 1);
    // Día de la semana en formato ISO (0: Domingo, 1: Lunes... 6: Sábado)
    let firstDayIndex = firstDayDate.getDay(); // 0 es Dom
    // Queremos que Lunes sea 0, ..., Domingo sea 6
    const startOffset = firstDayIndex === 0 ? 6 : firstDayIndex - 1;

    // Total de días del mes actual
    const totalDaysInMonth = new Date(currentYear, currentMonth, 0).getDate();

    // Días del mes anterior para relleno inicial
    const totalDaysPrevMonth = new Date(currentYear, currentMonth - 1, 0).getDate();
    const prevPaddingCells = [];
    for (let i = startOffset - 1; i >= 0; i--) {
      prevPaddingCells.push({
        dayNumber: totalDaysPrevMonth - i,
        isCurrentMonth: false,
        dateStr: '',
        data: null,
      });
    }

    // Celdas del mes actual
    const currentCells = [];
    const diasMap = calendarData?.dias || {};

    for (let day = 1; day <= totalDaysInMonth; day++) {
      const dayStr = String(day).padStart(2, '0');
      const monthStr = String(currentMonth).padStart(2, '0');
      const dateStr = `${currentYear}-${monthStr}-${dayStr}`;
      
      const rawData = diasMap[dateStr] || null;
      let filteredData = rawData;

      if (rawData && statusFilter !== 'todos') {
        const filteredItems = rawData.items.filter((it) => {
          if (statusFilter === 'pagadas') return it.pagada;
          if (statusFilter === 'pendientes') return !it.pagada;
          return true;
        });

        filteredData = {
          ...rawData,
          items: filteredItems,
        };
      }

      currentCells.push({
        dayNumber: day,
        isCurrentMonth: true,
        dateStr,
        isToday: dateStr === todayStr,
        data: filteredData,
        hasActivity: Boolean(filteredData && filteredData.items && filteredData.items.length > 0),
      });
    }

    // Celdas de relleno del mes siguiente para completar la matriz de 7 columnas
    const totalCellsSoFar = prevPaddingCells.length + currentCells.length;
    const nextPaddingNeeded = (7 - (totalCellsSoFar % 7)) % 7;
    const nextPaddingCells = [];
    for (let i = 1; i <= nextPaddingNeeded; i++) {
      nextPaddingCells.push({
        dayNumber: i,
        isCurrentMonth: false,
        dateStr: '',
        data: null,
      });
    }

    return [...prevPaddingCells, ...currentCells, ...nextPaddingCells];
  }, [currentYear, currentMonth, calendarData, statusFilter, todayStr]);

  // Datos del día seleccionado para el modal / drawer de auditoría
  const selectedDayData = useMemo(() => {
    if (!selectedDayDate || !calendarData?.dias) return null;
    const raw = calendarData.dias[selectedDayDate];
    if (!raw) return null;
    if (statusFilter === 'todos') return raw;

    const filtered = raw.items.filter((it) => {
      if (statusFilter === 'pagadas') return it.pagada;
      if (statusFilter === 'pendientes') return !it.pagada;
      return true;
    });

    return {
      ...raw,
      items: filtered,
    };
  }, [selectedDayDate, calendarData, statusFilter]);

  // Handlers para hover / tooltip flotante
  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>, data: DiaCalendarioData | null) => {
    if (!data || !data.items || data.items.length === 0) {
      setHoveredDay(null);
      setTooltipPos(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    // Centramos el tooltip relativo a la celda
    setTooltipPos({
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
    });
    setHoveredDay(data);
  };

  const handleMouseLeave = () => {
    setHoveredDay(null);
    setTooltipPos(null);
  };

  const metricas = calendarData?.metricas_mes || {
    total_programado: 0,
    total_recaudado: 0,
    total_pendiente: 0,
    cuotas_totales: 0,
    cuotas_pagadas: 0,
    cuotas_pendientes: 0,
    dias_con_actividad: 0,
    porcentaje_recaudo: 0,
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      
      {/* ========================================================================= */}
      {/* 1. ENCABEZADO PRINCIPAL Y CONTROLES DE NAVEGACIÓN DE MES                   */}
      {/* ========================================================================= */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center shadow-md shadow-blue-500/20 shrink-0">
            <CalendarDays className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                Calendario de Cartera
              </h1>
              <span className="bg-blue-50 text-blue-700 text-xs font-bold px-2.5 py-0.5 rounded-full border border-blue-200/60 uppercase tracking-wide">
                Supervisión
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Agenda interactiva de cuotas programadas, vencimientos y estados de recaudo
            </p>
          </div>
        </div>

        {/* NAVEGADOR DE MESES INTERACTIVO */}
        <div className="flex flex-wrap items-center gap-2.5 bg-slate-50 p-1.5 rounded-xl border border-slate-200/80 self-start md:self-auto">
          <button
            onClick={handlePrevMonth}
            disabled={isLoading}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-white rounded-lg transition-all border border-transparent hover:border-slate-200 shadow-none hover:shadow-xs disabled:opacity-50"
            title="Mes anterior"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="px-3 py-1 flex items-center gap-2 min-w-[170px] justify-center text-center">
            <span className="text-sm sm:text-base font-black text-slate-900 tracking-tight">
              {MESES_NOMBRES[currentMonth - 1]} {currentYear}
            </span>
          </div>

          <button
            onClick={handleNextMonth}
            disabled={isLoading}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-white rounded-lg transition-all border border-transparent hover:border-slate-200 shadow-none hover:shadow-xs disabled:opacity-50"
            title="Mes siguiente"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          <button
            onClick={handleCurrentMonth}
            disabled={isLoading}
            className="ml-1 text-xs font-bold text-blue-700 hover:text-blue-800 bg-blue-50 hover:bg-blue-100/80 border border-blue-200/80 px-3 py-1.5 rounded-lg transition-colors shadow-xs"
          >
            Hoy
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. TARJETAS DE KPIS DEL MES CONSULTADO                                    */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Programado */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Total Programado ({MESES_NOMBRES[currentMonth - 1]})
            </span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <p className="text-2xl font-black text-slate-900 tracking-tight">
              {formatCOP(metricas.total_programado)}
            </p>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
              <span>{metricas.cuotas_totales} cuotas exigibles en {metricas.dias_con_actividad} días</span>
            </p>
          </div>
        </div>

        {/* Total Recaudado con Verificación */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
              Recaudado con Verificación (Chulos)
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <p className="text-2xl font-black text-emerald-600 tracking-tight">
              {formatCOP(metricas.total_recaudado)}
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60">
                ✔ {metricas.cuotas_pagadas} cuotas cobradas
              </span>
            </div>
          </div>
        </div>

        {/* Saldo Pendiente de Recaudo */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">
              Pendiente por Cobrar
            </span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <p className="text-2xl font-black text-amber-600 tracking-tight">
              {formatCOP(metricas.total_pendiente)}
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200/60">
                ⏳ {metricas.cuotas_pendientes} cuotas pendientes
              </span>
            </div>
          </div>
        </div>

        {/* Efectividad del Mes */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Efectividad de Recaudo
            </span>
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-black text-slate-900 tracking-tight">
                {metricas.porcentaje_recaudo}%
              </p>
              <span className="text-xs font-bold text-slate-500">cumplimiento</span>
            </div>
            {/* Barra de progreso */}
            <div className="w-full bg-slate-100 h-2 rounded-full mt-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-emerald-500 to-teal-600 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, metricas.porcentaje_recaudo))}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. BARRA DE FILTROS (COBRADOR, ESTADO, BÚSQUEDA)                         */}
      {/* ========================================================================= */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3.5">
        <div className="flex flex-wrap items-center gap-3">
          
          {/* Selector de Cobrador */}
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              value={selectedCobrador}
              onChange={(e) => setSelectedCobrador(e.target.value)}
              className="text-xs font-medium bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            >
              <option value="">Todos los Cobradores</option>
              {cobradores.map((cob) => (
                <option key={cob.id} value={cob.id}>
                  {cob.nombre}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro de Estado de Cuota */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200/60">
            <button
              onClick={() => setStatusFilter('todos')}
              className={cn(
                'text-xs font-bold px-3 py-1.5 rounded-lg transition-all',
                statusFilter === 'todos'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              Todas
            </button>
            <button
              onClick={() => setStatusFilter('pendientes')}
              className={cn(
                'text-xs font-bold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1',
                statusFilter === 'pendientes'
                  ? 'bg-white text-amber-700 shadow-xs'
                  : 'text-slate-600 hover:text-amber-700'
              )}
            >
              <span>⏳ Pendientes</span>
            </button>
            <button
              onClick={() => setStatusFilter('pagadas')}
              className={cn(
                'text-xs font-bold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1',
                statusFilter === 'pagadas'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-slate-600 hover:text-emerald-700'
              )}
            >
              <span>✔ Pagadas</span>
            </button>
          </div>

          {/* Buscador de Cliente o Contrato */}
          <div className="relative min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar cliente o contrato..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="text-xs w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Botón de Refrescar */}
        <div className="flex items-center gap-2 self-end lg:self-auto">
          <button
            onClick={fetchCalendar}
            disabled={isLoading}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-3 py-2 rounded-xl transition-all shadow-xs disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
            <span>Actualizar</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. REJILLA DEL CALENDARIO MENSUAL                                         */}
      {/* ========================================================================= */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden relative">
        
        {/* ENCABEZADO DE DÍAS DE LA SEMANA */}
        <div className="grid grid-cols-7 bg-slate-900 text-white text-center text-xs font-black py-3 uppercase tracking-wider border-b border-slate-800">
          {DIAS_SEMANA.map((dia) => (
            <div key={dia} className="py-0.5">
              {dia}
            </div>
          ))}
        </div>

        {/* MATRIZ DE CELDAS DE DÍAS */}
        {isLoading && !calendarData ? (
          <div className="py-32 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
            <p className="text-sm font-bold text-slate-700">Calculando proyección y vencimientos...</p>
            <p className="text-xs text-slate-400">Consultando cartera de {MESES_NOMBRES[currentMonth - 1]}</p>
          </div>
        ) : (
          <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y divide-slate-100 bg-slate-100">
            {calendarGrid.map((cell, idx) => {
              if (!cell.isCurrentMonth) {
                return (
                  <div
                    key={`pad-${idx}`}
                    className="bg-slate-50/70 p-2 sm:p-2.5 min-h-[105px] sm:min-h-[125px] opacity-40 select-none cursor-not-allowed"
                  >
                    <span className="text-xs font-semibold text-slate-400">
                      {cell.dayNumber}
                    </span>
                  </div>
                );
              }

              const { data, hasActivity, isToday, dayNumber, dateStr } = cell;
              const isSelected = selectedDayDate === dateStr;

              return (
                <div
                  key={`day-${dateStr}`}
                  onClick={() => hasActivity && setSelectedDayDate(dateStr)}
                  onMouseEnter={(e) => handleMouseEnter(e, data)}
                  onMouseLeave={handleMouseLeave}
                  className={cn(
                    'p-2 sm:p-2.5 min-h-[105px] sm:min-h-[125px] flex flex-col justify-between transition-all duration-150 relative group select-none',
                    hasActivity
                      ? 'bg-white hover:bg-blue-50/40 cursor-pointer shadow-xs hover:shadow-md hover:z-10'
                      : 'bg-white hover:bg-slate-50/80',
                    isToday && 'ring-2 ring-blue-600 ring-inset bg-blue-50/20',
                    isSelected && 'ring-2 ring-indigo-600 ring-inset bg-indigo-50/30'
                  )}
                >
                  {/* Fila Superior: Número del Día y Badges */}
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        'text-xs sm:text-sm font-black w-6 h-6 rounded-full flex items-center justify-center transition-colors',
                        isToday
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-800 group-hover:text-blue-700'
                      )}
                    >
                      {dayNumber}
                    </span>

                    {isToday && (
                      <span className="text-[10px] font-black text-blue-700 bg-blue-100/70 px-1.5 py-0.2 rounded tracking-tight">
                        Hoy
                      </span>
                    )}

                    {hasActivity && !isToday && (
                      <span className="text-[10px] font-bold text-slate-500 font-mono">
                        {data?.items.length} cobro{data?.items.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  {/* Cuerpo Central: Monto Total del Día y Marcadores de Estado */}
                  {hasActivity && data ? (
                    <div className="my-1.5 space-y-1.5">
                      {/* Monto Total Programado para el día */}
                      <div className="text-[11px] sm:text-xs font-black text-slate-900 leading-none truncate">
                        {formatCOP(data.total_programado)}
                      </div>

                      {/* Insignias de Estado: Pagadas con Chulo vs Pendientes */}
                      <div className="flex flex-wrap gap-1">
                        {data.cuotas_pagadas > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-extrabold text-emerald-800 bg-emerald-100/80 border border-emerald-300/60 px-1.5 py-0.5 rounded shadow-xs" title={`${data.cuotas_pagadas} cuotas recaudadas`}>
                            ✔ {data.cuotas_pagadas}
                          </span>
                        )}

                        {data.cuotas_pendientes > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-extrabold text-amber-800 bg-amber-100/80 border border-amber-300/60 px-1.5 py-0.5 rounded shadow-xs" title={`${data.cuotas_pendientes} cuotas pendientes`}>
                            ⏳ {data.cuotas_pendientes}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="my-auto py-1">
                      <span className="text-[10px] text-slate-300 italic">Sin cobros</span>
                    </div>
                  )}

                  {/* Fila Inferior: Ayuda visual interactiva si tiene cobros */}
                  {hasActivity && (
                    <div className="pt-1 border-t border-slate-100/80 flex items-center justify-between text-[9px] text-slate-400 group-hover:text-blue-600 font-medium transition-colors">
                      <span className="truncate">Ver detalle</span>
                      <span>→</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 5. TOOLTIP FLOTANTE / VENTANA INFORMATIVA EN HOVER                        */}
      {/* ========================================================================= */}
      {hoveredDay && tooltipPos && (
        <div
          className="fixed z-50 pointer-events-none transform -translate-x-1/2 -translate-y-full transition-all duration-75 animate-in fade-in zoom-in-95"
          style={{
            left: `${tooltipPos.x}px`,
            top: `${tooltipPos.y}px`,
          }}
        >
          <div className="w-80 sm:w-96 bg-slate-900/95 backdrop-blur-md text-white rounded-2xl shadow-2xl border border-slate-700/80 p-3.5 space-y-2.5">
            {/* Cabecera del Tooltip */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div>
                <p className="text-xs font-black text-white tracking-tight flex items-center gap-1.5">
                  <span>📅</span>
                  <span>{hoveredDay.fecha}</span>
                </p>
                <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                  {hoveredDay.items.length} {hoveredDay.items.length === 1 ? 'cuota programada' : 'cuotas programadas'}
                </p>
              </div>
              <div className="text-right">
                <span className="text-xs font-mono font-black text-emerald-400">
                  {formatCOP(hoveredDay.total_programado)}
                </span>
                <div className="flex items-center gap-1.5 text-[9px] text-slate-400 justify-end mt-0.5">
                  <span className="text-emerald-400 font-bold">✔ {hoveredDay.cuotas_pagadas}</span>
                  <span>•</span>
                  <span className="text-amber-400 font-bold">⏳ {hoveredDay.cuotas_pendientes}</span>
                </div>
              </div>
            </div>

            {/* Listado de Cobros para este Día (Máximo 4 en tooltip, con aviso si hay más) */}
            <div className="space-y-2 max-h-48 overflow-hidden">
              {hoveredDay.items.slice(0, 4).map((item, i) => (
                <div
                  key={`${item.id_contrato}-${i}`}
                  className="bg-slate-800/80 border border-slate-700/50 p-2 rounded-xl flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-white truncate">
                      {item.cliente_nombre}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono mt-0.5">
                      <span className="text-slate-300 font-bold">{item.codigo_contrato}</span>
                      <span>•</span>
                      <span className="text-blue-300 font-bold">{item.cuota_texto}</span>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-xs font-black text-slate-100 font-mono">
                      {formatCOP(item.valor_cuota)}
                    </p>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 text-[9px] font-black px-1.5 py-0.2 rounded uppercase tracking-wide mt-0.5',
                        item.pagada
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                          : 'bg-amber-950 text-amber-300 border border-amber-700/60'
                      )}
                    >
                      {item.pagada ? '✔ Pagada' : '⏳ Pendiente'}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {hoveredDay.items.length > 4 && (
              <p className="text-center text-[10px] text-slate-400 font-medium italic pt-1 border-t border-slate-800">
                +{hoveredDay.items.length - 4} cobros más • Haz clic para ver el desglose completo
              </p>
            )}

            {/* Flecha indicadora hacia abajo */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-6 border-transparent border-t-slate-900" />
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. MODAL / DRAWER DE AUDITORÍA DETALLADA DEL DÍA SELECCIONADO              */}
      {/* ========================================================================= */}
      {selectedDayData && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200/80 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            
            {/* Cabecera del Modal */}
            <div className="p-5 sm:p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
                  <CalendarDays className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                    Detalle de Cobros: {selectedDayData.fecha}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {selectedDayData.items.length} {selectedDayData.items.length === 1 ? 'cuota registrada' : 'cuotas registradas'} • {selectedDayData.cuotas_pagadas} pagadas • {selectedDayData.cuotas_pendientes} pendientes
                  </p>
                </div>
              </div>

              <button
                onClick={() => setSelectedDayDate(null)}
                className="w-9 h-9 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 flex items-center justify-center transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Resumen Financiero del Día */}
            <div className="p-5 sm:p-6 border-b border-slate-100 bg-white grid grid-cols-3 gap-3 text-center">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Total Jornada</span>
                <span className="text-base sm:text-lg font-black text-slate-900 font-mono">
                  {formatCOP(selectedDayData.total_programado)}
                </span>
              </div>
              <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200/60">
                <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">Recaudado (✔)</span>
                <span className="text-base sm:text-lg font-black text-emerald-700 font-mono">
                  {formatCOP(selectedDayData.total_recaudado)}
                </span>
              </div>
              <div className="bg-amber-50 p-3 rounded-xl border border-amber-200/60">
                <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block">Por Cobrar (⏳)</span>
                <span className="text-base sm:text-lg font-black text-amber-700 font-mono">
                  {formatCOP(selectedDayData.total_pendiente)}
                </span>
              </div>
            </div>

            {/* Listado Completo con Filtro de Tabla */}
            <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-3 divide-y divide-slate-100">
              {selectedDayData.items.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  No hay cobros que coincidan con los filtros para esta fecha.
                </div>
              ) : (
                selectedDayData.items.map((it, idx) => (
                  <div key={idx} className="pt-3 first:pt-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-slate-900">
                          {it.cliente_nombre}
                        </span>
                        {it.cliente_cedula && (
                          <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                            C.C. {it.cliente_cedula}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono">
                        <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200/60">
                          {it.codigo_contrato}
                        </span>
                        <span>•</span>
                        <span className="font-bold text-slate-700">{it.cuota_texto}</span>
                        <span>•</span>
                        <span>Cobrador: <strong className="text-slate-800 font-sans">{it.cobrador_nombre}</strong></span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 self-end sm:self-center">
                      <div className="text-right">
                        <p className="text-base font-black text-slate-900 font-mono">
                          {formatCOP(it.valor_cuota)}
                        </p>
                      </div>

                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 text-xs font-black px-2.5 py-1 rounded-lg uppercase tracking-wide border',
                          it.pagada
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                            : 'bg-amber-50 text-amber-800 border-amber-300'
                        )}
                      >
                        {it.pagada ? '✔ Pagada' : '⏳ Pendiente'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Pie del Modal */}
            <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50 flex items-center justify-end">
              <button
                onClick={() => setSelectedDayDate(null)}
                className="text-xs font-bold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 px-4 py-2 rounded-xl transition-all shadow-xs"
              >
                Cerrar Ventana
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
