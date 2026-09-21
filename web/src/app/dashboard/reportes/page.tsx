'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  FileSpreadsheet,
  FileText,
  Calendar,
  Filter,
  Search,
  Download,
  RefreshCw,
  CreditCard,
  Banknote,
  TrendingUp,
  User,
  Users,
  CheckCircle2,
  Clock,
  ChevronLeft,
  ChevronRight,
  Package,
  Layers,
  ArrowUpRight,
  X,
  Printer,
  MapPin,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatCOP, cn } from '@/lib/utils';

interface OperacionReporte {
  id_contrato: string;
  codigo_contrato: string;
  fecha: string;
  cliente_id: string;
  cliente_nombre: string;
  cliente_cedula: string;
  cliente_telefono: string;
  vendedor_id: string | null;
  vendedor_nombre: string;
  tipo_venta: 'credito' | 'contado';
  monto_total: number;
  cuota_inicial: number;
  monto_financiado: number;
  saldo_pendiente: number;
  numero_cuotas: number;
  valor_cuota: number;
  tipo_pago: string;
  estado: string;
  ciudad_venta?: string;
  numero_contrato?: string;
  articulos: {
    nombre: string;
    sku: string;
    cantidad: number;
    valor_unitario: number;
    subtotal: number;
  }[];
  articulos_resumen: string;
}

interface MetricasReporte {
  total_vendido: number;
  volumen_credito: number;
  volumen_contado: number;
  ticket_promedio: number;
  total_operaciones: number;
  operaciones_credito: number;
  operaciones_contado: number;
}

interface ClienteOption {
  id: string;
  nombres: string;
  cedula: string;
}

type PeriodoPreset = 'hoy' | 'semana' | 'mes' | 'personalizado' | 'todos';

