'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  FolderArchive,
  Search,
  Download,
  FileText,
  Receipt,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  RefreshCw,
  Filter,
  DollarSign,
  User,
  ShieldCheck,
  Calendar,
  Layers,
  ArrowUpRight,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { formatCOP, cn } from '@/lib/utils';
import { api } from '@/lib/api';

type TipoComprobante = 'VENTA_INICIAL' | 'RECIBO_ABONO';
type FiltroTipo = 'todos' | 'ventas' | 'abonos' | 'abonos_parciales' | 'pendientes' | 'aprobados' | 'rechazados';

interface ComprobanteItem {
  id: string;
  codigo: string;
  contratoRef?: string;
  tipo: TipoComprobante;
  fechaRaw: Date;
  fechaFormateada: string;
  clienteNombre: string;
  clienteCedula: string;
  clienteTelefono?: string;
  responsableNombre: string;
  responsableRol: string;
  monto: number;
  saldoPendiente?: number;
  estadoDisplay: string;
  estadoTipo: 'pendiente' | 'activo' | 'rechazado' | 'terminado' | 'conciliado' | 'registrado' | 'mora';
  esRechazado: boolean;
  esContado?: boolean;
  modalidadPago?: string;
  endpointPdf: string;
  nombreArchivoPdf: string;
  esAbonoParcial?: boolean;
  saldoInsoluto?: number;
  cuotaAfectada?: number;
  valorCuotaSiguiente?: number;
}

function sanitizarNombreArchivo(texto: string): string {
  if (!texto) return 'Cliente';
  return (
    texto
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[-\s]+/g, '_') || 'Cliente'
  );
}

function formatearNombrePdf(
  tipo: 'Venta' | 'Abono' | 'Pago_Cuota' | 'Abono_Parcial',
  idContrato: string,
  nombreCliente: string,
  fecha: Date
): string {
  const nomClean = sanitizarNombreArchivo(nombreCliente);
  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');
  const fStr = `${yyyy}-${mm}-${dd}`;
  const ctrClean = idContrato.startsWith('CTR-') ? idContrato : `CTR-${idContrato.slice(0, 8).toUpperCase()}`;
  return `${tipo}_${ctrClean}_${nomClean}_${fStr}.pdf`;
}

