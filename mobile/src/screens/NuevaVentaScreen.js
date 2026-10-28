import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  FlatList,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  AppState,
  Linking,
  Switch,
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient, { STORAGE_KEYS as AUTH_STORAGE_KEYS } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import InFrameModal from '../components/InFrameModal';
import SignatureCanvas from '../components/SignatureCanvas';
import CitySelectorModal, { inferirDepartamento } from '../components/CitySelectorModal';
import BankSelectorModal from '../components/BankSelectorModal';
import ProductCard from '../components/ProductCard';
import {
  guardarBorradorVenta,
  obtenerBorradorVenta,
  limpiarBorradorVenta,
  guardarEnCache,
  obtenerDeCache,
  STORAGE_KEYS,
  CACHE_CONFIG,
} from '../storage/database';

const formatCOP = (val) => {
  const num = Math.round(Number(val) || 0);
  return '$ ' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

// Formateador local YYYY-MM-DD
const formatDateISO = (d) => {
  if (!d) return '';
  if (typeof d === 'string') {
    const s = d.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const parsed = new Date(d);
    if (!isNaN(parsed.getTime())) {
      d = parsed;
    } else {
      return '';
    }
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Fijación y cálculo de fecha del primer cobro:
// Si esManual === false: último día del mes siguiente a la compra (ej. 31 de Octubre de 2026)
// Si esManual === true: fecha actual + 1 mes calendario consecutivo (mismo día de hoy)
const getFechaPrimerCobroSugerida = (baseDate = new Date(), esManual = false) => {
  const d = baseDate instanceof Date ? baseDate : new Date();
  if (esManual) {
    const targetDay = d.getDate();
    const targetYear = d.getFullYear() + Math.floor((d.getMonth() + 1) / 12);
    const targetMonthIndex = (d.getMonth() + 1) % 12;
    const maxDiasEnMes = new Date(targetYear, targetMonthIndex + 1, 0).getDate();
    const diaReal = Math.min(targetDay, maxDiasEnMes);
    return formatDateISO(new Date(targetYear, targetMonthIndex, diaReal));
  }
  const finMesSiguiente = new Date(d.getFullYear(), d.getMonth() + 2, 0);
  return formatDateISO(finMesSiguiente);
};

// Generador del cronograma escalonado de amortización de cuotas sucesivas
const calcularCronogramaCuotas = (fechaInicialStr, numCuotas, frecuencia = 'mensual', valorPorCuota = 0, esManual = false) => {
  if (!fechaInicialStr || numCuotas <= 0) return [];
  const cuotas = [];
  const cleanStr = formatDateISO(fechaInicialStr) || getFechaPrimerCobroSugerida(new Date(), esManual);

  if (esManual) {
    // Si fechasManuales es true:
    // La primera cuota debe ser exactamente la fechaPrimeraCuotaManual (cleanStr).
    // Las cuotas subsiguientes deben sumarle un mes calendario consecutivo a esa misma fecha exacta.
    const partes = cleanStr.split('-');
    const y = parseInt(partes[0], 10) || new Date().getFullYear();
    const m = parseInt(partes[1], 10) || (new Date().getMonth() + 1); // 1-12
    const targetDay = parseInt(partes[2], 10) || new Date().getDate();

    for (let i = 0; i < numCuotas; i++) {
      let fechaCuotaStr;
      if (i === 0) {
        fechaCuotaStr = cleanStr;
      } else {
        const targetYear = y + Math.floor((m - 1 + i) / 12);
        const targetMonthIndex = (m - 1 + i) % 12;
        const maxDiasEnMes = new Date(targetYear, targetMonthIndex + 1, 0).getDate();
        const diaReal = Math.min(targetDay, maxDiasEnMes);
        const fechaCuota = new Date(targetYear, targetMonthIndex, diaReal);
        fechaCuotaStr = formatDateISO(fechaCuota);
      }
      cuotas.push({
        numero: i + 1,
        fecha: fechaCuotaStr,
        valor: valorPorCuota,
      });
    }
  } else {
    // Si fechasManuales es false: cálculo automático al último día del mes siguiente
    const [yStr, mStr] = cleanStr.split('-');
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);

    for (let i = 0; i < numCuotas; i++) {
      let fechaCuotaStr;
      if (i === 0) {
        fechaCuotaStr = cleanStr;
      } else {
        const fechaCuota = new Date(y, m + i, 0);
        fechaCuotaStr = formatDateISO(fechaCuota);
      }
      cuotas.push({
        numero: i + 1,
        fecha: fechaCuotaStr,
        valor: valorPorCuota,
      });
    }
  }
  return cuotas;
};

export default function NuevaVentaScreen({ route, navigation }) {
  const { user, userRole, token: authToken, logout } = useAuth();
  const { encolarVenta, isOnline, bancos } = useSync();

  // Estado y helper para el modal universal de alertas (Web + Mobile)
  const [modalAlerta, setModalAlerta] = useState({
    visible: false,
    titulo: '',
    mensaje: '',
    tipo: 'warning', // 'warning' | 'error' | 'success' | 'info'
    botones: [],
  });

  const mostrarAlertaUniversal = (titulo, mensaje, botones = null, tipo = 'warning') => {
    const botonesEfectivos = (Array.isArray(botones) && botones.length > 0)
      ? botones
      : [{ text: 'Entendido', onPress: () => setModalAlerta((prev) => ({ ...prev, visible: false })) }];

    setModalAlerta({
      visible: true,
      titulo: titulo || 'Aviso del Sistema',
      mensaje: typeof mensaje === 'string' ? mensaje : JSON.stringify(mensaje),
      tipo,
      botones: botonesEfectivos,
    });
  };

  // Estados de datos maestros
  const [clientes, setClientes] = useState([]);
  const [productos, setProductos] = useState([]);
  const [isLoadingData, setIsLoadingData] = useState(false);

  // Cliente seleccionado
  const [clienteSeleccionado, setClienteSeleccionado] = useState(
    route?.params?.clientePreseleccionado || null
  );
  const [modalSeleccionarCliente, setModalSeleccionarCliente] = useState(false);
  const [filtroCliente, setFiltroCliente] = useState('');

  // Parámetros comerciales de radicación (Ciudad, Departamento y Contrato)
  const [ciudadVenta, setCiudadVenta] = useState('Montería');
  const [departamentoVenta, setDepartamentoVenta] = useState('Córdoba');
  const [numeroContrato, setNumeroContrato] = useState('');
  const [contratoAutomatico, setContratoAutomatico] = useState(true);
  const [modalSeleccionarCiudad, setModalSeleccionarCiudad] = useState(false);

  // Artículos en la orden
  const [itemsVenta, setItemsVenta] = useState([]);
  const [modalAgregarProducto, setModalAgregarProducto] = useState(false);
  const [filtroProducto, setFiltroProducto] = useState('');

  // Modalidad de venta: 'credito' | 'contado'
  const [modalidad, setModalidad] = useState('credito');

  // Parámetros de crédito (Modalidad unificada exclusivamente a Mensual con vencimiento a fin de mes)
  const [tipoPago, setTipoPago] = useState('mensual'); // Unificado a mensual
  const [cuotaInicialInput, setCuotaInicialInput] = useState('0');
  const [numeroCuotas, setNumeroCuotas] = useState(4);
  const [plazosPermitidos, setPlazosPermitidos] = useState([2, 4, 6, 9]);
  const [modalidadProyeccion, setModalidadProyeccion] = useState('fija');
  // Estados para Personalización de Fecha de Primer Cobro
  const [fechasManuales, setFechasManuales] = useState(false);
  const [fechaPrimeraCuotaManual, setFechaPrimeraCuotaManual] = useState(() =>
    getFechaPrimerCobroSugerida(new Date(), true)
  );
  const [fechaPrimeraCuota, setFechaPrimeraCuota] = useState(() => getFechaPrimerCobroSugerida());

  // Pagos Mixtos en Cuota Inicial
  const [metodoPagoInicial, setMetodoPagoInicial] = useState('Efectivo');
  const [bancoTransferencia, setBancoTransferencia] = useState('');
  const [modalBancoVisible, setModalBancoVisible] = useState(false);
  const [compEditandoBancoId, setCompEditandoBancoId] = useState(null);
  const [comprobantes, setComprobantes] = useState([
    { id: '1', banco: '', referencia: '', monto: '' }
  ]);
  const [focusedVoucherId, setFocusedVoucherId] = useState(null);
  const [errorReferenciaDuplicada, setErrorReferenciaDuplicada] = useState(null);
  const [modalConfirmarLimpiar, setModalConfirmarLimpiar] = useState(false);
  const [modalEliminarTransfVisible, setModalEliminarTransfVisible] = useState(false);
  const [transfAEliminarId, setTransfAEliminarId] = useState(null);
  const [montoEfectivoInput, setMontoEfectivoInput] = useState('');
  const [montoTransferenciaInput, setMontoTransferenciaInput] = useState('');
  const [referenciaPagoInicial, setReferenciaPagoInicial] = useState('');

  // Datos de respaldo: Codeudor Solidario (Sólo Venta a Crédito)
  const [codeudorNombre, setCodeudorNombre] = useState('');
  const [codeudorCedula, setCodeudorCedula] = useState('');
  const [codeudorTelefono, setCodeudorTelefono] = useState('');
  const [codeudorDireccion, setCodeudorDireccion] = useState('');

  // Datos de respaldo: Referencia Familiar o Personal (Sólo Venta a Crédito)
  const [referenciaNombre, setReferenciaNombre] = useState('');
  const [referenciaTelefono, setReferenciaTelefono] = useState('');
  const [referenciaParentesco, setReferenciaParentesco] = useState('Hermano(a)');

  // Herencia inteligente de garantías
  const [garantiasHeredadas, setGarantiasHeredadas] = useState(false);
  const [permitirModificarGarantias, setPermitirModificarGarantias] = useState(false);

  // Función para precargar garantías de cliente existente
  const cargarGarantiasCliente = async (cliente) => {
    if (!cliente) {
      setGarantiasHeredadas(false);
      setPermitirModificarGarantias(true);
      return;
    }

    if (cliente.ciudad) {
      setCiudadVenta(cliente.ciudad);
      const dep = cliente.departamento || inferirDepartamento(cliente.ciudad);
      setDepartamentoVenta(dep);
    }

    let codeudor = cliente.codeudor || null;
    let refFam = cliente.referencia_familiar || null;

    if ((!codeudor && !refFam) && cliente.id) {
      try {
        const res = await apiClient.get(`/clientes/${cliente.id}/garantias`);
        if (res.data) {
          codeudor = res.data.codeudor || null;
          refFam = res.data.referencia_familiar || null;
        }
      } catch (err) {
        console.log('[NuevaVentaScreen] Garantías previas no encontradas o sin conexión:', err);
      }
    }

    if (codeudor || refFam) {
      if (codeudor) {
        setCodeudorNombre(codeudor.nombre || '');
        setCodeudorCedula(codeudor.cedula || '');
        setCodeudorTelefono(codeudor.telefono || '');
        setCodeudorDireccion(codeudor.direccion || '');
      }
      if (refFam) {
        setReferenciaNombre(refFam.nombre || '');
        setReferenciaTelefono(refFam.telefono || '');
        setReferenciaParentesco(refFam.parentesco || 'Hermano(a)');
      }
      setGarantiasHeredadas(true);
      setPermitirModificarGarantias(false);
    } else {
      setGarantiasHeredadas(false);
      setPermitirModificarGarantias(true);
    }
  };

  // Estado de envío y comprobante
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ventaExitosa, setVentaExitosa] = useState(null);

  // Firmas táctiles capturadas en pantalla
  const [firmaTitular, setFirmaTitular] = useState(null);
  const [firmaVendedor, setFirmaVendedor] = useState(null);
  const [firmaCodeudor, setFirmaCodeudor] = useState(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  // Función para reiniciar el formulario completamente a estado en blanco
  const resetearFormularioCompleto = async () => {
    setClienteSeleccionado(null);
    setItemsVenta([]);
    setModalidad('credito');
    setTipoPago('mensual');
    setCuotaInicialInput('0');
    setMetodoPagoInicial('Efectivo');
    setBancoTransferencia('');
    setComprobantes([{ id: '1', banco: '', referencia: '', monto: '' }]);
    setCompEditandoBancoId(null);
    setErrorReferenciaDuplicada(null);
    setModalConfirmarLimpiar(false);
    setMontoEfectivoInput('');
    setMontoTransferenciaInput('');
    setReferenciaPagoInicial('');
    setNumeroCuotas(4);
    setFechasManuales(false);
    setFechaPrimeraCuotaManual(getFechaPrimerCobroSugerida(new Date(), true));
    setFechaPrimeraCuota(modalidadProyeccion === 'dinamica' ? getFechaPrimerCobroSugerida(new Date(), true) : getFechaPrimerCobroSugerida());
    setCodeudorNombre('');
    setCodeudorCedula('');
    setCodeudorTelefono('');
    setCodeudorDireccion('');
    setReferenciaNombre('');
    setReferenciaTelefono('');
    setReferenciaParentesco('Hermano(a)');
    setGarantiasHeredadas(false);
    setPermitirModificarGarantias(true);
    setFiltroCliente('');
    setFiltroProducto('');
    setCiudadVenta('Montería');
    setDepartamentoVenta('Córdoba');
    setNumeroContrato('');
    setContratoAutomatico(true);
    setModalSeleccionarCiudad(false);
    setFirmaTitular(null);
    setFirmaVendedor(null);
    setFirmaCodeudor(null);
    setIsDownloadingPdf(false);
    setModalSeleccionarCliente(false);
    setModalAgregarProducto(false);
    setVentaExitosa(null);
    try {
      await limpiarBorradorVenta();
    } catch (e) {
      console.warn('[NuevaVentaScreen] Error al limpiar borrador:', e);
    }
  };

  // Función auxiliar para inicializar un item de venta con control de stock y excepciones
  const crearItemVentaDesdeProducto = (p) => ({
    producto_id: p.id,
    sku: p.sku,
    nombre: p.nombre,
    es_precio_variable: p.es_precio_variable,
    maneja_stock: p.maneja_stock !== false,
    stock: p.stock != null ? Number(p.stock) : 0,
    cantidad: 1,
    valor_unitario: Number(p.precio_base || 0),
  });

  // Reset reactivo cuando se solicita un inicio limpio o cambian parámetros de navegación
  useEffect(() => {
    if (route?.params?.reset) {
      const ejecutarReset = async () => {
        await resetearFormularioCompleto();

        if (route.params.clientePreseleccionado) {
          setClienteSeleccionado(route.params.clientePreseleccionado);
          if (route.params.clientePreseleccionado.ciudad) {
            setCiudadVenta(route.params.clientePreseleccionado.ciudad);
            setDepartamentoVenta(
              route.params.clientePreseleccionado.departamento ||
              inferirDepartamento(route.params.clientePreseleccionado.ciudad)
            );
          }
          cargarGarantiasCliente(route.params.clientePreseleccionado);
        }

        if (route.params.productoPreseleccionado) {
          const p = route.params.productoPreseleccionado;
          const manejaStock = p.maneja_stock !== false;
          const stockDisp = p.stock != null ? Number(p.stock) : 0;
          if (manejaStock && stockDisp <= 0) {
            mostrarAlertaUniversal(
              'Artículo Agotado en Bodega',
              `El producto "${p.nombre}" (SKU: ${p.sku}) no cuenta con existencias disponibles en almacén.`,
              null,
              'warning'
            );
          } else {
            setItemsVenta([crearItemVentaDesdeProducto(p)]);
          }
        }
      };

      ejecutarReset();
    }
  }, [route?.params?.reset, route?.params?.timestamp]);

  // Listener al enfocar la pantalla: si viene con bandera reset, asegurar estado limpio
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (route?.params?.reset) {
        resetearFormularioCompleto().then(() => {
          if (route.params.clientePreseleccionado) {
            setClienteSeleccionado(route.params.clientePreseleccionado);
            if (route.params.clientePreseleccionado.ciudad) {
              setCiudadVenta(route.params.clientePreseleccionado.ciudad);
              setDepartamentoVenta(
                route.params.clientePreseleccionado.departamento ||
                inferirDepartamento(route.params.clientePreseleccionado.ciudad)
              );
            }
            cargarGarantiasCliente(route.params.clientePreseleccionado);
          }
          if (route.params.productoPreseleccionado) {
            const p = route.params.productoPreseleccionado;
            const manejaStock = p.maneja_stock !== false;
            const stockDisp = p.stock != null ? Number(p.stock) : 0;
            if (manejaStock && stockDisp <= 0) {
              mostrarAlertaUniversal(
                'Artículo Agotado en Bodega',
                `El producto "${p.nombre}" (SKU: ${p.sku}) no cuenta con existencias disponibles en almacén.`,
                null,
                'warning'
              );
            } else {
              setItemsVenta([crearItemVentaDesdeProducto(p)]);
            }
          }
        });
      }
    });
    return unsubscribe;
  }, [navigation, route?.params?.reset, route?.params?.timestamp]);

  // Cargar clientes y productos (con soporte de Caché Offline)
  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoadingData(true);
        // 1. Intentar cargar desde la API
        const [resClientes, resProductos] = await Promise.all([
          apiClient.get('/clientes').catch(() => null),
          apiClient.get('/productos').catch(() => null),
        ]);

        if (resClientes && Array.isArray(resClientes.data)) {
          setClientes(resClientes.data);
          guardarEnCache(STORAGE_KEYS.CACHE_CLIENTES, resClientes.data);
        } else {
          // Fallback a caché local
          const cached = await obtenerDeCache(STORAGE_KEYS.CACHE_CLIENTES);
          if (cached) setClientes(cached);
        }

        if (resProductos && Array.isArray(resProductos.data)) {
          const activos = resProductos.data.filter((p) => p.estado_activo !== false);
          setProductos(activos);
          guardarEnCache(STORAGE_KEYS.CACHE_PRODUCTOS, activos);
        } else {
          // Fallback a caché local
          const cachedProds = await obtenerDeCache(STORAGE_KEYS.CACHE_PRODUCTOS);
          if (cachedProds) setProductos(cachedProds);
        }

        // 3. Cargar opciones de cuotas permitidas dinámicamente (Offline-First)
        try {
          const cachedConfigRaw = await AsyncStorage.getItem(CACHE_CONFIG);
          if (cachedConfigRaw) {
            const parsedConfig = JSON.parse(cachedConfigRaw);
            const plazos = parsedConfig?.reglas_credito?.plazos_permitidos;
            if (Array.isArray(plazos) && plazos.length > 0) {
              const clean = plazos
                .map((p) => parseInt(p, 10))
                .filter((p) => !isNaN(p) && p > 0);
              if (clean.length > 0) {
                setPlazosPermitidos(clean);
                setNumeroCuotas((prev) => (clean.includes(prev) ? prev : clean[0]));
              }
            }
            const modProy = parsedConfig?.reglas_credito?.modalidad_proyeccion;
            if (modProy) setModalidadProyeccion(modProy);
          }

          // Refresco silencioso si hay red disponible
          apiClient.get('/configuracion/parametros')
            .then(async (resConf) => {
              if (resConf?.data) {
                await AsyncStorage.setItem(CACHE_CONFIG, JSON.stringify(resConf.data));
                const plazos = resConf.data?.reglas_credito?.plazos_permitidos;
                if (Array.isArray(plazos) && plazos.length > 0) {
                  const clean = plazos
                    .map((p) => parseInt(p, 10))
                    .filter((p) => !isNaN(p) && p > 0);
                  if (clean.length > 0) {
                    setPlazosPermitidos(clean);
                    setNumeroCuotas((prev) => (clean.includes(prev) ? prev : clean[0]));
                  }
                }
                const modProy = resConf.data?.reglas_credito?.modalidad_proyeccion;
                if (modProy) setModalidadProyeccion(modProy);
              }
            })
            .catch(() => {});
        } catch (configErr) {
          console.warn('[NuevaVentaScreen] Error leyendo CACHE_CONFIG:', configErr);
        }

        // Si vino un producto preseleccionado en ruta, agregarlo con validación preventiva
        if (route?.params?.productoPreseleccionado) {
          const p = route.params.productoPreseleccionado;
          const manejaStock = p.maneja_stock !== false;
          const stockDisp = p.stock != null ? Number(p.stock) : 0;
          if (manejaStock && stockDisp <= 0) {
            mostrarAlertaUniversal(
              'Artículo Agotado en Bodega',
              `El producto "${p.nombre}" (SKU: ${p.sku}) no cuenta con existencias disponibles en almacén.`,
              null,
              'warning'
            );
          } else {
            setItemsVenta([crearItemVentaDesdeProducto(p)]);
          }
        }
        // Si vino un cliente preseleccionado en ruta, cargar sus garantías
        if (route?.params?.clientePreseleccionado) {
          cargarGarantiasCliente(route.params.clientePreseleccionado);
        }
      } catch (err) {
        console.warn('[NuevaVentaScreen] Error cargando catálogos:', err);
      } finally {
        setIsLoadingData(false);
      }
    };

    fetchData();

    // 2. Restaurar borrador guardado en caso de suspensión o ahorro de energía
    const restaurarBorrador = async () => {
      // Si se solicitó un reseteo expreso o se preseleccionó producto/cliente, NO restaurar borrador viejo
      if (
        route?.params?.reset ||
        route?.params?.productoPreseleccionado ||
        route?.params?.clientePreseleccionado
      ) {
        return;
      }
      const draft = await obtenerBorradorVenta();
      if (draft && Array.isArray(draft.itemsVenta) && draft.itemsVenta.length > 0) {
        if (draft.clienteSeleccionado) setClienteSeleccionado(draft.clienteSeleccionado);
        // Enriquecer items restaurados con stock actualizado del catálogo
        const cachedProds = await obtenerDeCache(STORAGE_KEYS.CACHE_PRODUCTOS);
        const listaCatalogo = productos.length > 0 ? productos : (cachedProds || []);
        const enrichedItems = draft.itemsVenta.map((it) => {
          const prodCat = listaCatalogo.find((p) => p.id === it.producto_id);
          return {
            ...it,
            maneja_stock: prodCat ? prodCat.maneja_stock !== false : (it.maneja_stock !== false),
            stock: prodCat ? (prodCat.stock ?? 0) : (it.stock ?? 0),
          };
        });
        setItemsVenta(enrichedItems);
        if (draft.modalidad) setModalidad(draft.modalidad);
        if (draft.tipoPago) setTipoPago(draft.tipoPago);
        if (draft.cuotaInicialInput) setCuotaInicialInput(draft.cuotaInicialInput);
        if (draft.metodoPagoInicial) setMetodoPagoInicial(draft.metodoPagoInicial);
        if (draft.bancoTransferencia) setBancoTransferencia(draft.bancoTransferencia);
        if (draft.montoEfectivoInput) setMontoEfectivoInput(draft.montoEfectivoInput);
        if (draft.montoTransferenciaInput) setMontoTransferenciaInput(draft.montoTransferenciaInput);
        if (draft.referenciaPagoInicial) setReferenciaPagoInicial(draft.referenciaPagoInicial);
        if (draft.numeroCuotas) setNumeroCuotas(draft.numeroCuotas);
        if (typeof draft.fechasManuales === 'boolean') setFechasManuales(draft.fechasManuales);
        if (draft.fechaPrimeraCuotaManual) setFechaPrimeraCuotaManual(draft.fechaPrimeraCuotaManual);
        if (draft.fechaPrimeraCuota) setFechaPrimeraCuota(draft.fechaPrimeraCuota);
        if (draft.codeudorNombre) setCodeudorNombre(draft.codeudorNombre);
        if (draft.codeudorCedula) setCodeudorCedula(draft.codeudorCedula);
        if (draft.codeudorTelefono) setCodeudorTelefono(draft.codeudorTelefono);
        if (draft.codeudorDireccion) setCodeudorDireccion(draft.codeudorDireccion);
        if (draft.referenciaNombre) setReferenciaNombre(draft.referenciaNombre);
        if (draft.referenciaTelefono) setReferenciaTelefono(draft.referenciaTelefono);
        if (draft.referenciaParentesco) setReferenciaParentesco(draft.referenciaParentesco);
        if (draft.ciudadVenta) setCiudadVenta(draft.ciudadVenta);
        if (draft.departamentoVenta) setDepartamentoVenta(draft.departamentoVenta);
        if (draft.numeroContrato) setNumeroContrato(draft.numeroContrato);
        if (typeof draft.contratoAutomatico === 'boolean') setContratoAutomatico(draft.contratoAutomatico);
        if (typeof draft.garantiasHeredadas === 'boolean') setGarantiasHeredadas(draft.garantiasHeredadas);
        if (typeof draft.permitirModificarGarantias === 'boolean') setPermitirModificarGarantias(draft.permitirModificarGarantias);
      }
    };
    restaurarBorrador();
  }, [route?.params?.productoPreseleccionado, route?.params?.clientePreseleccionado]);

  // Protección contra suspensión del sistema operativo (Auto-guardado de borrador)
  useEffect(() => {
    // Escuchar cambios de estado de la aplicación (AppState: active -> background)
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        if (itemsVenta.length > 0 || clienteSeleccionado) {
          guardarBorradorVenta({
            clienteSeleccionado,
            itemsVenta,
            modalidad,
            tipoPago,
            cuotaInicialInput,
            metodoPagoInicial,
            bancoTransferencia,
            montoEfectivoInput,
            montoTransferenciaInput,
            referenciaPagoInicial,
            numeroCuotas,
            fechasManuales,
            fechaPrimeraCuotaManual,
            fechaPrimeraCuota,
            codeudorNombre,
            codeudorCedula,
            codeudorTelefono,
            codeudorDireccion,
            referenciaNombre,
            referenciaTelefono,
            referenciaParentesco,
            garantiasHeredadas,
            permitirModificarGarantias,
            ciudadVenta,
            departamentoVenta,
            numeroContrato,
            contratoAutomatico,
          });
        }
      }
    });

    // Guardado continuo del borrador
    if (itemsVenta.length > 0 || clienteSeleccionado) {
      guardarBorradorVenta({
        clienteSeleccionado,
        itemsVenta,
        modalidad,
        tipoPago,
        cuotaInicialInput,
        metodoPagoInicial,
        bancoTransferencia,
        montoEfectivoInput,
        montoTransferenciaInput,
        referenciaPagoInicial,
        numeroCuotas,
        fechasManuales,
        fechaPrimeraCuotaManual,
        fechaPrimeraCuota,
        codeudorNombre,
        codeudorCedula,
        codeudorTelefono,
        codeudorDireccion,
        referenciaNombre,
        referenciaTelefono,
        referenciaParentesco,
        garantiasHeredadas,
        permitirModificarGarantias,
        ciudadVenta,
        departamentoVenta,
        numeroContrato,
        contratoAutomatico,
      });
    }

    return () => {
      subscription.remove();
    };
  }, [
    clienteSeleccionado,
    itemsVenta,
    modalidad,
    tipoPago,
    cuotaInicialInput,
    metodoPagoInicial,
    montoEfectivoInput,
    montoTransferenciaInput,
    referenciaPagoInicial,
    numeroCuotas,
    fechasManuales,
    fechaPrimeraCuotaManual,
    fechaPrimeraCuota,
    codeudorNombre,
    codeudorCedula,
    codeudorTelefono,
    codeudorDireccion,
    referenciaNombre,
    referenciaTelefono,
    referenciaParentesco,
    garantiasHeredadas,
    permitirModificarGarantias,
    ciudadVenta,
    departamentoVenta,
    numeroContrato,
    contratoAutomatico,
  ]);

  // Cálculos financieros en tiempo real
  const totalArticulos = useMemo(() => {
    return itemsVenta.reduce((acc, item) => acc + item.cantidad * item.valor_unitario, 0);
  }, [itemsVenta]);

  const cuotaInicial = useMemo(() => {
    if (modalidad === 'contado') return totalArticulos;
    const val = parseFloat(cuotaInicialInput) || 0;
    return Math.min(val, totalArticulos);
  }, [modalidad, cuotaInicialInput, totalArticulos]);

  const montoFinanciado = useMemo(() => {
    if (modalidad === 'contado') return 0;
    return Math.max(0, totalArticulos - cuotaInicial);
  }, [modalidad, totalArticulos, cuotaInicial]);

  const valorCuota = useMemo(() => {
    if (modalidad === 'contado' || numeroCuotas <= 0) return 0;
    return Math.round(montoFinanciado / numeroCuotas);
  }, [modalidad, montoFinanciado, numeroCuotas]);

  const montoObjetivo = useMemo(() => {
    return modalidad === 'contado' ? totalArticulos : cuotaInicial;
  }, [modalidad, totalArticulos, cuotaInicial]);

  const totalTransferencias = useMemo(() => {
    return comprobantes.reduce((sum, c) => sum + (parseFloat(c.monto) || 0), 0);
  }, [comprobantes]);

  const totalIngresado = useMemo(() => {
    if (metodoPagoInicial === 'Efectivo') return montoObjetivo;
    if (metodoPagoInicial === 'Transferencia') return totalTransferencias;
    return (parseFloat(montoEfectivoInput) || 0) + totalTransferencias;
  }, [metodoPagoInicial, montoObjetivo, totalTransferencias, montoEfectivoInput]);

  const diferenciaCaja = useMemo(() => {
    if (montoObjetivo <= 0) return 0;
    return Math.round((montoObjetivo - totalIngresado) * 100) / 100;
  }, [montoObjetivo, totalIngresado]);

  const comprobantesValidos = useMemo(() => {
    if (metodoPagoInicial === 'Efectivo') return true;
    return (
      comprobantes.length > 0 &&
      comprobantes.every((c) => (c.banco || '').trim() !== '' && (c.referencia || '').trim() !== '' && (parseFloat(c.monto) || 0) > 0)
    );
  }, [metodoPagoInicial, comprobantes]);

  const hayRefsDuplicadasInternas = useMemo(() => {
    const refs = comprobantes.map((c) => (c.referencia || '').trim().toUpperCase()).filter(Boolean);
    return new Set(refs).size !== refs.length;
  }, [comprobantes]);

  const agregarComprobante = () => {
    if (comprobantes.length >= 3) return;
    const baseTrans = metodoPagoInicial === 'Mixto' ? Math.max(0, montoObjetivo - (parseFloat(montoEfectivoInput) || 0)) : montoObjetivo;
    const sumaActual = comprobantes.reduce((sum, c) => sum + (parseFloat(c.monto) || 0), 0);
    const restante = Math.max(0, baseTrans - sumaActual);
    const newId = String(Date.now() + Math.random());
    setFocusedVoucherId(newId);
    setComprobantes((prev) => [
      ...prev,
      { id: newId, banco: '', referencia: '', monto: restante > 0 ? String(restante) : '' }
    ]);
  };

  const eliminarComprobante = (id) => {
    if (comprobantes.length <= 1) return;
    setTransfAEliminarId(id);
    setModalEliminarTransfVisible(true);
  };

  const confirmarEliminarComprobante = () => {
    if (transfAEliminarId) {
      setComprobantes((prev) => prev.filter((c) => c.id !== transfAEliminarId));
    }
    setModalEliminarTransfVisible(false);
    setTransfAEliminarId(null);
  };

  const actualizarComprobante = (id, campo, valor) => {
    setComprobantes((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [campo]: valor } : c))
    );
    setErrorReferenciaDuplicada(null);
  };

  // Sincronización reactiva de fechaPrimeraCuota según la modalidad manual, automática o dinámica
  useEffect(() => {
    if (modalidadProyeccion === 'dinamica') {
      if (!fechaPrimeraCuota) {
        setFechaPrimeraCuota(getFechaPrimerCobroSugerida(new Date(), true));
      }
    } else if (fechasManuales) {
      const fManual = formatDateISO(fechaPrimeraCuotaManual) || getFechaPrimerCobroSugerida(new Date(), true);
      setFechaPrimeraCuota(fManual);
    } else {
      setFechaPrimeraCuota(getFechaPrimerCobroSugerida());
    }
  }, [modalidadProyeccion, fechasManuales, fechaPrimeraCuotaManual]);

  // Cronograma de amortización proyectado en tiempo real
  const cronogramaProyectado = useMemo(() => {
    if (modalidad === 'contado' || montoFinanciado <= 0 || numeroCuotas <= 0) {
      return [];
    }
    const fInicio = fechasManuales
      ? (formatDateISO(fechaPrimeraCuotaManual) || getFechaPrimerCobroSugerida(new Date(), true))
      : (fechaPrimeraCuota || getFechaPrimerCobroSugerida());

    return calcularCronogramaCuotas(fInicio, numeroCuotas, tipoPago, valorCuota, fechasManuales);
  }, [modalidad, montoFinanciado, numeroCuotas, tipoPago, valorCuota, fechaPrimeraCuota, fechasManuales, fechaPrimeraCuotaManual]);

  // Manejo de productos en la orden con validación preventiva de existencias y excepción de cuadros
  const agregarProductoAOrden = (p) => {
    const manejaStock = p.maneja_stock !== false;
    const stockDisp = p.stock != null ? Number(p.stock) : 0;

    // 1. Excepción de Cuadros: Si maneja_stock === false, se vende libremente
    if (manejaStock && stockDisp <= 0) {
      mostrarAlertaUniversal(
        'Artículo Agotado en Bodega',
        `El producto "${p.nombre}" (SKU: ${p.sku}) no cuenta con existencias físicas en almacén (Stock: 0). No es posible añadirlo a la venta hasta su reabastecimiento.`,
        null,
        'warning'
      );
      return;
    }

    // 2. Si ya está en la orden, verificar que no supere las existencias
    const itemExistente = itemsVenta.find((item) => item.producto_id === p.id);
    if (itemExistente && manejaStock) {
      if (itemExistente.cantidad + 1 > stockDisp) {
        mostrarAlertaUniversal(
          'Límite de Existencias en Bodega',
          `Solo hay ${stockDisp} unidades disponibles de "${p.nombre}". Ya tienes ${itemExistente.cantidad} en la orden de venta.`,
          null,
          'warning'
        );
        return;
      }
    }

    setItemsVenta((prev) => {
      const idx = prev.findIndex((item) => item.producto_id === p.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx].cantidad += 1;
        return copy;
      }
      return [
        ...prev,
        crearItemVentaDesdeProducto(p),
      ];
    });
    setModalAgregarProducto(false);
  };

  const modificarCantidad = (index, delta) => {
    setItemsVenta((prev) => {
      const copy = [...prev];
      const item = copy[index];
      if (!item) return prev;

      // Validación preventiva al incrementar cantidad
      if (delta > 0) {
        const prodEnCatalogo = productos.find((p) => p.id === item.producto_id);
        const manejaStock = prodEnCatalogo ? prodEnCatalogo.maneja_stock !== false : item.maneja_stock !== false;
        const stockDisp = prodEnCatalogo ? (prodEnCatalogo.stock ?? 0) : (item.stock ?? 0);

        if (manejaStock && item.cantidad + delta > stockDisp) {
          mostrarAlertaUniversal(
            'Límite de Existencias en Bodega',
            `No es posible añadir más unidades de "${item.nombre}". Solo quedan ${stockDisp} unidades disponibles en almacén.`,
            null,
            'warning'
          );
          return prev;
        }
      }

      const nueva = item.cantidad + delta;
      if (nueva <= 0) {
        return copy.filter((_, i) => i !== index);
      }
      copy[index].cantidad = nueva;
      return copy;
    });
  };

  const modificarPrecioUnitario = (index, nuevoPrecio) => {
    const parsed = parseFloat(nuevoPrecio) || 0;
    setItemsVenta((prev) => {
      const copy = [...prev];
      copy[index].valor_unitario = parsed;
      return copy;
    });
  };

  // Enviar Venta / Crédito al Backend FastAPI (Arquitectura Offline-First)
  const handleTransmitirVenta = async () => {
    if (isSubmitting) return;

    if (!clienteSeleccionado) {
      mostrarAlertaUniversal('Cliente Requerido', 'Por favor selecciona el cliente titular de la operación antes de continuar.', null, 'warning');
      return;
    }
    if (itemsVenta.length === 0) {
      mostrarAlertaUniversal('Artículos Requeridos', 'Agrega al menos un producto a la orden de venta.', null, 'warning');
      return;
    }

    // Validación preventiva de existencias físicas en bodega
    for (const item of itemsVenta) {
      const prodEnCatalogo = productos.find((p) => p.id === item.producto_id);
      const manejaStock = prodEnCatalogo ? prodEnCatalogo.maneja_stock !== false : item.maneja_stock !== false;
      const stockDisponible = prodEnCatalogo ? (prodEnCatalogo.stock ?? 0) : (item.stock ?? 0);

      if (manejaStock && item.cantidad > stockDisponible) {
        mostrarAlertaUniversal(
          'Stock Insuficiente en Almacén',
          `El artículo "${item.nombre}" supera el inventario disponible en bodega (${item.cantidad} solicitadas, ${stockDisponible} disponibles). Ajusta las cantidades antes de transmitir la venta.`,
          null,
          'warning'
        );
        return;
      }
    }

    // Validación de políticas de riesgo para venta a crédito
    if (modalidad === 'credito') {
      if (!codeudorNombre.trim()) {
        mostrarAlertaUniversal(
          'Codeudor Requerido',
          'Para originar una venta a crédito debes registrar el nombre completo del codeudor solidario.',
          null,
          'warning'
        );
        return;
      }
      if (!codeudorTelefono.trim()) {
        mostrarAlertaUniversal(
          'Teléfono de Codeudor Requerido',
          'Ingresa el teléfono de contacto del codeudor solidario para el estudio y verificación crediticia.',
          null,
          'warning'
        );
        return;
      }
    }

    // Validación estricta de Pago Mixto / Transferencia (Solo si monto a pagar > 0)
    const montoEsperadoPago = modalidad === 'contado' ? totalArticulos : cuotaInicial;

    if (montoEsperadoPago > 0 && metodoPagoInicial !== 'Efectivo') {
      if (diferenciaCaja !== 0) {
        mostrarAlertaUniversal(
          'Descuadre matemático de caja',
          `El total ingresado (${formatCOP(totalIngresado)}) no coincide con ${modalidad === 'contado' ? 'el total de la venta' : 'la cuota inicial'} (${formatCOP(montoEsperadoPago)}). ${diferenciaCaja > 0 ? `Faltan ${formatCOP(diferenciaCaja)} COP.` : `Sobran ${formatCOP(Math.abs(diferenciaCaja))} COP.`}`,
          null,
          'error'
        );
        return;
      }

      if (!comprobantesValidos) {
        mostrarAlertaUniversal(
          'Comprobantes Incompletos',
          'Cada comprobante bancario debe incluir entidad bancaria, número de referencia válido y un monto mayor a cero.',
          null,
          'warning'
        );
        return;
      }

      if (hayRefsDuplicadasInternas) {
        mostrarAlertaUniversal(
          'Comprobantes Duplicados',
          'No puede ingresar números de referencia idénticos en comprobantes distintos de la misma venta.',
          null,
          'error'
        );
        return;
      }
    }

    // Validación estricta de firmas: Titular y Vendedor son obligatorias; Codeudor es opcional
    if (!firmaTitular) {
      mostrarAlertaUniversal(
        'Firma del Titular Requerida',
        'Por favor capture la firma digital del cliente titular en el recuadro correspondiente antes de transmitir la venta.',
        null,
        'warning'
      );
      return;
    }
    if (!firmaVendedor) {
      mostrarAlertaUniversal(
        'Firma del Asesor Requerida',
        'Por favor estampe su firma digital de asesor comercial en el recuadro correspondiente antes de enviar el contrato.',
        null,
        'warning'
      );
      return;
    }

    try {
      setIsSubmitting(true);

      // Fecha de primera cuota según configuración manual, dinámica o cálculo automático a fin de mes
      let fPrimera;
      if (modalidadProyeccion === 'dinamica') {
        const fDynStr = formatDateISO(fechaPrimeraCuota);
        if (!fDynStr || !/^\d{4}-\d{2}-\d{2}$/.test(fDynStr)) {
          mostrarAlertaUniversal(
            'Fecha de Primer Pago Requerida',
            'En modalidad dinámica es obligatorio seleccionar la fecha del primer cobro.',
            null,
            'warning'
          );
          setIsSubmitting(false);
          return;
        }
        fPrimera = fDynStr;
      } else if (fechasManuales) {
        const fManualStr = formatDateISO(fechaPrimeraCuotaManual);
        fPrimera = (fManualStr && /^\d{4}-\d{2}-\d{2}$/.test(fManualStr))
          ? fManualStr
          : getFechaPrimerCobroSugerida(new Date(), true);
      } else {
        fPrimera = getFechaPrimerCobroSugerida();
      }

      // Distribución granular de pago según método de pago (Contado o Crédito)
      const montoBase = modalidad === 'contado' ? totalArticulos : cuotaInicial;
      const esMontoCero = !montoBase || montoBase <= 0;

      // Si cuotaInicial === 0 (o montoBase === 0), fuerza de forma predeterminada:
      // metodo_pago_inicial: 'Efectivo', monto_inicial_efectivo: 0, monto_inicial_transferencia: 0, referencia_pago_inicial: ''
      const metodoPagoFinal = esMontoCero ? 'Efectivo' : (metodoPagoInicial || 'Efectivo');
      const esEfectivoPuro = metodoPagoFinal === 'Efectivo' || esMontoCero;

      const montoInicialEfectivo = esMontoCero
        ? 0
        : (metodoPagoFinal === 'Mixto'
            ? (parseFloat(montoEfectivoInput) || 0)
            : (metodoPagoFinal === 'Efectivo' ? montoBase : 0));

      const montoInicialTransferencia = esMontoCero
        ? 0
        : (metodoPagoFinal === 'Mixto' || metodoPagoFinal === 'Transferencia'
            ? totalTransferencias
            : 0);

      // FASE 2: Si el pago es en Efectivo, banco y referencia viajan explícitamente como null para evitar choque Pydantic (422)
      const refPagoInicial = esEfectivoPuro
        ? null
        : (comprobantes.map((c) => (c.referencia || '').trim()).filter(Boolean).join(' / ') || null);

      const finalBancoTransferencia = esEfectivoPuro
        ? null
        : (comprobantes[0]?.banco?.trim() || null);

      // Objetos de respaldo para crédito
      const codeudorObj = modalidad === 'credito' && codeudorNombre.trim() ? {
        nombre: codeudorNombre.trim(),
        cedula: codeudorCedula.trim() || null,
        telefono: codeudorTelefono.trim() || null,
        direccion: codeudorDireccion.trim() || null,
      } : null;

      const referenciaObj = modalidad === 'credito' && referenciaNombre.trim() ? {
        nombre: referenciaNombre.trim(),
        telefono: referenciaTelefono.trim() || null,
        parentesco: referenciaParentesco.trim() || null,
      } : null;

      const payload = {
        cliente_id: clienteSeleccionado.id,
        vendedor_id: user?.id,
        tipo_pago: modalidad === 'contado' ? 'mensual' : tipoPago,
        cuota_inicial: modalidad === 'contado' ? totalArticulos : cuotaInicial,
        metodo_pago_inicial: metodoPagoFinal,
        banco_transferencia: esEfectivoPuro ? null : finalBancoTransferencia,
        monto_inicial_efectivo: montoInicialEfectivo,
        monto_inicial_transferencia: montoInicialTransferencia,
        referencia_pago_inicial: esEfectivoPuro ? null : refPagoInicial,
        monto_financiado: montoFinanciado,
        numero_cuotas: modalidad === 'contado' ? 1 : numeroCuotas,
        valor_cuota: valorCuota,
        fecha_primera_cuota: fPrimera,
        saldo_pendiente: montoFinanciado,
        departamento_venta: departamentoVenta.trim() || 'Córdoba',
        ciudad_venta: ciudadVenta.trim() || 'Montería',
        generacion_automatica_contrato: contratoAutomatico,
        ...(!contratoAutomatico && numeroContrato.trim() ? { numero_contrato: numeroContrato.trim() } : {}),
        detalles: itemsVenta.map((item) => ({
          producto_id: item.producto_id,
          cantidad: item.cantidad,
          valor_unitario_acordado: item.valor_unitario,
        })),
        ...(!esMontoCero && !esEfectivoPuro && comprobantes.length > 0 ? {
          transferencias: comprobantes
            .filter((c) => (parseFloat(c.monto) || 0) > 0)
            .map((c) => ({
              entidad_bancaria: (c.banco || '').trim(),
              referencia_pago: (c.referencia || '').trim(),
              monto: parseFloat(c.monto) || 0,
            }))
        } : {}),
        codeudor: codeudorObj,
        referencia: referenciaObj,
        firma_titular: firmaTitular || null,
        firma_vendedor: firmaVendedor || null,
        firma_codeudor: firmaCodeudor || null,
        modalidad_proyeccion: modalidadProyeccion || 'fija',
      };

      const meta = {
        cliente_nombre: clienteSeleccionado.nombres,
        cliente_cedula: clienteSeleccionado.cedula,
        cliente_telefono: clienteSeleccionado.telefono || '',
        total: totalArticulos,
        modalidad,
        cuotas: modalidad === 'contado' ? 1 : numeroCuotas,
        valor_cuota: valorCuota,
        tipo_pago: tipoPago,
        cuota_inicial: modalidad === 'contado' ? totalArticulos : cuotaInicial,
        metodo_pago_inicial: metodoPagoFinal,
        banco_transferencia: esEfectivoPuro ? null : finalBancoTransferencia,
        monto_inicial_efectivo: montoInicialEfectivo,
        monto_inicial_transferencia: montoInicialTransferencia,
        referencia_pago_inicial: esEfectivoPuro ? '' : (refPagoInicial || ''),
        departamento_venta: departamentoVenta.trim() || 'Córdoba',
        ciudad_venta: ciudadVenta.trim() || 'Montería',
        generacion_automatica_contrato: contratoAutomatico,
        numero_contrato: (!contratoAutomatico && numeroContrato.trim()) ? numeroContrato.trim() : undefined,
        articulos_resumen: itemsVenta.map((i) => `${i.cantidad}x ${i.nombre}`).join(', '),
        codeudor: codeudorObj,
        referencia: referenciaObj,
        firma_titular: firmaTitular || null,
        firma_vendedor: firmaVendedor || null,
        firma_codeudor: firmaCodeudor || null,
        modalidad_proyeccion: modalidadProyeccion || 'fija',
      };

      // Encolado resiliente (Persiste localmente y envía inmediatamente si hay red)
      const res = await encolarVenta(payload, meta);

      if (!res || !res.ok) {
        setIsSubmitting(false);

        // MANEJO CRÍTICO DE SESIÓN EXPIRADA (HTTP 401)
        if (
          res?.status === 401 ||
          (res?.error && String(res.error).toLowerCase().includes('sesión') && String(res.error).toLowerCase().includes('expirada')) ||
          (res?.error && String(res.error).toLowerCase().includes('token'))
        ) {
          mostrarAlertaUniversal(
            '🔒 Sesión Expirada',
            'Tu sesión de trabajo ha vencido o el token de seguridad ya no es válido. Por favor inicia sesión nuevamente para continuar.',
            [
              {
                text: 'Iniciar Sesión',
                onPress: async () => {
                  try {
                    await logout();
                  } catch (_) {}
                  navigation.reset({
                    index: 0,
                    routes: [{ name: 'Login' }],
                  });
                },
              },
            ],
            'error'
          );
          return;
        }

        const isDuplicado = res?.status === 409 || (res?.error && String(res.error).toLowerCase().includes('referencia'));
        const alertTitulo = isDuplicado ? '⚠️ Comprobante Bancario Duplicado' : 'Aviso de Validación';
        const alertMsg = res?.error || 'No fue posible originar la venta. Verifique los datos ingresados.';
        if (isDuplicado) {
          setErrorReferenciaDuplicada(alertMsg);
        }
        mostrarAlertaUniversal(
          alertTitulo,
          alertMsg,
          [{ text: isDuplicado ? 'Corregir Referencia' : 'Aceptar' }],
          isDuplicado ? 'warning' : 'error'
        );
        return;
      }

      // Limpiar borrador local tras registro exitoso
      await limpiarBorradorVenta();

      // Extracción robusta del ID o hash exacto del contrato transmitido
      const exactIdContrato =
        res.data?.id_contrato ||
        res.data?.id ||
        res.data?.data?.id_contrato ||
        res.data?.data?.id ||
        res.id_contrato ||
        res.idLocal ||
        null;

      const rawIdContrato = exactIdContrato || 'CTR-TEMP';
      const idContratoCodigo = String(rawIdContrato).startsWith('CTR-')
        ? String(rawIdContrato).slice(0, 16).toUpperCase()
        : `CTR-${String(rawIdContrato).slice(0, 8).toUpperCase()}`;

      const fEmision = new Date();
      const fEmisionStr = formatDateISO(fEmision);
      const nomClienteLimpio = (clienteSeleccionado.nombres || 'Cliente')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/[-\s]+/g, '_') || 'Cliente';

      const nombreArchivoPdf = `Venta_${idContratoCodigo}_${nomClienteLimpio}_${fEmisionStr}.pdf`;

      setVentaExitosa({
        id_contrato: exactIdContrato || rawIdContrato,
        id_contrato_uuid: exactIdContrato,
        id_contrato_codigo: idContratoCodigo,
        numero_contrato: res.data?.numero_contrato || (numeroContrato.trim() || undefined),
        departamento_venta: res.data?.departamento_venta || departamentoVenta.trim() || 'Córdoba',
        ciudad_venta: res.data?.ciudad_venta || ciudadVenta.trim() || 'Montería',
        nombre_archivo_pdf: nombreArchivoPdf,
        cliente: clienteSeleccionado.nombres,
        cliente_cedula: clienteSeleccionado.cedula,
        cliente_telefono: clienteSeleccionado.telefono || '',
        modalidad: modalidad === 'contado' ? 'Venta de Contado' : 'Crédito Financiado',
        total: totalArticulos,
        cuota_inicial: modalidad === 'contado' ? totalArticulos : cuotaInicial,
        metodo_pago_inicial: metodoPagoFinal,
        monto_inicial_efectivo: montoInicialEfectivo,
        monto_inicial_transferencia: montoInicialTransferencia,
        referencia_pago_inicial: refPagoInicial,
        cuotas: modalidad === 'contado' ? 'Liquidado' : `${numeroCuotas} cuotas de ${formatCOP(valorCuota)}`,
        codeudor: codeudorObj ? codeudorObj.nombre : null,
        referencia: referenciaObj ? `${referenciaObj.nombre} (${referenciaObj.parentesco || 'Familiar'})` : null,
        offline: Boolean(res.offline),
        firma_titular: firmaTitular,
        firma_vendedor: firmaVendedor,
        firma_codeudor: firmaCodeudor,
      });
    } catch (error) {
      console.error('[NuevaVentaScreen] Error originando crédito:', error);
      setIsSubmitting(false);

      if (
        error?.response?.status === 401 ||
        (error?.message && String(error.message).includes('401')) ||
        (error?.response?.data?.detail && String(error.response.data.detail).toLowerCase().includes('token'))
      ) {
        mostrarAlertaUniversal(
          '🔒 Sesión Expirada',
          'Tu sesión de trabajo ha vencido o el token de seguridad ya no es válido. Por favor inicia sesión nuevamente para continuar.',
          [
            {
              text: 'Iniciar Sesión',
              onPress: async () => {
                try {
                  await logout();
                } catch (_) {}
                navigation.reset({
                  index: 0,
                  routes: [{ name: 'Login' }],
                });
              },
            },
          ],
          'error'
        );
        return;
      }

      const isDuplicado = error?.response?.status === 409 || (error?.message && String(error.message).toLowerCase().includes('referencia'));
      const msg = error?.response?.data?.detail || error.message || 'Ocurrió un error inesperado al procesar la transacción.';
      const alertTitulo = isDuplicado ? '⚠️ Comprobante Bancario Duplicado' : 'Error en Venta';
      const alertMsg = typeof msg === 'string' ? msg : JSON.stringify(msg);
      if (isDuplicado) {
        setErrorReferenciaDuplicada(alertMsg);
      }
      mostrarAlertaUniversal(
        alertTitulo,
        alertMsg,
        [{ text: isDuplicado ? 'Corregir Referencia' : 'Aceptar' }],
        isDuplicado ? 'warning' : 'error'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Descargar y guardar localmente el comprobante PDF con nomenclatura humana
  const handleDescargarPdf = async (customId = null) => {
    const idContrato =
      customId ||
      ventaExitosa?.id_contrato ||
      ventaExitosa?.id_contrato_uuid ||
      ventaExitosa?.id_contrato_codigo;

    if (!idContrato || idContrato === 'CTR-TEMP') {
      mostrarAlertaUniversal(
        'Comprobante No Disponible',
        'No se ha encontrado un identificador válido para este contrato.',
        null,
        'warning'
      );
      return;
    }

    if (ventaExitosa?.offline) {
      mostrarAlertaUniversal(
        'Venta Guardada Localmente (Offline)',
        'Esta venta fue almacenada en la cola de sincronización local de su dispositivo. El comprobante PDF estará disponible una vez que se restablezca la conexión y se sincronice con el servidor.',
        null,
        'info'
      );
      return;
    }

    setIsDownloadingPdf(true);
    try {
      // 1. Obtener token de sesión activo (AuthContext en memoria o AsyncStorage bajo @remundial_token)
      const rawToken =
        authToken ||
        (await AsyncStorage.getItem(AUTH_STORAGE_KEYS?.TOKEN || '@remundial_token')) ||
        (await AsyncStorage.getItem('@remundial_token')) ||
        (await AsyncStorage.getItem('token')) ||
        apiClient.defaults.headers.common?.['Authorization'] ||
        apiClient.defaults.headers?.['Authorization'];

      const tokenLimpio = rawToken ? String(rawToken).replace(/^Bearer\s+/i, '').trim() : '';
      const authHeaders = tokenLimpio ? { Authorization: `Bearer ${tokenLimpio}` } : {};

      const filename = ventaExitosa?.nombre_archivo_pdf || `Venta_${ventaExitosa?.id_contrato_codigo || idContrato}.pdf`;

      if (Platform.OS === 'web') {
        const baseURL = apiClient.defaults.baseURL || 'http://localhost:8000';
        const queryToken = tokenLimpio ? `?token=${encodeURIComponent(tokenLimpio)}` : '';
        const downloadUrl = `${baseURL}/creditos/${idContrato}/recibo-pdf${queryToken}`;
        const res = await fetch(downloadUrl, {
          method: 'GET',
          headers: {
            ...authHeaders,
            Accept: 'application/pdf',
          },
        });
        if (!res.ok) {
          const errText = await res.text();
          console.error('[NuevaVentaScreen] Error devuelto por API en descarga PDF:', errText);
          throw new Error(errText || 'No fue posible generar el comprobante PDF.');
        }
        const blob = await res.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(blobUrl);
      } else {
        const baseURL = apiClient.defaults.baseURL || 'http://10.0.2.2:8000';
        const targetUrl = `${baseURL}/creditos/${idContrato}/recibo-pdf?token=${encodeURIComponent(tokenLimpio || '')}`;
        await Linking.openURL(targetUrl);
      }
    } catch (err) {
      console.error('[NuevaVentaScreen] Error al descargar PDF:', err);
      mostrarAlertaUniversal(
        'Comprobante PDF',
        err.message || 'No se pudo descargar el archivo en este momento. Verifique la conexión con el servidor.',
        null,
        'error'
      );
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  // Compartir comprobante digital vía WhatsApp al cliente
  const handleCompartirWhatsApp = async () => {
    if (!ventaExitosa) return;
    const tel = (ventaExitosa.cliente_telefono || '').replace(/\D/g, '');
    const telColombia = tel.length >= 10 ? (tel.startsWith('57') ? tel : `57${tel}`) : '';
    const idCtr = ventaExitosa.id_contrato_codigo || ventaExitosa.id_contrato;
    const nomPdf = ventaExitosa.nombre_archivo_pdf || `Venta_${idCtr}.pdf`;

    const mensaje =
      `*REMUNDIAL - COMPROBANTE OFICIAL DE VENTA*\n\n` +
      `Estimado(a) *${ventaExitosa.cliente}*,\n` +
      `Se ha originado con éxito su contrato de venta con Remundial.\n\n` +
      `📋 *No. Contrato:* ${idCtr}\n` +
      (ventaExitosa.numero_contrato ? `📑 *Folio Físico:* ${ventaExitosa.numero_contrato}\n` : '') +
      (ventaExitosa.ciudad_venta ? `📍 *Ciudad de Venta:* ${ventaExitosa.ciudad_venta}\n` : '') +
      `📦 *Modalidad:* ${ventaExitosa.modalidad}\n` +
      `💵 *Valor Total:* ${formatCOP(ventaExitosa.total)}\n` +
      `📆 *Plan de Pagos:* ${ventaExitosa.cuotas}\n` +
      `✍️ *Firmas:* Titular y Asesor Comercial estampadas digitalmente.\n` +
      `📁 *Documento Oficial:* ${nomPdf}\n\n` +
      `¡Muchas gracias por su preferencia!`;

    const waUrl = telColombia
      ? `https://api.whatsapp.com/send?phone=${telColombia}&text=${encodeURIComponent(mensaje)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(mensaje)}`;

    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(waUrl, '_blank');
      } else {
        await Linking.openURL(waUrl);
      }
    } catch (err) {
      console.warn('[NuevaVentaScreen] Error al abrir WhatsApp:', err);
      mostrarAlertaUniversal('WhatsApp', 'No fue posible abrir WhatsApp en este dispositivo.', null, 'warning');
    }
  };

  // Compartir comprobante digital vía Correo Electrónico
  const handleCompartirEmail = async () => {
    if (!ventaExitosa) return;
    const idCtr = ventaExitosa.id_contrato_codigo || ventaExitosa.id_contrato;
    const nomPdf = ventaExitosa.nombre_archivo_pdf || `Venta_${idCtr}.pdf`;
    const asunto = `Comprobante de Venta - Contrato ${idCtr} - Remundial`;
    const cuerpo =
      `Estimado(a) ${ventaExitosa.cliente},\n\n` +
      `Adjuntamos el resumen de su contrato originado con Remundial:\n\n` +
      `• No. Contrato: ${idCtr}\n` +
      (ventaExitosa.numero_contrato ? `• Folio Físico: ${ventaExitosa.numero_contrato}\n` : '') +
      (ventaExitosa.ciudad_venta ? `• Ciudad de Venta: ${ventaExitosa.ciudad_venta}\n` : '') +
      `• Modalidad: ${ventaExitosa.modalidad}\n` +
      `• Valor Total: ${formatCOP(ventaExitosa.total)}\n` +
      `• Plan de Pagos: ${ventaExitosa.cuotas}\n` +
      `• Firmas: Firmado digitalmente en pantalla por Titular y Vendedor.\n` +
      `• Archivo PDF: ${nomPdf}\n\n` +
      `Atentamente,\n` +
      `Equipo Remundial Core`;

    const mailUrl = `mailto:?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;

    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.href = mailUrl;
      } else {
        await Linking.openURL(mailUrl);
      }
    } catch (err) {
      console.warn('[NuevaVentaScreen] Error al abrir correo:', err);
      mostrarAlertaUniversal('Correo Electrónico', 'No fue posible abrir la aplicación de correo.', null, 'warning');
    }
  };

  // Clientes filtrados para el selector
  const clientesFiltrados = clientes.filter((c) => {
    const q = filtroCliente.toLowerCase();
    return (
      (c.nombres?.toLowerCase() || '').includes(q) ||
      (c.cedula?.toLowerCase() || '').includes(q) ||
      (c.barrio?.toLowerCase() || '').includes(q)
    );
  });

  // Productos filtrados para el selector
  const productosFiltrados = productos.filter((p) => {
    const q = filtroProducto.toLowerCase();
    return (
      (p.nombre?.toLowerCase() || '').includes(q) ||
      (p.sku?.toLowerCase() || '').includes(q)
    );
  });

  // Selector reutilizable de método de pago (Aplica tanto a Contado como a Cuota Inicial de Crédito)
  const renderSelectorMetodoPago = () => {
    const esContado = modalidad === 'contado';
    const isCero = !montoObjetivo || montoObjetivo <= 0;

    return (
      <View style={styles.metodoPagoBox}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <Text style={styles.fieldLabel}>
            {esContado ? 'MÉTODO DE PAGO (VENTA DE CONTADO) *' : 'MÉTODO DE PAGO (CUOTA INICIAL) *'}
          </Text>
          {montoObjetivo > 0 ? (
            <Text style={{ fontSize: 9, fontWeight: '800', color: '#047857' }}>
              {esContado ? `TOTAL: ${formatCOP(montoObjetivo)}` : `ANTICIPO: ${formatCOP(montoObjetivo)}`}
            </Text>
          ) : (
            <Text style={{ fontSize: 9, fontWeight: '700', color: '#94A3B8' }}>
              {esContado ? 'TOTAL: $ 0' : 'SIN ANTICIPO ($ 0)'}
            </Text>
          )}
        </View>

        {/* SegmentedControl: Efectivo, Transferencia, Mixto */}
        <View style={[styles.metodoPagoTabs, isCero && styles.metodoPagoTabsDisabled]}>
          {['Efectivo', 'Transferencia', 'Mixto'].map((metodo) => {
            const isSelected = isCero ? metodo === 'Efectivo' : metodoPagoInicial === metodo;
            return (
              <TouchableOpacity
                key={metodo}
                disabled={isCero}
                style={[
                  styles.metodoPagoTabBtn,
                  isSelected && styles.metodoPagoTabBtnActive,
                  isCero && isSelected && styles.metodoPagoTabBtnDisabledActive,
                ]}
                onPress={() => {
                  if (isCero) return;
                  setMetodoPagoInicial(metodo);
                  if (metodo === 'Efectivo') {
                    setMontoEfectivoInput(montoObjetivo > 0 ? String(montoObjetivo) : '');
                    setMontoTransferenciaInput('0');
                    setComprobantes([{ id: '1', banco: '', referencia: '', monto: '' }]);
                  } else if (metodo === 'Transferencia') {
                    setMontoEfectivoInput('0');
                    setMontoTransferenciaInput(montoObjetivo > 0 ? String(montoObjetivo) : '');
                    setComprobantes([
                      { id: '1', banco: comprobantes[0]?.banco || '', referencia: comprobantes[0]?.referencia || '', monto: montoObjetivo > 0 ? String(montoObjetivo) : '' }
                    ]);
                  } else if (metodo === 'Mixto') {
                    if (montoObjetivo > 0) {
                      const mitad = Math.floor(montoObjetivo / 2);
                      setMontoEfectivoInput(String(mitad));
                      setMontoTransferenciaInput(String(montoObjetivo - mitad));
                      setComprobantes([
                        { id: '1', banco: comprobantes[0]?.banco || '', referencia: comprobantes[0]?.referencia || '', monto: String(montoObjetivo - mitad) }
                      ]);
                    }
                  }
                }}
                accessibilityRole="button"
                accessibilityState={{ disabled: isCero, selected: isSelected }}
              >
                <Text
                  style={[
                    styles.metodoPagoTabText,
                    isSelected && styles.metodoPagoTabTextActive,
                    isCero && isSelected && styles.metodoPagoTabTextDisabledActive,
                    isCero && !isSelected && styles.metodoPagoTabTextDisabled,
                  ]}
                >
                  {metodo === 'Efectivo' && '💵 '}
                  {metodo === 'Transferencia' && '📱 '}
                  {metodo === 'Mixto' && '⚖️ '}
                  {metodo}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Sección de Transferencia o Mixto con múltiples comprobantes y cuadre en vivo */}
        {!isCero && (metodoPagoInicial === 'Transferencia' || metodoPagoInicial === 'Mixto') && (
          <View style={styles.metodoDetalleBox}>
            <View style={styles.cuadreBoxHeader}>
              <Text style={styles.cuadreBoxTitle}>
                {metodoPagoInicial === 'Mixto' ? 'DESGLOSE DE PAGO SIMULTÁNEO' : 'COMPROBANTES BANCARIOS'}
              </Text>
              {montoObjetivo > 0 && (
                <View
                  style={[
                    styles.cuadreBadge,
                    diferenciaCaja === 0
                      ? styles.cuadreBadgeOk
                      : (diferenciaCaja < 0 ? styles.cuadreBadgeError : styles.cuadreBadgeOk),
                  ]}
                >
                  <Text
                    style={[
                      styles.cuadreBadgeText,
                      diferenciaCaja === 0
                        ? styles.cuadreBadgeTextOk
                        : (diferenciaCaja < 0 ? styles.cuadreBadgeTextError : styles.cuadreBadgeTextOk),
                    ]}
                  >
                    {diferenciaCaja > 0 && `Faltan ${formatCOP(diferenciaCaja)} COP`}
                    {diferenciaCaja < 0 && `Sobra ${formatCOP(Math.abs(diferenciaCaja))} COP`}
                    {diferenciaCaja === 0 && '✓ Cuadre exacto ($0 COP)'}
                  </Text>
                </View>
              )}
            </View>

            {metodoPagoInicial === 'Mixto' && (
              <View style={{ marginBottom: 6 }}>
                <Text style={styles.fieldLabel}>MONTO EN EFECTIVO (COP) *</Text>
                <TextInput
                  style={styles.fieldInput}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#94A3B8"
                  value={montoEfectivoInput}
                  onChangeText={setMontoEfectivoInput}
                />
                <Text style={styles.sugerenciaMixtoText}>
                  ⚠️ Valores sugeridos. Verifica y ajusta el dinero físico recibido.
                </Text>
              </View>
            )}

            {/* Sub-bloque de Comprobantes Bancarios */}
            <View style={{ marginTop: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={[styles.fieldLabel, { marginBottom: 0 }]}>
                  TRANSFERENCIAS ({comprobantes.length}/3)
                </Text>
                {comprobantes.length < 3 && (
                  <TouchableOpacity
                    onPress={agregarComprobante}
                    style={styles.btnAddVoucher}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.btnAddVoucherText}>+ Agregar comprobante (Máx 3)</Text>
                  </TouchableOpacity>
                )}
              </View>

              {comprobantes.map((comp, idx) => (
                <View key={comp.id} style={styles.voucherCard}>
                  <View style={styles.voucherCardHeader}>
                    <Text style={styles.voucherCardTitle}>Comprobante #{idx + 1}</Text>
                    {comprobantes.length > 1 && (
                      <TouchableOpacity
                        onPress={() => eliminarComprobante(comp.id)}
                        style={styles.voucherDeleteBtn}
                      >
                        <Text style={styles.voucherDeleteBtnText}>✕ Eliminar</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <Text style={[styles.fieldLabel, { fontSize: 9, marginBottom: 2 }]}>ENTIDAD BANCARIA *</Text>
                  <TouchableOpacity
                    style={[
                      styles.bankPickerTrigger,
                      !comp.banco && styles.bankPickerTriggerEmpty,
                      { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8 },
                    ]}
                    onPress={() => {
                      setCompEditandoBancoId(comp.id);
                      setModalBancoVisible(true);
                    }}
                    activeOpacity={0.8}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={{ marginRight: 6, fontSize: 13 }}>🏛️</Text>
                      <Text
                        style={[
                          styles.bankPickerTriggerText,
                          { fontSize: 12 },
                          !comp.banco && styles.bankPickerTriggerTextPlaceholder,
                        ]}
                      >
                        {comp.banco || 'Seleccione un banco...'}
                      </Text>
                    </View>
                    <Text style={{ color: '#94A3B8', fontSize: 10 }}>▼</Text>
                  </TouchableOpacity>

                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <View style={{ flex: 1.2 }}>
                      <Text style={[styles.fieldLabel, { fontSize: 9, marginBottom: 2 }]}>NO. REFERENCIA *</Text>
                      <TextInput
                        style={[styles.fieldInput, { paddingVertical: 6, fontSize: 12 }]}
                        placeholder="Comprobante / Aprobación"
                        placeholderTextColor="#94A3B8"
                        value={comp.referencia}
                        onChangeText={(val) => actualizarComprobante(comp.id, 'referencia', val)}
                        autoCapitalize="characters"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.fieldLabel, { fontSize: 9, marginBottom: 2 }]}>MONTO (COP) *</Text>
                      <TextInput
                        style={[styles.fieldInput, { paddingVertical: 6, fontSize: 12 }]}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor="#94A3B8"
                        value={comp.monto}
                        onChangeText={(val) => actualizarComprobante(comp.id, 'monto', val)}
                        autoFocus={focusedVoucherId === comp.id}
                        selectTextOnFocus
                      />
                    </View>
                  </View>
                </View>
              ))}

              {hayRefsDuplicadasInternas && (
                <View style={[styles.errorBannerBox, { marginTop: 6 }]}>
                  <Text style={styles.errorBannerText}>
                    ⚠️ No puede ingresar números de referencia idénticos en comprobantes distintos.
                  </Text>
                </View>
              )}

              {errorReferenciaDuplicada && (
                <View style={[styles.errorBannerBox, { marginTop: 6 }]}>
                  <Text style={styles.errorBannerText}>
                    ⚠️ {errorReferenciaDuplicada}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* CABECERA CORPORATIVA */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
        >
          <Text style={styles.backBtnText}>← Volver</Text>
        </TouchableOpacity>

        <View style={styles.headerTitleCol}>
          <Text style={styles.headerTitle}>Nueva Venta / Crédito</Text>
          <Text style={styles.headerSub}>Originación de Contrato en Terreno</Text>
        </View>

        <TouchableOpacity
          style={styles.resetHeaderBtn}
          onPress={() => {
            if (itemsVenta.length > 0 || clienteSeleccionado) {
              setModalConfirmarLimpiar(true);
            } else {
              resetearFormularioCompleto();
            }
          }}
          accessibilityRole="button"
          accessibilityLabel="Limpiar formulario"
        >
          <Text style={styles.resetHeaderBtnText}>🗑 Limpiar</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        {/* SECCIÓN 1: MODALIDAD DE VENTA (TABS) */}
        <View style={styles.modalidadTabs}>
          <TouchableOpacity
            style={[styles.tabBtn, modalidad === 'credito' && styles.tabBtnActive]}
            onPress={() => setModalidad('credito')}
          >
            <Text style={[styles.tabText, modalidad === 'credito' && styles.tabTextActive]}>
              💳 Venta a Crédito
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, modalidad === 'contado' && styles.tabBtnActive]}
            onPress={() => setModalidad('contado')}
          >
            <Text style={[styles.tabText, modalidad === 'contado' && styles.tabTextActive]}>
              💵 Venta de Contado
            </Text>
          </TouchableOpacity>
        </View>

        {/* SECCIÓN 2: CLIENTE TITULAR */}
        <View style={styles.cardSection}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>1. CLIENTE TITULAR</Text>
            <TouchableOpacity
              style={styles.changeClientBtn}
              onPress={() => setModalSeleccionarCliente(true)}
            >
              <Text style={styles.changeClientBtnText}>
                {clienteSeleccionado ? 'Cambiar Cliente' : '＋ Seleccionar Cliente'}
              </Text>
            </TouchableOpacity>
          </View>

          {clienteSeleccionado ? (
            <View style={styles.selectedClientBox}>
              <View style={styles.clientAvatarSmall}>
                <Text style={styles.clientAvatarText}>
                  {clienteSeleccionado.nombres?.slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.selectedClientName}>{clienteSeleccionado.nombres}</Text>
                <Text style={styles.selectedClientSub}>
                  C.C. {clienteSeleccionado.cedula} • 📍 {clienteSeleccionado.barrio || 'Centro'}
                </Text>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.noClientPrompt}
              onPress={() => setModalSeleccionarCliente(true)}
            >
              <Text style={styles.noClientPromptText}>
                ⚠️ No has seleccionado un cliente. Toca aquí para buscar o registrar.
              </Text>
            </TouchableOpacity>
          )}

          {/* Radicación Comercial: Ciudad de Venta */}
          <View style={{ marginTop: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <Text style={styles.fieldLabel}>CIUDAD DE VENTA *</Text>
              <Text style={{ fontSize: 9, fontWeight: '800', color: '#047857' }}>CONTROLADO</Text>
            </View>
            <TouchableOpacity
              style={styles.dropdownSelectorBtn}
              onPress={() => setModalSeleccionarCiudad(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.dropdownSelectorText} numberOfLines={1}>
                📍 {ciudadVenta || 'Montería'} • {departamentoVenta || 'Córdoba'}
              </Text>
              <Text style={styles.dropdownChevron}>▾</Text>
            </TouchableOpacity>
          </View>

          {/* Control del Número de Contrato (Switch Automático / Manual) */}
          <View style={styles.contratoBoxContainer}>
            <View style={styles.contratoSwitchHeader}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.contratoSwitchTitle}>Generación Automática de Contrato</Text>
                  <View style={[styles.badgePill, contratoAutomatico ? styles.badgePillAuto : styles.badgePillManual]}>
                    <Text style={[styles.badgePillText, contratoAutomatico ? styles.badgePillTextAuto : styles.badgePillTextManual]}>
                      {contratoAutomatico ? 'AUTO' : 'MANUAL'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.contratoSwitchSub}>
                  {contratoAutomatico
                    ? 'El servidor asignará un consecutivo limpio automáticamente'
                    : 'Digite el número de contrato o folio físico del talonario'}
                </Text>
              </View>
              <Switch
                value={contratoAutomatico}
                onValueChange={(val) => {
                  setContratoAutomatico(val);
                  if (val) setNumeroContrato('');
                }}
                trackColor={{ false: '#CBD5E1', true: '#10B981' }}
                thumbColor="#FFFFFF"
                ios_backgroundColor="#CBD5E1"
              />
            </View>

            <TextInput
              style={[
                styles.fieldInput,
                { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', marginTop: 8 },
                contratoAutomatico ? styles.fieldInputDisabled : styles.fieldInputActive
              ]}
              editable={!contratoAutomatico}
              placeholder={
                contratoAutomatico
                  ? "⚡ Asignado automáticamente por el servidor (CTR-XXXX)"
                  : "Ej. 0451 o CTR-2026 (Folio talonario físico)"
              }
              placeholderTextColor={contratoAutomatico ? "#94A3B8" : "#64748B"}
              value={contratoAutomatico ? "" : numeroContrato}
              onChangeText={setNumeroContrato}
              autoCapitalize="characters"
            />

            <Text style={[styles.fieldHelpText, { marginTop: 4 }]}>
              {contratoAutomatico
                ? '✓ Se radicará con un consecutivo numérico único asignado por el sistema.'
                : (numeroContrato.trim()
                    ? `✓ Se radicará con el folio físico manual: ${numeroContrato.trim()}`
                    : '✍️ Digite el número o folio físico del talonario entregado al cliente.')}
            </Text>
          </View>
        </View>

        {/* SECCIÓN 3: ARTÍCULOS EN LA VENTA */}
        <View style={styles.cardSection}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>2. ARTÍCULOS DE LA COMPRA</Text>
            <TouchableOpacity
              style={styles.addProductBtn}
              onPress={() => setModalAgregarProducto(true)}
            >
              <Text style={styles.addProductBtnText}>＋ Agregar Artículo</Text>
            </TouchableOpacity>
          </View>

          {itemsVenta.length === 0 ? (
            <TouchableOpacity
              style={styles.emptyItemsPrompt}
              onPress={() => setModalAgregarProducto(true)}
            >
              <Text style={styles.emptyItemsText}>📦 La lista está vacía. Toca para añadir productos.</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.itemsList}>
              {itemsVenta.map((item, index) => {
                const subtotal = item.cantidad * item.valor_unitario;
                const prodEnCatalogo = productos.find((p) => p.id === item.producto_id);
                const manejaStock = prodEnCatalogo ? prodEnCatalogo.maneja_stock !== false : item.maneja_stock !== false;
                const stockDisp = prodEnCatalogo ? (prodEnCatalogo.stock ?? 0) : (item.stock ?? 0);
                const topeAlcanzado = manejaStock && item.cantidad >= stockDisp;

                return (
                  <View key={item.producto_id || index} style={styles.itemRowCard}>
                    <View style={styles.itemHeader}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={styles.itemSku}>{item.sku}</Text>
                          {!manejaStock ? (
                            <View style={styles.itemEncargoTag}>
                              <Text style={styles.itemEncargoText}>🎨 Por Encargo</Text>
                            </View>
                          ) : (
                            <View style={[
                              styles.itemStockTag,
                              stockDisp <= 5 ? styles.itemStockTagWarning : styles.itemStockTagSuccess
                            ]}>
                              <Text style={[
                                styles.itemStockText,
                                stockDisp <= 5 ? styles.itemStockTextWarning : styles.itemStockTextSuccess
                              ]}>
                                📦 Stock disp: {stockDisp} unid.
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.itemName}>{item.nombre}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.removeItemBtn}
                        onPress={() => modificarCantidad(index, -item.cantidad)}
                      >
                        <Text style={styles.removeItemBtnText}>✕</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Fila de Controles: Cantidad y Precio Variable */}
                    <View style={styles.itemControlsRow}>
                      <View style={styles.qtyControlGroup}>
                        <TouchableOpacity
                          style={styles.qtyBtn}
                          onPress={() => modificarCantidad(index, -1)}
                        >
                          <Text style={styles.qtyBtnText}>-</Text>
                        </TouchableOpacity>
                        <Text style={styles.qtyValue}>{item.cantidad}</Text>
                        <TouchableOpacity
                          style={[styles.qtyBtn, topeAlcanzado && styles.qtyBtnDisabled]}
                          onPress={() => modificarCantidad(index, 1)}
                        >
                          <Text style={[styles.qtyBtnText, topeAlcanzado && styles.qtyBtnTextDisabled]}>+</Text>
                        </TouchableOpacity>
                      </View>

                      {item.es_precio_variable ? (
                        <View style={styles.variablePriceBox}>
                          <Text style={styles.varPriceLabel}>PRECIO PACTADO ($):</Text>
                          <TextInput
                            style={styles.varPriceInput}
                            keyboardType="numeric"
                            value={String(item.valor_unitario)}
                            onChangeText={(val) => modificarPrecioUnitario(index, val)}
                          />
                        </View>
                      ) : (
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.unitPriceLabel}>PRECIO UNITARIO</Text>
                          <Text style={styles.unitPriceVal}>{formatCOP(item.valor_unitario)}</Text>
                        </View>
                      )}
                    </View>

                    {topeAlcanzado && (
                      <View style={styles.stockTopeWarningRow}>
                        <Text style={styles.stockTopeWarningText}>
                          ⚠️ Has alcanzado el límite de existencias disponibles en almacén ({stockDisp} unid.)
                        </Text>
                      </View>
                    )}

                    <View style={styles.itemSubtotalRow}>
                      <Text style={styles.subtotalLabel}>Subtotal línea:</Text>
                      <Text style={styles.subtotalValue}>{formatCOP(subtotal)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {itemsVenta.length > 0 && (
            <View style={styles.orderTotalBanner}>
              <Text style={styles.orderTotalLabel}>VALOR TOTAL ARTÍCULOS:</Text>
              <Text style={styles.orderTotalValue}>{formatCOP(totalArticulos)}</Text>
            </View>
          )}
        </View>

        {/* SECCIÓN 4: PLAN DE FINANCIACIÓN Y CONDICIONES DE PAGO */}
        <View style={styles.cardSection}>
          <Text style={styles.sectionTitle}>3. CONDICIONES DE PAGO</Text>

          {modalidad === 'contado' ? (
            <View style={{ gap: 10, marginTop: 8 }}>
              <View style={styles.contadoNoticeBox}>
                <Text style={styles.contadoNoticeTitle}>✓ VENTA LIQUIDADA DE CONTADO</Text>
                <Text style={styles.contadoNoticeText}>
                  Se registra el pago total de {formatCOP(totalArticulos)} al momento de la entrega. Sin financiación ni cuotas pendientes.
                </Text>
              </View>

              {renderSelectorMetodoPago()}
            </View>
          ) : (
            <View style={{ gap: 12, marginTop: 8 }}>
              {/* Modalidad Unificada vs Modalidad Dinámica */}
              <View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={styles.fieldLabel}>FRECUENCIA DE COBRO *</Text>
                  <Text style={{
                    fontSize: 9,
                    fontWeight: '800',
                    color: modalidadProyeccion === 'dinamica' ? '#4F46E5' : '#047857',
                  }}>
                    {modalidadProyeccion === 'dinamica' ? 'MODALIDAD DINÁMICA' : 'MODALIDAD UNIFICADA'}
                  </Text>
                </View>
                {modalidadProyeccion === 'dinamica' ? (
                  <View style={[styles.modalidadUnificadaBox, { borderColor: '#818CF8', backgroundColor: '#EEF2FF' }]}>
                    <View style={[styles.modalidadUnificadaIconBox, { backgroundColor: '#4F46E5' }]}>
                      <Text style={[styles.modalidadUnificadaIconText, { color: '#FFFFFF', fontSize: 13 }]}>📅</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modalidadUnificadaTitle, { color: '#1E1B4B' }]}>Crédito Dinámico (En Ruta)</Text>
                      <Text style={[styles.modalidadUnificadaSub, { color: '#4338CA' }]}>
                        Fechas y frecuencias de cobro acordadas y agendadas directamente en terreno
                      </Text>
                    </View>
                    <View style={[styles.modalidadUnificadaTag, { backgroundColor: '#C7D2FE' }]}>
                      <Text style={[styles.modalidadUnificadaTagText, { color: '#312E81' }]}>DINÁMICA</Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.modalidadUnificadaBox}>
                    <View style={styles.modalidadUnificadaIconBox}>
                      <Text style={styles.modalidadUnificadaIconText}>30/31</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modalidadUnificadaTitle}>Crédito Mensual (Fin de Mes)</Text>
                      <Text style={styles.modalidadUnificadaSub}>
                        Vencimiento automático fijado al último día de cada mes
                      </Text>
                    </View>
                    <View style={styles.modalidadUnificadaTag}>
                      <Text style={styles.modalidadUnificadaTagText}>EXCLUSIVO</Text>
                    </View>
                  </View>
                )}
              </View>

              {/* Cuota Inicial */}
              <View>
                <Text style={styles.fieldLabel}>CUOTA INICIAL ($ COP)</Text>
                <TextInput
                  style={styles.fieldInput}
                  keyboardType="numeric"
                  value={cuotaInicialInput}
                  onChangeText={setCuotaInicialInput}
                  placeholder="0"
                />
                <Text style={styles.fieldHelpText}>
                  {cuotaInicial > 0 ? `Anticipo: ${formatCOP(cuotaInicial)}` : 'Sin anticipo (100% financiado)'}
                </Text>
              </View>

              {/* Personalización de Fecha de Primer Cobro (Modalidad Dinámica vs Fija) */}
              {modalidadProyeccion === 'dinamica' ? (
                <View style={styles.fechaManualContainer}>
                  <View style={styles.fechaManualInputBox}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={styles.fieldLabel}>FECHA DEL PRIMER PAGO *</Text>
                      <View style={[styles.badgePill, { backgroundColor: '#EEF2FF', borderColor: '#818CF8' }]}>
                        <Text style={[styles.badgePillText, { color: '#4F46E5', fontWeight: '800' }]}>DINÁMICA</Text>
                      </View>
                    </View>
                    {Platform.OS === 'web' ? (
                      React.createElement('input', {
                        type: 'date',
                        value: fechaPrimeraCuota,
                        onChange: (e) => setFechaPrimeraCuota(e.target.value),
                        style: {
                          height: 44,
                          borderRadius: 10,
                          border: '1.5px solid #6366F1',
                          padding: '0 12px',
                          fontSize: 14,
                          fontWeight: '600',
                          fontFamily: 'inherit',
                          backgroundColor: '#EEF2FF',
                          color: '#1E1B4B',
                          outline: 'none',
                          width: '100%',
                          boxSizing: 'border-box',
                          marginTop: 6,
                          cursor: 'pointer',
                        },
                      })
                    ) : (
                      <TextInput
                        style={[styles.fieldInput, styles.fieldInputManualFecha]}
                        value={fechaPrimeraCuota}
                        onChangeText={setFechaPrimeraCuota}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor="#94A3B8"
                      />
                    )}
                    <Text style={[styles.fieldHelpText, { color: '#4F46E5', fontWeight: '600', marginTop: 4 }]}>
                      Modalidad Dinámica: Las cuotas subsiguientes se agendarán en ruta.
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.fechaManualContainer}>
                  <View style={styles.fechaManualSwitchRow}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.fechaManualSwitchTitle}>Personalizar fecha de primer pago</Text>
                        <View style={[styles.badgePill, fechasManuales ? styles.badgePillManual : styles.badgePillAuto]}>
                          <Text style={[styles.badgePillText, fechasManuales ? styles.badgePillTextManual : styles.badgePillTextAuto]}>
                            {fechasManuales ? 'MANUAL' : 'AUTO'}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.fechaManualSwitchSub}>
                        {fechasManuales
                          ? 'El sistema proyectará las demás cuotas a partir de este día.'
                          : `Vencimiento fijado a fin de mes (${getFechaPrimerCobroSugerida()})`}
                      </Text>
                    </View>
                    <Switch
                      value={fechasManuales}
                      onValueChange={(val) => {
                        setFechasManuales(val);
                        if (val && !fechaPrimeraCuotaManual) {
                          setFechaPrimeraCuotaManual(getFechaPrimerCobroSugerida(new Date(), true));
                        }
                      }}
                      trackColor={{ false: '#CBD5E1', true: '#4F46E5' }}
                      thumbColor="#FFFFFF"
                      ios_backgroundColor="#CBD5E1"
                    />
                  </View>

                  {/* Renderizado Condicional: Si fechasManuales es true, muestra el selector de fecha */}
                  {fechasManuales && (
                    <View style={styles.fechaManualInputBox}>
                      <Text style={styles.fieldLabel}>FECHA DE PRIMER PAGO SELECCIONADA *</Text>
                      {Platform.OS === 'web' ? (
                        React.createElement('input', {
                          type: 'date',
                          value: fechaPrimeraCuotaManual,
                          onChange: (e) => setFechaPrimeraCuotaManual(e.target.value),
                          style: {
                            height: 44,
                            borderRadius: 10,
                            border: '1.5px solid #6366F1',
                            padding: '0 12px',
                            fontSize: 14,
                            fontWeight: '600',
                            fontFamily: 'inherit',
                            backgroundColor: '#EEF2FF',
                            color: '#1E1B4B',
                            outline: 'none',
                            width: '100%',
                            boxSizing: 'border-box',
                            marginTop: 6,
                            cursor: 'pointer',
                          },
                        })
                      ) : (
                        <TextInput
                          style={[styles.fieldInput, styles.fieldInputManualFecha]}
                          value={fechaPrimeraCuotaManual}
                          onChangeText={setFechaPrimeraCuotaManual}
                          placeholder="YYYY-MM-DD"
                        />
                      )}
                      <Text style={styles.fieldHelpText}>
                        El sistema proyectará las demás cuotas a partir de este día.
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {renderSelectorMetodoPago()}

              {/* Plazo / Número de Cuotas (Opciones Dinámicas) */}
              <View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={styles.fieldLabel}>PLAZO DE CUOTAS PERMITIDO *</Text>
                  <Text style={{ fontSize: 9, fontWeight: '800', color: '#047857' }}>
                    {plazosPermitidos.length} {plazosPermitidos.length === 1 ? 'OPCIÓN AUTORIZADA' : 'OPCIONES AUTORIZADAS'}
                  </Text>
                </View>
                <View style={styles.cuotasGrid}>
                  {plazosPermitidos.map((plazo) => {
                    const isSelected = numeroCuotas === plazo;
                    const cuotaEst = montoFinanciado > 0 ? Math.round(montoFinanciado / plazo) : 0;
                    const badge = plazo === 4 ? 'Inicial + 3' : null;
                    const label = `${plazo} cuotas`;
                    const sub = plazo === 4 ? 'Inicial + 3 periodos' : `${plazo} periodos`;

                    return (
                      <TouchableOpacity
                        key={plazo}
                        style={[styles.cuotaCard, isSelected && styles.cuotaCardActive]}
                        onPress={() => setNumeroCuotas(plazo)}
                        accessibilityRole="button"
                      >
                        {badge && (
                          <View style={[styles.cuotaBadge, isSelected ? styles.cuotaBadgeActive : null]}>
                            <Text style={[styles.cuotaBadgeText, isSelected ? styles.cuotaBadgeTextActive : null]}>
                              {badge}
                            </Text>
                          </View>
                        )}
                        <Text style={[styles.cuotaCardTitle, isSelected && styles.cuotaCardTitleActive]}>
                          {label}
                        </Text>
                        <Text style={[styles.cuotaCardSub, isSelected && styles.cuotaCardSubActive]}>
                          {sub}
                        </Text>
                        {montoFinanciado > 0 && (
                          <Text style={[styles.cuotaCardEst, isSelected && styles.cuotaCardEstActive]}>
                            Cuota: {formatCOP(cuotaEst)}
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* PREVISUALIZACIÓN DEL PLAN DE AMORTIZACIÓN PROYECTADO (DESGLOSE FINANCIERO EN TIEMPO REAL) */}
              {montoFinanciado > 0 && numeroCuotas > 0 && (
                <View style={styles.financialBreakdownContainer}>
                  {/* Encabezado del Desglose */}
                  <View style={styles.financialHeaderRow}>
                    <Text style={styles.financialHeaderTitle}>
                      ⏱️ Desglose Financiero en Tiempo Real ({numeroCuotas} cuotas {tipoPago}s)
                    </Text>
                    <Text style={styles.financialHeaderSub}>
                      Total Artículos: {formatCOP(totalArticulos)} {cuotaInicial > 0 ? `| Inicial: -${formatCOP(cuotaInicial)}` : ''}
                    </Text>
                  </View>

                  {/* Banner Plan 4 cuotas si aplica */}
                  {numeroCuotas === 4 && (
                    <View style={styles.cuotaCuatroBanner}>
                      <Text style={styles.cuotaCuatroBannerText}>
                        ✓ Plan 4 Cuotas: Configurado internamente como Cuota Inicial + 3 meses / periodos correspondientes.
                      </Text>
                    </View>
                  )}

                  {/* Cuadrícula de 4 Tarjetas de Resumen Financiero */}
                  <View style={styles.financialSummaryGrid}>
                    <View style={styles.financialSummaryCard}>
                      <Text style={styles.financialSummaryLabel}>SALDO FINANCIADO</Text>
                      <Text style={styles.financialSummaryVal}>{formatCOP(montoFinanciado)}</Text>
                      <Text style={styles.financialSummaryFoot}>Neto a diferir</Text>
                    </View>

                    <View style={styles.financialSummaryCard}>
                      <Text style={styles.financialSummaryLabel}>PLAZO PACTADO</Text>
                      <Text style={styles.financialSummaryVal}>{numeroCuotas} Cuotas</Text>
                      <Text style={styles.financialSummaryFoot}>
                        {modalidadProyeccion === 'dinamica' ? 'Dinámica (En Ruta)' : 'Mensual (Fin de Mes)'}
                      </Text>
                    </View>

                    <View style={[styles.financialSummaryCard, styles.financialSummaryCardHighlight]}>
                      <Text style={styles.financialSummaryLabelHighlight}>VALOR CUOTA PERIÓDICA</Text>
                      <Text style={styles.financialSummaryValHighlight}>{formatCOP(valorCuota)}</Text>
                      <Text style={styles.financialSummaryFootHighlight}>Cobro periódico</Text>
                    </View>

                    <View style={styles.financialSummaryCard}>
                      <Text style={styles.financialSummaryLabel}>1ª CUOTA EN RUTA</Text>
                      <Text style={styles.financialSummaryVal}>{formatCOP(valorCuota)}</Text>
                      <Text style={styles.financialSummaryFoot}>{fechaPrimeraCuota}</Text>
                    </View>
                  </View>

                  {/* TABLA / CRONOGRAMA DE VENCIMIENTO DE CUOTAS (Oculto en Modalidad Dinámica) */}
                  {modalidadProyeccion !== 'dinamica' ? (
                    <View style={styles.cronogramaSection}>
                      <View style={styles.cronogramaHeaderRow}>
                        <Text style={styles.cronogramaTitle}>
                          CRONOGRAMA DE VENCIMIENTO DE CUOTAS (MENSUAL)
                        </Text>
                        <Text style={styles.cronogramaBadge}>
                          {numeroCuotas} cuotas de {formatCOP(valorCuota)}
                        </Text>
                      </View>

                      <View style={styles.cronogramaGrid}>
                        {cronogramaProyectado.map((cItem) => (
                          <View key={cItem.numero} style={styles.cronogramaCard}>
                            <View style={styles.cronogramaCardHeader}>
                              <Text style={styles.cronogramaCardNumber}>Cuota {cItem.numero}</Text>
                              <Text style={styles.cronogramaCardAmount}>{formatCOP(cItem.valor)}</Text>
                            </View>
                            <Text style={styles.cronogramaCardDate}>📅 {cItem.fecha}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : (
                    <View style={[styles.cronogramaSection, { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', padding: 14, borderRadius: 12 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <Text style={{ fontSize: 16 }}>⚡</Text>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#1E293B' }}>
                          CRONOGRAMA DINÁMICO EN RUTA
                        </Text>
                      </View>
                      <Text style={{ fontSize: 12, color: '#475569', lineHeight: 18 }}>
                        Modalidad Dinámica: Las cuotas subsiguientes se agendarán en ruta. La primera cuota vence el <Text style={{ fontWeight: '700', color: '#4F46E5' }}>{fechaPrimeraCuota || 'día indicado'}</Text>.
                      </Text>
                    </View>
                  )}

                  {/* NOTA OPERATIVA: ASIGNACIÓN POSTERIOR DE RUTA Y COBRADOR */}
                  <View style={styles.operationalNoticeBox}>
                    <Text style={styles.operationalNoticeIcon}>💡</Text>
                    <Text style={styles.operationalNoticeText}>
                      <Text style={styles.operationalNoticeBold}>Crédito sin asignación prematura de ruta: </Text>
                      Este crédito nacerá limpio de cobrador y ruta. La asignación operativa del cobrador se realizará de manera exclusiva desde el módulo de Cartera / Supervisión una vez que el crédito esté aprobado.
                    </Text>
                  </View>

                </View>
              )}
            </View>
          )}
        </View>

        {/* ========================================================================= */}
        {/* SECCIÓN 4: CODEUDOR Y REFERENCIAS (SÓLO VENTA A CRÉDITO)                  */}
        {/* ========================================================================= */}
        {/* ========================================================================= */}
        {/* SECCIÓN 4: CODEUDOR Y REFERENCIAS (SÓLO VENTA A CRÉDITO)                  */}
        {/* ========================================================================= */}
        {modalidad === 'credito' && (() => {
          const isGarantiaEditable = !garantiasHeredadas || permitirModificarGarantias;

          return (
            <View style={styles.cardSection}>
              <View style={styles.sectionHeaderRow}>
                <View>
                  <Text style={styles.sectionTitle}>4. CODEUDOR Y REFERENCIA</Text>
                  <Text style={styles.sectionSubTitle}>Datos de respaldo y políticas de riesgo</Text>
                </View>
                <View style={styles.garantiaBadge}>
                  <Text style={styles.garantiaBadgeText}>REQUERIDO</Text>
                </View>
              </View>

              {/* BANNER DE HERENCIA INTELIGENTE DE GARANTÍAS */}
              {garantiasHeredadas && (
                <View style={styles.garantiasHeredadasBox}>
                  <View style={styles.garantiasHeredadasInfo}>
                    <Text style={styles.garantiasHeredadasIcon}>🛡️</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.garantiasHeredadasTitle}>
                        Garantías Heredadas del Historial
                      </Text>
                      <Text style={styles.garantiasHeredadasText}>
                        {permitirModificarGarantias
                          ? 'Edición autorizada para actualizar codeudor o referencia en este contrato.'
                          : 'Datos precargados del cliente. Campos protegidos contra edición accidental.'}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.toggleModificarBtn,
                      permitirModificarGarantias && styles.toggleModificarBtnActive,
                    ]}
                    onPress={() => setPermitirModificarGarantias(!permitirModificarGarantias)}
                  >
                    <Text
                      style={[
                        styles.toggleModificarBtnText,
                        permitirModificarGarantias && styles.toggleModificarBtnTextActive,
                      ]}
                    >
                      {permitirModificarGarantias
                        ? '🔒 Bloquear campos'
                        : '✏️ Modificar datos de garantía'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* SUB-BLOQUE A: CODEUDOR SOLIDARIO */}
              <View style={styles.subBlockBox}>
                <View style={styles.subBlockHeader}>
                  <View style={styles.subBlockIconBox}>
                    <Text style={styles.subBlockIconText}>👤</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.subBlockTitle}>Codeudor Solidario</Text>
                    <Text style={styles.subBlockSubtitle}>Persona que respalda legalmente la obligación</Text>
                  </View>
                </View>

                {/* Nombre del Codeudor */}
                <View style={styles.inputGroup}>
                  <Text style={styles.fieldLabel}>NOMBRE COMPLETO DEL CODEUDOR *</Text>
                  <TextInput
                    style={[styles.fieldInput, !isGarantiaEditable && styles.fieldInputLocked]}
                    placeholder="Ej. Carlos Alberto Gómez"
                    placeholderTextColor="#94A3B8"
                    value={codeudorNombre}
                    onChangeText={setCodeudorNombre}
                    editable={isGarantiaEditable}
                  />
                </View>

                {/* Cédula y Teléfono en dos columnas */}
                <View style={styles.rowTwoCols}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>CÉDULA DE CIUDADANÍA</Text>
                    <TextInput
                      style={[styles.fieldInput, !isGarantiaEditable && styles.fieldInputLocked]}
                      placeholder="Ej. 1067890123"
                      placeholderTextColor="#94A3B8"
                      keyboardType="numeric"
                      value={codeudorCedula}
                      onChangeText={setCodeudorCedula}
                      editable={isGarantiaEditable}
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>TELÉFONO DE CONTACTO *</Text>
                    <TextInput
                      style={[styles.fieldInput, !isGarantiaEditable && styles.fieldInputLocked]}
                      placeholder="Ej. 3109876543"
                      placeholderTextColor="#94A3B8"
                      keyboardType="phone-pad"
                      value={codeudorTelefono}
                      onChangeText={setCodeudorTelefono}
                      editable={isGarantiaEditable}
                    />
                  </View>
                </View>

                {/* Dirección Domiciliaria */}
                <View style={styles.inputGroup}>
                  <Text style={styles.fieldLabel}>DIRECCIÓN DOMICILIARIA</Text>
                  <TextInput
                    style={[styles.fieldInput, !isGarantiaEditable && styles.fieldInputLocked]}
                    placeholder="Ej. Calle 45 # 12-34 Barrio La Granja"
                    placeholderTextColor="#94A3B8"
                    value={codeudorDireccion}
                    onChangeText={setCodeudorDireccion}
                    editable={isGarantiaEditable}
                  />
                </View>
              </View>

              {/* SUB-BLOQUE B: REFERENCIA FAMILIAR */}
              <View style={[styles.subBlockBox, { marginTop: 14 }]}>
                <View style={styles.subBlockHeader}>
                  <View style={styles.subBlockIconBox}>
                    <Text style={styles.subBlockIconText}>👥</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.subBlockTitle}>Referencia Familiar o Personal</Text>
                    <Text style={styles.subBlockSubtitle}>Contacto directo de verificación y apoyo</Text>
                  </View>
                </View>

                {/* Nombre de la Referencia */}
                <View style={styles.inputGroup}>
                  <Text style={styles.fieldLabel}>NOMBRE COMPLETO DE LA REFERENCIA</Text>
                  <TextInput
                    style={[styles.fieldInput, !isGarantiaEditable && styles.fieldInputLocked]}
                    placeholder="Ej. María José Pérez"
                    placeholderTextColor="#94A3B8"
                    value={referenciaNombre}
                    onChangeText={setReferenciaNombre}
                    editable={isGarantiaEditable}
                  />
                </View>

                {/* Teléfono y Parentesco en dos columnas */}
                <View style={styles.rowTwoCols}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>TELÉFONO DE CONTACTO</Text>
                    <TextInput
                      style={[styles.fieldInput, !isGarantiaEditable && styles.fieldInputLocked]}
                      placeholder="Ej. 3112345678"
                      placeholderTextColor="#94A3B8"
                      keyboardType="phone-pad"
                      value={referenciaTelefono}
                      onChangeText={setReferenciaTelefono}
                      editable={isGarantiaEditable}
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>PARENTESCO / RELACIÓN</Text>
                    <TextInput
                      style={[styles.fieldInput, !isGarantiaEditable && styles.fieldInputLocked]}
                      placeholder="Ej. Hermano(a)"
                      placeholderTextColor="#94A3B8"
                      value={referenciaParentesco}
                      onChangeText={setReferenciaParentesco}
                      editable={isGarantiaEditable}
                    />
                  </View>
                </View>

                {/* Chips rápidos de parentesco para agilizar en terreno */}
                <View style={styles.parentescoChipsRow}>
                  {['Hermano(a)', 'Madre / Padre', 'Hijo(a)', 'Cónyuge', 'Vecino(a)'].map((p) => (
                    <TouchableOpacity
                      key={p}
                      style={[
                        styles.parentescoChip,
                        referenciaParentesco === p && styles.parentescoChipActive,
                        !isGarantiaEditable && { opacity: 0.5 },
                      ]}
                      onPress={() => setReferenciaParentesco(p)}
                      disabled={!isGarantiaEditable}
                    >
                      <Text
                        style={[
                          styles.parentescoChipText,
                          referenciaParentesco === p && styles.parentescoChipTextActive,
                        ]}
                      >
                        {p}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          );
        })()}

        {/* ========================================================================= */}
        {/* SECCIÓN 5: FIRMAS DIGITALES DE CONFORMIDAD (TÁCTIL / STYLUS)             */}
        {/* ========================================================================= */}
        <View style={styles.cardSection}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>5. FIRMAS DE CONFORMIDAD Y ACUERDO</Text>
            <View style={styles.sectionBadgeRequired}>
              <Text style={styles.sectionBadgeRequiredText}>2 Requeridas • 1 Opcional</Text>
            </View>
          </View>
          <Text style={styles.signaturesSectionNotice}>
            Capture las firmas directamente en pantalla con el dedo o lápiz óptico. El contrato se sellará con estas firmas en el comprobante oficial.
          </Text>

          {/* 1. Firma del Cliente Titular (Estrictamente Obligatoria) */}
          <SignatureCanvas
            label="1. Firma del Cliente Titular"
            subtitle="Firma del deudor principal responsable"
            obligatorio={true}
            signerName={clienteSeleccionado ? clienteSeleccionado.nombres : 'Seleccione cliente titular'}
            signerDoc={clienteSeleccionado ? clienteSeleccionado.cedula : ''}
            value={firmaTitular}
            onChange={setFirmaTitular}
            height={130}
          />

          {/* 2. Firma del Vendedor / Asesor Comercial (Estrictamente Obligatoria) */}
          <SignatureCanvas
            label="2. Firma del Asesor Comercial"
            subtitle="Firma del vendedor responsable de la originación"
            obligatorio={true}
            signerName={user?.nombre || 'Asesor Comercial'}
            signerDoc={user?.cedula || ''}
            value={firmaVendedor}
            onChange={setFirmaVendedor}
            height={130}
          />

          {/* 3. Firma del Codeudor Solidario (Totalmente Opcional para agilidad en campo) */}
          {modalidad === 'credito' && (
            <SignatureCanvas
              label="3. Firma del Codeudor Solidario"
              subtitle="Opcional en terreno para agilizar el cierre sin bloquear la venta"
              obligatorio={false}
              signerName={codeudorNombre ? codeudorNombre.trim() : 'Codeudor Solidario (Si aplica)'}
              signerDoc={codeudorCedula ? codeudorCedula.trim() : ''}
              value={firmaCodeudor}
              onChange={setFirmaCodeudor}
              height={130}
            />
          )}
        </View>

        {/* BOTÓN DE TRANSMISIÓN FINAL */}
        <TouchableOpacity
          style={[
            styles.transmitBtn,
            (isSubmitting ||
              itemsVenta.length === 0 ||
              (montoObjetivo > 0 && metodoPagoInicial !== 'Efectivo' && (
                diferenciaCaja !== 0 ||
                !comprobantesValidos ||
                hayRefsDuplicadasInternas
              ))
            ) && styles.transmitBtnDisabled,
          ]}
          onPress={handleTransmitirVenta}
          disabled={
            isSubmitting ||
            itemsVenta.length === 0 ||
            (montoObjetivo > 0 && metodoPagoInicial !== 'Efectivo' && (
              diferenciaCaja !== 0 ||
              !comprobantesValidos ||
              hayRefsDuplicadasInternas
            ))
          }
          accessibilityRole="button"
        >
          {isSubmitting ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color="#FFFFFF" />
              <Text style={styles.transmitBtnText}>Enviando Solicitud a Supervisor...</Text>
            </View>
          ) : (
            <Text style={styles.transmitBtnText}>
              ✓ {modalidad === 'contado' ? 'Confirmar Venta de Contado' : 'Enviar Solicitud a Supervisor'}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* ========================================================================= */}
      {/* MODAL IN-FRAME: SELECTOR DE CLIENTE */}
      {/* ========================================================================= */}
      <InFrameModal
        visible={modalSeleccionarCliente}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setModalSeleccionarCliente(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Seleccionar Cliente</Text>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setModalSeleccionarCliente(false)}
              >
                <Text style={styles.modalCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.searchBar}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Buscar cliente..."
                placeholderTextColor="#94A3B8"
                value={filtroCliente}
                onChangeText={setFiltroCliente}
              />
            </View>

            <ScrollView style={{ maxHeight: 350, marginTop: 10 }}>
              {clientesFiltrados.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.clientPickerItem}
                  onPress={() => {
                    setClienteSeleccionado(c);
                    if (c.ciudad) {
                      setCiudadVenta(c.ciudad);
                      setDepartamentoVenta(c.departamento || inferirDepartamento(c.ciudad));
                    }
                    setModalSeleccionarCliente(false);
                    cargarGarantiasCliente(c);
                  }}
                >
                  <View style={styles.clientPickerAvatar}>
                    <Text style={styles.clientPickerAvatarText}>
                      {c.nombres?.slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.clientPickerName}>{c.nombres}</Text>
                    <Text style={styles.clientPickerSub}>
                      C.C. {c.cedula} • {c.barrio || 'Sin barrio'}
                    </Text>
                  </View>
                  <Text style={styles.clientPickerSelect}>Elegir →</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={styles.createNewClientShortcut}
              onPress={() => {
                setModalSeleccionarCliente(false);
                navigation.navigate('Clientes');
              }}
            >
              <Text style={styles.createNewClientShortcutText}>
                + Crear Nuevo Cliente en el Directorio
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </InFrameModal>

      {/* ========================================================================= */}
      {/* MODAL IN-FRAME: AGREGAR PRODUCTO */}
      {/* ========================================================================= */}
      <InFrameModal
        visible={modalAgregarProducto}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setModalAgregarProducto(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalContent, { height: '80%', maxHeight: '85%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Catálogo de Artículos</Text>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setModalAgregarProducto(false)}
              >
                <Text style={styles.modalCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.searchBar}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Buscar artículo o SKU..."
                placeholderTextColor="#94A3B8"
                value={filtroProducto}
                onChangeText={setFiltroProducto}
              />
              {filtroProducto ? (
                <TouchableOpacity onPress={() => setFiltroProducto('')}>
                  <Text style={{ fontSize: 12, color: '#94A3B8', paddingHorizontal: 4 }}>✕</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <FlatList
              data={productosFiltrados}
              keyExtractor={(item) => String(item.id || item.sku)}
              renderItem={({ item }) => (
                <ProductCard
                  item={item}
                  actionLabel="+ Agregar"
                  onActionPress={() => agregarProductoAOrden(item)}
                />
              )}
              numColumns={2}
              columnWrapperStyle={{ justifyContent: 'space-between', paddingHorizontal: 2 }}
              contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                  <Text style={{ fontSize: 32, marginBottom: 8 }}>📦</Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#0F172A' }}>
                    Sin artículos encontrados
                  </Text>
                  <Text style={{ fontSize: 12, color: '#64748B', textAlign: 'center', marginTop: 4 }}>
                    No hay productos que coincidan con los términos de búsqueda.
                  </Text>
                </View>
              }
            />
          </View>
        </View>
      </InFrameModal>

      {/* ========================================================================= */}
      {/* MODAL IN-FRAME: COMPROBANTE DE VENTA EXITOSA */}
      {/* ========================================================================= */}
      <InFrameModal
        visible={!!ventaExitosa}
        transparent={true}
        animationType="fade"
        onRequestClose={async () => {
          await resetearFormularioCompleto();
          navigation.navigate(userRole?.toLowerCase() === 'supervisor' || userRole?.toLowerCase() === 'master' ? 'SupervisorDashboard' : 'VendedorDashboard');
        }}
      >
        <View style={styles.modalBackdropCenter}>
          <View style={styles.successReceiptCard}>
            <View style={[styles.successCheckBadge, ventaExitosa?.offline && { backgroundColor: '#FEF3C7' }]}>
              <Text style={[styles.successCheckIcon, ventaExitosa?.offline && { color: '#B45309' }]}>
                {ventaExitosa?.offline ? '⏱' : '✓'}
              </Text>
            </View>
            <Text style={[styles.successBadgeText, ventaExitosa?.offline && { color: '#B45309' }]}>
              {ventaExitosa?.offline ? 'GUARDADA EN COLA LOCAL (OFFLINE)' : 'OPERACIÓN TRANSMITIDA CON ÉXITO'}
            </Text>
            <Text style={styles.successTitle}>
              {ventaExitosa?.offline ? 'Venta Registrada en Memoria' : 'Contrato de Venta Originado'}
            </Text>
            <Text style={styles.successSubtitle}>
              {ventaExitosa?.offline
                ? 'Se sincronizará automáticamente al detectar conexión a internet'
                : 'Remundial Core - Servidor Nube'}
            </Text>

            {ventaExitosa && (
              <View style={styles.receiptBody}>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptKey}>No. Contrato / Sistema:</Text>
                  <Text style={styles.receiptValMono}>
                    {ventaExitosa.id_contrato_codigo || String(ventaExitosa.id_contrato).slice(0, 16).toUpperCase()}
                  </Text>
                </View>

                {ventaExitosa.numero_contrato && (
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptKey}>Folio Físico / Talonario:</Text>
                    <Text style={[styles.receiptValMono, { color: '#047857', fontWeight: 'bold' }]}>
                      {ventaExitosa.numero_contrato}
                    </Text>
                  </View>
                )}

                {ventaExitosa.ciudad_venta && (
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptKey}>Ubicación Comercial:</Text>
                    <Text style={[styles.receiptVal, { fontWeight: '700' }]}>
                      {ventaExitosa.ciudad_venta}
                      {ventaExitosa.departamento_venta ? ` (${ventaExitosa.departamento_venta})` : ''}
                    </Text>
                  </View>
                )}

                {ventaExitosa.offline && (
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptKey}>Estado Sync:</Text>
                    <Text style={[styles.receiptVal, { color: '#B45309', fontWeight: 'bold' }]}>
                      Pendiente en Dispositivo
                    </Text>
                  </View>
                )}

                <View style={styles.receiptRow}>
                  <Text style={styles.receiptKey}>Cliente:</Text>
                  <Text style={styles.receiptVal}>{ventaExitosa.cliente}</Text>
                </View>

                <View style={styles.receiptRow}>
                  <Text style={styles.receiptKey}>Modalidad:</Text>
                  <Text style={styles.receiptVal}>{ventaExitosa.modalidad}</Text>
                </View>

                <View style={styles.receiptHighlight}>
                  <Text style={styles.receiptHighlightKey}>VALOR TOTAL:</Text>
                  <Text style={styles.receiptHighlightVal}>{formatCOP(ventaExitosa.total)}</Text>
                </View>

                {ventaExitosa.cuota_inicial > 0 && (
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptKey}>
                      {ventaExitosa.modalidad === 'Venta de Contado' ? 'Método de Pago:' : 'Cuota Inicial:'}
                    </Text>
                    <Text style={[styles.receiptVal, { color: '#047857', fontWeight: '800' }]}>
                      {formatCOP(ventaExitosa.cuota_inicial)} ({ventaExitosa.metodo_pago_inicial})
                    </Text>
                  </View>
                )}

                <View style={styles.receiptRow}>
                  <Text style={styles.receiptKey}>Plan de Pagos:</Text>
                  <Text style={styles.receiptVal}>{ventaExitosa.cuotas}</Text>
                </View>

                {ventaExitosa.codeudor && (
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptKey}>Codeudor Solidario:</Text>
                    <Text style={[styles.receiptVal, { color: '#0F172A' }]}>
                      👤 {ventaExitosa.codeudor}
                    </Text>
                  </View>
                )}

                {ventaExitosa.referencia && (
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptKey}>Referencia:</Text>
                    <Text style={[styles.receiptVal, { color: '#475569' }]}>
                      👥 {ventaExitosa.referencia}
                    </Text>
                  </View>
                )}

                {/* Comprobante con Nomenclatura Humana */}
                <View style={styles.receiptPdfBox}>
                  <Text style={styles.receiptPdfIcon}>📄</Text>
                  <Text style={styles.receiptPdfName} numberOfLines={2}>
                    {ventaExitosa.nombre_archivo_pdf || `Venta_${ventaExitosa.id_contrato_codigo || 'CTR'}.pdf`}
                  </Text>
                </View>

                {/* Estado de Firmas Digitales */}
                <View style={styles.receiptSignaturesBadge}>
                  <Text style={styles.receiptSignaturesText}>
                    ✍️ Firmas Digitales: Titular ✓ • Vendedor ✓ {ventaExitosa.firma_codeudor ? '• Codeudor ✓' : ''}
                  </Text>
                </View>
              </View>
            )}

            {/* BOTONES DE ACCIÓN: DESCARGA Y COMPARTIR INMEDIATO */}
            <View style={styles.receiptActionButtons}>
              <TouchableOpacity
                style={[styles.receiptDownloadBtn, isDownloadingPdf && { opacity: 0.7 }]}
                onPress={() => handleDescargarPdf(ventaExitosa?.id_contrato || ventaExitosa?.id_contrato_uuid || ventaExitosa?.id_contrato_codigo)}
                disabled={isDownloadingPdf}
                accessibilityRole="button"
              >
                {isDownloadingPdf ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.receiptDownloadBtnText}>📥 Descargar Comprobante PDF</Text>
                )}
              </TouchableOpacity>

              <View style={styles.receiptShareRow}>
                <TouchableOpacity
                  style={styles.receiptWhatsAppBtn}
                  onPress={handleCompartirWhatsApp}
                  accessibilityRole="button"
                >
                  <Text style={styles.receiptWhatsAppBtnText}>💬 WhatsApp</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.receiptEmailBtn}
                  onPress={handleCompartirEmail}
                  accessibilityRole="button"
                >
                  <Text style={styles.receiptEmailBtnText}>✉️ Enviar Correo</Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={styles.successCloseBtn}
              onPress={async () => {
                await resetearFormularioCompleto();
                navigation.navigate(userRole?.toLowerCase() === 'supervisor' || userRole?.toLowerCase() === 'master' ? 'SupervisorDashboard' : 'VendedorDashboard');
              }}
            >
              <Text style={styles.successCloseBtnText}>Finalizar y Volver al Panel →</Text>
            </TouchableOpacity>
          </View>
        </View>
      </InFrameModal>

      {/* ========================================================================= */}
      {/* MODAL IN-FRAME: SELECTOR DESPLEGABLE CONTROLADO DE CIUDAD DE VENTA */}
      {/* ========================================================================= */}
      <CitySelectorModal
        visible={modalSeleccionarCiudad}
        onClose={() => setModalSeleccionarCiudad(false)}
        selectedCity={ciudadVenta}
        selectedDepartment={departamentoVenta}
        onSelectCity={(city, dep) => {
          setCiudadVenta(city);
          if (dep) setDepartamentoVenta(dep);
          setModalSeleccionarCiudad(false);
        }}
        title="Seleccionar Ciudad de Venta"
      />

      {/* Modal Personalizado React Native: Confirmar Limpieza de Formulario */}
      <Modal
        visible={modalConfirmarLimpiar}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setModalConfirmarLimpiar(false)}
      >
        <View style={styles.confirmModalOverlay}>
          <View style={styles.confirmModalCard}>
            <View style={styles.confirmModalIconBox}>
              <Text style={{ fontSize: 26 }}>🗑️</Text>
            </View>
            <Text style={styles.confirmModalTitle}>¿Reiniciar Formulario?</Text>
            <Text style={styles.confirmModalMessage}>
              Esta acción limpiará todos los campos, productos agregados y firmas para iniciar una venta desde cero.
            </Text>
            <View style={styles.confirmModalActions}>
              <TouchableOpacity
                style={styles.confirmModalBtnCancel}
                onPress={() => setModalConfirmarLimpiar(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.confirmModalBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmModalBtnConfirm}
                onPress={() => {
                  setModalConfirmarLimpiar(false);
                  resetearFormularioCompleto();
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.confirmModalBtnConfirmText}>Sí, Limpiar Todo</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal Personalizado: Confirmar Eliminación de Transferencia (UI de Marca) */}
      <InFrameModal
        visible={modalEliminarTransfVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setModalEliminarTransfVisible(false);
          setTransfAEliminarId(null);
        }}
      >
        <View style={styles.confirmModalOverlay}>
          <View style={styles.confirmModalCard}>
            <View style={styles.confirmModalIconBox}>
              <Text style={{ fontSize: 26 }}>🗑️</Text>
            </View>
            <Text style={styles.confirmModalTitle}>Confirmar Acción</Text>
            <Text style={styles.confirmModalMessage}>
              ¿Seguro que desea <Text style={{ fontWeight: 'bold' }}>eliminar</Text> esta transferencia?
            </Text>
            <View style={styles.confirmModalActions}>
              <TouchableOpacity
                style={styles.confirmModalBtnCancel}
                onPress={() => {
                  setModalEliminarTransfVisible(false);
                  setTransfAEliminarId(null);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.confirmModalBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmModalBtnConfirm}
                onPress={confirmarEliminarComprobante}
                activeOpacity={0.8}
              >
                <Text style={styles.confirmModalBtnConfirmText}>Eliminar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </InFrameModal>

      {/* Modal Selector de Entidad Bancaria */}
      <BankSelectorModal
        visible={modalBancoVisible}
        onClose={() => {
          setModalBancoVisible(false);
          setCompEditandoBancoId(null);
        }}
        bancos={bancos}
        selectedBanco={
          compEditandoBancoId
            ? (comprobantes.find((c) => c.id === compEditandoBancoId)?.banco || '')
            : bancoTransferencia
        }
        onSelectBanco={(b) => {
          if (compEditandoBancoId) {
            actualizarComprobante(compEditandoBancoId, 'banco', b);
          } else {
            setBancoTransferencia(b);
          }
          setErrorReferenciaDuplicada(null);
        }}
      />

      {/* ========================================================================= */}
      {/* MODAL INSTITUCIONAL UNIVERSAL: ALERTAS Y VALIDACIONES (WEB + MOBILE)       */}
      {/* ========================================================================= */}
      <InFrameModal
        visible={modalAlerta.visible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setModalAlerta((prev) => ({ ...prev, visible: false }))}
      >
        <View style={styles.confirmModalOverlay}>
          <View style={styles.confirmModalCard}>
            <View style={[
              styles.confirmModalIconBox,
              modalAlerta.tipo === 'error' && { backgroundColor: '#FEE2E2' },
              modalAlerta.tipo === 'warning' && { backgroundColor: '#FEF3C7' },
              modalAlerta.tipo === 'success' && { backgroundColor: '#DCFCE7' },
              modalAlerta.tipo === 'info' && { backgroundColor: '#EEF2FF' },
            ]}>
              <Text style={{ fontSize: 26 }}>
                {modalAlerta.tipo === 'error' ? '🚨' : (modalAlerta.tipo === 'success' ? '✓' : (modalAlerta.tipo === 'info' ? 'ℹ️' : '⚠️'))}
              </Text>
            </View>
            <Text style={styles.confirmModalTitle}>{modalAlerta.titulo}</Text>
            <Text style={styles.confirmModalMessage}>{modalAlerta.mensaje}</Text>
            <View style={[styles.confirmModalActions, modalAlerta.botones.length === 1 && { justifyContent: 'center' }]}>
              {modalAlerta.botones.map((btn, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[
                    styles.confirmModalBtnConfirm,
                    modalAlerta.botones.length > 1 && idx === 0 && styles.confirmModalBtnCancel,
                    modalAlerta.botones.length === 1 && {
                      flex: 1,
                      backgroundColor: modalAlerta.tipo === 'error' ? '#EF4444' : (modalAlerta.tipo === 'success' ? '#059669' : '#0F172A'),
                    },
                    btn.style === 'destructive' && { backgroundColor: '#DC2626' },
                  ]}
                  onPress={() => {
                    setModalAlerta((prev) => ({ ...prev, visible: false }));
                    if (typeof btn.onPress === 'function') {
                      btn.onPress();
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.confirmModalBtnConfirmText,
                      modalAlerta.botones.length > 1 && idx === 0 && styles.confirmModalBtnCancelText,
                    ]}
                  >
                    {btn.text}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </InFrameModal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    position: 'relative',
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  backBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  headerTitleCol: {
    flex: 1,
    marginLeft: 10,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  headerSub: {
    fontSize: 11,
    color: '#64748B',
  },
  resetHeaderBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
  },
  resetHeaderBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E11D48',
  },
  scrollContainer: {
    padding: 14,
    paddingBottom: 32,
    gap: 12,
  },
  modalidadTabs: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  tabTextActive: {
    color: '#059669',
  },
  cardSection: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.5,
  },
  changeClientBtn: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  changeClientBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  selectedClientBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
  },
  clientAvatarSmall: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clientAvatarText: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: '800',
  },
  selectedClientName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  selectedClientSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  noClientPrompt: {
    borderWidth: 1,
    borderColor: '#FDE68A',
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    padding: 12,
  },
  noClientPromptText: {
    fontSize: 11,
    color: '#B45309',
    fontWeight: '600',
  },
  addProductBtn: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  addProductBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#047857',
  },
  emptyItemsPrompt: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  emptyItemsText: {
    fontSize: 11,
    color: '#64748B',
  },
  itemsList: {
    gap: 8,
  },
  itemRowCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  itemSku: {
    fontSize: 9,
    fontFamily: 'monospace',
    color: '#64748B',
    fontWeight: '700',
  },
  itemName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 1,
  },
  removeItemBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  removeItemBtnText: {
    fontSize: 12,
    color: '#E11D48',
    fontWeight: '800',
  },
  itemControlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  qtyControlGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  qtyBtn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  qtyValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
    paddingHorizontal: 4,
  },
  variablePriceBox: {
    alignItems: 'flex-end',
  },
  varPriceLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 0.5,
  },
  varPriceInput: {
    height: 32,
    width: 100,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F59E0B',
    borderRadius: 6,
    paddingHorizontal: 6,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  unitPriceLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748B',
  },
  unitPriceVal: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  itemSubtotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#EEEEEE',
    paddingTop: 4,
  },
  subtotalLabel: {
    fontSize: 10,
    color: '#64748B',
  },
  subtotalValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#059669',
  },
  orderTotalBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  orderTotalLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#047857',
  },
  orderTotalValue: {
    fontSize: 16,
    fontWeight: '900',
    color: '#047857',
  },
  contadoNoticeBox: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
  },
  contadoNoticeTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#047857',
    marginBottom: 2,
  },
  contadoNoticeText: {
    fontSize: 11,
    color: '#065F46',
    lineHeight: 16,
  },
  modalidadUnificadaBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 12,
    padding: 10,
    gap: 10,
  },
  modalidadUnificadaIconBox: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalidadUnificadaIconText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
  },
  modalidadUnificadaTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#065F46',
  },
  modalidadUnificadaSub: {
    fontSize: 10,
    color: '#047857',
    marginTop: 1,
  },
  modalidadUnificadaTag: {
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#6EE7B7',
  },
  modalidadUnificadaTagText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#047857',
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  tipoPagoRow: {
    flexDirection: 'row',
    gap: 6,
  },
  tipoPagoChip: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  tipoPagoChipActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  tipoPagoChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
  },
  tipoPagoChipTextActive: {
    color: '#FFFFFF',
  },
  tipoPagoChipSub: {
    fontSize: 9,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 1,
  },
  tipoPagoChipSubActive: {
    color: '#94A3B8',
  },
  formRowTwoCols: {
    flexDirection: 'row',
    gap: 10,
  },
  fieldHelpText: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
  },
  fechaChipsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: -4,
  },
  fechaChipBtn: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  fechaChipBtnText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#0F172A',
  },
  financialBreakdownContainer: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
    gap: 10,
    marginTop: 4,
  },
  financialHeaderRow: {
    flexDirection: 'column',
    gap: 2,
  },
  financialHeaderTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  financialHeaderSub: {
    fontSize: 11,
    color: '#64748B',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  financialSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  financialSummaryCard: {
    width: '48.5%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: 8,
  },
  financialSummaryCardHighlight: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  financialSummaryLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.3,
  },
  financialSummaryLabelHighlight: {
    fontSize: 9,
    fontWeight: '800',
    color: '#047857',
    letterSpacing: 0.3,
  },
  financialSummaryVal: {
    fontSize: 13,
    fontWeight: '900',
    color: '#0F172A',
    marginTop: 2,
  },
  financialSummaryValHighlight: {
    fontSize: 14,
    fontWeight: '900',
    color: '#047857',
    marginTop: 2,
  },
  financialSummaryFoot: {
    fontSize: 9,
    color: '#94A3B8',
    marginTop: 1,
  },
  financialSummaryFootHighlight: {
    fontSize: 9,
    color: '#059669',
    marginTop: 1,
  },
  cronogramaSection: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    gap: 8,
  },
  cronogramaHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  cronogramaTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#334155',
    letterSpacing: 0.4,
  },
  cronogramaBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#059669',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  cronogramaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  cronogramaCard: {
    width: '48.5%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: 8,
  },
  cronogramaCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  cronogramaCardNumber: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
  },
  cronogramaCardAmount: {
    fontSize: 11,
    fontWeight: '800',
    color: '#059669',
  },
  cronogramaCardDate: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  operationalNoticeBox: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: 8,
    gap: 6,
    alignItems: 'flex-start',
  },
  operationalNoticeIcon: {
    fontSize: 12,
  },
  operationalNoticeText: {
    flex: 1,
    fontSize: 10,
    color: '#475569',
    lineHeight: 14,
  },
  operationalNoticeBold: {
    fontWeight: '700',
    color: '#1E293B',
  },
  fieldInput: {
    height: 40,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  dropdownSelectorBtn: {
    height: 40,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownSelectorText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
  },
  dropdownChevron: {
    fontSize: 14,
    color: '#64748B',
    marginLeft: 4,
  },
  cuotasGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  cuotaCard: {
    width: '48.5%',
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    position: 'relative',
  },
  cuotaCardActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  cuotaCardTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  cuotaCardTitleActive: {
    color: '#FFFFFF',
  },
  cuotaCardSub: {
    fontSize: 9,
    color: '#64748B',
    marginTop: 1,
  },
  cuotaCardSubActive: {
    color: '#94A3B8',
  },
  cuotaCardEst: {
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontWeight: '700',
    color: '#047857',
    marginTop: 4,
  },
  cuotaCardEstActive: {
    color: '#34D399',
  },
  cuotaBadge: {
    position: 'absolute',
    top: -6,
    right: 6,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  cuotaBadgeActive: {
    backgroundColor: '#10B981',
    borderColor: '#34D399',
  },
  cuotaBadgeText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#047857',
  },
  cuotaBadgeTextActive: {
    color: '#0F172A',
  },
  cuotaCuatroBanner: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 6,
    padding: 6,
    marginVertical: 4,
  },
  cuotaCuatroBannerText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#065F46',
    lineHeight: 12,
  },
  cuotasPresetRow: {
    flexDirection: 'row',
    gap: 6,
  },
  cuotaPresetChip: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cuotaPresetChipActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  cuotaPresetText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  cuotaPresetTextActive: {
    color: '#FFFFFF',
  },
  liveCalculationBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
  },
  liveCalcRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  liveCalcKey: {
    fontSize: 11,
    color: '#64748B',
  },
  liveCalcVal: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  liveCalcHighlight: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 6,
    padding: 8,
    marginVertical: 4,
  },
  liveCalcHighlightLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#047857',
  },
  liveCalcHighlightVal: {
    fontSize: 16,
    fontWeight: '900',
    color: '#047857',
  },
  liveCalcNotice: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
  },
  transmitBtn: {
    backgroundColor: '#059669',
    borderRadius: 10,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
    marginTop: 6,
  },
  transmitBtnDisabled: {
    opacity: 0.5,
  },
  transmitBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  // MODALES
  modalBackdrop: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  modalBackdropCenter: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalCloseBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 8,
    height: 36,
    marginBottom: 6,
  },
  searchIcon: {
    fontSize: 12,
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    color: '#0F172A',
  },
  clientPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  clientPickerAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clientPickerAvatarText: {
    color: '#34D399',
    fontSize: 10,
    fontWeight: '800',
  },
  clientPickerName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  clientPickerSub: {
    fontSize: 10,
    color: '#64748B',
  },
  clientPickerSelect: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  createNewClientShortcut: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  createNewClientShortcutText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#047857',
  },
  productPickerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  productPickerSku: {
    fontSize: 9,
    fontFamily: 'monospace',
    color: '#64748B',
  },
  productPickerVarTag: {
    fontSize: 9,
    fontWeight: '700',
    color: '#B45309',
  },
  productPickerName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 1,
  },
  productPickerPrice: {
    fontSize: 12,
    fontWeight: '800',
    color: '#059669',
    marginTop: 1,
  },
  productPickerAddPill: {
    backgroundColor: '#059669',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  productPickerAddText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  productPickerItemDisabled: {
    backgroundColor: '#F8FAFC',
    opacity: 0.7,
  },
  productPickerAddPillDisabled: {
    backgroundColor: '#E2E8F0',
  },
  productPickerAddTextDisabled: {
    color: '#94A3B8',
  },
  encargoBadgeModal: {
    backgroundColor: '#F3E8FF',
    borderWidth: 1,
    borderColor: '#D8B4FE',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  encargoBadgeTextModal: {
    fontSize: 9,
    fontWeight: '700',
    color: '#7E22CE',
  },
  agotadoBadgeModal: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  agotadoBadgeTextModal: {
    fontSize: 9,
    fontWeight: '700',
    color: '#B91C1C',
  },
  bajoStockBadgeModal: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  bajoStockBadgeTextModal: {
    fontSize: 9,
    fontWeight: '700',
    color: '#B45309',
  },
  disponibleBadgeModal: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  disponibleBadgeTextModal: {
    fontSize: 9,
    fontWeight: '700',
    color: '#047857',
  },
  cantEnOrdenBadge: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  cantEnOrdenText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#0284C7',
  },
  itemEncargoTag: {
    backgroundColor: '#F3E8FF',
    borderWidth: 1,
    borderColor: '#D8B4FE',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  itemEncargoText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#7E22CE',
  },
  itemStockTag: {
    borderWidth: 1,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  itemStockTagSuccess: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  itemStockTagWarning: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  itemStockText: {
    fontSize: 9,
    fontWeight: '700',
  },
  itemStockTextSuccess: {
    color: '#047857',
  },
  itemStockTextWarning: {
    color: '#B45309',
  },
  qtyBtnDisabled: {
    backgroundColor: '#E2E8F0',
    borderColor: '#CBD5E1',
    opacity: 0.6,
  },
  qtyBtnTextDisabled: {
    color: '#94A3B8',
  },
  stockTopeWarningRow: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FEF3C7',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginTop: 6,
  },
  stockTopeWarningText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#B45309',
  },
  successReceiptCard: {
    backgroundColor: '#FFFFFF',
    width: '100%',
    maxWidth: 380,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 6,
    alignItems: 'center',
  },
  successCheckBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  successCheckIcon: {
    fontSize: 18,
    color: '#15803D',
    fontWeight: 'bold',
  },
  successBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#047857',
    letterSpacing: 0.8,
  },
  successTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  successSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  receiptBody: {
    width: '100%',
    paddingVertical: 12,
    gap: 6,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  receiptKey: {
    fontSize: 11,
    color: '#64748B',
  },
  receiptVal: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F172A',
  },
  receiptValMono: {
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '600',
    color: '#0F172A',
  },
  receiptHighlight: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 6,
    padding: 8,
    marginVertical: 2,
  },
  receiptHighlightKey: {
    fontSize: 10,
    fontWeight: '800',
    color: '#047857',
  },
  receiptHighlightVal: {
    fontSize: 15,
    fontWeight: '900',
    color: '#047857',
  },
  successCloseBtn: {
    backgroundColor: '#0F172A',
    width: '100%',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  successCloseBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  // Estilos de Garantías, Codeudor y Referencias
  sectionSubTitle: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
  },
  garantiaBadge: {
    backgroundColor: '#EFF6FF',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  garantiaBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#1D4ED8',
    letterSpacing: 0.5,
  },
  subBlockBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  subBlockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  subBlockIconBox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#EEF2F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subBlockIconText: {
    fontSize: 14,
  },
  subBlockTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  subBlockSubtitle: {
    fontSize: 10,
    color: '#64748B',
  },
  inputGroup: {
    gap: 4,
  },
  rowTwoCols: {
    flexDirection: 'row',
    gap: 10,
  },
  parentescoChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  parentescoChip: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  parentescoChipActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#3B82F6',
  },
  parentescoChipText: {
    fontSize: 10,
    color: '#475569',
    fontWeight: '600',
  },
  parentescoChipTextActive: {
    color: '#1D4ED8',
    fontWeight: '700',
  },
  garantiasHeredadasBox: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    gap: 10,
  },
  garantiasHeredadasInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  garantiasHeredadasIcon: {
    fontSize: 22,
  },
  garantiasHeredadasTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
  },
  garantiasHeredadasText: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 2,
    lineHeight: 15,
  },
  toggleModificarBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F59E0B',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  toggleModificarBtnActive: {
    backgroundColor: '#475569',
    borderColor: '#334155',
  },
  toggleModificarBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B45309',
  },
  toggleModificarBtnTextActive: {
    color: '#FFFFFF',
  },
  fieldInputLocked: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
    color: '#64748B',
  },
  sectionBadgeRequired: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  sectionBadgeRequiredText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  signaturesSectionNotice: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 14,
    lineHeight: 17,
  },
  receiptPdfBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    padding: 10,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  receiptPdfIcon: {
    fontSize: 18,
  },
  receiptPdfName: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: '#0F172A',
  },
  receiptSignaturesBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginTop: 8,
  },
  receiptSignaturesText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#047857',
  },
  receiptActionButtons: {
    marginTop: 12,
    gap: 8,
    width: '100%',
  },
  receiptDownloadBtn: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  receiptDownloadBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  receiptShareRow: {
    flexDirection: 'row',
    gap: 8,
  },
  receiptWhatsAppBtn: {
    flex: 1,
    backgroundColor: '#25D366',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  receiptWhatsAppBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  receiptEmailBtn: {
    flex: 1,
    backgroundColor: '#334155',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  receiptEmailBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  contratoBoxContainer: {
    marginTop: 10,
    padding: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
  },
  contratoSwitchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  contratoSwitchTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  contratoSwitchSub: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
  },
  badgePill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 9999,
  },
  badgePillAuto: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  badgePillManual: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  badgePillText: {
    fontSize: 9,
    fontWeight: '800',
  },
  badgePillTextAuto: {
    color: '#15803D',
  },
  badgePillTextManual: {
    color: '#B45309',
  },
  fechaManualContainer: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
  },
  fechaManualSwitchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fechaManualSwitchTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  fechaManualSwitchSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  fechaManualInputBox: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  fieldInputManualFecha: {
    borderWidth: 1.5,
    borderColor: '#6366F1',
    backgroundColor: '#EEF2FF',
    color: '#1E1B4B',
    fontWeight: '700',
  },
  fieldInputDisabled: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
    color: '#94A3B8',
  },
  fieldInputActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#059669',
    color: '#0F172A',
    fontWeight: '700',
  },
  // Estilos de Pagos Mixtos (Cuota Inicial)
  metodoPagoBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
    gap: 10,
  },
  metodoPagoTabs: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 10,
    padding: 3,
    gap: 4,
  },
  metodoPagoTabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  metodoPagoTabBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  metodoPagoTabText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  metodoPagoTabTextActive: {
    color: '#059669',
    fontWeight: '800',
  },
  metodoPagoTabsDisabled: {
    backgroundColor: '#F1F5F9',
    opacity: 0.55,
  },
  metodoPagoTabBtnDisabledActive: {
    backgroundColor: '#E2E8F0',
    shadowOpacity: 0,
    elevation: 0,
  },
  metodoPagoTabTextDisabled: {
    color: '#94A3B8',
  },
  metodoPagoTabTextDisabledActive: {
    color: '#475569',
    fontWeight: '700',
  },
  metodoDetalleBox: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  cuadreBoxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    flexWrap: 'wrap',
    gap: 4,
  },
  cuadreBoxTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#334155',
    letterSpacing: 0.5,
  },
  cuadreBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  cuadreBadgeOk: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  cuadreBadgeWarn: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  cuadreBadgeError: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  cuadreBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  cuadreBadgeTextOk: {
    color: '#047857',
  },
  cuadreBadgeTextWarn: {
    color: '#B45309',
  },
  cuadreBadgeTextError: {
    color: '#DC2626',
  },
  btnAddVoucher: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#EFF6FF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  btnAddVoucherText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  voucherCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 8,
    gap: 6,
    marginTop: 6,
  },
  voucherCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingBottom: 4,
  },
  voucherCardTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#334155',
  },
  voucherDeleteBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: '#FEE2E2',
    borderRadius: 4,
  },
  voucherDeleteBtnText: {
    fontSize: 10,
    color: '#DC2626',
    fontWeight: '800',
  },
  sugerenciaMixtoText: {
    fontSize: 10,
    color: '#D97706',
    marginTop: 4,
    fontWeight: '600',
  },
  bankPickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bankPickerTriggerEmpty: {
    borderColor: '#94A3B8',
    backgroundColor: '#F1F5F9',
  },
  bankPickerTriggerError: {
    borderColor: '#EF4444',
    backgroundColor: '#FEF2F2',
  },
  bankPickerTriggerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  bankPickerTriggerTextPlaceholder: {
    color: '#64748B',
    fontWeight: '500',
  },
  fieldInputError: {
    borderColor: '#EF4444',
    borderWidth: 2,
    backgroundColor: '#FEF2F2',
  },
  errorBannerBox: {
    marginTop: 6,
    padding: 10,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
  },
  errorBannerText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B91C1C',
    lineHeight: 16,
  },
  confirmModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 99999,
  },
  confirmModalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 20,
  },
  confirmModalIconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  confirmModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  confirmModalMessage: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  confirmModalActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  confirmModalBtnCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  confirmModalBtnCancelText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#475569',
  },
  confirmModalBtnConfirm: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#EF4444',
    alignItems: 'center',
  },
  confirmModalBtnConfirmText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
});
