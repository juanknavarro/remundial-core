'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  CreditCard,
  Banknote,
  User,
  Package,
  Calendar,
  CheckCircle2,
  DollarSign,
  Plus,
  Trash2,
  Sparkles,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  MapPin,
  Phone,
  Layers,
  FileText,
  Clock,
  ArrowRight,
  Send,
  AlertCircle,
  Armchair,
  Palette,
  Check,
  Receipt,
  HelpCircle,
  Search,
  PenTool,
} from 'lucide-react';
import { formatCOP, cn } from '@/lib/utils';
import { api } from '@/lib/api';
import WebSignaturePad from '@/components/WebSignaturePad';

export type ModalidadVenta = 'credito' | 'contado';

interface ArticuloCatalogo {
  id: string;
  sku: string;
  nombre: string;
  precio_base: number;
  es_precio_variable: boolean;
  categoria: 'mecedora' | 'arte' | 'mueble';
  stock?: number;
  maneja_stock?: boolean;
}

interface ItemCarrito {
  id: string;
  producto_id: string;
  sku: string;
  nombre: string;
  precio_base: number;
  valor_unitario_acordado: number;
  cantidad: number;
  es_precio_variable: boolean;
  subtotal: number;
}

const CATALOGO_DEPARTAMENTOS_DEFAULT: Record<string, string[]> = {
  'Córdoba': [
    'Montería', 'Ayapel', 'Buenavista', 'Canalete', 'Cereté', 'Chimá', 'Chinú',
    'Ciénaga de Oro', 'Cotorra', 'La Apartada', 'Lorica', 'Los Córdobas', 'Momil',
    'Montelíbano', 'Moñitos', 'Planeta Rica', 'Pueblo Nuevo', 'Puerto Escondido',
    'Puerto Libertador', 'Purísima', 'Sahagún', 'San Andrés de Sotavento',
    'San Antero', 'San Bernardo del Viento', 'San Carlos', 'San José de Uré',
    'San Pelayo', 'Tierralta', 'Tuchín', 'Valencia'
  ],
  'Sucre': [
    'Sincelejo', 'Buenavista', 'Caimito', 'Colosó', 'Corozal', 'Coveñas',
    'Chalán', 'El Roble', 'Galeras', 'Guaranda', 'La Unión', 'Los Palmitos',
    'Majagual', 'Morroa', 'Ovejas', 'Palmito', 'Sampués', 'San Benito Abad',
    'San Juan de Betulia', 'San Marcos', 'San Onofre', 'San Pedro', 'Sincé',
    'Sucre', 'Tolú', 'Toluviejo'
  ]
};

