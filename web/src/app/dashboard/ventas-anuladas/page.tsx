'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RotateCcw,
  Search,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowRight,
  Building2,
  CreditCard,
  Banknote,
  Calendar,
  User,
  Package,
  FileCheck,
  X,
  ChevronRight,
  TrendingDown,
  ExternalLink,
  PenTool,
} from 'lucide-react';
import { formatCOP, cn } from '@/lib/utils';
import { api } from '@/lib/api';

interface ArticuloVenta {
  producto_id?: number | string;
  nombre?: string;
  cantidad?: number;
  valor_unitario_acordado?: number;
}

interface VentaAnulada {
  id: string;
  fecha: string;
  vendedor_id: string;
  vendedor_nombre?: string | null;
  monto_total: number;
  metodo_pago_original: string;
  referencia_original?: string | null;
  articulos_json: ArticuloVenta[] | any;
  estado_devolucion: 'EFECTIVO_DEVUELTO_EN_RUTA' | 'PENDIENTE_REEMBOLSO_TRANSFERENCIA' | 'REEMBOLSADO_OFICINA';
  banco_destino_cliente?: string | null;
  cuenta_destino_cliente?: string | null;
  notas_vendedor?: string | null;
  firma_vendedor?: string | null;
  firma_cliente?: string | null;
  referencia_reembolso_oficina?: string | null;
  banco_origen_reembolso?: string | null;
  fecha_reembolso?: string | null;
  creado_en: string;
}

interface BancoOption {
  id: string;
  nombre: string;
}

