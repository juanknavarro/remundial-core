'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShieldAlert,
  Boxes,
  Archive,
  DollarSign,
  Search,
  RefreshCw,
  X,
  Check,
  CheckCircle2,
  Calendar,
  Phone,
  MapPin,
  Package,
  Download,
  FileText,
  Clock,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import { formatCOP, cn } from '@/lib/utils';
import { api, API_BASE_URL } from '@/lib/api';
import { getStoredToken } from '@/lib/auth';

interface ArticuloRetiradoItem {
  producto_id: string;
  nombre: string;
  sku?: string | null;
  cantidad: number;
  reingresado: boolean;
  fecha_reingreso?: string | null;
  reingresado_por?: string | null;
  observaciones_reingreso?: string | null;
}

interface DiligenciaRetiro {
  id_contrato: string;
  codigo_contrato: string;
  cliente_nombre: string;
  cliente_cedula: string;
  cliente_telefono?: string | null;
  cliente_direccion?: string | null;
  cobrador_nombre: string;
  fecha_acta: string;
  motivo: string;
  observaciones?: string | null;
  cuotas_vencidas: number;
  saldo_pendiente: number;
  pdf_url: string;
  articulos: ArticuloRetiradoItem[];
  tiene_firmas: boolean;
  total_articulos: number;
  articulos_reingresados_count: number;
  todos_reingresados: boolean;
}

interface ContratoCarteraCritica {
  id_contrato: string;
  codigo_contrato?: string;
  fecha_inicio?: string | null;
  creado_en?: string | null;
  tipo_pago: string;
  monto_financiado: number;
  saldo_pendiente: number;
  valor_cuota: number;
  numero_cuotas: number;
  cuotas_vencidas_count: number;
  es_cartera_critica: boolean;
  cliente?: {
    nombres: string;
    cedula: string;
    telefono?: string;
    direccion?: string;
    barrio?: string;
  };
  cobrador?: {
    id: string;
    nombre: string;
  } | null;
}

interface CobradorOption {
  id: string;
  nombre: string;
}

