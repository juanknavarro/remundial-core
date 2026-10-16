'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Building2,
  ShieldCheck,
  MapPin,
  Phone,
  Sparkles,
  Layers,
  Cpu,
  Database,
  CheckCircle2,
  ExternalLink,
  MessageSquare,
  Settings,
  RefreshCw,
  Info,
  Server,
  Lock,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface ParametrosInfo {
  empresa: {
    razon_social: string;
    nit: string;
    ciudad_principal: string;
    telefono_soporte: string;
    lema: string;
  };
  identidad_visual?: {
    eslogan_login?: string;
    eslogan_mobile?: string;
    pie_login?: string;
    pie_mobile?: string;
    tiene_logo?: boolean;
    logo_url?: string | null;
  };
  sistema?: {
    version: string;
    ambiente: string;
    modulo_migracion_activo: boolean;
    formato_migracion: string;
  };
}

export default function AcercaDePage() {
  const [params, setParams] = useState<ParametrosInfo | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const cargarConfiguracion = async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/configuracion/parametros');
      if (res.data) {
        setParams(res.data);
        const iv = res.data.identidad_visual;
        if (iv?.tiene_logo && iv?.logo_url) {
          const fullLogo = iv.logo_url.startsWith('http')
            ? iv.logo_url
            : `${api.defaults.baseURL || ''}${iv.logo_url}`;
          setLogoPreview(fullLogo);
        } else {
          setLogoPreview(null);
        }
      }
    } catch (err) {
      console.error('Error al cargar datos institucionales:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    cargarConfiguracion();
  }, []);

  const empresa = params?.empresa;
  const visual = params?.identidad_visual;
  const sistema = params?.sistema;

  const razonSocial = empresa?.razon_social || 'Plataforma Corporativa';
  const nit = empresa?.nit && empresa.nit.trim() !== '' ? empresa.nit : 'No especificado';
  const ciudad = empresa?.ciudad_principal || 'Colombia';
  const telefono = empresa?.telefono_soporte || '';
  const version = sistema?.version || '1.2.0';
  const ambiente = sistema?.ambiente || 'Producción';
  const lema =
    empresa?.lema ||
    visual?.eslogan_mobile ||
    visual?.eslogan_login ||
    'Plataforma Central de Gestión, Crédito & Cobranza';

  const telLimpio = telefono.replace(/[^\d]/g, '');
  const telWhatsApp = telLimpio.startsWith('57') ? telLimpio : `57${telLimpio}`;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12 animate-in fade-in duration-300">
      {/* ENCABEZADO Y BREADCRUMB */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
            <Link href="/dashboard" className="hover:text-slate-900 transition-colors">
              Inicio
            </Link>
            <span>/</span>
            <span className="text-emerald-700">Acerca de</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-2.5">
            <Info className="w-7 h-7 text-emerald-600" />
            <span>Acerca de la Plataforma</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            Identidad corporativa, especificaciones técnicas de software y canales de soporte autorizados.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={cargarConfiguracion}
            disabled={isLoading}
            className="px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs transition-colors flex items-center gap-2 cursor-pointer shadow-2xs disabled:opacity-50"
            title="Refrescar parámetros del servidor"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
            <span>Actualizar</span>
          </button>

          <Link
            href="/dashboard/configuracion"
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors flex items-center gap-2 shadow-xs cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Editar Marca Blanca</span>
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="p-16 rounded-3xl bg-white border border-slate-200 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin" />
          <p className="text-sm font-semibold text-slate-600">Cargando identidad institucional...</p>
        </div>
      ) : (
        <>
          {/* HERO INSTITUCIONAL BRANDING */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white p-8 sm:p-10 border border-slate-800 shadow-xl">
            <div className="absolute right-0 top-0 -mt-12 -mr-12 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute left-1/3 bottom-0 -mb-16 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10 flex flex-col md:flex-row items-center md:items-start gap-8">
              {/* Logo Corporativo Dinámico */}
              <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 p-3 flex items-center justify-center shrink-0 shadow-2xl">
                {logoPreview ? (
                  <img
                    src={logoPreview}
                    alt={razonSocial}
                    className="max-w-full max-h-full object-contain"
                  />
                ) : (
                  <div className="w-full h-full rounded-xl bg-slate-900/80 flex flex-col items-center justify-center text-emerald-400">
                    <span className="text-3xl font-black">❖</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1">
                      Emblema
                    </span>
                  </div>
                )}
              </div>

              {/* Títulos y Eslogan */}
              <div className="flex-1 text-center md:text-left space-y-3">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold tracking-wide">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Ecosistema de Marca Blanca Activo</span>
                </div>

                <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
                  {razonSocial}
                </h2>

                <p className="text-sm sm:text-base text-slate-300 max-w-2xl font-medium leading-relaxed">
                  {lema}
                </p>

                <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 pt-2">
                  <span className="px-3.5 py-1.5 rounded-xl bg-white/10 backdrop-blur-sm border border-white/15 text-xs font-mono font-bold text-white flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Versión: v{version}</span>
                  </span>

                  <span className="px-3.5 py-1.5 rounded-xl bg-white/10 backdrop-blur-sm border border-white/15 text-xs font-bold text-white flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5 text-blue-400" />
                    <span>Ambiente: {ambiente}</span>
                  </span>

                  <span className="px-3.5 py-1.5 rounded-xl bg-white/10 backdrop-blur-sm border border-white/15 text-xs font-bold text-white flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-emerald-400" />
                    <span>OAuth2 JWT Validado</span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* GRID DE DETALLES INSTITUCIONALES */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* TARJETA 1: DATOS INSTITUCIONALES */}
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs flex flex-col justify-between space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold">
                      <Building2 className="w-4 h-4" />
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">Identidad Corporativa</h3>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                    Compañía
                  </span>
                </div>

                <div className="space-y-3">
                  <div>
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-0.5">
                      Razón Social Registrada
                    </span>
                    <p className="text-sm font-bold text-slate-900">{razonSocial}</p>
                  </div>

                  <div>
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-0.5">
                      NIT / Identificación Fiscal
                    </span>
                    <p className="text-sm font-mono font-bold text-slate-900">{nit}</p>
                  </div>

                  <div>
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-0.5">
                      Ciudad Sede Principal
                    </span>
                    <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{ciudad}</span>
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100">
                <p className="text-[11px] text-slate-500">
                  Datos membretados automáticamente en todos los comprobantes PDF emitidos.
                </p>
              </div>
            </div>

            {/* TARJETA 2: CANALES DE ATENCIÓN Y SOPORTE */}
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs flex flex-col justify-between space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
                      <Phone className="w-4 h-4" />
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">Canales de Asistencia</h3>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                    Soporte
                  </span>
                </div>

                <div className="space-y-3">
                  <div>
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-0.5">
                      Línea Telefónica de Soporte
                    </span>
                    <p className="text-base font-mono font-extrabold text-slate-900">
                      {telefono || 'No configurado'}
                    </p>
                  </div>

                  <div>
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-0.5">
                      Disponibilidad
                    </span>
                    <p className="text-xs font-semibold text-slate-700">
                      Lunes a Sábado • 7:00 AM - 7:00 PM (Horario Operativo)
                    </p>
                  </div>
                </div>

                {/* Botones de Acción */}
                {telefono ? (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <a
                      href={`tel:${telefono.replace(/[^\d+]/g, '')}`}
                      className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Llamar</span>
                    </a>

                    <a
                      href={`https://wa.me/${telWhatsApp}?text=${encodeURIComponent(
                        `Hola, me comunico desde el panel web de ${razonSocial} (v${version}) solicitando asistencia.`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>WhatsApp</span>
                    </a>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">
                    Configure una línea de soporte desde el panel de Configuración Institucional.
                  </p>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100">
                <p className="text-[11px] text-slate-500">
                  Canales habilitados para administradores, supervisores y personal de terreno.
                </p>
              </div>
            </div>

            {/* TARJETA 3: ESPECIFICACIONES DE LA PLATAFORMA */}
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs flex flex-col justify-between space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold">
                      <Cpu className="w-4 h-4" />
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">Arquitectura Técnica</h3>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                    Fullstack
                  </span>
                </div>

                <div className="space-y-2.5 text-xs font-semibold text-slate-700">
                  <div className="flex items-center justify-between py-1 border-b border-slate-50">
                    <span className="text-slate-500">Backend Core</span>
                    <span className="font-mono text-slate-900">FastAPI (Python)</span>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b border-slate-50">
                    <span className="text-slate-500">Base de Datos</span>
                    <span className="font-mono text-slate-900">PostgreSQL + asyncpg</span>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b border-slate-50">
                    <span className="text-slate-500">Panel Administrativo</span>
                    <span className="font-mono text-slate-900">Next.js 15 (React 19)</span>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b border-slate-50">
                    <span className="text-slate-500">Móvil de Terreno</span>
                    <span className="font-mono text-slate-900">React Native Offline-First</span>
                  </div>

                  <div className="flex items-center justify-between py-1">
                    <span className="text-slate-500">Seguridad & Cifrado</span>
                    <span className="font-mono text-emerald-700 font-bold">JWT / Bcrypt / AES</span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100">
                <p className="text-[11px] text-slate-500">
                  Diseñado para alta disponibilidad, sincronización diferida y respaldo atómico.
                </p>
              </div>
            </div>
          </div>

          {/* BANNER INFERIOR DE NAVEGACIÓN Y RESUMEN */}
          <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold shrink-0">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  Gestión Integral de Backups y Reglas de Negocio
                </h4>
                <p className="text-xs text-slate-600">
                  Administre plazos de cuotas dinámicos, catálogos de municipios y copias de seguridad desde la configuración.
                </p>
              </div>
            </div>

            <Link
              href="/dashboard/configuracion"
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors flex items-center gap-2 shadow-xs cursor-pointer shrink-0"
            >
              <span>Ir a Configuración</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* PIE INSTITUCIONAL DINÁMICO */}
          <div className="text-center pt-4 space-y-1">
            <p className="text-xs font-bold text-slate-700">
              {razonSocial} v{version} • Operaciones de Crédito y Cobranza en Terreno
            </p>
            <p className="text-[11px] text-slate-400">
              Todos los derechos reservados. Licencia comercial de software bajo arquitectura multi-tenant y marca blanca.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
