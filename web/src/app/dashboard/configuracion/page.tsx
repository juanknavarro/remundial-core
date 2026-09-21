'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Settings,
  FileSpreadsheet,
  Download,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Layers,
  ShieldCheck,
  Calendar,
  Building2,
  Phone,
  MapPin,
  RefreshCw,
  FileText,
  Clock,
  Check,
  ArrowRight,
  Package,
  Users,
  CreditCard,
  Info,
  Printer,
  Image as ImageIcon,
  Sparkles,
  Smartphone,
  Monitor,
  Trash2,
  Database,
  Upload,
  Eye,
  X,
  Search,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface PlantillasPdfData {
  membrete: {
    razon_social: string;
    subtitulo: string;
    nit: string;
    regimen: string;
    direccion: string;
    ciudad: string;
    telefono_pbx: string;
    correo: string;
  };
  clausulas_venta: string;
  certificacion_recaudo: string;
  acta_restitucion: {
    clausula_legal: string;
    observaciones_defecto: string;
    pie_pagina: string;
  };
}

interface ParametrosData {
  empresa: {
    razon_social: string;
    nit: string;
    ciudad_principal: string;
    telefono_soporte: string;
    lema: string;
  };
  identidad_visual?: {
    eslogan_login: string;
    eslogan_mobile: string;
    pie_login: string;
    pie_mobile: string;
    tiene_logo: boolean;
    logo_url: string | null;
  };
  reglas_credito: {
    plazos_permitidos: number[];
    unidad_plazo: string;
    tipo_pago_defecto: string;
    dia_vencimiento: string;
    umbral_mora_critica: number;
    descripcion_mora_critica: string;
    cuota_inicial_minima: number;
    tasa_interes_incluida: boolean;
  };
  sistema: {
    version: string;
    ambiente: string;
    modulo_migracion_activo: boolean;
    formato_migracion: string;
  };
  ciudades_venta?: Record<string, string[]> | string[];
  plantillas_pdf?: PlantillasPdfData;
}

interface ResumenMigracion {
  inventario_procesados: number;
  inventario_creados: number;
  inventario_actualizados: number;
  clientes_procesados: number;
  clientes_creados: number;
  clientes_actualizados: number;
  creditos_procesados: number;
  creditos_creados: number;
  creditos_omitidos: number;
}

interface ErrorFila {
  hoja: string;
  fila: number;
  motivo: string;
}

