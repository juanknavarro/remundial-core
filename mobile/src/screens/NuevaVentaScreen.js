import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  AppState,
  Linking,
  Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient, { STORAGE_KEYS as AUTH_STORAGE_KEYS } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import InFrameModal from '../components/InFrameModal';
import SignatureCanvas from '../components/SignatureCanvas';
import CitySelectorModal, { inferirDepartamento } from '../components/CitySelectorModal';
import {
  guardarBorradorVenta,
  obtenerBorradorVenta,
  limpiarBorradorVenta,
  guardarEnCache,
  obtenerDeCache,
  STORAGE_KEYS,
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

// Fijación y cálculo automático de fecha del primer cobro: último día del mes siguiente a la compra
const getFechaPrimerCobroSugerida = (baseDate = new Date()) => {
  const d = baseDate instanceof Date ? baseDate : new Date();
  // El último día del mes siguiente: new Date(year, monthIndex + 2, 0)
  // Ej: 10 de Septiembre (month=8) -> new Date(2026, 10, 0) = 31 de Octubre de 2026
  const finMesSiguiente = new Date(d.getFullYear(), d.getMonth() + 2, 0);
  return formatDateISO(finMesSiguiente);
};

// Generador del cronograma escalonado de amortización de cuotas sucesivas a fin de mes
const calcularCronogramaCuotas = (fechaInicialStr, numCuotas, frecuencia = 'mensual', valorPorCuota = 0) => {
  if (!fechaInicialStr || numCuotas <= 0) return [];
  const cuotas = [];
  const cleanStr = formatDateISO(fechaInicialStr) || getFechaPrimerCobroSugerida();
  const [yStr, mStr] = cleanStr.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10); // Mes 1-indexed de la primera cuota (ej. 10 para Octubre)

  for (let i = 0; i < numCuotas; i++) {
    let fechaCuotaStr;
    if (i === 0) {
      fechaCuotaStr = cleanStr;
    } else {
      // Fin de mes consecutivo para cada cuota sucesiva:
      // new Date(y, m + i, 0) calcula el último día del mes sucesivo
      const fechaCuota = new Date(y, m + i, 0);
      fechaCuotaStr = formatDateISO(fechaCuota);
    }
    cuotas.push({
      numero: i + 1,
      fecha: fechaCuotaStr,
      valor: valorPorCuota,
    });
  }
  return cuotas;
};

const OPCIONES_CUOTAS = [
  { id: 9, label: '9 cuotas', sub: '9 periodos', badge: null },
  { id: 6, label: '6 cuotas', sub: '6 periodos', badge: null },
  { id: 4, label: '4 cuotas', sub: 'Inicial + 3 periodos', badge: 'Inicial + 3' },
  { id: 2, label: '2 cuotas', sub: '2 periodos', badge: null },
];