export default function PosOriginacionCreditoPage() {
  // ==========================================
  // SELECTOR DE MODALIDAD: CRÉDITO VS CONTADO
  // ==========================================
  const [modalidadVenta, setModalidadVenta] = useState<ModalidadVenta>('credito');

  // ==========================================
  // SECCIÓN 1: DATOS DEL CLIENTE Y CODEUDOR
  // ==========================================
  const [cedula, setCedula] = useState('');
  const [nombres, setNombres] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
  const [barrio, setBarrio] = useState('');
  const [departamento, setDepartamento] = useState('Córdoba');
  const [ciudad, setCiudad] = useState('Montería');
  const [catalogoDepartamentos, setCatalogoDepartamentos] = useState<Record<string, string[]>>(CATALOGO_DEPARTAMENTOS_DEFAULT);
  const [numeroContrato, setNumeroContrato] = useState('');
  const [contratoAutomatico, setContratoAutomatico] = useState(true);

  // Cambio de departamento con ajuste automático de municipio
  const handleCambiarDepartamento = (nuevoDep: string) => {
    setDepartamento(nuevoDep);
    const munis = catalogoDepartamentos[nuevoDep] || [];
    if (munis.length > 0) {
      setCiudad(munis[0]);
    }
  };

  // Búsqueda y autocompletado en tiempo real de cliente existente por Cédula
  const [isSearchingClient, setIsSearchingClient] = useState(false);
  const [clienteEncontrado, setClienteEncontrado] = useState<string | null>(null);
  const [clienteNoEncontrado, setClienteNoEncontrado] = useState(false);

  // Estado de Herencia Inteligente de Garantías (Codeudor y Referencia)
  const [garantiasHeredadas, setGarantiasHeredadas] = useState(false);
  const [permitirModificarGarantias, setPermitirModificarGarantias] = useState(true);

  const buscarClientePorCedula = async (cedulaInput?: string) => {
    const doc = (cedulaInput !== undefined ? cedulaInput : cedula).trim().replace(/[.-]/g, '');
    if (!doc || doc.length < 4) return;

    setIsSearchingClient(true);
    setClienteNoEncontrado(false);

    try {
      const res = await api.get(`/clientes/cedula/${doc}`);
      if (res.data) {
        const c = res.data;
        setNombres(c.nombres || '');
        if (c.telefono) setTelefono(c.telefono);
        if (c.direccion) setDireccion(c.direccion);
        if (c.barrio) setBarrio(c.barrio);
        if (c.ciudad) {
          setCiudad(c.ciudad);
          const sucreMunis = catalogoDepartamentos['Sucre'] || [];
          if (sucreMunis.some((m) => m.toLowerCase() === c.ciudad.toLowerCase())) {
            setDepartamento('Sucre');
          } else {
            setDepartamento('Córdoba');
          }
        }
        setClienteEncontrado(c.nombres);

        // Herencia Inteligente de Garantías (Codeudor y Referencia)
        if (c.codeudor || c.referencia_familiar) {
          if (c.codeudor) {
            setCodeudorNombre(c.codeudor.nombre || '');
            setCodeudorCedula(c.codeudor.cedula || '');
            setCodeudorTelefono(c.codeudor.telefono || '');
            setCodeudorDireccion(c.codeudor.direccion || '');
          }
          if (c.referencia_familiar) {
            setReferenciaNombre(c.referencia_familiar.nombre || '');
            setReferenciaTelefono(c.referencia_familiar.telefono || '');
            setReferenciaParentesco(c.referencia_familiar.parentesco || 'Familiar');
          }
          setGarantiasHeredadas(true);
          setPermitirModificarGarantias(false);
        } else {
          setGarantiasHeredadas(false);
          setPermitirModificarGarantias(true);
        }
      }
    } catch (err: any) {
      if (err.response?.status === 404) {
        setClienteNoEncontrado(true);
        setClienteEncontrado(null);
        setGarantiasHeredadas(false);
        setPermitirModificarGarantias(true);
      }
    } finally {
      setIsSearchingClient(false);
    }
  };

  // Bloque 1: Datos del Codeudor Solidario (Independiente)
  const [codeudorNombre, setCodeudorNombre] = useState('');
  const [codeudorCedula, setCodeudorCedula] = useState('');
  const [codeudorTelefono, setCodeudorTelefono] = useState('');
  const [codeudorDireccion, setCodeudorDireccion] = useState('');

  // Bloque 2: Datos de la Referencia Familiar (Independiente)
  const [referenciaNombre, setReferenciaNombre] = useState('');
  const [referenciaTelefono, setReferenciaTelefono] = useState('');
  const [referenciaParentesco, setReferenciaParentesco] = useState('Familiar');

  // ==========================================
  // SECCIÓN 2: CATÁLOGO Y ARTÍCULOS EN VENTA
  // ==========================================
  const [catalogo, setCatalogo] = useState<ArticuloCatalogo[]>([]);
  const [productoSeleccionadoId, setProductoSeleccionadoId] = useState<string>('');
  const [precioAcordadoInput, setPrecioAcordadoInput] = useState<number>(0);
  const [cantidadInput, setCantidadInput] = useState<number>(1);
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);

  // ==========================================
  // SECCIÓN 3: CONDICIONES FINANCIERAS
  // ==========================================
  const PLAZOS_CUOTAS_PERMITIDOS = [
    { cuotas: 9, label: '9 cuotas', descripcion: '9 periodos', badge: null },
    { cuotas: 6, label: '6 cuotas', descripcion: '6 periodos', badge: null },
    { cuotas: 4, label: '4 cuotas', descripcion: 'Cuota Inicial + 3 periodos', badge: 'Inicial + 3' },
    { cuotas: 2, label: '2 cuotas', descripcion: '2 periodos', badge: null },
  ] as const;

  const getFechaPrimerVencimientoFinMes = (baseDate: Date = new Date()): string => {
    // Mes siguiente a la fecha de compra fijado al último día del mes
    // Ej: Septiembre -> 31 de Octubre
    const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + 2, 0);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const tipoPago = 'mensual';
  const [cuotaInicial, setCuotaInicial] = useState<number>(0);
  const [numeroCuotas, setNumeroCuotas] = useState<number>(4);
  const [fechaPrimeraCuota, setFechaPrimeraCuota] = useState<string>(() => getFechaPrimerVencimientoFinMes());

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDescargandoPdf, setIsDescargandoPdf] = useState(false);
  const [contratoExitoso, setContratoExitoso] = useState<{
    id_contrato: string;
    codigo_contrato?: string;
    numero_contrato?: string;
    ciudad_venta?: string;
    departamento_venta?: string;
    cliente: string;
    monto_financiado: number;
    valor_cuota: number;
    cuotas: number;
    modalidad: string;
    esContado: boolean;
    firmadoDigitalmente?: boolean;
    firmaClienteRegistrada?: boolean;
    firmaSupervisorRegistrada?: boolean;
    firmaCodeudorRegistrada?: boolean;
  } | null>(null);

  // Modo Dual/Triple de Firma Digital (Tableta USB / Stylus / Puntero)
  const [habilitarFirmaDigital, setHabilitarFirmaDigital] = useState(false);
  const [firmaCliente, setFirmaCliente] = useState<string | null>(null);
  const [firmaCodeudor, setFirmaCodeudor] = useState<string | null>(null);
  const [firmaSupervisor, setFirmaSupervisor] = useState<string | null>(null);

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
      alert('No fue posible generar el recibo en PDF. Verifique que el contrato se encuentre registrado.');
    } finally {
      setIsDescargandoPdf(false);
    }
  };

  // Cargar productos reales desde FastAPI al montar
  useEffect(() => {
    const fetchProductos = async () => {
      try {
        const res = await api.get('/productos');
        if (Array.isArray(res.data)) {
          const prodsFormateados: ArticuloCatalogo[] = res.data.map((p: any) => ({
            id: p.id,
            sku: p.sku,
            nombre: p.nombre,
            precio_base: parseFloat(p.precio_base) || 0,
            es_precio_variable: Boolean(p.es_precio_variable),
            categoria: p.es_precio_variable ? 'arte' : 'mecedora',
            stock: typeof p.stock === 'number' ? p.stock : 0,
            maneja_stock: p.maneja_stock !== false,
          }));
          setCatalogo(prodsFormateados);
          if (prodsFormateados.length > 0) {
            setProductoSeleccionadoId(prodsFormateados[0].id);
            setPrecioAcordadoInput(prodsFormateados[0].precio_base);
          } else {
            setProductoSeleccionadoId('');
            setPrecioAcordadoInput(0);
          }
        }
      } catch (error) {
        console.error('Error al cargar catálogo de productos:', error);
      }
    };

    const fetchCiudades = async () => {
      try {
        const res = await api.get('/config/ciudades');
        const data = res.data;
        if (data?.departamentos && typeof data.departamentos === 'object' && !Array.isArray(data.departamentos)) {
          setCatalogoDepartamentos(data.departamentos);
        } else if (data?.ciudades && typeof data.ciudades === 'object' && !Array.isArray(data.ciudades)) {
          setCatalogoDepartamentos(data.ciudades);
        } else if (Array.isArray(data?.ciudades_plano) || Array.isArray(data?.ciudades)) {
          const list = (data?.ciudades_plano || data?.ciudades) as string[];
          setCatalogoDepartamentos({
            'Córdoba': list,
            'Sucre': CATALOGO_DEPARTAMENTOS_DEFAULT['Sucre'],
          });
        }
      } catch (err) {
        console.warn('[POS] Error cargando catálogo de ciudades estructurado, usando respaldo:', err);
      }
    };

    fetchProductos();
    fetchCiudades();
  }, []);

  // Actualizar precio de entrada al cambiar de producto seleccionado
  const handleSeleccionarProducto = (prodId: string) => {
    setProductoSeleccionadoId(prodId);
    const prod = catalogo.find((p) => p.id === prodId);
    if (prod) {
      setPrecioAcordadoInput(prod.precio_base);
    }
  };

  // Agregar producto al carrito
  const handleAgregarAlCarrito = () => {
    const prod = catalogo.find((p) => p.id === productoSeleccionadoId);
    if (!prod) return;

    // Validación preventiva en cliente para artículos con stock físico
    const itemEnCarrito = carrito.find((item) => item.producto_id === prod.id);
    const cantidadTotal = (itemEnCarrito ? itemEnCarrito.cantidad : 0) + cantidadInput;
    if (prod.maneja_stock && (prod.stock ?? 0) < cantidadTotal) {
      alert(
        `Existencias insuficientes para "${prod.nombre}".\n` +
        `Disponible en almacén: ${prod.stock ?? 0} unidades.\n` +
        `Solicitado: ${cantidadTotal} unidades.`
      );
      return;
    }

    const precioFinal = prod.es_precio_variable ? Number(precioAcordadoInput) || prod.precio_base : prod.precio_base;
    const subtotalItem = precioFinal * cantidadInput;

    setCarrito((prev) => {
      const existe = prev.find((item) => item.producto_id === prod.id);
      if (existe) {
        return prev.map((item) =>
          item.producto_id === prod.id
            ? {
                ...item,
                cantidad: item.cantidad + cantidadInput,
                valor_unitario_acordado: precioFinal,
                subtotal: (item.cantidad + cantidadInput) * precioFinal,
              }
            : item
        );
      }
      return [
        ...prev,
        {
          id: `item-${Date.now()}-${Math.random()}`,
          producto_id: prod.id,
          sku: prod.sku,
          nombre: prod.nombre,
          precio_base: prod.precio_base,
          valor_unitario_acordado: precioFinal,
          cantidad: cantidadInput,
          es_precio_variable: prod.es_precio_variable,
          subtotal: subtotalItem,
        },
      ];
    });

    setCantidadInput(1);
  };

  const handleEliminarItem = (itemId: string) => {
    setCarrito((prev) => prev.filter((i) => i.id !== itemId));
  };

  // CÁLCULOS FINANCIEROS EN TIEMPO REAL
  const totalVenta = carrito.reduce((acc, item) => acc + item.subtotal, 0);

  // Si es Venta de Contado:
  // - Cuota inicial = Total Venta
  // - Monto financiado = 0
  // - Saldo pendiente = 0
  // - Valor cuota periódica = 0
  const esContado = modalidadVenta === 'contado';
  const cuotaInicialEfectiva = esContado ? totalVenta : (Number(cuotaInicial) || 0);
  const montoFinanciado = esContado ? 0 : Math.max(0, totalVenta - cuotaInicialEfectiva);
  const valorCuotaCalculado = esContado ? 0 : (numeroCuotas > 0 ? Math.round(montoFinanciado / numeroCuotas) : 0);

  // PROCESAR Y ENVIAR AL BACKEND FASTAPI
  const handleEnviarVenta = async () => {
    if (!nombres.trim() || !cedula.trim()) {
      alert('Por favor complete la identificación y el nombre completo del cliente titular.');
      return;
    }

    if (carrito.length === 0) {
      alert('Debe agregar al menos un producto al carrito de la venta.');
      return;
    }

    setIsSubmitting(true);

    // 1. Resolver o registrar el cliente titular en el backend
    let resolvedClienteId = 'c937b363-36a9-4273-ab34-b382be898a4e'; // ID predeterminado de respaldo
    try {
      const cleanCedula = cedula.replace(/[^\w]/g, '').trim();
      const resClientes = await api.get(`/clientes?search=${encodeURIComponent(cleanCedula)}`);
      const match = resClientes.data?.find(
        (c: any) => c.cedula.replace(/[^\w]/g, '') === cleanCedula
      );
      if (match) {
        resolvedClienteId = match.id;
      } else {
        const nuevoClienteRes = await api.post('/clientes', {
          cedula: cleanCedula || `CC-${Date.now()}`,
          nombres: nombres.trim(),
          telefono: telefono.trim() || '3000000000',
          direccion: direccion.trim() || 'Calle Principal # 1-1',
          barrio: barrio.trim() || 'Centro',
          ciudad: ciudad.trim() || 'Montería',
        });
        resolvedClienteId = nuevoClienteRes.data.id;
      }
    } catch {
      // Si ocurre un error resolviendo el cliente, continúa con cliente predeterminado
    }

    // 2. Resolver usuario en sesión y supervisión
    let vendedorId: string | null = null;
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('remundial_user');
        if (stored) {
          const userObj = JSON.parse(stored);
          vendedorId = userObj?.id || null;
        }
      } catch {
        // Fallback
      }
    }
    if (!vendedorId) {
      vendedorId = 'e24cb0d1-49c5-46a1-8fff-08645a11fc06'; // Juan Vendedor por defecto
    }
    const supervisorId = '66b28f2f-7c15-47e0-9751-965fb51ed314'; // Ana Supervisora

    const payload: any = {
      cliente_id: resolvedClienteId,
      vendedor_id: vendedorId,
      supervisor_id: supervisorId,
      cobrador_id: null, // Los créditos nacen estrictamente limpios de ruta y cobrador
      estado: esContado ? 'terminado' : 'pendiente',
      tipo_pago: esContado ? 'mensual' : tipoPago,
      cuota_inicial: cuotaInicialEfectiva,
      monto_financiado: montoFinanciado,
      numero_cuotas: esContado ? 1 : numeroCuotas,
      valor_cuota: valorCuotaCalculado,
      fecha_primera_cuota: fechaPrimeraCuota,
      saldo_pendiente: esContado ? 0 : montoFinanciado,
      ciudad_venta: ciudad.trim() || 'Montería',
      departamento_venta: departamento.trim() || 'Córdoba',
      generacion_automatica_contrato: contratoAutomatico,
      ...(!contratoAutomatico && numeroContrato.trim() ? { numero_contrato: numeroContrato.trim() } : {}),
      detalles: carrito.map((item) => ({
        producto_id: item.producto_id,
        cantidad: item.cantidad,
        valor_unitario_acordado: item.valor_unitario_acordado,
      })),
    };

    // Bloques independientes de garantías de respaldo para ventas a crédito
    if (!esContado) {
      if (codeudorNombre.trim()) {
        payload.codeudor = {
          nombre: codeudorNombre.trim(),
          cedula: codeudorCedula.trim() || undefined,
          telefono: codeudorTelefono.trim() || undefined,
          direccion: codeudorDireccion.trim() || undefined,
        };
      }
      if (referenciaNombre.trim()) {
        payload.referencia = {
          nombre: referenciaNombre.trim(),
          telefono: referenciaTelefono.trim() || undefined,
          parentesco: referenciaParentesco.trim() || 'Familiar',
        };
      }
    }

    // Validación de firmas obligatorias si el Modo Digital está activo en ventas a crédito
    if (habilitarFirmaDigital && !esContado) {
      if (!firmaCliente) {
        alert('En Modo Digital, la firma de conformidad del cliente titular es obligatoria.');
        setIsSubmitting(false);
        return;
      }
      if (!firmaSupervisor) {
        alert('En Modo Digital, la firma del supervisor / asesor autorizado es obligatoria.');
        setIsSubmitting(false);
        return;
      }
    }

    // Adjuntar firmas digitales si el modo digital está activo y se capturaron trazos
    if (habilitarFirmaDigital) {
      if (firmaCliente) {
        payload.firma_cliente = firmaCliente;
        payload.firma_titular = firmaCliente;
      }
      if (firmaSupervisor) {
        payload.firma_supervisor = firmaSupervisor;
        payload.firma_vendedor = firmaSupervisor;
      }
      if (firmaCodeudor) {
        payload.firma_codeudor = firmaCodeudor;
      }
    }

    try {
      const res = await api.post('/creditos', payload);
      const nuevoContratoId = res.data?.id_contrato || `CTR-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const codigoContrato = res.data?.codigo_contrato || (typeof nuevoContratoId === 'string' && nuevoContratoId.startsWith('CTR-') ? nuevoContratoId : `CTR-${String(nuevoContratoId).slice(0, 8).toUpperCase()}`);

      setContratoExitoso({
        id_contrato: nuevoContratoId,
        codigo_contrato: codigoContrato,
        numero_contrato: res.data?.numero_contrato || (numeroContrato.trim() || undefined),
        ciudad_venta: res.data?.ciudad_venta || ciudad.trim() || 'Montería',
        departamento_venta: res.data?.departamento_venta || departamento.trim() || 'Córdoba',
        cliente: nombres,
        monto_financiado: montoFinanciado,
        valor_cuota: valorCuotaCalculado,
        cuotas: esContado ? 1 : numeroCuotas,
        modalidad: esContado ? 'CONTADO EFECTIVO' : tipoPago.toUpperCase(),
        esContado,
        firmadoDigitalmente: Boolean(habilitarFirmaDigital && (firmaCliente || firmaSupervisor || firmaCodeudor)),
        firmaClienteRegistrada: Boolean(habilitarFirmaDigital && firmaCliente),
        firmaSupervisorRegistrada: Boolean(habilitarFirmaDigital && firmaSupervisor),
        firmaCodeudorRegistrada: Boolean(habilitarFirmaDigital && firmaCodeudor),
      });
    } catch (error: any) {
      console.error('Error registrando operación en POS:', error);
      const msg = error?.response?.data?.detail || 'No fue posible registrar la venta en el servidor.';
      alert(`Error al registrar operación: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const prodSeleccionado = catalogo.find((p) => p.id === productoSeleccionadoId);

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-20">
      
      {/* CABECERA SUPERIOR CON SWITCH DE MODALIDAD */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span
              className={cn(
                'text-[11px] font-bold px-2.5 py-0.5 rounded-full border uppercase tracking-wider',
                esContado
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              )}
            >
              {esContado ? 'Liquidación Inmediata' : 'Venta a Crédito'}
            </span>
            <span className="text-xs text-slate-600">• Terminal POS Remundial</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Punto de Venta (POS)
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Seleccione la modalidad de operación, cargue los artículos y configure el cierre financiero.
          </p>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SELECTOR DE MODALIDAD DE VENTA (PESTAÑAS ELEGANTES MODERNAS) */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-2xl p-2 sm:p-2.5 border border-slate-200/80 shadow-xs">
        <div className="grid grid-cols-2 gap-2">
          
          {/* Opción A: Venta a Crédito */}
          <button
            type="button"
            onClick={() => setModalidadVenta('credito')}
            className={cn(
              'flex items-center justify-center sm:justify-start gap-3 p-3.5 sm:p-4 rounded-xl text-left transition-all cursor-pointer border',
              modalidadVenta === 'credito'
                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                : 'bg-white text-slate-700 border-transparent hover:bg-slate-50'
            )}
          >
            <div
              className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors',
                modalidadVenta === 'credito' ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-700'
              )}
            >
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm sm:text-base block">Venta a Crédito</span>
                {modalidadVenta === 'credito' && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </div>
              <span className={cn('text-xs block', modalidadVenta === 'credito' ? 'text-slate-300' : 'text-slate-600')}>
                Financiamiento por cuotas con cobro periódico en terreno
              </span>
            </div>
          </button>

          {/* Opción B: Venta de Contado */}
          <button
            type="button"
            onClick={() => {
              setModalidadVenta('contado');
              setCuotaInicial(0); // Se igualará automáticamente al total de artículos
            }}
            className={cn(
              'flex items-center justify-center sm:justify-start gap-3 p-3.5 sm:p-4 rounded-xl text-left transition-all cursor-pointer border',
              modalidadVenta === 'contado'
                ? 'bg-emerald-700 text-white border-emerald-700 shadow-sm'
                : 'bg-white text-slate-700 border-transparent hover:bg-slate-50'
            )}
          >
            <div
              className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors',
                modalidadVenta === 'contado' ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-700'
              )}
            >
              <Banknote className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm sm:text-base block">Venta de Contado</span>
                {modalidadVenta === 'contado' && (
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                )}
              </div>
              <span className={cn('text-xs block', modalidadVenta === 'contado' ? 'text-emerald-100' : 'text-slate-600')}>
                Pago inmediato 100% en efectivo, sin cuotas ni saldo pendiente
              </span>
            </div>
          </button>

        </div>
      </div>

      {/* MODAL DE ÉXITO TRAS RADICAR VENTA */}
      {contratoExitoso && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl w-full max-w-lg border border-slate-200 shadow-2xl p-8 space-y-6 text-center animate-in zoom-in-95">
            <div
              className={cn(
                'w-16 h-16 rounded-2xl border flex items-center justify-center mx-auto shadow-xs',
                contratoExitoso.esContado
                  ? 'bg-blue-50 text-blue-600 border-blue-100'
                  : 'bg-emerald-50 text-emerald-600 border-emerald-100'
              )}
            >
              {contratoExitoso.esContado ? <Receipt className="w-9 h-9" /> : <CheckCircle2 className="w-9 h-9" />}
            </div>

            <div className="space-y-1">
              <span
                className={cn(
                  'text-xs font-bold uppercase tracking-wider',
                  contratoExitoso.esContado ? 'text-blue-700' : 'text-emerald-700'
                )}
              >
                {contratoExitoso.esContado ? 'Factura Emitida • Contado' : 'Solicitud Radicada • Crédito'}
              </span>
              <h2 className="text-2xl font-bold text-slate-900">
                {contratoExitoso.esContado
                  ? '¡Venta de Contado Liquidada!'
                  : '¡Crédito Enviado a Supervisor!'}
              </h2>
              <p className="text-xs text-slate-600">
                {contratoExitoso.esContado
                  ? 'El comprobante ha sido registrado con saldo cero ($0 COP) y mercancía lista para despacho.'
                  : 'El contrato ha ingresado a la bandeja de auditoría del supervisor para revisión y desembolso.'}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-left font-mono text-xs space-y-2">
              <div className="flex justify-between border-b border-slate-200/60 pb-1.5">
                <span className="text-slate-600 font-sans">N° Contrato / Sistema:</span>
                <span className="font-bold text-slate-900">{contratoExitoso.codigo_contrato || contratoExitoso.id_contrato}</span>
              </div>
              {contratoExitoso.numero_contrato && (
                <div className="flex justify-between border-b border-slate-200/60 pb-1.5">
                  <span className="text-slate-600 font-sans">Folio Físico / Talonario:</span>
                  <span className="font-bold text-emerald-700">{contratoExitoso.numero_contrato}</span>
                </div>
              )}
              {contratoExitoso.ciudad_venta && (
                <div className="flex justify-between border-b border-slate-200/60 pb-1.5">
                  <span className="text-slate-600 font-sans">Ubicación Comercial:</span>
                  <span className="font-bold text-slate-900">
                    {contratoExitoso.ciudad_venta}{contratoExitoso.departamento_venta ? `, ${contratoExitoso.departamento_venta}` : ''}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-b border-slate-200/60 pb-1.5">
                <span className="text-slate-600 font-sans">Titular:</span>
                <span className="font-bold text-slate-900">{contratoExitoso.cliente}</span>
              </div>
              <div className="flex justify-between border-b border-slate-200/60 pb-1.5">
                <span className="text-slate-600 font-sans">Modalidad:</span>
                <span className="font-bold text-slate-900">{contratoExitoso.modalidad}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 font-sans">Estado Financiero:</span>
                <span
                  className={cn(
                    'font-bold',
                    contratoExitoso.esContado ? 'text-blue-700' : 'text-emerald-700'
                  )}
                >
                  {contratoExitoso.esContado
                    ? '100% Pagado ($0 Saldo Pendiente)'
                    : `${contratoExitoso.cuotas} cuotas de ${formatCOP(contratoExitoso.valor_cuota)}`}
                </span>
              </div>
            </div>

            {/* Distintivo de Firma Digital vs Flujo Tradicional */}
            {contratoExitoso.firmadoDigitalmente ? (
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 space-y-1.5 shadow-2xs">
                <div className="flex items-center justify-center gap-2 text-xs text-emerald-800 font-bold">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>✓ Contrato con Firma Digital Estampada en Servidor</span>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-emerald-700">
                  <span className={cn('px-2 py-0.5 rounded-md border', contratoExitoso.firmaClienteRegistrada ? 'bg-emerald-100/80 border-emerald-300 font-semibold' : 'bg-slate-100 border-slate-200 text-slate-500')}>
                    {contratoExitoso.firmaClienteRegistrada ? '✓ Titular (Izquierda)' : '○ Sin Titular'}
                  </span>
                  <span className={cn('px-2 py-0.5 rounded-md border', contratoExitoso.firmaCodeudorRegistrada ? 'bg-emerald-100/80 border-emerald-300 font-semibold' : 'bg-slate-100 border-slate-200 text-slate-500')}>
                    {contratoExitoso.firmaCodeudorRegistrada ? '✓ Codeudor (Centro)' : '○ Sin Codeudor'}
                  </span>
                  <span className={cn('px-2 py-0.5 rounded-md border', contratoExitoso.firmaSupervisorRegistrada ? 'bg-emerald-100/80 border-emerald-300 font-semibold' : 'bg-slate-100 border-slate-200 text-slate-500')}>
                    {contratoExitoso.firmaSupervisorRegistrada ? '✓ Supervisor (Derecha)' : '○ Sin Supervisor'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500">
                <span>Flujo tradicional activo: imprima el comprobante para la firma física en papel.</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <button
                type="button"
                disabled={isDescargandoPdf}
                onClick={() => handleDescargarReciboPdf(contratoExitoso.id_contrato)}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                title="Generar e imprimir el recibo oficial digital en formato PDF"
              >
                <FileText className="w-4 h-4" />
                <span>{isDescargandoPdf ? 'Generando PDF...' : '📄 Descargar Recibo Digital (PDF)'}</span>
              </button>

              <button
                onClick={() => {
                  setContratoExitoso(null);
                  setCarrito([]);
                  setCedula('');
                  setNombres('');
                  setTelefono('');
                  setDireccion('');
                  setBarrio('');
                  setCiudad('Montería');
                  setNumeroContrato('');
                  setContratoAutomatico(true);
                  setCuotaInicial(0);
                  setClienteEncontrado(null);
                  setClienteNoEncontrado(false);
                  setFirmaCliente(null);
                  setFirmaCodeudor(null);
                  setFirmaSupervisor(null);
                  setCodeudorNombre('');
                  setCodeudorCedula('');
                  setCodeudorTelefono('');
                  setCodeudorDireccion('');
                  setReferenciaNombre('');
                  setReferenciaTelefono('');
                  setReferenciaParentesco('Familiar');
                }}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
              >
                + Nueva Operación POS
              </button>

              <Link
                href="/dashboard/creditos"
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-all text-center"
              >
                Ver en Cartera General →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* CUERPO: 2 COLUMNAS (FORMULARIO Y RESUMEN FLOTANTE STICKY) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* COLUMNA IZQUIERDA: SECCIONES DEL FORMULARIO */}
        <div className="lg:col-span-8 space-y-8">
          
          {/* ========================================================================= */}
          {/* SECCIÓN 1: DATOS DEL CLIENTE Y CODEUDOR */}
          {/* ========================================================================= */}
          <section className="bg-white rounded-2xl p-6 sm:p-7 border border-slate-200/80 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center font-bold">
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Sección 1: Datos del Cliente Titular {esContado ? '(Comprador)' : '& Codeudor'}
                  </h2>
                  <p className="text-xs text-slate-600">
                    {esContado
                      ? 'Información del cliente para emisión de comprobante y entrega'
                      : 'Información indispensable para verificación de cartera y cobro en terreno'}
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                Paso 1 de 3
              </span>
            </div>

            {/* Inputs del Cliente Titular con Autocompletado de Cédula */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    CÉDULA DE CIUDADANÍA *
                  </label>
                  {clienteEncontrado && (
                    <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                      ✓ Registrado
                    </span>
                  )}
                  {clienteNoEncontrado && (
                    <span className="text-[10px] font-medium text-slate-600 bg-slate-100 px-1.5 py-0.2 rounded">
                      Nuevo cliente
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="text"
                    required
                    placeholder="Ej: 1001234567"
                    value={cedula}
                    onChange={(e) => {
                      setCedula(e.target.value);
                      if (clienteEncontrado) setClienteEncontrado(null);
                      if (clienteNoEncontrado) setClienteNoEncontrado(false);
                    }}
                    onBlur={() => buscarClientePorCedula()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        buscarClientePorCedula();
                      }
                    }}
                    className="w-full pl-3.5 pr-9 py-2.5 rounded-xl border border-slate-200 text-sm font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 transition-all bg-slate-50/50 focus:bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => buscarClientePorCedula()}
                    disabled={isSearchingClient || !cedula}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-600 hover:text-slate-700 transition-colors cursor-pointer"
                    title="Buscar cliente por cédula"
                  >
                    {isSearchingClient ? (
                      <Clock className="w-4 h-4 animate-spin text-emerald-600" />
                    ) : (
                      <Search className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  NOMBRES Y APELLIDOS COMPLETOS *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Carlos Alberto Gómez Mejía"
                  value={nombres}
                  onChange={(e) => setNombres(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 transition-all bg-slate-50/50 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  TELÉFONO DE CONTACTO *
                </label>
                <input
                  type="text"
                  placeholder="Ej: 312 456 7890"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 transition-all bg-slate-50/50 focus:bg-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  DIRECCIÓN DE DOMICILIO O ENTREGA *
                </label>
                <input
                  type="text"
                  placeholder="Ej: Carrera 14 # 28 - 45"
                  value={direccion}
                  onChange={(e) => setDireccion(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 transition-all bg-slate-50/50 focus:bg-white"
                />
              </div>
            </div>

            {/* A. CONTENEDOR AISLADO DE GEOLOCALIZACIÓN (3 COLUMNAS: BARRIO, DEPARTAMENTO Y MUNICIPIO) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {/* Barrio / Sector */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  BARRIO / SECTOR *
                </label>
                <input
                  type="text"
                  placeholder="Ej: San José Obrero"
                  value={barrio}
                  onChange={(e) => setBarrio(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 transition-all bg-slate-50/50 focus:bg-white"
                />
              </div>

              {/* Selector de Departamento */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                  DEPARTAMENTO *
                </label>
                <select
                  required
                  value={departamento}
                  onChange={(e) => handleCambiarDepartamento(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 transition-all bg-slate-50/50 focus:bg-white cursor-pointer"
                >
                  {Object.keys(catalogoDepartamentos).map((dep) => (
                    <option key={dep} value={dep}>
                      {dep} ({catalogoDepartamentos[dep]?.length || 0} municipios)
                    </option>
                  ))}
                </select>
              </div>

              {/* Selector de Municipio */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
                  <span>MUNICIPIO DE VENTA *</span>
                  <span className="text-[10px] text-slate-500 font-normal">
                    {(catalogoDepartamentos[departamento] || []).length} disponibles
                  </span>
                </label>
                <select
                  required
                  value={ciudad}
                  onChange={(e) => setCiudad(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 transition-all bg-slate-50/50 focus:bg-white cursor-pointer"
                >
                  {(catalogoDepartamentos[departamento] || []).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  {ciudad && !(catalogoDepartamentos[departamento] || []).includes(ciudad) && (
                    <option value={ciudad}>{ciudad} (Registrado)</option>
                  )}
                </select>
              </div>
            </div>

            {/* B. BLOQUE DE CONTRATO DESANIDADO (ANCHO COMPLETO Y DISTRIBUCIÓN HORIZONTAL) */}
            <div className="flex flex-col md:flex-row items-start md:items-center gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200 w-full">
              {/* Etiqueta, Switch y Badge */}
              <div className="flex items-center gap-3 shrink-0">
                <button
                  id="toggle-contrato-pos"
                  type="button"
                  role="switch"
                  aria-checked={contratoAutomatico}
                  onClick={() => {
                    const nuevo = !contratoAutomatico;
                    setContratoAutomatico(nuevo);
                    if (nuevo) setNumeroContrato('');
                  }}
                  className={cn(
                    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden focus:ring-2 focus:ring-emerald-500',
                    contratoAutomatico ? 'bg-emerald-600' : 'bg-slate-300'
                  )}
                >
                  <span className="sr-only">Generar Contrato Automático</span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out',
                      contratoAutomatico ? 'translate-x-4' : 'translate-x-0'
                    )}
                  />
                </button>
                <label
                  htmlFor="toggle-contrato-pos"
                  className="text-xs sm:text-sm font-semibold text-slate-800 cursor-pointer select-none"
                >
                  Generar Contrato Automático
                </label>
                <span
                  className={cn(
                    'text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors',
                    contratoAutomatico
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      : 'bg-amber-100 text-amber-800 border border-amber-200'
                  )}
                >
                  {contratoAutomatico ? 'AUTO' : 'MANUAL'}
                </span>
              </div>

              {/* Input del Número de Contrato */}
              <div className="flex-1 w-full">
                <input
                  type="text"
                  id="pos-numero-contrato"
                  disabled={contratoAutomatico}
                  placeholder={
                    contratoAutomatico
                      ? "Asignado automáticamente por el servidor"
                      : "Ej: 0451 o CTR-2026 (Folio físico talonario)"
                  }
                  value={contratoAutomatico ? "" : numeroContrato}
                  onChange={(e) => setNumeroContrato(e.target.value)}
                  className={cn(
                    'w-full px-3.5 py-2.5 rounded-xl border text-sm font-mono transition-all',
                    contratoAutomatico
                      ? 'bg-gray-100 border-slate-200 text-slate-400 cursor-not-allowed select-none placeholder:font-sans placeholder:text-slate-400'
                      : 'bg-white border-slate-300 text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 placeholder:font-sans placeholder:text-slate-400 font-bold'
                  )}
                />
                <p className="text-sm text-gray-500 mt-1">
                  {contratoAutomatico ? (
                    <span className="text-emerald-700 font-medium flex items-center gap-1">
                      <span>✓</span> Consecutivo oficial asignado automáticamente por el servidor al radicar la venta.
                    </span>
                  ) : (
                    <span className="text-amber-700 font-medium flex items-center gap-1">
                      <span>✍️</span> Ingrese el folio o consecutivo manual del talonario físico entregado al cliente.
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* SECCIÓN DE GARANTÍAS Y RESPALDO (SÓLO SI ES VENTA A CRÉDITO) */}
            {!esContado ? (
              <div className="space-y-4 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 px-1">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Garantías y Respaldo Crediticio
                    </span>
                    <span className="text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-200 font-semibold px-2 py-0.5 rounded-md">
                      2 Bloques Independientes
                    </span>
                  </div>

                  {garantiasHeredadas && (
                    <span className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                      ⚡ Heredadas del cliente
                    </span>
                  )}
                </div>

                {/* BANNER DE HERENCIA INTELIGENTE DE GARANTÍAS */}
                {garantiasHeredadas && (
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-amber-50/90 border border-amber-200 text-amber-900 shadow-2xs">
                    <div className="flex items-center gap-2.5">
                      <span className="text-lg">⚡</span>
                      <div>
                        <p className="text-xs font-bold text-amber-950">
                          Garantías heredadas automáticamente del cliente
                        </p>
                        <p className="text-[11px] text-amber-800">
                          {permitirModificarGarantias
                            ? 'Modo edición activo: Puedes actualizar los datos del codeudor y referencia para este contrato.'
                            : 'Se han precargado el Codeudor y Referencia registrados en el historial crediticio.'}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setPermitirModificarGarantias((prev) => !prev)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer shrink-0 border',
                        permitirModificarGarantias
                          ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800 shadow-xs'
                          : 'bg-white text-amber-900 border-amber-300 hover:bg-amber-100 shadow-2xs'
                      )}
                    >
                      {permitirModificarGarantias ? '🔒 Bloquear campos' : '✏️ Modificar datos de garantía'}
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  
                  {/* BLOQUE 1: DATOS DEL CODEUDOR SOLIDARIO */}
                  <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-3.5">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold text-xs">
                          1
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-900">Datos del Codeudor Solidario</h4>
                          <p className="text-[10px] text-slate-500">Respaldo legal y solidario de la obligación</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                        Codeudor
                      </span>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          NOMBRE COMPLETO *
                        </label>
                        <input
                          type="text"
                          placeholder="Ej: Carlos Mendoza Gómez"
                          value={codeudorNombre}
                          disabled={garantiasHeredadas && !permitirModificarGarantias}
                          readOnly={garantiasHeredadas && !permitirModificarGarantias}
                          onChange={(e) => setCodeudorNombre(e.target.value)}
                          className={cn(
                            'w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-900 transition-all',
                            garantiasHeredadas && !permitirModificarGarantias
                              ? 'bg-slate-100/70 text-slate-600 cursor-not-allowed'
                              : 'bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500'
                          )}
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                            CÉDULA DE CIUDADANÍA *
                          </label>
                          <input
                            type="text"
                            placeholder="Ej: 1.067.890.123"
                            value={codeudorCedula}
                            disabled={garantiasHeredadas && !permitirModificarGarantias}
                            readOnly={garantiasHeredadas && !permitirModificarGarantias}
                            onChange={(e) => setCodeudorCedula(e.target.value)}
                            className={cn(
                              'w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-900 transition-all',
                              garantiasHeredadas && !permitirModificarGarantias
                                ? 'bg-slate-100/70 text-slate-600 cursor-not-allowed'
                                : 'bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500'
                            )}
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                            TELÉFONO DE CONTACTO *
                          </label>
                          <input
                            type="tel"
                            placeholder="Ej: 310 123 4567"
                            value={codeudorTelefono}
                            disabled={garantiasHeredadas && !permitirModificarGarantias}
                            readOnly={garantiasHeredadas && !permitirModificarGarantias}
                            onChange={(e) => setCodeudorTelefono(e.target.value)}
                            className={cn(
                              'w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-900 transition-all',
                              garantiasHeredadas && !permitirModificarGarantias
                                ? 'bg-slate-100/70 text-slate-600 cursor-not-allowed'
                                : 'bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500'
                            )}
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          DIRECCIÓN DOMICILIARIA (OPCIONAL)
                        </label>
                        <input
                          type="text"
                          placeholder="Ej: Cra 14 # 25-30 Barrio La Granja"
                          value={codeudorDireccion}
                          disabled={garantiasHeredadas && !permitirModificarGarantias}
                          readOnly={garantiasHeredadas && !permitirModificarGarantias}
                          onChange={(e) => setCodeudorDireccion(e.target.value)}
                          className={cn(
                            'w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-900 transition-all',
                            garantiasHeredadas && !permitirModificarGarantias
                              ? 'bg-slate-100/70 text-slate-600 cursor-not-allowed'
                              : 'bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500'
                          )}
                        />
                      </div>
                    </div>
                  </div>

                  {/* BLOQUE 2: DATOS DE LA REFERENCIA FAMILIAR */}
                  <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-3.5">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-xs">
                          2
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-900">Datos de la Referencia Familiar</h4>
                          <p className="text-[10px] text-slate-500">Contacto familiar o personal de verificación</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                        Referencia
                      </span>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          NOMBRE COMPLETO *
                        </label>
                        <input
                          type="text"
                          placeholder="Ej: María Gómez Ramos"
                          value={referenciaNombre}
                          disabled={garantiasHeredadas && !permitirModificarGarantias}
                          readOnly={garantiasHeredadas && !permitirModificarGarantias}
                          onChange={(e) => setReferenciaNombre(e.target.value)}
                          className={cn(
                            'w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-900 transition-all',
                            garantiasHeredadas && !permitirModificarGarantias
                              ? 'bg-slate-100/70 text-slate-600 cursor-not-allowed'
                              : 'bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500'
                          )}
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                            TELÉFONO DE CONTACTO *
                          </label>
                          <input
                            type="tel"
                            placeholder="Ej: 320 987 6543"
                            value={referenciaTelefono}
                            disabled={garantiasHeredadas && !permitirModificarGarantias}
                            readOnly={garantiasHeredadas && !permitirModificarGarantias}
                            onChange={(e) => setReferenciaTelefono(e.target.value)}
                            className={cn(
                              'w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-900 transition-all',
                              garantiasHeredadas && !permitirModificarGarantias
                                ? 'bg-slate-100/70 text-slate-600 cursor-not-allowed'
                                : 'bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500'
                            )}
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                            PARENTESCO O VÍNCULO
                          </label>
                          <input
                            type="text"
                            placeholder="Ej: Hermano(a), Madre, Tío(a)"
                            value={referenciaParentesco}
                            disabled={garantiasHeredadas && !permitirModificarGarantias}
                            readOnly={garantiasHeredadas && !permitirModificarGarantias}
                            onChange={(e) => setReferenciaParentesco(e.target.value)}
                            className={cn(
                              'w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-900 transition-all',
                              garantiasHeredadas && !permitirModificarGarantias
                                ? 'bg-slate-100/70 text-slate-600 cursor-not-allowed'
                                : 'bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500'
                            )}
                          />
                        </div>
                      </div>

                      <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center gap-2 text-[11px] text-slate-500">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>Información respaldada de manera independiente para archivo de cartera.</span>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-blue-50/60 border border-blue-100 flex items-center gap-2.5 text-xs text-blue-800">
                <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                <span>
                  <strong>Garantías no requeridas:</strong> En ventas de contado el pago es recibido en su totalidad, por lo que no se solicitan codeudores ni estudio de riesgo.
                </span>
              </div>
            )}

          </section>

          {/* ========================================================================= */}
          {/* SECCIÓN 2: CATÁLOGO Y ARTÍCULOS EN VENTA (PRECIO VARIABLE Y FIJO) */}
          {/* ========================================================================= */}
          <section className="bg-white rounded-2xl p-6 sm:p-7 border border-slate-200/80 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center font-bold">
                  <Package className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Sección 2: Selección de Artículos del Catálogo
                  </h2>
                  <p className="text-xs text-slate-600">
                    Mecedoras tradicionales con precio fijo y obras de arte con precio variable negociable
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                Paso 2 de 3
              </span>
            </div>

            {/* Selector de Producto */}
            <div className="space-y-3">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Seleccione un producto a añadir:
              </label>

              {catalogo.length === 0 ? (
                <div className="p-8 text-center rounded-xl bg-slate-50 border border-slate-200/80">
                  <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <h4 className="text-sm font-bold text-slate-800">Catálogo de Artículos en Ceros</h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                    No hay productos registrados en el sistema. Registre los artículos reales en el módulo de Inventario para poder originar ventas en el POS.
                  </p>
                  <Link
                    href="/dashboard/productos"
                    className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors shadow-xs cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Ir a Gestión de Inventario</span>
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {catalogo.map((prod) => {
                    const isSelected = prod.id === productoSeleccionadoId;
                    return (
                      <div
                        key={prod.id}
                        onClick={() => handleSeleccionarProducto(prod.id)}
                        className={cn(
                          'p-3.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between space-y-2',
                          isSelected
                            ? 'border-emerald-600 bg-emerald-50/30 shadow-xs ring-1 ring-emerald-500'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/40'
                        )}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[10px] font-bold text-slate-600">
                              {prod.sku}
                            </span>
                            {prod.es_precio_variable ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                                <Sparkles className="w-2.5 h-2.5" />
                                Arte / Negociable
                              </span>
                            ) : (
                              <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                                Precio Fijo
                              </span>
                            )}
                          </div>

                          <h3 className="text-xs font-bold text-slate-900 leading-snug line-clamp-2">
                            {prod.nombre}
                          </h3>
                        </div>

                        <div className="pt-2 border-t border-slate-200/50 flex items-center justify-between text-[11px]">
                          <span className="font-mono font-bold text-slate-900">
                            {formatCOP(prod.precio_base)}
                          </span>
                          {prod.maneja_stock === false ? (
                            <span className="text-purple-700 font-semibold flex items-center gap-1">
                              <Sparkles className="w-2.5 h-2.5" />
                              Por encargo
                            </span>
                          ) : (prod.stock ?? 0) <= 0 ? (
                            <span className="text-rose-600 font-bold">Agotado (0)</span>
                          ) : (
                            <span className="text-emerald-700 font-medium">{prod.stock} disp.</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Panel de Configuración del Artículo Seleccionado */}
            {prodSeleccionado && (
              <div className="p-4 sm:p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
                  <div>
                    <span className="text-[11px] font-bold text-slate-600 uppercase">Artículo en configuración:</span>
                    <h4 className="text-sm font-bold text-slate-900">{prodSeleccionado.nombre}</h4>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-600">SKU: {prodSeleccionado.sku}</span>
                    {prodSeleccionado.maneja_stock === false ? (
                      <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                        Por Encargo (Sin límite de stock)
                      </span>
                    ) : (
                      <span className={cn(
                        "text-xs font-semibold px-2.5 py-0.5 rounded-full border",
                        (prodSeleccionado.stock ?? 0) > 0 ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-rose-50 text-rose-800 border-rose-200"
                      )}>
                        Stock disponible: {prodSeleccionado.stock ?? 0} unidades
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                  
                  {/* PRECIO ACORDADO O BASE FIJO */}
                  <div className="sm:col-span-2">
                    {prodSeleccionado.es_precio_variable ? (
                      <div className="space-y-1">
                        <label className="block text-xs font-bold text-purple-900 flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-purple-700" />
                          <span>VALOR UNITARIO ACORDADO CON EL CLIENTE (COP) *</span>
                        </label>
                        <input
                          type="number"
                          value={precioAcordadoInput}
                          onChange={(e) => setPrecioAcordadoInput(parseFloat(e.target.value) || 0)}
                          className="w-full px-3.5 py-2 rounded-xl border border-purple-300 bg-purple-50/50 text-purple-950 font-mono font-bold text-base focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-purple-600 transition-all"
                        />
                        <span className="text-[11px] text-purple-700 block">
                          Precio base de referencia: {formatCOP(prodSeleccionado.precio_base)}. Como es obra de arte, puede pactar un valor diferente con el cliente.
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <label className="block text-xs font-semibold text-slate-700">
                          PRECIO UNITARIO ESTÁNDAR (NO NEGOCIABLE)
                        </label>
                        <div className="w-full px-3.5 py-2 rounded-xl border border-slate-200 bg-white font-mono font-bold text-sm text-slate-900">
                          {formatCOP(prodSeleccionado.precio_base)}
                        </div>
                        <span className="text-[11px] text-slate-600 block">
                          Tarifa estándar predeterminada para mecedoras tradicionales.
                        </span>
                      </div>
                    )}
                  </div>

                  {/* CANTIDAD Y BOTÓN AGREGAR */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      CANTIDAD
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={cantidadInput}
                        onChange={(e) => setCantidadInput(parseInt(e.target.value) || 1)}
                        className="w-20 px-3 py-2 rounded-xl border border-slate-200 text-center font-bold text-sm bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={handleAgregarAlCarrito}
                        className="flex-1 py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Agregar</span>
                      </button>
                    </div>
                  </div>

                </div>
              </div>
            )}

            {/* LISTA DE COMPRA ACTUAL */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 uppercase tracking-wider">
                <span>Artículos en la venta actual ({carrito.length})</span>
                {carrito.length > 0 && (
                  <span className="font-mono text-slate-900 font-bold">
                    Subtotal Venta: {formatCOP(totalVenta)}
                  </span>
                )}
              </div>

              {carrito.length === 0 ? (
                <div className="p-6 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-600">
                  No ha seleccionado ningún artículo todavía. Elija un producto arriba y pulse Agregar.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                  {carrito.map((item) => (
                    <div
                      key={item.id}
                      className="p-3.5 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/50 transition-colors"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900">{item.nombre}</span>
                          {item.es_precio_variable && (
                            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-purple-50 text-purple-700 border border-purple-200">
                              Arte
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-600 font-mono">
                          SKU: {item.sku} • {item.cantidad} x {formatCOP(item.valor_unitario_acordado)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-4">
                        <span className="font-mono font-bold text-xs text-slate-900">
                          {formatCOP(item.subtotal)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleEliminarItem(item.id)}
                          className="p-1 text-slate-600 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Eliminar artículo"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </section>

          {/* ========================================================================= */}
          {/* SECCIÓN 3: CONDICIONES FINANCIERAS Y PLAN DE PAGOS (ADAPTABLE) */}
          {/* ========================================================================= */}
          <section className="bg-white rounded-2xl p-6 sm:p-7 border border-slate-200/80 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'w-9 h-9 rounded-xl flex items-center justify-center font-bold',
                    esContado ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-800'
                  )}
                >
                  {esContado ? <Receipt className="w-4 h-4" /> : <Calendar className="w-4 h-4" />}
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Sección 3: {esContado ? 'Condiciones de Pago Contado' : 'Condiciones Financieras & Plan de Pagos'}
                  </h2>
                  <p className="text-xs text-slate-600">
                    {esContado
                      ? 'Recepción del 100% del valor de la mercancía sin saldo financiado'
                      : 'Periodicidad de recaudo, cuota inicial en efectivo y cálculo de pagos periódicos'}
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                Paso 3 de 3
              </span>
            </div>

            {/* CONTENIDO ADAPTABLE SEGÚN MODALIDAD */}
            {esContado ? (
              /* VISTA CONTADO: CAMPOS DE FINANCIAMIENTO BLOQUEADOS / LIQUIDACIÓN INMEDIATA */
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200/80 flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-blue-900 space-y-1">
                    <p className="font-bold text-sm">Venta de Contado Seleccionada</p>
                    <p className="leading-relaxed">
                      El valor de la compra se liquida en su totalidad en una sola exhibición. El financiamiento queda fijado en <strong>$0 COP</strong>, no se generan cuotas pendientes y el registro queda inmediatamente pagado.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[11px] font-bold text-slate-600 uppercase block">Total de la Mercancía</span>
                    <span className="text-xl font-bold font-mono text-slate-900 mt-1 block">
                      {formatCOP(totalVenta)}
                    </span>
                  </div>

                  <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                    <span className="text-[11px] font-bold text-emerald-800 uppercase block">Efectivo a Recibir</span>
                    <span className="text-xl font-bold font-mono text-emerald-900 mt-1 block">
                      {formatCOP(totalVenta)}
                    </span>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[11px] font-bold text-slate-600 uppercase block">Saldo Financiado</span>
                    <span className="text-xl font-bold font-mono text-slate-700 mt-1 block">
                      $0 COP
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              /* VISTA CRÉDITO: SELECCIÓN DE MODALIDAD, CUOTA INICIAL Y PLAZOS */
              <div className="space-y-6">
                
                {/* Modalidad Unificada: Crédito Mensual (Fin de Mes) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-semibold text-slate-700">
                      MODALIDAD DE COBRO UNIFICADA *
                    </label>
                    <span className="text-[11px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                      Mensual Fin de Mes
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/40 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                        30/31
                      </div>
                      <div>
                        <span className="text-xs font-bold text-slate-900 block uppercase">Frecuencia Mensual</span>
                        <span className="text-[11px] text-slate-600 block">Vencimiento programado automáticamente para el fin de cada mes</span>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-emerald-800 bg-emerald-100/80 px-2.5 py-1 rounded-lg">
                      Exclusivo
                    </span>
                  </div>
                </div>

                {/* Parámetros de Plazo y Cuota Inicial */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      CUOTA INICIAL EN EFECTIVO (COP)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-xs text-slate-400 font-mono">$</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={cuotaInicial || ''}
                        onChange={(e) => setCuotaInicial(parseFloat(e.target.value) || 0)}
                        className="w-full pl-7 pr-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-mono font-semibold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 bg-slate-50/50 focus:bg-white"
                      />
                    </div>
                    <span className="text-[11px] text-slate-500 mt-1 block">
                      {cuotaInicial > 0 ? `Pago inicial registrado: ${formatCOP(cuotaInicial)}` : 'Sin anticipo (100% financiado)'}
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      FECHA PRIMER COBRO
                    </label>
                    <input
                      type="date"
                      value={fechaPrimeraCuota}
                      onChange={(e) => setFechaPrimeraCuota(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 bg-slate-50/50 focus:bg-white"
                    />
                    <span className="text-[11px] text-slate-500 mt-1 block">
                      Primer vencimiento en ruta de cobro
                    </span>
                  </div>
                </div>

                {/* SELECTOR EXCLUSIVO DE PLAZOS DE CUOTAS PERMITIDOS */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-semibold text-slate-700">
                      PLAZO DE CUOTAS PERMITIDO *
                    </label>
                    <span className="text-[11px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                      4 Opciones Autorizadas
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {PLAZOS_CUOTAS_PERMITIDOS.map((opcion) => {
                      const isSelected = numeroCuotas === opcion.cuotas;
                      const cuotaEst = montoFinanciado > 0 ? Math.round(montoFinanciado / opcion.cuotas) : 0;
                      return (
                        <button
                          key={opcion.cuotas}
                          type="button"
                          onClick={() => setNumeroCuotas(opcion.cuotas)}
                          className={cn(
                            'p-3 rounded-xl border text-left transition-all cursor-pointer relative flex flex-col justify-between min-h-[90px]',
                            isSelected
                              ? 'bg-slate-900 text-white border-slate-900 shadow-md ring-2 ring-emerald-500/25'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50/80'
                          )}
                        >
                          {opcion.badge && (
                            <span
                              className={cn(
                                'absolute -top-2 right-2 text-[9px] font-bold px-2 py-0.5 rounded-full border shadow-2xs',
                                isSelected
                                  ? 'bg-emerald-400 text-slate-950 border-emerald-300'
                                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              )}
                            >
                              {opcion.badge}
                            </span>
                          )}
                          <div>
                            <span className={cn('text-sm font-bold block', isSelected ? 'text-white' : 'text-slate-900')}>
                              {opcion.label}
                            </span>
                            <span className={cn('text-[10px] mt-0.5 block leading-tight', isSelected ? 'text-slate-300' : 'text-slate-500')}>
                              {opcion.descripcion}
                            </span>
                          </div>
                          {montoFinanciado > 0 && (
                            <div className="mt-2 pt-1.5 border-t border-slate-200/20">
                              <span className={cn('text-[9px] uppercase font-semibold block', isSelected ? 'text-slate-400' : 'text-slate-400')}>
                                Cuota:
                              </span>
                              <span className={cn('text-xs font-mono font-bold block', isSelected ? 'text-emerald-300' : 'text-emerald-700')}>
                                {formatCOP(cuotaEst)}
                              </span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Previsualización del Plan de Amortización Proyectado (Desglose Transparente) */}
                {montoFinanciado > 0 && numeroCuotas > 0 && (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
                      <span className="font-bold text-slate-900 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-600" />
                        Desglose Financiero en Tiempo Real ({numeroCuotas} cuotas {tipoPago}s)
                      </span>
                      <span className="text-[11px] text-slate-600 font-mono">
                        Total Artículos: <strong>{formatCOP(totalVenta)}</strong> {cuotaInicialEfectiva > 0 && `| Inicial: -${formatCOP(cuotaInicialEfectiva)}`}
                      </span>
                    </div>

                    {numeroCuotas === 4 && (
                      <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200/70 text-emerald-900 text-xs flex items-center gap-2">
                        <span className="font-bold text-emerald-700">✓ Plan 4 Cuotas:</span>
                        <span>Configurado internamente como <strong>Cuota Inicial + 3 meses / periodos</strong> correspondientes.</span>
                      </div>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="p-2.5 rounded-lg bg-white border border-slate-200/60 shadow-2xs">
                        <span className="text-[10px] text-slate-600 block uppercase font-semibold">Saldo Financiado</span>
                        <span className="font-mono font-bold text-slate-900 block mt-0.5">{formatCOP(montoFinanciado)}</span>
                        <span className="text-[10px] text-slate-500 block truncate">Neto a diferir</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white border border-slate-200/60 shadow-2xs">
                        <span className="text-[10px] text-slate-600 block uppercase font-semibold">Plazo Pactado</span>
                        <span className="font-mono font-bold text-slate-900 block mt-0.5">{numeroCuotas} Cuotas</span>
                        <span className="text-[10px] text-slate-500 block capitalize">{tipoPago}</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-emerald-50/80 border border-emerald-200 shadow-2xs">
                        <span className="text-[10px] text-emerald-800 block uppercase font-bold">Valor Cuota Periódica</span>
                        <span className="font-mono font-bold text-emerald-900 block mt-0.5 text-sm">{formatCOP(valorCuotaCalculado)}</span>
                        <span className="text-[10px] text-emerald-700 block">Cobro periódico</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white border border-slate-200/60 shadow-2xs">
                        <span className="text-[10px] text-slate-600 block uppercase font-semibold">1ª Cuota en Ruta</span>
                        <span className="font-mono font-bold text-slate-900 block mt-0.5">{formatCOP(valorCuotaCalculado)}</span>
                        <span className="text-[10px] text-slate-500 block truncate">{fechaPrimeraCuota}</span>
                      </div>
                    </div>

                    {/* Cronograma Proyectado de Vencimientos por Cuota */}
                    <div className="pt-3 border-t border-slate-200/60">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                          <span>Cronograma de Vencimiento de Cuotas ({tipoPago.toUpperCase()})</span>
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {numeroCuotas} cuotas de {formatCOP(valorCuotaCalculado)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {Array.from({ length: numeroCuotas }).map((_, idx) => {
                          let fechaVencStr = fechaPrimeraCuota;
                          if (idx > 0 && fechaPrimeraCuota) {
                            const parts = fechaPrimeraCuota.split('-');
                            const year0 = parseInt(parts[0], 10);
                            const month0 = parseInt(parts[1], 10);
                            const d = new Date(year0, month0 + idx, 0);
                            const yyyy = d.getFullYear();
                            const mm = String(d.getMonth() + 1).padStart(2, '0');
                            const dd = String(d.getDate()).padStart(2, '0');
                            fechaVencStr = `${yyyy}-${mm}-${dd}`;
                          }
                          return (
                            <div
                              key={idx}
                              className="p-2 rounded-lg bg-white border border-slate-200/80 shadow-2xs flex flex-col justify-between"
                            >
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="font-bold text-slate-700">Cuota {idx + 1}</span>
                                <span className="font-mono font-bold text-emerald-700">
                                  {formatCOP(valorCuotaCalculado)}
                                </span>
                              </div>
                              <span className="text-[11px] font-mono font-bold text-slate-900 mt-1 block">
                                {fechaVencStr}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* NOTA OPERATIVA: ASIGNACIÓN POSTERIOR DE RUTA Y COBRADOR */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-3 text-xs text-slate-600">
                  <Clock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="font-semibold text-slate-800">Crédito sin asignación prematura de ruta</p>
                    <p className="text-[11px] leading-relaxed">
                      Este crédito nacerá limpio de cobrador y ruta. La asignación operativa del cobrador se realizará de manera exclusiva desde el módulo de <strong>Cartera / Supervisión</strong> una vez que el crédito esté aprobado.
                    </p>
                  </div>
                </div>

              </div>
            )}

          </section>

          {/* ========================================================================= */}
          {/* SECCIÓN 4: MODO DUAL DE FIRMA DIGITAL (OPCIONAL - TABLETA USB / STYLUS)   */}
          {/* ========================================================================= */}
          <section className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start sm:items-center gap-3">
                <div
                  className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors shadow-2xs',
                    habilitarFirmaDigital
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 text-slate-600'
                  )}
                >
                  <PenTool className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm sm:text-base font-bold text-slate-900">
                      Habilitar Firma Digital (Opcional - Reemplaza Impresión Física)
                    </h3>
                    <span
                      className={cn(
                        'text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border',
                        habilitarFirmaDigital
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      )}
                    >
                      {habilitarFirmaDigital ? 'Modo Digital Activo' : 'Flujo Papel'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Capture la firma en tableta digitalizadora USB (Wacom, Huion) o con el ratón para adjuntarla directamente al PDF oficial.
                  </p>
                </div>
              </div>

              {/* Interruptor Switch */}
              <label className="relative inline-flex items-center cursor-pointer shrink-0 self-end sm:self-center">
                <input
                  type="checkbox"
                  checked={habilitarFirmaDigital}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setHabilitarFirmaDigital(checked);
                    if (!checked) {
                      setFirmaCliente(null);
                      setFirmaCodeudor(null);
                      setFirmaSupervisor(null);
                    }
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>

            {/* Contenido Condicional del Triple Pad de Firma */}
            {habilitarFirmaDigital ? (
              <div className="pt-4 border-t border-slate-100 space-y-4 animate-in fade-in slide-in-from-top-2">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {/* Recuadro 1: Firma de Conformidad del Cliente (Titular) - Obligatorio */}
                  <WebSignaturePad
                    label="1. Cliente Titular"
                    subtitle="Acepta y recibe a satisfacción los artículos y condiciones"
                    badgeText="Obligatorio"
                    badgeVariant="required"
                    pdfMapping="Casilla izquierda • ACEPTO Y RECIBÍ A SATISFACCIÓN"
                    onChange={setFirmaCliente}
                    height={135}
                  />

                  {/* Recuadro 2: Firma del Codeudor Solidario - Opcional */}
                  <WebSignaturePad
                    label="2. Codeudor Solidario"
                    subtitle="Garante mancomunado (opcional, no bloquea el trámite)"
                    badgeText="Opcional"
                    badgeVariant="optional"
                    pdfMapping="Casilla central • FIRMA CODEUDOR SOLIDARIO"
                    onChange={setFirmaCodeudor}
                    height={135}
                  />

                  {/* Recuadro 3: Firma del Supervisor / Asesor Autorizado - Obligatorio */}
                  <WebSignaturePad
                    label="3. Supervisor / Asesor"
                    subtitle="Visto bueno comercial y certificación oficial de la venta"
                    badgeText="Obligatorio"
                    badgeVariant="required"
                    pdfMapping="Casilla derecha • POR REMUNDIAL ARTE'S"
                    onChange={setFirmaSupervisor}
                    height={135}
                    className="md:col-span-2 xl:col-span-1"
                  />
                </div>

                <div className="flex items-center gap-2.5 text-xs text-emerald-800 bg-emerald-50/80 border border-emerald-200/70 p-3.5 rounded-xl">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-[11px] leading-relaxed">
                    <strong>Triple Firma Digital Certificada:</strong> Los tres recuadros admiten tableta USB (Wacom, Huion, etc.) o ratón de forma 100% independiente. Al emitir la venta, cada firma se estampa inmutablemente en su respectiva columna oficial en el PDF del contrato (Titular a la izquierda, Codeudor en el centro si firmó, y Supervisor a la derecha), prescindiendo de la impresión en papel.
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center gap-2.5 text-xs text-slate-500">
                <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                <span>
                  Flujo tradicional seleccionado: el contrato se generará sin firma digital para que sea impreso y rubricado a mano en papel físico.
                </span>
              </div>
            )}
          </section>

        </div>

        {/* COLUMNA DERECHA: RESUMEN FLOTANTE STICKY Y BOTÓN PRINCIPAL */}
        <div className="lg:col-span-4 lg:sticky lg:top-24 space-y-5">
          
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-md space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">
                {esContado ? 'Liquidación de Contado' : 'Amortización de Crédito'}
              </span>
              <h3 className="text-lg font-bold text-slate-900">
                Resumen de Operación POS
              </h3>
            </div>

            {/* Desglose de Valores */}
            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center text-slate-600">
                <span>Cliente Titular:</span>
                <span className="font-semibold text-slate-900 truncate max-w-[170px]">
                  {nombres || 'No especificado'}
                </span>
              </div>

              <div className="flex justify-between items-center text-slate-600">
                <span>Modalidad:</span>
                <span
                  className={cn(
                    'font-bold px-2 py-0.5 rounded-full text-[10px] uppercase',
                    esContado ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-700'
                  )}
                >
                  {esContado ? 'De Contado' : 'A Crédito'}
                </span>
              </div>

              <div className="flex justify-between items-center text-slate-600">
                <span>Total Artículos ({carrito.reduce((acc, i) => acc + i.cantidad, 0)}):</span>
                <span className="font-mono font-semibold text-slate-900">
                  {formatCOP(totalVenta)}
                </span>
              </div>

              <div className="flex justify-between items-center text-slate-600">
                <span>{esContado ? 'Efectivo Recibido en Caja:' : 'Cuota Inicial Pactada:'}</span>
                <span className="font-mono font-semibold text-emerald-600">
                  - {formatCOP(cuotaInicialEfectiva)}
                </span>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-between items-center text-sm">
                <span className="font-bold text-slate-900">Monto Neto Financiado:</span>
                <span className="font-mono font-bold text-base text-slate-900">
                  {formatCOP(montoFinanciado)}
                </span>
              </div>
            </div>

            {/* TARJETA DESTACADA DEL PAGO */}
            {esContado ? (
              <div className="p-4 rounded-xl bg-blue-900 text-white text-center space-y-1 shadow-inner">
                <span className="text-[10px] uppercase font-bold text-blue-200 tracking-wider">
                  TOTAL A COBRAR EN CAJA
                </span>
                <div className="text-3xl font-extrabold font-mono tracking-tight text-white">
                  {formatCOP(totalVenta)}
                </div>
                <span className="text-xs text-blue-200 block">
                  Pago único inmediato • Facturación directa
                </span>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-slate-900 text-white text-center space-y-1 shadow-inner">
                <span className="text-[10px] uppercase font-bold text-slate-300 tracking-wider">
                  VALOR DE CUOTA PERIÓDICA
                </span>
                <div className="text-3xl font-extrabold font-mono tracking-tight text-emerald-400">
                  {formatCOP(valorCuotaCalculado)}
                </div>
                <span className="text-xs text-slate-300 block">
                  {numeroCuotas} pagos de periodicidad <strong className="uppercase text-white">{tipoPago}</strong>
                </span>
              </div>
            )}

            {/* BOTÓN GIGANTE DE ACCIÓN PRINCIPAL (ADAPTABLE) */}
            <button
              type="button"
              disabled={isSubmitting || totalVenta <= 0 || (!esContado && montoFinanciado <= 0)}
              onClick={handleEnviarVenta}
              className={cn(
                'w-full py-4 px-5 rounded-xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed text-white',
                esContado
                  ? 'bg-blue-600 hover:bg-blue-700 active:scale-[0.99]'
                  : 'bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99]'
              )}
            >
              {isSubmitting ? (
                <span>Procesando Operación...</span>
              ) : esContado ? (
                <>
                  <Receipt className="w-4 h-4" />
                  <span>Registrar Venta de Contado</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Enviar Solicitud a Supervisor</span>
                </>
              )}
            </button>

            <div className="text-[11px] text-slate-600 text-center leading-relaxed">
              {esContado
                ? 'El recibo de pago y registro contable se emiten inmediatamente sin requerir codeudores.'
                : 'La solicitud queda sujeta a verificación de geolocalización y aprobación del supervisor.'}
            </div>
          </div>

          <div className="text-center">
            <Link
              href="/dashboard/creditos"
              className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              ← Volver al Listado General de Cartera
            </Link>
          </div>

        </div>

      </div>

    </div>
  );
}