export default function VentasAnuladasPage() {
  const [activeTab, setActiveTab] = useState<'pendientes' | 'historial'>('pendientes');
  const [ventasAnuladas, setVentasAnuladas] = useState<VentaAnulada[]>([]);
  const [bancosList, setBancosList] = useState<BancoOption[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [feedbackMsg, setFeedbackMsg] = useState<{ tipo: 'success' | 'error'; texto: string } | null>(null);

  // Modal de Legalización de Reembolso
  const [modalLegalizar, setModalLegalizar] = useState<{
    isOpen: boolean;
    item: VentaAnulada | null;
    referenciaPago: string;
    bancoSalida: string;
    fechaGiro: string;
    notasOficina: string;
  }>({
    isOpen: false,
    item: null,
    referenciaPago: '',
    bancoSalida: 'Bancolombia',
    fechaGiro: new Date().toISOString().split('T')[0],
    notasOficina: '',
  });
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Modal de Auditoría Visual de Firmas Digitales (Fase 4 & Refinamiento)
  const [modalFirmas, setModalFirmas] = useState<{
    isOpen: boolean;
    item: VentaAnulada | null;
  }>({
    isOpen: false,
    item: null,
  });

  const normalizarBase64 = (str?: string | null) => {
    if (!str) return null;
    const trimmed = str.trim();
    if (trimmed.startsWith('data:image/')) return trimmed;
    return `data:image/png;base64,${trimmed}`;
  };

  // Cargar lista de entidades bancarias
  useEffect(() => {
    api.get('/bancos?solo_activas=true')
      .then((res) => {
        if (Array.isArray(res.data)) {
          setBancosList(res.data);
        }
      })
      .catch((err) => {
        console.warn('Error al cargar bancos configurados:', err);
      });
  }, []);

  // Cargar ventas anuladas del servidor
  const cargarVentasAnuladas = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await api.get('/auditoria/anuladas');
      if (Array.isArray(res.data)) {
        setVentasAnuladas(res.data);
      }
    } catch (err: any) {
      console.error('Error al cargar ventas anuladas:', err);
      setFeedbackMsg({
        tipo: 'error',
        texto: 'No se pudo consultar el registro de ventas anuladas. Revisa la conexión al backend.',
      });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    cargarVentasAnuladas();
  }, [cargarVentasAnuladas]);

  const onRefresh = () => {
    setIsRefreshing(true);
    cargarVentasAnuladas();
  };

  // Filtrar pendientes e histórico
  const pendientes = useMemo(() => {
    return ventasAnuladas.filter((v) => v.estado_devolucion === 'PENDIENTE_REEMBOLSO_TRANSFERENCIA');
  }, [ventasAnuladas]);

  const historial = useMemo(() => {
    return ventasAnuladas.filter(
      (v) => v.estado_devolucion === 'REEMBOLSADO_OFICINA' || v.estado_devolucion === 'EFECTIVO_DEVUELTO_EN_RUTA'
    );
  }, [ventasAnuladas]);

  // Totales y KPIs
  const kpis = useMemo(() => {
    const totalMontoPendiente = pendientes.reduce((acc, curr) => acc + Number(curr.monto_total || 0), 0);
    const totalMontoLegalizado = historial.reduce((acc, curr) => acc + Number(curr.monto_total || 0), 0);
    return {
      pendientesCount: pendientes.length,
      historialCount: historial.length,
      totalMontoPendiente,
      totalMontoLegalizado,
    };
  }, [pendientes, historial]);

  // Lista visible según tab y búsqueda
  const itemsFiltrados = useMemo(() => {
    const baseList = activeTab === 'pendientes' ? pendientes : historial;
    if (!searchTerm.trim()) return baseList;

    const term = searchTerm.toLowerCase().trim();
    return baseList.filter((item) => {
      const vendedor = (item.vendedor_nombre || '').toLowerCase();
      const banco = (item.banco_destino_cliente || item.banco_origen_reembolso || '').toLowerCase();
      const cuenta = (item.cuenta_destino_cliente || '').toLowerCase();
      const ref = (item.referencia_original || item.referencia_reembolso_oficina || '').toLowerCase();
      const notas = (item.notas_vendedor || '').toLowerCase();
      return vendedor.includes(term) || banco.includes(term) || cuenta.includes(term) || ref.includes(term) || notas.includes(term);
    });
  }, [activeTab, pendientes, historial, searchTerm]);

  // Abrir Modal de Legalización
  const abrirModalLegalizar = (item: VentaAnulada) => {
    setModalLegalizar({
      isOpen: true,
      item,
      referenciaPago: '',
      bancoSalida: bancosList[0]?.nombre || 'Bancolombia',
      fechaGiro: new Date().toISOString().split('T')[0],
      notasOficina: '',
    });
  };

  const cerrarModalLegalizar = () => {
    if (isSubmitting) return;
    setModalLegalizar((prev) => ({ ...prev, isOpen: false, item: null }));
  };

  // Confirmar Reembolso / Legalizar
  const handleConfirmarLegalizacion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalLegalizar.item) return;

    if (!modalLegalizar.referenciaPago.trim()) {
      alert('Por favor ingresa la Referencia de Pago / Comprobante de Giro emitido por la oficina.');
      return;
    }

    try {
      setIsSubmitting(true);
      const payload = {
        referencia_reembolso_oficina: modalLegalizar.referenciaPago.trim(),
        banco_origen_reembolso: modalLegalizar.bancoSalida.trim(),
        fecha_reembolso: modalLegalizar.fechaGiro ? new Date(modalLegalizar.fechaGiro).toISOString() : new Date().toISOString(),
        notas_oficina: modalLegalizar.notasOficina.trim() || undefined,
      };

      const res = await api.patch(`/auditoria/anuladas/${modalLegalizar.item.id}/reembolsar`, payload);
      if (res.status === 200) {
        setFeedbackMsg({
          tipo: 'success',
          texto: `Reembolso legalizado exitosamente con comprobante ${modalLegalizar.referenciaPago.trim()}. El caso fue movido al Historial.`,
        });
        cerrarModalLegalizar();
        await cargarVentasAnuladas();
      }
    } catch (err: any) {
      console.error('Error al legalizar reembolso:', err);
      const detail = err.response?.data?.detail || err.message || 'Error en la operación';
      alert(`Error al legalizar: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatearFechaHora = (fechaStr?: string | null) => {
    if (!fechaStr) return 'N/A';
    try {
      const d = new Date(fechaStr);
      return d.toLocaleDateString('es-CO', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return fechaStr;
    }
  };

  return (
    <div className="space-y-6">
      {/* CABECERA PRINCIPAL */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-red-600 shadow-sm border border-red-200">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                Ventas Anuladas & Devoluciones
              </h1>
              <p className="text-sm text-slate-500">
                Auditoría de quiebres de inventario, devoluciones en ruta y liquidación de reembolsos bancarios
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 active:bg-slate-100 transition-colors shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin text-emerald-600')} />
          <span>Actualizar</span>
        </button>
      </div>

      {/* FEEDBACK ALERT */}
      {feedbackMsg && (
        <div
          className={cn(
            'p-4 rounded-xl border flex items-start gap-3 transition-all',
            feedbackMsg.tipo === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          )}
        >
          {feedbackMsg.tipo === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 text-sm font-medium">{feedbackMsg.texto}</div>
          <button
            onClick={() => setFeedbackMsg(null)}
            className="text-slate-400 hover:text-slate-600 text-sm font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* TARJETAS KPI DE IMPACTO */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* KPI 1: Pendientes de Reembolso */}
        <div className="bg-white rounded-xl border border-amber-200 p-5 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">
              Pendientes por Girar (Oficina)
            </span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600 border border-amber-200">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-slate-900">{kpis.pendientesCount}</span>
            <span className="text-xs text-slate-500">casos por transferir</span>
          </div>
          <div className="mt-2 text-base font-bold text-amber-600">
            {formatCOP(kpis.totalMontoPendiente)}
          </div>
          <div className="mt-1 text-xs text-slate-400">Total a reintegrar a cuentas de clientes</div>
        </div>

        {/* KPI 2: Historial Legalizado */}
        <div className="bg-white rounded-xl border border-emerald-200 p-5 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
              Historial Legalizado
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600 border border-emerald-200">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-slate-900">{kpis.historialCount}</span>
            <span className="text-xs text-slate-500">devoluciones cerradas</span>
          </div>
          <div className="mt-2 text-base font-bold text-emerald-600">
            {formatCOP(kpis.totalMontoLegalizado)}
          </div>
          <div className="mt-1 text-xs text-slate-400">Giro bancario o efectivo en ruta liquidado</div>
        </div>

        {/* KPI 3: Control Estricto de Inventario */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
              Control de Inventario
            </span>
            <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-slate-600 border border-slate-200">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-slate-900">0%</span>
            <span className="text-xs text-emerald-600 font-semibold">Tolerancia Sobreventa</span>
          </div>
          <div className="mt-2 text-xs text-slate-600 leading-relaxed">
            Las órdenes sin existencias son bloqueadas con HTTP 400 y puestas en cuarentena para su devolución obligatoria.
          </div>
        </div>
      </div>

      {/* PESTAÑAS (TABS) Y BUSCADOR */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Selector de Pestañas */}
          <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-lg">
            <button
              onClick={() => setActiveTab('pendientes')}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-md transition-all',
                activeTab === 'pendientes'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              <Clock className="w-4 h-4 text-amber-500" />
              <span>Pendientes de Reembolso</span>
              {kpis.pendientesCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800">
                  {kpis.pendientesCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('historial')}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-md transition-all',
                activeTab === 'historial'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              <FileCheck className="w-4 h-4 text-emerald-500" />
              <span>Historial Legalizado</span>
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-200 text-slate-700">
                {kpis.historialCount}
              </span>
            </button>
          </div>

          {/* Buscador */}
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por asesor, banco, cuenta o ref..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>
        </div>

        {/* CONTENIDO TABLA */}
        {isLoading ? (
          <div className="p-12 text-center">
            <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-700">Consultando auditoría de ventas anuladas...</p>
          </div>
        ) : itemsFiltrados.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
              {activeTab === 'pendientes' ? <CheckCircle2 className="w-6 h-6 text-emerald-500" /> : <RotateCcw className="w-6 h-6" />}
            </div>
            <h3 className="text-base font-bold text-slate-800">
              {activeTab === 'pendientes'
                ? '¡Al día! No hay reembolsos bancarios pendientes'
                : 'No se encontraron registros en el historial legalizado'}
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
              {activeTab === 'pendientes'
                ? 'Todas las ventas anuladas por transferencia han sido legalizadas con comprobante de tesorería.'
                : 'Las anulaciones y devoluciones legalizadas aparecerán en esta vista archivada para trazabilidad contable.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Fecha Radicación</th>
                  <th className="py-3 px-4">Asesor / Vendedor</th>
                  <th className="py-3 px-4">Detalle / Artículos</th>
                  <th className="py-3 px-4">Monto a Devolver</th>
                  <th className="py-3 px-4">
                    {activeTab === 'pendientes' ? 'Destino del Cliente' : 'Comprobante & Salida'}
                  </th>
                  <th className="py-3 px-4">Estado</th>
                  <th className="py-3 px-4 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {itemsFiltrados.map((item) => {
                  const articulos = Array.isArray(item.articulos_json) ? item.articulos_json : [];
                  const esTransferencia = item.estado_devolucion === 'PENDIENTE_REEMBOLSO_TRANSFERENCIA';
                  const esEfectivoRuta = item.estado_devolucion === 'EFECTIVO_DEVUELTO_EN_RUTA';
                  const esReembolsadoOficina = item.estado_devolucion === 'REEMBOLSADO_OFICINA';

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Fecha */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-slate-600 font-medium">
                        {formatearFechaHora(item.fecha || item.creado_en)}
                      </td>

                      {/* Vendedor */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[11px] font-bold text-slate-600">
                            {item.vendedor_nombre ? item.vendedor_nombre.slice(0, 2).toUpperCase() : 'VE'}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900">{item.vendedor_nombre || 'Asesor Comercial'}</div>
                            <div className="text-[10px] text-slate-400 font-mono">ID: {item.vendedor_id?.slice(0, 8)}...</div>
                          </div>
                        </div>
                      </td>

                      {/* Detalle Artículos */}
                      <td className="py-3.5 px-4 max-w-xs">
                        <div className="font-semibold text-slate-800 truncate">
                          {articulos.length > 0
                            ? articulos.map((a) => `${a.cantidad || 1}x ${a.nombre || 'Artículo'}`).join(', ')
                            : 'Venta por catálogo'}
                        </div>
                        {item.notas_vendedor && (
                          <div className="text-[11px] text-slate-500 italic truncate mt-0.5" title={item.notas_vendedor}>
                            "{item.notas_vendedor}"
                          </div>
                        )}
                      </td>

                      {/* Monto */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-extrabold text-sm text-slate-900">{formatCOP(item.monto_total)}</div>
                        <div className="text-[10px] text-slate-400 font-medium">
                          Orig: {item.metodo_pago_original}
                          {item.referencia_original && ` (${item.referencia_original})`}
                        </div>
                      </td>

                      {/* Destino o Comprobante */}
                      <td className="py-3.5 px-4">
                        {activeTab === 'pendientes' ? (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5 font-bold text-slate-900">
                              <Building2 className="w-3.5 h-3.5 text-blue-600" />
                              <span>{item.banco_destino_cliente || 'Banco no especificado'}</span>
                            </div>
                            <div className="text-[11px] text-slate-600 font-mono font-medium">
                              Cta: {item.cuenta_destino_cliente || 'N/A'}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            {esEfectivoRuta ? (
                              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">
                                💵 Efectivo devuelto en terreno
                              </div>
                            ) : (
                              <>
                                <div className="font-bold text-slate-900 flex items-center gap-1">
                                  <span>Ref Giro: {item.referencia_reembolso_oficina || 'S/R'}</span>
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  Salida: {item.banco_origen_reembolso || 'Oficina'} • {formatearFechaHora(item.fecha_reembolso)}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Estado */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {esTransferencia && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 border border-amber-200">
                            <Clock className="w-3 h-3" />
                            PENDIENTE GIRO
                          </span>
                        )}
                        {esEfectivoRuta && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" />
                            DEVUELTO EN RUTA
                          </span>
                        )}
                        {esReembolsadoOficina && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-blue-100 text-blue-800 border border-blue-200">
                            <CheckCircle2 className="w-3 h-3" />
                            REEMBOLSADO OFICINA
                          </span>
                        )}
                        {/* Indicador de Firmas Digitales */}
                        <div className="mt-1">
                          {item.firma_cliente && item.firma_vendedor ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200" title="Doble firma cliente y asesor registrada">
                              <FileCheck className="w-3 h-3 text-indigo-600" />
                              Doble Firma OK
                            </span>
                          ) : (item.firma_cliente || item.firma_vendedor) ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              <PenTool className="w-3 h-3 text-amber-600" />
                              1 Firma
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400 italic">
                              Sin firmas
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Acciones */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-right">
                        {activeTab === 'pendientes' ? (
                          <div className="flex items-center justify-end gap-2">
                            {(item.firma_cliente || item.firma_vendedor) && (
                              <button
                                type="button"
                                onClick={() => setModalFirmas({ isOpen: true, item })}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition-all shadow-sm"
                                title="Auditar firmas digitales del expediente"
                              >
                                <PenTool className="w-3.5 h-3.5 text-slate-600" />
                                <span>Firmas</span>
                              </button>
                            )}
                            <button
                              onClick={() => abrirModalLegalizar(item)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-sm transition-all"
                            >
                              <span>Legalizar Devolución</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setModalFirmas({ isOpen: true, item })}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300 transition-all shadow-sm group"
                              title="Ver firmas digitales del cliente y vendedor en base64"
                            >
                              <PenTool className="w-3.5 h-3.5 text-indigo-600 group-hover:scale-110 transition-transform" />
                              <span>Ver Firmas</span>
                            </button>
                            <span className="text-[11px] font-semibold text-slate-400 pl-1">
                              Archivado ✓
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: LEGALIZAR DEVOLUCIÓN POR TRANSFERENCIA */}
      {modalLegalizar.isOpen && modalLegalizar.item && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            {/* Header Modal */}
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <Banknote className="w-5 h-5 text-emerald-400" />
                  Legalizar Reembolso Bancario
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Registra el comprobante de giro emitido por la oficina de tesorería
                </p>
              </div>
              <button
                onClick={cerrarModalLegalizar}
                disabled={isSubmitting}
                className="text-slate-400 hover:text-white p-1 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Formulario */}
            <form onSubmit={handleConfirmarLegalizacion} className="p-6 space-y-4">
              {/* Tarjeta Informativa del Reintegro */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Datos del Beneficiario & Venta Anulada
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500">Monto a Devolver:</span>
                    <div className="text-base font-extrabold text-red-600">
                      {formatCOP(modalLegalizar.item.monto_total)}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Asesor Comercial:</span>
                    <div className="font-bold text-slate-800">
                      {modalLegalizar.item.vendedor_nombre || 'Asesor'}
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200/80 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500">Banco de Destino:</span>
                    <div className="font-bold text-blue-700">
                      {modalLegalizar.item.banco_destino_cliente || 'N/A'}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Cuenta de Destino:</span>
                    <div className="font-mono font-bold text-slate-800">
                      {modalLegalizar.item.cuenta_destino_cliente || 'N/A'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Input: Referencia de Pago de Oficina */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nueva Referencia de Pago / Comprobante de Giro (*)
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: NEQ-987654321, BCOL-554433, DAVI-112233"
                  value={modalLegalizar.referenciaPago}
                  onChange={(e) => setModalLegalizar((prev) => ({ ...prev, referenciaPago: e.target.value }))}
                  className="w-full px-3.5 py-2 text-xs font-mono font-bold rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Código o ID de aprobación entregado por el banco al transferir los fondos.
                </p>
              </div>

              {/* Grid: Banco de Salida y Fecha de Giro */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Banco de Salida (Oficina) (*)
                  </label>
                  <select
                    value={modalLegalizar.bancoSalida}
                    onChange={(e) => setModalLegalizar((prev) => ({ ...prev, bancoSalida: e.target.value }))}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  >
                    {bancosList.map((b) => (
                      <option key={b.id} value={b.nombre}>
                        {b.nombre}
                      </option>
                    ))}
                    {!bancosList.some((b) => b.nombre === 'Bancolombia') && (
                      <option value="Bancolombia">Bancolombia</option>
                    )}
                    {!bancosList.some((b) => b.nombre === 'Nequi') && (
                      <option value="Nequi">Nequi</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Fecha de Giro (*)
                  </label>
                  <input
                    type="date"
                    required
                    value={modalLegalizar.fechaGiro}
                    onChange={(e) => setModalLegalizar((prev) => ({ ...prev, fechaGiro: e.target.value }))}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  >
                  </input>
                </div>
              </div>

              {/* Textarea: Notas u Observaciones */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Observaciones de Oficina (Opcional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Ej: Giro realizado por tesorería. Comprobante enviado por WhatsApp al cliente..."
                  value={modalLegalizar.notasOficina}
                  onChange={(e) => setModalLegalizar((prev) => ({ ...prev, notasOficina: e.target.value }))}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                />
              </div>

              {/* Botones de Acción */}
              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={cerrarModalLegalizar}
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-sm transition-all disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Legalizando...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Confirmar & Legalizar Giro</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: AUDITORÍA VISUAL DE FIRMAS DIGITALES (FASE 4 & REFINAMIENTO) */}
      {modalFirmas.isOpen && modalFirmas.item && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header Modal */}
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-400">
                  <PenTool className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    Auditoría Visual de Firmas Digitales
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                      SOPORTE LEGAL & CONTABLE
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Expediente: {modalFirmas.item.id} • Devolución Oficial
                  </p>
                </div>
              </div>
              <button
                onClick={() => setModalFirmas({ isOpen: false, item: null })}
                className="text-slate-400 hover:text-white p-1 rounded-md transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Contenido Scrollable */}
            <div className="p-6 overflow-y-auto space-y-5">
              {/* Tarjeta de Resumen */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 block font-medium">Asesor Comercial:</span>
                  <span className="font-bold text-slate-800">{modalFirmas.item.vendedor_nombre || 'Asesor'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block font-medium">Monto Anulado:</span>
                  <span className="font-extrabold text-slate-900 text-sm text-red-600">
                    {formatCOP(modalFirmas.item.monto_total)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block font-medium">Modalidad:</span>
                  <span className="font-semibold text-slate-800">
                    {modalFirmas.item.estado_devolucion === 'EFECTIVO_DEVUELTO_EN_RUTA'
                      ? '💵 Efectivo en Ruta'
                      : '🏦 Reembolso Bancario'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block font-medium">Fecha Radicación:</span>
                  <span className="font-semibold text-slate-800">
                    {formatearFechaHora(modalFirmas.item.fecha || modalFirmas.item.creado_en)}
                  </span>
                </div>
                {modalFirmas.item.notas_vendedor && (
                  <div className="col-span-2 sm:col-span-4 pt-2 border-t border-slate-200">
                    <span className="text-slate-500 font-medium">Observación en ruta: </span>
                    <span className="text-slate-700 italic">"{modalFirmas.item.notas_vendedor}"</span>
                  </div>
                )}
              </div>

              {/* Grid de 2 Firmas */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. FIRMA DEL CLIENTE */}
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <User className="w-4 h-4 text-emerald-600" />
                        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                          1. Firma del Cliente
                        </h4>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                        Comprobante Recibido
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mb-3">
                      Constancia de recibido a satisfacción y cuenta saldada.
                    </p>
                  </div>

                  <div className="bg-white border-2 border-dashed border-slate-200 rounded-lg p-3 min-h-[160px] flex items-center justify-center relative shadow-inner">
                    {modalFirmas.item.firma_cliente ? (
                      <img
                        src={normalizarBase64(modalFirmas.item.firma_cliente) || ''}
                        alt="Firma del Cliente"
                        className="max-h-36 max-w-full object-contain filter contrast-125"
                      />
                    ) : (
                      <div className="text-center p-4">
                        <AlertTriangle className="w-6 h-6 text-amber-500 mx-auto mb-1 opacity-70" />
                        <span className="text-xs text-slate-400 font-medium">
                          Sin firma del cliente registrada
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="mt-2 text-[10px] text-slate-400 text-center">
                    {modalFirmas.item.firma_cliente
                      ? '✓ Estampada digitalmente en dispositivo táctil'
                      : 'Registro manual o previo a versión auditable'}
                  </div>
                </div>

                {/* 2. FIRMA DEL ASESOR COMERCIAL */}
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <FileCheck className="w-4 h-4 text-blue-600" />
                        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                          2. Firma del Asesor
                        </h4>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                        Soporte Egreso Caja
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mb-3">
                      Certificación de egreso de ruta y descargo de inventario.
                    </p>
                  </div>

                  <div className="bg-white border-2 border-dashed border-slate-200 rounded-lg p-3 min-h-[160px] flex items-center justify-center relative shadow-inner">
                    {modalFirmas.item.firma_vendedor ? (
                      <img
                        src={normalizarBase64(modalFirmas.item.firma_vendedor) || ''}
                        alt="Firma del Asesor Comercial"
                        className="max-h-36 max-w-full object-contain filter contrast-125"
                      />
                    ) : (
                      <div className="text-center p-4">
                        <AlertTriangle className="w-6 h-6 text-amber-500 mx-auto mb-1 opacity-70" />
                        <span className="text-xs text-slate-400 font-medium">
                          Sin firma del asesor registrada
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="mt-2 text-[10px] text-slate-400 text-center">
                    {modalFirmas.item.firma_vendedor
                      ? '✓ Certificada con credenciales de ruta'
                      : 'Registro manual o previo a versión auditable'}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Modal */}
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <span className="text-[11px] text-slate-500 font-medium">
                Trazabilidad Remundial Core • Auditoría de Operaciones
              </span>
              <button
                type="button"
                onClick={() => setModalFirmas({ isOpen: false, item: null })}
                className="px-4 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg shadow-sm transition-colors"
              >
                Cerrar Auditoría
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
