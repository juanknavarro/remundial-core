'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  XCircle,
  Clock,
  User,
  MapPin,
  Phone,
  DollarSign,
  Package,
  Calendar,
  ShieldCheck,
  Check,
  X,
  AlertCircle,
  RefreshCw,
  ChevronRight,
  UserCheck,
  Users,
  Download,
  Printer,
  FileSpreadsheet,
  FileText,
  Search,
  Filter,
  CreditCard,
  Banknote,
  TrendingUp,
} from 'lucide-react';
import { formatCOP, cn } from '@/lib/utils';
import { api } from '@/lib/api';

interface Articulo {
  nombre: string;
  cantidad: number;
  precio: number;
}

interface CreditoPendiente {
  id: string;
  contrato: string;
  clienteNombre: string;
  cedula: string;
  telefono: string;
  direccion: string;
  barrio: string;
  vendedorNombre: string;
  valorTotal: number;
  saldoPendiente: number;
  valorCuota: number;
  totalCuotas: number;
  tipoCredito: string;
  fechaSolicitud: string;
  articulos: Articulo[];
  estado: 'pendiente' | 'aprobado' | 'rechazado';
  codeudor?: {
    nombre: string;
    cedula?: string | null;
    telefono?: string | null;
    direccion?: string | null;
  } | null;
  referencia?: {
    nombre: string;
    telefono?: string | null;
    parentesco?: string | null;
    direccion?: string | null;
  } | null;
}

interface CuotaItem {
  numero: number;
  fecha_vencimiento: string;
  valor_cuota: number;
  valor_base?: number;
  valor_exigible?: number;
  valor_pagado?: number;
  saldo_cuota?: number;
  monto_arrastrado?: number;
  pagada: boolean;
  es_parcial?: boolean;
  estado: string;
}

interface CreditoReporteItem {
  id_contrato: string;
  codigo_contrato: string;
  numero_contrato?: string | null;
  ciudad_venta?: string | null;
  fecha_inicio: string | null;
  cliente_nombre: string;
  cliente_cedula: string;
  cliente_telefono: string;
  cobrador_id: string | null;
  cobrador_nombre: string;
  monto_financiado: number;
  saldo_pendiente: number;
  valor_cuota: number;
  numero_cuotas: number;
  tipo_pago: string;
  estado: string;
  cuotas_pagadas_count: number;
  cuotas_pendientes_count: number;
  cronograma: CuotaItem[];
}

interface MetricasCartera {
  total_cartera: number;
  saldo_total_pendiente: number;
  total_recaudado: number;
  total_creditos: number;
  cuotas_totales: number;
  cuotas_pagadas: number;
  cuotas_pendientes: number;
}

interface CobradorOption {
  id: string;
  nombre: string;
}

type PeriodoPreset = 'hoy' | 'semana' | 'mes' | 'todos' | 'personalizado';

