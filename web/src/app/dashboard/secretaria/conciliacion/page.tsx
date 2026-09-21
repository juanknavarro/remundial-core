'use client';

import React, { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Wallet,
  CheckCircle2,
  AlertTriangle,
  Printer,
  Calendar,
  MapPin,
  Clock,
  User,
  Search,
  Check,
  ChevronRight,
  ShieldCheck,
  DollarSign,
  Receipt,
  BadgeAlert,
  RefreshCw,
  History,
  CreditCard,
  Banknote,
  Smartphone,
  Tag,
  CheckCircle,
  Sparkles,
} from 'lucide-react';
import { formatCOP, cn } from '@/lib/utils';
import { api } from '@/lib/api';

interface Cobrador {
  id: string;
  nombre: string;
  telefono: string;
  zona: string;
  estado_activo: boolean;
}

interface AbonoItem {
  id_recibo: string;
  cobrador_id: string;
  credito_id: string;
  cliente_nombre: string;
  cliente_cedula?: string;
  valor_abonado: number;
  fecha: string;
  fecha_completa?: string;
  coordenadas_gps?: { latitud: number; longitud: number };
  estado: 'registrado' | 'conciliado' | 'anulado';
  cierre_caja_id?: string;
  metodo_pago: string;
  saldo_restante_credito?: number;
  numero_contrato?: string;
}

interface CierreHistorial {
  id: string;
  cobrador_id: string;
  cobrador_nombre: string;
  responsable_id: string;
  responsable_nombre: string;
  fecha_cierre: string;
  total_esperado: number;
  efectivo_entregado: number;
  diferencia: number;
  cuadre_estado: string;
  abonos_conciliados_count: number;
  notas?: string;
}

type FiltroPill = 'todos' | 'pendientes' | 'conciliados' | 'efectivo' | 'transferencia' | 'saldados';

