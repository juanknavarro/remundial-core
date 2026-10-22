import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  StatusBar,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import apiClient, { limpiarCredencialesLocales } from '../api/client';
import InFrameModal from '../components/InFrameModal';
import {
  STORAGE_KEYS,
  CACHE_CONFIG,
  guardarEnCache,
  obtenerDeCache,
} from '../storage/database';
import { version as appVersion } from '../../package.json';

const formatCOP = (val) => {
  const num = Math.round(Number(val) || 0);
  return '$ ' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const formatearFechaOperacion = (fechaInput) => {
  if (!fechaInput) return 'Hoy';
  const d = new Date(fechaInput);
  if (isNaN(d.getTime())) return 'Reciente';
  return d.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function SupervisorDashboard({ navigation }) {
  const { user, userRole, logout } = useAuth();

  // Estados de navegación interna (Tabs inferiores)
  const [activeTab, setActiveTab] = useState('inicio'); // 'inicio' | 'cartera'
  const [menuVisible, setMenuVisible] = useState(false);

  // Estado del Modal de Confirmación de Cierre de Sesión (Estándar Corporativo)
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Estados de datos maestros
  const [creditos, setCreditos] = useState([]);
  const [abonos, setAbonos] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [cobradores, setCobradores] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Estados para asignación operativa de cobrador (Fase 1)
  const [creditoParaAsignar, setCreditoParaAsignar] = useState(null);
  const [modalAsignarVisible, setModalAsignarVisible] = useState(false);
  const [busquedaCobrador, setBusquedaCobrador] = useState('');
  const [isSavingCobrador, setIsSavingCobrador] = useState(false);

  // Estados de filtros para la pestaña Cartera
  const [filtroCartera, setFiltroCartera] = useState('todos'); // 'todos' | 'mora' | 'al_dia'
  const [busquedaCartera, setBusquedaCartera] = useState('');
  const [expandedCarteraIndex, setExpandedCarteraIndex] = useState(0);

  // Estados de Marca Blanca y Empresa
  const [empresaNombre, setEmpresaNombre] = useState("Remundial Arte's");

  // =========================================================================
  // CARGA DE DATOS ASÍNCRONA (REPLICANDO LA LÓGICA DE web/src/app/dashboard/page.tsx)
  // =========================================================================
  const cargarDatos = useCallback(async (isPullRefresh = false) => {
    if (isPullRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const [resResumen, resCreditos, resAbonos, resCobradores] = await Promise.allSettled([
        apiClient.get('/reportes/resumen-gerencial'),
        apiClient.get('/creditos'),
        apiClient.get('/abonos'),
        apiClient.get('/usuarios?rol=cobrador'),
      ]);

      if (resResumen.status === 'fulfilled' && resResumen.value?.data) {
        setResumen(resResumen.value.data);
      }

      if (resCreditos.status === 'fulfilled' && Array.isArray(resCreditos.value?.data)) {
        setCreditos(resCreditos.value.data);
        guardarEnCache(STORAGE_KEYS.CACHE_CREDITOS, resCreditos.value.data);
      } else {
        const cachedCreditos = await obtenerDeCache(STORAGE_KEYS.CACHE_CREDITOS);
        if (Array.isArray(cachedCreditos)) {
          setCreditos(cachedCreditos);
        }
      }

      if (resAbonos.status === 'fulfilled' && Array.isArray(resAbonos.value?.data)) {
        setAbonos(resAbonos.value.data);
        guardarEnCache(STORAGE_KEYS.CACHE_ABONOS, resAbonos.value.data);
      } else {
        const cachedAbonos = await obtenerDeCache(STORAGE_KEYS.CACHE_ABONOS);
        if (Array.isArray(cachedAbonos)) {
          setAbonos(cachedAbonos);
        }
      }

      if (resCobradores.status === 'fulfilled' && Array.isArray(resCobradores.value?.data)) {
        setCobradores(resCobradores.value.data);
      } else {
        try {
          const resUsers = await apiClient.get('/usuarios');
          if (Array.isArray(resUsers.data)) {
            setCobradores(resUsers.data.filter((u) => u.rol === 'cobrador'));
          }
        } catch (_) {}
      }
    } catch (err) {
      console.warn('[SupervisorDashboard] Error consultando métricas:', err);
      // Fallback a caché local en modo offline
      const [cachedCreditos, cachedAbonos] = await Promise.all([
        obtenerDeCache(STORAGE_KEYS.CACHE_CREDITOS),
        obtenerDeCache(STORAGE_KEYS.CACHE_ABONOS),
      ]);
      if (Array.isArray(cachedCreditos)) setCreditos(cachedCreditos);
      if (Array.isArray(cachedAbonos)) setAbonos(cachedAbonos);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const cargarConfigYDatos = async () => {
      try {
        const cached = await AsyncStorage.getItem(CACHE_CONFIG);
        if (cached && isMounted) {
          const cfg = JSON.parse(cached);
          if (cfg.empresa?.razon_social) {
            setEmpresaNombre(cfg.empresa.razon_social);
          }
        }
      } catch (err) {
        console.warn('[SupervisorDashboard] Error cargando caché de configuración:', err);
      }
      if (isMounted) {
        cargarDatos();
      }
    };

    cargarConfigYDatos();

    return () => {
      isMounted = false;
    };
  }, [cargarDatos]);

  // =========================================================================
  // CÁLCULO DE KPIS GERENCIALES (TOTAL RECAUDADO HOY, CRÉDITOS ACTIVOS, MORA)
  // =========================================================================
  const metrics = useMemo(() => {
    // 1. Recaudos del día (Abonos registrados en la fecha actual)
    const hoyStr = new Date().toISOString().split('T')[0];
    const abonosHoy = abonos.filter((a) => {
      if (!a.fecha || a.estado === 'anulado') return false;
      const abonoFechaStr = new Date(a.fecha).toISOString().split('T')[0];
      return abonoFechaStr === hoyStr;
    });

    const totalRecaudosHoy =
      resumen?.total_recaudado_hoy ??
      abonosHoy.reduce((sum, a) => sum + Number(a.valor_abonado || 0), 0);
    const countAbonosHoy = resumen?.count_abonos_hoy ?? abonosHoy.length;

    // 2. Créditos activos y saldo total de cartera
    const creditosActivos = creditos.filter((c) => c.estado === 'activo');
    const countActivos = resumen?.creditos_activos_count ?? creditosActivos.length;
    const saldoTotalCartera =
      resumen?.saldo_total_cartera ??
      creditosActivos.reduce((sum, c) => sum + Number(c.saldo_pendiente || 0), 0);

    // 3. Cartera en mora
    let totalMora = 0;
    let countMora = 0;

    if (resumen?.cartera_en_mora) {
      totalMora = Number(resumen.cartera_en_mora.saldo_insoluto_mora || 0);
      countMora = Number(resumen.cartera_en_mora.contratos_mora_count || 0);
    } else {
      creditos.forEach((c) => {
        if (c.estado === 'pendiente' || Number(c.saldo_pendiente || 0) <= 0) return;

        let cuotasVencidas = 0;
        let saldoVencido = 0;

        if (Array.isArray(c.cronograma_cuotas) && c.cronograma_cuotas.length > 0) {
          c.cronograma_cuotas.forEach((q) => {
            if (q.estado === 'vencida') {
              cuotasVencidas += 1;
              saldoVencido += Number(q.saldo_cuota ?? q.valor_exigible ?? 0);
            }
          });
        } else if (c.cuotas_vencidas_count && c.cuotas_vencidas_count > 0) {
          cuotasVencidas = Number(c.cuotas_vencidas_count);
          saldoVencido = Math.min(
            Number(c.saldo_pendiente || 0),
            Number(c.valor_cuota || 0) * cuotasVencidas
          );
        }

        if (cuotasVencidas > 0) {
          countMora += 1;
          totalMora += saldoVencido;
        }
      });
    }

    return {
      totalRecaudosHoy,
      countAbonosHoy,
      countActivos,
      saldoTotalCartera,
      countMora,
      totalMora,
    };
  }, [creditos, abonos, resumen]);

  // =========================================================================
  // OPERACIONES RECIENTES UNIFICADAS (ABONOS + VENTAS ORIGINADAS)
  // =========================================================================
  const operacionesRecientes = useMemo(() => {
    const listado = [];

    // Abonos
    abonos.forEach((a) => {
      const ciudadAbono = a.ciudad || a.ciudad_venta || null;
      listado.push({
        id: `abono-${a.id_recibo}`,
        contrato: a.credito_id ? `CTR-${String(a.credito_id).slice(0, 8).toUpperCase()}` : 'CTR-RECIBO',
        cliente: a.cliente_nombre || 'Cliente Titular',
        tipo: 'Abono de Cuota',
        responsable: a.cobrador?.nombre || a.cobrador_nombre || 'Cobrador en Ruta',
        valor: Number(a.valor_abonado || 0),
        sector: ciudadAbono || 'Ruta de Cobro',
        estado: a.estado === 'conciliado' ? 'conciliado' : 'completado',
        fecha: new Date(a.fecha || a.creado_en || Date.now()),
        esAbono: true,
      });
    });

    // Créditos
    creditos.forEach((c) => {
      const ciudadCredito = c.ciudad_venta || c.cliente?.ciudad || c.cliente?.barrio;
      listado.push({
        id: `credito-${c.id_contrato}`,
        contrato: `CTR-${String(c.id_contrato).slice(0, 8).toUpperCase()}`,
        cliente: c.cliente?.nombres || 'Cliente Titular',
        tipo: c.estado === 'pendiente' ? 'Solicitud de Crédito' : 'Venta Originada',
        responsable: c.vendedor?.nombre || 'Asesor Comercial',
        valor: Number(c.monto_financiado || 0) + Number(c.cuota_inicial || 0),
        sector: ciudadCredito || 'Punto de Venta',
        estado: c.estado,
        fecha: new Date(c.creado_en || Date.now()),
        esAbono: false,
      });
    });

    // Ordenar de más reciente a más antiguo
    listado.sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
    return listado.slice(0, 8);
  }, [creditos, abonos]);

  // =========================================================================
  // FILTRADO DE CARTERA PARA LA PESTAÑA CARTERA
  // =========================================================================
  const creditosFiltrados = useMemo(() => {
    return creditos.filter((c) => {
      // 1. Filtro por estado de cartera
      const cuotasVencidas = Number(c.cuotas_vencidas_count || 0);
      const enMora = cuotasVencidas > 0 || c.es_cartera_critica;

      if (filtroCartera === 'mora' && !enMora) return false;
      if (filtroCartera === 'al_dia' && (enMora || c.estado !== 'activo')) return false;

      // 2. Filtro de búsqueda textual
      if (busquedaCartera.trim()) {
        const query = busquedaCartera.trim().toLowerCase();
        const nom = (c.cliente?.nombres || c.cliente?.nombre_completo || '').toLowerCase();
        const ced = (c.cliente?.cedula || '').toLowerCase();
        const numContrato = String(c.id_contrato || c.codigo_contrato || '').toLowerCase();
        const ciudad = String(c.ciudad_venta || c.cliente?.ciudad || '').toLowerCase();

        return (
          nom.includes(query) ||
          ced.includes(query) ||
          numContrato.includes(query) ||
          ciudad.includes(query)
        );
      }

      return true;
    });
  }, [creditos, filtroCartera, busquedaCartera]);

  // ==========================================
  // GESTIÓN DE CIERRE DE SESIÓN SEGURO Y CONFIRMACIÓN PERSONALIZADA
  // ==========================================
  const handleCerrarSesion = () => {
    setMenuVisible(false);
    setShowLogoutModal(true);
  };

  const handleConfirmLogout = async () => {
    try {
      setShowLogoutModal(false);
      // 1. Limpieza profunda y exhaustiva en AsyncStorage, localStorage/sessionStorage y Axios
      await limpiarCredencialesLocales();
      // 2. Destruir sesión en el contexto global
      await logout();
      // 3. Redirección forzosa e inmediata a la pantalla de Login
      try {
        if (navigation?.reset) {
          navigation.reset({
            index: 0,
            routes: [{ name: 'Login' }],
          });
        } else if (navigation?.navigate) {
          navigation.navigate('Login');
        }
      } catch (_) {}
    } catch (error) {
      console.error('[SupervisorDashboard] Error al destruir sesión:', error);
      await logout();
      try {
        if (navigation?.navigate) {
          navigation.navigate('Login');
        }
      } catch (_) {}
    }
  };

  const handleNavegarMenu = (screenName) => {
    setMenuVisible(false);
    if (screenName) {
      navigation.navigate(screenName);
    }
  };

  const handleLlamarCliente = (telefono) => {
    if (!telefono) {
      Alert.alert('Contacto no disponible', 'El cliente no tiene teléfono registrado.');
      return;
    }
    Linking.openURL(`tel:${telefono}`).catch(() => {
      Alert.alert('Error', 'No es posible realizar llamadas desde este dispositivo.');
    });
  };

  // =========================================================================
  // GESTIÓN DE ASIGNACIÓN OPERATIVA DE COBRADOR (FASE 1)
  // =========================================================================
  const cobradoresFiltrados = useMemo(() => {
    if (!busquedaCobrador.trim()) return cobradores;
    const q = busquedaCobrador.trim().toLowerCase();
    return cobradores.filter(
      (c) =>
        (c.nombre || '').toLowerCase().includes(q) ||
        (c.cedula || '').toLowerCase().includes(q) ||
        (c.telefono || '').toLowerCase().includes(q)
    );
  }, [cobradores, busquedaCobrador]);

  const handleAbrirAsignacion = (item) => {
    setCreditoParaAsignar(item);
    setBusquedaCobrador('');
    setModalAsignarVisible(true);
  };

  const handleEjecutarAsignacion = async (cobradorSeleccionado) => {
    if (!creditoParaAsignar) return;
    setIsSavingCobrador(true);
    try {
      const targetCobradorId = cobradorSeleccionado ? cobradorSeleccionado.id : null;
      await apiClient.patch(`/creditos/${creditoParaAsignar.id_contrato}`, {
        cobrador_id: targetCobradorId,
      });

      const cobradorActualizado = cobradorSeleccionado
        ? {
            id: cobradorSeleccionado.id,
            nombre: cobradorSeleccionado.nombre,
            telefono: cobradorSeleccionado.telefono,
            rol: cobradorSeleccionado.rol,
          }
        : null;

      // Actualizar estado local reactivamente
      setCreditos((prev) => {
        const updated = prev.map((c) => {
          if (c.id_contrato === creditoParaAsignar.id_contrato) {
            return {
              ...c,
              cobrador_id: targetCobradorId,
              cobrador: cobradorActualizado,
              cobrador_nombre: cobradorActualizado ? cobradorActualizado.nombre : null,
            };
          }
          return c;
        });
        guardarEnCache(STORAGE_KEYS.CACHE_CREDITOS, updated);
        return updated;
      });

      setModalAsignarVisible(false);
      setCreditoParaAsignar(null);
      if (Platform.OS === 'web') {
        alert(`Cobrador ${cobradorSeleccionado ? `"${cobradorSeleccionado.nombre}" asignado` : 'removido'} correctamente.`);
      } else {
        Alert.alert(
          'Asignación Exitosa',
          `Cobrador ${cobradorSeleccionado ? `"${cobradorSeleccionado.nombre}" asignado` : 'removido'} a la ruta del contrato.`
        );
      }
    } catch (error) {
      console.error('Error asignando cobrador:', error);
      const msg = error.response?.data?.detail || error.message || 'Error al asignar cobrador';
      if (Platform.OS === 'web') {
        alert('Error: ' + msg);
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setIsSavingCobrador(false);
    }
  };

  // =========================================================================
  // COMPONENTE TARJETA DE CARTERA (PATRÓN ACORDEÓN INTERACTIVO)
  // =========================================================================
  const renderCarteraCard = ({ item, index }) => {
    const isExpanded = index === expandedCarteraIndex;
    const contratoCodigo = item.id_contrato
      ? `CTR-${String(item.id_contrato).slice(0, 8).toUpperCase()}`
      : 'CTR-ACTIVO';
    const clienteNombre = item.cliente?.nombres || item.cliente?.nombre_completo || 'Cliente Titular';
    const sectorCiudad = item.ciudad_venta || item.cliente?.ciudad || item.cliente?.barrio || 'Sede Principal';
    const cuotasVencidas = Number(item.cuotas_vencidas_count || 0);
    const esMora = cuotasVencidas > 0 || item.es_cartera_critica;
    const telefono = item.cliente?.telefono;
    const cobradorNombreActual = item.cobrador?.nombre || item.cobrador_nombre;

    return (
      <View style={[styles.carteraCardItem, isExpanded && styles.carteraCardItemExpanded]}>
        {/* Cabecera Interactiva del Acordeón */}
        <TouchableOpacity
          style={styles.carteraHeaderTouchable}
          onPress={() => setExpandedCarteraIndex(isExpanded ? -1 : index)}
          activeOpacity={0.7}
        >
          <View style={styles.carteraCardHeader}>
            <View style={styles.contratoBadge}>
              <Text style={styles.contratoBadgeText}>{contratoCodigo}</Text>
            </View>

            <View style={styles.carteraHeaderRightGroup}>
              {esMora ? (
                <View style={styles.moraBadge}>
                  <Text style={styles.moraBadgeText}>
                    ⚠️ Mora ({cuotasVencidas})
                  </Text>
                </View>
              ) : (
                <View style={styles.alDiaBadge}>
                  <Text style={styles.alDiaBadgeText}>✓ Al Día</Text>
                </View>
              )}
              <Text style={styles.carteraChevronText}>
                {isExpanded ? '▲' : '▼'}
              </Text>
            </View>
          </View>

          {/* Resumen Permanente en Cabecera: Cliente y Saldo */}
          <View style={styles.carteraSummaryRow}>
            <Text style={styles.carteraClienteNombre} numberOfLines={1}>
              {clienteNombre}
            </Text>
            <Text
              style={[
                styles.carteraSummarySaldo,
                esMora ? styles.carteraFinanzaValorMora : styles.carteraFinanzaValorOk,
              ]}
            >
              {formatCOP(item.saldo_pendiente)}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Cuerpo Expandido del Acordeón (index === expandedCarteraIndex) */}
        {isExpanded ? (
          <View style={styles.carteraExpandedContent}>
            {/* Ubicación y Documento */}
            <View style={styles.carteraCiudadRow}>
              <Text style={styles.carteraPinIcon}>📍</Text>
              <Text style={styles.carteraCiudadText}>{sectorCiudad}</Text>
              {item.cliente?.cedula ? (
                <Text style={styles.carteraCedulaText}>• CC {item.cliente.cedula}</Text>
              ) : null}
            </View>

            {/* Indicador de Cobrador Asignado y Botón de Asignación Operativa */}
            <View style={styles.carteraCobradorRow}>
              <View style={styles.carteraCobradorLeft}>
                <Text style={styles.carteraCobradorLabel}>COBRADOR EN RUTA</Text>
                <View style={styles.carteraCobradorBadge}>
                  <Text style={styles.carteraCobradorIcon}>🛵</Text>
                  <Text style={styles.carteraCobradorNombre} numberOfLines={1}>
                    {cobradorNombreActual || 'Sin Asignar'}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.carteraAsignarBtn}
                onPress={() => handleAbrirAsignacion(item)}
                activeOpacity={0.8}
              >
                <Text style={styles.carteraAsignarBtnIcon}>⇄</Text>
                <Text style={styles.carteraAsignarBtnText}>
                  {cobradorNombreActual || item.cobrador_id ? 'Reasignar' : 'Asignar'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Desglose Financiero (Monto y Cuotas) */}
            <View style={styles.carteraFinanzasRow}>
              <View style={styles.carteraFinanzaCol}>
                <Text style={styles.carteraFinanzaLabel}>SALDO PENDIENTE</Text>
                <Text
                  style={[
                    styles.carteraFinanzaValor,
                    esMora ? styles.carteraFinanzaValorMora : styles.carteraFinanzaValorOk,
                  ]}
                >
                  {formatCOP(item.saldo_pendiente)}
                </Text>
              </View>

              <View style={styles.carteraFinanzaCol}>
                <Text style={styles.carteraFinanzaLabel}>VALOR CUOTA</Text>
                <Text style={styles.carteraFinanzaValorSec}>
                  {formatCOP(item.valor_cuota)}
                </Text>
              </View>

              <View style={styles.carteraFinanzaCol}>
                <Text style={styles.carteraFinanzaLabel}>PLAZO</Text>
                <Text style={styles.carteraFinanzaValorSec}>
                  {item.numero_cuotas || 4} cuotas
                </Text>
              </View>
            </View>

            {/* Acciones Rápidas */}
            {telefono ? (
              <View style={styles.carteraCardFooter}>
                <TouchableOpacity
                  style={styles.carteraActionBtn}
                  onPress={() => handleLlamarCliente(telefono)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.carteraActionBtnIcon}>📞</Text>
                  <Text style={styles.carteraActionBtnText}>Llamar ({telefono})</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.carteraActionBtn, styles.carteraActionBtnWs]}
                  onPress={() => Linking.openURL(`https://wa.me/57${telefono}`)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.carteraActionBtnIcon}>💬</Text>
                  <Text style={styles.carteraActionBtnText}>WhatsApp</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />

      {/* HEADER SUPERIOR TIPO BANCA */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.avatarBadge}>
            <Text style={styles.avatarText}>
              {user?.nombre
                ? user.nombre
                    .split(' ')
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()
                : 'SP'}
            </Text>
          </View>
          <View>
            <Text style={styles.greetingText}>
              Hola, {user?.nombre ? user.nombre.split(' ')[0] : 'Supervisor'}
            </Text>
            <View style={styles.roleContainer}>
              <View style={styles.roleDot} />
              <Text style={styles.roleText}>
                {userRole ? userRole.toUpperCase() : 'SUPERVISOR'} • {empresaNombre}
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={styles.headerActionBtn}
          onPress={() => setMenuVisible(true)}
          accessibilityLabel="Abrir menú de opciones"
        >
          <Text style={styles.headerActionIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {/* CUERPO PRINCIPAL CONDICIONAL SEGÚN activeTab */}
      <View style={styles.mainContainer}>
        {activeTab === 'inicio' ? (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={() => cargarDatos(true)}
                colors={['#059669']}
                tintColor="#059669"
              />
            }
          >
            {/* ========================================================================= */}
            {/* HERO CARD NEOBANCO: TOTAL RECAUDADO HOY */}
            {/* ========================================================================= */}
            <View style={styles.heroNeobankCard}>
              <View style={styles.heroBadgeRow}>
                <View style={styles.liveIndicator}>
                  <View style={styles.livePulse} />
                  <Text style={styles.liveText}>OPERACIÓN EN VIVO</Text>
                </View>
                <Text style={styles.versionBadge}>v{appVersion}</Text>
              </View>

              <Text style={styles.heroCardHeaderLabel}>TOTAL RECAUDADO HOY</Text>
              <Text style={styles.heroBigAmount}>
                {formatCOP(metrics.totalRecaudosHoy)}
              </Text>

              <View style={styles.heroSubstatsRow}>
                <View style={styles.heroSubstatPill}>
                  <Text style={styles.heroSubstatDot}>•</Text>
                  <Text style={styles.heroSubstatText}>
                    {metrics.countAbonosHoy} {metrics.countAbonosHoy === 1 ? 'recaudo procesado' : 'recaudos procesados'}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.heroRefreshInline}
                  onPress={() => cargarDatos(true)}
                  disabled={isRefreshing}
                >
                  <Text style={styles.heroRefreshText}>
                    {isRefreshing ? 'Actualizando...' : '↻ Refrescar'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* ========================================================================= */}
            {/* CARDS DE RESUMEN EJECUTIVO (CRÉDITOS ACTIVOS & MORA) */}
            {/* ========================================================================= */}
            <View style={styles.kpiRow}>
              {/* Tarjeta 1: Créditos Activos */}
              <TouchableOpacity
                style={styles.kpiCard}
                onPress={() => {
                  setFiltroCartera('al_dia');
                  setActiveTab('cartera');
                }}
                activeOpacity={0.8}
              >
                <View style={styles.kpiIconWrapBlue}>
                  <Text style={styles.kpiIcon}>📑</Text>
                </View>
                <Text style={styles.kpiCardLabel}>CRÉDITOS ACTIVOS</Text>
                <Text style={styles.kpiCardCount}>{metrics.countActivos}</Text>
                <Text style={styles.kpiCardSubValue}>
                  Saldo: {formatCOP(metrics.saldoTotalCartera)}
                </Text>
              </TouchableOpacity>

              {/* Tarjeta 2: Cartera en Mora */}
              <TouchableOpacity
                style={[styles.kpiCard, styles.kpiCardRose]}
                onPress={() => {
                  setFiltroCartera('mora');
                  setActiveTab('cartera');
                }}
                activeOpacity={0.8}
              >
                <View style={styles.kpiIconWrapRose}>
                  <Text style={styles.kpiIcon}>⚠️</Text>
                </View>
                <Text style={[styles.kpiCardLabel, { color: '#9F1239' }]}>CARTERA EN MORA</Text>
                <Text style={[styles.kpiCardCount, { color: '#BE123C' }]}>
                  {metrics.countMora}
                </Text>
                <Text style={[styles.kpiCardSubValue, { color: '#E11D48' }]}>
                  {formatCOP(metrics.totalMora)} en riesgo
                </Text>
              </TouchableOpacity>
            </View>

            {/* ========================================================================= */}
            {/* ACCESO RÁPIDO A POS */}
            {/* ========================================================================= */}
            <TouchableOpacity
              style={styles.bannerPosAction}
              onPress={() => navigation.navigate('NuevaVenta')}
              activeOpacity={0.85}
            >
              <View style={styles.bannerPosLeft}>
                <View style={styles.bannerPosIconBadge}>
                  <Text style={styles.bannerPosIcon}>🛍️</Text>
                </View>
                <View>
                  <Text style={styles.bannerPosTitle}>Originar Venta POS</Text>
                  <Text style={styles.bannerPosSubtitle}>Radicar nuevo crédito o venta de contado</Text>
                </View>
              </View>
              <Text style={styles.bannerPosArrow}>→</Text>
            </TouchableOpacity>

            {/* ========================================================================= */}
            {/* OPERACIONES RECIENTES EN TERRENO */}
            {/* ========================================================================= */}
            <View style={styles.recentSectionHeader}>
              <View>
                <Text style={styles.recentTitle}>Operaciones Recientes</Text>
                <Text style={styles.recentSubtitle}>
                  Abonos y créditos originados en tiempo real
                </Text>
              </View>

              <TouchableOpacity onPress={() => setActiveTab('cartera')}>
                <Text style={styles.recentViewAll}>Ver Cartera →</Text>
              </TouchableOpacity>
            </View>

            {isLoading && !isRefreshing ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color="#059669" />
                <Text style={styles.loadingText}>Sincronizando operaciones...</Text>
              </View>
            ) : operacionesRecientes.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyIcon}>📂</Text>
                <Text style={styles.emptyTitle}>Sin operaciones recientes</Text>
                <Text style={styles.emptyText}>
                  A medida que se registren ventas o recaudos en terreno, aparecerán listados aquí.
                </Text>
              </View>
            ) : (
              <View style={styles.recentListCard}>
                {operacionesRecientes.map((op, idx) => (
                  <View
                    key={op.id}
                    style={[
                      styles.recentItemRow,
                      idx === operacionesRecientes.length - 1 && { borderBottomWidth: 0 },
                    ]}
                  >
                    <View
                      style={[
                        styles.recentItemIconCircle,
                        op.esAbono ? styles.recentIconAbono : styles.recentIconVenta,
                      ]}
                    >
                      <Text style={styles.recentItemIconText}>
                        {op.esAbono ? '💵' : '🛍️'}
                      </Text>
                    </View>

                    <View style={styles.recentItemCenter}>
                      <View style={styles.recentItemTopLine}>
                        <Text style={styles.recentItemCliente} numberOfLines={1}>
                          {op.cliente}
                        </Text>
                        <Text
                          style={[
                            styles.recentItemMonto,
                            op.esAbono ? styles.recentMontoAbono : styles.recentMontoVenta,
                          ]}
                        >
                          {op.esAbono ? `+${formatCOP(op.valor)}` : formatCOP(op.valor)}
                        </Text>
                      </View>

                      <View style={styles.recentItemBottomLine}>
                        <Text style={styles.recentItemSector}>
                          📍 {op.sector} • {op.contrato}
                        </Text>
                        <Text style={styles.recentItemFecha}>
                          {formatearFechaOperacion(op.fecha)}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        ) : (
          /* ========================================================================= */
          /* PESTAÑA 2: CARTERA (LISTADO MÓVIL OPTIMIZADO)                             */
          /* ========================================================================= */
          <View style={styles.carteraContainer}>
            {/* Barra de Filtros y Búsqueda */}
            <View style={styles.carteraControls}>
              <View style={styles.searchBar}>
                <Text style={styles.searchIcon}>🔍</Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Buscar por cliente, cédula o contrato..."
                  placeholderTextColor="#94A3B8"
                  value={busquedaCartera}
                  onChangeText={setBusquedaCartera}
                  clearButtonMode="while-editing"
                />
                {busquedaCartera.length > 0 ? (
                  <TouchableOpacity onPress={() => setBusquedaCartera('')}>
                    <Text style={styles.searchClearBtn}>✕</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Pestañas de Filtro Rápido */}
              <View style={styles.filterPillsRow}>
                <TouchableOpacity
                  style={[
                    styles.filterPill,
                    filtroCartera === 'todos' && styles.filterPillActive,
                  ]}
                  onPress={() => setFiltroCartera('todos')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      filtroCartera === 'todos' && styles.filterPillTextActive,
                    ]}
                  >
                    Todos ({creditos.length})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.filterPill,
                    filtroCartera === 'mora' && styles.filterPillActiveRose,
                  ]}
                  onPress={() => setFiltroCartera('mora')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      filtroCartera === 'mora' && styles.filterPillTextActiveRose,
                    ]}
                  >
                    ⚠️ En Mora ({metrics.countMora})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.filterPill,
                    filtroCartera === 'al_dia' && styles.filterPillActiveEmerald,
                  ]}
                  onPress={() => setFiltroCartera('al_dia')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      filtroCartera === 'al_dia' && styles.filterPillTextActiveEmerald,
                    ]}
                  >
                    ✓ Al Día ({metrics.countActivos - metrics.countMora > 0 ? metrics.countActivos - metrics.countMora : 0})
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Listado de Tarjetas de Cartera */}
            <FlatList
              data={creditosFiltrados}
              keyExtractor={(item) => String(item.id_contrato)}
              renderItem={renderCarteraCard}
              contentContainerStyle={styles.carteraListContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={() => cargarDatos(true)}
                  colors={['#059669']}
                  tintColor="#059669"
                />
              }
              ListEmptyComponent={
                <View style={styles.emptyCarteraBox}>
                  <Text style={styles.emptyIcon}>📂</Text>
                  <Text style={styles.emptyTitle}>No se encontraron contratos</Text>
                  <Text style={styles.emptyText}>
                    {busquedaCartera
                      ? `No hay coincidencias para "${busquedaCartera}".`
                      : 'No hay créditos registrados bajo el filtro seleccionado.'}
                  </Text>
                </View>
              }
            />
          </View>
        )}
      </View>

      {/* CUSTOM BOTTOM BAR (ESTÉTICA NEOBANCO) */}
      <View style={styles.bottomBarWrapper}>
        <View style={styles.bottomBar}>
          {/* Botón 1: Inicio */}
          <TouchableOpacity
            style={styles.tabBtn}
            onPress={() => setActiveTab('inicio')}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.tabIconWrap,
                activeTab === 'inicio' && styles.tabIconWrapActive,
              ]}
            >
              <Text style={styles.tabIcon}>⚡</Text>
            </View>
            <Text
              style={[
                styles.tabLabel,
                activeTab === 'inicio' && styles.tabLabelActive,
              ]}
            >
              Inicio
            </Text>
          </TouchableOpacity>

          {/* Botón 2: Operar (Venta) - Botón Central Destacado Neobanco */}
          <TouchableOpacity
            style={styles.centerFabBtn}
            onPress={() => navigation.navigate('NuevaVenta')}
            activeOpacity={0.85}
          >
            <View style={styles.centerFabCircle}>
              <Text style={styles.centerFabIcon}>＋</Text>
            </View>
            <Text style={styles.centerFabLabel}>Operar</Text>
          </TouchableOpacity>

          {/* Botón 3: Cartera */}
          <TouchableOpacity
            style={styles.tabBtn}
            onPress={() => setActiveTab('cartera')}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.tabIconWrap,
                activeTab === 'cartera' && styles.tabIconWrapActive,
              ]}
            >
              <Text style={styles.tabIcon}>📑</Text>
            </View>
            <Text
              style={[
                styles.tabLabel,
                activeTab === 'cartera' && styles.tabLabelActive,
              ]}
            >
              Cartera
            </Text>
          </TouchableOpacity>

          {/* Botón 4: ☰ Más */}
          <TouchableOpacity
            style={styles.tabBtn}
            onPress={() => setMenuVisible(true)}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.tabIconWrap,
                menuVisible && styles.tabIconWrapActive,
              ]}
            >
              <Text style={styles.tabIcon}>☰</Text>
            </View>
            <Text
              style={[
                styles.tabLabel,
                menuVisible && styles.tabLabelActive,
              ]}
            >
              Más
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* MENÚ MODAL / DRAWER ADAPTATIVO (InFrameModal) */}
      <InFrameModal
        visible={menuVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={styles.modalDismissArea}
            activeOpacity={1}
            onPress={() => setMenuVisible(false)}
          />

          <View style={styles.menuSheet}>
            {/* Header del Menú */}
            <View style={styles.menuHandleBar} />
            <View style={styles.menuHeaderRow}>
              <View>
                <Text style={styles.menuSheetTitle}>Menú de Operaciones</Text>
                <Text style={styles.menuSheetSubtitle}>Herramientas de Supervisión Gerencial</Text>
              </View>
              <TouchableOpacity
                style={styles.menuCloseBtn}
                onPress={() => setMenuVisible(false)}
              >
                <Text style={styles.menuCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Cuadrícula (Grid) de Módulos */}
            <ScrollView style={{ maxHeight: 450 }} showsVerticalScrollIndicator={false}>
              <View style={styles.menuGrid}>
                {/* Opción 1: Directorio */}
                <TouchableOpacity
                  style={styles.menuGridItem}
                  onPress={() => {
                    setMenuVisible(false);
                    navigation.navigate('DirectorioScreen');
                  }}
                  activeOpacity={0.75}
                >
                  <View style={[styles.menuGridIconCircle, { backgroundColor: '#ECFDF5' }]}>
                    <Text style={styles.menuGridIconText}>👥</Text>
                  </View>
                  <Text style={styles.menuGridTitle}>Directorio</Text>
                  <Text style={styles.menuGridSub}>Clientes y garantes</Text>
                </TouchableOpacity>

                {/* Opción 2: Inventario */}
                <TouchableOpacity
                  style={styles.menuGridItem}
                  onPress={() => {
                    setMenuVisible(false);
                    navigation.navigate('InventarioScreen');
                  }}
                  activeOpacity={0.75}
                >
                  <View style={[styles.menuGridIconCircle, { backgroundColor: '#EFF6FF' }]}>
                    <Text style={styles.menuGridIconText}>📦</Text>
                  </View>
                  <Text style={styles.menuGridTitle}>Inventario</Text>
                  <Text style={styles.menuGridSub}>Catálogo de stock</Text>
                </TouchableOpacity>

                {/* Opción 3: Calendario */}
                <TouchableOpacity
                  style={styles.menuGridItem}
                  onPress={() => {
                    setMenuVisible(false);
                    navigation.navigate('CalendarioScreen');
                  }}
                  activeOpacity={0.75}
                >
                  <View style={[styles.menuGridIconCircle, { backgroundColor: '#FEF3C7' }]}>
                    <Text style={styles.menuGridIconText}>📅</Text>
                  </View>
                  <Text style={styles.menuGridTitle}>Calendario</Text>
                  <Text style={styles.menuGridSub}>Vencimientos mes</Text>
                </TouchableOpacity>

                {/* Opción 4: Cartera Crítica */}
                <TouchableOpacity
                  style={styles.menuGridItem}
                  onPress={() => {
                    setMenuVisible(false);
                    navigation.navigate('CarteraCriticaScreen');
                  }}
                  activeOpacity={0.75}
                >
                  <View style={[styles.menuGridIconCircle, { backgroundColor: '#FFE4E6' }]}>
                    <Text style={styles.menuGridIconText}>⚠️</Text>
                  </View>
                  <Text style={styles.menuGridTitle}>Cartera Crítica</Text>
                  <Text style={styles.menuGridSub}>Alertas ≥ 3 cuotas</Text>
                </TouchableOpacity>

                {/* Opción 5: Personal */}
                <TouchableOpacity
                  style={styles.menuGridItem}
                  onPress={() => {
                    setMenuVisible(false);
                    navigation.navigate('PersonalScreen');
                  }}
                  activeOpacity={0.75}
                >
                  <View style={[styles.menuGridIconCircle, { backgroundColor: '#F0FDF4' }]}>
                    <Text style={styles.menuGridIconText}>👔</Text>
                  </View>
                  <Text style={styles.menuGridTitle}>Personal</Text>
                  <Text style={styles.menuGridSub}>Equipo operativo</Text>
                </TouchableOpacity>

                {/* Opción 6: Comprobantes */}
                <TouchableOpacity
                  style={styles.menuGridItem}
                  onPress={() => {
                    setMenuVisible(false);
                    navigation.navigate('ComprobantesScreen');
                  }}
                  activeOpacity={0.75}
                >
                  <View style={[styles.menuGridIconCircle, { backgroundColor: '#FDF4FF' }]}>
                    <Text style={styles.menuGridIconText}>🧾</Text>
                  </View>
                  <Text style={styles.menuGridTitle}>Comprobantes</Text>
                  <Text style={styles.menuGridSub}>Recibos y compartir</Text>
                </TouchableOpacity>

                {/* Opción 7: Arqueo de Caja (Conciliación de Rutas) */}
                <TouchableOpacity
                  style={styles.menuGridItem}
                  onPress={() => {
                    setMenuVisible(false);
                    navigation.navigate('ArqueoScreen');
                  }}
                  activeOpacity={0.75}
                >
                  <View style={[styles.menuGridIconCircle, { backgroundColor: '#ECFDF5' }]}>
                    <Text style={styles.menuGridIconText}>⚖️</Text>
                  </View>
                  <Text style={styles.menuGridTitle}>Arqueo de Caja</Text>
                  <Text style={styles.menuGridSub}>Conciliación de rutas</Text>
                </TouchableOpacity>

                {/* Opción 8: Reportes Gerenciales */}
                <TouchableOpacity
                  style={styles.menuGridItem}
                  onPress={() => {
                    setMenuVisible(false);
                    navigation.navigate('ReportesScreen');
                  }}
                  activeOpacity={0.75}
                >
                  <View style={[styles.menuGridIconCircle, { backgroundColor: '#F3E8FF' }]}>
                    <Text style={styles.menuGridIconText}>📈</Text>
                  </View>
                  <Text style={styles.menuGridTitle}>Reportes</Text>
                  <Text style={styles.menuGridSub}>Balances y métricas</Text>
                </TouchableOpacity>

                {/* Opción 9: POS Móvil */}
                <TouchableOpacity
                  style={styles.menuGridItem}
                  onPress={() => {
                    setMenuVisible(false);
                    navigation.navigate('NuevaVenta');
                  }}
                  activeOpacity={0.75}
                >
                  <View style={[styles.menuGridIconCircle, { backgroundColor: '#E0F2FE' }]}>
                    <Text style={styles.menuGridIconText}>💳</Text>
                  </View>
                  <Text style={styles.menuGridTitle}>POS Móvil</Text>
                  <Text style={styles.menuGridSub}>Radicación directa</Text>
                </TouchableOpacity>

                {/* Opción 10: Acerca de */}
                <TouchableOpacity
                  style={styles.menuGridItem}
                  onPress={() => {
                    setMenuVisible(false);
                    navigation.navigate('AcercaDe');
                  }}
                  activeOpacity={0.75}
                >
                  <View style={[styles.menuGridIconCircle, { backgroundColor: '#F1F5F9' }]}>
                    <Text style={styles.menuGridIconText}>ℹ️</Text>
                  </View>
                  <Text style={styles.menuGridTitle}>Acerca de</Text>
                  <Text style={styles.menuGridSub}>Marca blanca y specs</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>

            {/* Separador y Cerrar Sesión */}
            <View style={styles.menuFooter}>
              <TouchableOpacity
                style={styles.menuLogoutBtn}
                onPress={handleCerrarSesion}
                activeOpacity={0.8}
              >
                <Text style={styles.menuLogoutIcon}>🚪</Text>
                <Text style={styles.menuLogoutText}>Cerrar Sesión Segura</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </InFrameModal>

      {/* MODAL IN-FRAME DE ASIGNACIÓN OPERATIVA DE COBRADOR (FASE 1) */}
      <InFrameModal
        visible={modalAsignarVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => !isSavingCobrador && setModalAsignarVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={styles.modalDismissArea}
            activeOpacity={1}
            onPress={() => !isSavingCobrador && setModalAsignarVisible(false)}
          />

          <View style={styles.asignarSheet}>
            <View style={styles.menuHandleBar} />

            <View style={styles.asignarHeaderRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.asignarSheetTitle}>Asignar Cobrador</Text>
                <Text style={styles.asignarSheetSubtitle} numberOfLines={1}>
                  {creditoParaAsignar
                    ? `${creditoParaAsignar.codigo_contrato || `CTR-${String(creditoParaAsignar.id_contrato).slice(0, 8).toUpperCase()}`} • ${creditoParaAsignar.cliente?.nombres || creditoParaAsignar.cliente?.nombre_completo || 'Cliente'}`
                    : 'Seleccione el cobrador en ruta'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.menuCloseBtn}
                onPress={() => !isSavingCobrador && setModalAsignarVisible(false)}
                disabled={isSavingCobrador}
              >
                <Text style={styles.menuCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Buscador de Cobradores */}
            <View style={styles.asignarSearchBar}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={styles.asignarSearchInput}
                placeholder="Buscar cobrador por nombre o teléfono..."
                placeholderTextColor="#94A3B8"
                value={busquedaCobrador}
                onChangeText={setBusquedaCobrador}
                clearButtonMode="while-editing"
                editable={!isSavingCobrador}
              />
              {busquedaCobrador.length > 0 ? (
                <TouchableOpacity onPress={() => setBusquedaCobrador('')}>
                  <Text style={styles.searchClearBtn}>✕</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Listado de Cobradores */}
            {isSavingCobrador ? (
              <View style={styles.asignarLoadingBox}>
                <ActivityIndicator size="small" color="#059669" />
                <Text style={styles.asignarLoadingText}>Actualizando cobrador asignado...</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                {/* Opción para Desasignar si el contrato ya tiene cobrador */}
                {(creditoParaAsignar?.cobrador_id || creditoParaAsignar?.cobrador) ? (
                  <TouchableOpacity
                    style={styles.cobradorItemRowUnassign}
                    onPress={() => handleEjecutarAsignacion(null)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.cobradorIconCircleGray}>
                      <Text style={{ fontSize: 14 }}>🚫</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cobradorUnassignText}>Dejar sin cobrador asignado</Text>
                      <Text style={styles.cobradorItemSub}>Remueve la asignación actual de la ruta</Text>
                    </View>
                    <Text style={styles.cobradorSelectArrow}>→</Text>
                  </TouchableOpacity>
                ) : null}

                {cobradoresFiltrados.length === 0 ? (
                  <View style={styles.asignarEmptyBox}>
                    <Text style={styles.asignarEmptyText}>
                      {cobradores.length === 0
                        ? 'No hay cobradores activos registrados en el sistema.'
                        : `No se encontraron cobradores para "${busquedaCobrador}".`}
                    </Text>
                  </View>
                ) : (
                  cobradoresFiltrados.map((cob) => {
                    const esActual =
                      creditoParaAsignar?.cobrador_id === cob.id ||
                      creditoParaAsignar?.cobrador?.id === cob.id;
                    return (
                      <TouchableOpacity
                        key={cob.id}
                        style={[
                          styles.cobradorItemRow,
                          esActual && styles.cobradorItemRowSelected,
                        ]}
                        onPress={() => handleEjecutarAsignacion(cob)}
                        activeOpacity={0.75}
                      >
                        <View
                          style={[
                            styles.cobradorIconCircle,
                            esActual && { backgroundColor: '#059669' },
                          ]}
                        >
                          <Text
                            style={[
                              styles.cobradorIconText,
                              esActual && { color: '#FFFFFF' },
                            ]}
                          >
                            🛵
                          </Text>
                        </View>

                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={styles.cobradorItemNombre}>{cob.nombre}</Text>
                            {esActual ? (
                              <View style={styles.cobradorActualBadge}>
                                <Text style={styles.cobradorActualBadgeText}>ACTUAL</Text>
                              </View>
                            ) : null}
                          </View>
                          <Text style={styles.cobradorItemSub}>
                            {cob.telefono ? `📞 ${cob.telefono}` : 'Sin teléfono'} • {cob.zona || 'Ruta activa'}
                          </Text>
                        </View>

                        <View
                          style={[
                            styles.cobradorRadio,
                            esActual && styles.cobradorRadioSelected,
                          ]}
                        >
                          {esActual ? <View style={styles.cobradorRadioInner} /> : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </InFrameModal>

      {/* ========================================================================= */}
      {/* MODAL DE CONFIRMACIÓN DE CIERRE DE SESIÓN (ESTÁNDAR CORPORATIVO)          */}
      {/* ========================================================================= */}
      <InFrameModal
        visible={showLogoutModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowLogoutModal(false)}
      >
        <View style={styles.modalBackdropCenter}>
          <View style={styles.logoutModalCard}>
            <View style={styles.logoutModalHeader}>
              <View style={styles.logoutIconBadge}>
                <Text style={styles.logoutIconText}>⎋</Text>
              </View>
              <View style={styles.logoutModalTitleCol}>
                <Text style={styles.logoutBadgeText}>CONFIRMACIÓN DE SALIDA</Text>
                <Text style={styles.logoutModalQuestion}>
                  ¿Estás seguro de que deseas cerrar sesión?
                </Text>
              </View>
            </View>

            <Text style={styles.logoutModalMessage}>
              Tu sesión de supervisor será finalizada de forma segura. Tendrás que ingresar nuevamente con tus credenciales corporativas para acceder a la plataforma.
            </Text>

            <View style={styles.logoutModalActions}>
              <TouchableOpacity
                style={styles.logoutCancelBtn}
                onPress={() => setShowLogoutModal(false)}
                accessibilityRole="button"
                accessibilityLabel="Cancelar cierre de sesión"
              >
                <Text style={styles.logoutCancelBtnText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.logoutConfirmBtn}
                onPress={handleConfirmLogout}
                accessibilityRole="button"
                accessibilityLabel="Confirmar salida y cerrar sesión"
              >
                <Text style={styles.logoutConfirmBtnText}>Sí, Salir</Text>
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
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#34D399',
  },
  avatarText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
  greetingText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  roleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  roleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  roleText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  headerActionBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  headerActionIcon: {
    fontSize: 16,
  },
  mainContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 95,
  },
  // HERO NEOBANK CARD
  heroNeobankCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 3,
    marginBottom: 16,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  livePulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#059669',
  },
  liveText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#065F46',
    letterSpacing: 0.4,
  },
  versionBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  heroCardHeaderLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  heroBigAmount: {
    fontSize: 30,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.8,
    marginBottom: 10,
  },
  heroSubstatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  heroSubstatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  heroSubstatDot: {
    color: '#059669',
    fontSize: 14,
    fontWeight: '900',
  },
  heroSubstatText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  heroRefreshInline: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  heroRefreshText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  // KPI ROW
  kpiRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  kpiCardRose: {
    borderColor: '#FECDD3',
    backgroundColor: '#FFF1F2',
  },
  kpiIconWrapBlue: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  kpiIconWrapRose: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#FFE4E6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  kpiIcon: {
    fontSize: 16,
  },
  kpiCardLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  kpiCardCount: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.4,
    marginBottom: 2,
  },
  kpiCardSubValue: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  // BANNER POS ACTION
  bannerPosAction: {
    backgroundColor: '#0F172A',
    borderRadius: 18,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 22,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  bannerPosLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bannerPosIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerPosIcon: {
    fontSize: 18,
  },
  bannerPosTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  bannerPosSubtitle: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  bannerPosArrow: {
    color: '#34D399',
    fontSize: 20,
    fontWeight: '700',
  },
  // SECCIÓN OPERACIONES RECIENTES
  recentSectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  recentTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  recentSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  recentViewAll: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
  },
  recentListCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  recentItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 12,
  },
  recentItemIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentIconAbono: {
    backgroundColor: '#ECFDF5',
  },
  recentIconVenta: {
    backgroundColor: '#EFF6FF',
  },
  recentItemIconText: {
    fontSize: 16,
  },
  recentItemCenter: {
    flex: 1,
  },
  recentItemTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  recentItemCliente: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
    marginRight: 8,
  },
  recentItemMonto: {
    fontSize: 13,
    fontWeight: '800',
  },
  recentMontoAbono: {
    color: '#059669',
  },
  recentMontoVenta: {
    color: '#0F172A',
  },
  recentItemBottomLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recentItemSector: {
    fontSize: 11,
    color: '#64748B',
  },
  recentItemFecha: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '600',
  },
  loadingBox: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  emptyBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyIcon: {
    fontSize: 28,
    marginBottom: 6,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  emptyText: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 16,
  },
  // =========================================================================
  // ESTILOS DE LA PESTAÑA CARTERA
  // =========================================================================
  carteraContainer: {
    flex: 1,
  },
  carteraControls: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
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
    marginBottom: 10,
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
  searchClearBtn: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '800',
    padding: 4,
  },
  filterPillsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterPillActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  filterPillActiveRose: {
    backgroundColor: '#BE123C',
    borderColor: '#BE123C',
  },
  filterPillActiveEmerald: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  filterPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  filterPillTextActive: {
    color: '#FFFFFF',
  },
  filterPillTextActiveRose: {
    color: '#FFFFFF',
  },
  filterPillTextActiveEmerald: {
    color: '#FFFFFF',
  },
  carteraListContent: {
    padding: 16,
    paddingBottom: 95,
    gap: 12,
  },
  carteraCardItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  carteraCardItemExpanded: {
    borderColor: '#059669',
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },
  carteraHeaderTouchable: {
    paddingVertical: 2,
  },
  carteraHeaderRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  carteraChevronText: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '800',
    paddingHorizontal: 4,
  },
  carteraSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  carteraSummarySaldo: {
    fontSize: 15,
    fontWeight: '900',
  },
  carteraExpandedContent: {
    marginTop: 12,
  },
  carteraCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  contratoBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  contratoBadgeText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontWeight: '800',
    color: '#0F172A',
  },
  moraBadge: {
    backgroundColor: '#FFF1F2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FECDD3',
  },
  moraBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#BE123C',
  },
  alDiaBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  alDiaBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#065F46',
  },
  carteraCardBody: {
    marginBottom: 12,
  },
  carteraClienteNombre: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 3,
  },
  carteraCiudadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  carteraPinIcon: {
    fontSize: 12,
  },
  carteraCiudadText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  carteraCedulaText: {
    fontSize: 11,
    color: '#94A3B8',
  },
  carteraFinanzasRow: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    marginBottom: 10,
  },
  carteraFinanzaCol: {
    flex: 1,
  },
  carteraFinanzaLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#94A3B8',
    marginBottom: 2,
  },
  carteraFinanzaValor: {
    fontSize: 13,
    fontWeight: '900',
  },
  carteraFinanzaValorOk: {
    color: '#0F172A',
  },
  carteraFinanzaValorMora: {
    color: '#BE123C',
  },
  carteraFinanzaValorSec: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  carteraCardFooter: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  carteraActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    paddingVertical: 8,
    borderRadius: 10,
    gap: 4,
  },
  carteraActionBtnWs: {
    backgroundColor: '#ECFDF5',
  },
  carteraActionBtnIcon: {
    fontSize: 12,
  },
  carteraActionBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1E293B',
  },
  emptyCarteraBox: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // =========================================================================
  // BOTTOM BAR STYLES
  // =========================================================================
  bottomBarWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 8,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 10,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  tabIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  tabIconWrapActive: {
    backgroundColor: '#ECFDF5',
  },
  tabIcon: {
    fontSize: 16,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  tabLabelActive: {
    color: '#059669',
    fontWeight: '800',
  },
  centerFabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -18,
  },
  centerFabCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    marginBottom: 2,
  },
  centerFabIcon: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 24,
  },
  centerFabLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F172A',
  },
  // =========================================================================
  // MODAL / DRAWER STYLES
  // =========================================================================
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  modalDismissArea: {
    flex: 1,
  },
  menuSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    maxHeight: '82%',
  },
  menuHandleBar: {
    width: 36,
    height: 4,
    backgroundColor: '#CBD5E1',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 14,
  },
  menuHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  menuSheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  menuSheetSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  menuCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuCloseBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  menuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  menuGridItem: {
    width: '48%',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  menuGridIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  menuGridIconText: {
    fontSize: 17,
  },
  menuGridTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  menuGridSub: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 1,
  },
  menuFooter: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },
  menuLogoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF2F2',
    paddingVertical: 12,
    borderRadius: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: '#FECDD3',
  },
  menuLogoutIcon: {
    fontSize: 16,
  },
  menuLogoutText: {
    color: '#DC2626',
    fontWeight: '700',
    fontSize: 13,
  },
  // ESTILOS DE ASIGNACIÓN OPERATIVA DE COBRADOR (FASE 1)
  carteraCobradorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
    gap: 8,
  },
  carteraCobradorLeft: {
    flex: 1,
  },
  carteraCobradorLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  carteraCobradorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  carteraCobradorIcon: {
    fontSize: 12,
  },
  carteraCobradorNombre: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  carteraAsignarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  carteraAsignarBtnIcon: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '800',
  },
  carteraAsignarBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  asignarSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    maxHeight: '85%',
  },
  asignarHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  asignarSheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  asignarSheetSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '600',
  },
  asignarSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
    marginBottom: 14,
  },
  asignarSearchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '600',
    paddingVertical: 0,
  },
  cobradorItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
    gap: 12,
  },
  cobradorItemRowSelected: {
    borderColor: '#059669',
    backgroundColor: '#ECFDF5',
  },
  cobradorIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cobradorIconText: {
    fontSize: 16,
  },
  cobradorItemNombre: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  cobradorActualBadge: {
    backgroundColor: '#059669',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  cobradorActualBadgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cobradorItemSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  cobradorRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cobradorRadioSelected: {
    borderColor: '#059669',
  },
  cobradorRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#059669',
  },
  cobradorItemRowUnassign: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FECDD3',
    marginBottom: 10,
    backgroundColor: '#FFF1F2',
    gap: 12,
  },
  cobradorIconCircleGray: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#FFE4E6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cobradorUnassignText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#BE123C',
  },
  cobradorSelectArrow: {
    fontSize: 16,
    fontWeight: '800',
    color: '#BE123C',
  },
  asignarEmptyBox: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  asignarEmptyText: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
  asignarLoadingBox: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  asignarLoadingText: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '600',
  },
  // ESTILOS DE CONFIRMACIÓN DE SALIDA (ESTÁNDAR CORPORATIVO)
  modalBackdropCenter: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  logoutModalCard: {
    backgroundColor: '#FFFFFF',
    width: '100%',
    maxWidth: 380,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 14,
    elevation: 6,
  },
  logoutModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  logoutIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutIconText: {
    fontSize: 18,
    color: '#E11D48',
    fontWeight: 'bold',
  },
  logoutModalTitleCol: {
    flex: 1,
  },
  logoutBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#E11D48',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  logoutModalQuestion: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 20,
  },
  logoutModalMessage: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 16,
  },
  logoutModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },
  logoutCancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
  },
  logoutCancelBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  logoutConfirmBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#E11D48',
  },
  logoutConfirmBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
