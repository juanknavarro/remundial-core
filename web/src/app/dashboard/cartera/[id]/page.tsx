'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  FileText,
  Calendar,
  ShieldCheck,
  UserCheck,
  RefreshCw,
  AlertTriangle,
  Check,
  Clock,
  ArrowLeft,
  CheckCircle2,
  DollarSign,
  User,
  Phone,
  MapPin,
} from 'lucide-react';
import { formatCOP, cn } from '@/lib/utils';
import { api } from '@/lib/api';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function CarteraCreditoDetallePage({ params }: PageProps) {
  const { id } = React.use(params);

  const [credito, setCredito] = useState<any | null>(null);
  const [modalidadProyeccionGlobal, setModalidadProyeccionGlobal] = useState<'fija' | 'dinamica'>('fija');
  const [activeTab, setActiveTab] = useState<'amortizacion' | 'garantias' | 'reasignacion'>('amortizacion');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDescargandoPdf, setIsDescargandoPdf] = useState(false);

  // Estados de edición de garantías
  const [formCodeudor, setFormCodeudor] = useState({ nombre: '', cedula: '', telefono: '', direccion: '' });
  const [formReferencia, setFormReferencia] = useState({ nombre: '', telefono: '', parentesco: 'Familiar', direccion: '' });
  const [isSavingGarantias, setIsSavingGarantias] = useState(false);
  const [garantiasFeedback, setGarantiasFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Estados de reasignación
  const [cobradoresDisponibles, setCobradoresDisponibles] = useState<{ id: string; nombre: string }[]>([]);
  const [selectedCobrador, setSelectedCobrador] = useState<string>('');
  const [isSavingCobrador, setIsSavingCobrador] = useState(false);
  const [cobradorFeedback, setCobradorFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    let isMounted = true;

    const cargarDatos = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [resCredito, resParams, resCobradores] = await Promise.allSettled([
          api.get(`/creditos/${id}`),
          api.get('/configuracion/parametros'),
          api.get('/usuarios?rol=cobrador'),
        ]);

        if (!isMounted) return;

        if (resParams.status === 'fulfilled' && resParams.value?.data?.reglas_credito?.modalidad_proyeccion) {
          setModalidadProyeccionGlobal(resParams.value.data.reglas_credito.modalidad_proyeccion);
        }

        if (resCobradores.status === 'fulfilled' && Array.isArray(resCobradores.value.data)) {
          setCobradoresDisponibles(resCobradores.value.data.map((u: any) => ({ id: u.id, nombre: u.nombre })));
        }

        if (resCredito.status === 'fulfilled' && resCredito.value.data) {
          const data = resCredito.value.data;
          setCredito(data);
          if (data.cobrador?.id) {
            setSelectedCobrador(data.cobrador.id);
          }
          if (data.codeudor) {
            setFormCodeudor({
              nombre: data.codeudor.nombre || '',
              cedula: data.codeudor.cedula || '',
              telefono: data.codeudor.telefono || '',
              direccion: data.codeudor.direccion || '',
            });
          }
          if (data.referencia) {
            setFormReferencia({
              nombre: data.referencia.nombre || '',
              telefono: data.referencia.telefono || '',
              parentesco: data.referencia.parentesco || 'Familiar',
              direccion: data.referencia.direccion || '',
            });
          }
        } else {
          setError('No fue posible encontrar el crédito solicitado.');
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.response?.data?.detail || 'Error al cargar la información del crédito.');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    cargarDatos();

    return () => {
      isMounted = false;
    };
  }, [id]);

  const handleDescargarReciboPdf = async () => {
    if (!id) return;
    try {
      setIsDescargandoPdf(true);
      const res = await api.get(`/creditos/${id}/recibo-pdf`, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Recibo_Venta_${id.slice(0, 8).toUpperCase()}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      alert('No fue posible generar el recibo en PDF para este crédito.');
    } finally {
      setIsDescargandoPdf(false);
    }
  };

  const handleGuardarGarantias = async () => {
    setIsSavingGarantias(true);
    setGarantiasFeedback(null);
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
      await api.patch(`/creditos/${id}`, payload);
      setGarantiasFeedback({ type: 'success', message: 'Garantías actualizadas exitosamente en el servidor.' });
    } catch (err: any) {
      setGarantiasFeedback({ type: 'error', message: err.response?.data?.detail || 'No se pudieron guardar las modificaciones.' });
    } finally {
      setIsSavingGarantias(false);
    }
  };

  const handleReasignarCobrador = async () => {
    if (!selectedCobrador) return;
    setIsSavingCobrador(true);
    setCobradorFeedback(null);
    try {
      await api.patch(`/creditos/${id}`, { cobrador_id: selectedCobrador });
      const cobObj = cobradoresDisponibles.find((c) => c.id === selectedCobrador);
      const nombreCob = cobObj?.nombre || 'Cobrador Reasignado';
      setCredito((prev: any) => (prev ? { ...prev, cobrador: { id: selectedCobrador, nombre: nombreCob } } : prev));
      setCobradorFeedback({ type: 'success', message: `Crédito reasignado a la ruta de ${nombreCob}.` });
    } catch (err: any) {
      setCobradorFeedback({ type: 'error', message: err.response?.data?.detail || 'No se pudo reasignar el cobrador.' });
    } finally {
      setIsSavingCobrador(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <RefreshCw className="w-8 h-8 animate-spin text-emerald-600" />
        <span className="text-sm font-semibold text-slate-600">Cargando expediente integral de crédito...</span>
      </div>
    );
  }

  if (error || !credito) {
    return (
      <div className="p-8 max-w-xl mx-auto text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-900">Expediente no encontrado</h2>
        <p className="text-xs text-slate-600">{error || 'El crédito no existe o no se pudo cargar.'}</p>
        <Link
          href="/dashboard/creditos"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Volver a Cartera de Créditos</span>
        </Link>
      </div>
    );
  }

  // Cálculos de negocio y modalidad
  const modalidadActual = credito.modalidad_proyeccion || modalidadProyeccionGlobal || 'fija';
  const esModalidadDinamica = modalidadActual === 'dinamica';
  const contratoNum = `CTR-${String(credito.id_contrato || id).slice(0, 8).toUpperCase()}`;
  const totalFinanciado = Number(credito.monto_financiado || credito.valor_total || 0);
  const saldoPendiente = Number(credito.saldo_pendiente || 0);
  const valorCuota = Number(credito.valor_cuota || 0);
  const totalCuotas = Number(credito.numero_cuotas || 1);

  // Normalización del cronograma
  const cronogramaDetallado: any[] = Array.isArray(credito.cronograma_cuotas) && credito.cronograma_cuotas.length > 0
    ? credito.cronograma_cuotas.map((c: any) => ({
        numero: c.numero,
        fecha_vencimiento: c.fecha_vencimiento,
        valor_cuota: Number(c.valor_exigible || c.valor_cuota || valorCuota),
        valor_pagado: Number(c.valor_pagado || 0),
        saldo_cuota: Number(c.saldo_cuota || 0),
        pagada: Boolean(c.pagada || c.estado === 'pagada'),
        es_parcial: Boolean(c.es_parcial || c.estado === 'parcial'),
        estado: c.estado,
      }))
    : [];

  const cuotasPagadas = cronogramaDetallado.filter((c) => c.pagada);
  const cuotaProxima = cronogramaDetallado.find((c) => !c.pagada);
  const tieneVisitaPendiente = Boolean(cuotaProxima && saldoPendiente > 0);

  const fechaVisitaProxima =
    credito.fecha_siguiente_visita ||
    cuotaProxima?.fecha_vencimiento ||
    credito.fecha_primera_cuota ||
    'Pendiente de agendamiento en ruta';

  const cuotasRestantesCount = cuotaProxima
    ? cronogramaDetallado.filter((c) => !c.pagada && c.numero > cuotaProxima.numero).length
    : 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* NAVEGACIÓN Y ENCABEZADO */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/creditos"
            className="w-9 h-9 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 flex items-center justify-center transition-colors shadow-2xs"
            title="Volver a Cartera de Créditos"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Expediente de Cartera</h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                {contratoNum}
              </span>
              {esModalidadDinamica ? (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-indigo-100 text-indigo-800 border border-indigo-200 flex items-center gap-1">
                  <span>⚡</span> Modalidad Dinámica (Ruta)
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-slate-100 text-slate-700 border border-slate-200 flex items-center gap-1">
                  <span>📅</span> Modalidad Fija
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Titular: <strong className="text-slate-900">{credito.cliente?.nombres || 'Cliente Titular'}</strong> (CC: {credito.cliente?.cedula || 'S/N'}) • Cobrador:{' '}
              {credito.cobrador?.nombre || 'Sin Asignar'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isDescargandoPdf}
            onClick={handleDescargarReciboPdf}
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
          >
            <FileText className="w-4 h-4" />
            <span>{isDescargandoPdf ? 'Generando...' : 'Recibo Digital PDF'}</span>
          </button>
        </div>
      </div>

      {/* TARJETAS DE RESUMEN FINANCIERO */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Monto Total</span>
          <span className="text-base font-extrabold font-mono text-slate-900 mt-0.5 block">{formatCOP(totalFinanciado)}</span>
          <span className="text-[10px] text-slate-500 font-medium mt-1 block">Financiación total pactada</span>
        </div>
        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Saldo Pendiente</span>
          <span className="text-base font-extrabold font-mono text-emerald-700 mt-0.5 block">{formatCOP(saldoPendiente)}</span>
          <span className="text-[10px] text-emerald-600 font-medium mt-1 block">Capital y cuotas activas</span>
        </div>
        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Cuota Pactada</span>
          <span className="text-base font-extrabold font-mono text-slate-900 mt-0.5 block">
            {formatCOP(valorCuota)}
            <span className="text-[10px] text-slate-500 font-normal ml-1 capitalize">({credito.tipo_pago || 'diario'})</span>
          </span>
          <span className="text-[10px] text-slate-500 font-medium mt-1 block">{totalCuotas} cuotas contratadas</span>
        </div>
        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Cobrador Asignado</span>
          <span className="text-sm font-bold text-slate-800 mt-0.5 truncate block">
            {credito.cobrador?.nombre || 'Sin Asignar'}
          </span>
          {esModalidadDinamica && tieneVisitaPendiente ? (
            <span className="text-[10px] text-indigo-700 font-bold mt-1 block truncate">
              📍 Próx. Visita: {fechaVisitaProxima}
            </span>
          ) : (
            <span className="text-[10px] text-slate-500 font-medium mt-1 block">Operación de ruta</span>
          )}
        </div>
      </div>

      {/* PESTAÑAS DE EXPEDIENTE */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="px-6 border-b border-slate-200 flex gap-2 bg-slate-50/50">
          <button
            type="button"
            onClick={() => setActiveTab('amortizacion')}
            className={cn(
              'py-3.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer',
              activeTab === 'amortizacion'
                ? 'border-emerald-600 text-emerald-700 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            )}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Plan de Amortización</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-100 text-slate-700 font-bold">
              {esModalidadDinamica ? `${cuotasPagadas.length + (tieneVisitaPendiente ? 1 : 0)} de ${cronogramaDetallado.length}` : `${cronogramaDetallado.length} cuotas`}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('garantias')}
            className={cn(
              'py-3.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer',
              activeTab === 'garantias'
                ? 'border-emerald-600 text-emerald-700 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            )}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Garantías y Respaldo</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('reasignacion')}
            className={cn(
              'py-3.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer',
              activeTab === 'reasignacion'
                ? 'border-emerald-600 text-emerald-700 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            )}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Reasignación de Ruta</span>
          </button>
        </div>

        {/* CONTENIDO DE PESTAÑAS */}
        <div className="p-6">
          {/* TAB 1: AMORTIZACIÓN */}
          {activeTab === 'amortizacion' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900">Cronograma de Vencimientos y Pagos</h3>
                    {esModalidadDinamica ? (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase bg-indigo-100 text-indigo-800 border border-indigo-200">
                        ⚡ Modalidad Dinámica (Ruta)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase bg-slate-100 text-slate-700 border border-slate-200">
                        📅 Modalidad Fija
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {esModalidadDinamica
                      ? `Agendamiento en ruta para ${totalCuotas} cuotas ${credito.tipo_pago || 'diario'}s.`
                      : `Amortización proyectada de ${totalCuotas} cuotas ${credito.tipo_pago || 'diario'}s.`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200 font-semibold">
                    ✓ Pagada ({cuotasPagadas.length})
                  </span>
                  {cronogramaDetallado.some((c) => c.estado === 'parcial') && (
                    <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200 font-semibold">
                      🟡 Abono Parcial ({cronogramaDetallado.filter((c) => c.estado === 'parcial').length})
                    </span>
                  )}
                  {esModalidadDinamica ? (
                    <>
                      {tieneVisitaPendiente && (
                        <span className="inline-flex items-center gap-1 text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-md border border-indigo-200 font-semibold">
                          📍 Próxima Visita ({fechaVisitaProxima})
                        </span>
                      )}
                      {cuotasRestantesCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-slate-700 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200 font-semibold">
                          ⏳ En Terreno ({cuotasRestantesCount})
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="inline-flex items-center gap-1 text-rose-700 bg-rose-50 px-2.5 py-1 rounded-md border border-rose-200 font-semibold">
                        ⚠️ En Mora ({cronogramaDetallado.filter((c) => c.estado === 'mora').length})
                      </span>
                      <span className="inline-flex items-center gap-1 text-slate-700 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200 font-semibold">
                        ⏳ Pendiente ({cronogramaDetallado.filter((c) => c.estado === 'pendiente').length})
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* TABLA DE AMORTIZACIÓN */}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider font-bold text-[10px] border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3"># Cuota</th>
                      <th className="px-4 py-3">{esModalidadDinamica ? 'Vencimiento / Visita' : 'Vencimiento Programado'}</th>
                      <th className="px-4 py-3 text-right">Valor Cuota</th>
                      <th className="px-4 py-3 text-right">Estado de Pago</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {esModalidadDinamica ? (
                      <>
                        {/* a) Historial de pagos ya realizados */}
                        {cuotasPagadas.map((c) => (
                          <tr key={c.numero} className="bg-emerald-50/20 hover:bg-emerald-50/40 transition-colors">
                            <td className="px-4 py-2.5 font-bold font-mono text-slate-900">
                              Cuota {c.numero} de {cronogramaDetallado.length}
                            </td>
                            <td className="px-4 py-2.5 text-slate-700 font-mono">
                              {c.fecha_vencimiento || 'Recaudada en ruta'}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-900">
                              {formatCOP(c.valor_pagado || c.valor_cuota)}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                ✓ Pagada
                              </span>
                            </td>
                          </tr>
                        ))}

                        {/* b) Fila resaltada: Próxima Visita Programada */}
                        {tieneVisitaPendiente && cuotaProxima && (
                          <tr key={cuotaProxima.numero} className="bg-indigo-50/90 hover:bg-indigo-100/70 border-l-4 border-l-indigo-600 transition-colors">
                            <td className="px-4 py-3 font-bold font-mono text-slate-900">
                              <div className="flex items-center gap-2">
                                <span className="text-indigo-950 font-bold">Cuota {cuotaProxima.numero} de {cronogramaDetallado.length}</span>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase bg-indigo-600 text-white tracking-wider shadow-2xs">
                                  📍 Próxima Visita
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 font-mono font-bold text-indigo-950">
                              <div className="flex items-center gap-1.5">
                                <Calendar className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                <span>{fechaVisitaProxima}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-bold text-indigo-950">
                              {cuotaProxima.es_parcial ? (
                                <div className="flex flex-col items-end">
                                  <span>Exigible: {formatCOP(cuotaProxima.valor_cuota)}</span>
                                  <span className="text-[10px] text-amber-700 font-semibold">
                                    (Abonado: {formatCOP(cuotaProxima.valor_pagado || 0)} | Restan: {formatCOP(cuotaProxima.saldo_cuota || 0)})
                                  </span>
                                </div>
                              ) : (
                                formatCOP(cuotaProxima.valor_cuota)
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {cuotaProxima.es_parcial ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                  🟡 Abono Parcial (Visita Activa)
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase bg-indigo-100 text-indigo-800 border border-indigo-200">
                                  <Clock className="w-3 h-3 text-indigo-600" />
                                  Visita Programada
                                </span>
                              )}
                            </td>
                          </tr>
                        )}

                        {cuotasPagadas.length === 0 && !tieneVisitaPendiente && (
                          <tr>
                            <td colSpan={4} className="px-4 py-8 text-center text-slate-500 italic">
                              No hay cuotas pendientes para este crédito.
                            </td>
                          </tr>
                        )}
                      </>
                    ) : (
                      /* Modalidad Fija: Renderizado completo 1..N */
                      cronogramaDetallado.map((c) => {
                        const isParcial = c.estado === 'parcial';
                        return (
                          <tr
                            key={c.numero}
                            className={cn(
                              'hover:bg-slate-50/50 transition-colors',
                              c.estado === 'pagada' && 'bg-emerald-50/15',
                              isParcial && 'bg-amber-50/20',
                              c.estado === 'mora' && 'bg-rose-50/15'
                            )}
                          >
                            <td className="px-4 py-2.5 font-bold font-mono text-slate-900">
                              Cuota {c.numero} de {cronogramaDetallado.length}
                            </td>
                            <td className="px-4 py-2.5 text-slate-700 font-mono">{c.fecha_vencimiento || '--'}</td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-900">
                              {formatCOP(c.valor_cuota)}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              {c.estado === 'pagada' && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                  ✓ Pagada
                                </span>
                              )}
                              {isParcial && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                  🟡 Abono Parcial
                                </span>
                              )}
                              {c.estado === 'mora' && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                                  ⚠️ En Mora
                                </span>
                              )}
                              {c.estado === 'pendiente' && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                  ⏳ Pendiente
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

              {/* c) Mensaje o badge informativo para Modalidad Dinámica */}
              {esModalidadDinamica && cuotasRestantesCount > 0 && (
                <div className="p-4 bg-gradient-to-r from-indigo-50/90 via-slate-50 to-indigo-50/50 border border-indigo-200/80 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 border border-indigo-200 shadow-2xs">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-indigo-950">
                          Cronograma Dinámico: Las cuotas restantes se agendarán en terreno
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-indigo-100 text-indigo-800 border border-indigo-200">
                          {cuotasRestantesCount} {cuotasRestantesCount === 1 ? 'cuota restante' : 'cuotas restantes'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-0.5">
                        Las fechas y vencimientos de las cuotas #{cuotaProxima?.numero ? cuotaProxima.numero + 1 : 2} a #{cronogramaDetallado.length} se programarán dinámicamente en ruta conforme el cobrador realice cada recaudo.
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5 text-[11px] font-bold text-indigo-700 bg-white px-3 py-1.5 rounded-lg border border-indigo-200 shadow-2xs">
                    <span>⚡ Modalidad Flexible</span>
                  </div>
                </div>
              )}

              {esModalidadDinamica && saldoPendiente === 0 && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3 text-xs">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div>
                    <span className="font-bold text-emerald-900">Crédito Liquidado al 100%</span>
                    <p className="text-[11px] text-emerald-700 mt-0.5">
                      Todas las cuotas de este crédito han sido canceladas satisfactoriamente en ruta.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: GARANTÍAS Y RESPALDO */}
          {activeTab === 'garantias' && (
            <div className="space-y-6">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Actualización de Garantías Solidarias y Contactos</p>
                  <p className="text-[11px] text-emerald-700 mt-0.5">
                    Modifica los datos del codeudor solidario y la referencia familiar para garantizar trazabilidad de cobranza.
                  </p>
                </div>
              </div>

              {garantiasFeedback && (
                <div
                  className={cn(
                    'p-3 rounded-xl border text-xs font-semibold flex items-center gap-2',
                    garantiasFeedback.type === 'success'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-rose-50 border-rose-200 text-rose-800'
                  )}
                >
                  {garantiasFeedback.type === 'success' ? <Check className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-rose-600" />}
                  <span>{garantiasFeedback.message}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Codeudor */}
                <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <span className="text-xs font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-emerald-600" />
                    Codeudor Solidario
                  </span>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">Nombre Completo</label>
                    <input
                      type="text"
                      value={formCodeudor.nombre}
                      onChange={(e) => setFormCodeudor({ ...formCodeudor, nombre: e.target.value })}
                      placeholder="Nombre del codeudor"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">Cédula</label>
                    <input
                      type="text"
                      value={formCodeudor.cedula}
                      onChange={(e) => setFormCodeudor({ ...formCodeudor, cedula: e.target.value })}
                      placeholder="Número de documento"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">Teléfono</label>
                    <input
                      type="text"
                      value={formCodeudor.telefono}
                      onChange={(e) => setFormCodeudor({ ...formCodeudor, telefono: e.target.value })}
                      placeholder="Teléfono móvil"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">Dirección</label>
                    <input
                      type="text"
                      value={formCodeudor.direccion}
                      onChange={(e) => setFormCodeudor({ ...formCodeudor, direccion: e.target.value })}
                      placeholder="Dirección de residencia"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold bg-white"
                    />
                  </div>
                </div>

                {/* Referencia Familiar */}
                <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <span className="text-xs font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                    <User className="w-4 h-4 text-blue-600" />
                    Referencia Familiar
                  </span>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">Nombre Completo</label>
                    <input
                      type="text"
                      value={formReferencia.nombre}
                      onChange={(e) => setFormReferencia({ ...formReferencia, nombre: e.target.value })}
                      placeholder="Nombre de la referencia"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">Parentesco</label>
                    <input
                      type="text"
                      value={formReferencia.parentesco}
                      onChange={(e) => setFormReferencia({ ...formReferencia, parentesco: e.target.value })}
                      placeholder="Ej. Hermano, Tía, Vecino"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">Teléfono</label>
                    <input
                      type="text"
                      value={formReferencia.telefono}
                      onChange={(e) => setFormReferencia({ ...formReferencia, telefono: e.target.value })}
                      placeholder="Teléfono móvil"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">Dirección</label>
                    <input
                      type="text"
                      value={formReferencia.direccion}
                      onChange={(e) => setFormReferencia({ ...formReferencia, direccion: e.target.value })}
                      placeholder="Dirección o barrio"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold bg-white"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={isSavingGarantias}
                  onClick={handleGuardarGarantias}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-xs disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                >
                  {isSavingGarantias ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  <span>{isSavingGarantias ? 'Guardando...' : 'Guardar Garantías'}</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: REASIGNACIÓN DE RUTA */}
          {activeTab === 'reasignacion' && (
            <div className="space-y-5 max-w-xl">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wide block">
                  Cobrador Responsable del Recaudo
                </span>
                <p className="text-xs text-slate-500">
                  Selecciona el cobrador autorizado que realizará el cobro de las cuotas y el agendamiento de visitas en ruta.
                </p>

                {cobradorFeedback && (
                  <div
                    className={cn(
                      'p-3 rounded-xl border text-xs font-semibold flex items-center gap-2',
                      cobradorFeedback.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border-rose-200 text-rose-800'
                    )}
                  >
                    {cobradorFeedback.type === 'success' ? <Check className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-rose-600" />}
                    <span>{cobradorFeedback.message}</span>
                  </div>
                )}

                <div className="pt-2">
                  <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">Cobrador</label>
                  <select
                    value={selectedCobrador}
                    onChange={(e) => setSelectedCobrador(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold bg-white text-slate-800"
                  >
                    <option value="" disabled>Seleccione un cobrador</option>
                    {cobradoresDisponibles.map((c) => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    disabled={isSavingCobrador || !selectedCobrador}
                    onClick={handleReasignarCobrador}
                    className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all shadow-xs disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                  >
                    {isSavingCobrador ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    <span>{isSavingCobrador ? 'Asignando...' : 'Guardar Reasignación'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
