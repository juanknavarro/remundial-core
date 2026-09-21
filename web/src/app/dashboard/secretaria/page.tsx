'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  FileCheck,
  CheckCircle2,
  Printer,
  DollarSign,
  UserCheck,
  MapPin,
  RotateCcw,
  Wallet,
  Check,
  Calendar,
  ArrowRight,
  Clock,
  RefreshCw,
  Receipt,
  AlertCircle,
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
  credito_id: string;
  cobrador_id: string;
  fecha: string;
  valor_abonado: number;
  estado: 'registrado' | 'conciliado' | 'anulado';
  cliente_nombre?: string;
  cliente_cedula?: string;
}

interface RutaConsolidada {
  id: string;
  cobradorNombre: string;
  telefono: string;
  zona: string;
  cobrosRealizados: number;
  totalEsperado: number; // Abonos pendientes por conciliar
  totalRecaudado: number; // Total acumulado en la jornada
  abonosPendientesCount: number;
  abonosConciliadosCount: number;
  estado: 'pendiente' | 'conciliada' | 'sin_movimiento';
}

export default function SecretariaDashboardPage() {
  const [cobradores, setCobradores] = useState<Cobrador[]>([]);
  const [abonos, setAbonos] = useState<AbonoItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // Cargar datos reales desde FastAPI
  const cargarDatos = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const [resUsers, resAbonos] = await Promise.all([
        api.get('/usuarios?rol=cobrador'),
        api.get('/abonos'),
      ]);

      if (Array.isArray(resUsers.data)) {
        const mappedCobradores: Cobrador[] = resUsers.data.map((u: any, idx: number) => ({
          id: u.id,
          nombre: u.nombre,
          telefono: u.telefono || 'Sin teléfono',
          zona: `Ruta ${idx + 1}: Sector Operativo ${u.nombre.split(' ')[0]}`,
          estado_activo: u.estado_activo,
        }));
        setCobradores(mappedCobradores);
      }

      if (Array.isArray(resAbonos.data)) {
        const mappedAbonos: AbonoItem[] = resAbonos.data.map((a: any) => ({
          id_recibo: a.id_recibo,
          credito_id: a.credito_id,
          cobrador_id: a.cobrador_id,
          fecha: a.fecha,
          valor_abonado: Number(a.valor_abonado || 0),
          estado: a.estado,
          cliente_nombre: a.cliente_nombre,
          cliente_cedula: a.cliente_cedula,
        }));
        setAbonos(mappedAbonos);
      }
    } catch (err: any) {
      console.error('Error al cargar datos en Secretaría:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  // Consolidar métricas por cobrador/ruta
  const rutasConsolidadas = useMemo<RutaConsolidada[]>(() => {
    return cobradores.map((c) => {
      const abonosCobrador = abonos.filter((a) => a.cobrador_id === c.id);
      const pendientes = abonosCobrador.filter((a) => a.estado === 'registrado');
      const conciliados = abonosCobrador.filter((a) => a.estado === 'conciliado');

      const totalEsperado = pendientes.reduce((acc, a) => acc + a.valor_abonado, 0);
      const totalRecaudado = abonosCobrador.reduce((acc, a) => acc + a.valor_abonado, 0);

      let estado: 'pendiente' | 'conciliada' | 'sin_movimiento' = 'sin_movimiento';
      if (pendientes.length > 0) {
        estado = 'pendiente';
      } else if (conciliados.length > 0) {
        estado = 'conciliada';
      }

      return {
        id: c.id,
        cobradorNombre: c.nombre,
        telefono: c.telefono,
        zona: c.zona,
        cobrosRealizados: abonosCobrador.length,
        totalEsperado,
        totalRecaudado,
        abonosPendientesCount: pendientes.length,
        abonosConciliadosCount: conciliados.length,
        estado,
      };
    });
  }, [cobradores, abonos]);

  // Métricas Globales
  const totalRecaudadoGlobal = useMemo(() => {
    return abonos.reduce((acc, a) => acc + a.valor_abonado, 0);
  }, [abonos]);

  const totalPendienteCuadre = useMemo(() => {
    return abonos
      .filter((a) => a.estado === 'registrado')
      .reduce((acc, a) => acc + a.valor_abonado, 0);
  }, [abonos]);

  const rutasPendientesCount = rutasConsolidadas.filter((r) => r.estado === 'pendiente').length;
  const rutasConciliadasCount = rutasConsolidadas.filter((r) => r.estado === 'conciliada').length;

  return (
    <div className="space-y-8">
      
      {/* CABECERA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
            <span>Panel Administrativo</span>
            <span>•</span>
            <span className="text-slate-800 font-bold">Módulo de Secretaría</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Arqueo de Caja & Conciliación Diaria
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Consolidado en tiempo real de recaudos reportados en terreno y cierre contable de rutas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={cargarDatos}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
            title="Actualizar datos en tiempo real"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin text-emerald-600')} />
            <span>Refrescar</span>
          </button>

          <Link
            href="/dashboard/secretaria/conciliacion"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition-all cursor-pointer"
          >
            <span>Mesa de Conciliación Detallada</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* AVISO TEMPORAL */}
      {aviso && (
        <div className="p-4 rounded-xl bg-slate-900 text-white text-xs font-medium flex items-center justify-between shadow-sm animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{aviso}</span>
          </div>
          <button onClick={() => setAviso(null)} className="text-slate-400 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* TARJETAS DE CONSOLIDADO GLOBAL */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card 1: Total Recaudado Hoy */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Total Recaudado Hoy
            </span>
            <span className="text-2xl font-black font-mono text-slate-900 mt-1 block">
              {formatCOP(totalRecaudadoGlobal)}
            </span>
            <span className="text-[11px] text-slate-500 mt-0.5 block">
              {abonos.length} recibos generados
            </span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <Wallet className="w-5 h-5" />
          </div>
        </div>

        {/* Card 2: Efectivo Pendiente por Cuadrar */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-amber-600 uppercase tracking-wider block">
              Pendiente por Cuadrar
            </span>
            <span className="text-2xl font-black font-mono text-amber-600 mt-1 block">
              {formatCOP(totalPendienteCuadre)}
            </span>
            <span className="text-[11px] text-slate-500 mt-0.5 block">
              {abonos.filter((a) => a.estado === 'registrado').length} recibos sin conciliar
            </span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        {/* Card 3: Rutas Pendientes */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Rutas por Conciliar
            </span>
            <span className="text-2xl font-black text-slate-900 mt-1 block">
              {rutasPendientesCount} <span className="text-xs font-normal text-slate-500">de {cobradores.length}</span>
            </span>
            <span className="text-[11px] text-slate-500 mt-0.5 block">
              {rutasConciliadasCount} rutas al día
            </span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <FileCheck className="w-5 h-5" />
          </div>
        </div>

        {/* Card 4: Jornada Contable */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Jornada Contable
            </span>
            <span className="text-sm font-bold text-slate-900 mt-1 block">
              {new Date().toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
            <span className="text-[11px] text-emerald-600 font-semibold mt-0.5 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Caja en línea activa
            </span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-slate-50 text-slate-700 flex items-center justify-center shrink-0">
            <Calendar className="w-5 h-5" />
          </div>
        </div>

      </div>

      {/* LISTADO DE RUTAS DE COBRANZA */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">
            Rutas de Cobranza en Base ({cobradores.length})
          </h2>
          <span className="text-xs text-slate-500">
            Cotejo del recaudo reportado por cada cobrador
          </span>
        </div>

        {isLoading ? (
          <div className="p-12 text-center bg-white rounded-2xl border border-slate-200/80">
            <RefreshCw className="w-6 h-6 animate-spin text-slate-400 mx-auto mb-2" />
            <p className="text-xs text-slate-500">Cargando estado de rutas y recaudos...</p>
          </div>
        ) : cobradores.length === 0 ? (
          <div className="p-12 text-center bg-white rounded-2xl border border-slate-200/80 space-y-2">
            <AlertCircle className="w-8 h-8 text-slate-400 mx-auto" />
            <h3 className="text-sm font-bold text-slate-800">No hay cobradores registrados</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Crea o activa usuarios con rol de cobrador en el sistema para habilitar la recepción de efectivo y arqueo.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {rutasConsolidadas.map((ruta) => {
              const isPendiente = ruta.estado === 'pendiente';
              const isConciliada = ruta.estado === 'conciliada';

              return (
                <div
                  key={ruta.id}
                  className={cn(
                    'bg-white rounded-2xl p-6 border shadow-xs transition-all',
                    isConciliada
                      ? 'border-emerald-200/80 bg-emerald-50/10'
                      : isPendiente
                      ? 'border-amber-200/80 bg-white hover:shadow-md'
                      : 'border-slate-200/80 bg-slate-50/40'
                  )}
                >
                  
                  {/* Cabecera de la Ruta */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 mb-5">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        {ruta.cobradorNombre}
                      </h3>
                      <p className="text-xs text-slate-500">
                        Tel: {ruta.telefono} • {ruta.zona}
                      </p>
                    </div>

                    <div>
                      {isConciliada ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Ruta Conciliada
                        </span>
                      ) : isPendiente ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300">
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                          Pendiente por Cuadrar ({ruta.abonosPendientesCount})
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                          Sin recaudos hoy
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Datos Numéricos */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                    <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-100">
                      <span className="text-[11px] font-semibold text-slate-500 block">Recibos Emitidos en Campo</span>
                      <span className="text-xl font-bold text-slate-900 mt-0.5 block">
                        {ruta.cobrosRealizados} abonos
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-100">
                      <span className="text-[11px] font-semibold text-slate-500 block">Total Recaudado en Terreno</span>
                      <span className="text-xl font-bold font-mono text-slate-900 mt-0.5 block">
                        {formatCOP(ruta.totalRecaudado)}
                      </span>
                    </div>

                    <div className={cn(
                      'p-4 rounded-xl border',
                      isPendiente ? 'bg-amber-50/50 border-amber-200' : 'bg-emerald-50/40 border-emerald-100'
                    )}>
                      <span className={cn('text-[11px] font-semibold block', isPendiente ? 'text-amber-800' : 'text-emerald-800')}>
                        {isPendiente ? 'Pendiente de Entrega en Caja' : 'Efectivo Cuadrado en Caja'}
                      </span>
                      <span className={cn('text-xl font-bold font-mono mt-0.5 block', isPendiente ? 'text-amber-900' : 'text-emerald-900')}>
                        {formatCOP(isPendiente ? ruta.totalEsperado : ruta.totalRecaudado)}
                      </span>
                    </div>
                  </div>

                  {/* Acciones */}
                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                    <Link
                      href={`/dashboard/secretaria/conciliacion?cobradorId=${ruta.id}`}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition-all cursor-pointer"
                    >
                      <span>{isPendiente ? 'Ir a Conciliar y Cuadrar Ruta' : 'Ver Detalle de Abonos'}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>

                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