export default function ReportesHistoricosPage() {
  // Datos
  const [operaciones, setOperaciones] = useState<OperacionReporte[]>([]);
  const [metricas, setMetricas] = useState<MetricasReporte>({
    total_vendido: 0,
    volumen_credito: 0,
    volumen_contado: 0,
    ticket_promedio: 0,
    total_operaciones: 0,
    operaciones_credito: 0,
    operaciones_contado: 0,
  });

  // Estados de Carga y Descarga
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);
  const [isExportingExcel, setIsExportingExcel] = useState<boolean>(false);

  // Filtros
  const [periodoPreset, setPeriodoPreset] = useState<PeriodoPreset>('mes');
  const [fechaInicio, setFechaInicio] = useState<string>('');
  const [fechaFin, setFechaFin] = useState<string>('');
  const [tipoVenta, setTipoVenta] = useState<'todos' | 'credito' | 'contado'>('todos');
  const [search, setSearch] = useState<string>('');
  const [ciudadesOperativas, setCiudadesOperativas] = useState<string[]>([]);
  const [ciudadFiltro, setCiudadFiltro] = useState<string>('todas');
  const [contratoFiltro, setContratoFiltro] = useState<string>('');

  // Filtro por Cliente Específico
  const [clienteSeleccionado, setClienteSeleccionado] = useState<ClienteOption | null>(null);
  const [catalogoClientes, setCatalogoClientes] = useState<ClienteOption[]>([]);
  const [mostrarDropdownClientes, setMostrarDropdownClientes] = useState<boolean>(false);
  const [busquedaClienteInput, setBusquedaClienteInput] = useState<string>('');

  // Paginación
  const [paginaActual, setPaginaActual] = useState<number>(1);
  const [itemsPorPagina, setItemsPorPagina] = useState<number>(10);

  // Inicializar fechas según el preset seleccionado
  const aplicarPresetFechas = (preset: PeriodoPreset) => {
    setPeriodoPreset(preset);
    const hoy = new Date();
    const hoyStr = hoy.toISOString().split('T')[0];

    if (preset === 'hoy') {
      setFechaInicio(hoyStr);
      setFechaFin(hoyStr);
    } else if (preset === 'semana') {
      const primerDiaSemana = new Date(hoy);
      const diaSem = hoy.getDay(); // 0 domingo, 1 lunes
      const diff = hoy.getDate() - diaSem + (diaSem === 0 ? -6 : 1);
      primerDiaSemana.setDate(diff);
      setFechaInicio(primerDiaSemana.toISOString().split('T')[0]);
      setFechaFin(hoyStr);
    } else if (preset === 'mes') {
      const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      setFechaInicio(primerDiaMes.toISOString().split('T')[0]);
      setFechaFin(hoyStr);
    } else if (preset === 'todos') {
      setFechaInicio('');
      setFechaFin('');
    }
  };

  useEffect(() => {
    aplicarPresetFechas('mes');
  }, []);

  // Cargar clientes para autocompletar el filtro por cliente
  useEffect(() => {
    const fetchClientes = async () => {
      try {
        const res = await api.get('/clientes');
        if (Array.isArray(res.data)) {
          setCatalogoClientes(
            res.data.map((c: any) => ({
              id: c.id,
              nombres: c.nombres,
              cedula: c.cedula,
            }))
          );
        }
      } catch {
        // Fallback silencioso
      }
    };
    fetchClientes();
  }, []);

  // Cargar catálogo de ciudades autorizadas
  useEffect(() => {
    const fetchCiudades = async () => {
      try {
        const res = await api.get('/config/ciudades');
        const data = res.data;
        const lista: string[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.ciudades_plano)
          ? data.ciudades_plano
          : Array.isArray(data?.ciudades)
          ? data.ciudades
          : data?.ciudades && typeof data.ciudades === 'object'
          ? (Object.values(data.ciudades).flat() as string[])
          : [];
        if (lista.length > 0) {
          setCiudadesOperativas(lista);
        }
      } catch (err) {
        console.warn('[Reportes] Error cargando catálogo de ciudades:', err);
      }
    };
    fetchCiudades();
  }, []);

  // Cargar reporte de ventas desde el backend
  const cargarReporte = async () => {
    setIsLoading(true);
    try {
      const params: Record<string, any> = {
        tipo_venta: tipoVenta,
      };

      if (fechaInicio) params.fecha_inicio = fechaInicio;
      if (fechaFin) params.fecha_fin = fechaFin;
      if (clienteSeleccionado) params.cliente_id = clienteSeleccionado.id;
      if (ciudadFiltro && ciudadFiltro !== 'todas') params.ciudad_venta = ciudadFiltro;
      if (contratoFiltro.trim()) params.numero_contrato = contratoFiltro.trim();
      if (search.trim()) params.search = search.trim();

      const res = await api.get('/reportes/ventas', { params });
      if (res.data) {
        setMetricas(res.data.metricas || {});
        setOperaciones(res.data.operaciones || []);
        setPaginaActual(1);
      }
    } catch {
      setOperaciones([]);
      setMetricas({
        total_vendido: 0,
        volumen_credito: 0,
        volumen_contado: 0,
        ticket_promedio: 0,
        total_operaciones: 0,
        operaciones_credito: 0,
        operaciones_contado: 0,
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    cargarReporte();
  }, [fechaInicio, fechaFin, tipoVenta, clienteSeleccionado, ciudadFiltro]);

  // Manejar búsqueda por Enter o botón
  const handleEjecutarBusqueda = (e: React.FormEvent) => {
    e.preventDefault();
    cargarReporte();
  };

  // =========================================================================
  // EXPORTACIÓN A EXCEL (CSV UTF-8 BOM COMPATIBLE EXCEL)
  // =========================================================================
  // EXPORTACIÓN A EXCEL AUDITORÍA FINANCIERA (NOMBRE CORPORATIVO LIMPIO)
  // =========================================================================
  const exportarAExcel = () => {
    if (operaciones.length === 0) {
      alert('No hay operaciones disponibles para exportar en este período.');
      return;
    }

    setIsExportingExcel(true);
    try {
      const headers = [
        'CONTRATO',
        'CIUDAD_VENTA',
        'FECHA_REGISTRO',
        'CLIENTE_TITULAR',
        'CEDULA',
        'TELEFONO',
        'MODALIDAD_VENTA',
        'NUM_CUOTAS',
        'VALOR_CUOTA',
        'MONTO_TOTAL',
        'CUOTA_INICIAL',
        'MONTO_FINANCIADO',
        'SALDO_PENDIENTE',
        'ASESOR_VENDEDOR',
        'ARTICULOS_DETALLE',
        'ESTADO_OPERATIVO',
      ];

      const filas = operaciones.map((op) => [
        `"${op.codigo_contrato}"`,
        `"${(op.ciudad_venta || 'Montería').replace(/"/g, '""')}"`,
        `"${op.fecha.replace('T', ' ').slice(0, 19)}"`,
        `"${op.cliente_nombre.replace(/"/g, '""')}"`,
        `"${op.cliente_cedula}"`,
        `"${op.cliente_telefono}"`,
        `"${op.tipo_venta.toUpperCase()}"`,
        op.numero_cuotas,
        op.valor_cuota,
        op.monto_total,
        op.cuota_inicial,
        op.monto_financiado,
        op.saldo_pendiente,
        `"${op.vendedor_nombre.replace(/"/g, '""')}"`,
        `"${op.articulos_resumen.replace(/"/g, '""')}"`,
        `"${op.estado.toUpperCase()}"`,
      ]);

      const csvContent =
        '\uFEFF' +
        headers.join(';') +
        '\n' +
        filas.map((f) => f.join(';')).join('\n');

      const blob = new Blob([csvContent], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'Auditoria_Financiera_Remundial.xlsx');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setIsExportingExcel(false);
    }
  };

  // =========================================================================
  // EXPORTACIÓN A PDF EJECUTIVO PRO (REPORTLAB BACKEND)
  // =========================================================================
  const exportarAPdfPro = async () => {
    setIsExportingPdf(true);
    try {
      const params: Record<string, any> = {
        tipo_venta: tipoVenta,
      };

      if (fechaInicio) params.fecha_inicio = fechaInicio;
      if (fechaFin) params.fecha_fin = fechaFin;
      if (clienteSeleccionado) params.cliente_id = clienteSeleccionado.id;
      if (ciudadFiltro && ciudadFiltro !== 'todas') params.ciudad_venta = ciudadFiltro;
      if (contratoFiltro.trim()) params.numero_contrato = contratoFiltro.trim();
      if (search.trim()) params.search = search.trim();

      const res = await api.get('/reportes/ventas/pdf', {
        params,
        responseType: 'blob',
      });

      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const anio = new Date().getFullYear();
      let filename = `Reporte_Ventas_Remundial_${anio}.pdf`;
      const disposition = res.headers?.['content-disposition'];
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename="?([^";]+)"?/);
        if (match && match[1]) {
          filename = match[1].trim();
        }
      }
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Ocurrió un error al generar el documento PDF en el servidor.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Paginación en cliente
  const totalPaginas = Math.ceil(operaciones.length / itemsPorPagina) || 1;
  const operacionesPaginadas = useMemo(() => {
    const inicio = (paginaActual - 1) * itemsPorPagina;
    return operaciones.slice(inicio, inicio + itemsPorPagina);
  }, [operaciones, paginaActual, itemsPorPagina]);

  // Clientes filtrados en el buscador de cliente
  const clientesFiltradosDropdown = catalogoClientes
    .filter(
      (c) =>
        c.nombres.toLowerCase().includes(busquedaClienteInput.toLowerCase()) ||
        c.cedula.includes(busquedaClienteInput)
    )
    .slice(0, 6);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* CABECERA PRINCIPAL Y ACCIONES DE EXPORTACIÓN */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Reportes e Históricos
            </h1>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
              AUDITORÍA PRO
            </span>
          </div>
          <p className="text-sm text-slate-600 mt-1">
            Auditoría integral de colocación a crédito, ventas de contado y exportación financiera.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => cargarReporte()}
            disabled={isLoading}
            className="p-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
            title="Actualizar datos"
          >
            <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
          </button>

          {/* Botón Exportar Excel */}
          <button
            onClick={exportarAExcel}
            disabled={isExportingExcel || operaciones.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold shadow-2xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>{isExportingExcel ? 'Generando Excel...' : 'Exportar Excel (.xlsx)'}</span>
          </button>

          {/* Botón Descargar PDF PRO */}
          <button
            onClick={exportarAPdfPro}
            disabled={isExportingPdf}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExportingPdf ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <FileText className="w-4 h-4 text-amber-400" />
            )}
            <span>{isExportingPdf ? 'Compilando PDF...' : 'Descargar Reporte PDF PRO'}</span>
          </button>
        </div>
      </div>

      {/* BARRA SUPERIOR DE FILTROS DINÁMICOS */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-4">
        
        {/* Fila 1: Presets de Fecha y Modalidad */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          
          {/* Presets de Período */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider mr-1 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              Período:
            </span>
            {(
              [
                { id: 'hoy', label: 'Hoy' },
                { id: 'semana', label: 'Esta Semana' },
                { id: 'mes', label: 'Este Mes' },
                { id: 'personalizado', label: 'Personalizado' },
                { id: 'todos', label: 'Todo el Histórico' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                onClick={() => aplicarPresetFechas(p.id)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer',
                  periodoPreset === p.id
                    ? 'bg-slate-900 text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Filtro por Tipo de Venta (Crédito vs Contado) */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl w-full sm:w-auto">
            {(
              [
                { id: 'todos', label: 'Todas las Ventas' },
                { id: 'credito', label: 'Solo Créditos' },
                { id: 'contado', label: 'Solo Contado' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setTipoVenta(t.id)}
                className={cn(
                  'px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer',
                  tipoVenta === t.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Fila 2: Inputs de Fecha + Ciudad + Cliente + Búsqueda Contrato */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 pt-3 border-t border-slate-100">
          
          {/* Fechas personalizadas */}
          <div className="lg:col-span-3 flex items-center gap-2">
            <div className="flex-1">
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                FECHA DESDE
              </label>
              <input
                type="date"
                value={fechaInicio}
                onChange={(e) => {
                  setFechaInicio(e.target.value);
                  setPeriodoPreset('personalizado');
                }}
                className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50 text-slate-800 focus:bg-white focus:ring-2 focus:ring-slate-900 transition-all"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                FECHA HASTA
              </label>
              <input
                type="date"
                value={fechaFin}
                onChange={(e) => {
                  setFechaFin(e.target.value);
                  setPeriodoPreset('personalizado');
                }}
                className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50 text-slate-800 focus:bg-white focus:ring-2 focus:ring-slate-900 transition-all"
              />
            </div>
          </div>

          {/* Filtro Geográfico de Ciudad de Venta */}
          <div className="lg:col-span-3">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-bold text-slate-600">
                CIUDAD DE VENTA
              </label>
              <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded font-semibold">
                LOCALIDAD
              </span>
            </div>
            <div className="relative">
              <MapPin className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                id="reportes-ciudad-filtro"
                value={ciudadFiltro}
                onChange={(e) => setCiudadFiltro(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs font-medium rounded-xl border border-slate-200 bg-slate-50/50 text-slate-800 focus:bg-white focus:ring-2 focus:ring-slate-900 transition-all cursor-pointer"
              >
                <option value="todas">Todas las Ciudades (Consolidado)</option>
                {ciudadesOperativas.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Filtro Específico por Cliente */}
          <div className="lg:col-span-3 relative">
            <label className="block text-[11px] font-bold text-slate-600 mb-1">
              HISTORIAL POR CLIENTE
            </label>
            {clienteSeleccionado ? (
              <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-semibold">
                <div className="flex items-center gap-2 truncate">
                  <User className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="truncate">
                    {clienteSeleccionado.nombres}
                  </span>
                </div>
                <button
                  onClick={() => setClienteSeleccionado(null)}
                  className="p-1 hover:bg-slate-800 rounded-md text-slate-300 hover:text-white transition-colors cursor-pointer"
                  title="Limpiar filtro de cliente"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar cliente..."
                  value={busquedaClienteInput}
                  onChange={(e) => {
                    setBusquedaClienteInput(e.target.value);
                    setMostrarDropdownClientes(true);
                  }}
                  onFocus={() => setMostrarDropdownClientes(true)}
                  className="w-full pl-8 pr-4 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50 text-slate-800 focus:bg-white focus:ring-2 focus:ring-slate-900 transition-all"
                />
                {mostrarDropdownClientes && clientesFiltradosDropdown.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-30 overflow-hidden divide-y divide-slate-100">
                    {clientesFiltradosDropdown.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setClienteSeleccionado(c);
                          setMostrarDropdownClientes(false);
                          setBusquedaClienteInput('');
                        }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center justify-between cursor-pointer"
                      >
                        <span className="font-semibold text-slate-900">{c.nombres}</span>
                        <span className="text-[11px] font-mono text-slate-500">CC: {c.cedula}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Búsqueda rápida por Cédula o Contrato */}
          <div className="lg:col-span-3">
            <label className="block text-[11px] font-bold text-slate-600 mb-1">
              BÚSQUEDA RÁPIDA / CONTRATO
            </label>
            <form onSubmit={handleEjecutarBusqueda} className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar por cédula o contrato..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-8 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50 text-slate-800 focus:bg-white focus:ring-2 focus:ring-slate-900 transition-all"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    cargarReporte();
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </form>
          </div>
        </div>
      </div>

      {/* TARJETAS DE MÉTRICAS EJECUTIVAS DEL PERÍODO */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Total Facturado */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Total Facturado
            </span>
            <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-2xs">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono">
            {formatCOP(metricas.total_vendido)}
          </p>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
            <span className="font-bold text-slate-800">{metricas.total_operaciones}</span>
            <span>ventas en el período</span>
          </div>
        </div>

        {/* Ventas a Crédito */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-700 uppercase tracking-wider">
              Colocación a Crédito
            </span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 border border-blue-200 flex items-center justify-center">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono">
            {formatCOP(metricas.volumen_credito)}
          </p>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
            <span className="font-bold text-blue-700">{metricas.operaciones_credito}</span>
            <span>contratos</span>
            <span className="text-slate-300">•</span>
            <span>
              {metricas.total_vendido > 0
                ? `${((metricas.volumen_credito / metricas.total_vendido) * 100).toFixed(1)}%`
                : '0%'}
            </span>
          </div>
        </div>

        {/* Ventas de Contado */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">
              Ventas de Contado
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center">
              <Banknote className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono">
            {formatCOP(metricas.volumen_contado)}
          </p>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
            <span className="font-bold text-emerald-700">{metricas.operaciones_contado}</span>
            <span>ventas</span>
            <span className="text-slate-300">•</span>
            <span>
              {metricas.total_vendido > 0
                ? `${((metricas.volumen_contado / metricas.total_vendido) * 100).toFixed(1)}%`
                : '0%'}
            </span>
          </div>
        </div>

        {/* Ticket Promedio */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-purple-700 uppercase tracking-wider">
              Ticket Promedio
            </span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-700 border border-purple-200 flex items-center justify-center">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono">
            {formatCOP(metricas.ticket_promedio)}
          </p>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
            <span>Promedio por factura / contrato</span>
          </div>
        </div>
      </div>

      {/* TABLA PAGINADA DE OPERACIONES */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        
        {/* Cabecera de la tabla */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900">
              Desglose de Operaciones Auditadas
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {operaciones.length} transacciones encontradas según los filtros aplicados
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Mostrar:</span>
            <select
              value={itemsPorPagina}
              onChange={(e) => {
                setItemsPorPagina(Number(e.target.value));
                setPaginaActual(1);
              }}
              className="px-2 py-1 rounded-lg border border-slate-200 text-xs font-semibold text-slate-800 bg-white"
            >
              <option value={10}>10 por pág.</option>
              <option value={25}>25 por pág.</option>
              <option value={50}>50 por pág.</option>
            </select>
          </div>
        </div>

        {/* Tabla */}
        <div className="overflow-x-auto min-h-[340px]">
          <table className="w-full text-left text-xs min-w-[1200px]">
            <thead className="bg-slate-50/75 border-b border-slate-100 text-slate-600 uppercase font-semibold">
              <tr>
                <th className="px-4 py-3.5 min-w-[105px]">Contrato</th>
                <th className="px-4 py-3.5 min-w-[95px]">Fecha</th>
                <th className="px-4 py-3.5 min-w-[160px]">Cliente Titular</th>
                <th className="px-4 py-3.5 min-w-[110px]">Modalidad</th>
                <th className="px-4 py-3.5 min-w-[125px]">Asesor</th>
                <th className="px-4 py-3.5 w-[220px] max-w-[220px]">Artículos Vendidos</th>
                <th className="pl-4 pr-6 py-3.5 min-w-[130px] text-right">Monto Total</th>
                <th className="pl-4 pr-6 py-3.5 min-w-[135px] text-right">Saldo</th>
                <th className="pl-5 pr-4 py-3.5 min-w-[160px] text-left border-l border-slate-200/80">Progreso</th>
                <th className="px-4 py-3.5 min-w-[95px] text-right">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="px-5 py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-slate-400" />
                    <p className="text-xs font-semibold">Consultando base de datos y métricas...</p>
                  </td>
                </tr>
              ) : operacionesPaginadas.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-5 py-12 text-center text-slate-500">
                    <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <h3 className="text-sm font-bold text-slate-800">
                      No se encontraron operaciones registradas
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                      No existen transacciones que coincidan con el rango de fechas o los filtros seleccionados.
                    </p>
                  </td>
                </tr>
              ) : (
                operacionesPaginadas.map((op) => {
                  const esContado = op.tipo_venta === 'contado';
                  return (
                    <tr key={op.id_contrato} className="hover:bg-slate-50/60 transition-colors">
                      
                      {/* Contrato */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="font-mono font-bold text-slate-900 block">
                          {op.codigo_contrato}
                        </span>
                        {op.ciudad_venta && (
                          <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-1 mt-0.5">
                            <MapPin className="w-2.5 h-2.5" /> {op.ciudad_venta}
                          </span>
                        )}
                      </td>

                      {/* Fecha */}
                      <td className="px-4 py-3.5 text-slate-600 whitespace-nowrap">
                        {new Date(op.fecha).toLocaleDateString('es-CO', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>

                      {/* Cliente */}
                      <td className="px-4 py-3.5">
                        <span className="font-semibold text-slate-900 block">
                          {op.cliente_nombre}
                        </span>
                        <span className="text-[11px] text-slate-500 font-mono">
                          CC: {op.cliente_cedula}
                        </span>
                      </td>

                      {/* Modalidad */}
                      <td className="px-4 py-3.5">
                        {esContado ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <Banknote className="w-3 h-3" />
                            Contado
                          </span>
                        ) : (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                              <CreditCard className="w-3 h-3" />
                              Crédito
                            </span>
                            <span className="text-[10px] text-slate-500 block font-medium">
                              {op.numero_cuotas} cuotas ({op.tipo_pago})
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Asesor */}
                      <td className="px-4 py-3.5 text-slate-800">
                        {op.vendedor_nombre}
                      </td>

                      {/* Artículos Vendidos con Truncamiento Inteligente y Tooltip Flotante */}
                      <td className="px-4 py-3.5 w-[220px] max-w-[220px] align-middle relative hover:z-50">
                        <div className="w-[200px] sm:w-[220px] max-w-[220px]">
                          <div className="relative group inline-block max-w-full">
                            {/* Texto truncado a una sola línea */}
                            <p
                              className="text-xs text-slate-800 font-medium truncate cursor-pointer hover:text-blue-600 transition-colors"
                              title={op.articulos_resumen}
                            >
                              {op.articulos_resumen}
                            </p>

                            {/* Tooltip flotante al hacer hover (despliegue hacia abajo con z-50) */}
                            <div className="absolute left-0 top-full mt-2 hidden group-hover:flex flex-col z-50 w-64 p-2.5 bg-slate-900 text-white rounded-xl shadow-2xl text-xs pointer-events-none transition-all duration-150 border border-slate-700/60">
                              <span className="font-bold text-[11px] text-slate-300 uppercase tracking-wider mb-1.5 border-b border-slate-800 pb-1 flex items-center justify-between">
                                <span>Detalle de Artículos</span>
                                <span className="text-emerald-400 font-mono">
                                  {op.articulos?.length || 1} ítem{(op.articulos?.length || 1) !== 1 ? 's' : ''}
                                </span>
                              </span>
                              {op.articulos && op.articulos.length > 0 ? (
                                <div className="space-y-1 max-h-36 overflow-y-auto">
                                  {op.articulos.map((art, idx) => (
                                    <div key={idx} className="flex justify-between items-start gap-2 text-[11px] leading-tight">
                                      <span className="text-slate-200 line-clamp-1 font-medium">
                                        • {art.nombre}
                                      </span>
                                      <span className="text-slate-400 shrink-0 font-mono">
                                        x{art.cantidad}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-[11px] text-slate-300 leading-tight">
                                  {op.articulos_resumen}
                                </p>
                              )}
                              {/* Flecha indicadora del tooltip apuntando hacia arriba */}
                              <div className="absolute bottom-full left-4 border-4 border-transparent border-b-slate-900" />
                            </div>
                          </div>

                          {/* Conteo de artículos */}
                          {op.articulos && op.articulos.length > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 font-mono font-medium mt-0.5">
                              <span>📦 {op.articulos.length} {op.articulos.length === 1 ? 'artículo' : 'artículos'}</span>
                              {op.articulos.length > 1 && (
                                <span className="text-blue-600 font-bold bg-blue-50 px-1 py-0.2 rounded border border-blue-200/60">
                                  +{op.articulos.length - 1} más
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400 block font-mono mt-0.5">
                              1 artículo
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Monto Total */}
                      <td className="pl-4 pr-6 py-3.5 font-mono font-bold text-slate-900 whitespace-nowrap text-right min-w-[130px]">
                        {formatCOP(op.monto_total)}
                      </td>

                      {/* Saldo Pendiente con Margen de Resguardo Derecho Adecuado */}
                      <td className="pl-4 pr-6 py-3.5 font-mono whitespace-nowrap text-right min-w-[135px]">
                        {op.saldo_pendiente > 0 ? (
                          <span className="text-amber-700 font-bold">
                            {formatCOP(op.saldo_pendiente)}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-normal">$ 0</span>
                        )}
                      </td>

                      {/* Progreso del Crédito */}
                      <td className="pl-5 pr-4 py-3.5 whitespace-nowrap border-l border-slate-200/80 min-w-[160px]">
                        {esContado ? (
                          <div className="w-28">
                            <div className="flex justify-between text-[10px] font-semibold text-emerald-700 mb-1">
                              <span>100% Pagado</span>
                              <span>100%</span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-emerald-100 overflow-hidden">
                              <div className="h-full rounded-full bg-emerald-600 w-full" />
                            </div>
                          </div>
                        ) : (
                          (() => {
                            const valorCuota = Number(op.valor_cuota || 0);
                            const numeroCuotas = Number(op.numero_cuotas || 1);
                            const montoFinanciado = Number(op.monto_financiado || 0);
                            const saldoPendiente = Number(op.saldo_pendiente || 0);
                            const montoTotal = Number(op.monto_total || 0);

                            let cuotasPagas = 0;
                            if (valorCuota > 0) {
                              const amortizado = Math.max(0, montoFinanciado - saldoPendiente);
                              cuotasPagas = Math.min(numeroCuotas, Math.round(amortizado / valorCuota));
                            }
                            const porcentajePago =
                              montoTotal > 0
                                ? Math.min(100, Math.max(0, Math.round(((montoTotal - saldoPendiente) / montoTotal) * 100)))
                                : 0;

                            return (
                              <div className="w-28">
                                <div className="flex justify-between text-[10px] font-semibold text-slate-600 mb-1">
                                  <span>
                                    {cuotasPagas}/{numeroCuotas}
                                  </span>
                                  <span className="font-bold">{porcentajePago}%</span>
                                </div>
                                <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                                  <div
                                    className={cn(
                                      'h-full rounded-full',
                                      op.estado === 'mora' ? 'bg-rose-500' : 'bg-slate-900'
                                    )}
                                    style={{ width: `${porcentajePago}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })()
                        )}
                      </td>

                      {/* Estado */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border',
                            op.estado === 'activo' && 'bg-blue-50 text-blue-700 border-blue-200',
                            op.estado === 'terminado' && 'bg-emerald-50 text-emerald-700 border-emerald-200',
                            op.estado === 'pendiente' && 'bg-amber-50 text-amber-700 border-amber-200',
                            op.estado === 'mora' && 'bg-rose-50 text-rose-700 border-rose-200'
                          )}
                        >
                          {op.estado}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        {operaciones.length > 0 && (
          <div className="p-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <div>
              Mostrando{' '}
              <span className="font-semibold text-slate-900">
                {(paginaActual - 1) * itemsPorPagina + 1}
              </span>{' '}
              a{' '}
              <span className="font-semibold text-slate-900">
                {Math.min(paginaActual * itemsPorPagina, operaciones.length)}
              </span>{' '}
              de <span className="font-semibold text-slate-900">{operaciones.length}</span>{' '}
              operaciones
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setPaginaActual((prev) => Math.max(prev - 1, 1))}
                disabled={paginaActual === 1}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                title="Página anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2.5 font-bold text-slate-900">
                {paginaActual} / {totalPaginas}
              </span>
              <button
                onClick={() => setPaginaActual((prev) => Math.min(prev + 1, totalPaginas))}
                disabled={paginaActual === totalPaginas}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                title="Página siguiente"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