function ConciliacionRutasContent() {
  const searchParams = useSearchParams();
  const urlCobradorId = searchParams.get('cobradorId');

  // Estados principales de datos
  const [cobradores, setCobradores] = useState<Cobrador[]>([]);
  const [cobradorSeleccionado, setCobradorSeleccionado] = useState<Cobrador | null>(null);
  const [abonos, setAbonos] = useState<AbonoItem[]>([]);
  const [cierresHistoricos, setCierresHistoricos] = useState<CierreHistorial[]>([]);
  const [activeTab, setActiveTab] = useState<'arqueo' | 'historial'>('arqueo');

  // Filtros y UI
  const [busqueda, setBusqueda] = useState('');
  const [filtroPill, setFiltroPill] = useState<FiltroPill>('todos');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Arqueo de caja física
  const [efectivoEntregadoInput, setEfectivoEntregadoInput] = useState<string>('');
  const [notasCierre, setNotasCierre] = useState<string>('');

  // Modales
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showComprobanteModal, setShowComprobanteModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ultimoCierre, setUltimoCierre] = useState<{
    id?: string;
    cobrador: string;
    responsable: string;
    totalEsperado: number;
    efectivoEntregado: number;
    diferencia: number;
    cuadreEstado: string;
    cantidadAbonos: number;
    totalEfectivo: number;
    totalTransferencias: number;
    saldadosCount: number;
    parcialesCount: number;
    fechaHora: string;
    reciboIds: string[];
    notas?: string;
  } | null>(null);

  // Cargar datos reales desde FastAPI
  const cargarDatos = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const [resUsers, resAbonos, resCierres] = await Promise.all([
        api.get('/usuarios?rol=cobrador'),
        api.get('/abonos'),
        api.get('/abonos/cierres-caja'),
      ]);

      let cobradoresCargados: Cobrador[] = [];
      if (Array.isArray(resUsers.data)) {
        cobradoresCargados = resUsers.data.map((u: any, idx: number) => ({
          id: u.id,
          nombre: u.nombre,
          telefono: u.telefono || 'Sin teléfono',
          zona: `Ruta ${idx + 1}: Sector Operativo`,
          estado_activo: u.estado_activo,
        }));
        setCobradores(cobradoresCargados);
      }

      if (Array.isArray(resAbonos.data)) {
        const mappedAbonos: AbonoItem[] = resAbonos.data.map((a: any) => ({
          id_recibo: a.id_recibo,
          cobrador_id: a.cobrador_id,
          credito_id: a.credito_id,
          cliente_nombre: a.cliente_nombre || 'Cliente Registrado',
          cliente_cedula: a.cliente_cedula || '',
          valor_abonado: Number(a.valor_abonado || 0),
          fecha: new Date(a.fecha).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          fecha_completa: new Date(a.fecha).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
          coordenadas_gps: a.coordenadas_gps_cobro,
          estado: a.estado,
          cierre_caja_id: a.cierre_caja_id,
          metodo_pago: (a.metodo_pago || 'efectivo').toLowerCase().trim(),
          saldo_restante_credito:
            a.saldo_restante_credito !== undefined && a.saldo_restante_credito !== null
              ? Number(a.saldo_restante_credito)
              : undefined,
          numero_contrato: a.numero_contrato,
        }));
        setAbonos(mappedAbonos);
      }

      if (Array.isArray(resCierres.data)) {
        const mappedCierres: CierreHistorial[] = resCierres.data.map((c: any) => ({
          id: c.id,
          cobrador_id: c.cobrador_id,
          cobrador_nombre: c.cobrador_nombre,
          responsable_id: c.responsable_id,
          responsable_nombre: c.responsable_nombre,
          fecha_cierre: new Date(c.fecha_cierre).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
          total_esperado: Number(c.total_esperado || 0),
          efectivo_entregado: Number(c.efectivo_entregado || 0),
          diferencia: Number(c.diferencia || 0),
          cuadre_estado: c.cuadre_estado,
          abonos_conciliados_count: c.abonos_conciliados_count,
          notas: c.notas,
        }));
        setCierresHistoricos(mappedCierres);
      }

      // Determinar cobrador seleccionado
      if (cobradoresCargados.length > 0) {
        if (urlCobradorId) {
          const match = cobradoresCargados.find((c) => c.id === urlCobradorId);
          if (match) {
            setCobradorSeleccionado(match);
          } else {
            setCobradorSeleccionado(cobradoresCargados[0]);
          }
        } else {
          setCobradorSeleccionado((prev) => prev || cobradoresCargados[0]);
        }
      }
    } catch (err: any) {
      console.error('Error cargando conciliación:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [urlCobradorId]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  // Abonos de la ruta seleccionada
  const todosAbonosCobrador = useMemo(() => {
    if (!cobradorSeleccionado) return [];
    return abonos.filter((a) => a.cobrador_id === cobradorSeleccionado.id);
  }, [abonos, cobradorSeleccionado]);

  // Recaudos clasificados
  const abonosPendientes = useMemo(() => {
    return todosAbonosCobrador.filter((a) => a.estado === 'registrado');
  }, [todosAbonosCobrador]);

  const abonosConciliados = useMemo(() => {
    return todosAbonosCobrador.filter((a) => a.estado === 'conciliado');
  }, [todosAbonosCobrador]);

  // Clasificación por Método de Pago en Pendientes
  const pendientesEfectivo = useMemo(() => {
    return abonosPendientes.filter((a) => a.metodo_pago === 'efectivo');
  }, [abonosPendientes]);

  const pendientesTransferencias = useMemo(() => {
    return abonosPendientes.filter((a) => a.metodo_pago !== 'efectivo');
  }, [abonosPendientes]);

  // Clasificación por Impacto en Cartera (Parciales vs Saldados)
  const pendientesParciales = useMemo(() => {
    return abonosPendientes.filter((a) => (a.saldo_restante_credito ?? 1) > 0);
  }, [abonosPendientes]);

  const pendientesSaldados = useMemo(() => {
    return abonosPendientes.filter(
      (a) => a.saldo_restante_credito !== undefined && a.saldo_restante_credito <= 0
    );
  }, [abonosPendientes]);

  // Cálculos Financieros del Arqueo
  const totalEsperadoGeneral = useMemo(() => {
    return abonosPendientes.reduce((acc, a) => acc + a.valor_abonado, 0);
  }, [abonosPendientes]);

  const totalEsperadoEfectivo = useMemo(() => {
    return pendientesEfectivo.reduce((acc, a) => acc + a.valor_abonado, 0);
  }, [pendientesEfectivo]);

  const totalEsperadoTransferencias = useMemo(() => {
    return pendientesTransferencias.reduce((acc, a) => acc + a.valor_abonado, 0);
  }, [pendientesTransferencias]);

  // Sincronizar input de efectivo físico sugerido
  useEffect(() => {
    setEfectivoEntregadoInput(totalEsperadoGeneral.toString());
  }, [totalEsperadoGeneral, cobradorSeleccionado]);

  const efectivoEntregadoNum = parseFloat(efectivoEntregadoInput) || 0;
  const diferencia = efectivoEntregadoNum - totalEsperadoGeneral;

  const estadoCuadre = useMemo(() => {
    if (diferencia === 0) return 'cuadrado';
    if (diferencia < 0) return 'faltante';
    return 'sobrante';
  }, [diferencia]);

  const todosConciliados = todosAbonosCobrador.length > 0 && abonosPendientes.length === 0;

  // Filtrado reactivo de la tabla
  const abonosFiltrados = useMemo(() => {
    return todosAbonosCobrador.filter((a) => {
      // Filtro por píldoras
      if (filtroPill === 'pendientes' && a.estado !== 'registrado') return false;
      if (filtroPill === 'conciliados' && a.estado !== 'conciliado') return false;
      if (filtroPill === 'efectivo' && a.metodo_pago !== 'efectivo') return false;
      if (filtroPill === 'transferencia' && a.metodo_pago === 'efectivo') return false;
      if (filtroPill === 'saldados' && !(a.saldo_restante_credito !== undefined && a.saldo_restante_credito <= 0)) {
        return false;
      }

      // Filtro por texto de búsqueda
      if (busqueda.trim() === '') return true;
      const term = busqueda.toLowerCase();
      return (
        a.cliente_nombre.toLowerCase().includes(term) ||
        (a.cliente_cedula && a.cliente_cedula.toLowerCase().includes(term)) ||
        a.id_recibo.toLowerCase().includes(term) ||
        a.credito_id.toLowerCase().includes(term) ||
        (a.numero_contrato && a.numero_contrato.toLowerCase().includes(term))
      );
    });
  }, [todosAbonosCobrador, filtroPill, busqueda]);

  // Abrir Modal de Confirmación
  const handleAbrirConfirmacion = () => {
    setShowConfirmModal(true);
  };

  // Ejecutar Conciliación y Cierre de Caja en FastAPI
  const handleEjecutarConciliacion = async () => {
    if (!cobradorSeleccionado) return;
    setIsProcessing(true);
    const ahora = new Date().toLocaleString();

    try {
      const res = await api.post('/abonos/conciliar-ruta', {
        cobrador_id: cobradorSeleccionado.id,
        efectivo_entregado: efectivoEntregadoNum,
        notas: notasCierre,
      });

      const data = res.data;

      setUltimoCierre({
        id: data?.id,
        cobrador: data?.cobrador_nombre || cobradorSeleccionado.nombre,
        responsable: data?.responsable_nombre || 'Secretaría',
        totalEsperado: Number(data?.total_esperado ?? totalEsperadoGeneral),
        efectivoEntregado: Number(data?.efectivo_entregado ?? efectivoEntregadoNum),
        diferencia: Number(data?.diferencia ?? diferencia),
        cuadreEstado: data?.cuadre_estado || estadoCuadre,
        cantidadAbonos: data?.abonos_conciliados_count ?? abonosPendientes.length,
        totalEfectivo: totalEsperadoEfectivo,
        totalTransferencias: totalEsperadoTransferencias,
        saldadosCount: pendientesSaldados.length,
        parcialesCount: pendientesParciales.length,
        fechaHora: ahora,
        reciboIds: abonosPendientes.map((a) => a.id_recibo),
        notas: notasCierre,
      });

      setShowConfirmModal(false);
      setShowComprobanteModal(true);

      // Refrescar datos reales desde FastAPI
      await cargarDatos();
    } catch (err: any) {
      console.error('Error al conciliar ruta:', err);
      alert('Error al registrar conciliación: ' + (err.response?.data?.detail || err.message));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImprimir = () => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  return (
    <div className="space-y-8">
      {/* CABECERA PRINCIPAL */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
            <Link href="/dashboard/secretaria" className="hover:text-slate-800 transition-colors">
              Módulo de Secretaría
            </Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-slate-800">Conciliación & Cierre de Caja</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Arqueo & Conciliación de Rutas en Terreno
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Auditoría de recaudos diarios (Pendientes de Arqueo), recepción física y conciliación contable sin alterar el ciclo de cuotas futuras.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={cargarDatos}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
            title="Refrescar recaudos"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin text-emerald-600')} />
            <span>Refrescar</span>
          </button>

          <div className="p-3 rounded-2xl bg-white border border-slate-200/80 shadow-xs flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Jornada Contable</span>
              <span className="text-xs font-bold text-slate-900">
                {new Date().toLocaleDateString('es-CO', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* PESTAÑAS: ARQUEO DE CAJA vs HISTORIAL DE AUDITORÍA */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('arqueo')}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-all cursor-pointer',
            activeTab === 'arqueo'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          )}
        >
          <Wallet className="w-4 h-4" />
          <span>Mesa de Arqueo & Cierre de Caja</span>
        </button>

        <button
          onClick={() => setActiveTab('historial')}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-all cursor-pointer',
            activeTab === 'historial'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          )}
        >
          <History className="w-4 h-4" />
          <span>Historial de Cierres de Caja ({cierresHistoricos.length})</span>
        </button>
      </div>

      {activeTab === 'arqueo' ? (
        <>
          {/* SELECTOR DE RUTA / COBRADOR */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Seleccionar Cobrador en Base ({cobradores.length})
                </label>
                <span className="text-xs text-slate-500">
                  {cobradores.filter((c) => abonos.some((a) => a.cobrador_id === c.id && a.estado === 'registrado')).length}{' '}
                  rutas con recaudos por arquear
                </span>
              </div>

              {cobradores.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500">
                  No hay cobradores registrados o activos en el sistema.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {cobradores.map((c) => {
                    const isSelected = cobradorSeleccionado?.id === c.id;
                    const abonosDelCobrador = abonos.filter((a) => a.cobrador_id === c.id);
                    const pendientes = abonosDelCobrador.filter((a) => a.estado === 'registrado').length;

                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setCobradorSeleccionado(c)}
                        className={cn(
                          'p-4 rounded-xl border text-left transition-all cursor-pointer flex items-start justify-between gap-3',
                          isSelected
                            ? 'border-slate-900 bg-slate-900 text-white shadow-sm ring-2 ring-slate-900/10'
                            : 'border-slate-200 bg-slate-50 hover:bg-white hover:border-slate-300 text-slate-800'
                        )}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <User className={cn('w-4 h-4', isSelected ? 'text-emerald-400' : 'text-slate-500')} />
                            <span className="font-bold text-sm leading-none">{c.nombre}</span>
                          </div>
                          <p className={cn('text-xs line-clamp-1', isSelected ? 'text-slate-300' : 'text-slate-600')}>
                            {c.zona}
                          </p>
                          <div className="flex items-center gap-2 pt-1 text-[11px] font-mono">
                            <span className={isSelected ? 'text-slate-400' : 'text-slate-500'}>
                              Tel: {c.telefono}
                            </span>
                            <span>•</span>
                            <span
                              className={cn(
                                'font-semibold',
                                isSelected
                                  ? pendientes > 0
                                    ? 'text-amber-300'
                                    : 'text-emerald-300'
                                  : pendientes > 0
                                  ? 'text-amber-600'
                                  : 'text-slate-600'
                              )}
                            >
                              {pendientes > 0 ? `${pendientes} por arquear` : 'Al día'}
                            </span>
                          </div>
                        </div>

                        {isSelected && (
                          <span className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 mt-0.5">
                            <Check className="w-3 h-3 stroke-3" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {cobradorSeleccionado && (
            <>
              {/* NOTA OPERATIVA DE INDEPENDENCIA DEL CICLO DE CRÉDITO */}
              <div className="bg-slate-900 text-white rounded-2xl p-4 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                        Cierre de Caja Operativo Diario
                      </span>
                      <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700">
                        Independiente del Ciclo de Crédito
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-0.5">
                      Este módulo audita y recibe estrictamente los movimientos financieros de hoy. El proceso cierra los abonos tanto para créditos con cuotas pendientes como para créditos saldados.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-mono bg-slate-800 px-3 py-1 rounded-xl text-slate-200 border border-slate-700">
                    {abonosPendientes.length} Pendiente(s) de Arqueo
                  </span>
                </div>
              </div>

              {/* COMPARATIVA: EFECTIVO ESPERADO (SISTEMA) VS EFECTIVO ENTREGADO EN CAJA */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Tarjeta 1: Total Esperado en Sistema con Desglose */}
                <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                        Total Esperado en Sistema
                      </span>
                      <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                        <Receipt className="w-4 h-4" />
                      </div>
                    </div>

                    <p className="text-3xl font-black font-mono text-slate-900 mt-2">
                      {formatCOP(totalEsperadoGeneral)}
                    </p>

                    {/* Desglose Efectivo vs Transferencia */}
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                        <span className="text-[10px] uppercase font-bold text-slate-500 block flex items-center gap-1">
                          <Banknote className="w-3 h-3 text-emerald-600" />
                          Efectivo Físico
                        </span>
                        <span className="font-mono font-bold text-slate-800 block text-xs">
                          {formatCOP(totalEsperadoEfectivo)}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {pendientesEfectivo.length} recibos
                        </span>
                      </div>

                      <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                        <span className="text-[10px] uppercase font-bold text-slate-500 block flex items-center gap-1">
                          <Smartphone className="w-3 h-3 text-blue-600" />
                          Transferencias
                        </span>
                        <span className="font-mono font-bold text-slate-800 block text-xs">
                          {formatCOP(totalEsperadoTransferencias)}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {pendientesTransferencias.length} recibos
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                    <span>Impacto en cartera:</span>
                    <span className="font-semibold text-slate-800 font-mono">
                      {pendientesParciales.length} parciales • {pendientesSaldados.length} saldados
                    </span>
                  </div>
                </div>

                {/* Tarjeta 2: Efectivo Entregado Físicamente en Caja */}
                <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                        Efectivo Entregado en Caja
                      </span>
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                        <DollarSign className="w-4 h-4" />
                      </div>
                    </div>

                    <div className="mt-2 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">$</span>
                      <input
                        type="number"
                        disabled={todosAbonosCobrador.length === 0}
                        value={efectivoEntregadoInput}
                        onChange={(e) => setEfectivoEntregadoInput(e.target.value)}
                        placeholder="0"
                        className="w-full pl-8 pr-4 py-2.5 rounded-xl border border-slate-300 text-2xl font-black font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
                      />
                    </div>

                    {/* Botones de ayuda rápida */}
                    <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setEfectivoEntregadoInput(totalEsperadoGeneral.toString())}
                        className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-semibold text-slate-700 transition-colors cursor-pointer"
                      >
                        Auto-llenar Total ({formatCOP(totalEsperadoGeneral)})
                      </button>
                      {totalEsperadoTransferencias > 0 && (
                        <button
                          type="button"
                          onClick={() => setEfectivoEntregadoInput(totalEsperadoEfectivo.toString())}
                          className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-[11px] font-semibold text-blue-700 transition-colors cursor-pointer"
                          title="Fijar solo el valor en efectivo físico"
                        >
                          Solo Efectivo ({formatCOP(totalEsperadoEfectivo)})
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 mt-3 pt-2 border-t border-slate-100">
                    Billetes y monedas recibidos y auditados físicamente de manos del cobrador.
                  </p>
                </div>

                {/* Tarjeta 3: Diferencia / Estado del Cuadre */}
                <div
                  className={cn(
                    'rounded-2xl p-6 border shadow-xs flex flex-col justify-between transition-all',
                    estadoCuadre === 'cuadrado' && 'bg-emerald-50/60 border-emerald-200',
                    estadoCuadre === 'faltante' && 'bg-amber-50/60 border-amber-300',
                    estadoCuadre === 'sobrante' && 'bg-blue-50/60 border-blue-200'
                  )}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          'text-xs font-bold uppercase tracking-wider',
                          estadoCuadre === 'cuadrado' && 'text-emerald-800',
                          estadoCuadre === 'faltante' && 'text-amber-800',
                          estadoCuadre === 'sobrante' && 'text-blue-800'
                        )}
                      >
                        Resultado del Cuadre
                      </span>

                      {estadoCuadre === 'cuadrado' && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
                      {estadoCuadre === 'faltante' && <AlertTriangle className="w-5 h-5 text-amber-600" />}
                      {estadoCuadre === 'sobrante' && <BadgeAlert className="w-5 h-5 text-blue-600" />}
                    </div>

                    <div className="mt-2">
                      <span
                        className={cn(
                          'text-3xl font-black font-mono block',
                          estadoCuadre === 'cuadrado' && 'text-emerald-900',
                          estadoCuadre === 'faltante' && 'text-amber-900',
                          estadoCuadre === 'sobrante' && 'text-blue-900'
                        )}
                      >
                        {diferencia === 0
                          ? '$0 COP'
                          : diferencia > 0
                          ? `+${formatCOP(diferencia)}`
                          : `-${formatCOP(Math.abs(diferencia))}`}
                      </span>

                      <span
                        className={cn(
                          'inline-flex items-center gap-1 mt-1 text-xs font-bold px-2 py-0.5 rounded-full',
                          estadoCuadre === 'cuadrado' && 'bg-emerald-100 text-emerald-800',
                          estadoCuadre === 'faltante' && 'bg-amber-100 text-amber-900',
                          estadoCuadre === 'sobrante' && 'bg-blue-100 text-blue-900'
                        )}
                      >
                        {estadoCuadre === 'cuadrado' && 'Caja Cuadrada (Exacta)'}
                        {estadoCuadre === 'faltante' && 'Faltante de Efectivo'}
                        {estadoCuadre === 'sobrante' && 'Sobrante en Caja'}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-200/50 flex items-center justify-between text-xs">
                    <span className="text-slate-600">Estado de Ruta:</span>
                    {todosConciliados ? (
                      <span className="font-bold text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Caja Cerrada & Conciliada
                      </span>
                    ) : todosAbonosCobrador.length === 0 ? (
                      <span className="font-semibold text-slate-500">Sin movimientos registrados</span>
                    ) : (
                      <span className="font-bold text-amber-700 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {abonosPendientes.length} recaudos por arquear
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* BARRA DE ACCIÓN PRINCIPAL DE CONCILIACIÓN */}
              <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Cierre Formal de Ruta: {cobradorSeleccionado.nombre}
                    </h3>
                    <p className="text-xs text-slate-600">
                      Al conciliar, todos los recibos pasan a estado <span className="font-semibold text-emerald-700">Conciliado en Caja</span> y se emite el acta auditable oficial.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  {abonosPendientes.length === 0 && todosAbonosCobrador.length > 0 ? (
                    <button
                      onClick={() => {
                        const cierreCobrador = cierresHistoricos.find((c) => c.cobrador_id === cobradorSeleccionado.id);
                        if (cierreCobrador) {
                          setUltimoCierre({
                            id: cierreCobrador.id,
                            cobrador: cierreCobrador.cobrador_nombre,
                            responsable: cierreCobrador.responsable_nombre,
                            totalEsperado: cierreCobrador.total_esperado,
                            efectivoEntregado: cierreCobrador.efectivo_entregado,
                            diferencia: cierreCobrador.diferencia,
                            cuadreEstado: cierreCobrador.cuadre_estado,
                            cantidadAbonos: cierreCobrador.abonos_conciliados_count,
                            totalEfectivo: totalEsperadoEfectivo,
                            totalTransferencias: totalEsperadoTransferencias,
                            saldadosCount: pendientesSaldados.length,
                            parcialesCount: pendientesParciales.length,
                            fechaHora: cierreCobrador.fecha_cierre,
                            reciboIds: [],
                            notas: cierreCobrador.notas,
                          });
                        }
                        setShowComprobanteModal(true);
                      }}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-slate-300 text-slate-800 text-xs font-bold hover:bg-slate-50 transition-all cursor-pointer"
                    >
                      <Printer className="w-4 h-4" />
                      <span>Ver / Reimprimir Acta de Cierre</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleAbrirConfirmacion}
                      disabled={abonosPendientes.length === 0}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white text-xs font-bold shadow-xs transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Check className="w-4 h-4" />
                      <span>[ Conciliar y Cerrar Caja ({abonosPendientes.length}) ]</span>
                    </button>
                  )}
                </div>
              </div>

              {/* LISTADO DETALLADO DE ABONOS EN TERRENO */}
              <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
                {/* Cabecera de la Tabla y Filtros */}
                <div className="px-6 py-4 border-b border-slate-100 flex flex-col gap-3">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">
                        Movimientos Financieros de la Ruta ({todosAbonosCobrador.length})
                      </h2>
                      <p className="text-xs text-slate-500">
                        Recaudos sincronizados en la jornada actual para auditoría independiente del crédito.
                      </p>
                    </div>

                    <div className="relative w-full md:w-72">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Buscar cliente, cédula, recibo #, contrato..."
                        value={busqueda}
                        onChange={(e) => setBusqueda(e.target.value)}
                        className="w-full pl-9 pr-3 py-1.5 rounded-xl text-xs bg-slate-50 border border-slate-200 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-slate-900 text-slate-900"
                      />
                    </div>
                  </div>

                  {/* Píldoras de Filtro Rápido */}
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setFiltroPill('todos')}
                      className={cn(
                        'px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer shrink-0',
                        filtroPill === 'todos'
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      )}
                    >
                      Todos ({todosAbonosCobrador.length})
                    </button>

                    <button
                      type="button"
                      onClick={() => setFiltroPill('pendientes')}
                      className={cn(
                        'px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer shrink-0 flex items-center gap-1.5',
                        filtroPill === 'pendientes'
                          ? 'bg-amber-500 text-white'
                          : 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
                      )}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      Pendientes de Arqueo ({abonosPendientes.length})
                    </button>

                    <button
                      type="button"
                      onClick={() => setFiltroPill('conciliados')}
                      className={cn(
                        'px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer shrink-0',
                        filtroPill === 'conciliados'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                      )}
                    >
                      Conciliados ({abonosConciliados.length})
                    </button>

                    <button
                      type="button"
                      onClick={() => setFiltroPill('efectivo')}
                      className={cn(
                        'px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer shrink-0 flex items-center gap-1',
                        filtroPill === 'efectivo'
                          ? 'bg-slate-800 text-white'
                          : 'bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100'
                      )}
                    >
                      <Banknote className="w-3.5 h-3.5" />
                      Efectivo ({todosAbonosCobrador.filter((a) => a.metodo_pago === 'efectivo').length})
                    </button>

                    <button
                      type="button"
                      onClick={() => setFiltroPill('transferencia')}
                      className={cn(
                        'px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer shrink-0 flex items-center gap-1',
                        filtroPill === 'transferencia'
                          ? 'bg-blue-600 text-white'
                          : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
                      )}
                    >
                      <Smartphone className="w-3.5 h-3.5" />
                      Transferencias ({todosAbonosCobrador.filter((a) => a.metodo_pago !== 'efectivo').length})
                    </button>

                    <button
                      type="button"
                      onClick={() => setFiltroPill('saldados')}
                      className={cn(
                        'px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer shrink-0 flex items-center gap-1',
                        filtroPill === 'saldados'
                          ? 'bg-purple-600 text-white'
                          : 'bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100'
                      )}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Créditos Saldados ({todosAbonosCobrador.filter((a) => a.saldo_restante_credito !== undefined && a.saldo_restante_credito <= 0).length})
                    </button>
                  </div>
                </div>

                {/* Tabla SaaS */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50/75 border-b border-slate-100 text-slate-500 uppercase font-semibold">
                      <tr>
                        <th className="px-6 py-3.5">Recibo / Método</th>
                        <th className="px-6 py-3.5">Cliente</th>
                        <th className="px-6 py-3.5">Contrato & Impacto</th>
                        <th className="px-6 py-3.5">Monto Recaudado</th>
                        <th className="px-6 py-3.5">Geolocalización GPS</th>
                        <th className="px-6 py-3.5 text-right">Estado de Arqueo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                      {abonosFiltrados.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center text-slate-500 space-y-1">
                            <Receipt className="w-6 h-6 text-slate-400 mx-auto mb-1" />
                            <p className="font-semibold text-slate-700">No se encontraron recaudos con los filtros actuales</p>
                            <p className="text-[11px] text-slate-400">
                              Selecciona otra píldora o limpia la búsqueda para ver más movimientos.
                            </p>
                          </td>
                        </tr>
                      ) : (
                        abonosFiltrados.map((abono) => {
                          const isConciliado = abono.estado === 'conciliado';
                          const esTransferencia = abono.metodo_pago !== 'efectivo';
                          const esSaldado =
                            abono.saldo_restante_credito !== undefined &&
                            abono.saldo_restante_credito <= 0;

                          return (
                            <tr key={abono.id_recibo} className="hover:bg-slate-50/60 transition-colors">
                              {/* Recibo / Hora / Método */}
                              <td className="px-6 py-4">
                                <span
                                  className="font-mono font-bold text-slate-900 text-xs block"
                                  title={abono.id_recibo}
                                >
                                  REC-{abono.id_recibo.slice(0, 8).toUpperCase()}
                                </span>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[11px] text-slate-500 flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {abono.fecha}
                                  </span>
                                  {esTransferencia ? (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                      <Smartphone className="w-2.5 h-2.5" />
                                      Transferencia
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      <Banknote className="w-2.5 h-2.5" />
                                      Efectivo
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* Cliente */}
                              <td className="px-6 py-4">
                                <span className="font-bold text-slate-900 block text-xs">
                                  {abono.cliente_nombre}
                                </span>
                                {abono.cliente_cedula && (
                                  <span className="text-[11px] text-slate-500 font-mono">
                                    CC: {abono.cliente_cedula}
                                  </span>
                                )}
                              </td>

                              {/* Contrato & Impacto */}
                              <td className="px-6 py-4">
                                <span className="font-mono text-slate-700 font-semibold block" title={abono.credito_id}>
                                  {abono.numero_contrato || `CTR-${abono.credito_id.slice(0, 8).toUpperCase()}`}
                                </span>
                                <div className="mt-0.5">
                                  {esSaldado ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200">
                                      <Sparkles className="w-3 h-3" />
                                      ★ Crédito Saldado ($0)
                                    </span>
                                  ) : (
                                    <span className="text-[11px] text-slate-500">
                                      {abono.saldo_restante_credito !== undefined ? (
                                        <>Saldo: <span className="font-mono font-semibold text-slate-700">{formatCOP(abono.saldo_restante_credito)}</span></>
                                      ) : (
                                        <span className="text-slate-400">Abono a Cuota</span>
                                      )}
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* Monto Abonado */}
                              <td className="px-6 py-4 font-mono font-bold text-sm text-slate-900">
                                {formatCOP(abono.valor_abonado)}
                              </td>

                              {/* GPS */}
                              <td className="px-6 py-4">
                                {abono.coordenadas_gps ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-200">
                                    <MapPin className="w-3 h-3 text-emerald-600" />
                                    {Number(abono.coordenadas_gps.latitud).toFixed(4)}, {Number(abono.coordenadas_gps.longitud).toFixed(4)}
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-slate-400 italic">No capturada</span>
                                )}
                              </td>

                              {/* Estado */}
                              <td className="px-6 py-4 text-right">
                                {isConciliado ? (
                                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Conciliado en Caja
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-300">
                                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                                    Pendiente de Arqueo
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      ) : (
        /* PESTAÑA 2: HISTORIAL DE CIERRES DE CAJA (AUDITORÍA) */
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Historial de Actas y Cierres de Caja
              </h2>
              <p className="text-xs text-slate-500">
                Registro inmutable de arqueos realizados por la secretaría para auditoría gerencial.
              </p>
            </div>
            <button
              onClick={cargarDatos}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Actualizar Historial</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/75 border-b border-slate-100 text-slate-500 uppercase font-semibold">
                <tr>
                  <th className="px-6 py-3.5">Acta / Fecha</th>
                  <th className="px-6 py-3.5">Cobrador</th>
                  <th className="px-6 py-3.5">Secretaría Responsable</th>
                  <th className="px-6 py-3.5">Total Esperado</th>
                  <th className="px-6 py-3.5">Efectivo en Caja</th>
                  <th className="px-6 py-3.5">Diferencia</th>
                  <th className="px-6 py-3.5">Estado</th>
                  <th className="px-6 py-3.5 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {cierresHistoricos.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-slate-500">
                      No se han registrado cierres de caja todavía en la jornada.
                    </td>
                  </tr>
                ) : (
                  cierresHistoricos.map((cierre) => (
                    <tr key={cierre.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-6 py-4">
                        <span className="font-mono font-bold text-slate-900 block" title={cierre.id}>
                          ACT-{cierre.id.slice(0, 8).toUpperCase()}
                        </span>
                        <span className="text-[11px] text-slate-500">{cierre.fecha_cierre}</span>
                      </td>

                      <td className="px-6 py-4 font-bold text-slate-900">{cierre.cobrador_nombre}</td>

                      <td className="px-6 py-4 text-slate-600">{cierre.responsable_nombre}</td>

                      <td className="px-6 py-4 font-mono font-semibold text-slate-900">
                        {formatCOP(cierre.total_esperado)}
                      </td>

                      <td className="px-6 py-4 font-mono font-semibold text-emerald-800">
                        {formatCOP(cierre.efectivo_entregado)}
                      </td>

                      <td className="px-6 py-4 font-mono font-bold">
                        <span
                          className={cn(
                            cierre.cuadre_estado === 'cuadrado' && 'text-emerald-700',
                            cierre.cuadre_estado === 'faltante' && 'text-amber-700',
                            cierre.cuadre_estado === 'sobrante' && 'text-blue-700'
                          )}
                        >
                          {cierre.diferencia === 0 ? '$0' : formatCOP(cierre.diferencia)}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase',
                            cierre.cuadre_estado === 'cuadrado' && 'bg-emerald-50 text-emerald-700 border border-emerald-200',
                            cierre.cuadre_estado === 'faltante' && 'bg-amber-50 text-amber-800 border border-amber-300',
                            cierre.cuadre_estado === 'sobrante' && 'bg-blue-50 text-blue-800 border border-blue-200'
                          )}
                        >
                          {cierre.cuadre_estado}
                        </span>
                      </td>

                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => {
                            setUltimoCierre({
                              id: cierre.id,
                              cobrador: cierre.cobrador_nombre,
                              responsable: cierre.responsable_nombre,
                              totalEsperado: cierre.total_esperado,
                              efectivoEntregado: cierre.efectivo_entregado,
                              diferencia: cierre.diferencia,
                              cuadreEstado: cierre.cuadre_estado,
                              cantidadAbonos: cierre.abonos_conciliados_count,
                              totalEfectivo: cierre.total_esperado,
                              totalTransferencias: 0,
                              saldadosCount: 0,
                              parcialesCount: cierre.abonos_conciliados_count,
                              fechaHora: cierre.fecha_cierre,
                              reciboIds: [],
                              notas: cierre.notas,
                            });
                            setShowComprobanteModal(true);
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>Ver Acta</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMACIÓN DE CONCILIACIÓN */}
      {showConfirmModal && cobradorSeleccionado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl w-full max-w-lg border border-slate-200 shadow-2xl p-6 space-y-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center shrink-0 shadow-2xs">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  ¿Confirmar Conciliación y Cierre de Caja?
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Estás a punto de cerrar el arqueo formal de la ruta de{' '}
                  <span className="font-bold text-slate-800">{cobradorSeleccionado.nombre}</span>.
                </p>
              </div>
            </div>

            {/* Resumen del Cuadre */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-600">Total Recaudado en Terreno:</span>
                <span className="font-mono font-bold text-slate-900">{formatCOP(totalEsperadoGeneral)}</span>
              </div>
              <div className="flex justify-between text-[11px] text-slate-500 pl-2">
                <span>• Efectivo Físico ({pendientesEfectivo.length}):</span>
                <span className="font-mono font-medium">{formatCOP(totalEsperadoEfectivo)}</span>
              </div>
              <div className="flex justify-between text-[11px] text-slate-500 pl-2">
                <span>• Transferencias Bancarias ({pendientesTransferencias.length}):</span>
                <span className="font-mono font-medium">{formatCOP(totalEsperadoTransferencias)}</span>
              </div>
              <div className="flex justify-between text-[11px] text-purple-700 pl-2 font-semibold">
                <span>• Créditos Saldados en Ruta:</span>
                <span>{pendientesSaldados.length} contratos cancelados</span>
              </div>

              <div className="pt-2 border-t border-slate-200 flex justify-between">
                <span className="text-slate-700 font-bold">Efectivo Recibido en Caja:</span>
                <span className="font-mono font-bold text-slate-900">{formatCOP(efectivoEntregadoNum)}</span>
              </div>

              <div className="pt-1 flex justify-between font-bold">
                <span className="text-slate-700">Diferencia de Cuadre:</span>
                <span
                  className={cn(
                    'font-mono',
                    estadoCuadre === 'cuadrado' && 'text-emerald-700',
                    estadoCuadre === 'faltante' && 'text-amber-700',
                    estadoCuadre === 'sobrante' && 'text-blue-700'
                  )}
                >
                  {diferencia === 0 ? '$0 COP (Cuadrado)' : formatCOP(diferencia)}
                </span>
              </div>
            </div>

            {/* Campo Opcional de Notas */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Notas u Observaciones del Cierre (Opcional)
              </label>
              <textarea
                rows={2}
                value={notasCierre}
                onChange={(e) => setNotasCierre(e.target.value)}
                placeholder="Ej: Faltante justificado por cambio pendiente o entrega exacta en billetes..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900 resize-none"
              />
            </div>

            {/* Botones */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={isProcessing}
                onClick={handleEjecutarConciliacion}
                className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
              >
                {isProcessing ? 'Procesando Cierre...' : 'Sí, Conciliar y Emitir Acta Oficial'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL / COMPROBANTE OFICIAL DE CIERRE DE CAJA (PRINTABLE) */}
      {showComprobanteModal && ultimoCierre && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl w-full max-w-xl border border-slate-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Cabecera del Comprobante */}
            <div className="p-6 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <h3 className="font-bold text-base tracking-tight">
                    Acta Oficial de Conciliación & Cierre de Caja
                  </h3>
                  <p className="text-xs text-slate-300">
                    Remundial Créditos • Registro de Auditoría de Secretaría
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowComprobanteModal(false)}
                className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Contenido Imprimible */}
            <div className="p-6 space-y-6 text-xs text-slate-800">
              <div className="grid grid-cols-2 gap-4 pb-4 border-b border-slate-100">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">Cobrador de Ruta</span>
                  <span className="text-sm font-bold text-slate-900">{ultimoCierre.cobrador}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">Fecha y Hora de Cierre</span>
                  <span className="text-xs font-mono font-medium text-slate-900">{ultimoCierre.fechaHora}</span>
                </div>
              </div>

              {/* Ficha Numérica */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-600">Total Reportado en Sistema:</span>
                  <span className="font-mono font-bold text-slate-900">{formatCOP(ultimoCierre.totalEsperado)}</span>
                </div>

                <div className="flex justify-between text-[11px] text-slate-500 pl-2">
                  <span>• Recaudos en Efectivo Físico:</span>
                  <span className="font-mono font-medium">{formatCOP(ultimoCierre.totalEfectivo)}</span>
                </div>

                <div className="flex justify-between text-[11px] text-slate-500 pl-2">
                  <span>• Recaudos en Transferencias:</span>
                  <span className="font-mono font-medium">{formatCOP(ultimoCierre.totalTransferencias)}</span>
                </div>

                <div className="flex justify-between pt-1 border-t border-slate-200">
                  <span className="text-slate-600 font-semibold">Efectivo Físico Entregado en Caja:</span>
                  <span className="font-mono font-bold text-slate-900">{formatCOP(ultimoCierre.efectivoEntregado)}</span>
                </div>

                <div className="pt-2 border-t border-slate-200 flex justify-between font-bold text-sm">
                  <span>Diferencia Final:</span>
                  <span
                    className={cn(
                      'font-mono',
                      ultimoCierre.cuadreEstado === 'cuadrado' && 'text-emerald-700',
                      ultimoCierre.cuadreEstado === 'faltante' && 'text-amber-700',
                      ultimoCierre.cuadreEstado === 'sobrante' && 'text-blue-700'
                    )}
                  >
                    {ultimoCierre.diferencia === 0 ? '$0 COP (Cuadrado)' : formatCOP(ultimoCierre.diferencia)}
                  </span>
                </div>
              </div>

              {ultimoCierre.notas && (
                <div className="p-3 rounded-lg bg-amber-50/60 border border-amber-200/60 text-amber-900 text-[11px]">
                  <span className="font-bold block">Observaciones:</span>
                  <span>{ultimoCierre.notas}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-slate-600 text-[11px] bg-slate-50 p-2.5 rounded-xl">
                <div>
                  <span className="block text-slate-400 uppercase text-[9px] font-bold">Abonos Validados</span>
                  <span className="font-mono font-bold text-slate-900">{ultimoCierre.cantidadAbonos} recibos conciliados</span>
                </div>
                <div>
                  <span className="block text-slate-400 uppercase text-[9px] font-bold">Impacto en Cartera</span>
                  <span className="font-mono font-bold text-purple-700">
                    {ultimoCierre.saldadosCount} saldados • {ultimoCierre.parcialesCount} parciales
                  </span>
                </div>
              </div>

              {/* Firmas de Auditoría */}
              <div className="grid grid-cols-2 gap-8 pt-8 border-t border-slate-200">
                <div className="text-center space-y-1">
                  <div className="border-b border-slate-300 pb-8" />
                  <span className="font-bold text-slate-900 block text-xs">Firma Cobrador en Terreno</span>
                  <span className="text-[10px] text-slate-500">{ultimoCierre.cobrador}</span>
                </div>

                <div className="text-center space-y-1">
                  <div className="border-b border-slate-300 pb-8" />
                  <span className="font-bold text-slate-900 block text-xs">Firma Secretaría / Caja</span>
                  <span className="text-[10px] text-slate-500">{ultimoCierre.responsable}</span>
                </div>
              </div>
            </div>

            {/* Footer de Acciones del Comprobante */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowComprobanteModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-white transition-colors cursor-pointer"
              >
                Cerrar Ventana
              </button>

              <button
                type="button"
                onClick={handleImprimir}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimir Acta Oficial</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ConciliacionRutasPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-slate-500">Cargando mesa de conciliación...</div>}>
      <ConciliacionRutasContent />
    </Suspense>
  );
}
