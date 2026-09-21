'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  CreditCard,
  Plus,
  Search,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  DollarSign,
  Users,
  Wallet,
  ShieldCheck,
  ChevronDown,
  Phone,
  MapPin,
  UserCheck,
  X,
  Calendar,
  Save,
  FileText,
  Check,
} from 'lucide-react';
import { formatCOP, cn } from '@/lib/utils';
import { api } from '@/lib/api';

interface CodeudorData {
  nombre: string;
  cedula?: string | null;
  telefono?: string | null;
  direccion?: string | null;
}

interface ReferenciaData {
  nombre: string;
  telefono?: string | null;
  parentesco?: string | null;
  direccion?: string | null;
}

interface CreditoItem {
  id: string;
  contrato: string;
  clienteNombre: string;
  cedula: string;
  clienteTelefono?: string | null;
  clienteDireccion?: string | null;
  vendedor: string;
  cobrador: string | null;
  cobradorId?: string | null;
  valorTotal: number;
  saldoPendiente: number;
  valorCuota: number;
  totalCuotas: number;
  cuotasPagas: number;
  tipoCredito: 'diario' | 'semanal' | 'quincenal' | 'mensual';
  estado: 'pendiente' | 'activo' | 'terminado' | 'mora';
  fechaInicio: string;
  cuotasVencidasCount?: number;
  esCarteraCritica?: boolean;
  esContado?: boolean;
  codeudor?: CodeudorData | null;
  referencia?: ReferenciaData | null;
}