export default function ComprobantesPage() {
  const [comprobantes, setComprobantes] = useState<ComprobanteItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [busqueda, setBusqueda] = useState<string>('');
  const [filtroActivo, setFiltroActivo] = useState<FiltroTipo>('todos');
  const [descargandoId, setDescargandoId] = useState<string | null>(null);
  const [feedbackDescarga, setFeedbackDescarga] = useState<string | null>(null);

  // Cargar contratos de crédito y recibos de abono desde la API
  const cargarDatos = useCallback(async () => {
    setIsLoading(true);
    try {
      const [resCreditos, resAbonos] = await Promise.allSettled([
        api.get('/creditos?limit=250'),
        api.get('/abonos?limit=250'),
      ]);

      if (resAbonos.status === 'rejected') {
        console.warn('[Comprobantes] Error cargando abonos del servidor:', resAbonos.reason);
      }

      const listaUnificada: ComprobanteItem[] = [];

      // 1. Procesar Ventas Iniciales (Contratos de Crédito y Contado)
      if (resCreditos.status === 'fulfilled' && Array.isArray(resCreditos.value.data)) {
        resCreditos.value.data.forEach((c: any) => {
          const idStr = String(c.id_contrato);
          const codigoCtr = `CTR-${idStr.slice(0, 8).toUpperCase()}`;
          const dt = c.creado_en ? new Date(c.creado_en) : new Date();

          const cuotaInicial = Number(c.cuota_inicial || 0);
          const montoFinanciado = Number(c.monto_financiado || 0);
          const saldoPendiente = Number(c.saldo_pendiente || 0);
          const valorTotalVenta = cuotaInicial + montoFinanciado;
          const esContado = montoFinanciado === 0 || (c.numero_cuotas === 1 && cuotaInicial >= montoFinanciado);

          const abonos = Array.isArray(c.abonos) ? c.abonos : [];
          const totalAbonado = abonos.reduce((sum: number, a: any) => sum + Number(a.valor_abonado || 0), 0);

          const rawEstado = String(c.estado || 'pendiente').toLowerCase();

          // Lógica de Estados de Aprobación de la Venta
          let estadoTipo: ComprobanteItem['estadoTipo'] = 'pendiente';
          let estadoDisplay = 'Pendiente / En Espera';
          let esRechazado = false;

          if (rawEstado === 'pendiente') {
            estadoTipo = 'pendiente';
            estadoDisplay = 'Pendiente / En Espera';
          } else if (
            rawEstado === 'terminado' &&
            montoFinanciado > 0 &&
            totalAbonado === 0 &&
            (saldoPendiente === 0 || c.supervisor_id)
          ) {
            // Rechazado formalmente por supervisión
            estadoTipo = 'rechazado';
            estadoDisplay = 'Rechazado';
            esRechazado = true;
          } else if (rawEstado === 'activo') {
            estadoTipo = 'activo';
            estadoDisplay = 'Aprobado / Activo';
          } else if (rawEstado === 'mora') {
            estadoTipo = 'mora';
            estadoDisplay = 'Cartera en Mora';
          } else if (rawEstado === 'terminado') {
            estadoTipo = 'terminado';
            estadoDisplay = esContado ? 'Venta de Contado' : 'Finalizado / Pagado';
          }

          listaUnificada.push({
            id: idStr,
            codigo: codigoCtr,
            tipo: 'VENTA_INICIAL',
            fechaRaw: dt,
            fechaFormateada: dt.toLocaleString('es-CO', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            }),
            clienteNombre: c.cliente?.nombres || 'Cliente Titular',
            clienteCedula: c.cliente?.cedula || 'S/N',
            clienteTelefono: c.cliente?.telefono || 'No registrado',
            responsableNombre: c.vendedor?.nombre || 'Asesor Comercial',
            responsableRol: 'Asesor de Ventas',
            monto: valorTotalVenta,
            saldoPendiente,
            estadoDisplay,
            estadoTipo,
            esRechazado,
            esContado,
            modalidadPago: esContado ? 'Contado' : `${c.numero_cuotas || 0} cuotas`,
            endpointPdf: `/creditos/${idStr}/recibo-pdf`,
            nombreArchivoPdf: formatearNombrePdf('Venta', codigoCtr, c.cliente?.nombres || 'Cliente', dt),
          });
        });
      }

      // 2. Procesar Recibos de Abono (Pagos a Cartera)
      if (resAbonos.status === 'fulfilled' && Array.isArray(resAbonos.value.data)) {
        resAbonos.value.data.forEach((a: any) => {
          const idRecibo = String(a.id_recibo);
          const codigoRec = `REC-${idRecibo.slice(0, 8).toUpperCase()}`;
          const idCredito = a.credito_id ? String(a.credito_id) : '';
          const codigoCtr = idCredito ? `CTR-${idCredito.slice(0, 8).toUpperCase()}` : 'CTR-GRAL';
          const dt = a.fecha ? new Date(a.fecha) : new Date();

          const rawEstadoAbono = String(a.estado || 'registrado').toLowerCase();
          let estadoTipo: ComprobanteItem['estadoTipo'] = 'registrado';
          let estadoDisplay = 'Registrado';

          if (rawEstadoAbono === 'conciliado') {
            estadoTipo = 'conciliado';
            estadoDisplay = 'Conciliado en Caja';
          } else if (rawEstadoAbono === 'anulado') {
            estadoTipo = 'rechazado';
            estadoDisplay = 'Anulado';
          }

          const clienteNombre = a.credito?.cliente?.nombres || a.cliente_nombre || 'Cliente Titular';
          const clienteCedula = a.credito?.cliente?.cedula || a.cliente_cedula || 'S/N';
          const esAbonoParcial = Boolean(a.es_abono_parcial);
          const saldoInsoluto = Number(a.diferencia_arrastrada || 0);
          const tipoPdf = esAbonoParcial ? 'Abono_Parcial' : 'Pago_Cuota';

          listaUnificada.push({
            id: idRecibo,
            codigo: codigoRec,
            contratoRef: codigoCtr,
            tipo: 'RECIBO_ABONO',
            fechaRaw: dt,
            fechaFormateada: dt.toLocaleString('es-CO', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            }),
            clienteNombre,
            clienteCedula,
            responsableNombre: a.cobrador?.nombre || 'Cobrador Autorizado',
            responsableRol: 'Cobrador de Ruta',
            monto: Number(a.valor_abonado || 0),
            saldoPendiente: a.saldo_restante_credito ? Number(a.saldo_restante_credito) : undefined,
            estadoDisplay,
            estadoTipo,
            esRechazado: rawEstadoAbono === 'anulado',
            modalidadPago: (a.metodo_pago || 'efectivo').toUpperCase(),
            endpointPdf: `/abonos/${idRecibo}/recibo-pdf`,
            nombreArchivoPdf: formatearNombrePdf(tipoPdf, codigoCtr, clienteNombre, dt),
            esAbonoParcial,
            saldoInsoluto,
            cuotaAfectada: a.cuota_afectada_numero,
            valorCuotaSiguiente: a.valor_cuota_siguiente ? Number(a.valor_cuota_siguiente) : undefined,
          });
        });
      }

      // Ordenar por fecha cronológica descendente (más recientes primero)
      listaUnificada.sort((x, y) => y.fechaRaw.getTime() - x.fechaRaw.getTime());
      setComprobantes(listaUnificada);
    } catch (error) {
      console.error('Error al cargar comprobantes:', error);
      setComprobantes([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    cargarDatos();

    const onFocus = () => {
      cargarDatos();
    };
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        cargarDatos();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus);
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [cargarDatos]);

  // Manejador para Descargar PDF directamente
  const handleDescargarPdf = async (item: ComprobanteItem) => {
    try {
      setDescargandoId(item.id);
      const res = await api.get(item.endpointPdf, {
        responseType: 'blob',
      });

      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);

      // Abrir en pestaña nueva para visualización inmediata
      window.open(url, '_blank');

      // Descargar archivo automáticamente
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', item.nombreArchivoPdf);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setFeedbackDescarga(`Comprobante ${item.codigo} generado y descargado correctamente.`);
      setTimeout(() => setFeedbackDescarga(null), 4000);
    } catch (err) {
      console.error('Error al descargar PDF:', err);
      alert(`No fue posible descargar el comprobante en PDF para ${item.codigo}. Verifique su sesión.`);
    } finally {
      setDescargandoId(null);
    }
  };

  // Filtrado y Búsqueda en tiempo real
  const comprobantesFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();

    return comprobantes.filter((item) => {
      // 1. Filtro por Pestaña / Estado
      if (filtroActivo === 'ventas' && item.tipo !== 'VENTA_INICIAL') return false;
      if (filtroActivo === 'abonos' && item.tipo !== 'RECIBO_ABONO') return false;
      if (filtroActivo === 'abonos_parciales' && !(item.tipo === 'RECIBO_ABONO' && item.esAbonoParcial)) return false;
      if (filtroActivo === 'pendientes' && item.estadoTipo !== 'pendiente') return false;
      if (filtroActivo === 'aprobados' && item.estadoTipo !== 'activo') return false;
      if (filtroActivo === 'rechazados' && !item.esRechazado) return false;

      // 2. Buscador en tiempo real por contrato, recibo, cédula o cliente
      if (!q) return true;

      const coincideCodigo = item.codigo.toLowerCase().includes(q);
      const coincideContratoRef = item.contratoRef?.toLowerCase().includes(q) || false;
      const coincideNombre = item.clienteNombre.toLowerCase().includes(q);
      const coincideCedula = item.clienteCedula.toLowerCase().includes(q);
      const coincideResponsable = item.responsableNombre.toLowerCase().includes(q);

      return coincideCodigo || coincideContratoRef || coincideNombre || coincideCedula || coincideResponsable;
    });
  }, [comprobantes, busqueda, filtroActivo]);

  // Contadores para métricas y tabs
  const metricas = useMemo(() => {
    const total = comprobantes.length;
    const ventas = comprobantes.filter((c) => c.tipo === 'VENTA_INICIAL');
    const abonos = comprobantes.filter((c) => c.tipo === 'RECIBO_ABONO');
    const abonosParciales = abonos.filter((c) => c.esAbonoParcial);
    const abonosTotales = abonos.filter((c) => !c.esAbonoParcial);
    const pendientes = comprobantes.filter((c) => c.estadoTipo === 'pendiente');
    const aprobados = comprobantes.filter((c) => c.estadoTipo === 'activo');
    const rechazados = comprobantes.filter((c) => c.esRechazado);
    const montoTotalAbonos = abonos.reduce((acc, a) => acc + a.monto, 0);
    const totalSaldoInsoluto = abonosParciales.reduce((acc, a) => acc + (a.saldoInsoluto || 0), 0);

    return {
      total,
      ventasCount: ventas.length,
      abonosCount: abonos.length,
      abonosParcialesCount: abonosParciales.length,
      abonosTotalesCount: abonosTotales.length,
      pendientesCount: pendientes.length,
      aprobadosCount: aprobados.length,
      rechazadosCount: rechazados.length,
      montoTotalAbonos,
      totalSaldoInsoluto,
    };
  }, [comprobantes]);

  return (
    <div className="space-y-6 pb-12">
      {/* CABECERA PRINCIPAL */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-slate-900 text-white shadow-sm">
              <FolderArchive className="w-5 h-5 text-emerald-400" />
            </span>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                Comprobantes de Venta y Pago
              </h1>
              <p className="text-xs sm:text-sm text-slate-500">
                Auditoría, trazabilidad y emisión digital de recibos de venta inicial y recaudos de cartera
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={cargarDatos}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin text-emerald-600')} />
            <span>Actualizar</span>
          </button>
        </div>
      </div>

      {/* NOTIFICACIÓN FLOTANTE / FEEDBACK */}
      {feedbackDescarga && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center justify-between animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{feedbackDescarga}</span>
          </div>
          <button
            onClick={() => setFeedbackDescarga(null)}
            className="text-emerald-700 hover:text-emerald-900 font-bold ml-2 text-sm cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* KPI CARDS RESUMEN */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Comprobantes</span>
            <Layers className="w-4 h-4 text-slate-400" />
          </div>
          <p className="text-2xl font-bold text-slate-900">{metricas.total}</p>
          <span className="text-[11px] text-slate-400 mt-1">Registros consolidados</span>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-emerald-700 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Aprobados / Activos</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-emerald-700">{metricas.aprobadosCount}</p>
          <span className="text-[11px] text-emerald-600/80 mt-1">En cartera vigente</span>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-amber-700 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Pendientes Revisión</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-2xl font-bold text-amber-700">{metricas.pendientesCount}</p>
          <span className="text-[11px] text-amber-600/80 mt-1">Requieren supervisión</span>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-rose-700 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Rechazados</span>
            <XCircle className="w-4 h-4 text-rose-600" />
          </div>
          <p className="text-2xl font-bold text-rose-700">{metricas.rechazadosCount}</p>
          <span className="text-[11px] text-rose-600/80 mt-1">Cartera inhabilitada</span>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-sky-700 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Recibos de Abono</span>
            <Receipt className="w-4 h-4 text-sky-600" />
          </div>
          <p className="text-2xl font-bold text-sky-700">{metricas.abonosCount}</p>
          <span className="text-[11px] text-slate-500 mt-1">
            Total recaudos: {formatCOP(metricas.montoTotalAbonos)}
          </span>
        </div>
      </div>

      {/* BARRA DE BÚSQUEDA EN TIEMPO REAL Y PESTAÑAS DE FILTRO */}
      <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-4">
        {/* Input Buscador */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar en tiempo real por N° de Contrato (CTR-...), N° de Recibo (REC-...), cédula o nombre del cliente..."
            className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition-all"
          />
          {busqueda && (
            <button
              type="button"
              onClick={() => setBusqueda('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-semibold cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        {/* Pestañas de Filtrado Rápido */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-semibold">
          <button
            onClick={() => setFiltroActivo('todos')}
            className={cn(
              'px-3.5 py-2 rounded-xl transition-all whitespace-nowrap cursor-pointer',
              filtroActivo === 'todos'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
            )}
          >
            Todos ({metricas.total})
          </button>

          <button
            onClick={() => setFiltroActivo('ventas')}
            className={cn(
              'px-3.5 py-2 rounded-xl transition-all whitespace-nowrap cursor-pointer',
              filtroActivo === 'ventas'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
            )}
          >
            Ventas Iniciales ({metricas.ventasCount})
          </button>

          <button
            onClick={() => setFiltroActivo('abonos')}
            className={cn(
              'px-3.5 py-2 rounded-xl transition-all whitespace-nowrap cursor-pointer',
              filtroActivo === 'abonos'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
            )}
          >
            Recibos de Abono ({metricas.abonosCount})
          </button>

          <button
            onClick={() => setFiltroActivo('abonos_parciales')}
            className={cn(
              'px-3.5 py-2 rounded-xl transition-all whitespace-nowrap cursor-pointer',
              filtroActivo === 'abonos_parciales'
                ? 'bg-amber-800 text-white shadow-sm'
                : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
            )}
          >
            ⚠️ Abonos Parciales ({metricas.abonosParcialesCount})
          </button>

          <button
            onClick={() => setFiltroActivo('aprobados')}
            className={cn(
              'px-3.5 py-2 rounded-xl transition-all whitespace-nowrap cursor-pointer',
              filtroActivo === 'aprobados'
                ? 'bg-emerald-700 text-white shadow-sm'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            )}
          >
            Aprobados / Activos ({metricas.aprobadosCount})
          </button>

          <button
            onClick={() => setFiltroActivo('pendientes')}
            className={cn(
              'px-3.5 py-2 rounded-xl transition-all whitespace-nowrap cursor-pointer',
              filtroActivo === 'pendientes'
                ? 'bg-amber-700 text-white shadow-sm'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            )}
          >
            Pendientes / En Espera ({metricas.pendientesCount})
          </button>

          <button
            onClick={() => setFiltroActivo('rechazados')}
            className={cn(
              'px-3.5 py-2 rounded-xl transition-all whitespace-nowrap cursor-pointer',
              filtroActivo === 'rechazados'
                ? 'bg-rose-700 text-white shadow-sm'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
            )}
          >
            Rechazados ({metricas.rechazadosCount})
          </button>
        </div>
      </div>

      {/* TABLA PRINCIPAL DE COMPROBANTES */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                <th className="py-3.5 px-4">Tipo & Código</th>
                <th className="py-3.5 px-4">Fecha Emisión</th>
                <th className="py-3.5 px-4">Cliente Titular</th>
                <th className="py-3.5 px-4">Responsable</th>
                <th className="py-3.5 px-4 text-right">Valor Operación</th>
                <th className="py-3.5 px-4 text-center">Estado Aprobación</th>
                <th className="py-3.5 px-4 text-center">Descarga PDF</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
                      <span className="font-medium text-xs">Cargando comprobantes oficiales de cartera...</span>
                    </div>
                  </td>
                </tr>
              ) : comprobantesFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <FolderArchive className="w-8 h-8 text-slate-300" />
                      <p className="font-semibold text-slate-700 text-sm">No se encontraron comprobantes</p>
                      <p className="text-xs text-slate-400 max-w-sm">
                        No hay registros que coincidan con la búsqueda o el filtro aplicado.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                comprobantesFiltrados.map((item) => {
                  const isDownloading = descargandoId === item.id;

                  return (
                    <tr
                      key={`${item.tipo}-${item.id}`}
                      className="hover:bg-slate-50/80 transition-colors group"
                    >
                      {/* TIPO & CÓDIGO */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={cn(
                              'w-8 h-8 rounded-xl flex items-center justify-center shrink-0 font-bold text-xs',
                              item.tipo === 'VENTA_INICIAL'
                                ? 'bg-slate-900 text-emerald-400'
                                : 'bg-emerald-100 text-emerald-800'
                            )}
                          >
                            {item.tipo === 'VENTA_INICIAL' ? (
                              <FileText className="w-4 h-4" />
                            ) : (
                              <Receipt className="w-4 h-4" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-900 font-mono tracking-tight text-xs">
                                {item.codigo}
                              </span>
                              {item.tipo === 'VENTA_INICIAL' ? (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                                  Venta Inicial
                                </span>
                              ) : item.esAbonoParcial ? (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                                  ⚠️ Abono Parcial
                                </span>
                              ) : (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
                                  ✓ Pago Cuota Total
                                </span>
                              )}
                            </div>
                            {item.contratoRef && (
                              <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                                Ref: {item.contratoRef}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* FECHA EMISIÓN */}
                      <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{item.fechaFormateada}</span>
                        </div>
                      </td>

                      {/* CLIENTE TITULAR */}
                      <td className="py-3.5 px-4">
                        <div>
                          <p className="font-semibold text-slate-900 leading-tight">
                            {item.clienteNombre}
                          </p>
                          <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                            C.C. {item.clienteCedula}
                          </p>
                        </div>
                      </td>

                      {/* RESPONSABLE */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div>
                          <p className="font-medium text-slate-800">{item.responsableNombre}</p>
                          <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                            {item.responsableRol}
                          </span>
                        </div>
                      </td>

                      {/* VALOR OPERACIÓN */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <p className="font-bold text-slate-900 text-sm">
                          {formatCOP(item.monto)}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {item.tipo === 'VENTA_INICIAL'
                            ? item.modalidadPago
                            : `Método: ${item.modalidadPago}`}
                        </p>
                        {item.tipo === 'RECIBO_ABONO' && item.esAbonoParcial && item.saldoInsoluto && item.saldoInsoluto > 0 ? (
                          <div className="mt-1">
                            <span className="inline-block text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                              Déficit: {formatCOP(item.saldoInsoluto)} → Sig. Cuota
                            </span>
                          </div>
                        ) : null}
                      </td>

                      {/* ESTADO APROBACIÓN */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        {item.estadoTipo === 'pendiente' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200/70">
                            <Clock className="w-3 h-3 text-amber-600 animate-pulse" />
                            <span>Pendiente / En Espera</span>
                          </span>
                        )}

                        {item.estadoTipo === 'rechazado' && (
                          <div className="inline-flex flex-col items-center">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200/70">
                              <XCircle className="w-3 h-3 text-rose-600" />
                              <span>Rechazado</span>
                            </span>
                            <span className="text-[9.5px] text-rose-500 font-semibold mt-0.5">
                              Cartera Inhabilitada
                            </span>
                          </div>
                        )}

                        {item.estadoTipo === 'activo' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/70">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>Aprobado / Activo</span>
                          </span>
                        )}

                        {item.estadoTipo === 'conciliado' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/70">
                            <ShieldCheck className="w-3 h-3 text-emerald-600" />
                            <span>Conciliado en Caja</span>
                          </span>
                        )}

                        {item.estadoTipo === 'registrado' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-sky-50 text-sky-700 border border-sky-200/70">
                            <Receipt className="w-3 h-3 text-sky-600" />
                            <span>Registrado en Ruta</span>
                          </span>
                        )}

                        {item.estadoTipo === 'terminado' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                            <CheckCircle2 className="w-3 h-3 text-slate-500" />
                            <span>{item.estadoDisplay}</span>
                          </span>
                        )}

                        {item.estadoTipo === 'mora' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-orange-50 text-orange-700 border border-orange-200">
                            <AlertCircle className="w-3 h-3 text-orange-600" />
                            <span>En Mora</span>
                          </span>
                        )}
                      </td>

                      {/* ACCIÓN: BOTÓN DIRECTO DESCARGAR PDF */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <div className="flex flex-col items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleDescargarPdf(item)}
                            disabled={isDownloading}
                            title={item.nombreArchivoPdf}
                            className={cn(
                              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs transition-all shadow-sm cursor-pointer',
                              item.esRechazado
                                ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                                : item.tipo === 'VENTA_INICIAL'
                                ? 'bg-slate-900 text-white hover:bg-slate-800'
                                : item.esAbonoParcial
                                ? 'bg-amber-700 text-white hover:bg-amber-800'
                                : 'bg-emerald-700 text-white hover:bg-emerald-800'
                            )}
                          >
                            {isDownloading ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
                                <span>Generando...</span>
                              </>
                            ) : (
                              <>
                                <Download className="w-3.5 h-3.5" />
                                <span>
                                  {item.tipo === 'VENTA_INICIAL'
                                    ? 'PDF Venta'
                                    : item.esAbonoParcial
                                    ? 'PDF Parcial'
                                    : 'PDF Cuota'}
                                </span>
                              </>
                            )}
                          </button>
                          <span
                            className="text-[9.5px] text-slate-400 font-mono max-w-[170px] truncate block"
                            title={item.nombreArchivoPdf}
                          >
                            {item.nombreArchivoPdf}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* PIE DE TABLA / RESUMEN */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-500">
          <p>
            Mostrando <span className="font-bold text-slate-800">{comprobantesFiltrados.length}</span> de{' '}
            <span className="font-bold text-slate-800">{metricas.total}</span> comprobantes registrados
          </p>
          <p className="text-[11px] text-slate-400">
            Formato oficial estandarizado para impresión física o envío digital
          </p>
        </div>
      </div>
    </div>
  );
}
