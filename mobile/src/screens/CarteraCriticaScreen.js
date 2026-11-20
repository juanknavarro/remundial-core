import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  Linking,
  Alert,
  Platform,
  ScrollView,
} from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../api/client';
import InFrameModal from '../components/InFrameModal';
import SignatureCanvas from '../components/SignatureCanvas';
import {
  guardarEnCache,
  obtenerDeCache,
  STORAGE_KEYS,
} from '../storage/database';

const formatCOP = (val) => {
  const num = Math.round(Number(val) || 0);
  return '$ ' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const CACHE_CARTERA_CRITICA = 'cache_cartera_critica_mobile';
const CACHE_ARTICULOS_CUSTODIA = 'cache_articulos_custodia_mobile';

export default function CarteraCriticaScreen({ navigation }) {
  const [activeTab, setActiveTab] = useState('cartera_critica'); // 'cartera_critica' | 'custodia'
  const [contratos, setContratos] = useState([]);
  const [diligenciasRetiro, setDiligenciasRetiro] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busqueda, setBusqueda] = useState('');

  // Estado para el modal de detalle de contrato
  const [contratoSeleccionado, setContratoSeleccionado] = useState(null);
  const [detalleModalVisible, setDetalleModalVisible] = useState(false);

  // Estado del patrón Acordeón (primera tarjeta expandida por defecto)
  const [expandedIndex, setExpandedIndex] = useState(0);
  const [expandedCustodiaIndex, setExpandedCustodiaIndex] = useState(0);

  // Estado para el modal corporativo de Reingreso a Stock
  const [reingresoModalVisible, setReingresoModalVisible] = useState(false);
  const [reingresoModalData, setReingresoModalData] = useState(null);
  const [isSubmittingReingreso, setIsSubmittingReingreso] = useState(false);

  // Estados para Modal de Orden de Retiro en Terreno con Doble Firma Táctil (Fase 3)
  const [modalRetiroVisible, setModalRetiroVisible] = useState(false);
  const [creditoRetiro, setCreditoRetiro] = useState(null);
  const [motivoRetiro, setMotivoRetiro] = useState('');
  const [observacionesRetiro, setObservacionesRetiro] = useState('');
  const [firmaClienteRetiro, setFirmaClienteRetiro] = useState(null);
  const [firmaSupervisorRetiro, setFirmaSupervisorRetiro] = useState(null);
  const [isSubmittingRetiro, setIsSubmittingRetiro] = useState(false);
  const isSubmittingRetiroRef = useRef(false);
  const [supervisorNombre, setSupervisorNombre] = useState('Supervisor de Operaciones');
  const [gpsCoords, setGpsCoords] = useState(null);

  // Estado para Modal de Acta de Restitución Exitosa Post-Formalización
  const [modalActaExitosaVisible, setModalActaExitosaVisible] = useState(false);
  const [actaGenerada, setActaGenerada] = useState(null);

  // Carga del nombre del usuario supervisor autenticado
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const storedUserRaw =
          (await AsyncStorage.getItem(STORAGE_KEYS.USER)) ||
          (await AsyncStorage.getItem('@remundial_user')) ||
          (await AsyncStorage.getItem('user'));
        if (storedUserRaw && isMounted) {
          const u = JSON.parse(storedUserRaw);
          const nom = u?.nombre || u?.nombre_completo || u?.nombres || u?.usuario || null;
          if (nom) setSupervisorNombre(nom);
        }
      } catch (_) {}
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  // Carga de datos de Cartera Crítica
  const cargarCarteraCritica = useCallback(async (isPullRefresh = false) => {
    try {
      // 1. Intentar endpoint especializado /creditos/cartera-critica
      let data = null;
      try {
        const res = await apiClient.get('/creditos/cartera-critica');
        if (Array.isArray(res.data)) {
          data = res.data;
        }
      } catch (err) {
        console.warn('[CarteraCriticaScreen] Fallback al listar creditos:', err);
      }

      // 2. Si no retornó lista, usar /creditos con filtro manual
      if (!data) {
        const resCreditos = await apiClient.get('/creditos');
        if (Array.isArray(resCreditos.data)) {
          data = resCreditos.data.filter((c) => {
            const cuotasVencidas = Number(c.cuotas_vencidas_count || 0);
            const numCuotas = Number(c.numero_cuotas || 0);
            const saldo = Number(c.saldo_pendiente || 0);
            return (c.es_cartera_critica || (numCuotas > 2 && cuotasVencidas >= 3)) && saldo > 0;
          });
        }
      }

      if (Array.isArray(data)) {
        setContratos(data);
        guardarEnCache(CACHE_CARTERA_CRITICA, data);
      } else {
        const cached = await obtenerDeCache(CACHE_CARTERA_CRITICA);
        if (Array.isArray(cached)) setContratos(cached);
      }
    } catch (error) {
      console.warn('[CarteraCriticaScreen] Error cargando cartera crítica, recurriendo a caché:', error);
      const cached = await obtenerDeCache(CACHE_CARTERA_CRITICA);
      if (Array.isArray(cached)) setContratos(cached);
    }
  }, []);

  // Carga de datos de Artículos Retirados en Custodia (GET /creditos/articulos-retirados)
  const cargarArticulosCustodia = useCallback(async (isPullRefresh = false) => {
    try {
      const res = await apiClient.get('/creditos/articulos-retirados');
      if (Array.isArray(res.data)) {
        setDiligenciasRetiro(res.data);
        guardarEnCache(CACHE_ARTICULOS_CUSTODIA, res.data);
      } else {
        const cached = await obtenerDeCache(CACHE_ARTICULOS_CUSTODIA);
        if (Array.isArray(cached)) setDiligenciasRetiro(cached);
      }
    } catch (error) {
      console.warn('[CarteraCriticaScreen] Error cargando artículos retirados, recurriendo a caché:', error);
      const cached = await obtenerDeCache(CACHE_ARTICULOS_CUSTODIA);
      if (Array.isArray(cached)) setDiligenciasRetiro(cached);
    }
  }, []);

  // Carga unificada en paralelo
  const cargarTodo = useCallback(async (isPullRefresh = false) => {
    if (isPullRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      await Promise.allSettled([
        cargarCarteraCritica(isPullRefresh),
        cargarArticulosCustodia(isPullRefresh),
      ]);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [cargarCarteraCritica, cargarArticulosCustodia]);

  useEffect(() => {
    cargarTodo(false);
  }, [cargarTodo]);

  // Filtrado reactivo por cliente, cédula o código de contrato (Cartera Crítica)
  const contratosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return contratos;
    const q = busqueda.trim().toLowerCase();
    return contratos.filter((c) => {
      const nom = (c.cliente?.nombres || c.cliente?.nombre_completo || c.cliente_nombre || '').toLowerCase();
      const ced = (c.cliente?.cedula || c.cliente_cedula || '').toLowerCase();
      const num = String(c.codigo_contrato || c.id_contrato || '').toLowerCase();
      const ciudad = String(c.ciudad_venta || c.cliente?.ciudad || '').toLowerCase();
      return nom.includes(q) || ced.includes(q) || num.includes(q) || ciudad.includes(q);
    });
  }, [contratos, busqueda]);

  // Filtrado reactivo Artículos en Custodia
  const diligenciasFiltradas = useMemo(() => {
    if (!busqueda.trim()) return diligenciasRetiro;
    const q = busqueda.trim().toLowerCase();
    return diligenciasRetiro.filter((d) => {
      const nom = (d.cliente_nombre || '').toLowerCase();
      const ced = (d.cliente_cedula || '').toLowerCase();
      const num = String(d.codigo_contrato || d.id_contrato || '').toLowerCase();
      const cob = (d.cobrador_nombre || '').toLowerCase();
      const itemMatch = d.articulos?.some(
        (a) => (a.nombre || '').toLowerCase().includes(q) || (a.sku || '').toLowerCase().includes(q)
      );
      return nom.includes(q) || ced.includes(q) || num.includes(q) || cob.includes(q) || itemMatch;
    });
  }, [diligenciasRetiro, busqueda]);

  // Métricas agregadas de mora crítica
  const metricas = useMemo(() => {
    let totalInsoluto = 0;
    let totalVencidoAproximado = 0;

    contratos.forEach((c) => {
      const saldo = Number(c.saldo_pendiente || 0);
      const cuotasVencidas = Number(c.cuotas_vencidas_count || 3);
      const valorCuota = Number(c.valor_cuota || 0);
      totalInsoluto += saldo;
      totalVencidoAproximado += Math.min(saldo, valorCuota * cuotasVencidas);
    });

    return {
      count: contratos.length,
      totalInsoluto,
      totalVencidoAproximado,
    };
  }, [contratos]);

  // Conteo de artículos en custodia y reingresados
  const articulosEnCustodiaCount = useMemo(() => {
    return diligenciasRetiro.reduce((acc, d) => {
      const pendientes = d.articulos?.filter((a) => !a.reingresado).length || 0;
      return acc + pendientes;
    }, 0);
  }, [diligenciasRetiro]);

  const articulosReingresadosCount = useMemo(() => {
    return diligenciasRetiro.reduce((acc, d) => {
      const reing = d.articulos?.filter((a) => a.reingresado).length || 0;
      return acc + reing;
    }, 0);
  }, [diligenciasRetiro]);

  const handleLlamar = (telefono) => {
    if (!telefono) {
      Alert.alert('Sin Teléfono', 'El cliente no tiene un teléfono de contacto registrado.');
      return;
    }
    const cleanTel = String(telefono).replace(/[^0-9]/g, '');
    Linking.openURL(`tel:${cleanTel}`).catch(() => {
      Alert.alert('Error', 'No es posible realizar llamadas desde este dispositivo.');
    });
  };

  const handleAbrirDetalle = (item) => {
    setContratoSeleccionado(item);
    setDetalleModalVisible(true);
  };

  // Descargar / Compartir Acta de Restitución en PDF con token de seguridad
  const handleDescargarActaPdf = async (id_contrato, codigo_contrato) => {
    if (!id_contrato) return;
    try {
      const baseURL = apiClient.defaults.baseURL || 'http://localhost:8000';
      const rawToken =
        (await AsyncStorage.getItem(STORAGE_KEYS.TOKEN)) ||
        (await AsyncStorage.getItem('@remundial_token')) ||
        (await AsyncStorage.getItem('token')) ||
        apiClient.defaults.headers.common?.['Authorization'] ||
        apiClient.defaults.headers?.['Authorization'];

      const tokenLimpio = rawToken ? String(rawToken).replace(/^Bearer\s+/i, '').trim() : '';
      const downloadUrl = `${baseURL}/creditos/${id_contrato}/acta-pdf${tokenLimpio ? `?token=${encodeURIComponent(tokenLimpio)}` : ''}`;

      if (Platform.OS === 'web' || typeof window !== 'undefined') {
        const filename = `Acta_Restitucion_${codigo_contrato || 'Contrato'}.pdf`;
        try {
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            try {
              document.body.removeChild(a);
            } catch (_) {}
          }, 150);
        } catch (_) {
          window.open(downloadUrl, '_blank');
        }
      } else {
        Linking.openURL(downloadUrl).catch(() => {
          Alert.alert('Descarga', 'No se pudo abrir el enlace del acta PDF.');
        });
      }
    } catch (err) {
      console.error('[CarteraCriticaScreen] Error descargando acta PDF:', err);
      Alert.alert('Error', 'No se pudo descargar el archivo PDF del acta de restitución.');
    }
  };

  // Abrir Modal de Autorización de Reingreso a Stock
  const handleAbrirModalReingreso = (diligencia, articulo) => {
    setReingresoModalData({
      id_contrato: diligencia.id_contrato,
      codigo_contrato: diligencia.codigo_contrato,
      cliente_nombre: diligencia.cliente_nombre,
      articulo: articulo,
      cantidad: articulo.cantidad || 1,
      condicion: 'Como Nuevo / Reacondicionado',
      observaciones: '',
    });
    setReingresoModalVisible(true);
  };

  // Confirmar Reingreso en FastAPI (POST /creditos/{id}/reingresar-articulo)
  const handleEjecutarReingreso = async () => {
    if (!reingresoModalData?.articulo || !reingresoModalData?.id_contrato) return;
    setIsSubmittingReingreso(true);
    try {
      const payload = {
        producto_id: reingresoModalData.articulo.producto_id,
        cantidad: Number(reingresoModalData.cantidad || 1),
        condicion: reingresoModalData.condicion || 'Como Nuevo / Reacondicionado',
        observaciones:
          reingresoModalData.observaciones.trim() ||
          'Reacondicionado y aprobado para reingreso a stock comercial.',
      };
      const res = await apiClient.post(
        `/creditos/${reingresoModalData.id_contrato}/reingresar-articulo`,
        payload
      );
      setReingresoModalVisible(false);
      Alert.alert(
        'Reingreso Autorizado',
        res.data?.mensaje ||
          'El artículo fue reintegrado exitosamente al inventario comercial disponible para venta.'
      );
      await cargarArticulosCustodia(false);
    } catch (err) {
      console.error('[CarteraCriticaScreen] Error reingresando artículo:', err);
      const detail =
        err?.response?.data?.detail || 'No se pudo autorizar el reingreso del artículo.';
      Alert.alert('Error', `Error al autorizar reingreso: ${detail}`);
    } finally {
      setIsSubmittingReingreso(false);
    }
  };

  // ==========================================
  // GESTIÓN DE ORDEN DE RETIRO (DOBLE FIRMA TÁCTIL)
  // ==========================================
  const capturarUbicacionGps = async () => {
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setGpsCoords({
              latitud: Number(pos.coords.latitude.toFixed(6)),
              longitud: Number(pos.coords.longitude.toFixed(6)),
              precision: Number(pos.coords.accuracy?.toFixed(1) || 5),
            });
          },
          () => {
            setGpsCoords({ latitud: 8.756412, longitud: -75.884129, precision: 10 });
          },
          { timeout: 6000 }
        );
        return;
      }

      if (Location && Location.requestForegroundPermissionsAsync) {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy ? Location.Accuracy.Balanced : 3,
            timeout: 8000,
          });
          setGpsCoords({
            latitud: Number(loc.coords.latitude.toFixed(6)),
            longitud: Number(loc.coords.longitude.toFixed(6)),
            precision: Number(loc.coords.accuracy?.toFixed(1) || 5),
          });
          return;
        }
      }
      setGpsCoords({ latitud: 8.756412, longitud: -75.884129, precision: 10 });
    } catch (_) {
      setGpsCoords({ latitud: 8.756412, longitud: -75.884129, precision: 10 });
    }
  };

  const handleAbrirModalRetiro = async (credito) => {
    isSubmittingRetiroRef.current = false;
    setIsSubmittingRetiro(false);
    setCreditoRetiro(credito);

    const cuotasVencidas = Number(credito.cuotas_vencidas_count || 3);
    setMotivoRetiro(
      `Incumplimiento grave de pago con acumulación de ${cuotasVencidas} cuotas morosas vencidas (Causal de restitución prendaria).`
    );
    setObservacionesRetiro(
      'Bienes muebles entregados para custodia oficial y amortización o restitución del saldo deudor.'
    );
    setFirmaClienteRetiro(null);
    setFirmaSupervisorRetiro(null);
    setModalRetiroVisible(true);
    capturarUbicacionGps();

    // Si los detalles de artículos no vienen cargados, consultar /creditos/{id}
    if (!credito.detalles || credito.detalles.length === 0) {
      try {
        const res = await apiClient.get(`/creditos/${credito.id_contrato}`);
        if (res.data?.detalles) {
          setCreditoRetiro((prev) => ({
            ...prev,
            ...res.data,
            detalles: res.data.detalles,
          }));
        }
      } catch (_) {}
    }
  };

  const handleConfirmarOrdenRetiro = async () => {
    if (isSubmittingRetiroRef.current || isSubmittingRetiro) return;
    if (!creditoRetiro) return;

    if (!firmaClienteRetiro) {
      Alert.alert(
        'Firma del Cliente Requerida',
        'Debe capturar la firma manuscrita de entrega y conformidad del cliente titular en el recuadro digital.'
      );
      return;
    }

    if (!firmaSupervisorRetiro) {
      Alert.alert(
        'Firma del Supervisor Requerida',
        'Debe estampar su firma digital como supervisor o gestor de cobro para certificar la custodia y restitución de los bienes.'
      );
      return;
    }

    isSubmittingRetiroRef.current = true;
    setIsSubmittingRetiro(true);

    try {
      const targetId = creditoRetiro.id_contrato || creditoRetiro.id;
      let nombreCobrador =
        supervisorNombre ||
        creditoRetiro.cobrador?.nombre ||
        creditoRetiro.cobrador_nombre ||
        'Supervisor de Operaciones';

      const payload = {
        motivo: motivoRetiro || 'Mora crítica mayor o igual a 3 cuotas',
        firma_cliente: firmaClienteRetiro,
        firma_cobrador: firmaSupervisorRetiro,
        cobrador_nombre: nombreCobrador,
        observaciones:
          observacionesRetiro ||
          'Bienes recibidos en custodia oficial en diligencia presencial de supervisión.',
        latitud: gpsCoords?.latitud || 8.756412,
        longitud: gpsCoords?.longitud || -75.884129,
      };

      const res = await apiClient.post(`/creditos/${targetId}/orden-retiro`, payload);

      setModalRetiroVisible(false);

      const infoActa = {
        id_contrato: targetId,
        numero_contrato:
          creditoRetiro.codigo_contrato ||
          creditoRetiro.numero_contrato ||
          `CTR-${String(targetId).slice(0, 8).toUpperCase()}`,
        cliente_nombre:
          creditoRetiro.cliente?.nombres ||
          creditoRetiro.cliente?.nombre_completo ||
          creditoRetiro.cliente_nombre ||
          'Cliente Titular',
        cliente_cedula:
          creditoRetiro.cliente?.cedula ||
          creditoRetiro.cliente?.documento_numero ||
          creditoRetiro.cliente_cedula ||
          'No registrada',
        cuotas_vencidas:
          res.data?.cuotas_vencidas ||
          creditoRetiro.cuotas_vencidas_count ||
          3,
        saldo_pendiente:
          res.data?.saldo_pendiente ||
          creditoRetiro.saldo_pendiente ||
          0,
        fecha_acta:
          res.data?.fecha_acta ||
          new Date().toISOString().slice(0, 19).replace('T', ' '),
        pdf_url: res.data?.pdf_url || `/creditos/${targetId}/acta-pdf`,
      };

      setActaGenerada(infoActa);
      setModalActaExitosaVisible(true);

      // Refrescar ambas listas automáticamente (Cartera Crítica y En Custodia)
      cargarTodo(false);
    } catch (error) {
      console.error('[CarteraCriticaScreen] Error registrando orden de retiro:', error);
      const msg =
        error.response?.data?.detail ||
        error.message ||
        'No se pudo generar la orden de retiro formal.';
      Alert.alert('Error al Generar Orden de Retiro', msg);
    } finally {
      setIsSubmittingRetiro(false);
      isSubmittingRetiroRef.current = false;
    }
  };

  const renderCardCritica = ({ item, index }) => {
    const isExpanded = expandedIndex === index;
    const clienteNombre = item.cliente?.nombres || item.cliente?.nombre_completo || item.cliente_nombre || 'Cliente Titular';
    const cedula = item.cliente?.cedula || item.cliente_cedula || 'S/N';
    const contratoCodigo = item.codigo_contrato || `CTR-${String(item.id_contrato || '').slice(0, 8).toUpperCase()}`;
    const ciudad = item.ciudad_venta || item.cliente?.ciudad || item.cliente?.barrio || 'Montería';
    const cuotasVencidas = Number(item.cuotas_vencidas_count || 3);
    const totalCuotas = Number(item.numero_cuotas || 4);
    const diasMora = item.dias_mora != null ? Number(item.dias_mora) : Math.max(90, cuotasVencidas * 30);
    const valorCuota = Number(item.valor_cuota || 0);
    const saldoPendiente = Number(item.saldo_pendiente || 0);
    const totalVencido = Math.min(saldoPendiente, valorCuota * cuotasVencidas);
    const telefono = item.cliente?.telefono || item.cliente_telefono;
    const cobrador = item.cobrador?.nombre || item.cobrador_nombre || 'Cobrador en Ruta';

    return (
      <View style={[styles.alertCard, isExpanded && styles.alertCardExpanded]}>
        {/* Cabecera Interactiva del Acordeón */}
        <TouchableOpacity
          style={styles.accordionHeaderTouchable}
          onPress={() => setExpandedIndex(isExpanded ? -1 : index)}
          activeOpacity={0.8}
        >
          <View style={styles.cardHeader}>
            <View style={styles.contratoBadge}>
              <Text style={styles.contratoText}>{contratoCodigo}</Text>
            </View>

            <View style={styles.headerRightGroup}>
              <View style={styles.alertaBadge}>
                <View style={styles.alertaPulse} />
                <Text style={styles.alertaBadgeText}>
                  ⚠️ {cuotasVencidas} de {totalCuotas} vencidas
                </Text>
              </View>
              <Text style={styles.accordionChevronText}>
                {isExpanded ? '▲' : '▼'}
              </Text>
            </View>
          </View>

          {/* Resumen colapsado permanente */}
          <View style={styles.accordionSummaryRow}>
            <Text style={styles.clienteNombre} numberOfLines={1}>
              {clienteNombre}
            </Text>
            <Text style={styles.moraMontoHighlight}>
              {formatCOP(totalVencido)}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Cuerpo Expandido del Acordeón (index === expandedIndex) */}
        {isExpanded ? (
          <View style={styles.accordionExpandedContent}>
            {/* Ubicación y Documento */}
            <View style={styles.cardBody}>
              <View style={styles.infoRow}>
                <Text style={styles.docText}>CC: {cedula}</Text>
                <Text style={styles.dotSeparator}>•</Text>
                <Text style={styles.cityText}>📍 {ciudad}</Text>
              </View>
            </View>

            {/* Bloque Financiero Crítico: Días de Mora y Total Vencido */}
            <View style={styles.criticalStatsBox}>
              <View style={styles.statCol}>
                <Text style={styles.statLabel}>DÍAS EN MORA</Text>
                <Text style={styles.diasMoraText}>⏱️ {diasMora} días</Text>
              </View>

              <View style={styles.statDivider} />

              <View style={styles.statCol}>
                <Text style={[styles.statLabel, { color: '#BE123C' }]}>TOTAL VENCIDO</Text>
                <Text style={styles.totalVencidoText}>{formatCOP(totalVencido)}</Text>
              </View>

              <View style={styles.statDivider} />

              <View style={styles.statCol}>
                <Text style={styles.statLabel}>SALDO TOTAL</Text>
                <Text style={styles.saldoTotalText}>{formatCOP(saldoPendiente)}</Text>
              </View>
            </View>

            <View style={styles.cobradorRow}>
              <Text style={styles.cobradorLabel}>Cobrador a cargo:</Text>
              <Text style={styles.cobradorValue}>{cobrador}</Text>
            </View>

            {/* Botones Destacados de Acción */}
            <View style={styles.cardActionsRow}>
              <TouchableOpacity
                style={styles.btnDetalle}
                onPress={() => handleAbrirDetalle(item)}
                activeOpacity={0.8}
              >
                <Text style={styles.btnDetalleIcon}>📋</Text>
                <Text style={styles.btnDetalleText}>Ver Detalle</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btnLlamar, !telefono && styles.btnDisabled]}
                onPress={() => handleLlamar(telefono)}
                disabled={!telefono}
                activeOpacity={0.8}
              >
                <Text style={styles.btnLlamarIcon}>📞</Text>
                <Text style={styles.btnLlamarText}>
                  {telefono ? `Llamar (${telefono})` : 'Sin Teléfono'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Botón Principal: Ejecutar Retiro / Restitución */}
            <TouchableOpacity
              style={styles.btnEjecutarRetiro}
              onPress={() => handleAbrirModalRetiro(item)}
              activeOpacity={0.8}
            >
              <Text style={styles.btnEjecutarRetiroIcon}>🚨</Text>
              <Text style={styles.btnEjecutarRetiroText}>
                Ejecutar Retiro / Restitución
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  const renderCardCustodia = ({ item, index }) => {
    const isExpanded = expandedCustodiaIndex === index;
    const todosReingresados =
      item.todos_reingresados ||
      (item.articulos &&
        item.articulos.length > 0 &&
        item.articulos.every((a) => a.reingresado));
    const totalArticulos = item.total_articulos || item.articulos?.length || 1;
    const reingresadosCount =
      item.articulos_reingresados_count ||
      item.articulos?.filter((a) => a.reingresado).length ||
      0;
    const pendientesCount = totalArticulos - reingresadosCount;

    return (
      <View style={[styles.alertCard, isExpanded && styles.custodiaCardExpanded]}>
        {/* Cabecera Interactiva del Acordeón */}
        <TouchableOpacity
          style={styles.accordionHeaderTouchable}
          onPress={() => setExpandedCustodiaIndex(isExpanded ? -1 : index)}
          activeOpacity={0.8}
        >
          <View style={styles.cardHeader}>
            <View style={styles.contratoBadge}>
              <Text style={styles.contratoText}>{item.codigo_contrato}</Text>
            </View>

            <View style={styles.headerRightGroup}>
              {todosReingresados ? (
                <View style={styles.reingresadoBadge}>
                  <Text style={styles.reingresadoBadgeText}>✅ En Stock</Text>
                </View>
              ) : (
                <View style={styles.custodiaBadge}>
                  <View style={styles.custodiaPulse} />
                  <Text style={styles.custodiaBadgeText}>
                    📦 Custodia ({pendientesCount})
                  </Text>
                </View>
              )}
              <Text style={styles.accordionChevronText}>
                {isExpanded ? '▲' : '▼'}
              </Text>
            </View>
          </View>

          {/* Resumen Permanente */}
          <View style={styles.accordionSummaryRow}>
            <Text style={styles.clienteNombre} numberOfLines={1}>
              {item.cliente_nombre}
            </Text>
            <Text style={styles.custodiaMontoHighlight}>
              {formatCOP(item.saldo_pendiente)}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Contenido Expandido */}
        {isExpanded ? (
          <View style={styles.accordionExpandedContent}>
            {/* Ubicación y Documento */}
            <View style={styles.cardBody}>
              <View style={styles.infoRow}>
                <Text style={styles.docText}>CC: {item.cliente_cedula || 'S/N'}</Text>
                <Text style={styles.dotSeparator}>•</Text>
                <Text style={styles.cityText}>🕒 {item.fecha_acta}</Text>
              </View>
              {item.motivo ? (
                <Text style={styles.motivoText}>Motivo: {item.motivo}</Text>
              ) : null}
              {item.observaciones ? (
                <Text style={styles.observacionesText}>Obs: {item.observaciones}</Text>
              ) : null}
            </View>

            {/* Lista de Artículos de la Diligencia */}
            <View style={styles.articulosSection}>
              <Text style={styles.articulosSectionTitle}>
                ARTÍCULOS EN DILIGENCIA ({item.articulos?.length || 0})
              </Text>

              {item.articulos?.map((art, aIdx) => (
                <View key={aIdx} style={styles.articuloItemCard}>
                  <View style={styles.articuloItemHeader}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={styles.articuloNombre}>{art.nombre}</Text>
                      <Text style={styles.articuloSku}>
                        SKU: {art.sku || 'N/A'} • Cantidad: {art.cantidad || 1}
                      </Text>
                    </View>
                    {art.reingresado ? (
                      <View style={styles.artReingresadoPill}>
                        <Text style={styles.artReingresadoPillText}>✓ Reingresado</Text>
                      </View>
                    ) : (
                      <View style={styles.artCustodiaPill}>
                        <Text style={styles.artCustodiaPillText}>En Custodia</Text>
                      </View>
                    )}
                  </View>

                  {art.reingresado ? (
                    <View style={styles.artReingresadoMeta}>
                      <Text style={styles.artReingresadoMetaText}>
                        Reincorporado por {art.reingresado_por || 'Supervisor'} ({art.fecha_reingreso || ''})
                      </Text>
                      {art.observaciones_reingreso ? (
                        <Text style={styles.artReingresadoObs}>
                          Nota: {art.observaciones_reingreso}
                        </Text>
                      ) : null}
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.btnReingresarArticulo}
                      onPress={() => handleAbrirModalReingreso(item, art)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.btnReingresarIcon}>📥</Text>
                      <Text style={styles.btnReingresarText}>
                        Autorizar Reingreso a Stock
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>

            <View style={styles.cobradorRow}>
              <Text style={styles.cobradorLabel}>Gestor que retiró:</Text>
              <Text style={styles.cobradorValue}>{item.cobrador_nombre || 'En Ruta'}</Text>
            </View>

            {/* Botón de Descargar / Compartir Acta PDF */}
            <View style={styles.cardActionsRow}>
              <TouchableOpacity
                style={styles.btnActaPdf}
                onPress={() => handleDescargarActaPdf(item.id_contrato, item.codigo_contrato)}
                activeOpacity={0.8}
              >
                <Text style={styles.btnActaPdfIcon}>📄</Text>
                <Text style={styles.btnActaPdfText}>Descargar / Compartir Acta PDF</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />

      {/* HEADER SUPERIOR */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>
            {activeTab === 'cartera_critica' ? 'Cartera Crítica' : 'Artículos en Custodia'}
          </Text>
          <Text style={styles.headerSubtitle}>
            {activeTab === 'cartera_critica'
              ? `${contratos.length} ${contratos.length === 1 ? 'caso en alerta' : 'casos en alerta máxima (≥ 3 cuotas)'}`
              : `${articulosEnCustodiaCount} ${articulosEnCustodiaCount === 1 ? 'artículo en custodia / bodega' : 'artículos en custodia / bodega'}`}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => cargarTodo(true)}
          disabled={isRefreshing}
          activeOpacity={0.7}
        >
          <Text style={styles.refreshBtnText}>{isRefreshing ? '⏳' : '↻'}</Text>
        </TouchableOpacity>
      </View>

      {/* SELECTOR DE PESTAÑAS (PARIDAD WEB) */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'cartera_critica' && styles.tabButtonActiveCritica]}
          onPress={() => {
            setActiveTab('cartera_critica');
            setExpandedIndex(0);
          }}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'cartera_critica' && styles.tabTextActiveCritica,
            ]}
          >
            ⚠️ Cartera Crítica ({contratos.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'custodia' && styles.tabButtonActiveCustodia]}
          onPress={() => {
            setActiveTab('custodia');
            setExpandedCustodiaIndex(0);
          }}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'custodia' && styles.tabTextActiveCustodia,
            ]}
          >
            📦 En Custodia ({articulosEnCustodiaCount})
          </Text>
        </TouchableOpacity>
      </View>

      {/* BANNER DINÁMICO */}
      {activeTab === 'cartera_critica' ? (
        <View style={styles.alertBanner}>
          <View style={styles.alertBannerHeader}>
            <Text style={styles.alertBannerIcon}>🚨</Text>
            <Text style={styles.alertBannerTitle}>POLÍTICA DE COBRO PREJURÍDICO</Text>
          </View>
          <Text style={styles.alertBannerBody}>
            Los contratos aquí agrupados acumulan 3 o más cuotas vencidas consecutivas. Requieren visita de supervisión, renegociación formal o diligencia de restitución de bienes.
          </Text>
          <View style={styles.alertStatsRow}>
            <View style={styles.alertStatPill}>
              <Text style={styles.alertStatLabel}>Saldo en Riesgo:</Text>
              <Text style={styles.alertStatVal}>{formatCOP(metricas.totalInsoluto)}</Text>
            </View>
            <View style={styles.alertStatPill}>
              <Text style={styles.alertStatLabel}>Total Vencido:</Text>
              <Text style={[styles.alertStatVal, { color: '#BE123C' }]}>
                {formatCOP(metricas.totalVencidoAproximado)}
              </Text>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.custodiaBanner}>
          <View style={styles.alertBannerHeader}>
            <Text style={styles.alertBannerIcon}>📦</Text>
            <Text style={styles.custodiaBannerTitle}>INVENTARIO RECUPERADO EN CUSTODIA</Text>
          </View>
          <Text style={styles.alertBannerBody}>
            Artículos y bienes restituidos mediante acta formal. El supervisor puede autorizar su reincorporación al inventario comercial de venta.
          </Text>
          <View style={styles.alertStatsRow}>
            <View style={styles.alertStatPill}>
              <Text style={styles.alertStatLabel}>En Bodega / Custodia:</Text>
              <Text style={[styles.alertStatVal, { color: '#D97706' }]}>
                {articulosEnCustodiaCount} art.
              </Text>
            </View>
            <View style={styles.alertStatPill}>
              <Text style={styles.alertStatLabel}>Reingresados a Stock:</Text>
              <Text style={[styles.alertStatVal, { color: '#059669' }]}>
                {articulosReingresadosCount} art.
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* BUSCADOR */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder={
              activeTab === 'cartera_critica'
                ? 'Buscar por cliente, cédula, contrato o ciudad...'
                : 'Buscar por cliente, cédula, contrato, artículo o SKU...'
            }
            placeholderTextColor="#94A3B8"
            value={busqueda}
            onChangeText={setBusqueda}
            clearButtonMode="while-editing"
          />
          {busqueda.length > 0 ? (
            <TouchableOpacity onPress={() => setBusqueda('')}>
              <Text style={styles.clearBtnText}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* LISTAS FLUIDAS */}
      {isLoading && !isRefreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator
            size="large"
            color={activeTab === 'cartera_critica' ? '#E11D48' : '#D97706'}
          />
          <Text style={styles.loadingText}>
            {activeTab === 'cartera_critica'
              ? 'Auditando contratos en mora crítica...'
              : 'Consultando artículos en custodia...'}
          </Text>
        </View>
      ) : activeTab === 'cartera_critica' ? (
        <FlatList
          data={contratosFiltrados}
          keyExtractor={(item) => String(item.id_contrato)}
          renderItem={renderCardCritica}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => cargarTodo(true)}
              colors={['#E11D48']}
              tintColor="#E11D48"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🛡️</Text>
              <Text style={styles.emptyTitle}>
                {busqueda ? 'Sin coincidencias' : '¡Excelente! Sin Cartera Crítica'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {busqueda
                  ? `No hay contratos en mora crítica que coincidan con "${busqueda}".`
                  : 'No se detectan créditos con 3 o más cuotas vencidas en el sistema actualmente.'}
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={diligenciasFiltradas}
          keyExtractor={(item) => String(item.id_contrato)}
          renderItem={renderCardCustodia}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => cargarTodo(true)}
              colors={['#D97706']}
              tintColor="#D97706"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>📦</Text>
              <Text style={styles.emptyTitle}>
                {busqueda ? 'Sin coincidencias' : 'Sin Artículos en Custodia'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {busqueda
                  ? `No se encontraron artículos en custodia que coincidan con "${busqueda}".`
                  : 'No hay actas de restitución ni artículos en custodia física registrados actualmente.'}
              </Text>
            </View>
          }
        />
      )}

      {/* MODAL EN PANTALLA: VER DETALLE DEL CONTRATO CRÍTICO */}
      <InFrameModal
        visible={detalleModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setDetalleModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Detalle de Cartera Crítica</Text>
                <Text style={styles.modalSubtitle}>
                  {contratoSeleccionado?.codigo_contrato ||
                    `CTR-${String(contratoSeleccionado?.id_contrato || '').slice(0, 8).toUpperCase()}`}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setDetalleModalVisible(false)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {contratoSeleccionado ? (
                <>
                  {/* Datos del Cliente */}
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>INFORMACIÓN DEL CLIENTE</Text>
                    <Text style={styles.modalClienteName}>
                      {contratoSeleccionado.cliente?.nombres ||
                        contratoSeleccionado.cliente_nombre ||
                        'Cliente Titular'}
                    </Text>
                    <Text style={styles.modalInfoLine}>
                      CC / NIT: {contratoSeleccionado.cliente?.cedula || contratoSeleccionado.cliente_cedula || 'S/N'}
                    </Text>
                    <Text style={styles.modalInfoLine}>
                      Ciudad: {contratoSeleccionado.ciudad_venta || contratoSeleccionado.cliente?.ciudad || 'Montería'}
                    </Text>
                    {contratoSeleccionado.cliente?.direccion ? (
                      <Text style={styles.modalInfoLine}>
                        Dirección: {contratoSeleccionado.cliente.direccion}
                      </Text>
                    ) : null}
                  </View>

                  {/* Estado de Cobranza */}
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>ESTADO FINANCIERO Y MORA</Text>
                    <View style={styles.modalGrid2}>
                      <View style={styles.modalGridItem}>
                        <Text style={styles.modalGridLabel}>SALDO TOTAL</Text>
                        <Text style={styles.modalGridValue}>
                          {formatCOP(contratoSeleccionado.saldo_pendiente)}
                        </Text>
                      </View>
                      <View style={styles.modalGridItem}>
                        <Text style={styles.modalGridLabel}>VALOR CUOTA</Text>
                        <Text style={styles.modalGridValue}>
                          {formatCOP(contratoSeleccionado.valor_cuota)}
                        </Text>
                      </View>
                      <View style={styles.modalGridItem}>
                        <Text style={styles.modalGridLabel}>CUOTAS VENCIDAS</Text>
                        <Text style={[styles.modalGridValue, { color: '#E11D48' }]}>
                          {contratoSeleccionado.cuotas_vencidas_count || 3} de {contratoSeleccionado.numero_cuotas || 4}
                        </Text>
                      </View>
                      <View style={styles.modalGridItem}>
                        <Text style={styles.modalGridLabel}>DÍAS EN MORA</Text>
                        <Text style={[styles.modalGridValue, { color: '#E11D48' }]}>
                          ⏱️ {contratoSeleccionado.dias_mora || 90} días
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Cobrador Responsable */}
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>OPERACIONES EN TERRENO</Text>
                    <Text style={styles.modalInfoLine}>
                      Cobrador: {contratoSeleccionado.cobrador?.nombre || contratoSeleccionado.cobrador_nombre || 'Sin asignar'}
                    </Text>
                  </View>

                  {/* Botón de Llamada dentro del Modal */}
                  {contratoSeleccionado.cliente?.telefono ? (
                    <TouchableOpacity
                      style={styles.modalCallBtn}
                      onPress={() => handleLlamar(contratoSeleccionado.cliente.telefono)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.modalCallIcon}>📞</Text>
                      <Text style={styles.modalCallText}>
                        Llamar a {contratoSeleccionado.cliente.telefono}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </InFrameModal>

      {/* MODAL EN PANTALLA: AUTORIZAR REINGRESO A STOCK COMERCIAL */}
      <InFrameModal
        visible={reingresoModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          if (!isSubmittingReingreso) setReingresoModalVisible(false);
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.modalTitle}>Autorizar Reingreso a Stock</Text>
                <Text style={styles.modalSubtitleCustodia}>
                  {reingresoModalData?.codigo_contrato} • {reingresoModalData?.articulo?.nombre}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setReingresoModalVisible(false)}
                disabled={isSubmittingReingreso}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {reingresoModalData ? (
                <>
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>DETALLES DEL BIEN RECUPERADO</Text>
                    <Text style={styles.modalClienteName}>
                      {reingresoModalData.articulo?.nombre}
                    </Text>
                    <Text style={styles.modalInfoLine}>
                      SKU: {reingresoModalData.articulo?.sku || 'S/N'} • Cantidad:{' '}
                      {reingresoModalData.articulo?.cantidad || 1} unidad(es)
                    </Text>
                    <Text style={styles.modalInfoLine}>
                      Cliente: {reingresoModalData.cliente_nombre}
                    </Text>
                  </View>

                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>ESTADO / CONDICIÓN DE REINGRESO</Text>
                    <View style={styles.condicionPillsRow}>
                      {[
                        'Como Nuevo / Reacondicionado',
                        'Buen Estado / Exhibición',
                        'Aceptable / Liquidación',
                      ].map((cond) => (
                        <TouchableOpacity
                          key={cond}
                          style={[
                            styles.condicionPill,
                            reingresoModalData.condicion === cond && styles.condicionPillActive,
                          ]}
                          onPress={() =>
                            setReingresoModalData((prev) => ({ ...prev, condicion: cond }))
                          }
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.condicionPillText,
                              reingresoModalData.condicion === cond && styles.condicionPillTextActive,
                            ]}
                          >
                            {cond}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>
                      OBSERVACIONES DE INSPECCIÓN TÉCNICA (OPCIONAL)
                    </Text>
                    <TextInput
                      style={styles.modalTextInput}
                      placeholder="Ej: Embalaje verificado, sin rayones, óptimo para exhibición..."
                      placeholderTextColor="#94A3B8"
                      value={reingresoModalData.observaciones}
                      onChangeText={(txt) =>
                        setReingresoModalData((prev) => ({ ...prev, observaciones: txt }))
                      }
                      multiline={true}
                      numberOfLines={3}
                    />
                  </View>

                  <View style={styles.modalWarningBox}>
                    <Text style={styles.modalWarningText}>
                      ⚠️ Al confirmar, la cantidad ({reingresoModalData.articulo?.cantidad || 1}) se sumará automáticamente al inventario disponible para venta en el POS y el catálogo comercial.
                    </Text>
                  </View>

                  <View style={styles.modalActionsRow}>
                    <TouchableOpacity
                      style={styles.modalCancelBtn}
                      onPress={() => setReingresoModalVisible(false)}
                      disabled={isSubmittingReingreso}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.modalCancelBtnText}>Cancelar</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.modalConfirmBtn, isSubmittingReingreso && styles.btnDisabled]}
                      onPress={handleEjecutarReingreso}
                      disabled={isSubmittingReingreso}
                      activeOpacity={0.8}
                    >
                      {isSubmittingReingreso ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <>
                          <Text style={styles.modalConfirmBtnIcon}>✓</Text>
                          <Text style={styles.modalConfirmBtnText}>Confirmar Reingreso</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </InFrameModal>

      {/* ========================================================================= */}
      {/* MODAL EN PANTALLA: FORMALIZAR ORDEN DE RETIRO (DOBLE FIRMA TÁCTIL)       */}
      {/* ========================================================================= */}
      <InFrameModal
        visible={modalRetiroVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          if (!isSubmittingRetiro) setModalRetiroVisible(false);
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: '92%' }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={[styles.modalTitle, { color: '#991B1B' }]}>
                  🚨 Orden de Retiro / Restitución
                </Text>
                <Text style={styles.modalSubtitle}>
                  {creditoRetiro?.codigo_contrato ||
                    `CTR-${String(creditoRetiro?.id_contrato || '').slice(0, 8).toUpperCase()}`}{' '}
                  • {creditoRetiro?.cliente?.nombres || creditoRetiro?.cliente_nombre || 'Cliente Titular'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setModalRetiroVisible(false)}
                disabled={isSubmittingRetiro}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.modalScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled={true}
            >
              {creditoRetiro ? (
                <>
                  {/* Alerta de Causal Legal */}
                  <View style={styles.retiroAlertBanner}>
                    <Text style={styles.retiroAlertTitle}>
                      ⚠️ DILIGENCIA DE RECUPERACIÓN PRENDARIA
                    </Text>
                    <Text style={styles.retiroAlertText}>
                      Este contrato acumula {creditoRetiro.cuotas_vencidas_count || 3} cuotas en mora vencidas (≥ 3). Procede la restitución formal de los artículos pactados con reserva de dominio según normativa comercial.
                    </Text>
                  </View>

                  {/* Ficha Resumen del Contrato */}
                  <View style={styles.retiroInfoCard}>
                    <View style={styles.retiroInfoRow}>
                      <Text style={styles.retiroInfoLabel}>Cliente Titular:</Text>
                      <Text style={styles.retiroInfoValue} numberOfLines={1}>
                        {creditoRetiro.cliente?.nombres || creditoRetiro.cliente_nombre || 'Cliente'}{' '}
                        {creditoRetiro.cliente?.apellidos || ''}
                      </Text>
                    </View>
                    <View style={styles.retiroInfoRow}>
                      <Text style={styles.retiroInfoLabel}>Cédula / Documento:</Text>
                      <Text style={styles.retiroInfoValue}>
                        {creditoRetiro.cliente?.cedula ||
                          creditoRetiro.cliente?.documento_numero ||
                          creditoRetiro.cliente_cedula ||
                          'No registrada'}
                      </Text>
                    </View>
                    <View style={styles.retiroInfoRow}>
                      <Text style={styles.retiroInfoLabel}>Ubicación Diligencia:</Text>
                      <Text style={styles.retiroInfoValue} numberOfLines={1}>
                        {creditoRetiro.cliente?.direccion
                          ? `${creditoRetiro.cliente.direccion}, ${creditoRetiro.ciudad_venta || creditoRetiro.cliente?.ciudad || 'Montería'}`
                          : creditoRetiro.ciudad_venta || 'Montería'}
                      </Text>
                    </View>
                    <View style={styles.retiroInfoRow}>
                      <Text style={styles.retiroInfoLabel}>Saldo Pendiente:</Text>
                      <Text style={[styles.retiroInfoValue, { color: '#991B1B', fontWeight: '900' }]}>
                        {formatCOP(creditoRetiro.saldo_pendiente || 0)}
                      </Text>
                    </View>
                    <View style={styles.retiroInfoRow}>
                      <Text style={styles.retiroInfoLabel}>Plazo Contractual:</Text>
                      <Text style={styles.retiroInfoValue}>
                        {creditoRetiro.numero_cuotas || 0} cuotas ({creditoRetiro.tipo_pago || 'Mensual'})
                      </Text>
                    </View>
                  </View>

                  {/* Artículos Sujetos a Restitución */}
                  <View style={styles.retiroArticulosSection}>
                    <Text style={styles.retiroSectionHeading}>
                      📦 ARTÍCULOS SUJETOS A RESTITUCIÓN
                    </Text>
                    {Array.isArray(creditoRetiro.detalles) && creditoRetiro.detalles.length > 0 ? (
                      creditoRetiro.detalles.map((d, i) => (
                        <View key={i} style={styles.retiroArticuloItem}>
                          <Text style={styles.retiroArticuloBullet}>•</Text>
                          <Text style={styles.retiroArticuloText}>
                            <Text style={{ fontWeight: 'bold' }}>{d.cantidad || 1}x </Text>
                            {d.producto?.nombre || d.descripcion || 'Artículo en contrato'}
                            {d.producto?.sku ? ` (SKU: ${d.producto.sku})` : ''}
                          </Text>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.retiroArticuloTextEmpty}>
                        Bienes muebles pactados en contrato de compraventa a crédito.
                      </Text>
                    )}
                  </View>

                  {/* Motivo Formal de Restitución */}
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>MOTIVO FORMAL DE RESTITUCIÓN</Text>
                    <View style={styles.condicionPillsRow}>
                      {[
                        'Mora Crítica ≥ 3 Cuotas',
                        'Entrega Voluntaria',
                        'Incumplimiento Reiterado',
                      ].map((m) => (
                        <TouchableOpacity
                          key={m}
                          style={[
                            styles.condicionPill,
                            motivoRetiro.startsWith(m) && styles.condicionPillActive,
                          ]}
                          onPress={() => {
                            const cuotas = creditoRetiro.cuotas_vencidas_count || 3;
                            if (m === 'Mora Crítica ≥ 3 Cuotas') {
                              setMotivoRetiro(
                                `Incumplimiento grave de pago con acumulación de ${cuotas} cuotas morosas vencidas (Causal de restitución prendaria).`
                              );
                            } else if (m === 'Entrega Voluntaria') {
                              setMotivoRetiro(
                                'Entrega voluntaria formal de bienes muebles por imposibilidad económica manifiesta del deudor.'
                              );
                            } else {
                              setMotivoRetiro(
                                `Incumplimiento de acuerdo de pago en ${cuotas} cuotas consecutivas y recuperación preventiva.`
                              );
                            }
                          }}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.condicionPillText,
                              motivoRetiro.startsWith(m) && styles.condicionPillTextActive,
                            ]}
                          >
                            {m}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TextInput
                      style={[styles.modalTextInput, { minHeight: 46, marginTop: 8 }]}
                      placeholder="Especifique el motivo legal de la restitución..."
                      placeholderTextColor="#94A3B8"
                      value={motivoRetiro}
                      onChangeText={setMotivoRetiro}
                      multiline={true}
                      editable={!isSubmittingRetiro}
                    />
                  </View>

                  {/* Observaciones / Estado de los Bienes */}
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>OBSERVACIONES / ESTADO DE LOS BIENES</Text>
                    <TextInput
                      style={[styles.modalTextInput, { minHeight: 60 }]}
                      placeholder="Detalle estado de conservación, accesorios devueltos o notas de la diligencia..."
                      placeholderTextColor="#94A3B8"
                      value={observacionesRetiro}
                      onChangeText={setObservacionesRetiro}
                      multiline={true}
                      editable={!isSubmittingRetiro}
                    />
                  </View>

                  {/* Firma 1: Cliente Titular */}
                  <View style={styles.signatureWrap}>
                    <SignatureCanvas
                      label="Firma de Entrega del Cliente Titular"
                      subtitle="El cliente firma en conformidad de entrega voluntaria de los bienes"
                      obligatorio={true}
                      signerName={
                        creditoRetiro.cliente?.nombres ||
                        creditoRetiro.cliente?.nombre_completo ||
                        creditoRetiro.cliente_nombre ||
                        'Cliente Titular'
                      }
                      signerDoc={
                        creditoRetiro.cliente?.cedula ||
                        creditoRetiro.cliente?.documento_numero ||
                        creditoRetiro.cliente_cedula ||
                        ''
                      }
                      value={firmaClienteRetiro}
                      onChange={setFirmaClienteRetiro}
                      height={125}
                    />
                  </View>

                  {/* Firma 2: Supervisor / Gestor de Cobro */}
                  <View style={styles.signatureWrap}>
                    <SignatureCanvas
                      label="Firma del Supervisor de Operaciones"
                      subtitle="Firme para certificar la recepción en custodia de los bienes muebles"
                      obligatorio={true}
                      signerName={supervisorNombre || 'Supervisor de Operaciones'}
                      signerDoc="Supervisor de Operaciones / Remundial Core"
                      value={firmaSupervisorRetiro}
                      onChange={setFirmaSupervisorRetiro}
                      height={125}
                    />
                  </View>

                  {/* Botones de Confirmación y Cancelación */}
                  <View style={styles.modalActionsRow}>
                    <TouchableOpacity
                      style={styles.modalCancelBtn}
                      onPress={() => setModalRetiroVisible(false)}
                      disabled={isSubmittingRetiro}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.modalCancelBtnText}>Cancelar</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.confirmRetiroBtn,
                        { flex: 2, marginTop: 0 },
                        isSubmittingRetiro && styles.btnDisabled,
                      ]}
                      onPress={handleConfirmarOrdenRetiro}
                      disabled={isSubmittingRetiro}
                      activeOpacity={isSubmittingRetiro ? 1 : 0.8}
                    >
                      {isSubmittingRetiro ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <ActivityIndicator size="small" color="#FFFFFF" />
                          <Text style={styles.confirmPaymentBtnText}>Generando Acta...</Text>
                        </View>
                      ) : (
                        <Text style={styles.confirmPaymentBtnText}>
                          🚨 Confirmar y Generar Acta PDF
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </InFrameModal>

      {/* ========================================================================= */}
      {/* MODAL DE ACTA DE RESTITUCIÓN EXITOSA                                      */}
      {/* ========================================================================= */}
      <InFrameModal
        visible={modalActaExitosaVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setModalActaExitosaVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.receiptCard, { borderTopColor: '#991B1B' }]}>
            {/* Header del comprobante de retiro */}
            <View style={styles.receiptSuccessHeader}>
              <View style={[styles.receiptIconSuccess, { backgroundColor: '#FEE2E2' }]}>
                <Text style={{ fontSize: 24 }}>🚨</Text>
              </View>
              <Text style={[styles.receiptTitleSuccess, { color: '#991B1B' }]}>
                ¡Acta de Restitución Generada!
              </Text>
              <Text style={styles.receiptSubtitleSuccess}>
                Orden de retiro registrada con doble firma digital inmutable
              </Text>
            </View>

            {/* Ficha Resumen */}
            <View style={styles.receiptSummaryBlock}>
              <View style={styles.receiptSummaryRow}>
                <Text style={styles.receiptSummaryLabel}>Contrato:</Text>
                <Text style={styles.receiptSummaryValue}>{actaGenerada?.numero_contrato}</Text>
              </View>
              <View style={styles.receiptSummaryRow}>
                <Text style={styles.receiptSummaryLabel}>Cliente:</Text>
                <Text style={styles.receiptSummaryValue}>{actaGenerada?.cliente_nombre}</Text>
              </View>
              <View style={styles.receiptSummaryRow}>
                <Text style={styles.receiptSummaryLabel}>Cuotas en Mora:</Text>
                <Text style={[styles.receiptSummaryValue, { color: '#991B1B', fontWeight: 'bold' }]}>
                  {actaGenerada?.cuotas_vencidas} Cuotas Vencidas
                </Text>
              </View>
              <View style={styles.receiptSummaryRow}>
                <Text style={styles.receiptSummaryLabel}>Saldo Insoluto:</Text>
                <Text style={styles.receiptSummaryValue}>
                  {formatCOP(actaGenerada?.saldo_pendiente || 0)}
                </Text>
              </View>
              <View style={styles.receiptSummaryRow}>
                <Text style={styles.receiptSummaryLabel}>Fecha y Hora Local:</Text>
                <Text style={styles.receiptSummaryValue}>{actaGenerada?.fecha_acta}</Text>
              </View>
            </View>

            {/* Acciones */}
            <View style={styles.receiptActionsWrapper}>
              <TouchableOpacity
                style={[styles.receiptDownloadBtn, { backgroundColor: '#991B1B' }]}
                onPress={() =>
                  handleDescargarActaPdf(actaGenerada?.id_contrato, actaGenerada?.numero_contrato)
                }
                activeOpacity={0.8}
              >
                <Text style={styles.receiptDownloadBtnText}>
                  📄 Ver / Descargar Acta de Retiro (PDF)
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.receiptCustodiaBtn}
                onPress={() => {
                  setModalActaExitosaVisible(false);
                  setActiveTab('custodia');
                  setExpandedCustodiaIndex(0);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.receiptCustodiaBtnText}>
                  📦 Ir a Artículos en Custodia →
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.receiptCloseBtn}
                onPress={() => setModalActaExitosaVisible(false)}
              >
                <Text style={styles.receiptCloseBtnText}>Cerrar</Text>
              </TouchableOpacity>
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
    backgroundColor: '#0F172A',
  },
  header: {
    backgroundColor: '#0F172A',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    gap: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  backBtnText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 22,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#FDA4AF',
    marginTop: 1,
    fontWeight: '600',
  },
  refreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  refreshBtnText: {
    fontSize: 16,
    color: '#FDA4AF',
    fontWeight: '700',
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: '#0F172A',
    gap: 10,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  tabButtonActiveCritica: {
    backgroundColor: '#E11D48',
    borderColor: '#F43F5E',
  },
  tabButtonActiveCustodia: {
    backgroundColor: '#D97706',
    borderColor: '#F59E0B',
  },
  tabText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#94A3B8',
  },
  tabTextActiveCritica: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  tabTextActiveCustodia: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  custodiaBanner: {
    backgroundColor: '#78350F',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#B45309',
  },
  custodiaBannerTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#FDE68A',
    letterSpacing: 0.8,
  },
  custodiaCardExpanded: {
    borderColor: '#F59E0B',
    backgroundColor: '#FFFFFF',
  },
  custodiaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    gap: 5,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  custodiaPulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D97706',
  },
  custodiaBadgeText: {
    color: '#B45309',
    fontSize: 10.5,
    fontWeight: '800',
  },
  reingresadoBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  reingresadoBadgeText: {
    color: '#065F46',
    fontSize: 10.5,
    fontWeight: '800',
  },
  custodiaMontoHighlight: {
    fontSize: 14,
    fontWeight: '900',
    color: '#B45309',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  motivoText: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 3,
    fontWeight: '500',
  },
  observacionesText: {
    fontSize: 11,
    color: '#475569',
    fontStyle: 'italic',
    marginTop: 2,
  },
  articulosSection: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  articulosSectionTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  articuloItemCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  articuloItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  articuloNombre: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  articuloSku: {
    fontSize: 10.5,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '600',
  },
  artCustodiaPill: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  artCustodiaPillText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#B45309',
  },
  artReingresadoPill: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  artReingresadoPillText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#065F46',
  },
  artReingresadoMeta: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  artReingresadoMetaText: {
    fontSize: 10,
    color: '#059669',
    fontWeight: '700',
  },
  artReingresadoObs: {
    fontSize: 10,
    color: '#64748B',
    fontStyle: 'italic',
    marginTop: 1,
  },
  btnReingresarArticulo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#059669',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginTop: 8,
    gap: 6,
  },
  btnReingresarIcon: {
    fontSize: 12,
    color: '#FFFFFF',
  },
  btnReingresarText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  btnActaPdf: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E293B',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  btnActaPdfIcon: {
    fontSize: 13,
  },
  btnActaPdfText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '800',
  },
  alertBanner: {
    backgroundColor: '#FFF1F2',
    borderBottomWidth: 1,
    borderBottomColor: '#FECDD3',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  alertBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  alertBannerIcon: {
    fontSize: 14,
  },
  alertBannerTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#BE123C',
    letterSpacing: 0.8,
  },
  alertBannerBody: {
    fontSize: 11,
    color: '#881337',
    lineHeight: 15,
    marginBottom: 10,
  },
  alertStatsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  alertStatPill: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#FECDD3',
  },
  alertStatLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#9F1239',
    letterSpacing: 0.4,
  },
  alertStatVal: {
    fontSize: 13,
    fontWeight: '900',
    color: '#0F172A',
    marginTop: 1,
  },
  searchContainer: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
  },
  searchIcon: {
    fontSize: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '600',
    paddingVertical: 0,
  },
  clearBtnText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '800',
    padding: 4,
  },
  listContent: {
    padding: 16,
    gap: 14,
    backgroundColor: '#F8FAFC',
  },
  alertCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FECDD3',
    borderLeftWidth: 5,
    borderLeftColor: '#E11D48',
    shadowColor: '#BE123C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  alertCardExpanded: {
    borderColor: '#E11D48',
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  accordionHeaderTouchable: {
    paddingVertical: 2,
  },
  headerRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  accordionChevronText: {
    fontSize: 12,
    color: '#E11D48',
    fontWeight: '800',
    paddingHorizontal: 4,
  },
  accordionSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  moraMontoHighlight: {
    fontSize: 14,
    fontWeight: '900',
    color: '#BE123C',
  },
  accordionExpandedContent: {
    marginTop: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  contratoBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  contratoText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F172A',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  alertaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFF1F2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FECDD3',
  },
  alertaPulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E11D48',
  },
  alertaBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#BE123C',
  },
  cardBody: {
    marginBottom: 10,
  },
  clienteNombre: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 2,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  docText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  dotSeparator: {
    color: '#CBD5E1',
    fontSize: 10,
  },
  cityText: {
    fontSize: 11,
    color: '#059669',
    fontWeight: '700',
  },
  criticalStatsBox: {
    flexDirection: 'row',
    backgroundColor: '#FFF1F2',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#FFE4E6',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  statCol: {
    alignItems: 'center',
    flex: 1,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#FECDD3',
  },
  statLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  diasMoraText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#BE123C',
  },
  totalVencidoText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#BE123C',
  },
  saldoTotalText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  cobradorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  cobradorLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  cobradorValue: {
    fontSize: 11,
    color: '#0F172A',
    fontWeight: '700',
  },
  cardActionsRow: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  btnDetalle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
  },
  btnDetalleIcon: {
    fontSize: 12,
  },
  btnDetalleText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  btnLlamar: {
    flex: 1.3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#BE123C',
    paddingVertical: 9,
    borderRadius: 10,
    gap: 6,
  },
  btnDisabled: {
    backgroundColor: '#CBD5E1',
  },
  btnLlamarIcon: {
    fontSize: 12,
  },
  btnLlamarText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: '#E11D48',
    fontWeight: '700',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  // ESTILOS MODAL DETALLE
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxHeight: '80%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingBottom: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSubtitle: {
    fontSize: 11,
    color: '#E11D48',
    fontWeight: '700',
    marginTop: 1,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#64748B',
  },
  modalScroll: {
    maxHeight: '100%',
  },
  modalSection: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  modalSectionTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  modalClienteName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  modalInfoLine: {
    fontSize: 12,
    color: '#475569',
    marginBottom: 2,
    fontWeight: '500',
  },
  modalGrid2: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  modalGridItem: {
    width: '47%',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  modalGridLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#64748B',
    marginBottom: 2,
  },
  modalGridValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalCallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
    marginTop: 6,
    marginBottom: 10,
  },
  modalCallIcon: {
    fontSize: 14,
  },
  modalCallText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  // ESTILOS MODAL REINGRESO A STOCK
  modalSubtitleCustodia: {
    fontSize: 11,
    color: '#D97706',
    fontWeight: '700',
    marginTop: 1,
  },
  condicionPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  condicionPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  condicionPillActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  condicionPillText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#475569',
  },
  condicionPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  modalTextInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    padding: 10,
    fontSize: 12,
    color: '#0F172A',
    textAlignVertical: 'top',
    minHeight: 60,
  },
  modalWarningBox: {
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginBottom: 12,
  },
  modalWarningText: {
    fontSize: 11,
    color: '#92400E',
    lineHeight: 15,
    fontWeight: '600',
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
    marginBottom: 10,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  modalCancelBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  modalConfirmBtn: {
    flex: 1.6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#059669',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 6,
  },
  modalConfirmBtnIcon: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  modalConfirmBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  // ESTILOS BOTÓN EJECUTAR RETIRO EN TARJETA
  btnEjecutarRetiro: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#991B1B',
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 8,
    gap: 8,
    shadowColor: '#991B1B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  btnEjecutarRetiroIcon: {
    fontSize: 13,
  },
  btnEjecutarRetiroText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  // ESTILOS MODAL ORDEN DE RETIRO
  retiroAlertBanner: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  retiroAlertTitle: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#991B1B',
    marginBottom: 3,
  },
  retiroAlertText: {
    fontSize: 11,
    color: '#7F1D1D',
    lineHeight: 15,
  },
  retiroInfoCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
    gap: 5,
  },
  retiroInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  retiroInfoLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  retiroInfoValue: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F172A',
  },
  retiroArticulosSection: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  retiroSectionHeading: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  retiroArticuloItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  retiroArticuloBullet: {
    fontSize: 14,
    color: '#991B1B',
    fontWeight: 'bold',
  },
  retiroArticuloText: {
    fontSize: 11,
    color: '#334155',
    flex: 1,
  },
  retiroArticuloTextEmpty: {
    fontSize: 11,
    color: '#64748B',
    fontStyle: 'italic',
  },
  signatureWrap: {
    marginBottom: 8,
  },
  confirmRetiroBtn: {
    backgroundColor: '#991B1B',
    borderRadius: 12,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#991B1B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  confirmPaymentBtnText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '800',
  },
  // ESTILOS MODAL ACTA EXITOSA
  receiptCard: {
    backgroundColor: '#FFFFFF',
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderTopWidth: 6,
    padding: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  receiptSuccessHeader: {
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 14,
  },
  receiptIconSuccess: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  receiptTitleSuccess: {
    fontSize: 17,
    fontWeight: '800',
    color: '#991B1B',
    textAlign: 'center',
  },
  receiptSubtitleSuccess: {
    fontSize: 11,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 2,
    lineHeight: 15,
  },
  receiptSummaryBlock: {
    paddingVertical: 14,
    gap: 8,
  },
  receiptSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  receiptSummaryLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  receiptSummaryValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  receiptActionsWrapper: {
    gap: 8,
    marginTop: 6,
  },
  receiptDownloadBtn: {
    backgroundColor: '#991B1B',
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptDownloadBtnText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '800',
  },
  receiptCustodiaBtn: {
    backgroundColor: '#D97706',
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptCustodiaBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  receiptCloseBtn: {
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  receiptCloseBtnText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
  },
});