export default function CarteraCreditosPage() {
  const [creditos, setCreditos] = useState<CreditoItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<string>('todos');

  // Estado sincronizado de mora crítica oficial (Dashboard Gerencial: cuentas con >= 3 cuotas vencidas)
  const [resumenMoraCritica, setResumenMoraCritica] = useState<{
    contratosMoraCount: number;
    cuotasVencidasCount: number;
    saldoInsolutoMora: number;
    porcentajeRiesgo: number;
  } | null>(null);

  const [expandedGarantiasId, setExpandedGarantiasId] = useState<string | null>(null);
  const [cobradoresDisponibles, setCobradoresDisponibles] = useState<{ id: string; nombre: string }[]>([]);
  const [asignandoId, setAsignandoId] = useState<string | null>(null);

  // Estado para el Expediente Detallado (Modal / Drawer)
  const [selectedCreditoExpediente, setSelectedCreditoExpediente] = useState<CreditoItem | null>(null);
  const [isExpedienteOpen, setIsExpedienteOpen] = useState(false);
  const [activeTabExpediente, setActiveTabExpediente] = useState<'amortizacion' | 'garantias' | 'reasignacion'>('amortizacion');
  const [isLoadingExpediente, setIsLoadingExpediente] = useState(false);
  const [cronogramaDetallado, setCronogramaDetallado] = useState<
    Array<{
      numero: number;
      fecha_vencimiento: string;
      valor_cuota: number;
      valor_base?: number;
      valor_exigible?: number;
      valor_pagado?: number;
      saldo_cuota?: number;
      monto_arrastrado?: number;
      pagada?: boolean;
      es_parcial?: boolean;
      estado: 'pagada' | 'pendiente' | 'mora' | 'parcial';
    }>
  >([]);

  // Formularios de edición para el supervisor dentro del expediente
  const [formCodeudor, setFormCodeudor] = useState({
    nombre: '',
    cedula: '',
    telefono: '',
    direccion: '',
  });
  const [formReferencia, setFormReferencia] = useState({
    nombre: '',
    telefono: '',
    parentesco: '',
    direccion: '',
  });
  const [selectedCobradorExpediente, setSelectedCobradorExpediente] = useState<string>('');
  const [isSavingGarantias, setIsSavingGarantias] = useState(false);
  const [isSavingCobrador, setIsSavingCobrador] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isDescargandoPdf, setIsDescargandoPdf] = useState(false);

  const handleDescargarReciboPdf = async (contratoId: string) => {
    if (!contratoId) return;
    try {
      setIsDescargandoPdf(true);
      const res = await api.get(`/creditos/${contratoId}/recibo-pdf`, {
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Recibo_Venta_${contratoId.slice(0, 8).toUpperCase()}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Error al descargar recibo digital en PDF:', error);
      alert('No fue posible generar el recibo en PDF para este crédito.');
    } finally {
      setIsDescargandoPdf(false);
    }
  };

  // Abrir Expediente Detallado de un crédito
  const handleAbrirExpediente = async (item: CreditoItem) => {
    setSelectedCreditoExpediente(item);
    setIsExpedienteOpen(true);
    setActiveTabExpediente('amortizacion');
    setSaveFeedback(null);
    setSelectedCobradorExpediente(item.cobradorId || '');

    setFormCodeudor({
      nombre: item.codeudor?.nombre || '',
      cedula: item.codeudor?.cedula || '',
      telefono: item.codeudor?.telefono || '',
      direccion: item.codeudor?.direccion || '',
    });
    setFormReferencia({
      nombre: item.referencia?.nombre || '',
      telefono: item.referencia?.telefono || '',
      parentesco: item.referencia?.parentesco || 'Familiar',
      direccion: item.referencia?.direccion || '',
    });

    setIsLoadingExpediente(true);
    try {
      const res = await api.get(`/creditos/${item.id}`);
      if (res.data) {
        const fullCredito = res.data;
        const totalFinanciado = Number(fullCredito.monto_financiado || item.valorTotal);
        const saldo = Number(fullCredito.saldo_pendiente ?? item.saldoPendiente);
        const valorCuota = Number(fullCredito.valor_cuota || item.valorCuota);
        const amortizado = Math.max(0, totalFinanciado - saldo);
        const cuotasPagas = valorCuota > 0 ? Math.floor(amortizado / valorCuota) : item.cuotasPagas;
        const todayStr = new Date().toISOString().split('T')[0];

        let cronograma = [];
        if (Array.isArray(fullCredito.cronograma_cuotas) && fullCredito.cronograma_cuotas.length > 0) {
          cronograma = fullCredito.cronograma_cuotas.map((c: any) => {
            const isPagada = Boolean(c.pagada || c.estado === 'pagada');
            const isParcial = Boolean(c.es_parcial || c.estado === 'parcial');
            const isMora = !isPagada && !isParcial && (c.estado === 'vencida' || (c.fecha_vencimiento && c.fecha_vencimiento < todayStr));
            return {
              numero: c.numero,
              fecha_vencimiento: c.fecha_vencimiento,
              valor_cuota: Number(c.valor_exigible || c.valor_cuota || valorCuota),
              valor_base: Number(c.valor_base || c.valor_cuota || valorCuota),
              valor_exigible: Number(c.valor_exigible || c.valor_cuota || valorCuota),
              valor_pagado: Number(c.valor_pagado || 0),
              saldo_cuota: Number(c.saldo_cuota || 0),
              monto_arrastrado: Number(c.monto_arrastrado || 0),
              pagada: isPagada,
              es_parcial: isParcial,
              estado: isPagada
                ? ('pagada' as const)
                : isParcial
                ? ('parcial' as const)
                : isMora
                ? ('mora' as const)
                : ('pendiente' as const),
            };
          });
        } else {
          const numCuotas = Number(fullCredito.numero_cuotas || item.totalCuotas || 1);
          for (let i = 1; i <= numCuotas; i++) {
            const isPagada = i <= cuotasPagas;
            cronograma.push({
              numero: i,
              fecha_vencimiento: item.fechaInicio,
              valor_cuota: valorCuota,
              valor_base: valorCuota,
              valor_exigible: valorCuota,
              valor_pagado: isPagada ? valorCuota : 0,
              saldo_cuota: isPagada ? 0 : valorCuota,
              monto_arrastrado: 0,
              pagada: isPagada,
              es_parcial: false,
              estado: isPagada ? ('pagada' as const) : ('pendiente' as const),
            });
          }
        }
        setCronogramaDetallado(cronograma);

        if (fullCredito.codeudor) {
          setFormCodeudor({
            nombre: fullCredito.codeudor.nombre || '',
            cedula: fullCredito.codeudor.cedula || '',
            telefono: fullCredito.codeudor.telefono || '',
            direccion: fullCredito.codeudor.direccion || '',
          });
        }
        if (fullCredito.referencia) {
          setFormReferencia({
            nombre: fullCredito.referencia.nombre || '',
            telefono: fullCredito.referencia.telefono || '',
            parentesco: fullCredito.referencia.parentesco || 'Familiar',
            direccion: fullCredito.referencia.direccion || '',
          });
        }
        if (fullCredito.cobrador?.id) {
          setSelectedCobradorExpediente(fullCredito.cobrador.id);
        }
      }
    } catch (err) {
      console.warn('Error al cargar cronograma del crédito:', err);
      const numCuotas = item.totalCuotas || 1;
      const cList = [];
      for (let i = 1; i <= numCuotas; i++) {
        cList.push({
          numero: i,
          fecha_vencimiento: item.fechaInicio,
          valor_cuota: item.valorCuota,
          estado: i <= item.cuotasPagas ? ('pagada' as const) : ('pendiente' as const),
        });
      }
      setCronogramaDetallado(cList);
    } finally {
      setIsLoadingExpediente(false);
    }
  };

  // Guardar cambios de codeudor y referencia familiar por el supervisor
  const handleGuardarGarantias = async () => {
    if (!selectedCreditoExpediente) return;
    setIsSavingGarantias(true);
    setSaveFeedback(null);
    try {
      const payload = {
        codeudor: {
          nombre: formCodeudor.nombre.trim(),
          cedula: formCodeudor.cedula.trim() || null,
          telefono: formCodeudor.telefono.trim() || null,
          direccion: formCodeudor.direccion.trim() || null,
        },
        referencia: {
          nombre: formReferencia.nombre.trim(),
          telefono: formReferencia.telefono.trim() || null,
          parentesco: formReferencia.parentesco.trim() || 'Familiar',
          direccion: formReferencia.direccion.trim() || null,
        },
      };

      await api.patch(`/creditos/${selectedCreditoExpediente.id}`, payload);

      const updatedCodeudor = payload.codeudor.nombre ? payload.codeudor : null;
      const updatedRef = payload.referencia.nombre ? payload.referencia : null;

      setSelectedCreditoExpediente((prev) =>
        prev ? { ...prev, codeudor: updatedCodeudor, referencia: updatedRef } : null
      );

      setCreditos((prev) =>
        prev.map((c) =>
          c.id === selectedCreditoExpediente.id
            ? { ...c, codeudor: updatedCodeudor, referencia: updatedRef }
            : c
        )
      );

      setSaveFeedback({
        type: 'success',
        message: 'Garantías y datos de respaldo actualizados exitosamente en el servidor.',
      });
    } catch (err: any) {
      console.error('Error guardando garantías:', err);
      setSaveFeedback({
        type: 'error',
        message: err.response?.data?.detail || 'No se pudieron guardar las modificaciones.',
      });
    } finally {
      setIsSavingGarantias(false);
    }
  };

  // Reasignación permanente de cobrador desde el expediente
  const handleReasignarCobradorExpediente = async () => {
    if (!selectedCreditoExpediente || !selectedCobradorExpediente) return;
    setIsSavingCobrador(true);
    setSaveFeedback(null);
    try {
      await api.patch(`/creditos/${selectedCreditoExpediente.id}`, {
        cobrador_id: selectedCobradorExpediente,
      });

      const cobradorObj = cobradoresDisponibles.find((c) => c.id === selectedCobradorExpediente);
      const nombreCob = cobradorObj?.nombre || 'Cobrador Reasignado';

      setSelectedCreditoExpediente((prev) =>
        prev ? { ...prev, cobrador: nombreCob, cobradorId: selectedCobradorExpediente } : null
      );

      setCreditos((prev) =>
        prev.map((c) =>
          c.id === selectedCreditoExpediente.id
            ? { ...c, cobrador: nombreCob, cobradorId: selectedCobradorExpediente }
            : c
        )
      );

      setSaveFeedback({
        type: 'success',
        message: `Crédito reasignado permanentemente a la ruta de ${nombreCob}.`,
      });
    } catch (err: any) {
      console.error('Error reasignando cobrador:', err);
      setSaveFeedback({
        type: 'error',
        message: err.response?.data?.detail || 'No se pudo reasignar el cobrador.',
      });
    } finally {
      setIsSavingCobrador(false);
    }
  };

  // Cargar lista de cobradores disponibles para asignación de ruta
  const cargarCobradores = async () => {
    try {
      const res = await api.get('/usuarios?rol=cobrador');
      if (Array.isArray(res.data)) {
        setCobradoresDisponibles(res.data.map((u: any) => ({ id: u.id, nombre: u.nombre })));
      }
    } catch {
      // Ignorar si falla la carga auxiliar
    }
  };

  // Cargar créditos desde el backend FastAPI sincronizando con el resumen gerencial
  const cargarCreditos = async () => {
    setIsLoading(true);
    try {
      // Sincronizar simultáneamente la lista de créditos y las métricas oficiales de mora crítica
      const [resCreditos, resResumen] = await Promise.allSettled([
        api.get('/creditos'),
        api.get('/reportes/resumen-gerencial'),
      ]);

      if (resResumen.status === 'fulfilled' && resResumen.value?.data?.cartera_en_mora) {
        const cem = resResumen.value.data.cartera_en_mora;
        setResumenMoraCritica({
          contratosMoraCount: Number(cem.contratos_criticos_count ?? cem.contratos_mora_count ?? 0),
          cuotasVencidasCount: Number(cem.cuotas_vencidas_count || 0),
          saldoInsolutoMora: Number(cem.saldo_insoluto_mora || 0),
          porcentajeRiesgo: Number(cem.porcentaje_riesgo || 0),
        });
      }

      if (resCreditos.status === 'fulfilled' && Array.isArray(resCreditos.value.data)) {
        const mapeados: CreditoItem[] = resCreditos.value.data.map((c: any) => {
          const valorTotal = Number(c.monto_financiado || 0) + Number(c.cuota_inicial || 0);
          const saldoPendiente = Number(c.saldo_pendiente || 0);
          const valorCuota = Number(c.valor_cuota || 0);
          const numeroCuotas = Number(c.numero_cuotas || 0);

          let cuotasPagas = 0;
          if (valorCuota > 0) {
            const amortizado = Math.max(0, Number(c.monto_financiado || 0) - saldoPendiente);
            cuotasPagas = Math.min(numeroCuotas, Math.round(amortizado / valorCuota));
          }

          const rawCodeudor = c.codeudor || c.cliente?.codeudor || null;
          const rawRef = c.referencia || c.cliente?.referencia_familiar || null;

          const cuotasVencidasCount = Number(c.cuotas_vencidas_count || 0);
          const esCritica = Boolean(
            c.es_cartera_critica || (numeroCuotas > 2 && cuotasVencidasCount >= 3 && saldoPendiente > 0)
          );

          const tipoVentaStr = String(c.tipo_venta || '').toLowerCase();
          const tipoPagoStr = String(c.tipo_pago || '').toLowerCase();
          const montoFinanciadoNum = Number(c.monto_financiado || 0);
          const cuotaInicialNum = Number(c.cuota_inicial || 0);

          // Determinar si es Venta de Contado o liquidado al 100% de contado
          const esContado = Boolean(
            c.es_contado ||
            tipoVentaStr === 'contado' ||
            tipoPagoStr === 'contado' ||
            montoFinanciadoNum === 0 ||
            (numeroCuotas <= 1 && saldoPendiente === 0 && (cuotaInicialNum > 0 || montoFinanciadoNum === 0)) ||
            (saldoPendiente === 0 && cuotasPagas === 0 && cuotaInicialNum >= valorTotal && valorTotal > 0)
          );

          let estadoFinal: 'pendiente' | 'activo' | 'terminado' | 'mora' = c.estado || 'activo';
          if (c.estado !== 'pendiente' && c.estado !== 'terminado') {
            if (esCritica || c.estado === 'mora') {
              estadoFinal = 'mora';
            }
          }

          return {
            id: c.id_contrato,
            contrato: `CTR-${c.id_contrato.slice(0, 8).toUpperCase()}`,
            clienteNombre: c.cliente?.nombres || 'Cliente Titular',
            cedula: c.cliente?.cedula || 'S/N',
            clienteTelefono: c.cliente?.telefono || null,
            clienteDireccion: c.cliente?.direccion || null,
            vendedor: c.vendedor?.nombre || 'Juan Vendedor',
            cobrador: c.cobrador?.nombre || null,
            cobradorId: c.cobrador?.id || null,
            valorTotal,
            saldoPendiente,
            valorCuota,
            totalCuotas: numeroCuotas,
            cuotasPagas,
            tipoCredito: c.tipo_pago || 'diario',
            estado: estadoFinal,
            fechaInicio: c.fecha_primera_cuota || '2026-03-01',
            cuotasVencidasCount,
            esCarteraCritica: esCritica,
            esContado,
            codeudor: rawCodeudor ? {
              nombre: rawCodeudor.nombre || '',
              cedula: rawCodeudor.cedula || null,
              telefono: rawCodeudor.telefono || null,
              direccion: rawCodeudor.direccion || null,
            } : null,
            referencia: rawRef ? {
              nombre: rawRef.nombre || '',
              telefono: rawRef.telefono || null,
              parentesco: rawRef.parentesco || 'Familiar',
              direccion: rawRef.direccion || null,
            } : null,
          };
        });
        setCreditos(mapeados);
      }
    } catch {
      setCreditos([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Asignar cobrador a un crédito aprobado directamente desde Cartera
  const handleAsignarCobrador = async (creditoId: string, cobradorId: string) => {
    setAsignandoId(creditoId);
    try {
      await api.patch(`/creditos/${creditoId}`, { cobrador_id: cobradorId });
      const cobradorObj = cobradoresDisponibles.find((c) => c.id === cobradorId);
      setCreditos((prev) =>
        prev.map((c) =>
          c.id === creditoId
            ? { ...c, cobrador: cobradorObj?.nombre || 'Cobrador Asignado', cobradorId }
            : c
        )
      );
    } catch (err: any) {
      console.error('Error asignando cobrador:', err);
      alert('No se pudo asignar el cobrador al crédito.');
    } finally {
      setAsignandoId(null);
    }
  };

  useEffect(() => {
    cargarCreditos();
    cargarCobradores();
  }, []);

  // KPIs dinámicos calculados a partir de los créditos reales y sincronizados con Resumen Gerencial
  const kpis = useMemo(() => {
    const totalFinanciado = creditos.reduce((acc, c) => acc + c.valorTotal, 0);
    const totalSaldo = creditos.reduce((acc, c) => acc + c.saldoPendiente, 0);
    const activos = creditos.filter((c) => c.estado === 'activo' || c.estado === 'mora').length;

    // Conteo exacto de mora crítica (cuentas con >= 3 cuotas vencidas y saldo pendiente)
    const moraCalculadaLocal = creditos.filter(
      (c) => c.esCarteraCritica || (c.totalCuotas > 2 && (c.cuotasVencidasCount || 0) >= 3 && c.saldoPendiente > 0)
    ).length;

    const mora = resumenMoraCritica !== null
      ? resumenMoraCritica.contratosMoraCount
      : moraCalculadaLocal;

    return {
      totalFinanciado,
      totalSaldo,
      activos,
      mora,
    };
  }, [creditos, resumenMoraCritica]);

  const creditosFiltrados = creditos.filter((c) => {
    const coincideTexto =
      c.contrato.toLowerCase().includes(busqueda.toLowerCase()) ||
      c.clienteNombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      c.cedula.includes(busqueda);

    if (filtroEstado === 'todos') return coincideTexto;
    if (filtroEstado === 'mora') return coincideTexto && (c.estado === 'mora' || c.esCarteraCritica);
    if (filtroEstado === 'activo') return coincideTexto && (c.estado === 'activo' && !c.esCarteraCritica);
    return coincideTexto && c.estado === filtroEstado;
  });

  return (
    <div className="space-y-8">
      {/* CABECERA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Cartera de Créditos
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Supervisión integral de contratos, estados de pago y saldos pendientes.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => cargarCreditos()}
            className="p-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            title="Sincronizar cartera"
          >
            <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
          </button>

          <Link
            href="/dashboard/pos"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold shadow-xs transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Nuevo Crédito POS</span>
          </Link>
        </div>
      </div>

      {/* KPIS DE CARTERA (EN CEROS CUANDO NO HAY CRÉDITOS) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Total Cartera
            </span>
            <span className="text-xl font-bold text-slate-900 mt-1 block">
              {formatCOP(kpis.totalFinanciado)}
            </span>
            <span className="text-[11px] text-slate-400 mt-0.5 block">
              {creditos.length} contrato{creditos.length !== 1 ? 's' : ''} registrado{creditos.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200/60 flex items-center justify-center">
            <DollarSign className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Saldo por Cobrar
            </span>
            <span className="text-xl font-bold text-slate-900 mt-1 block">
              {formatCOP(kpis.totalSaldo)}
            </span>
            <span className="text-[11px] text-slate-400 mt-0.5 block">
              Pendiente de recaudo
            </span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-700 border border-blue-200/60 flex items-center justify-center">
            <Wallet className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Contratos Activos
            </span>
            <span className="text-xl font-bold text-slate-900 mt-1 block">
              {kpis.activos}
            </span>
            <span className="text-[11px] text-slate-400 mt-0.5 block">
              En ruta de cobranza
            </span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Contratos en Mora
            </span>
            <span className="text-xl font-bold text-rose-700 mt-1 block">
              {kpis.mora}
            </span>
            <span className="text-[11px] text-slate-500 mt-0.5 block">
              {resumenMoraCritica?.cuotasVencidasCount
                ? `${resumenMoraCritica.cuotasVencidasCount} cuotas vencidas (≥3 cuotas)`
                : 'Mora crítica (≥3 cuotas)'}
            </span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-rose-50 text-rose-700 border border-rose-200/60 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* FILTROS Y BÚSQUEDA */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative w-full md:w-96">
          <Search className="w-4 h-4 text-slate-600 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por contrato, cliente o cédula..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl text-sm bg-slate-50 border border-slate-200 text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-slate-900"
          />
        </div>

        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-full md:w-auto overflow-x-auto">
          {['todos', 'activo', 'pendiente', 'mora', 'terminado'].map((st) => (
            <button
              key={st}
              onClick={() => setFiltroEstado(st)}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all cursor-pointer shrink-0',
                filtroEstado === st
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              {st === 'todos' ? 'Todos' : st}
            </button>
          ))}
        </div>
      </div>

      {/* TABLA DE CARTERA */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[1200px]">
            <thead className="bg-slate-50/75 border-b border-slate-100 text-slate-600 uppercase font-semibold">
              <tr>
                <th className="px-5 py-3.5 min-w-[105px]">Contrato</th>
                <th className="px-5 py-3.5 min-w-[160px]">Cliente</th>
                <th className="px-5 py-3.5 min-w-[110px]">Modalidad</th>
                <th className="pl-4 pr-6 py-3.5 min-w-[130px] text-right">Valor Venta</th>
                <th className="pl-4 pr-6 py-3.5 min-w-[135px] text-right">Saldo Pendiente</th>
                <th className="pl-5 pr-4 py-3.5 min-w-[160px] text-left border-l border-slate-200/80">Progreso</th>
                <th className="px-5 py-3.5 min-w-[190px]">Cobrador</th>
                <th className="px-5 py-3.5 min-w-[95px] text-right">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {creditosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-14 text-center">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                      <CreditCard className="w-10 h-10 text-slate-300 mb-3" />
                      <h3 className="text-sm font-bold text-slate-800">
                        {busqueda || filtroEstado !== 'todos'
                          ? 'Sin coincidencias'
                          : 'No hay contratos de crédito'}
                      </h3>
                      <p className="text-xs text-slate-500 mt-1">
                        {busqueda || filtroEstado !== 'todos'
                          ? 'No se encontraron contratos con los criterios especificados.'
                          : 'No existen operaciones de crédito en este momento. Los créditos originados desde el POS web o móvil se listarán aquí tras su aprobación.'}
                      </p>
                      <Link
                        href="/dashboard/pos"
                        className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-all shadow-xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Originar Nuevo Crédito (POS)</span>
                      </Link>
                    </div>
                  </td>
                </tr>
              ) : (
                creditosFiltrados.map((item) => {
                  const porcentajePago =
                    item.esContado
                      ? 100
                      : item.valorTotal > 0
                      ? Math.round(
                          ((item.valorTotal - item.saldoPendiente) / item.valorTotal) * 100
                        )
                      : 0;

                  return (
                    <React.Fragment key={item.id}>
                      <tr className={cn("hover:bg-slate-50/50 transition-colors", expandedGarantiasId === item.id && "bg-emerald-50/20")}>
                        <td className="px-6 py-4">
                          <button
                            type="button"
                            onClick={() => handleAbrirExpediente(item)}
                            className="font-mono font-bold text-emerald-700 hover:text-emerald-900 hover:underline cursor-pointer text-left block"
                            title="Abrir expediente completo del crédito"
                          >
                            {item.contrato}
                          </button>
                        </td>

                        <td className="px-6 py-4">
                          <button
                            type="button"
                            onClick={() => handleAbrirExpediente(item)}
                            className="font-semibold text-slate-900 hover:text-emerald-700 hover:underline text-sm block text-left cursor-pointer"
                            title="Abrir expediente completo del crédito"
                          >
                            {item.clienteNombre}
                          </button>
                          <span className="text-[11px] text-slate-600 block">CC: {item.cedula}</span>
                          
                          {/* Botón Acordeón de Garantías y Respaldo */}
                          <button
                            type="button"
                            onClick={() => setExpandedGarantiasId(expandedGarantiasId === item.id ? null : item.id)}
                            className={cn(
                              "mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all border cursor-pointer",
                              expandedGarantiasId === item.id
                                ? "bg-emerald-700 text-white border-emerald-800 shadow-xs"
                                : "bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200/90"
                            )}
                            title="Desplegar datos de codeudor solidario y referencia familiar"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>Garantías y Respaldo</span>
                            <ChevronDown className={cn("w-3 h-3 transition-transform", expandedGarantiasId === item.id && "rotate-180")} />
                          </button>
                        </td>

                        <td className="px-6 py-4">
                          <span className="font-medium text-slate-800 capitalize">
                            {item.esContado ? 'Contado' : item.tipoCredito}
                          </span>
                          <span className="text-[11px] text-slate-600 block">
                            {item.esContado ? 'Pago único' : `Cuota: ${formatCOP(item.valorCuota)}`}
                          </span>
                        </td>

                        <td className="pl-4 pr-6 py-4 font-mono font-semibold text-slate-900 whitespace-nowrap text-right min-w-[130px]">
                          {formatCOP(item.valorTotal)}
                        </td>

                        <td className="pl-4 pr-6 py-4 font-mono font-bold text-slate-900 whitespace-nowrap text-right min-w-[135px]">
                          {formatCOP(item.saldoPendiente)}
                        </td>

                        <td className="pl-5 pr-4 py-4 whitespace-nowrap border-l border-slate-200/80 min-w-[160px]">
                          <div className="w-28">
                            <div className="flex justify-between text-[10px] font-semibold text-slate-600 mb-1">
                              <span>
                                {item.esContado ? '1/1' : `${item.cuotasPagas}/${item.totalCuotas}`}
                              </span>
                              <span className="font-bold">{porcentajePago}%</span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className={cn(
                                  'h-full rounded-full',
                                  (item.estado === 'mora' || item.esCarteraCritica) ? 'bg-rose-500' : 'bg-slate-900'
                                )}
                                style={{ width: `${porcentajePago}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-4 min-w-[190px]">
                          {item.esContado ? (
                            <div className="flex items-center gap-1.5">
                              <span
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-slate-100/90 text-slate-500 border border-slate-200/80 cursor-default select-none shadow-2xs"
                                title="Operación de contado: no requiere gestión de cobro en calle ni ruta asignada"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                                N/A - Venta de Contado
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <select
                                value={item.cobradorId || ''}
                                disabled={asignandoId === item.id}
                                onChange={(e) => {
                                  if (e.target.value) {
                                    handleAsignarCobrador(item.id, e.target.value);
                                  }
                                }}
                                className={cn(
                                  "text-[11px] font-semibold rounded-lg px-2 py-1 border transition-colors cursor-pointer max-w-[150px] truncate",
                                  item.cobradorId
                                    ? "bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100"
                                    : "bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200"
                                )}
                                title={item.cobrador ? `Cobrador permanente: ${item.cobrador} (Haz clic para reasignar)` : "Asignar cobrador a la ruta"}
                              >
                                <option value="" disabled>
                                  + Asignar Cobrador
                                </option>
                                {cobradoresDisponibles.map((cob) => (
                                  <option key={cob.id} value={cob.id}>
                                    {cob.nombre}
                                  </option>
                                ))}
                              </select>
                              {asignandoId === item.id ? (
                                <RefreshCw className="w-3 h-3 text-amber-600 animate-spin shrink-0" />
                              ) : item.cobradorId ? (
                                <span
                                  className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 shrink-0"
                                  title="Asignación permanente fija para todas las cuotas"
                                >
                                  Fijo
                                </span>
                              ) : null}
                            </div>
                          )}
                        </td>

                        <td className="px-6 py-4 text-right whitespace-nowrap">
                          {item.estado === 'activo' && !item.esCarteraCritica && (
                            <span className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60 leading-none align-middle shadow-2xs">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                              <span className="leading-none">Al Día</span>
                            </span>
                          )}
                          {item.estado === 'pendiente' && (
                            <span className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/60 leading-none align-middle shadow-2xs">
                              <Clock className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                              <span className="leading-none">Pendiente</span>
                            </span>
                          )}
                          {(item.estado === 'mora' || item.esCarteraCritica) && (
                            <span
                              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200/60 leading-none align-middle shadow-2xs"
                              title={`Mora crítica: ${item.cuotasVencidasCount || 3} cuotas vencidas`}
                            >
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
                              <span className="leading-none">En Mora {item.cuotasVencidasCount ? `(${item.cuotasVencidasCount} c.)` : ''}</span>
                            </span>
                          )}
                          {item.estado === 'terminado' && (
                            <span className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 leading-none align-middle shadow-2xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                              <span className="leading-none">Terminado</span>
                            </span>
                          )}
                        </td>
                      </tr>

                      {/* SECCIÓN DESPLEGABLE / ACORDEÓN: GARANTÍAS Y RESPALDO */}
                      {expandedGarantiasId === item.id && (
                        <tr className="bg-slate-50/80 border-y border-emerald-200/80">
                          <td colSpan={8} className="px-6 py-4">
                            <div className="bg-white rounded-2xl border border-emerald-200/90 p-5 shadow-xs space-y-4">
                              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                                    <ShieldCheck className="w-5 h-5 text-emerald-700" />
                                  </div>
                                  <div>
                                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                                      Garantías y Respaldo • {item.contrato}
                                    </h4>
                                    <p className="text-[11px] text-slate-500 mt-0.5">
                                      Información verificada de respaldo para el crédito titular de <strong className="text-slate-700">{item.clienteNombre}</strong>
                                    </p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setExpandedGarantiasId(null)}
                                  className="text-xs text-slate-500 hover:text-slate-800 font-semibold px-2.5 py-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                                >
                                  ✕ Cerrar
                                </button>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* PANEL 1: CODEUDOR SOLIDARIO */}
                                <div className="p-4 rounded-xl bg-slate-50/90 border border-slate-200/90 space-y-3">
                                  <div className="flex items-center justify-between">
                                    <span className="inline-flex items-center gap-2 text-xs font-bold text-slate-900 uppercase tracking-wide">
                                      <UserCheck className="w-4 h-4 text-emerald-600" />
                                      Codeudor Solidario
                                    </span>
                                    {item.codeudor?.nombre ? (
                                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full border border-emerald-200">
                                        ✓ Registrado
                                      </span>
                                    ) : (
                                      <span className="text-[10px] font-semibold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">
                                        No registrado
                                      </span>
                                    )}
                                  </div>

                                  {item.codeudor?.nombre ? (
                                    <div className="space-y-2 text-xs">
                                      <div className="flex justify-between items-center py-1 border-b border-slate-200/50">
                                        <span className="text-slate-500 font-medium">Nombre Completo:</span>
                                        <span className="font-bold text-slate-900 text-right">{item.codeudor.nombre}</span>
                                      </div>
                                      <div className="flex justify-between items-center py-1 border-b border-slate-200/50">
                                        <span className="text-slate-500 font-medium">Cédula:</span>
                                        <span className="font-mono text-slate-800 font-semibold">{item.codeudor.cedula || 'No registrada'}</span>
                                      </div>
                                      <div className="flex justify-between items-center py-1 border-b border-slate-200/50">
                                        <span className="text-slate-500 font-medium">Teléfono:</span>
                                        {item.codeudor.telefono ? (
                                          <a
                                            href={`tel:${item.codeudor.telefono.replace(/\s+/g, '')}`}
                                            className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-800 font-bold hover:underline bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 transition-colors"
                                            title="Llamar al codeudor"
                                          >
                                            <Phone className="w-3 h-3" />
                                            <span>{item.codeudor.telefono}</span>
                                          </a>
                                        ) : (
                                          <span className="text-slate-400 italic">No registrado</span>
                                        )}
                                      </div>
                                      <div className="flex justify-between items-start gap-2 py-1">
                                        <span className="text-slate-500 font-medium shrink-0 flex items-center gap-1">
                                          <MapPin className="w-3 h-3 text-slate-400" />
                                          Dirección:
                                        </span>
                                        <span className="text-slate-800 text-right font-medium">{item.codeudor.direccion || 'No registrada'}</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="text-xs text-slate-500 italic py-2">
                                      No se registró codeudor solidario para esta operación.
                                    </p>
                                  )}
                                </div>

                                {/* PANEL 2: REFERENCIA FAMILIAR O PERSONAL */}
                                <div className="p-4 rounded-xl bg-slate-50/90 border border-slate-200/90 space-y-3">
                                  <div className="flex items-center justify-between">
                                    <span className="inline-flex items-center gap-2 text-xs font-bold text-slate-900 uppercase tracking-wide">
                                      <Users className="w-4 h-4 text-blue-600" />
                                      Referencia Familiar / Personal
                                    </span>
                                    {item.referencia?.nombre ? (
                                      <span className="text-[10px] font-bold text-blue-700 bg-blue-100 px-2.5 py-0.5 rounded-full border border-blue-200">
                                        {item.referencia.parentesco || 'Familiar'}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] font-semibold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">
                                        No registrada
                                      </span>
                                    )}
                                  </div>

                                  {item.referencia?.nombre ? (
                                    <div className="space-y-2 text-xs">
                                      <div className="flex justify-between items-center py-1 border-b border-slate-200/50">
                                        <span className="text-slate-500 font-medium">Nombre:</span>
                                        <span className="font-bold text-slate-900 text-right">{item.referencia.nombre}</span>
                                      </div>
                                      <div className="flex justify-between items-center py-1 border-b border-slate-200/50">
                                        <span className="text-slate-500 font-medium">Parentesco:</span>
                                        <span className="font-semibold text-slate-800">{item.referencia.parentesco || 'Familiar'}</span>
                                      </div>
                                      <div className="flex justify-between items-center py-1 border-b border-slate-200/50">
                                        <span className="text-slate-500 font-medium">Teléfono:</span>
                                        {item.referencia.telefono ? (
                                          <a
                                            href={`tel:${item.referencia.telefono.replace(/\s+/g, '')}`}
                                            className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-800 font-bold hover:underline bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200 transition-colors"
                                            title="Llamar a la referencia"
                                          >
                                            <Phone className="w-3 h-3" />
                                            <span>{item.referencia.telefono}</span>
                                          </a>
                                        ) : (
                                          <span className="text-slate-400 italic">No registrado</span>
                                        )}
                                      </div>
                                      {item.referencia.direccion ? (
                                        <div className="flex justify-between items-start gap-2 py-1">
                                          <span className="text-slate-500 font-medium shrink-0 flex items-center gap-1">
                                            <MapPin className="w-3 h-3 text-slate-400" />
                                            Dirección:
                                          </span>
                                          <span className="text-slate-800 text-right font-medium">{item.referencia.direccion}</span>
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : (
                                    <p className="text-xs text-slate-500 italic py-2">
                                      No se registró referencia familiar para esta operación.
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* EXPEDIENTE INTEGRAL DE CRÉDITO (MODAL / DRAWER SUPERVISOR)               */}
      {/* ========================================================================= */}
      {isExpedienteOpen && selectedCreditoExpediente && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            
            {/* CABECERA DEL EXPEDIENTE */}
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold tracking-tight">Expediente Integral de Crédito</h3>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      {selectedCreditoExpediente.contrato}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Titular: <strong className="text-white">{selectedCreditoExpediente.clienteNombre}</strong> (CC: {selectedCreditoExpediente.cedula}) • Asesor: {selectedCreditoExpediente.vendedor}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isDescargandoPdf}
                  onClick={() => handleDescargarReciboPdf(selectedCreditoExpediente.id)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
                  title="Descargar o imprimir el Recibo Oficial de Venta en formato PDF"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>{isDescargandoPdf ? 'Generando...' : 'Recibo PDF'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsExpedienteOpen(false)}
                  className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                  title="Cerrar expediente"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* BARRA DE RESUMEN FINANCIERO */}
            <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-2.5 bg-white rounded-xl border border-slate-200 shadow-xs">
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Monto Total</span>
                <span className="text-sm font-bold font-mono text-slate-900">{formatCOP(selectedCreditoExpediente.valorTotal)}</span>
              </div>
              <div className="p-2.5 bg-white rounded-xl border border-slate-200 shadow-xs">
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Saldo Pendiente</span>
                <span className="text-sm font-bold font-mono text-emerald-700">{formatCOP(selectedCreditoExpediente.saldoPendiente)}</span>
              </div>
              <div className="p-2.5 bg-white rounded-xl border border-slate-200 shadow-xs">
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Cuota Pactada</span>
                <span className="text-sm font-bold font-mono text-slate-900">
                  {formatCOP(selectedCreditoExpediente.valorCuota)}
                  <span className="text-[10px] text-slate-500 font-normal ml-1 capitalize">({selectedCreditoExpediente.tipoCredito})</span>
                </span>
              </div>
              <div className="p-2.5 bg-white rounded-xl border border-slate-200 shadow-xs">
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Cobrador en Ruta</span>
                <span className="text-xs font-bold text-slate-800 truncate block">
                  {selectedCreditoExpediente.esContado
                    ? 'N/A - Venta de Contado'
                    : (selectedCreditoExpediente.cobrador || 'Sin Asignar')}
                </span>
              </div>
            </div>

            {/* PESTAÑAS DE NAVEGACIÓN */}
            <div className="px-6 bg-white border-b border-slate-200 flex gap-2">
              <button
                type="button"
                onClick={() => setActiveTabExpediente('amortizacion')}
                className={cn(
                  "py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer",
                  activeTabExpediente === 'amortizacion'
                    ? "border-emerald-600 text-emerald-700 bg-emerald-50/50"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                )}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Plan de Amortización</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-100 text-slate-600 font-semibold">
                  {cronogramaDetallado.length} cuotas
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTabExpediente('garantias')}
                className={cn(
                  "py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer",
                  activeTabExpediente === 'garantias'
                    ? "border-emerald-600 text-emerald-700 bg-emerald-50/50"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                )}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Garantías y Respaldo</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-800 font-bold">
                  Editable
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTabExpediente('reasignacion')}
                className={cn(
                  "py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer",
                  activeTabExpediente === 'reasignacion'
                    ? "border-emerald-600 text-emerald-700 bg-emerald-50/50"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                )}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Reasignación de Ruta</span>
              </button>
            </div>

            {/* MENSAJE DE FEEDBACK (ÉXITO / ERROR) */}
            {saveFeedback && (
              <div
                className={cn(
                  "mx-6 mt-4 p-3 rounded-xl border flex items-center justify-between text-xs font-semibold",
                  saveFeedback.type === 'success'
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : "bg-rose-50 border-rose-200 text-rose-800"
                )}
              >
                <div className="flex items-center gap-2">
                  {saveFeedback.type === 'success' ? <Check className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-rose-600" />}
                  <span>{saveFeedback.message}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSaveFeedback(null)}
                  className="text-slate-400 hover:text-slate-600 font-bold"
                >
                  ✕
                </button>
              </div>
            )}

            {/* CONTENIDO PRINCIPAL POR PESTAÑA */}
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              
              {/* PESTAÑA 1: PLAN DE AMORTIZACIÓN */}
              {activeTabExpediente === 'amortizacion' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">Cronograma de Vencimientos y Pagos</h4>
                      <p className="text-xs text-slate-500">
                        Amortización proyectada de {selectedCreditoExpediente.totalCuotas} cuotas {selectedCreditoExpediente.tipoCredito}s.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200 font-semibold">
                        ✓ Pagada ({cronogramaDetallado.filter(c => c.estado === 'pagada').length})
                      </span>
                      {cronogramaDetallado.some(c => c.estado === 'parcial') && (
                        <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200 font-semibold">
                          🟡 Abono Parcial ({cronogramaDetallado.filter(c => c.estado === 'parcial').length})
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-rose-700 bg-rose-50 px-2.5 py-1 rounded-md border border-rose-200 font-semibold">
                        ⚠️ En Mora ({cronogramaDetallado.filter(c => c.estado === 'mora').length})
                      </span>
                      <span className="inline-flex items-center gap-1 text-slate-700 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200 font-semibold">
                        ⏳ Pendiente ({cronogramaDetallado.filter(c => c.estado === 'pendiente').length})
                      </span>
                    </div>
                  </div>

                  {isLoadingExpediente ? (
                    <div className="py-12 flex flex-col items-center justify-center text-slate-500 gap-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
                      <span className="text-xs font-medium">Cargando cronograma oficial...</span>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider font-bold text-[10px] border-b border-slate-200">
                          <tr>
                            <th className="px-4 py-3"># Cuota</th>
                            <th className="px-4 py-3">Vencimiento Programado</th>
                            <th className="px-4 py-3 text-right">Valor Cuota</th>
                            <th className="px-4 py-3 text-right">Estado de Pago</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-medium">
                          {cronogramaDetallado.map((c) => {
                            const isParcial = c.estado === 'parcial';
                            const hasArrastre = c.estado !== 'pagada' && (c.monto_arrastrado ?? 0) > 0;

                            return (
                              <tr
                                key={c.numero}
                                className={cn(
                                  "hover:bg-slate-50/50 transition-colors",
                                  c.estado === 'pagada' && "bg-emerald-50/15",
                                  isParcial && "bg-amber-50/20",
                                  c.estado === 'mora' && "bg-rose-50/15"
                                )}
                              >
                                <td className="px-4 py-2.5 font-bold font-mono text-slate-900">
                                  Cuota {c.numero} de {cronogramaDetallado.length}
                                </td>
                                <td className="px-4 py-2.5 text-slate-700 font-mono">
                                  {c.fecha_vencimiento || '--'}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-900">
                                  {isParcial ? (
                                    <div className="flex flex-col items-end">
                                      <span>Exigible: {formatCOP(c.valor_cuota)}</span>
                                      <span className="text-[10px] text-amber-700 font-normal">
                                        (Abonado: {formatCOP(c.valor_pagado || 0)} | Faltan: {formatCOP(c.saldo_cuota || 0)})
                                      </span>
                                    </div>
                                  ) : hasArrastre ? (
                                    <div className="flex flex-col items-end">
                                      <span className="text-rose-700">{formatCOP(c.valor_cuota)}</span>
                                      <span className="text-[10px] text-rose-600 font-normal">
                                        (+{formatCOP(c.monto_arrastrado || 0)} arrastrado)
                                      </span>
                                    </div>
                                  ) : (
                                    formatCOP(c.valor_cuota)
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-right">
                                  {c.estado === 'pagada' && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                      ✓ Pagada
                                    </span>
                                  )}
                                  {isParcial && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                      🟡 Abono Parcial
                                    </span>
                                  )}
                                  {c.estado === 'mora' && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                                      ⚠️ En Mora
                                    </span>
                                  )}
                                  {c.estado === 'pendiente' && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                      ⏳ Pendiente
                                    </span>
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
              )}

              {/* PESTAÑA 2: GARANTÍAS Y RESPALDO (EDITABLE POR EL SUPERVISOR) */}
              {activeTabExpediente === 'garantias' && (
                <div className="space-y-6">
                  <div className="p-3 bg-emerald-50/80 border border-emerald-200/80 rounded-xl text-xs text-emerald-800 flex items-start gap-2.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Actualización de Garantías Solidarias y Contactos</p>
                      <p className="text-[11px] text-emerald-700 mt-0.5">
                        Como supervisor autorizado, puedes actualizar los datos del codeudor y de la referencia familiar para garantizar la contactabilidad permanente en caso de mora o contingencia.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* TARJETA EDITABLE: CODEUDOR SOLIDARIO */}
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                        <span className="inline-flex items-center gap-2 text-xs font-bold text-slate-900 uppercase">
                          <UserCheck className="w-4 h-4 text-emerald-600" />
                          Codeudor Solidario
                        </span>
                        {formCodeudor.telefono && (
                          <a
                            href={`tel:${formCodeudor.telefono.replace(/\s+/g, '')}`}
                            className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-bold hover:underline"
                            title="Llamar directamente"
                          >
                            <Phone className="w-3 h-3" />
                            <span>Llamar</span>
                          </a>
                        )}
                      </div>

                      <div className="space-y-2.5 text-xs">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">NOMBRE COMPLETO</label>
                          <input
                            type="text"
                            value={formCodeudor.nombre}
                            onChange={(e) => setFormCodeudor({ ...formCodeudor, nombre: e.target.value })}
                            placeholder="Ej. Carlos Mendoza"
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 font-medium focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-xs"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">CÉDULA DE CIUDADANÍA</label>
                          <input
                            type="text"
                            value={formCodeudor.cedula}
                            onChange={(e) => setFormCodeudor({ ...formCodeudor, cedula: e.target.value })}
                            placeholder="Ej. 1067890123"
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-xs"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">TELÉFONO DE CONTACTO</label>
                          <input
                            type="tel"
                            value={formCodeudor.telefono}
                            onChange={(e) => setFormCodeudor({ ...formCodeudor, telefono: e.target.value })}
                            placeholder="Ej. 3105556677"
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 font-medium focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-xs"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">DIRECCIÓN DOMICILIARIA</label>
                          <input
                            type="text"
                            value={formCodeudor.direccion}
                            onChange={(e) => setFormCodeudor({ ...formCodeudor, direccion: e.target.value })}
                            placeholder="Ej. Calle 24 # 12-40, Barrio Centro"
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 font-medium focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-xs"
                          />
                        </div>
                      </div>
                    </div>

                    {/* TARJETA EDITABLE: REFERENCIA FAMILIAR */}
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                        <span className="inline-flex items-center gap-2 text-xs font-bold text-slate-900 uppercase">
                          <Users className="w-4 h-4 text-blue-600" />
                          Referencia Familiar / Personal
                        </span>
                        {formReferencia.telefono && (
                          <a
                            href={`tel:${formReferencia.telefono.replace(/\s+/g, '')}`}
                            className="inline-flex items-center gap-1 text-[11px] text-blue-700 font-bold hover:underline"
                            title="Llamar directamente"
                          >
                            <Phone className="w-3 h-3" />
                            <span>Llamar</span>
                          </a>
                        )}
                      </div>

                      <div className="space-y-2.5 text-xs">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">NOMBRE COMPLETO</label>
                          <input
                            type="text"
                            value={formReferencia.nombre}
                            onChange={(e) => setFormReferencia({ ...formReferencia, nombre: e.target.value })}
                            placeholder="Ej. María Gómez"
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-xs"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">PARENTESCO / VÍNCULO</label>
                          <input
                            type="text"
                            value={formReferencia.parentesco}
                            onChange={(e) => setFormReferencia({ ...formReferencia, parentesco: e.target.value })}
                            placeholder="Ej. Hermana / Primo / Amigo"
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-xs"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">TELÉFONO DE CONTACTO</label>
                          <input
                            type="tel"
                            value={formReferencia.telefono}
                            onChange={(e) => setFormReferencia({ ...formReferencia, telefono: e.target.value })}
                            placeholder="Ej. 3128889900"
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-xs"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">DIRECCIÓN (OPCIONAL)</label>
                          <input
                            type="text"
                            value={formReferencia.direccion}
                            onChange={(e) => setFormReferencia({ ...formReferencia, direccion: e.target.value })}
                            placeholder="Ej. Carrera 5 # 18-30"
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* BOTÓN PARA GUARDAR MODIFICACIONES DE RESPALDO */}
                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={handleGuardarGarantias}
                      disabled={isSavingGarantias}
                      className={cn(
                        "inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white transition-all shadow-sm cursor-pointer",
                        isSavingGarantias
                          ? "bg-slate-400 cursor-not-allowed"
                          : "bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99]"
                      )}
                    >
                      {isSavingGarantias ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Guardando Modificaciones...</span>
                        </>
                      ) : (
                        <>
                          <Save className="w-3.5 h-3.5" />
                          <span>Guardar Cambios de Respaldo</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* PESTAÑA 3: REASIGNACIÓN DE COBRADOR Y RUTA */}
              {activeTabExpediente === 'reasignacion' && (
                <div className="space-y-5 max-w-xl">
                  {selectedCreditoExpediente.esContado ? (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 space-y-2">
                      <div className="flex items-center gap-2 font-bold text-slate-800">
                        <span className="w-2 h-2 rounded-full bg-slate-400" />
                        Operación de Contado Liquidada
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Este contrato corresponde a una Venta de Contado liquidada al 100% al momento de su originación. No requiere asignación de gestor de cobro ni gestión operativa en ruta de calle.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="p-3 bg-amber-50/80 border border-amber-200/80 rounded-xl text-xs text-amber-800 flex items-start gap-2.5">
                        <UserCheck className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold">Reasignación Permanente de Cobrador y Ruta</p>
                          <p className="text-[11px] text-amber-700 mt-0.5">
                            Al reasignar este crédito, el nuevo cobrador heredará de forma fija la cobranza de todas las cuotas pendientes de este contrato en su ruta móvil.
                          </p>
                        </div>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-4">
                        <div>
                          <span className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Cobrador Actual del Contrato</span>
                          <div className="flex items-center gap-2 p-2.5 bg-white rounded-lg border border-slate-200 text-xs font-semibold text-slate-800">
                            <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center font-bold text-[10px] text-slate-700">
                              👤
                            </div>
                            <span>{selectedCreditoExpediente.cobrador || 'Sin cobrador asignado'}</span>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1.5">
                            Seleccionar Nuevo Cobrador / Ruta
                          </label>
                          <select
                            value={selectedCobradorExpediente}
                            onChange={(e) => setSelectedCobradorExpediente(e.target.value)}
                            className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-800 font-semibold text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 cursor-pointer"
                          >
                            <option value="" disabled>-- Seleccione un cobrador disponible --</option>
                            {cobradoresDisponibles.map((cob) => (
                              <option key={cob.id} value={cob.id}>
                                {cob.nombre}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="pt-2">
                          <button
                            type="button"
                            onClick={handleReasignarCobradorExpediente}
                            disabled={isSavingCobrador || !selectedCobradorExpediente || selectedCobradorExpediente === selectedCreditoExpediente.cobradorId}
                            className={cn(
                              "w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-white transition-all shadow-sm cursor-pointer",
                              isSavingCobrador || !selectedCobradorExpediente || selectedCobradorExpediente === selectedCreditoExpediente.cobradorId
                                ? "bg-slate-300 cursor-not-allowed"
                                : "bg-slate-900 hover:bg-slate-800 active:scale-[0.99]"
                            )}
                          >
                            {isSavingCobrador ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                <span>Reasignando Ruta...</span>
                              </>
                            ) : (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>Confirmar y Guardar Asignación</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

            </div>

            {/* PIE DEL MODAL */}
            <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">
                Contrato registrado el {selectedCreditoExpediente.fechaInicio}
              </span>
              <button
                type="button"
                onClick={() => setIsExpedienteOpen(false)}
                className="px-4 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold transition-colors cursor-pointer"
              >
                Cerrar
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