export default function NuevaVentaScreen({ route, navigation }) {
  const { user, token: authToken } = useAuth();
  const { encolarVenta, isOnline } = useSync();

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
  const [fechaPrimeraCuota, setFechaPrimeraCuota] = useState(() => getFechaPrimerCobroSugerida());

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
    setNumeroCuotas(4);
    setFechaPrimeraCuota(getFechaPrimerCobroSugerida());
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
            Alert.alert(
              'Artículo Agotado en Bodega',
              `El producto "${p.nombre}" (SKU: ${p.sku}) no cuenta con existencias disponibles en almacén.`
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
              Alert.alert(
                'Artículo Agotado en Bodega',
                `El producto "${p.nombre}" (SKU: ${p.sku}) no cuenta con existencias disponibles en almacén.`
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

        // Si vino un producto preseleccionado en ruta, agregarlo con validación preventiva
        if (route?.params?.productoPreseleccionado) {
          const p = route.params.productoPreseleccionado;
          const manejaStock = p.maneja_stock !== false;
          const stockDisp = p.stock != null ? Number(p.stock) : 0;
          if (manejaStock && stockDisp <= 0) {
            Alert.alert(
              'Artículo Agotado en Bodega',
              `El producto "${p.nombre}" (SKU: ${p.sku}) no cuenta con existencias disponibles en almacén.`
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
        if (draft.numeroCuotas) setNumeroCuotas(draft.numeroCuotas);
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
            numeroCuotas,
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
        numeroCuotas,
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
    numeroCuotas,
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

  // Cronograma de amortización proyectado en tiempo real
  const cronogramaProyectado = useMemo(() => {
    if (modalidad === 'contado' || montoFinanciado <= 0 || numeroCuotas <= 0) {
      return [];
    }
    return calcularCronogramaCuotas(fechaPrimeraCuota, numeroCuotas, tipoPago, valorCuota);
  }, [modalidad, montoFinanciado, numeroCuotas, tipoPago, valorCuota, fechaPrimeraCuota]);

  // Manejo de productos en la orden con validación preventiva de existencias y excepción de cuadros
  const agregarProductoAOrden = (p) => {
    const manejaStock = p.maneja_stock !== false;
    const stockDisp = p.stock != null ? Number(p.stock) : 0;

    // 1. Excepción de Cuadros: Si maneja_stock === false, se vende libremente
    if (manejaStock && stockDisp <= 0) {
      Alert.alert(
        'Artículo Agotado en Bodega',
        `El producto "${p.nombre}" (SKU: ${p.sku}) no cuenta con existencias físicas en almacén (Stock: 0). No es posible añadirlo a la venta hasta su reabastecimiento.`
      );
      return;
    }

    // 2. Si ya está en la orden, verificar que no supere las existencias
    const itemExistente = itemsVenta.find((item) => item.producto_id === p.id);
    if (itemExistente && manejaStock) {
      if (itemExistente.cantidad + 1 > stockDisp) {
        Alert.alert(
          'Límite de Existencias en Bodega',
          `Solo hay ${stockDisp} unidades disponibles de "${p.nombre}". Ya tienes ${itemExistente.cantidad} en la orden de venta.`
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
          Alert.alert(
            'Límite de Existencias en Bodega',
            `No es posible añadir más unidades de "${item.nombre}". Solo quedan ${stockDisp} unidades disponibles en almacén.`
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
      Alert.alert('Cliente requerido', 'Selecciona el cliente titular de la operación.');
      return;
    }
    if (itemsVenta.length === 0) {
      Alert.alert('Artículos requeridos', 'Agrega al menos un producto a la venta.');
      return;
    }

    // Validación preventiva de existencias físicas en bodega
    for (const item of itemsVenta) {
      const prodEnCatalogo = productos.find((p) => p.id === item.producto_id);
      const manejaStock = prodEnCatalogo ? prodEnCatalogo.maneja_stock !== false : item.maneja_stock !== false;
      const stockDisponible = prodEnCatalogo ? (prodEnCatalogo.stock ?? 0) : (item.stock ?? 0);

      if (manejaStock && item.cantidad > stockDisponible) {
        Alert.alert(
          'Stock Insuficiente en Almacén',
          `El artículo "${item.nombre}" supera el inventario disponible en bodega (${item.cantidad} solicitadas, ${stockDisponible} disponibles). Ajusta las cantidades antes de transmitir la venta.`
        );
        return;
      }
    }

    // Validación de políticas de riesgo para venta a crédito
    if (modalidad === 'credito') {
      if (!codeudorNombre.trim()) {
        Alert.alert(
          'Codeudor Requerido',
          'Para originar una venta a crédito debes registrar el nombre completo del codeudor solidario.'
        );
        return;
      }
      if (!codeudorTelefono.trim()) {
        Alert.alert(
          'Teléfono de Codeudor Requerido',
          'Ingresa el teléfono de contacto del codeudor solidario para el estudio y verificación crediticia.'
        );
        return;
      }
    }

    // Validación estricta de firmas: Titular y Vendedor son obligatorias; Codeudor es opcional
    if (!firmaTitular) {
      Alert.alert(
        'Firma del Titular Requerida',
        'Por favor capture la firma táctil del cliente titular en el recuadro de firmas antes de transmitir la venta.'
      );
      return;
    }
    if (!firmaVendedor) {
      Alert.alert(
        'Firma del Asesor Requerida',
        'Por favor estampe su firma táctil de asesor comercial en el recuadro correspondiente antes de enviar el contrato.'
      );
      return;
    }

    try {
      setIsSubmitting(true);

      // Fecha de primera cuota validada (o sugerida de respaldo)
      const fPrimera = fechaPrimeraCuota && /^\d{4}-\d{2}-\d{2}$/.test(fechaPrimeraCuota.trim())
        ? fechaPrimeraCuota.trim()
        : getFechaPrimerCobroSugerida(tipoPago);

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
        cuota_inicial: cuotaInicial,
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
        codeudor: codeudorObj,
        referencia: referenciaObj,
        firma_titular: firmaTitular || null,
        firma_vendedor: firmaVendedor || null,
        firma_codeudor: firmaCodeudor || null,
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
      };

      // Encolado resiliente (Persiste localmente y envía inmediatamente si hay red)
      const res = await encolarVenta(payload, meta);

      if (!res || !res.ok) {
        Alert.alert(
          'Aviso de Validación',
          res?.error || 'No fue posible originar la venta. Verifique los datos ingresados.'
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
      Alert.alert('Error en Venta', 'Ocurrió un error inesperado al procesar la transacción.');
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
      Alert.alert(
        'Comprobante no disponible',
        'No se ha encontrado un identificador válido para este contrato.'
      );
      return;
    }

    if (ventaExitosa?.offline) {
      Alert.alert(
        'Venta Guardada Localmente (Offline)',
        'Esta venta fue almacenada en la cola de sincronización local de su dispositivo. El comprobante PDF estará disponible una vez que se restablezca la conexión y se sincronice con el servidor.'
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
      Alert.alert(
        'Comprobante PDF',
        err.message || 'No se pudo descargar el archivo en este momento. Verifique la conexión con el servidor.'
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
      Alert.alert('WhatsApp', 'No fue posible abrir WhatsApp en este dispositivo.');
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
      Alert.alert('Correo Electrónico', 'No fue posible abrir la aplicación de correo.');
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
              if (Platform.OS === 'web') {
                if (typeof window !== 'undefined' && window.confirm('¿Deseas reiniciar el formulario y limpiar todos los datos de la venta?')) {
                  resetearFormularioCompleto();
                }
              } else {
                Alert.alert(
                  'Reiniciar Formulario',
                  '¿Deseas limpiar todos los campos y empezar una venta en blanco?',
                  [
                    { text: 'Cancelar', style: 'cancel' },
                    { text: 'Limpiar Todo', style: 'destructive', onPress: resetearFormularioCompleto },
                  ]
                );
              }
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
            <View style={styles.contadoNoticeBox}>
              <Text style={styles.contadoNoticeTitle}>✓ VENTA LIQUIDADA DE CONTADO</Text>
              <Text style={styles.contadoNoticeText}>
                Se registra el pago total de {formatCOP(totalArticulos)} al momento de la entrega. Sin financiación ni cuotas pendientes.
              </Text>
            </View>
          ) : (
            <View style={{ gap: 12, marginTop: 8 }}>
              {/* Modalidad Unificada: Crédito Mensual (Fin de Mes) */}
              <View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={styles.fieldLabel}>FRECUENCIA DE COBRO *</Text>
                  <Text style={{ fontSize: 9, fontWeight: '800', color: '#047857' }}>MODALIDAD UNIFICADA</Text>
                </View>
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
              </View>

              {/* Fila: Cuota Inicial y Fecha Primer Cobro */}
              <View style={styles.formRowTwoCols}>
                <View style={{ flex: 1 }}>
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

                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>FECHA PRIMER COBRO *</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={fechaPrimeraCuota}
                    onChangeText={setFechaPrimeraCuota}
                    placeholder="YYYY-MM-DD"
                  />
                  <Text style={styles.fieldHelpText}>
                    Fijada automáticamente a fin del mes siguiente
                  </Text>
                </View>
              </View>

              {/* Plazo / Número de Cuotas (4 Opciones Estrictas) */}
              <View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={styles.fieldLabel}>PLAZO DE CUOTAS PERMITIDO *</Text>
                  <Text style={{ fontSize: 9, fontWeight: '800', color: '#047857' }}>4 OPCIONES AUTORIZADAS</Text>
                </View>
                <View style={styles.cuotasGrid}>
                  {OPCIONES_CUOTAS.map((opc) => {
                    const isSelected = numeroCuotas === opc.id;
                    const cuotaEst = montoFinanciado > 0 ? Math.round(montoFinanciado / opc.id) : 0;
                    return (
                      <TouchableOpacity
                        key={opc.id}
                        style={[styles.cuotaCard, isSelected && styles.cuotaCardActive]}
                        onPress={() => setNumeroCuotas(opc.id)}
                        accessibilityRole="button"
                      >
                        {opc.badge && (
                          <View style={[styles.cuotaBadge, isSelected ? styles.cuotaBadgeActive : null]}>
                            <Text style={[styles.cuotaBadgeText, isSelected ? styles.cuotaBadgeTextActive : null]}>
                              {opc.badge}
                            </Text>
                          </View>
                        )}
                        <Text style={[styles.cuotaCardTitle, isSelected && styles.cuotaCardTitleActive]}>
                          {opc.label}
                        </Text>
                        <Text style={[styles.cuotaCardSub, isSelected && styles.cuotaCardSubActive]}>
                          {opc.sub}
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
                      <Text style={styles.financialSummaryFoot}>Mensual (Fin de Mes)</Text>
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

                  {/* TABLA / CRONOGRAMA DE VENCIMIENTO DE CUOTAS */}
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
          style={[styles.transmitBtn, (isSubmitting || itemsVenta.length === 0) && styles.transmitBtnDisabled]}
          onPress={handleTransmitirVenta}
          disabled={isSubmitting || itemsVenta.length === 0}
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
          <View style={styles.modalContent}>
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
            </View>

            <ScrollView style={{ maxHeight: 350, marginTop: 10 }}>
              {productosFiltrados.map((p) => {
                const manejaStock = p.maneja_stock !== false;
                const stockDisp = p.stock != null ? Number(p.stock) : 0;
                const estaAgotado = manejaStock && stockDisp <= 0;
                const bajoStock = manejaStock && stockDisp > 0 && stockDisp <= 5;
                const enOrden = itemsVenta.find((it) => it.producto_id === p.id);
                const cantEnOrden = enOrden ? enOrden.cantidad : 0;

                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.productPickerItem, estaAgotado && styles.productPickerItemDisabled]}
                    onPress={() => agregarProductoAOrden(p)}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Text style={styles.productPickerSku}>{p.sku}</Text>
                        {p.es_precio_variable ? (
                          <Text style={styles.productPickerVarTag}>🎨 Variable</Text>
                        ) : null}
                        {!manejaStock ? (
                          <View style={styles.encargoBadgeModal}>
                            <Text style={styles.encargoBadgeTextModal}>🎨 Por Encargo</Text>
                          </View>
                        ) : estaAgotado ? (
                          <View style={styles.agotadoBadgeModal}>
                            <Text style={styles.agotadoBadgeTextModal}>⚠️ Agotado (0 disp.)</Text>
                          </View>
                        ) : bajoStock ? (
                          <View style={styles.bajoStockBadgeModal}>
                            <Text style={styles.bajoStockBadgeTextModal}>⚠️ Quedan {stockDisp}</Text>
                          </View>
                        ) : (
                          <View style={styles.disponibleBadgeModal}>
                            <Text style={styles.disponibleBadgeTextModal}>✓ {stockDisp} disp.</Text>
                          </View>
                        )}
                        {cantEnOrden > 0 ? (
                          <View style={styles.cantEnOrdenBadge}>
                            <Text style={styles.cantEnOrdenText}>({cantEnOrden} en orden)</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={[styles.productPickerName, estaAgotado && { color: '#94A3B8' }]}>
                        {p.nombre}
                      </Text>
                      <Text style={styles.productPickerPrice}>{formatCOP(p.precio_base)}</Text>
                    </View>
                    <View style={[styles.productPickerAddPill, estaAgotado && styles.productPickerAddPillDisabled]}>
                      <Text style={[styles.productPickerAddText, estaAgotado && styles.productPickerAddTextDisabled]}>
                        {estaAgotado ? 'Agotado' : '＋ Agregar'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
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
          navigation.navigate('VendedorDashboard');
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
                navigation.navigate('VendedorDashboard');
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
});
