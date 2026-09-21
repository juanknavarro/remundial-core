'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  TrendingUp,
  Banknote,
  AlertTriangle,
  Users,
  ArrowUpRight,
  ArrowDownRight,
  Download,
  CreditCard,
  CheckCircle2,
  Clock,
  MapPin,
  RefreshCw,
  Activity,
  Plus,
  ShieldCheck,
  Wallet,
  Package,
  Sparkles,
  X,
  AlertCircle,
} from 'lucide-react';
import { formatCOP, cn } from '@/lib/utils';
import { api } from '@/lib/api';

interface OperacionReciente {
  id: string;
  contrato: string;
  cliente: string;
  tipo: string;
  responsable: string;
  valor: number;
  sector: string;
  estado: string;
  fecha: Date;
  esAbono: boolean;
}

export default function MasterDashboardPage() {
  const [creditos, setCreditos] = useState<any[]>([]);
  const [abonos, setAbonos] = useState<any[]>([]);
  const [productos, setProductos] = useState<any[]>([]);
  const [resumen, setResumen] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Estados para reabastecimiento rápido desde el Dashboard Gerencial
  const [productoAReabastecer, setProductoAReabastecer] = useState<any | null>(null);
  const [reabastecerCantidad, setReabastecerCantidad] = useState<string>('10');
  const [reabastecerMotivo, setReabastecerMotivo] = useState<string>('Reposición desde Dashboard Gerencial');
  const [isReabasteciendo, setIsReabasteciendo] = useState<boolean>(false);
  const [modalReabastecerOpen, setModalReabastecerOpen] = useState<boolean>(false);
  const [stockNotice, setStockNotice] = useState<string | null>(null);

  // Cargar datos reales desde los endpoints FastAPI
  const cargarDatosDashboard = async () => {
    try {
      const [resResumen, resCreditos, resAbonos, resProductos] = await Promise.allSettled([
        api.get('/reportes/resumen-gerencial'),
        api.get('/creditos'),
        api.get('/abonos'),
        api.get('/productos'),
      ]);

      if (resResumen.status === 'fulfilled' && resResumen.value?.data) {
        setResumen(resResumen.value.data);
      }

      if (resCreditos.status === 'fulfilled' && Array.isArray(resCreditos.value.data)) {
        setCreditos(resCreditos.value.data);
      } else {
        setCreditos([]);
      }

      if (resAbonos.status === 'fulfilled' && Array.isArray(resAbonos.value.data)) {
        setAbonos(resAbonos.value.data);
      } else {
        setAbonos([]);
      }

      if (resProductos.status === 'fulfilled' && Array.isArray(resProductos.value.data)) {
        setProductos(resProductos.value.data);
      } else {
        setProductos([]);
      }
    } catch (err) {
      console.error('Error consultando métricas del dashboard:', err);
      setCreditos([]);
      setAbonos([]);
      setProductos([]);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleConfirmarReabastecer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productoAReabastecer) return;
    const cant = parseInt(reabastecerCantidad, 10);
    if (isNaN(cant) || cant <= 0) {
      alert('La cantidad debe ser mayor a 0');
      return;
    }
    setIsReabasteciendo(true);
    try {
      const res = await api.post(`/productos/${productoAReabastecer.id}/reabastecer`, {
        cantidad: cant,
        motivo: reabastecerMotivo || 'Reposición desde Dashboard Gerencial',
      });
      setStockNotice(res.data?.mensaje || `Se han ingresado ${cant} unidades a ${productoAReabastecer.nombre}.`);
      setModalReabastecerOpen(false);
      cargarDatosDashboard();
      setTimeout(() => setStockNotice(null), 6000);
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Error al reabastecer inventario.');
    } finally {
      setIsReabasteciendo(false);
    }
  };

  useEffect(() => {
    cargarDatosDashboard();
  }, []);

  const handleRefresh = () => {
    setIsRefreshing(true);
    cargarDatosDashboard();
  };

  // =========================================================================
  // CÁLCULO DINÁMICO DE KPIS GERENCIALES
  // =========================================================================
  const metrics = useMemo(() => {
    // 1. Dinero total colocado (Créditos aprobados, activos o terminados)
    const creditosColocados = creditos.filter(
      (c) => c.estado !== 'anulado' && c.estado !== 'pendiente'
    );
    const totalColocado =
      resumen?.total_colocado ??
      creditosColocados.reduce(
        (sum, c) => sum + (Number(c.monto_financiado || 0) + Number(c.cuota_inicial || 0)),
        0
      );
    const totalCreditosColocados =
      resumen?.total_creditos_colocados ?? creditosColocados.length;
    const saldoTotalCartera =
      resumen?.saldo_total_cartera ??
      creditosColocados.reduce((sum, c) => sum + Number(c.saldo_pendiente || 0), 0);

    // 2. Recaudos del día (Abonos registrados en la fecha actual)
    const hoyStr = new Date().toISOString().split('T')[0];
    const abonosHoy = abonos.filter((a) => {
      if (!a.fecha || a.estado === 'anulado') return false;
      const abonoFechaStr = new Date(a.fecha).toISOString().split('T')[0];
      return abonoFechaStr === hoyStr;
    });
    const totalRecaudosHoy =
      resumen?.total_recaudado_hoy ??
      abonosHoy.reduce((sum, a) => sum + Number(a.valor_abonado || 0), 0);
    const countAbonosHoy = resumen?.count_abonos_hoy ?? abonosHoy.length;

    // 3. Cartera en mora (saldo insoluto de cuotas con estado 'vencida')
    let totalMora = 0;
    let countMora = 0;
    let totalCuotasVencidas = 0;
    let contratosCriticosCount = 0;
    let saldoCarteraCritica = 0;

    if (resumen?.cartera_en_mora) {
      totalMora = Number(resumen.cartera_en_mora.saldo_insoluto_mora || 0);
      countMora = Number(resumen.cartera_en_mora.contratos_mora_count || 0);
      totalCuotasVencidas = Number(resumen.cartera_en_mora.cuotas_vencidas_count || 0);
      contratosCriticosCount = Number(resumen.cartera_en_mora.contratos_criticos_count || 0);
      saldoCarteraCritica = Number(resumen.cartera_en_mora.saldo_cartera_critica || 0);
    } else {
      // Cálculo local preciso inspeccionando el cronograma de cuotas de cada crédito
      creditos.forEach((c) => {
        if (c.estado === 'pendiente' || Number(c.saldo_pendiente || 0) <= 0) return;

        let saldoVencidoContrato = 0;
        let cuotasVencidasContrato = 0;

        if (Array.isArray(c.cronograma_cuotas) && c.cronograma_cuotas.length > 0) {
          c.cronograma_cuotas.forEach((q: any) => {
            if (q.estado === 'vencida') {
              cuotasVencidasContrato += 1;
              saldoVencidoContrato += Number(q.saldo_cuota ?? q.valor_exigible ?? 0);
            }
          });
        } else if (c.cuotas_vencidas_count && c.cuotas_vencidas_count > 0) {
          cuotasVencidasContrato = Number(c.cuotas_vencidas_count);
          saldoVencidoContrato = Math.min(
            Number(c.saldo_pendiente || 0),
            Number(c.valor_cuota || 0) * cuotasVencidasContrato
          );
        }

        if (cuotasVencidasContrato > 0) {
          countMora += 1;
          totalCuotasVencidas += cuotasVencidasContrato;
          totalMora += saldoVencidoContrato;
        }

        if (c.es_cartera_critica || (c.numero_cuotas > 2 && cuotasVencidasContrato >= 3)) {
          contratosCriticosCount += 1;
          saldoCarteraCritica += Number(c.saldo_pendiente || 0);
        }
      });
    }

    const porcentajeRiesgo =
      resumen?.cartera_en_mora?.porcentaje_riesgo ??
      (saldoTotalCartera > 0
        ? Number(((totalMora / saldoTotalCartera) * 100).toFixed(2))
        : 0);

    // 4. Créditos activos y pendientes
    const creditosActivos = creditos.filter((c) => c.estado === 'activo');
    const creditosPendientes = creditos.filter((c) => c.estado === 'pendiente');
    const countActivos = resumen?.creditos_activos_count ?? creditosActivos.length;
    const countPendientes = resumen?.creditos_pendientes_count ?? creditosPendientes.length;

    // 5. Cobrador líder hoy
    let cobradorLider = resumen?.cobrador_lider || null;
    if (!cobradorLider) {
      const recaudosPorCobrador: Record<string, { nombre: string; total: number; cobros: number }> = {};
      abonosHoy.forEach((a) => {
        const cobradorId = a.cobrador_id || 'desconocido';
        const cobradorNombre = a.cobrador?.nombre || 'Cobrador en Ruta';
        if (!recaudosPorCobrador[cobradorId]) {
          recaudosPorCobrador[cobradorId] = { nombre: cobradorNombre, total: 0, cobros: 0 };
        }
        recaudosPorCobrador[cobradorId].total += Number(a.valor_abonado || 0);
        recaudosPorCobrador[cobradorId].cobros += 1;
      });

      const listaCobradores = Object.values(recaudosPorCobrador);
      listaCobradores.sort((a, b) => b.total - a.total);
      cobradorLider = listaCobradores.length > 0 ? listaCobradores[0] : null;
    }

    // 6. Composición de cartera por modalidad
    const totalCarteraFinanciada = creditos.reduce(
      (sum, c) => sum + Number(c.monto_financiado || 0),
      0
    );

    const modalidades = {
      quincenal:
        resumen?.modalidades?.quincenal ??
        creditos
          .filter((c) => c.tipo_pago === 'quincenal')
          .reduce((sum, c) => sum + Number(c.monto_financiado || 0), 0),
      mensual:
        resumen?.modalidades?.mensual ??
        creditos
          .filter((c) => c.tipo_pago === 'mensual')
          .reduce((sum, c) => sum + Number(c.monto_financiado || 0), 0),
    };

    const pctQuincenal =
      resumen?.modalidades?.pct_quincenal ??
      (totalCarteraFinanciada > 0 ? Math.round((modalidades.quincenal / totalCarteraFinanciada) * 100) : 0);
    const pctMensual =
      resumen?.modalidades?.pct_mensual ??
      (totalCarteraFinanciada > 0 ? Math.round((modalidades.mensual / totalCarteraFinanciada) * 100) : 0);

    // 7. Monitoreo de Inventario y Alertas de Stock
    const productosConStock = productos.filter((p) => p.maneja_stock !== false && p.estado_activo !== false);
    const productosAgotados = productosConStock.filter((p) => (p.stock ?? 0) <= 0);
    const productosBajoStock = productosConStock.filter(
      (p) => (p.stock ?? 0) > 0 && (p.stock ?? 0) <= 5
    );
    const productosCuadros = productos.filter((p) => p.maneja_stock === false && p.estado_activo !== false);
    const totalAlertasInventario = productosAgotados.length + productosBajoStock.length;

    return {
      totalColocado,
      totalCreditosColocados,
      saldoTotalCartera,
      totalRecaudosHoy,
      countAbonosHoy,
      totalMora,
      countMora,
      totalCuotasVencidas,
      porcentajeRiesgo,
      contratosCriticosCount,
      saldoCarteraCritica,
      countActivos,
      countPendientes,
      cobradorLider,
      modalidades,
      pctQuincenal,
      pctMensual,
      totalCarteraFinanciada,
      // Inventario
      productosConStock,
      productosAgotados,
      productosBajoStock,
      productosCuadros,
      totalAlertasInventario,
    };
  }, [creditos, abonos, productos, resumen]);

  // =========================================================================
  // ACTIVIDAD RECIENTE UNIFICADA (ABONOS + CRÉDITOS REALES)
  // =========================================================================
  const operacionesRecientes = useMemo(() => {
    const listado: OperacionReciente[] = [];

    // Abonos
    abonos.forEach((a) => {
      listado.push({
        id: `abono-${a.id_recibo}`,
        contrato: a.credito_id ? `CTR-${a.credito_id.slice(0, 8).toUpperCase()}` : 'CTR-RECIBO',
        cliente: a.cliente_nombre || 'Cliente Titular',
        tipo: 'Abono de Cuota',
        responsable: a.cobrador?.nombre || 'Pedro Cobrador',
        valor: Number(a.valor_abonado || 0),
        sector: 'Ruta de Cobro',
        estado: a.estado === 'conciliado' ? 'conciliado' : 'completado',
        fecha: new Date(a.fecha || a.creado_en || Date.now()),
        esAbono: true,
      });
    });

    // Créditos
    creditos.forEach((c) => {
      listado.push({
        id: `credito-${c.id_contrato}`,
        contrato: `CTR-${c.id_contrato.slice(0, 8).toUpperCase()}`,
        cliente: c.cliente?.nombres || 'Cliente Titular',
        tipo: c.estado === 'pendiente' ? 'Solicitud de Crédito' : 'Venta Originada',
        responsable: c.vendedor?.nombre || 'Juan Vendedor',
        valor: Number(c.monto_financiado || 0) + Number(c.cuota_inicial || 0),
        sector: c.cliente?.barrio || c.cliente?.ciudad || 'Punto de Venta',
        estado: c.estado,
        fecha: new Date(c.creado_en || Date.now()),
        esAbono: false,
      });
    });

    // Ordenar de más reciente a más antiguo
    listado.sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
    return listado.slice(0, 10);
  }, [creditos, abonos]);

  return (
    <div className="space-y-8">
      {/* CABECERA GERENCIAL */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Resumen Gerencial
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Consolidado financiero, colocación de cartera y auditoría en tiempo real.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleRefresh}
            className="p-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            title="Sincronizar métricas con la base de datos"
          >
            <RefreshCw className={cn('w-4 h-4', (isLoading || isRefreshing) && 'animate-spin')} />
          </button>

          <Link
            href="/dashboard/pos"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>+ Nueva Venta POS</span>
          </Link>
        </div>
      </div>

      {/* 4 TARJETAS DE KPIS SUPERIORES (DINÁMICOS Y CONECTADOS AL BACKEND) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* KPI 1: Dinero Total Colocado */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs relative overflow-hidden group">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Dinero Total Colocado
            </span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200/60 flex items-center justify-center">
              <Banknote className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight font-mono">
            {formatCOP(metrics.totalColocado)}
          </div>
          <div className="flex items-center gap-2 mt-3 text-xs">
            <span
              className={cn(
                'inline-flex items-center font-semibold px-2 py-0.5 rounded-full text-[11px]',
                metrics.totalColocado > 0
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                  : 'bg-slate-100 text-slate-600'
              )}
            >
              {metrics.totalColocado > 0 ? (
                <>
                  <ArrowUpRight className="w-3 h-3 mr-0.5" />
                  Activo
                </>
              ) : (
                'Base en ceros'
              )}
            </span>
            <span className="text-slate-500 truncate">
              {metrics.totalCreditosColocados} contrato
              {metrics.totalCreditosColocados !== 1 ? 's' : ''} aprobado
              {metrics.totalCreditosColocados !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* KPI 2: Recaudos del Día */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs relative overflow-hidden group">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Recaudos del Día
            </span>
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-700 border border-blue-200/60 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight font-mono">
            {formatCOP(metrics.totalRecaudosHoy)}
          </div>
          <div className="flex items-center gap-2 mt-3 text-xs">
            <span
              className={cn(
                'inline-flex items-center font-semibold px-2 py-0.5 rounded-full text-[11px]',
                metrics.totalRecaudosHoy > 0
                  ? 'bg-blue-50 text-blue-700 border border-blue-200/60'
                  : 'bg-slate-100 text-slate-600'
              )}
            >
              {metrics.totalRecaudosHoy > 0 ? (
                <>
                  <CheckCircle2 className="w-3 h-3 mr-0.5" />
                  Al día
                </>
              ) : (
                'Jornada en ceros'
              )}
            </span>
            <span className="text-slate-500 truncate">
              {metrics.countAbonosHoy} abono{metrics.countAbonosHoy !== 1 ? 's' : ''} hoy
            </span>
          </div>
        </div>

        {/* KPI 3: Cartera en Mora */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs relative overflow-hidden group">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Cartera en Mora
            </span>
            <div
              className={cn(
                'w-9 h-9 rounded-xl flex items-center justify-center',
                metrics.totalMora > 0
                  ? 'bg-rose-50 text-rose-700 border border-rose-200/60'
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
              )}
            >
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight font-mono">
            {formatCOP(metrics.totalMora)}
          </div>
          <div className="flex items-center justify-between gap-2 mt-3 text-xs">
            <div className="flex items-center gap-2 truncate">
              <span
                className={cn(
                  'inline-flex items-center font-semibold px-2 py-0.5 rounded-full text-[11px]',
                  metrics.totalMora > 0
                    ? 'bg-rose-50 text-rose-700 border border-rose-200/60'
                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                )}
              >
                {metrics.totalMora > 0 ? (
                  <>
                    <AlertTriangle className="w-3 h-3 mr-0.5" />
                    Riesgo {metrics.porcentajeRiesgo}%
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3 h-3 mr-0.5" />
                    Riesgo 0.0%
                  </>
                )}
              </span>
              <span
                className="text-slate-500 truncate"
                title={`${metrics.totalCuotasVencidas} cuotas vencidas en total`}
              >
                {metrics.countMora} contrato{metrics.countMora !== 1 ? 's' : ''} ({metrics.totalCuotasVencidas} cuota{metrics.totalCuotasVencidas !== 1 ? 's' : ''} vencida{metrics.totalCuotasVencidas !== 1 ? 's' : ''})
              </span>
            </div>

            {metrics.contratosCriticosCount > 0 && (
              <Link
                href="/dashboard/cartera-critica"
                className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:text-rose-800 shrink-0 hover:underline"
                title="Ver contratos en Cartera Crítica (≥3 cuotas vencidas)"
              >
                <span>{metrics.contratosCriticosCount} crítico{metrics.contratosCriticosCount !== 1 ? 's' : ''}</span>
                <ArrowUpRight className="w-3 h-3" />
              </Link>
            )}
          </div>
        </div>

        {/* KPI 4: Créditos Activos */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs relative overflow-hidden group">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Créditos Activos
            </span>
            <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-700 border border-purple-200/60 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight font-mono">
            {metrics.countActivos}
          </div>
          <div className="flex items-center gap-2 mt-3 text-xs">
            <span
              className={cn(
                'inline-flex items-center font-semibold px-2 py-0.5 rounded-full text-[11px]',
                metrics.countPendientes > 0
                  ? 'bg-amber-50 text-amber-700 border border-amber-200/60'
                  : 'bg-slate-100 text-slate-600'
              )}
            >
              {metrics.countPendientes > 0 ? (
                <>
                  <Clock className="w-3 h-3 mr-0.5" />
                  {metrics.countPendientes} pendiente
                  {metrics.countPendientes !== 1 ? 's' : ''}
                </>
              ) : (
                'Sin pendientes'
              )}
            </span>
            <span className="text-slate-500 truncate">
              {metrics.countActivos > 0 ? 'En ruta de recaudo' : 'Cartera limpia'}
            </span>
          </div>
        </div>
      </div>

      {/* SECCIÓN GRÁFICA Y RESUMEN FINANCIERO */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Desempeño Operativo de Recaudos */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Operaciones de Recaudo en Terreno
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Seguimiento de ingresos registrados por los cobradores
              </p>
            </div>
            <span
              className={cn(
                'text-xs font-semibold px-2.5 py-1 rounded-full border',
                metrics.totalRecaudosHoy > 0
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              )}
            >
              {metrics.totalRecaudosHoy > 0 ? 'Operación en marcha' : 'En ceros ($0)'}
            </span>
          </div>

          {/* Resumen de Estado */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                Total Recaudado Hoy
              </span>
              <span className="text-xl font-bold text-slate-900 font-mono mt-1 block">
                {formatCOP(metrics.totalRecaudosHoy)}
              </span>
              <span className="text-[11px] text-slate-500 mt-1 block">
                {metrics.countAbonosHoy} comprobante{metrics.countAbonosHoy !== 1 ? 's' : ''} emitido
                {metrics.countAbonosHoy !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                Recaudos Acumulados
              </span>
              <span className="text-xl font-bold text-slate-900 font-mono mt-1 block">
                {formatCOP(abonos.reduce((sum, a) => sum + Number(a.valor_abonado || 0), 0))}
              </span>
              <span className="text-[11px] text-slate-500 mt-1 block">
                {abonos.length} recibos históricos
              </span>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                Créditos en Ruta
              </span>
              <span className="text-xl font-bold text-slate-900 font-mono mt-1 block">
                {metrics.countActivos}
              </span>
              <span className="text-[11px] text-slate-500 mt-1 block">
                Contratos vigentes
              </span>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-500">
            <span>Sincronizado directamente con la base de datos PostgreSQL</span>
            <Link
              href="/dashboard/secretaria/conciliacion"
              className="font-medium text-slate-700 hover:text-slate-900 underline"
            >
              Ir al Arqueo y Conciliación de Rutas →
            </Link>
          </div>
        </div>

        {/* Tarjeta de Distribución de Cartera Real */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Composición de Cartera</h2>
            <p className="text-xs text-slate-600 mt-0.5">Distribución según modalidad de pago</p>

            <div className="mt-6 space-y-4">
              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span className="text-slate-700">Crédito Quincenal</span>
                  <span className="text-slate-900 font-mono">
                    {metrics.pctQuincenal}% ({formatCOP(metrics.modalidades.quincenal)})
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 rounded-full transition-all"
                    style={{ width: `${metrics.pctQuincenal}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span className="text-slate-700">Crédito Mensual</span>
                  <span className="text-slate-900 font-mono">
                    {metrics.pctMensual}% ({formatCOP(metrics.modalidades.mensual)})
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all"
                    style={{ width: `${metrics.pctMensual}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Rendimiento de cobradores líder */}
            <div className="mt-6 pt-5 border-t border-slate-100">
              <span className="text-xs font-bold text-slate-600 uppercase tracking-wider block mb-3">
                Cobrador Líder Hoy
              </span>
              {metrics.cobradorLider ? (
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs">
                      {metrics.cobradorLider.nombre.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900">
                        {metrics.cobradorLider.nombre}
                      </p>
                      <p className="text-[11px] text-slate-600">
                        {metrics.cobradorLider.cobros} recaudo
                        {metrics.cobradorLider.cobros !== 1 ? 's' : ''} hoy
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-emerald-700 font-mono">
                    {formatCOP(metrics.cobradorLider.total)}
                  </span>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-center">
                  <p className="text-xs text-slate-500">Sin recaudos registrados en la jornada.</p>
                </div>
              )}
            </div>
          </div>

          <Link
            href="/dashboard/creditos"
            className="mt-6 w-full text-center py-2.5 px-4 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors block"
          >
            Ver Detalle de Contratos →
          </Link>
        </div>
      </div>

      {/* NOTIFICACIÓN DE REABASTECIMIENTO EXITOSO */}
      {stockNotice && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center justify-between shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span className="text-xs font-semibold">{stockNotice}</span>
          </div>
          <button onClick={() => setStockNotice(null)} className="text-emerald-700 hover:text-emerald-950 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECCIÓN: MONITOR GERENCIAL DE INVENTARIO Y ALERTAS DE STOCK */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
                <Package className="w-4 h-4" />
              </div>
              <h2 className="text-base font-bold text-slate-900">
                Monitoreo de Existencias & Alertas de Inventario
              </h2>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              Control preventivo de mercancía para evitar ventas de artículos agotados o en stock crítico
            </p>
          </div>

          <div className="flex items-center gap-2">
            {metrics.totalAlertasInventario > 0 ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                {metrics.totalAlertasInventario} artículo{metrics.totalAlertasInventario !== 1 ? 's' : ''} en riesgo
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                Inventario Óptimo
              </span>
            )}

            <Link
              href="/dashboard/productos"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs transition-colors"
            >
              <span>Gestionar Catálogo</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* Tarjetas resumen de inventario */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 p-6 bg-slate-50/50 border-b border-slate-100">
          <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
              Total Físico Controlado
            </span>
            <span className="text-xl font-bold text-slate-900 font-mono mt-1 block">
              {metrics.productosConStock.length} Referencias
            </span>
            <span className="text-[11px] text-slate-500 mt-1 block">
              Muebles y mecedoras
            </span>
          </div>

          <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
            <span className="text-[11px] font-semibold text-rose-600 uppercase tracking-wider block flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              Agotados (Stock 0)
            </span>
            <span className={cn(
              "text-xl font-bold font-mono mt-1 block",
              metrics.productosAgotados.length > 0 ? "text-rose-600" : "text-slate-900"
            )}>
              {metrics.productosAgotados.length} Artículos
            </span>
            <span className="text-[11px] text-slate-500 mt-1 block">
              {metrics.productosAgotados.length > 0 ? "Bloqueados para venta en POS" : "Ninguno agotado"}
            </span>
          </div>

          <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
            <span className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider block flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              Bajo Stock (1 a 5)
            </span>
            <span className={cn(
              "text-xl font-bold font-mono mt-1 block",
              metrics.productosBajoStock.length > 0 ? "text-amber-600" : "text-slate-900"
            )}>
              {metrics.productosBajoStock.length} Artículos
            </span>
            <span className="text-[11px] text-slate-500 mt-1 block">
              Próximos a agotarse
            </span>
          </div>

          <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
            <span className="text-[11px] font-semibold text-purple-700 uppercase tracking-wider block flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" />
              Obras de Arte / Cuadros
            </span>
            <span className="text-xl font-bold text-slate-900 font-mono mt-1 block">
              {metrics.productosCuadros.length} Diseños
            </span>
            <span className="text-[11px] text-purple-700 mt-1 block font-medium">
              Por encargo (Sin stock)
            </span>
          </div>
        </div>

        {/* Lista de productos en riesgo o mensaje de inventario saludable */}
        <div className="p-6">
          {metrics.totalAlertasInventario > 0 ? (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Artículos que requieren reposición urgente de existencias:
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {[...metrics.productosAgotados, ...metrics.productosBajoStock].map((prod) => {
                  const estaAgotado = (prod.stock ?? 0) <= 0;
                  return (
                    <div
                      key={prod.id}
                      className={cn(
                        "p-4 rounded-xl border flex flex-col justify-between space-y-3 transition-all",
                        estaAgotado
                          ? "bg-rose-50/50 border-rose-200/80"
                          : "bg-amber-50/40 border-amber-200/80"
                      )}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-mono text-[10px] font-bold text-slate-600">
                            SKU: {prod.sku}
                          </span>
                          <span
                            className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                              estaAgotado
                                ? "bg-rose-100 text-rose-800 border-rose-200"
                                : "bg-amber-100 text-amber-800 border-amber-200"
                            )}
                          >
                            {estaAgotado ? "Agotado (0 disp.)" : `Bajo Stock (${prod.stock} disp.)`}
                          </span>
                        </div>
                        <h4 className="text-xs font-bold text-slate-900 line-clamp-1">
                          {prod.nombre}
                        </h4>
                        <span className="text-[11px] text-slate-600 font-mono mt-0.5 block">
                          Precio ref: {formatCOP(prod.precio_base)}
                        </span>
                      </div>

                      <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between">
                        <span className="text-[11px] text-slate-500 italic">
                          {estaAgotado ? "Ventas bloqueadas" : "Alerta preventiva"}
                        </span>
                        <button
                          onClick={() => {
                            setProductoAReabastecer(prod);
                            setReabastecerCantidad("15");
                            setReabastecerMotivo("Reposición desde Monitor Gerencial");
                            setModalReabastecerOpen(true);
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Reabastecer</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-6 rounded-xl bg-emerald-50/50 border border-emerald-200/60 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h4 className="text-xs font-bold text-emerald-950">
                  Todas las referencias estándar cuentan con existencias óptimas
                </h4>
                <p className="text-[11px] text-emerald-800 mt-0.5">
                  No se registran artículos con stock en cero ni existencias críticas en bodega. Los vendedores en campo pueden ofertar el catálogo completo sin interrupciones.
                </p>
              </div>
              <Link
                href="/dashboard/productos"
                className="shrink-0 text-xs font-semibold text-emerald-800 hover:text-emerald-950 underline"
              >
                Ver inventario →
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* MODAL DE REABASTECIMIENTO RÁPIDO DESDE DASHBOARD */}
      {modalReabastecerOpen && productoAReabastecer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl w-full max-w-md border border-slate-200 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  Entrada de Almacén (Reposición)
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Agregar unidades a "{productoAReabastecer.nombre}"
                </p>
              </div>
              <button
                onClick={() => setModalReabastecerOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmarReabastecer} className="p-6 space-y-4">
              <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-xl text-xs space-y-1">
                <div className="flex justify-between text-emerald-900 font-semibold">
                  <span>Artículo:</span>
                  <span>{productoAReabastecer.nombre}</span>
                </div>
                <div className="flex justify-between text-emerald-800">
                  <span>SKU:</span>
                  <span className="font-mono">{productoAReabastecer.sku}</span>
                </div>
                <div className="flex justify-between text-emerald-950 font-bold pt-1 border-t border-emerald-200/60">
                  <span>Stock actual:</span>
                  <span>{productoAReabastecer.stock ?? 0} unidades</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  CANTIDAD A INGRESAR (UNIDADES FÍSICAS)
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={reabastecerCantidad}
                  onChange={(e) => setReabastecerCantidad(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-600"
                  placeholder="Ej: 15"
                />

                {/* Botones rápidos de incremento */}
                <div className="flex items-center gap-1.5 mt-2">
                  {[5, 10, 20, 50].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setReabastecerCantidad(num.toString())}
                      className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold transition-colors"
                    >
                      +{num}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  MOTIVO / REFERENCIA DE ENTRADA
                </label>
                <input
                  type="text"
                  value={reabastecerMotivo}
                  onChange={(e) => setReabastecerMotivo(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900"
                  placeholder="Ej: Llegada de fábrica Montería"
                />
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200/70 rounded-xl text-xs flex justify-between items-center">
                <span className="text-slate-600">Stock resultante:</span>
                <span className="font-mono font-bold text-slate-900 text-sm">
                  {(productoAReabastecer.stock ?? 0) + (parseInt(reabastecerCantidad, 10) || 0)} unidades
                </span>
              </div>

              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalReabastecerOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isReabasteciendo}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  <span>{isReabasteciendo ? 'Guardando...' : 'Confirmar Ingreso'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TABLA DE AUDITORÍA Y ACTIVIDAD RECIENTE (CONECTADA A OPERACIONES REALES) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Actividad y Operaciones en Terreno
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Registro continuo de abonos, desembolsos y solicitudes originadas
            </p>
          </div>

          <Link
            href="/dashboard/creditos"
            className="text-xs font-semibold text-slate-900 hover:underline"
          >
            Ver todo
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/75 border-b border-slate-100 text-slate-600 uppercase font-semibold">
              <tr>
                <th className="px-6 py-3.5">Contrato</th>
                <th className="px-6 py-3.5">Cliente</th>
                <th className="px-6 py-3.5">Tipo Operación</th>
                <th className="px-6 py-3.5">Responsable</th>
                <th className="px-6 py-3.5">Monto</th>
                <th className="px-6 py-3.5">Sector</th>
                <th className="px-6 py-3.5 text-right">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {operacionesRecientes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-14 text-center">
                    <div className="flex flex-col items-center justify-center max-w-md mx-auto">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
                        <Activity className="w-6 h-6" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Sin Operaciones Registradas
                      </h3>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                        No se registran transacciones operativas en este momento. A medida que los asesores
                        originen ventas en el POS y los cobradores recauden en terreno, las
                        operaciones se sincronizarán aquí en tiempo real.
                      </p>
                      <Link
                        href="/dashboard/pos"
                        className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors shadow-xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Originar Nueva Venta en POS</span>
                      </Link>
                    </div>
                  </td>
                </tr>
              ) : (
                operacionesRecientes.map((op) => (
                  <tr key={op.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 font-mono font-bold text-slate-900">
                      {op.contrato}
                    </td>
                    <td className="px-6 py-4 font-semibold text-slate-900">
                      {op.cliente}
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {op.tipo}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-slate-900 font-semibold">{op.responsable}</span>
                      <span className="text-[11px] text-slate-500 block">
                        {op.fecha.toLocaleDateString('es-CO', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono font-bold text-slate-900">
                      {formatCOP(op.valor)}
                    </td>
                    <td className="px-6 py-4 text-slate-600 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-slate-500" />
                      <span>{op.sector}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {op.estado === 'conciliado' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/60">
                          <CheckCircle2 className="w-3 h-3" />
                          Conciliado
                        </span>
                      )}
                      {(op.estado === 'completado' || op.estado === 'registrado' || op.estado === 'activo') && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                          <CheckCircle2 className="w-3 h-3" />
                          {op.esAbono ? 'Abono Aplicado' : 'Crédito Activo'}
                        </span>
                      )}
                      {op.estado === 'pendiente' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/60">
                          <Clock className="w-3 h-3" />
                          Pendiente Supervisor
                        </span>
                      )}
                      {op.estado === 'mora' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200/60">
                          <AlertTriangle className="w-3 h-3" />
                          En Mora
                        </span>
                      )}
                      {op.estado === 'terminado' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                          Liquidado
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