export default function CarteraCriticaPage() {
  const [subTab, setSubTab] = useState<'bandeja' | 'articulos_retirados'>('bandeja');
  const [contratosCriticos, setContratosCriticos] = useState<ContratoCarteraCritica[]>([]);
  const [diligenciasRetiro, setDiligenciasRetiro] = useState<DiligenciaRetiro[]>([]);
  const [cobradores, setCobradores] = useState<CobradorOption[]>([]);
  const [isLoadingCriticos, setIsLoadingCriticos] = useState<boolean>(true);
  const [isLoadingRetiros, setIsLoadingRetiros] = useState<boolean>(true);
  const [searchCriticos, setSearchCriticos] = useState<string>('');
  const [searchRetiros, setSearchRetiros] = useState<string>('');
  const [filtroCobrador, setFiltroCobrador] = useState<string>('');
  const [feedbackReingreso, setFeedbackReingreso] = useState<string | null>(null);

  // Modal de Reingreso a Inventario Comercial
  const [modalReingreso, setModalReingreso] = useState<{
    isOpen: boolean;
    id_contrato: string;
    codigo_contrato: string;
    articulo: ArticuloRetiradoItem | null;
    cantidad: number;
    condicion: string;
    observaciones: string;
  }>({
    isOpen: false,
    id_contrato: '',
    codigo_contrato: '',
    articulo: null,
    cantidad: 1,
    condicion: 'Como Nuevo / Reacondicionado',
    observaciones: '',
  });
  const [isSubmittingReingreso, setIsSubmittingReingreso] = useState<boolean>(false);

  // Carga unificada y paralela de datos en mount
  const cargarDatos = useCallback(async () => {
    setIsLoadingCriticos(true);
    setIsLoadingRetiros(true);
    try {
      const [critRes, retRes, cobRes] = await Promise.allSettled([
        api.get('/creditos/cartera-critica'),
        api.get('/creditos/articulos-retirados'),
        api.get('/usuarios?rol=cobrador'),
      ]);

      if (critRes.status === 'fulfilled' && Array.isArray(critRes.value.data)) {
        setContratosCriticos(critRes.value.data);
      }
      if (retRes.status === 'fulfilled' && Array.isArray(retRes.value.data)) {
        setDiligenciasRetiro(retRes.value.data);
      }
      if (cobRes.status === 'fulfilled' && Array.isArray(cobRes.value.data)) {
        setCobradores(cobRes.value.data.map((u: any) => ({ id: u.id, nombre: u.nombre })));
      }
    } catch (e) {
      console.error('Error cargando cartera crítica:', e);
    } finally {
      setIsLoadingCriticos(false);
      setIsLoadingRetiros(false);
    }
  }, []);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  // Descargar Acta de Restitución en PDF con token de seguridad
  const handleDescargarActaPdf = (id_contrato: string, codigo_contrato?: string) => {
    try {
      const token = getStoredToken();
      const cod = codigo_contrato || `CTR-${id_contrato.slice(0, 8).toUpperCase()}`;
      const url = `${API_BASE_URL}/creditos/${id_contrato}/acta-pdf?token=${encodeURIComponent(token || '')}`;
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.download = `Acta_Restitucion_${cod}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Error al descargar acta PDF:', err);
      window.open(`${API_BASE_URL}/creditos/${id_contrato}/acta-pdf`, '_blank');
    }
  };

  // Confirmar Reingreso de Artículo Retirado al Inventario Comercial
  const handleConfirmarReingreso = async () => {
    if (!modalReingreso.articulo || !modalReingreso.id_contrato) return;
    setIsSubmittingReingreso(true);
    try {
      const payload = {
        producto_id: modalReingreso.articulo.producto_id,
        cantidad: Number(modalReingreso.cantidad || 1),
        condicion: modalReingreso.condicion || 'Como Nuevo / Reacondicionado',
        observaciones: modalReingreso.observaciones || 'Reacondicionado y aprobado para reingreso a exhibición comercial.',
      };
      const res = await api.post(`/creditos/${modalReingreso.id_contrato}/reingresar-articulo`, payload);
      setFeedbackReingreso(res.data.mensaje || '¡Artículo reingresado a inventario comercial exitosamente!');
      setModalReingreso((prev) => ({ ...prev, isOpen: false }));
      await cargarDatos();
    } catch (error: any) {
      console.error('Error reingresando artículo:', error);
      const detail = error?.response?.data?.detail || 'No se pudo autorizar el reingreso del artículo.';
      alert(`Error al autorizar reingreso: ${detail}`);
    } finally {
      setIsSubmittingReingreso(false);
    }
  };

  // Filtros en memoria
  const contratosCriticosFiltrados = useMemo(() => {
    return contratosCriticos.filter((c) => {
      if (filtroCobrador && c.cobrador?.id !== filtroCobrador) {
        return false;
      }
      if (searchCriticos.trim()) {
        const q = searchCriticos.toLowerCase().trim();
        const nom = (c.cliente?.nombres || '').toLowerCase();
        const ced = (c.cliente?.cedula || '').toLowerCase();
        const cod = (c.codigo_contrato || `CTR-${c.id_contrato.slice(0, 8)}`).toLowerCase();
        return nom.includes(q) || ced.includes(q) || cod.includes(q);
      }
      return true;
    });
  }, [contratosCriticos, filtroCobrador, searchCriticos]);

  const diligenciasFiltradas = useMemo(() => {
    return diligenciasRetiro.filter((d) => {
      if (searchRetiros.trim()) {
        const q = searchRetiros.toLowerCase().trim();
        const nom = (d.cliente_nombre || '').toLowerCase();
        const ced = (d.cliente_cedula || '').toLowerCase();
        const cod = (d.codigo_contrato || '').toLowerCase();
        const itemMatch = d.articulos?.some((a) => a.nombre.toLowerCase().includes(q));
        return nom.includes(q) || ced.includes(q) || cod.includes(q) || itemMatch;
      }
      return true;
    });
  }, [diligenciasRetiro, searchRetiros]);

  // Métricas
  const totalCriticosSaldo = useMemo(() => {
    return contratosCriticos.reduce((acc, c) => acc + Number(c.saldo_pendiente || 0), 0);
  }, [contratosCriticos]);

  const totalArticulosRetiradosCount = useMemo(() => {
    return diligenciasRetiro.reduce((acc, d) => acc + (d.articulos?.length || 0), 0);
  }, [diligenciasRetiro]);

  const totalArticulosReingresadosCount = useMemo(() => {
    return diligenciasRetiro.reduce(
      (acc, d) => acc + (d.articulos?.filter((a) => a.reingresado).length || 0),
      0
    );
  }, [diligenciasRetiro]);

  const totalArticulosEnCustodiaCount = totalArticulosRetiradosCount - totalArticulosReingresadosCount;

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* CABECERA PRINCIPAL */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
            <span>Módulo de Supervisión</span>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-rose-700">Cartera Crítica & Retiros</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Cartera Crítica & Artículos Retirados
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Supervisión y control de créditos en mora crítica (≥3 cuotas), gestión de bienes restituidos y autorización de reingreso a stock comercial.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => cargarDatos()}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            title="Refrescar datos"
          >
            <RefreshCw
              className={cn(
                'w-3.5 h-3.5',
                (isLoadingCriticos || isLoadingRetiros) && 'animate-spin text-rose-600'
              )}
            />
            <span>Refrescar</span>
          </button>

          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-rose-50 text-rose-800 border border-rose-200/70 text-xs font-bold">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
            <span>{contratosCriticos.length} en mora crítica</span>
          </div>
        </div>
      </div>

      {/* BANNER DE RETROALIMENTACIÓN TRAS REINGRESO A STOCK */}
      {feedbackReingreso && (
        <div className="p-4 rounded-xl bg-slate-900 text-white text-xs font-medium flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg border border-slate-800 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <p className="font-semibold text-white">{feedbackReingreso}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                El stock del producto ha sido reincorporado a inventario comercial y ya se encuentra disponible para venta activa.
              </p>
            </div>
          </div>
          <button
            onClick={() => setFeedbackReingreso(null)}
            className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer rounded-lg hover:bg-slate-800"
            title="Cerrar notificación"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* TARJETAS DE MÉTRICAS CLAVE DE CARTERA CRÍTICA */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Métrica 1: Contratos en Mora Crítica */}
        <div className="p-5 rounded-2xl bg-white border border-rose-200/80 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Mora Crítica (≥3 cuotas)
              </span>
              <p className="text-2xl font-black font-mono text-rose-700 mt-1">
                {contratosCriticos.length}
              </p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5" />
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-3 pt-2.5 border-t border-slate-100 flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500"></span>
            Excluye créditos con plazo de 2 cuotas
          </p>
        </div>

        {/* Métrica 2: Saldo Total en Riesgo */}
        <div className="p-5 rounded-2xl bg-white border border-rose-200/80 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Capital en Riesgo Crítico
              </span>
              <p className="text-2xl font-black font-mono text-slate-900 mt-1">
                {formatCOP(totalCriticosSaldo)}
              </p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-3 pt-2.5 border-t border-slate-100 flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500"></span>
            Saldo pendiente total de cobro
          </p>
        </div>

        {/* Métrica 3: Artículos en Custodia Física */}
        <div className="p-5 rounded-2xl bg-white border border-amber-200/80 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Bienes en Custodia
              </span>
              <p className="text-2xl font-black font-mono text-amber-700 mt-1">
                {totalArticulosEnCustodiaCount}
              </p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Archive className="w-5 h-5" />
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-3 pt-2.5 border-t border-slate-100 flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            Retirados pendientes de reingreso
          </p>
        </div>

        {/* Métrica 4: Artículos Reingresados al Stock */}
        <div className="p-5 rounded-2xl bg-white border border-emerald-200/80 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Reingresados como Nuevo
              </span>
              <p className="text-2xl font-black font-mono text-emerald-700 mt-1">
                {totalArticulosReingresadosCount}
              </p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Boxes className="w-5 h-5" />
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-3 pt-2.5 border-t border-slate-100 flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            Reincorporados al inventario comercial
          </p>
        </div>
      </div>

      {/* SUB-PESTAÑAS DE VISTA */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          onClick={() => setSubTab('bandeja')}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-all cursor-pointer',
            subTab === 'bandeja'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          )}
        >
          <ShieldAlert className="w-4 h-4 text-rose-600" />
          <span>Bandeja de Contratos en Riesgo ({contratosCriticosFiltrados.length})</span>
        </button>

        <button
          onClick={() => setSubTab('articulos_retirados')}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition-all cursor-pointer',
            subTab === 'articulos_retirados'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          )}
        >
          <Boxes className="w-4 h-4 text-emerald-600" />
          <span>Historial de Artículos Retirados & Actas ({diligenciasFiltradas.length})</span>
        </button>
      </div>

      {/* ===================================================================== */}
      {/* SUB-VISTA A: BANDEJA DE CONTRATOS EN RIESGO (CARTERA CRÍTICA)         */}
      {/* ===================================================================== */}
      {subTab === 'bandeja' && (
        <div className="space-y-4">
          {/* FILTROS Y BÚSQUEDA */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-96">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchCriticos}
                onChange={(e) => setSearchCriticos(e.target.value)}
                placeholder="Buscar por cliente, cédula o contrato..."
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-rose-500 bg-slate-50/50 focus:bg-white transition-all"
              />
              {searchCriticos && (
                <button
                  onClick={() => setSearchCriticos('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <select
                value={filtroCobrador}
                onChange={(e) => setFiltroCobrador(e.target.value)}
                aria-label="Filtrar por cobrador"
                className="w-full sm:w-56 px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-rose-500"
              >
                <option value="">Todos los Cobradores</option>
                {cobradores.map((cob) => (
                  <option key={cob.id} value={cob.id}>
                    {cob.nombre}
                  </option>
                ))}
              </select>

              <button
                onClick={() => cargarDatos()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors cursor-pointer shrink-0"
                title="Actualizar bandeja"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', isLoadingCriticos && 'animate-spin text-rose-600')} />
                <span>Actualizar</span>
              </button>
            </div>
          </div>

          {/* TABLA DE CONTRATOS EN MORA CRÍTICA */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <span>Bandeja de Cartera Crítica</span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                    {contratosCriticosFiltrados.length} en mora grave
                  </span>
                </h3>
                <p className="text-xs text-slate-500">
                  Clientes con acumulación de 3 o más cuotas en estado vencida. Habilitados para diligencia de restitución de bienes.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/75 border-b border-slate-100 text-slate-500 uppercase font-semibold">
                  <tr>
                    <th className="px-6 py-3.5">Contrato</th>
                    <th className="px-6 py-3.5">Cliente Titular</th>
                    <th className="px-6 py-3.5">Cobrador / Ruta</th>
                    <th className="px-6 py-3.5">Plazo Pautado</th>
                    <th className="px-6 py-3.5 text-center">Mora Crítica</th>
                    <th className="px-6 py-3.5 text-right">Saldo Insoluto</th>
                    <th className="px-6 py-3.5 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {contratosCriticosFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                        {isLoadingCriticos ? (
                          <div className="flex items-center justify-center gap-2">
                            <RefreshCw className="w-4 h-4 animate-spin text-rose-600" />
                            <span>Cargando contratos en cartera crítica...</span>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <p className="font-semibold text-slate-700">No hay contratos en mora crítica con los filtros actuales.</p>
                            <p className="text-[11px] text-slate-400">Todos los créditos activos tienen un comportamiento de pago regular.</p>
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : (
                    contratosCriticosFiltrados.map((c) => {
                      const codContrato = c.codigo_contrato || `CTR-${c.id_contrato.slice(0, 8).toUpperCase()}`;
                      const diligenciaExistente = diligenciasRetiro.find(
                        (d) => d.id_contrato.toLowerCase() === c.id_contrato.toLowerCase()
                      );

                      return (
                        <tr key={c.id_contrato} className="hover:bg-slate-50/60 transition-colors">
                          {/* Contrato */}
                          <td className="px-6 py-4">
                            <span className="font-mono font-bold text-slate-900 block">
                              {codContrato}
                            </span>
                            <span className="text-[11px] text-slate-500 font-mono">
                              {c.fecha_inicio ? c.fecha_inicio.slice(0, 10) : c.creado_en ? c.creado_en.slice(0, 10) : 'Sin fecha'}
                            </span>
                          </td>

                          {/* Cliente */}
                          <td className="px-6 py-4">
                            <span className="font-bold text-slate-900 block text-xs">
                              {c.cliente?.nombres || 'Cliente Titular'}
                            </span>
                            <span className="text-[11px] text-slate-500 font-mono block">
                              CC: {c.cliente?.cedula || 'S/N'}
                            </span>
                            {c.cliente?.telefono && (
                              <a
                                href={`tel:${c.cliente.telefono}`}
                                className="text-[11px] text-blue-600 hover:underline flex items-center gap-1 mt-0.5"
                              >
                                <Phone className="w-3 h-3" />
                                <span>{c.cliente.telefono}</span>
                              </a>
                            )}
                            {c.cliente?.barrio && (
                              <span className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                                <MapPin className="w-3 h-3 shrink-0" />
                                <span className="truncate max-w-[180px]">
                                  {c.cliente.barrio} {c.cliente.direccion ? `• ${c.cliente.direccion}` : ''}
                                </span>
                              </span>
                            )}
                          </td>

                          {/* Cobrador */}
                          <td className="px-6 py-4">
                            <span className="font-bold text-slate-800 block text-xs">
                              {c.cobrador?.nombre || 'Sin Asignar'}
                            </span>
                            <span className="text-[10px] text-slate-500 uppercase">
                              {c.tipo_pago}
                            </span>
                          </td>

                          {/* Plazo Pautado */}
                          <td className="px-6 py-4">
                            <span className="font-bold text-slate-800 block text-xs">
                              {c.numero_cuotas} cuotas
                            </span>
                            <span className="text-[11px] text-slate-500 font-mono">
                              {formatCOP(c.valor_cuota)} / cuota
                            </span>
                          </td>

                          {/* Mora Crítica Badge */}
                          <td className="px-6 py-4 text-center">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
                              <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                              <span>{c.cuotas_vencidas_count} Cuotas Vencidas</span>
                            </span>
                          </td>

                          {/* Saldo Insoluto */}
                          <td className="px-6 py-4 text-right font-mono font-bold text-sm text-rose-700">
                            {formatCOP(c.saldo_pendiente)}
                          </td>

                          {/* Acción */}
                          <td className="px-6 py-4 text-right">
                            {diligenciaExistente ? (
                              <div className="flex flex-col items-end gap-1">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                  <Archive className="w-3 h-3" />
                                  Acta en Custodia
                                </span>
                                <button
                                  onClick={() => handleDescargarActaPdf(c.id_contrato, codContrato)}
                                  className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 hover:text-rose-900 transition-colors cursor-pointer"
                                  title="Descargar Acta PDF"
                                >
                                  <FileText className="w-3.5 h-3.5" />
                                  <span>Ver Acta PDF</span>
                                </button>
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 italic">
                                <Clock className="w-3 h-3" />
                                <span>Pendiente diligencia</span>
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
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUB-VISTA B: HISTORIAL DE ARTÍCULOS RETIRADOS Y DESCARGA DE ACTAS    */}
      {/* ===================================================================== */}
      {subTab === 'articulos_retirados' && (
        <div className="space-y-4">
          {/* FILTROS Y BÚSQUEDA RETIROS */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-96">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchRetiros}
                onChange={(e) => setSearchRetiros(e.target.value)}
                placeholder="Buscar por cliente, artículo o contrato..."
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-rose-500 bg-slate-50/50 focus:bg-white transition-all"
              />
              {searchRetiros && (
                <button
                  onClick={() => setSearchRetiros('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => cargarDatos()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                title="Actualizar historial"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', isLoadingRetiros && 'animate-spin text-rose-600')} />
                <span>Actualizar</span>
              </button>
            </div>
          </div>

          {/* LISTADO DE DILIGENCIAS DE RETIRO */}
          {diligenciasFiltradas.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-slate-200/80 shadow-xs max-w-lg mx-auto">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto mb-3">
                <Boxes className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Sin Diligencias de Retiro Registradas</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">
                Cuando un cobrador registre una orden de retiro con doble firma en la app móvil, el acta oficial en PDF y sus artículos restituidos aparecerán aquí.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {diligenciasFiltradas.map((dil) => {
                const todosReingresados = dil.todos_reingresados;

                return (
                  <div
                    key={dil.id_contrato}
                    className={cn(
                      'bg-white rounded-2xl p-5 sm:p-6 border shadow-xs transition-all',
                      todosReingresados
                        ? 'border-emerald-200/80 bg-emerald-50/10'
                        : 'border-slate-200/80 hover:shadow-md'
                    )}
                  >
                    {/* CABECERA DILIGENCIA */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4 mb-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-mono font-bold text-base text-slate-900">
                          {dil.codigo_contrato}
                        </span>
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-slate-100 text-slate-700">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          {dil.fecha_acta}
                        </span>
                        {todosReingresados ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            Todos Reingresados al Stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                            <Archive className="w-3.5 h-3.5 text-amber-600" />
                            Bienes en Custodia Física
                          </span>
                        )}
                      </div>

                      {/* BOTÓN DESCARGAR ACTA OFICIAL PDF */}
                      <button
                        onClick={() => handleDescargarActaPdf(dil.id_contrato, dil.codigo_contrato)}
                        className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer shrink-0 self-start sm:self-auto"
                        title="Descargar Acta de Restitución en PDF con firmas digitales"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Descargar Acta PDF</span>
                      </button>
                    </div>

                    {/* DATOS DE DILIGENCIA */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 text-xs">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-500 block mb-0.5">
                          Cliente Titular
                        </span>
                        <p className="font-bold text-slate-900">{dil.cliente_nombre}</p>
                        <p className="text-slate-500 font-mono text-[11px]">CC: {dil.cliente_cedula}</p>
                        {dil.cliente_telefono && (
                          <p className="text-slate-500 text-[11px]">Tel: {dil.cliente_telefono}</p>
                        )}
                      </div>

                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-500 block mb-0.5">
                          Cobrador en Terreno
                        </span>
                        <p className="font-bold text-slate-900">{dil.cobrador_nombre}</p>
                        <p className="text-rose-700 font-bold text-[11px] mt-0.5">
                          {dil.cuotas_vencidas} Cuotas Vencidas • Saldo {formatCOP(dil.saldo_pendiente)}
                        </p>
                      </div>

                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-500 block mb-0.5">
                          Motivo & Observaciones
                        </span>
                        <p className="text-slate-700 italic line-clamp-2">
                          {dil.observaciones || dil.motivo || 'Retiro efectuado según protocolo contractual.'}
                        </p>
                      </div>
                    </div>

                    {/* DETALLE DE ARTÍCULOS RESTITUIDOS Y ACCIÓN DE REINGRESO */}
                    <div className="bg-slate-50/75 rounded-xl p-4 border border-slate-100">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] uppercase font-bold text-slate-600 block">
                          Artículos Restituidos ({dil.articulos?.length || 0})
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {dil.articulos_reingresados_count || 0} de {dil.articulos?.length || 0} reingresados a inventario
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        {dil.articulos && dil.articulos.length > 0 ? (
                          dil.articulos.map((art, idx) => (
                            <div
                              key={idx}
                              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-white border border-slate-200 text-xs"
                            >
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                                  <Package className="w-4 h-4" />
                                </div>
                                <div>
                                  <p className="font-bold text-slate-900">
                                    {art.nombre}
                                  </p>
                                  <p className="text-[11px] text-slate-500 font-mono">
                                    Cant: {art.cantidad} unidad(es) {art.sku ? `• SKU: ${art.sku}` : ''}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-3 self-end sm:self-auto">
                                {art.reingresado ? (
                                  <div className="text-right">
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                                      Reingresado como Nuevo
                                    </span>
                                    {art.fecha_reingreso && (
                                      <span className="text-[10px] text-slate-400 block mt-0.5">
                                        {art.fecha_reingreso.slice(0, 10)} {art.reingresado_por ? `• ${art.reingresado_por}` : ''}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => {
                                      setModalReingreso({
                                        isOpen: true,
                                        id_contrato: dil.id_contrato,
                                        codigo_contrato: dil.codigo_contrato,
                                        articulo: art,
                                        cantidad: art.cantidad || 1,
                                        condicion: 'Como Nuevo / Reacondicionado',
                                        observaciones: 'Reacondicionado y verificado en bodega central, en óptimas condiciones comerciales.',
                                      });
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-semibold shadow-2xs transition-all cursor-pointer"
                                    title="Autorizar reingreso de este artículo al inventario comercial disponible"
                                  >
                                    <Boxes className="w-3.5 h-3.5" />
                                    <span>Reingresar a Stock ("Como Nuevo")</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-slate-400 italic text-xs">Sin detalle de artículos en el registro.</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL ADMINISTRATIVO: AUTORIZAR REINGRESO A STOCK                     */}
      {/* ===================================================================== */}
      {modalReingreso.isOpen && modalReingreso.articulo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-in zoom-in-95 duration-150">
            {/* Cabecera Modal */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                  <Boxes className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Autorizar Reingreso a Inventario
                  </h3>
                  <p className="text-xs text-slate-500">
                    El artículo volverá a estar disponible para venta inmediata en catálogo.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setModalReingreso((prev) => ({ ...prev, isOpen: false }))}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Resumen del Artículo */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500 font-semibold">Producto:</span>
                <span className="font-bold text-slate-900">{modalReingreso.articulo.nombre}</span>
              </div>
              {modalReingreso.articulo.sku && (
                <div className="flex justify-between font-mono">
                  <span className="text-slate-500 font-semibold">SKU:</span>
                  <span className="text-slate-700">{modalReingreso.articulo.sku}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500 font-semibold">Contrato de Origen:</span>
                <span className="font-mono font-bold text-slate-900">{modalReingreso.codigo_contrato}</span>
              </div>
            </div>

            {/* Formulario de Reingreso */}
            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Cantidad a Reingresar
                </label>
                <input
                  type="number"
                  min={1}
                  max={modalReingreso.articulo.cantidad || 1}
                  value={modalReingreso.cantidad}
                  onChange={(e) =>
                    setModalReingreso((prev) => ({
                      ...prev,
                      cantidad: Math.max(1, parseInt(e.target.value) || 1),
                    }))
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
                <span className="text-[10px] text-slate-500 mt-0.5 block">
                  Máximo disponible del retiro: {modalReingreso.articulo.cantidad || 1} unidad(es)
                </span>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Condición Comercial para Venta
                </label>
                <select
                  value={modalReingreso.condicion}
                  onChange={(e) =>
                    setModalReingreso((prev) => ({
                      ...prev,
                      condicion: e.target.value,
                    }))
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="Como Nuevo / Reacondicionado">Como Nuevo / Reacondicionado</option>
                  <option value="Excelente Estado (Exhibición)">Excelente Estado (Exhibición)</option>
                  <option value="Buen Estado (Segunda Selección)">Buen Estado (Segunda Selección)</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Observaciones de Inspección y Bodega
                </label>
                <textarea
                  rows={3}
                  value={modalReingreso.observaciones}
                  onChange={(e) =>
                    setModalReingreso((prev) => ({
                      ...prev,
                      observaciones: e.target.value,
                    }))
                  }
                  placeholder="Ingrese notas sobre la revisión física, embalaje o bodega donde se ubica..."
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            {/* Acciones Modal */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                onClick={() => setModalReingreso((prev) => ({ ...prev, isOpen: false }))}
                disabled={isSubmittingReingreso}
                className="px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                onClick={handleConfirmarReingreso}
                disabled={isSubmittingReingreso}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer disabled:opacity-50"
              >
                <Check className={cn('w-4 h-4', isSubmittingReingreso && 'animate-spin')} />
                <span>{isSubmittingReingreso ? 'Procesando Reingreso...' : 'Confirmar Reingreso al Stock'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