export default function ConfiguracionPage() {
  const [activeTab, setActiveTab] = useState<'parametros' | 'plantillas' | 'migracion' | 'respaldos'>('parametros');
  const [parametros, setParametros] = useState<ParametrosData | null>(null);
  const [isLoadingParams, setIsLoadingParams] = useState(true);

  // Estados Formulario Identidad de la Compañía
  const [formEmpresa, setFormEmpresa] = useState({
    razon_social: '',
    nit: '',
    ciudad_principal: '',
    telefono_soporte: '',
  });
  const [isSavingEmpresa, setIsSavingEmpresa] = useState(false);
  const [empresaFeedback, setEmpresaFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Estados Formulario Identidad Visual & Logotipos
  const [identidadVisual, setIdentidadVisual] = useState({
    eslogan_login: 'Plataforma Central de Crédito & Cobranza',
    eslogan_mobile: 'Plataforma Central de Campo & Cobranza',
    pie_login: 'Acceso restringido únicamente a colaboradores autorizados de Remundial.',
    pie_mobile: 'Remundial Core v1.2.0 • Operaciones de Campo',
    tiene_logo: false,
    logo_url: '' as string | null,
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isDeletingLogo, setIsDeletingLogo] = useState(false);
  const [isSavingVisual, setIsSavingVisual] = useState(false);
  const [feedbackVisual, setFeedbackVisual] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Estados Formulario Plantillas y Textos PDF
  const [formPdf, setFormPdf] = useState<PlantillasPdfData>({
    membrete: {
      razon_social: "REMUNDIAL ARTE'S",
      subtitulo: 'Mueblería, Artesanías, Mecedoras & Cuadros por Encargo',
      nit: '901.458.321-0',
      regimen: 'Régimen Comercial Colombiano',
      direccion: 'Carrera 5 # 31-20, Centro',
      ciudad: 'Montería - Córdoba',
      telefono_pbx: '(+57) 300 123 4567',
      correo: 'info@remundialartes.com',
    },
    clausulas_venta: '',
    certificacion_recaudo: '',
    acta_restitucion: {
      clausula_legal: '',
      observaciones_defecto: 'Departamento de Cartera y Recuperación de Bienes',
      pie_pagina: 'Diligencia ejecutada conforme al régimen de garantías mobiliarias y reserva de dominio contractual.',
    },
  });
  const [isSavingPdf, setIsSavingPdf] = useState(false);
  const [pdfFeedback, setPdfFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Estados de retroalimentación visual transitoria en botones de guardado
  const [savedEmpresaSuccess, setSavedEmpresaSuccess] = useState(false);
  const [savedVisualSuccess, setSavedVisualSuccess] = useState(false);
  const [savedPdfSuccess, setSavedPdfSuccess] = useState(false);
  const [savedLogoSuccess, setSavedLogoSuccess] = useState(false);

  // Estados de Gestión Dinámica de Ciudades de Venta (Estructura Jerárquica Departamento -> Municipio)
  const [departamentoSeleccionado, setDepartamentoSeleccionado] = useState<string>('Córdoba');
  const [catalogoDepartamentos, setCatalogoDepartamentos] = useState<Record<string, string[]>>({
    'Córdoba': [],
    'Sucre': [],
  });
  const [tabDepartamentoActivo, setTabDepartamentoActivo] = useState<string>('Todos');
  const [filtroBusquedaMunicipio, setFiltroBusquedaMunicipio] = useState<string>('');
  const [nuevaCiudadInput, setNuevaCiudadInput] = useState('');
  const [isSavingCiudades, setIsSavingCiudades] = useState(false);
  const [modoNuevoDepartamento, setModoNuevoDepartamento] = useState<boolean>(false);
  const [nuevoDepartamentoInput, setNuevoDepartamentoInput] = useState<string>('');
  const [ciudadesFeedback, setCiudadesFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Estado y disparador de notificación flotante (Toast Tailwind)
  const [toast, setToast] = useState<{
    id: number;
    title: string;
    message: string;
  } | null>(null);

  const dispararToast = (title: string, message: string) => {
    const id = Date.now();
    setToast({ id, title, message });
    setTimeout(() => {
      setToast((curr) => (curr?.id === id ? null : curr));
    }, 3500);
  };

  // Estados de Migración Masiva
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [resultadoMigracion, setResultadoMigracion] = useState<{
    resumen: ResumenMigracion;
    errores: ErrorFila[];
    mensaje: string;
  } | null>(null);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);

  // Cargar parámetros del backend
  const cargarParametros = async () => {
    setIsLoadingParams(true);
    try {
      const res = await api.get('/configuracion/parametros');
      setParametros(res.data);
      // Cargar catálogo de ciudades estructurado (Córdoba y Sucre)
      try {
        const cRes = await api.get('/config/ciudades');
        const data = cRes.data;
        let cat: Record<string, string[]> = {};
        if (data?.departamentos && typeof data.departamentos === 'object' && !Array.isArray(data.departamentos)) {
          cat = data.departamentos;
        } else if (data?.ciudades && typeof data.ciudades === 'object' && !Array.isArray(data.ciudades)) {
          cat = data.ciudades;
        } else if (Array.isArray(data?.ciudades) || Array.isArray(data)) {
          cat = { 'Córdoba': Array.isArray(data?.ciudades) ? data.ciudades : data, 'Sucre': [] };
        }
        if (Object.keys(cat).length > 0) {
          setCatalogoDepartamentos(cat);
        }
      } catch {
        if (res.data?.ciudades_venta && typeof res.data.ciudades_venta === 'object' && !Array.isArray(res.data.ciudades_venta)) {
          setCatalogoDepartamentos(res.data.ciudades_venta);
        }
      }
      if (res.data?.empresa) {
        setFormEmpresa({
          razon_social: res.data.empresa.razon_social || '',
          nit: res.data.empresa.nit || '',
          ciudad_principal: res.data.empresa.ciudad_principal || '',
          telefono_soporte: res.data.empresa.telefono_soporte || '',
        });
      }
      if (res.data?.plantillas_pdf) {
        const p = res.data.plantillas_pdf;
        setFormPdf({
          membrete: {
            razon_social: p.membrete?.razon_social || '',
            subtitulo: p.membrete?.subtitulo || '',
            nit: p.membrete?.nit || '',
            regimen: p.membrete?.regimen || '',
            direccion: p.membrete?.direccion || '',
            ciudad: p.membrete?.ciudad || '',
            telefono_pbx: p.membrete?.telefono_pbx || '',
            correo: p.membrete?.correo || '',
          },
          clausulas_venta: p.clausulas_venta || '',
          certificacion_recaudo: p.certificacion_recaudo || '',
          acta_restitucion: {
            clausula_legal: p.acta_restitucion?.clausula_legal || '',
            observaciones_defecto: p.acta_restitucion?.observaciones_defecto || '',
            pie_pagina: p.acta_restitucion?.pie_pagina || '',
          },
        });
      }
      if (res.data?.identidad_visual) {
        const v = res.data.identidad_visual;
        const fullLogoUrl = v.logo_url
          ? (v.logo_url.startsWith('http') ? v.logo_url : `${api.defaults.baseURL || ''}${v.logo_url}`)
          : null;
        setIdentidadVisual({
          eslogan_login: v.eslogan_login || 'Plataforma Central de Crédito & Cobranza',
          eslogan_mobile: v.eslogan_mobile || 'Plataforma Central de Campo & Cobranza',
          pie_login: v.pie_login || 'Acceso restringido únicamente a colaboradores autorizados de Remundial.',
          pie_mobile: v.pie_mobile || 'Remundial Core v1.2.0 • Operaciones de Campo',
          tiene_logo: Boolean(v.tiene_logo),
          logo_url: fullLogoUrl,
        });
        if (v.tiene_logo && fullLogoUrl) {
          setLogoPreviewUrl(fullLogoUrl);
        } else {
          setLogoPreviewUrl(null);
        }
      }
    } catch (err) {
      console.error('Error cargando parámetros:', err);
    } finally {
      setIsLoadingParams(false);
    }
  };

  useEffect(() => {
    cargarParametros();
  }, []);

  // Guardar cambios institucionales (Identidad de la Compañía)
  const handleGuardarEmpresa = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingEmpresa(true);
    setEmpresaFeedback(null);
    try {
      const res = await api.put('/configuracion/parametros', formEmpresa);
      if (res.data && res.data.success) {
        setParametros((prev) =>
          prev ? { ...prev, empresa: { ...prev.empresa, ...formEmpresa } } : null
        );
        // Sincronizar también el membrete de las plantillas
        setFormPdf((prev) => ({
          ...prev,
          membrete: {
            ...prev.membrete,
            razon_social: formEmpresa.razon_social || prev.membrete.razon_social,
            nit: formEmpresa.nit !== undefined ? formEmpresa.nit : prev.membrete.nit,
            ciudad: formEmpresa.ciudad_principal || prev.membrete.ciudad,
            telefono_pbx: formEmpresa.telefono_soporte || prev.membrete.telefono_pbx,
          },
        }));
        setEmpresaFeedback({
          type: 'success',
          message: 'Identidad institucional guardada exitosamente.',
        });
        setSavedEmpresaSuccess(true);
        dispararToast(
          'Identidad Institucional Sincronizada',
          'Los datos comerciales y políticas generales se han actualizado exitosamente.'
        );
        setTimeout(() => setSavedEmpresaSuccess(false), 2500);
        setTimeout(() => setEmpresaFeedback(null), 4000);
      }
    } catch (err: any) {
      console.error('Error guardando datos de empresa:', err);
      setEmpresaFeedback({
        type: 'error',
        message: err.response?.data?.detail || 'No se pudieron guardar los cambios institucionales.',
      });
    } finally {
      setIsSavingEmpresa(false);
    }
  };

  // Gestión de Ciudades y Departamentos con persistencia de diccionario estructurado
  const handleAgregarCiudad = async () => {
    const c = nuevaCiudadInput.trim();
    const rawDep = (modoNuevoDepartamento ? nuevoDepartamentoInput : departamentoSeleccionado).trim();

    if (!rawDep) {
      setCiudadesFeedback({
        type: 'error',
        message: 'Debe seleccionar o ingresar el nombre del departamento.',
      });
      return;
    }

    if (!c) {
      setCiudadesFeedback({
        type: 'error',
        message: 'Debe ingresar el nombre del municipio.',
      });
      return;
    }

    // Normalizar capitalización
    const dep = rawDep.charAt(0).toUpperCase() + rawDep.slice(1);
    const cCapitalizada = c.charAt(0).toUpperCase() + c.slice(1);

    const munisActuales = catalogoDepartamentos[dep] || [];
    if (munisActuales.some((item) => item.toLowerCase() === c.toLowerCase())) {
      setCiudadesFeedback({
        type: 'error',
        message: `El municipio "${cCapitalizada}" ya está registrado en ${dep}.`,
      });
      return;
    }

    const nuevoCatalogo: Record<string, string[]> = {
      ...catalogoDepartamentos,
      [dep]: [...munisActuales, cCapitalizada].sort((a, b) => a.localeCompare(b, 'es')),
    };

    setCatalogoDepartamentos(nuevoCatalogo);
    setDepartamentoSeleccionado(dep);
    setNuevaCiudadInput('');
    if (modoNuevoDepartamento) {
      setModoNuevoDepartamento(false);
      setNuevoDepartamentoInput('');
    }

    try {
      setIsSavingCiudades(true);
      // Actualizar preservando el diccionario en el payload
      await api.put('/config/ciudades', {
        departamentos: nuevoCatalogo,
        ciudades: nuevoCatalogo,
      });
      setCiudadesFeedback({
        type: 'success',
        message: `Municipio "${cCapitalizada}" agregado exitosamente a ${dep}.`,
      });
      dispararToast('Catálogo de Ciudades', `Se agregó "${cCapitalizada}" (${dep}) al catálogo.`);
    } catch (err: any) {
      setCiudadesFeedback({
        type: 'error',
        message: err?.response?.data?.detail || 'Error al guardar municipio.',
      });
    } finally {
      setIsSavingCiudades(false);
    }
  };

  const handleEliminarCiudad = async (dep: string, ciudadAEliminar: string) => {
    const totalGlobal = Object.values(catalogoDepartamentos).reduce(
      (acc, l) => acc + (Array.isArray(l) ? l.length : 0),
      0
    );
    if (totalGlobal <= 1) {
      setCiudadesFeedback({
        type: 'error',
        message: 'Debe conservar al menos un municipio activo en el sistema.',
      });
      return;
    }

    const munisActuales = catalogoDepartamentos[dep] || [];
    const nuevoCatalogo: Record<string, string[]> = {
      ...catalogoDepartamentos,
      [dep]: munisActuales.filter((c) => c !== ciudadAEliminar),
    };

    setCatalogoDepartamentos(nuevoCatalogo);

    try {
      setIsSavingCiudades(true);
      await api.put('/config/ciudades', {
        departamentos: nuevoCatalogo,
        ciudades: nuevoCatalogo,
      });
      setCiudadesFeedback({
        type: 'success',
        message: `Municipio "${ciudadAEliminar}" removido de ${dep}.`,
      });
      dispararToast('Catálogo de Ciudades', `Se eliminó "${ciudadAEliminar}" de ${dep}.`);
    } catch (err: any) {
      setCiudadesFeedback({
        type: 'error',
        message: err?.response?.data?.detail || 'Error al actualizar municipios.',
      });
    } finally {
      setIsSavingCiudades(false);
    }
  };

  // Guardar configuración y plantillas PDF
  const handleGuardarPdf = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingPdf(true);
    setPdfFeedback(null);
    try {
      const res = await api.put('/configuracion/plantillas-pdf', formPdf);
      if (res.data && res.data.success) {
        setPdfFeedback({
          type: 'success',
          message: 'Plantillas y textos oficiales en PDF guardados y sincronizados con éxito.',
        });
        setSavedPdfSuccess(true);
        dispararToast(
          'Configuración PDF Sincronizada',
          'El membrete corporativo, cláusulas y textos oficiales se han guardado con éxito.'
        );
        setTimeout(() => setSavedPdfSuccess(false), 2500);
        if (formPdf.membrete.razon_social) {
          setFormEmpresa((prev) => ({
            ...prev,
            razon_social: formPdf.membrete.razon_social,
            nit: formPdf.membrete.nit !== undefined ? formPdf.membrete.nit : prev.nit,
            ciudad_principal: formPdf.membrete.ciudad || prev.ciudad_principal,
            telefono_soporte: formPdf.membrete.telefono_pbx || prev.telefono_soporte,
          }));
        }
        setTimeout(() => setPdfFeedback(null), 5000);
      }
    } catch (err: any) {
      console.error('Error guardando plantillas PDF:', err);
      setPdfFeedback({
        type: 'error',
        message: err.response?.data?.detail || 'No se pudo guardar la configuración de plantillas PDF.',
      });
    } finally {
      setIsSavingPdf(false);
    }
  };

  // Selección de archivo de logo
  const handleLogoFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setFeedbackVisual({
        type: 'error',
        message: 'El archivo supera el tamaño máximo permitido de 5 MB.',
      });
      return;
    }

    setLogoFile(file);
    const preview = URL.createObjectURL(file);
    setLogoPreviewUrl(preview);
    setFeedbackVisual(null);
  };

  // Subida de nuevo logotipo
  const handleSubirLogo = async () => {
    if (!logoFile) return;
    setIsUploadingLogo(true);
    setFeedbackVisual(null);
    try {
      const formData = new FormData();
      formData.append('file', logoFile);

      const res = await api.post('/configuracion/logo', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (res.data && res.data.success) {
        const rawUrl = res.data.logo_url;
        const fullUrl = rawUrl.startsWith('http') ? rawUrl : `${api.defaults.baseURL || ''}${rawUrl}`;
        setIdentidadVisual((prev) => ({
          ...prev,
          tiene_logo: true,
          logo_url: fullUrl,
        }));
        setLogoPreviewUrl(fullUrl);
        setLogoFile(null);
        setFeedbackVisual({
          type: 'success',
          message: '¡Logotipo institucional actualizado exitosamente! Ya se exhibe en el login web y la app móvil.',
        });
        setSavedLogoSuccess(true);
        dispararToast(
          'Logotipo Oficial Actualizado',
          'El logotipo corporativo se ha cargado y sincronizado con éxito para web y móvil.'
        );
        setTimeout(() => setSavedLogoSuccess(false), 2500);
        setTimeout(() => setFeedbackVisual(null), 5000);
      }
    } catch (err: any) {
      console.error('Error subiendo logotipo:', err);
      setFeedbackVisual({
        type: 'error',
        message: err.response?.data?.detail || 'No fue posible subir el archivo de logotipo.',
      });
    } finally {
      setIsUploadingLogo(false);
    }
  };

  // Restaurar logotipo por defecto
  const handleEliminarLogo = async () => {
    if (!window.confirm('¿Desea restaurar el logotipo oficial al ícono corporativo estándar del sistema?')) {
      return;
    }
    setIsDeletingLogo(true);
    setFeedbackVisual(null);
    try {
      const res = await api.delete('/configuracion/logo');
      if (res.data && res.data.success) {
        setIdentidadVisual((prev) => ({
          ...prev,
          tiene_logo: false,
          logo_url: null,
        }));
        setLogoPreviewUrl(null);
        setLogoFile(null);
        setFeedbackVisual({
          type: 'success',
          message: 'Logotipo personalizado eliminado. Se ha restaurado el ícono institucional por defecto.',
        });
        setTimeout(() => setFeedbackVisual(null), 4000);
      }
    } catch (err: any) {
      console.error('Error eliminando logotipo:', err);
      setFeedbackVisual({
        type: 'error',
        message: err.response?.data?.detail || 'No fue posible restaurar el logotipo por defecto.',
      });
    } finally {
      setIsDeletingLogo(false);
    }
  };

  // Guardar textos de eslóganes y pie de página de acceso
  const handleGuardarIdentidadVisual = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingVisual(true);
    setFeedbackVisual(null);
    try {
      const res = await api.put('/configuracion/identidad-visual', {
        eslogan_login: identidadVisual.eslogan_login,
        eslogan_mobile: identidadVisual.eslogan_mobile,
        pie_login: identidadVisual.pie_login,
        pie_mobile: identidadVisual.pie_mobile,
      });
      if (res.data && res.data.success) {
        setFeedbackVisual({
          type: 'success',
          message: 'Eslóganes y textos de acceso institucional guardados y actualizados correctamente.',
        });
        setSavedVisualSuccess(true);
        dispararToast(
          'Textos de Acceso Sincronizados',
          'Los eslóganes y textos del login y app móvil se han guardado correctamente.'
        );
        setTimeout(() => setSavedVisualSuccess(false), 2500);
        setTimeout(() => setFeedbackVisual(null), 4000);
      }
    } catch (err: any) {
      console.error('Error guardando textos visuales:', err);
      setFeedbackVisual({
        type: 'error',
        message: err.response?.data?.detail || 'Error al guardar los textos de acceso institucional.',
      });
    } finally {
      setIsSavingVisual(false);
    }
  };

  // Descargar Plantilla Oficial Excel
  const handleDescargarPlantilla = async () => {
    try {
      setIsDownloading(true);
      const res = await api.get('/configuracion/plantilla-migracion-excel', {
        responseType: 'blob',
      });
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'Plantilla_Migracion_Remundial_Core.xlsx');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error al descargar plantilla Excel:', err);
      alert('No fue posible descargar la plantilla oficial. Verifique la conexión con el servidor.');
    } finally {
      setIsDownloading(false);
    }
  };

  // Procesar archivo Excel seleccionado
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.name.toLowerCase().endsWith('.xlsx') && !file.name.toLowerCase().endsWith('.xlsm')) {
        setErrorSubida('Por favor seleccione un archivo Excel válido con extensión .xlsx');
        setSelectedFile(null);
        return;
      }
      setSelectedFile(file);
      setErrorSubida(null);
      setResultadoMigracion(null);
    }
  };

  // Subir e importar archivo
  const handleSubirArchivo = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    setErrorSubida(null);
    setResultadoMigracion(null);

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const res = await api.post('/configuracion/migracion-masiva', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (res.data && res.data.success) {
        setResultadoMigracion({
          resumen: res.data.resumen,
          errores: res.data.errores || [],
          mensaje: res.data.mensaje,
        });
      }
    } catch (err: any) {
      console.error('Error en migración masiva:', err);
      setErrorSubida(
        err.response?.data?.detail || 'Ocurrió un error inesperado al procesar el archivo Excel.'
      );
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* CABECERA PRINCIPAL */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-xs">
              <Settings className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                Configuración & Reglas
              </h1>
              <p className="text-xs sm:text-sm text-slate-600">
                Políticas operativas, plazos contractuales y módulo de migración masiva de datos.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200/80 flex items-center gap-2 text-xs font-medium text-emerald-800">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>FastAPI Activo (v1.2.0)</span>
          </div>
        </div>
      </div>

      {/* TABS DE NAVEGACIÓN INTERNA */}
      <div className="border-b border-slate-200/80">
        <div className="flex space-x-2 sm:space-x-4 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('parametros')}
            className={cn(
              'pb-3.5 px-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-all cursor-pointer shrink-0',
              activeTab === 'parametros'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            )}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Parámetros Generales & Reglas</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('plantillas')}
            className={cn(
              'pb-3.5 px-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-all cursor-pointer shrink-0',
              activeTab === 'plantillas'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            )}
          >
            <ImageIcon className="w-4 h-4" />
            <span>Plantillas, Identidad Visual & Textos PDF</span>
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-800">
              ReportLab & Branding
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('migracion')}
            className={cn(
              'pb-3.5 px-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-all cursor-pointer shrink-0',
              activeTab === 'migracion'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            )}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Migración de Datos (Cargue Masivo Híbrido)</span>
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800">
              Excel .xlsx
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('respaldos')}
            className={cn(
              'pb-3.5 px-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-all cursor-pointer shrink-0',
              activeTab === 'respaldos'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            )}
          >
            <Database className="w-4 h-4" />
            <span>Respaldos & Base de Datos</span>
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600">
              Próximamente
            </span>
          </button>
        </div>
      </div>

      {/* CONTENIDO PESTAÑA 1: PARÁMETROS GENERALES */}
      {activeTab === 'parametros' && (
        <div className="space-y-6">
          {/* Reglas de Crédito */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-slate-700" />
                <span>Políticas de Financiación & Plazos Contractuales</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Reglas comerciales aplicadas uniformemente en ventas POS, contratos y cronogramas de pago.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Plazos Permitidos */}
              <div className="p-5 rounded-xl bg-slate-50 border border-slate-200/60 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Plazos de Financiación Autorizados
                  </span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                    Estricto
                  </span>
                </div>
                <p className="text-xs text-slate-600">
                  La empresa opera exclusivamente bajo 4 modalidades de plazo mensual. No se admiten fraccionamientos informales ni diarios:
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {[2, 4, 6, 9].map((plazo) => (
                    <div
                      key={plazo}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-slate-300 shadow-2xs font-semibold text-slate-800 text-xs"
                    >
                      <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{plazo} Cuotas Mensuales</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Política de Cartera Crítica */}
              <div className="p-5 rounded-xl bg-rose-50/60 border border-rose-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-rose-900 uppercase tracking-wider">
                    Política de Cartera Crítica & Retiros
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-200 text-rose-900">
                    ≥ 3 Cuotas Vencidas
                  </span>
                </div>
                <p className="text-xs text-rose-800 leading-relaxed">
                  Todo crédito con 3 o más cuotas en estado vencida pasa de forma automática a la bandeja de Cartera Crítica para emisión de Orden de Retiro y Acta oficial de Restitución de Bienes con doble firma digital.
                </p>
                <div className="text-[11px] font-medium text-rose-700 flex items-center gap-1.5 pt-1">
                  <Info className="w-3.5 h-3.5" />
                  <span>Excluye contratos de 2 cuotas por política de mitigación de riesgo.</span>
                </div>
              </div>
            </div>

            {/* Vencimiento y Modalidad */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="p-4 rounded-xl border border-slate-200 bg-white">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                  Periodicidad de Cobro
                </span>
                <span className="text-base font-bold text-slate-900 mt-1 block">
                  Mensual Uniforme
                </span>
                <span className="text-xs text-slate-500 mt-0.5 block">
                  1 cuota por mes calendario
                </span>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-white">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                  Regla de Vencimiento
                </span>
                <span className="text-base font-bold text-slate-900 mt-1 block">
                  Último Día del Mes
                </span>
                <span className="text-xs text-slate-500 mt-0.5 block">
                  Cálculo automático de exigibilidad
                </span>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-white">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                  Tasa de Interés
                </span>
                <span className="text-base font-bold text-emerald-700 mt-1 block">
                  Financiación Integrada
                </span>
                <span className="text-xs text-slate-500 mt-0.5 block">
                  Cuotas fijas sin costos ocultos
                </span>
              </div>
            </div>
          </div>

          {/* Catálogo de Ciudades de Venta Autorizadas (Estructurado Departamento -> Municipio) */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-emerald-600" />
                  <span>Ciudades de Venta & Operación Comercial</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Catálogo geográfico estructurado (Departamento ➔ Municipio) para radicación comercial en POS y app móvil.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {Object.entries(catalogoDepartamentos).map(([dep, munis]) => (
                  <span
                    key={dep}
                    className={cn(
                      'text-xs font-bold px-2.5 py-1 rounded-full border',
                      dep === 'Córdoba'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-blue-50 text-blue-700 border-blue-200'
                    )}
                  >
                    {dep}: {Array.isArray(munis) ? munis.length : 0}
                  </span>
                ))}
                <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200">
                  {Object.values(catalogoDepartamentos).reduce(
                    (acc, l) => acc + (Array.isArray(l) ? l.length : 0),
                    0
                  )}{' '}
                  Total
                </span>
              </div>
            </div>

            {ciudadesFeedback && (
              <div
                className={cn(
                  'p-3.5 rounded-xl border text-xs font-medium flex items-center justify-between transition-all',
                  ciudadesFeedback.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-800'
                )}
              >
                <div className="flex items-center gap-2">
                  {ciudadesFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  )}
                  <span>{ciudadesFeedback.message}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCiudadesFeedback(null)}
                  className="text-slate-400 hover:text-slate-600 font-bold ml-2 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Formulario para agregar nueva localidad por Departamento */}
            <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Registrar Municipio o Nuevo Departamento
                </span>
                <span className="text-[11px] text-slate-500">
                  {modoNuevoDepartamento
                    ? 'Escriba el nombre del nuevo departamento y su primer municipio'
                    : 'Seleccione un departamento o registre uno nuevo'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <div className="sm:col-span-4">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                      Departamento *
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const nuevoModo = !modoNuevoDepartamento;
                        setModoNuevoDepartamento(nuevoModo);
                        if (!nuevoModo) setNuevoDepartamentoInput('');
                      }}
                      className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 underline cursor-pointer"
                    >
                      {modoNuevoDepartamento ? '← Elegir existente' : '＋ Nuevo Departamento'}
                    </button>
                  </div>
                  {modoNuevoDepartamento ? (
                    <input
                      type="text"
                      value={nuevoDepartamentoInput}
                      onChange={(e) => setNuevoDepartamentoInput(e.target.value)}
                      placeholder="Ej: Antioquia, Bolívar, Atlántico..."
                      autoFocus
                      className="w-full px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-900 bg-white border border-emerald-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition-all shadow-2xs placeholder:text-slate-400 h-[38px]"
                    />
                  ) : (
                    <select
                      value={departamentoSeleccionado}
                      onChange={(e) => setDepartamentoSeleccionado(e.target.value)}
                      className="w-full px-3 py-2 text-xs sm:text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition-all shadow-2xs cursor-pointer h-[38px]"
                    >
                      {Object.keys(catalogoDepartamentos).map((dep) => (
                        <option key={dep} value={dep}>
                          {dep} ({catalogoDepartamentos[dep]?.length || 0} mun.)
                        </option>
                      ))}
                      {!Object.keys(catalogoDepartamentos).includes('Córdoba') && (
                        <option value="Córdoba">Córdoba</option>
                      )}
                      {!Object.keys(catalogoDepartamentos).includes('Sucre') && (
                        <option value="Sucre">Sucre</option>
                      )}
                    </select>
                  )}
                </div>

                <div className="sm:col-span-5">
                  <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                    Nombre del Municipio *
                  </label>
                  <input
                    type="text"
                    value={nuevaCiudadInput}
                    onChange={(e) => setNuevaCiudadInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAgregarCiudad();
                      }
                    }}
                    placeholder={
                      modoNuevoDepartamento
                        ? 'Ej: Caucasia, Cartagena, Barranquilla...'
                        : `Ej: Municipio para ${departamentoSeleccionado}...`
                    }
                    className="w-full px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition-all shadow-2xs placeholder:text-slate-400 h-[38px]"
                  />
                </div>

                <div className="sm:col-span-3">
                  <button
                    type="button"
                    onClick={handleAgregarCiudad}
                    disabled={
                      isSavingCiudades ||
                      !nuevaCiudadInput.trim() ||
                      (modoNuevoDepartamento && !nuevoDepartamentoInput.trim())
                    }
                    className="w-full px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed h-[38px]"
                  >
                    {isSavingCiudades ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <span className="truncate">
                        ＋ Agregar a{' '}
                        {modoNuevoDepartamento
                          ? nuevoDepartamentoInput.trim() || 'Departamento'
                          : departamentoSeleccionado}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Filtros visuales y buscador de municipios */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                {['Todos', ...Object.keys(catalogoDepartamentos)].map((dep) => {
                  const active = tabDepartamentoActivo === dep;
                  const count =
                    dep === 'Todos'
                      ? Object.values(catalogoDepartamentos).reduce(
                          (acc, l) => acc + (Array.isArray(l) ? l.length : 0),
                          0
                        )
                      : catalogoDepartamentos[dep]?.length || 0;
                  return (
                    <button
                      key={dep}
                      type="button"
                      onClick={() => setTabDepartamentoActivo(dep)}
                      className={cn(
                        'px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer',
                        active
                          ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      )}
                    >
                      {dep} ({count})
                    </button>
                  );
                })}
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={filtroBusquedaMunicipio}
                  onChange={(e) => setFiltroBusquedaMunicipio(e.target.value)}
                  placeholder="Buscar municipio..."
                  className="w-full pl-8 pr-7 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-400 shadow-2xs"
                />
                {filtroBusquedaMunicipio && (
                  <button
                    type="button"
                    onClick={() => setFiltroBusquedaMunicipio('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Visualización por Departamentos */}
            <div className="space-y-5 pt-1">
              {Object.entries(catalogoDepartamentos)
                .filter(([dep]) => tabDepartamentoActivo === 'Todos' || tabDepartamentoActivo === dep)
                .map(([dep, munis]) => {
                  const q = filtroBusquedaMunicipio.trim().toLowerCase();
                  const munisFiltrados = (munis || []).filter(
                    (m) => !q || m.toLowerCase().includes(q) || dep.toLowerCase().includes(q)
                  );

                  return (
                    <div
                      key={dep}
                      className={cn(
                        'p-4 rounded-xl border transition-all',
                        dep === 'Córdoba'
                          ? 'bg-emerald-50/20 border-emerald-100'
                          : 'bg-blue-50/20 border-blue-100'
                      )}
                    >
                      <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200/60">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'w-2.5 h-2.5 rounded-full',
                              dep === 'Córdoba' ? 'bg-emerald-500' : 'bg-blue-500'
                            )}
                          />
                          <h3 className="text-sm font-bold text-slate-900">
                            Departamento de {dep}
                          </h3>
                        </div>
                        <span className="text-[11px] font-bold text-slate-500">
                          {munisFiltrados.length} de {munis.length} municipios
                        </span>
                      </div>

                      {munisFiltrados.length === 0 ? (
                        <p className="text-xs text-slate-400 italic py-2">
                          No se encontraron municipios que coincidan con la búsqueda en {dep}.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {munisFiltrados.map((m) => (
                            <div
                              key={`${dep}-${m}`}
                              className="flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-xl bg-white border border-slate-200 shadow-2xs font-semibold text-slate-800 text-xs hover:border-slate-300 transition-all group"
                            >
                              <span
                                className={cn(
                                  'text-[10px] font-bold',
                                  dep === 'Córdoba' ? 'text-emerald-600' : 'text-blue-600'
                                )}
                              >
                                📍
                              </span>
                              <span>{m}</span>
                              <button
                                type="button"
                                onClick={() => handleEliminarCiudad(dep, m)}
                                disabled={isSavingCiudades}
                                className="w-4 h-4 rounded-full text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center text-[10px] transition-colors cursor-pointer ml-1"
                                title={`Eliminar ${m} de ${dep}`}
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Información Institucional (Formulario Interactivo) */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-slate-700" />
                  <span>Identidad de la Compañía</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Datos membretados en comprobantes de venta, recibos digitales y actas de restitución.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
                  Configuración Institucional
                </span>
              </div>
            </div>

            {empresaFeedback && (
              <div
                className={cn(
                  'p-3.5 rounded-xl border flex items-center justify-between text-xs font-semibold',
                  empresaFeedback.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-800'
                )}
              >
                <div className="flex items-center gap-2">
                  {empresaFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  )}
                  <span>{empresaFeedback.message}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setEmpresaFeedback(null)}
                  className="text-slate-400 hover:text-slate-600 font-bold ml-2 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            )}

            <form onSubmit={handleGuardarEmpresa} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-slate-500" />
                    <span>Razón Social</span>
                  </label>
                  <input
                    type="text"
                    value={formEmpresa.razon_social}
                    onChange={(e) => setFormEmpresa({ ...formEmpresa, razon_social: e.target.value })}
                    placeholder="Remundial Arte's S.A.S."
                    className="w-full px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all shadow-2xs placeholder:text-slate-400"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
                    <span>NIT</span>
                  </label>
                  <input
                    type="text"
                    value={formEmpresa.nit}
                    onChange={(e) => setFormEmpresa({ ...formEmpresa, nit: e.target.value })}
                    placeholder="901.458.789-2"
                    className="w-full px-3.5 py-2 text-xs sm:text-sm font-mono font-semibold text-slate-900 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all shadow-2xs placeholder:text-slate-400"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-500" />
                    <span>Sede Principal</span>
                  </label>
                  <input
                    type="text"
                    value={formEmpresa.ciudad_principal}
                    onChange={(e) => setFormEmpresa({ ...formEmpresa, ciudad_principal: e.target.value })}
                    placeholder="Montería, Córdoba"
                    className="w-full px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all shadow-2xs placeholder:text-slate-400"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-500" />
                    <span>Línea de Atención</span>
                  </label>
                  <input
                    type="text"
                    value={formEmpresa.telefono_soporte}
                    onChange={(e) => setFormEmpresa({ ...formEmpresa, telefono_soporte: e.target.value })}
                    placeholder="3189998877"
                    className="w-full px-3.5 py-2 text-xs sm:text-sm font-mono font-semibold text-slate-900 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all shadow-2xs placeholder:text-slate-400"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={isSavingEmpresa}
                  className={cn(
                    'inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all duration-300 shadow-xs cursor-pointer disabled:opacity-50',
                    savedEmpresaSuccess
                      ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-2 border-emerald-500 shadow-emerald-500/15 scale-[1.02]'
                      : 'bg-slate-900 hover:bg-slate-800 text-white border border-transparent'
                  )}
                >
                  {isSavingEmpresa ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                      <span>Guardando Cambios...</span>
                    </>
                  ) : savedEmpresaSuccess ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 animate-in zoom-in-75 duration-200" />
                      <span>¡Guardado con éxito!</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span>Guardar Cambios</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONTENIDO PESTAÑA 2: MIGRACIÓN DE DATOS (CARGUE MASIVO) */}
      {activeTab === 'migracion' && (
        <div className="space-y-6">
          {/* Banner de Presentación */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl p-6 sm:p-8 shadow-sm">
            <div className="max-w-3xl space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-emerald-300 text-xs font-semibold backdrop-blur-xs">
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Módulo de Cargue Híbrido Oficial</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
                Importación y Reconstrucción Histórica de Cartera
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                Puebla masivamente el catálogo de inventario, registra clientes con sus respectivos codeudores y referencias familiares, y reconstruye contratos históricos con sus fechas reales y saldos insolutos, asegurando que tanto el panel gerencial como la app móvil del cobrador reflejen los datos reales.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* PASO 1: DESCARGA DE PLANTILLA OFICIAL */}
            <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs flex flex-col justify-between space-y-5">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200/80 flex items-center justify-center font-bold">
                    1
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Descargar Plantilla Oficial
                    </h3>
                    <p className="text-xs text-slate-500">
                      Archivo Excel estructurado en 4 hojas con reglas de negocio.
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/60 space-y-2 text-xs text-slate-600">
                  <p className="font-semibold text-slate-800">Hojas preconfiguradas en el libro:</p>
                  <ul className="space-y-1.5 list-disc list-inside">
                    <li><strong className="text-slate-700">Inventario:</strong> SKU, descripción, precio base, stock inicial.</li>
                    <li><strong className="text-slate-700">Clientes_y_Referencias:</strong> Cédula, datos de contacto, codeudor y familiar.</li>
                    <li><strong className="text-slate-700">Creditos_Historicos:</strong> Plazos válidos (2, 4, 6, 9), saldo real y fecha de origen.</li>
                    <li><strong className="text-slate-700">Instrucciones:</strong> Guía detallada paso a paso.</li>
                  </ul>
                </div>
              </div>

              <button
                type="button"
                onClick={handleDescargarPlantilla}
                disabled={isDownloading}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold shadow-xs transition-all cursor-pointer disabled:opacity-50"
              >
                {isDownloading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Generando Libro Excel...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Descargar Plantilla Oficial (.xlsx)</span>
                  </>
                )}
              </button>
            </div>

            {/* PASO 2: CARGUE DEL ARCHIVO DILIGENCIADO */}
            <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs flex flex-col justify-between space-y-5">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-800 border border-slate-300 flex items-center justify-center font-bold">
                    2
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Subir Libro Diligenciado
                    </h3>
                    <p className="text-xs text-slate-500">
                      El servidor procesará transaccionalmente cada registro sin alterar ventas previas.
                    </p>
                  </div>
                </div>

                {/* Zona Dropzone */}
                <label className="border-2 border-dashed border-slate-200 hover:border-slate-400 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors bg-slate-50/50 hover:bg-slate-50">
                  <UploadCloud className="w-8 h-8 text-slate-400" />
                  <span className="text-xs font-semibold text-slate-700 text-center">
                    {selectedFile ? (
                      <strong className="text-emerald-700">{selectedFile.name}</strong>
                    ) : (
                      'Arrastre su archivo Excel aquí o haga clic para examinar'
                    )}
                  </span>
                  <span className="text-[11px] text-slate-600">
                    Formatos admitidos: .xlsx, .xlsm
                  </span>
                  <input
                    type="file"
                    accept=".xlsx, .xlsm"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>

                {errorSubida && (
                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                    <span>{errorSubida}</span>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleSubirArchivo}
                disabled={!selectedFile || isUploading}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Validando e Importando Registros en Base de Datos...</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-4 h-4" />
                    <span>Iniciar Importación Masiva</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* PANEL DE RESULTADOS TRAS LA IMPORTACIÓN */}
          {resultadoMigracion && (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-6 animate-in fade-in duration-300">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                    <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-slate-900">
                      Resultado de la Migración Masiva
                    </h3>
                    <p className="text-xs text-emerald-700 font-medium">
                      {resultadoMigracion.mensaje}
                    </p>
                  </div>
                </div>

                <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-100 text-emerald-800">
                  Transacción Confirmada
                </span>
              </div>

              {/* Cards de Métricas de Migración */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Inventario */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Inventario & Catálogo
                    </span>
                    <Package className="w-4 h-4 text-slate-500" />
                  </div>
                  <span className="text-2xl font-black text-slate-900 block">
                    {resultadoMigracion.resumen.inventario_procesados}
                  </span>
                  <div className="text-[11px] text-slate-500 flex items-center gap-2">
                    <span className="text-emerald-700 font-semibold">
                      +{resultadoMigracion.resumen.inventario_creados} nuevos
                    </span>
                    <span>•</span>
                    <span>{resultadoMigracion.resumen.inventario_actualizados} actualizados</span>
                  </div>
                </div>

                {/* Clientes */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Clientes & Garantías
                    </span>
                    <Users className="w-4 h-4 text-slate-500" />
                  </div>
                  <span className="text-2xl font-black text-slate-900 block">
                    {resultadoMigracion.resumen.clientes_procesados}
                  </span>
                  <div className="text-[11px] text-slate-500 flex items-center gap-2">
                    <span className="text-emerald-700 font-semibold">
                      +{resultadoMigracion.resumen.clientes_creados} nuevos
                    </span>
                    <span>•</span>
                    <span>{resultadoMigracion.resumen.clientes_actualizados} vinculados</span>
                  </div>
                </div>

                {/* Créditos */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Créditos Históricos
                    </span>
                    <CreditCard className="w-4 h-4 text-slate-500" />
                  </div>
                  <span className="text-2xl font-black text-slate-900 block">
                    {resultadoMigracion.resumen.creditos_creados}
                  </span>
                  <div className="text-[11px] text-slate-500 flex items-center gap-2">
                    <span className="text-emerald-700 font-semibold">
                      {resultadoMigracion.resumen.creditos_creados} cargados con éxito
                    </span>
                    {resultadoMigracion.resumen.creditos_omitidos > 0 && (
                      <>
                        <span>•</span>
                        <span className="text-rose-600 font-semibold">
                          {resultadoMigracion.resumen.creditos_omitidos} omitidos
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Errores o advertencias si hubo filas omitidas */}
              {resultadoMigracion.errores.length > 0 && (
                <div className="space-y-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs">
                  <div className="flex items-center gap-2 text-amber-900 font-bold">
                    <AlertTriangle className="w-4 h-4 text-amber-700" />
                    <span>Observaciones y Filas no procesadas ({resultadoMigracion.errores.length})</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-amber-950">
                      <thead>
                        <tr className="border-b border-amber-200 text-amber-900 font-bold">
                          <th className="py-1.5 px-2">Hoja</th>
                          <th className="py-1.5 px-2">Fila</th>
                          <th className="py-1.5 px-2">Motivo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-100">
                        {resultadoMigracion.errores.map((err, idx) => (
                          <tr key={idx}>
                            <td className="py-1.5 px-2 font-mono">{err.hoja}</td>
                            <td className="py-1.5 px-2 font-bold">{err.fila}</td>
                            <td className="py-1.5 px-2">{err.motivo}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Accesos Rápidos para Validar Datos */}
              <div className="pt-2 flex flex-wrap items-center gap-3">
                <Link
                  href="/dashboard/creditos"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-2xs transition-all"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Ver Cartera de Créditos Actualizada</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>

                <Link
                  href="/dashboard/productos"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold transition-all"
                >
                  <Package className="w-4 h-4" />
                  <span>Consultar Catálogo de Inventario</span>
                </Link>

                <Link
                  href="/dashboard/clientes"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold transition-all"
                >
                  <Users className="w-4 h-4" />
                  <span>Ver Directorio de Clientes</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CONTENIDO PESTAÑA 3: PLANTILLAS Y TEXTOS PDF */}
      {activeTab === 'plantillas' && (
        <div className="space-y-6">
          {/* Header Banner */}
          <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 rounded-2xl p-6 text-white shadow-md relative overflow-hidden">
            <div className="absolute top-0 right-0 -mt-8 -mr-8 w-48 h-48 bg-sky-500/10 rounded-full blur-2xl pointer-events-none" />
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1.5 max-w-2xl">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-sky-500/20 text-sky-300 border border-sky-400/30">
                    Motor ReportLab Dinámico
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                    Resolución Carta Oficial
                  </span>
                </div>
                <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  <FileText className="w-5 h-5 text-sky-400" />
                  Personalización de Comprobantes, Contratos & Actas PDF
                </h2>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  Configura el membrete institucional, las cláusulas de venta a crédito y de contado, la certificación de abonos en ruta y el texto legal del acta de restitución de bienes. Cualquier ajuste se refleja de manera instantánea e inmutable en todos los documentos descargados.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Link
                  href="/dashboard/creditos"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold backdrop-blur-xs border border-white/20 transition-all"
                >
                  <CreditCard className="w-3.5 h-3.5 text-sky-300" />
                  <span>Probar Descargas en Cartera</span>
                </Link>
              </div>
            </div>
          </div>

          {/* Feedback Banner */}
          {pdfFeedback && (
            <div
              className={cn(
                'p-4 rounded-xl text-xs sm:text-sm font-medium flex items-center justify-between gap-3 border transition-all animate-in fade-in',
                pdfFeedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              )}
            >
              <div className="flex items-center gap-2">
                {pdfFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                )}
                <span>{pdfFeedback.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setPdfFeedback(null)}
                className="text-xs underline hover:opacity-80 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          )}

          {/* Tarjeta de Identidad Visual & Logotipo Oficial */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-6">
            <div className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  Identidad Visual & Logotipo Oficial del Sistema
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Carga el logotipo corporativo y personaliza los lemas mostrados en el Inicio de Sesión Web y en la App Móvil de Cobro.
                </p>
              </div>
              <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200/60 px-2.5 py-1 rounded-lg self-start sm:self-auto flex items-center gap-1.5">
                <Smartphone className="w-3 h-3" />
                Sincronización Web & Móvil
              </span>
            </div>

            {/* Feedback Visual */}
            {feedbackVisual && (
              <div
                className={cn(
                  'p-4 rounded-xl text-xs sm:text-sm font-medium flex items-center justify-between gap-3 border transition-all',
                  feedbackVisual.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-800'
                )}
              >
                <div className="flex items-center gap-2">
                  {feedbackVisual.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                  )}
                  <span>{feedbackVisual.message}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setFeedbackVisual(null)}
                  className="text-xs underline hover:opacity-80 cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Columna Izquierda: Selector de Archivo y Acciones de Logo */}
              <div className="lg:col-span-5 space-y-4">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Logotipo Corporativo (.png, .jpg, .svg)
                </label>

                <div className="p-4 rounded-2xl border-2 border-dashed border-slate-200 hover:border-indigo-400 bg-slate-50/50 flex flex-col items-center justify-center text-center transition-all group">
                  {logoPreviewUrl ? (
                    <div className="relative group/logo w-full flex flex-col items-center py-2">
                      <div className="w-36 h-28 bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-center shadow-xs overflow-hidden">
                        <img
                          src={logoPreviewUrl}
                          alt="Logotipo Remundial"
                          className="max-w-full max-h-full object-contain"
                        />
                      </div>
                      <span className="mt-2 text-xs font-medium text-emerald-700 flex items-center gap-1">
                        <Check className="w-3 h-3" /> Logotipo cargado en el sistema
                      </span>
                    </div>
                  ) : (
                    <div className="py-6 flex flex-col items-center">
                      <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3 group-hover:scale-105 transition-all">
                        <UploadCloud className="w-8 h-8" />
                      </div>
                      <p className="text-xs font-semibold text-slate-700">
                        Selecciona o arrastra una imagen
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        PNG, JPEG, WebP o SVG (máx. 5 MB)
                      </p>
                    </div>
                  )}

                  <input
                    id="logo-upload-input"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={handleLogoFileSelect}
                    className="hidden"
                  />

                  <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
                    <label
                      htmlFor="logo-upload-input"
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white border border-slate-300 hover:border-indigo-500 text-slate-700 hover:text-indigo-600 text-xs font-semibold shadow-xs transition-all cursor-pointer"
                    >
                      <UploadCloud className="w-3.5 h-3.5" />
                      <span>{logoPreviewUrl ? 'Cambiar Imagen' : 'Examinar Archivo'}</span>
                    </label>

                    {logoFile && (
                      <button
                        type="button"
                        onClick={handleSubirLogo}
                        disabled={isUploadingLogo}
                        className={cn(
                          'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-xs transition-all duration-300 cursor-pointer disabled:opacity-50',
                          savedLogoSuccess
                            ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-2 border-emerald-500 shadow-emerald-500/15 scale-[1.02]'
                            : 'bg-indigo-600 hover:bg-indigo-700 text-white border border-transparent'
                        )}
                      >
                        {isUploadingLogo ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Guardando...</span>
                          </>
                        ) : savedLogoSuccess ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 animate-in zoom-in-75 duration-200" />
                            <span>¡Guardado con éxito!</span>
                          </>
                        ) : (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Guardar Logo</span>
                          </>
                        )}
                      </button>
                    )}

                    {identidadVisual.tiene_logo && !logoFile && (
                      <button
                        type="button"
                        onClick={handleEliminarLogo}
                        disabled={isDeletingLogo}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
                        title="Restaurar al isotipo oficial del sistema"
                      >
                        {isDeletingLogo ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                        <span>Restaurar Predeterminado</span>
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-[11px] text-slate-500 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100">
                  💡 <strong>Recomendación de diseño:</strong> Para una visualización óptima en pantallas retina y móviles, usa una imagen con fondo transparente (PNG o SVG) de proporción cuadrada o panorámica ligera.
                </p>
              </div>

              {/* Columna Derecha: Vista Previa en Vivo (Simuladores Web & Móvil) */}
              <div className="lg:col-span-7 space-y-4">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-indigo-600" />
                  Vista Previa en Vivo de Pantallas de Acceso
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Simulador Web Login */}
                  <div className="p-4 rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 text-white border border-slate-800 shadow-md flex flex-col justify-between space-y-3 min-h-[190px]">
                    <div className="flex items-center justify-between border-b border-white/10 pb-2">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-rose-500" />
                        <div className="w-2 h-2 rounded-full bg-amber-500" />
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">Login Web (/login)</span>
                    </div>

                    <div className="flex flex-col items-center text-center space-y-2 py-1">
                      {logoPreviewUrl ? (
                        <div className="w-12 h-12 bg-white/10 backdrop-blur-xs rounded-xl p-1.5 flex items-center justify-center border border-white/20">
                          <img src={logoPreviewUrl} alt="Logo" className="max-w-full max-h-full object-contain" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white">
                          <Layers className="w-5 h-5" />
                        </div>
                      )}
                      <div>
                        <h4 className="text-xs font-bold tracking-tight text-white">
                          {formEmpresa.razon_social || "REMUNDIAL ARTE'S"}
                        </h4>
                        <p className="text-[10px] text-slate-300 mt-0.5 line-clamp-1">
                          {identidadVisual.eslogan_login || 'Plataforma Central de Crédito & Cobranza'}
                        </p>
                      </div>
                    </div>

                    <div className="border-t border-white/10 pt-2 text-[9px] text-slate-400 text-center line-clamp-1">
                      {identidadVisual.pie_login || 'Acceso restringido a colaboradores autorizados.'}
                    </div>
                  </div>

                  {/* Simulador Mobile App */}
                  <div className="p-4 rounded-2xl bg-gradient-to-b from-indigo-950 to-slate-900 text-white border border-indigo-900/60 shadow-md flex flex-col justify-between space-y-3 min-h-[190px]">
                    <div className="flex items-center justify-between border-b border-white/10 pb-2">
                      <Smartphone className="w-3.5 h-3.5 text-indigo-400" />
                      <span className="text-[10px] text-indigo-200 font-medium">App Móvil Cobrador</span>
                    </div>

                    <div className="flex flex-col items-center text-center space-y-2 py-1">
                      {logoPreviewUrl ? (
                        <div className="w-12 h-12 bg-white/15 backdrop-blur-xs rounded-2xl p-1.5 flex items-center justify-center border border-white/20">
                          <img src={logoPreviewUrl} alt="Logo" className="max-w-full max-h-full object-contain" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-2xl bg-white/15 flex items-center justify-center text-indigo-200">
                          <Layers className="w-5 h-5" />
                        </div>
                      )}
                      <div>
                        <h4 className="text-xs font-bold tracking-tight text-white">
                          {formEmpresa.razon_social || "REMUNDIAL ARTE'S"}
                        </h4>
                        <p className="text-[10px] text-indigo-200/90 mt-0.5 line-clamp-1">
                          {identidadVisual.eslogan_mobile || 'Operaciones de Campo & Cobranza'}
                        </p>
                      </div>
                    </div>

                    <div className="border-t border-white/10 pt-2 text-[9px] text-indigo-300/80 text-center line-clamp-1">
                      {identidadVisual.pie_mobile || 'Remundial Core • Campo'}
                    </div>
                  </div>
                </div>

                {/* Formulario de Eslóganes y Textos de Acceso */}
                <form onSubmit={handleGuardarIdentidadVisual} className="pt-2 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Eslógan en Inicio de Sesión Web
                      </label>
                      <input
                        type="text"
                        value={identidadVisual.eslogan_login}
                        onChange={(e) =>
                          setIdentidadVisual((prev) => ({ ...prev, eslogan_login: e.target.value }))
                        }
                        placeholder="Ej: Plataforma Central de Crédito & Cobranza"
                        className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-hidden transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Eslógan en App Móvil de Cobrador
                      </label>
                      <input
                        type="text"
                        value={identidadVisual.eslogan_mobile}
                        onChange={(e) =>
                          setIdentidadVisual((prev) => ({ ...prev, eslogan_mobile: e.target.value }))
                        }
                        placeholder="Ej: Plataforma Central de Campo & Cobranza"
                        className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-hidden transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Texto al Pie del Login Web
                      </label>
                      <input
                        type="text"
                        value={identidadVisual.pie_login}
                        onChange={(e) =>
                          setIdentidadVisual((prev) => ({ ...prev, pie_login: e.target.value }))
                        }
                        placeholder="Ej: Acceso restringido únicamente a colaboradores..."
                        className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-hidden transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Texto de Versión / Pie en Móvil
                      </label>
                      <input
                        type="text"
                        value={identidadVisual.pie_mobile}
                        onChange={(e) =>
                          setIdentidadVisual((prev) => ({ ...prev, pie_mobile: e.target.value }))
                        }
                        placeholder="Ej: Remundial Core v1.2.0 • Operaciones de Campo"
                        className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-hidden transition-all"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={isSavingVisual}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all duration-300 cursor-pointer disabled:opacity-50',
                        savedVisualSuccess
                          ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-2 border-emerald-500 font-bold shadow-emerald-500/15 scale-[1.02]'
                          : 'bg-slate-900 hover:bg-slate-800 text-white border border-transparent'
                      )}
                    >
                      {isSavingVisual ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                          <span>Guardando Textos...</span>
                        </>
                      ) : savedVisualSuccess ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 animate-in zoom-in-75 duration-200" />
                          <span>¡Guardado con éxito!</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Guardar Textos de Acceso</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>

          {/* Formulario Principal de Plantillas */}
          <form onSubmit={handleGuardarPdf} className="space-y-6">
            {/* Tarjeta 1: Membrete Corporativo Unificado */}
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-6">
              <div className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-indigo-600" />
                    Membrete Corporativo Unificado (Encabezado General)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Datos comerciales y de contacto que encabezan los comprobantes POS, recibos de recaudo y actas de restitución.
                  </p>
                </div>
                <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg self-start sm:self-auto">
                  Aplica a los 3 tipos de PDF
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Razón Social / Nombre Comercial *
                  </label>
                  <input
                    type="text"
                    required
                    value={formPdf.membrete.razon_social}
                    onChange={(e) =>
                      setFormPdf({
                        ...formPdf,
                        membrete: { ...formPdf.membrete, razon_social: e.target.value },
                      })
                    }
                    placeholder="REMUNDIAL ARTE'S"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Título principal en mayúsculas en el bloque superior izquierdo.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Subtítulo / Actividad Comercial *
                  </label>
                  <input
                    type="text"
                    required
                    value={formPdf.membrete.subtitulo}
                    onChange={(e) =>
                      setFormPdf({
                        ...formPdf,
                        membrete: { ...formPdf.membrete, subtitulo: e.target.value },
                      })
                    }
                    placeholder="Mueblería, Artesanías, Mecedoras & Cuadros por Encargo"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Línea descriptiva bajo la razón social.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    NIT / Identificación Tributaria
                  </label>
                  <input
                    type="text"
                    value={formPdf.membrete.nit}
                    onChange={(e) =>
                      setFormPdf({
                        ...formPdf,
                        membrete: { ...formPdf.membrete, nit: e.target.value },
                      })
                    }
                    placeholder="901.458.321-0 (Opcional o N/A)"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Opcional. Puedes guardarlo vacío o ingresar texto libre (ej: &quot;N/A&quot;).
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Régimen Tributario / Comercial
                  </label>
                  <input
                    type="text"
                    value={formPdf.membrete.regimen}
                    onChange={(e) =>
                      setFormPdf({
                        ...formPdf,
                        membrete: { ...formPdf.membrete, regimen: e.target.value },
                      })
                    }
                    placeholder="Régimen Comercial Colombiano (Opcional o N/A)"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Opcional. Puedes guardarlo vacío o ingresar texto libre (ej: &quot;N/A&quot;).
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Ciudad y Departamento Principal *
                  </label>
                  <input
                    type="text"
                    required
                    value={formPdf.membrete.ciudad}
                    onChange={(e) =>
                      setFormPdf({
                        ...formPdf,
                        membrete: { ...formPdf.membrete, ciudad: e.target.value },
                      })
                    }
                    placeholder="Montería - Córdoba"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Dirección Comercial / Sede Principal *
                  </label>
                  <input
                    type="text"
                    required
                    value={formPdf.membrete.direccion}
                    onChange={(e) =>
                      setFormPdf({
                        ...formPdf,
                        membrete: { ...formPdf.membrete, direccion: e.target.value },
                      })
                    }
                    placeholder="Carrera 5 # 31-20, Centro"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Teléfono PBX / Atención al Cliente *
                  </label>
                  <input
                    type="text"
                    required
                    value={formPdf.membrete.telefono_pbx}
                    onChange={(e) =>
                      setFormPdf({
                        ...formPdf,
                        membrete: { ...formPdf.membrete, telefono_pbx: e.target.value },
                      })
                    }
                    placeholder="(+57) 300 123 4567"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Correo Electrónico Institucional *
                  </label>
                  <input
                    type="email"
                    required
                    value={formPdf.membrete.correo}
                    onChange={(e) =>
                      setFormPdf({
                        ...formPdf,
                        membrete: { ...formPdf.membrete, correo: e.target.value },
                      })
                    }
                    placeholder="info@remundialartes.com"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all"
                  />
                </div>
              </div>
            </div>

            {/* Tarjeta 2: Cláusulas Generales de Venta & Financiación */}
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
              <div className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-600" />
                    Cláusulas Contractuales de Compraventa y Financiación
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Texto contractual impreso al reverso o pie del Comprobante Oficial de Venta a Crédito / Contado.
                  </p>
                </div>
                <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200/60 px-2.5 py-1 rounded-lg self-start sm:self-auto">
                  Recibo POS de Venta (CTR-XXXX)
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Cuerpo de Cláusulas Contractuales (Formato Texto / HTML simple)
                </label>
                <textarea
                  rows={6}
                  value={formPdf.clausulas_venta}
                  onChange={(e) =>
                    setFormPdf({
                      ...formPdf,
                      clausulas_venta: e.target.value,
                    })
                  }
                  placeholder="CLÁUSULAS GENERALES DE COMPRAVENTA Y FINANCIACIÓN:&#10;1. Objeto y Recepción...&#10;2. Cuadros al Óleo y Por Encargo...&#10;3. Plan de Pagos Mensual...&#10;4. Reserva de Dominio y Mérito Ejecutivo..."
                  className="w-full px-3 py-2.5 text-xs font-mono rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all leading-relaxed"
                />
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-2 text-[11px] text-slate-400">
                  <span>
                    Consejo: Puedes estructurar cláusulas con números o etiquetas <code>&lt;b&gt;negrita&lt;/b&gt;</code>. Los saltos de línea se interpretan de forma limpia.
                  </span>
                  <span>{formPdf.clausulas_venta?.length || 0} caracteres</span>
                </div>
              </div>
            </div>

            {/* Tarjeta 3: Certificación y Validez de Pago (Abonos de Cartera) */}
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
              <div className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-sky-600" />
                    Certificación de Recaudo y Validez Contable (Recibos de Abono)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Leyenda oficial que acredita el recaudo ante el cliente y ampara la amortización del saldo de cartera.
                  </p>
                </div>
                <span className="text-[11px] font-semibold text-sky-800 bg-sky-50 border border-sky-200/60 px-2.5 py-1 rounded-lg self-start sm:self-auto">
                  Recibo Oficial de Recaudo (REC-XXXX)
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Texto de Declaración Legal y Contable de Abono
                </label>
                <textarea
                  rows={4}
                  value={formPdf.certificacion_recaudo}
                  onChange={(e) =>
                    setFormPdf({
                      ...formPdf,
                      certificacion_recaudo: e.target.value,
                    })
                  }
                  placeholder="CERTIFICACIÓN DE PAGO: Este recibo digital certifica formalmente la recepción y registro del recaudo en las cuentas de Remundial Arte's..."
                  className="w-full px-3 py-2.5 text-xs font-mono rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all leading-relaxed"
                />
                <div className="flex items-center justify-between mt-2 text-[11px] text-slate-400">
                  <span>Impreso directamente sobre el bloque de doble firma (Cobrador y Cliente titular).</span>
                  <span>{formPdf.certificacion_recaudo?.length || 0} caracteres</span>
                </div>
              </div>
            </div>

            {/* Tarjeta 4: Acta Oficial de Restitución de Bienes (Mora Crítica) */}
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
              <div className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    Acta Oficial de Restitución y Retiro de Bienes (Mora Crítica)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Estipulación formal para la diligencia de recuperación prendaria y retiro voluntario de artículos por mora prolongada (≥ 3 cuotas).
                  </p>
                </div>
                <span className="text-[11px] font-semibold text-rose-800 bg-rose-50 border border-rose-200/60 px-2.5 py-1 rounded-lg self-start sm:self-auto">
                  Acta Legal de Restitución (ACTA-XXXX)
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Cláusula Legal de Entrega Material y Restitución Voluntaria
                </label>
                <textarea
                  rows={5}
                  value={formPdf.acta_restitucion.clausula_legal}
                  onChange={(e) =>
                    setFormPdf({
                      ...formPdf,
                      acta_restitucion: {
                        ...formPdf.acta_restitucion,
                        clausula_legal: e.target.value,
                      },
                    })
                  }
                  placeholder="CLÁUSULA DE ENTREGA Y RESTITUCIÓN VOLUNTARIA DE BIENES: En la fecha y hora señaladas en el encabezado, el CLIENTE / DEUDOR TITULAR hace entrega material, formal y pacífica a REMUNDIAL ARTE'S..."
                  className="w-full px-3 py-2.5 text-xs font-mono rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all leading-relaxed"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Dependencia Encargada (Encabezado)
                  </label>
                  <input
                    type="text"
                    value={formPdf.acta_restitucion.observaciones_defecto}
                    onChange={(e) =>
                      setFormPdf({
                        ...formPdf,
                        acta_restitucion: {
                          ...formPdf.acta_restitucion,
                          observaciones_defecto: e.target.value,
                        },
                      })
                    }
                    placeholder="Departamento de Cartera y Recuperación de Bienes"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Línea de área encargada en el membrete del acta.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Pie de Página Legal del Acta
                  </label>
                  <input
                    type="text"
                    value={formPdf.acta_restitucion.pie_pagina}
                    onChange={(e) =>
                      setFormPdf({
                        ...formPdf,
                        acta_restitucion: {
                          ...formPdf.acta_restitucion,
                          pie_pagina: e.target.value,
                        },
                      })
                    }
                    placeholder="Diligencia ejecutada conforme al régimen de garantías mobiliarias y reserva de dominio contractual."
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Subtexto de cierre bajo la doble firma digital.
                  </p>
                </div>
              </div>
            </div>

            {/* Barra de Acciones y Guardado */}
            <div className="sticky bottom-4 z-20 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200 p-4 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <Info className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>
                  Los cambios guardados se aplicarán de inmediato a los nuevos PDFs generados en la plataforma.
                </span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={isSavingPdf}
                  className={cn(
                    'w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-xs sm:text-sm font-semibold shadow-xs disabled:opacity-50 transition-all duration-300 cursor-pointer',
                    savedPdfSuccess
                      ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-2 border-emerald-500 font-bold shadow-emerald-500/15 scale-[1.02]'
                      : 'bg-slate-900 hover:bg-slate-800 text-white border border-transparent'
                  )}
                >
                  {isSavingPdf ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Guardando Plantillas...</span>
                    </>
                  ) : savedPdfSuccess ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 animate-in zoom-in-75 duration-200" />
                      <span>¡Guardado con éxito!</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Guardar Configuración de Documentos PDF</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* CONTENIDO PESTAÑA 4: RESPALDOS & BASE DE DATOS */}
      {activeTab === 'respaldos' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 rounded-2xl p-6 text-white shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1.5 max-w-2xl">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                    Motor SQLite Transaccional WAL
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-sky-500/20 text-sky-300 border border-sky-400/30">
                    Snapshots JSON Atómicos
                  </span>
                </div>
                <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  <Database className="w-5 h-5 text-emerald-400" />
                  Respaldos, Integridad y Resiliencia de Datos
                </h2>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  Supervisa la integridad del almacenamiento transaccional local, copias de seguridad de cartera histórica y configuración de políticas para asegurar cero pérdida de transacciones de recaudo.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                <Database className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">Base de Datos Principal</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Archivo de persistencia SQLite transaccional <code className="text-slate-800 font-mono bg-slate-100 px-1 py-0.5 rounded">backend/remundial.db</code> con modo Write-Ahead Logging (WAL) activado para concurrencia segura.
              </p>
              <div className="pt-2 flex items-center gap-2 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="w-4 h-4" />
                <span>Estado: En Línea y Saludable</span>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">Políticas Institucionales</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Persistencia JSON de alta disponibilidad en <code className="text-slate-800 font-mono bg-slate-100 px-1 py-0.5 rounded">storage/config_parametros.json</code> con respaldo atómico tras cada modificación del supervisor.
              </p>
              <div className="pt-2 flex items-center gap-2 text-xs font-semibold text-indigo-700">
                <CheckCircle2 className="w-4 h-4" />
                <span>Sincronización Inmediata</span>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">Histórico de Migración Masiva</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Cada cargue masivo Excel genera una transacción atómica verificada con registro de auditoría de contratos importados y saldos iniciales.
              </p>
              <div className="pt-2 flex items-center gap-2 text-xs font-semibold text-amber-700">
                <CheckCircle2 className="w-4 h-4" />
                <span>Auditoría Híbrida Habilitada</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notificación Flotante Elegante (Toast Tailwind) */}
      <div
        className={cn(
          'fixed top-5 right-5 sm:top-6 sm:right-6 z-50 max-w-sm sm:max-w-md w-full pointer-events-auto transition-all duration-300 ease-out transform',
          toast
            ? 'translate-y-0 opacity-100 scale-100'
            : '-translate-y-4 opacity-0 scale-95 pointer-events-none'
        )}
      >
        {toast && (
          <div className="bg-white/95 backdrop-blur-md rounded-2xl border border-emerald-200/90 p-4 shadow-xl shadow-slate-900/10 flex items-start gap-3.5 relative overflow-hidden">
            {/* Acento verde institucional lateral */}
            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-emerald-500 rounded-l-2xl" />

            {/* Ícono de verificación institucional */}
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200/60 flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
              <CheckCircle2 className="w-5 h-5" />
            </div>

            <div className="flex-1 min-w-0 pr-1">
              <div className="flex items-center gap-2">
                <h4 className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                  {toast.title}
                </h4>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200/60 shrink-0">
                  Éxito
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                {toast.message}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors shrink-0 cursor-pointer"
              title="Cerrar notificación"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