export default function SupervisorDashboardPage() {
  // Pestaña activa: 'aprobaciones' | 'reporte_cartera'
  const [activeTab, setActiveTab] = useState<'aprobaciones' | 'reporte_cartera'>('aprobaciones');

  // Estados de Aprobaciones
  const [creditosPendientes, setCreditosPendientes] = useState<CreditoPendiente[]>([]);
  const [isLoadingPendientes, setIsLoadingPendientes] = useState<boolean>(true);
  const [mensajeConfirmacion, setMensajeConfirmacion] = useState<string | null>(null);
  const [isProcessingId, setIsProcessingId] = useState<string | null>(null);
  const [processingAction, setProcessingAction] = useState<'aprobar' | 'rechazar' | null>(null);

  // Estados de Reporte de Cartera & Plan de Cuotas (PDF)
  const [cobradores, setCobradores] = useState<CobradorOption[]>([]);
  const [cobradorFiltro, setCobradorFiltro] = useState<string>('');
  const [ciudadesOperativas, setCiudadesOperativas] = useState<string[]>([]);
  const [ciudadFiltro, setCiudadFiltro] = useState<string>('todas');
  const [periodoFiltro, setPeriodoFiltro] = useState<PeriodoPreset>('mes');
  const [fechaInicioFiltro, setFechaInicioFiltro] = useState<string>('');
  const [fechaFinFiltro, setFechaFinFiltro] = useState<string>('');
  const [searchCartera, setSearchCartera] = useState<string>('');
  const [carteraReporte, setCarteraReporte] = useState<CreditoReporteItem[]>([]);
  const [metricasCartera, setMetricasCartera] = useState<MetricasCartera>({
    total_cartera: 0,
    saldo_total_pendiente: 0,
    total_recaudado: 0,
    total_creditos: 0,
    cuotas_totales: 0,
    cuotas_pagadas: 0,
    cuotas_pendientes: 0,
  });
  const [isLoadingCartera, setIsLoadingCartera] = useState<boolean>(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<boolean>(false);

  // Cargar créditos pendientes para aprobación
  const cargarCreditosPendientes = useCallback(async () => {
    setIsLoadingPendientes(true);
    try {
      const res = await api.get('/creditos?estado=pendiente');
      if (Array.isArray(res.data)) {
        const mapeados: CreditoPendiente[] = res.data.map((c: any) => ({
          id: c.id_contrato,
          contrato: `CTR-${c.id_contrato.slice(0, 8).toUpperCase()}`,
          clienteNombre: c.cliente?.nombres || 'Cliente Titular',
          cedula: c.cliente?.cedula || 'S/N',
          telefono: c.cliente?.telefono || 'No registrado',
          direccion: c.cliente?.direccion || 'No registrada',
          barrio: c.cliente?.barrio || 'Sector no especificado',
          vendedorNombre: c.vendedor?.nombre || 'Juan Vendedor',
          valorTotal: Number(c.monto_financiado || 0) + Number(c.cuota_inicial || 0),
          saldoPendiente: Number(c.saldo_pendiente || 0),
          valorCuota: Number(c.valor_cuota || 0),
          totalCuotas: Number(c.numero_cuotas || 0),
          tipoCredito: (c.tipo_pago || 'DIARIO').toUpperCase(),
          fechaSolicitud: c.creado_en
            ? new Date(c.creado_en).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })
            : 'Reciente',
          articulos: Array.isArray(c.detalles)
            ? c.detalles.map((d: any) => ({
                nombre: d.producto?.nombre || 'Artículo de catálogo',
                cantidad: d.cantidad,
                precio: Number(d.valor_unitario_acordado || 0),
              }))
            : [],
          estado: c.estado || 'pendiente',
          codeudor: c.codeudor || c.cliente?.codeudor || null,
          referencia: c.referencia || c.cliente?.referencia_familiar || null,
        }));
        setCreditosPendientes(mapeados);
      }
    } catch {
      setCreditosPendientes([]);
    } finally {
      setIsLoadingPendientes(false);
    }
  }, []);

  // Cargar cobradores para filtro de reporte
  const cargarCobradores = useCallback(async () => {
    try {
      const res = await api.get('/usuarios?rol=cobrador');
      if (Array.isArray(res.data)) {
        setCobradores(res.data.map((u: any) => ({ id: u.id, nombre: u.nombre })));
      }
    } catch (e) {
      console.warn('Error cargando cobradores:', e);
    }
  }, []);

  // Cargar ciudades operativas
  const cargarCiudades = useCallback(async () => {
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
    } catch (e) {
      console.warn('Error cargando ciudades en supervisor:', e);
    }
  }, []);

  // Cargar datos de cartera y cronograma de cuotas con chulos
  const cargarDatosCartera = useCallback(async () => {
    setIsLoadingCartera(true);
    try {
      const params = new URLSearchParams();
      if (cobradorFiltro) params.append('cobrador_id', cobradorFiltro);
      if (ciudadFiltro && ciudadFiltro !== 'todas') params.append('ciudad_venta', ciudadFiltro);
      if (periodoFiltro) params.append('periodo_preset', periodoFiltro);
      if (fechaInicioFiltro) params.append('fecha_inicio', fechaInicioFiltro);
      if (fechaFinFiltro) params.append('fecha_fin', fechaFinFiltro);
      if (searchCartera.trim()) params.append('search', searchCartera.trim());

      const res = await api.get(`/reportes/cartera?${params.toString()}`);
      if (res?.data) {
        setCarteraReporte(res.data.creditos || []);
        if (res.data.metricas) {
          setMetricasCartera(res.data.metricas);
        }
      }
    } catch (e) {
      console.error('Error cargando reporte de cartera:', e);
    } finally {
      setIsLoadingCartera(false);
    }
  }, [cobradorFiltro, ciudadFiltro, periodoFiltro, fechaInicioFiltro, fechaFinFiltro, searchCartera]);

  useEffect(() => {
    cargarCreditosPendientes();
    cargarCobradores();
    cargarCiudades();
  }, [cargarCreditosPendientes, cargarCobradores, cargarCiudades]);

  useEffect(() => {
    if (activeTab === 'reporte_cartera') {
      cargarDatosCartera();
    }
  }, [activeTab, cargarDatosCartera]);

  // Manejar preset de fechas
  const handlePresetPeriodo = (preset: PeriodoPreset) => {
    setPeriodoFiltro(preset);
    const hoy = new Date();
    const hoyStr = hoy.toISOString().split('T')[0];

    if (preset === 'hoy') {
      setFechaInicioFiltro(hoyStr);
      setFechaFinFiltro(hoyStr);
    } else if (preset === 'semana') {
      const primerDiaSemana = new Date(hoy);
      primerDiaSemana.setDate(hoy.getDate() - hoy.getDay() + 1);
      setFechaInicioFiltro(primerDiaSemana.toISOString().split('T')[0]);
      setFechaFinFiltro(hoyStr);
    } else if (preset === 'mes') {
      const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      setFechaInicioFiltro(primerDiaMes.toISOString().split('T')[0]);
      setFechaFinFiltro(hoyStr);
    } else if (preset === 'todos') {
      setFechaInicioFiltro('');
      setFechaFinFiltro('');
    }
  };

  // Descargar Reporte PDF con ReportLab
  const handleDescargarPdf = async () => {
    setIsDownloadingPdf(true);
    try {
      const params = new URLSearchParams();
      if (cobradorFiltro) params.append('cobrador_id', cobradorFiltro);
      if (ciudadFiltro && ciudadFiltro !== 'todas') params.append('ciudad_venta', ciudadFiltro);
      if (periodoFiltro) params.append('periodo_preset', periodoFiltro);
      if (fechaInicioFiltro) params.append('fecha_inicio', fechaInicioFiltro);
      if (fechaFinFiltro) params.append('fecha_fin', fechaFinFiltro);
      if (searchCartera.trim()) params.append('search', searchCartera.trim());

      const res = await api.get(`/reportes/cartera/pdf?${params.toString()}`, {
        responseType: 'blob',
      });

      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Reporte_Cartera_Cuotas_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Error descargando PDF de cartera:', err);
      alert('Error al generar el reporte PDF con ReportLab.');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleAprobar = async (id: string, contrato: string, cliente: string) => {
    setIsProcessingId(id);
    setProcessingAction('aprobar');
    try {
      try {
        await api.post(`/creditos/${id}/aprobar`);
      } catch {
        await api.patch(`/creditos/${id}`, { estado: 'activo' });
      }
      setCreditosPendientes((prev) => prev.filter((c) => c.id !== id));
      setMensajeConfirmacion(
        `¡Contrato ${contrato} de ${cliente} aprobado con éxito! El crédito ya está activo en Cartera.`
      );
    } catch (error: any) {
      console.error('Error aprobando crédito:', error);
      const detail = error?.response?.data?.detail || 'Ocurrió un error al intentar aprobar el crédito.';
      alert(`No se pudo aprobar el crédito: ${detail}`);
    } finally {
      setIsProcessingId(null);
      setProcessingAction(null);
    }
  };

  const handleRechazar = async (id: string, contrato: string, cliente: string) => {
    if (!confirm(`¿Está seguro de que desea rechazar el contrato ${contrato} de ${cliente}?`)) {
      return;
    }
    setIsProcessingId(id);
    setProcessingAction('rechazar');
    try {
      try {
        await api.post(`/creditos/${id}/rechazar`);
      } catch {
        await api.patch(`/creditos/${id}`, { estado: 'terminado' });
      }
      setCreditosPendientes((prev) => prev.filter((c) => c.id !== id));
      setMensajeConfirmacion(`Contrato ${contrato} de ${cliente} rechazado formalmente.`);
    } catch (error: any) {
      console.error('Error rechazando crédito:', error);
      const detail = error?.response?.data?.detail || 'Ocurrió un error al intentar rechazar el crédito.';
      alert(`No se pudo rechazar el crédito: ${detail}`);
    } finally {
      setIsProcessingId(null);
      setProcessingAction(null);
    }
  };

  const pendientesCount = creditosPendientes.filter((c) => c.estado === 'pendiente').length;

  return (
    <div className="space-y-8">
      {/* CABECERA PRINCIPAL */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
            <span>Módulo de Supervisión</span>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-slate-800">Auditoría & Cartera</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Supervisión General de Cartera
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Aprobación de contratos en terreno y generación de reportes ejecutivos en PDF con marcas de verificación de cuotas.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {activeTab === 'aprobaciones' ? (
            <button
              onClick={() => cargarCreditosPendientes()}
              className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
              title="Sincronizar solicitudes"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', isLoadingPendientes && 'animate-spin text-emerald-600')} />
              <span>Sincronizar</span>
            </button>
          ) : (
            <button
              onClick={() => cargarDatosCartera()}
              className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
              title="Refrescar reporte"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', isLoadingCartera && 'animate-spin text-emerald-600')} />
              <span>Refrescar</span>
            </button>
          )}

          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-amber-50 text-amber-800 border border-amber-200/60 text-xs font-semibold">
            <Clock className="w-3.5 h-3.5" />
            <span>{pendientesCount} por aprobar</span>
          </div>
        </div>
      </div>

      {/* PESTAÑAS DE SUPERVISIÓN */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('aprobaciones')}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-all cursor-pointer',
            activeTab === 'aprobaciones'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          )}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Aprobación de Créditos ({pendientesCount})</span>
        </button>

        <button
          onClick={() => setActiveTab('reporte_cartera')}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-all cursor-pointer',
            activeTab === 'reporte_cartera'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          )}
        >
          <FileText className="w-4 h-4" />
          <span>Reporte de Cartera & Plan de Cuotas (PDF)</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* VISTA 1: APROBACIONES DE CRÉDITOS                                         */}
      {/* ========================================================================= */}
      {activeTab === 'aprobaciones' && (
        <div className="space-y-6">
          {mensajeConfirmacion && (
            <div className="p-4 rounded-xl bg-slate-900 text-white text-xs font-medium flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg border border-slate-800 animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <p className="font-semibold text-white">{mensajeConfirmacion}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    El crédito ha sido activado formalmente en el sistema y ya forma parte de la cartera vigente.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 self-end sm:self-center">
                <Link
                  href="/dashboard/creditos"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 hover:text-white border border-emerald-500/40 text-xs font-semibold transition-colors"
                >
                  <span>Ver en Cartera</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Link>
                <button
                  onClick={() => setMensajeConfirmacion(null)}
                  className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer rounded-lg hover:bg-slate-800"
                  title="Cerrar notificación"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {creditosPendientes.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-slate-200/80 shadow-xs max-w-lg mx-auto">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Bandeja de Auditoría al Día</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">
                No hay solicitudes de crédito pendientes de aprobación. Los contratos originados en terreno por los vendedores aparecerán aquí para su revisión.
              </p>
            </div>
          ) : (
            creditosPendientes.map((c) => {
              const isPendiente = c.estado === 'pendiente';
              const isAprobado = c.estado === 'aprobado';
              const isRechazado = c.estado === 'rechazado';

              return (
                <div
                  key={c.id}
                  className={cn(
                    'bg-white rounded-2xl p-6 border shadow-xs transition-all',
                    isAprobado
                      ? 'border-emerald-200 bg-emerald-50/20'
                      : isRechazado
                      ? 'border-rose-200 bg-rose-50/20'
                      : 'border-slate-200/80 hover:shadow-md'
                  )}
                >
                  {/* Cabecera Tarjeta */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 mb-5">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-base text-slate-900">
                        {c.contrato}
                      </span>
                      <span className="text-xs text-slate-600 font-medium">
                        Solicitado: {c.fechaSolicitud}
                      </span>
                    </div>

                    <div>
                      {isPendiente && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200/60">
                          <Clock className="w-3 h-3" />
                          Por Revisar
                        </span>
                      )}
                      {isAprobado && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                          <CheckCircle2 className="w-3 h-3" />
                          Aprobado
                        </span>
                      )}
                      {isRechazado && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200/60">
                          <XCircle className="w-3 h-3" />
                          Rechazado
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Cuerpo: Cliente, Asesor y Plan */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                    <div className="space-y-1.5">
                      <span className="text-[10px] uppercase font-bold text-slate-500 block">Cliente Titular</span>
                      <p className="font-bold text-slate-900 text-sm">{c.clienteNombre}</p>
                      <p className="text-xs text-slate-600 font-mono">CC: {c.cedula}</p>
                      <p className="text-xs text-slate-600 flex items-center gap-1 mt-1">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        {c.telefono}
                      </p>
                      <p className="text-xs text-slate-600 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        {c.direccion} - {c.barrio}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <span className="text-[10px] uppercase font-bold text-slate-500 block">Asesor Comercial</span>
                      <p className="font-bold text-slate-900 text-sm">{c.vendedorNombre}</p>
                      <div className="pt-2">
                        <span className="text-[10px] uppercase font-bold text-slate-500 block">Plan Financiero</span>
                        <p className="text-xs font-semibold text-slate-800">
                          {c.totalCuotas} cuotas • {c.tipoCredito}
                        </p>
                        <p className="text-xs font-mono font-bold text-emerald-700">
                          {formatCOP(c.valorCuota)} / cuota
                        </p>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-500 block">Monto Total de Venta</span>
                        <p className="text-2xl font-black font-mono text-slate-900 mt-1">
                          {formatCOP(c.valorTotal)}
                        </p>
                      </div>
                      <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-200 flex justify-between">
                        <span>Saldo Financiado:</span>
                        <span className="font-bold text-slate-800 font-mono">{formatCOP(c.saldoPendiente)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Artículos Asociados */}
                  {c.articulos.length > 0 && (
                    <div className="mb-6 p-3 rounded-xl bg-slate-50/75 border border-slate-100">
                      <span className="text-[10px] uppercase font-bold text-slate-500 block mb-2">
                        Artículos del Contrato ({c.articulos.length})
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {c.articulos.map((art, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs text-slate-700 font-medium"
                          >
                            <Package className="w-3 h-3 text-slate-400" />
                            {art.cantidad}x {art.nombre} ({formatCOP(art.precio)})
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Acciones de Auditoría */}
                  {isPendiente && (
                    <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                      <button
                        onClick={() => handleRechazar(c.id, c.contrato, c.clienteNombre)}
                        disabled={isProcessingId === c.id}
                        className="px-4 py-2 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {isProcessingId === c.id && processingAction === 'rechazar' ? 'Rechazando...' : 'Rechazar'}
                      </button>

                      <button
                        onClick={() => handleAprobar(c.id, c.contrato, c.clienteNombre)}
                        disabled={isProcessingId === c.id}
                        className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Check className="w-4 h-4" />
                        <span>{isProcessingId === c.id && processingAction === 'aprobar' ? 'Aprobando...' : 'Aprobar y Despachar'}</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* VISTA 2: REPORTE DE CARTERA & PLAN DE CUOTAS CON MARCA DE VERIFICACIÓN    */}
      {/* ========================================================================= */}
      {activeTab === 'reporte_cartera' && (
        <div className="space-y-6">
          {/* PANEL DE FILTROS SUPERVISOR */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Filtros de Auditoría de Cartera & Plan de Cuotas
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Filtra por cobrador y rango temporal para generar el documento oficial en PDF con marcas de verificación.
                </p>
              </div>

              {/* Botón Principal: Generar PDF ReportLab */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDescargarPdf}
                  disabled={isDownloadingPdf || carteraReporte.length === 0}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download className={cn('w-4 h-4', isDownloadingPdf && 'animate-bounce')} />
                  <span>{isDownloadingPdf ? 'Generando PDF...' : 'Descargar Reporte PDF Oficial (ReportLab)'}</span>
                </button>
              </div>
            </div>

            {/* Controles de Filtro */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-2">
              {/* Selector de Cobrador */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                  Cobrador de Ruta
                </label>
                <select
                  value={cobradorFiltro}
                  onChange={(e) => setCobradorFiltro(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 border border-slate-200 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-slate-900 text-slate-900"
                >
                  <option value="">Todos los Cobradores ({cobradores.length})</option>
                  {cobradores.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>

              {/* Selector de Ciudad */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-emerald-600" />
                  Ciudad / Municipio
                </label>
                <select
                  value={ciudadFiltro}
                  onChange={(e) => setCiudadFiltro(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 border border-slate-200 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-slate-900 text-slate-900"
                >
                  <option value="todas">Todas las Ciudades</option>
                  {ciudadesOperativas.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Selector de Presets de Periodo */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                  Rango de Fechas
                </label>
                <div className="flex items-center gap-1">
                  {(['hoy', 'semana', 'mes', 'todos'] as PeriodoPreset[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handlePresetPeriodo(p)}
                      className={cn(
                        'flex-1 py-2 rounded-xl text-[11px] font-bold capitalize transition-colors cursor-pointer',
                        periodoFiltro === p
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      )}
                    >
                      {p === 'hoy' ? 'Día' : p === 'semana' ? 'Semana' : p === 'mes' ? 'Mes' : 'Todos'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Rango de Fechas Específico */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                  Desde - Hasta
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={fechaInicioFiltro}
                    onChange={(e) => {
                      setPeriodoFiltro('personalizado');
                      setFechaInicioFiltro(e.target.value);
                    }}
                    className="w-1/2 px-2.5 py-1.5 rounded-xl text-xs bg-slate-50 border border-slate-200 text-slate-900"
                  />
                  <input
                    type="date"
                    value={fechaFinFiltro}
                    onChange={(e) => {
                      setPeriodoFiltro('personalizado');
                      setFechaFinFiltro(e.target.value);
                    }}
                    className="w-1/2 px-2.5 py-1.5 rounded-xl text-xs bg-slate-50 border border-slate-200 text-slate-900"
                  />
                </div>
              </div>

              {/* Buscador de Texto */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                  Buscar por Cliente o Contrato
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchCartera}
                    onChange={(e) => setSearchCartera(e.target.value)}
                    placeholder="Nombre, cédula o CTR..."
                    className="w-full pl-8 pr-3 py-2 rounded-xl text-xs bg-slate-50 border border-slate-200 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-slate-900 text-slate-900"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* TARJETAS KPI DE CARTERA */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Cartera Financiada</span>
              <p className="text-2xl font-black font-mono text-slate-900 mt-1">
                {formatCOP(metricasCartera.total_cartera)}
              </p>
              <span className="text-xs text-slate-500 mt-1 block">
                {metricasCartera.total_creditos} contratos auditados
              </span>
            </div>

            <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Recaudado / Amortizado</span>
              <p className="text-2xl font-black font-mono text-emerald-700 mt-1">
                {formatCOP(metricasCartera.total_recaudado)}
              </p>
              <span className="text-xs text-emerald-600 mt-1 block font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {metricasCartera.cuotas_pagadas} cuotas recaudadas
              </span>
            </div>

            <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Saldo Total por Cobrar</span>
              <p className="text-2xl font-black font-mono text-rose-700 mt-1">
                {formatCOP(metricasCartera.saldo_total_pendiente)}
              </p>
              <span className="text-xs text-slate-500 mt-1 block">
                {metricasCartera.cuotas_pendientes} cuotas por vencer
              </span>
            </div>

            <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Cumplimiento con Verificación</span>
              <p className="text-2xl font-black font-mono text-blue-700 mt-1">
                {metricasCartera.cuotas_totales > 0
                  ? `${Math.round((metricasCartera.cuotas_pagadas / metricasCartera.cuotas_totales) * 100)}%`
                  : '0%'}
              </p>
              <span className="text-xs text-slate-500 mt-1 block">
                {metricasCartera.cuotas_pagadas} de {metricasCartera.cuotas_totales} cuotas con chulo
              </span>
            </div>
          </div>

          {/* TABLA DETALLADA DE CONTRATOS CON PLAN DE CUOTAS Y MARCA DE VERIFICACIÓN */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Desglose de Cartera con Marcas de Verificación ({carteraReporte.length} contratos)
                </h3>
                <p className="text-xs text-slate-500">
                  Visualización directa del plan de pagos: cuotas con chulo verde (recaudadas) vs cuotas pendientes de recaudo.
                </p>
              </div>

              <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                ✓ Chulo = Cuota Pagada
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/75 border-b border-slate-100 text-slate-500 uppercase font-semibold">
                  <tr>
                    <th className="px-6 py-3.5">Contrato & Fecha</th>
                    <th className="px-6 py-3.5">Cliente Titular</th>
                    <th className="px-6 py-3.5">Cobrador / Ruta</th>
                    <th className="px-6 py-3.5 text-right">Financiado</th>
                    <th className="px-6 py-3.5 text-right">Saldo Pend.</th>
                    <th className="px-6 py-3.5">Plan de Cuotas (Marca de Verificación)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {carteraReporte.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                        {isLoadingCartera
                          ? 'Cargando datos de cartera...'
                          : 'No se encontraron contratos para los filtros seleccionados.'}
                      </td>
                    </tr>
                  ) : (
                    carteraReporte.map((c) => (
                      <tr key={c.id_contrato} className="hover:bg-slate-50/60 transition-colors">
                        {/* Contrato & Fecha */}
                        <td className="px-6 py-4">
                          <span className="font-mono font-bold text-slate-900 block">
                            {c.codigo_contrato}
                          </span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] text-slate-500 font-mono">
                              {c.fecha_inicio ? c.fecha_inicio.slice(0, 10) : ''}
                            </span>
                            {c.ciudad_venta && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-700 font-medium bg-emerald-50 px-1.5 py-0.5 rounded-sm">
                                <MapPin className="w-2.5 h-2.5" />
                                {c.ciudad_venta}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Cliente */}
                        <td className="px-6 py-4">
                          <span className="font-bold text-slate-900 block text-xs">
                            {c.cliente_nombre}
                          </span>
                          <span className="text-[11px] text-slate-500 font-mono">
                            CC: {c.cliente_cedula || 'S/N'} • Tel: {c.cliente_telefono || 'S/N'}
                          </span>
                        </td>

                        {/* Cobrador / Ruta */}
                        <td className="px-6 py-4">
                          <span className="font-bold text-slate-800 block text-xs">
                            {c.cobrador_nombre}
                          </span>
                          <span className="text-[10px] text-slate-500 capitalize">
                            {c.tipo_pago}
                          </span>
                        </td>

                        {/* Financiado */}
                        <td className="px-6 py-4 text-right font-mono font-bold text-slate-900">
                          {formatCOP(c.monto_financiado)}
                        </td>

                        {/* Saldo Pendiente */}
                        <td className="px-6 py-4 text-right font-mono font-bold">
                          {c.saldo_pendiente > 0 ? (
                            <span className="text-rose-700">{formatCOP(c.saldo_pendiente)}</span>
                          ) : (
                            <span className="text-emerald-700">$0 (Saldado)</span>
                          )}
                        </td>

                        {/* Plan de Cuotas con Marcas de Verificación */}
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1.5 max-w-md">
                            {c.cronograma && c.cronograma.length > 0 ? (
                              c.cronograma.map((cuota) => {
                                const isPagada = cuota.pagada || cuota.estado === 'pagada';
                                const isParcial = cuota.es_parcial || cuota.estado === 'parcial';
                                const hasArrastre = !isPagada && (cuota.monto_arrastrado ?? 0) > 0;

                                let badgeClass = 'bg-slate-50 text-slate-600 border-slate-200';
                                if (isPagada) {
                                  badgeClass = 'bg-emerald-50 text-emerald-800 border-emerald-300';
                                } else if (isParcial) {
                                  badgeClass = 'bg-amber-50 text-amber-800 border-amber-300';
                                } else if (hasArrastre) {
                                  badgeClass = 'bg-rose-50 text-rose-800 border-rose-300';
                                }

                                return (
                                  <span
                                    key={cuota.numero}
                                    className={cn(
                                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors',
                                      badgeClass
                                    )}
                                    title={
                                      isParcial
                                        ? `Cuota ${cuota.numero} (Abono Parcial): Pagado ${formatCOP(cuota.valor_pagado || 0)} - Faltan ${formatCOP(cuota.saldo_cuota || 0)}`
                                        : hasArrastre
                                        ? `Cuota ${cuota.numero}: Exigible ${formatCOP(cuota.valor_exigible || cuota.valor_cuota)} (+${formatCOP(cuota.monto_arrastrado || 0)} arrastrado) - Vence ${cuota.fecha_vencimiento}`
                                        : `Cuota ${cuota.numero}: ${formatCOP(cuota.valor_cuota)} - Vence ${cuota.fecha_vencimiento}`
                                    }
                                  >
                                    {isPagada ? (
                                      <>
                                        <Check className="w-3 h-3 text-emerald-600 stroke-3" />
                                        <span>C{cuota.numero} Pagada</span>
                                      </>
                                    ) : isParcial ? (
                                      <>
                                        <Clock className="w-2.5 h-2.5 text-amber-600" />
                                        <span>C{cuota.numero} Parcial ({formatCOP(cuota.valor_pagado || 0)})</span>
                                      </>
                                    ) : hasArrastre ? (
                                      <>
                                        <AlertCircle className="w-2.5 h-2.5 text-rose-600" />
                                        <span>C{cuota.numero} ({formatCOP(cuota.valor_exigible || cuota.valor_cuota)})</span>
                                      </>
                                    ) : (
                                      <>
                                        <Clock className="w-2.5 h-2.5 text-slate-400" />
                                        <span>C{cuota.numero} ({cuota.fecha_vencimiento.slice(5)})</span>
                                      </>
                                    )}
                                  </span>
                                );
                              })
                            ) : (
                              <span className="text-slate-400 italic text-[11px]">Sin cronograma</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
