import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import apiClient, { STORAGE_KEYS, limpiarCredencialesLocales } from '../api/client';
import InFrameModal from '../components/InFrameModal';

const formatCOP = (val) => {
  const num = Math.round(Number(val) || 0);
  return '$ ' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

export default function VendedorDashboard({ navigation }) {
  const { user, logout } = useAuth();
  const { obtenerVentasLocalesPendientes, forzarSincronizacion, pendingCount, isOnline } = useSync();

  // Estados de navegación interna (Tabs)
  const [activeTab, setActiveTab] = useState('ventas'); // 'ventas' | 'acciones'
  const [filtroEstado, setFiltroEstado] = useState('todas'); // 'todas' | 'pendiente' | 'activo'

  // Estados de ventas
  const [ventas, setVentas] = useState([]);
  const [isLoadingVentas, setIsLoadingVentas] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Estado del Modal de Confirmación de Cierre de Sesión
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // ==========================================
  // ESTADOS Y GESTIÓN DE GARANTÍAS Y RESPALDO
  // ==========================================
  const [modalGarantiasVisible, setModalGarantiasVisible] = useState(false);
  const [creditoGarantias, setCreditoGarantias] = useState(null);
  const [isLoadingGarantias, setIsLoadingGarantias] = useState(false);

  const hacerLlamada = (tel) => {
    if (!tel) {
      Alert.alert('Sin Teléfono', 'No hay un número registrado para realizar la llamada.');
      return;
    }
    const clean = String(tel).replace(/\D/g, '');
    Linking.openURL(`tel:${clean}`).catch((err) => {
      console.warn('Error al iniciar llamada:', err);
      Alert.alert('Error', 'No se pudo abrir la aplicación de llamadas.');
    });
  };

  const abrirWhatsApp = (tel, nombre, rol) => {
    if (!tel) {
      Alert.alert('Sin WhatsApp', 'No hay un número telefónico registrado para WhatsApp.');
      return;
    }
    let clean = String(tel).replace(/\D/g, '');
    if (clean.length === 10 && !clean.startsWith('57')) {
      clean = '57' + clean;
    }
    const texto = encodeURIComponent(
      `Hola ${nombre || ''}, te contacto de Remundial referente al contrato respaldado (${rol || 'Garantía'}).`
    );
    Linking.openURL(`https://wa.me/${clean}?text=${texto}`).catch((err) => {
      console.warn('Error al abrir WhatsApp:', err);
      Alert.alert('Error', 'No se pudo abrir WhatsApp.');
    });
  };

  const abrirModalGarantias = async (item) => {
    setCreditoGarantias(item);
    setModalGarantiasVisible(true);

    const clienteId = item?.cliente_id || item?.cliente?.id;
    const tieneCodeudor = item?.codeudor && (item.codeudor.nombre || item.codeudor.telefono);
    const tieneRef = item?.referencia && (item.referencia.nombre || item.referencia.telefono);

    if (clienteId && (!tieneCodeudor || !tieneRef)) {
      try {
        setIsLoadingGarantias(true);
        const res = await apiClient.get(`/clientes/${clienteId}/garantias`);
        if (res?.data) {
          setCreditoGarantias((prev) => ({
            ...prev,
            codeudor: res.data.codeudor || prev?.codeudor,
            referencia: res.data.referencia_familiar || res.data.referencia || prev?.referencia,
          }));
        }
      } catch (err) {
        console.log('[VendedorDashboard] Garantías previas no encontradas en servidor:', err);
      } finally {
        setIsLoadingGarantias(false);
      }
    }
  };

  // ==========================================
  // CONSULTA DE VENTAS EN TIEMPO REAL (OFFLINE-FIRST)
  // ==========================================
  const cargarVentas = useCallback(async () => {
    try {
      setIsLoadingVentas(true);
      let ventasServidor = [];
      try {
        const res = await apiClient.get('/creditos');
        if (Array.isArray(res.data)) {
          ventasServidor = res.data;
        }
      } catch (netErr) {
        console.warn('[VendedorDashboard] Sin conexión al backend para ventas:', netErr?.message);
      }

      // Obtener transacciones offline en cola pendientes
      let ventasLocales = [];
      try {
        const colaOffline = await obtenerVentasLocalesPendientes();
        ventasLocales = (colaOffline || []).map((item) => {
          const p = item.payload || {};
          const meta = item.meta || {};
          return {
            id_contrato: item.id,
            es_offline: true,
            estado: 'offline_pending',
            creado_en: item.createdAt || new Date().toISOString(),
            monto_financiado: p.monto_financiado || 0,
            cuota_inicial: p.cuota_inicial || 0,
            valor_cuota: p.valor_cuota || meta.valor_cuota || 0,
            numero_cuotas: p.numero_cuotas || meta.cuotas || 1,
            tipo_pago: p.tipo_pago || meta.tipo_pago || 'mensual',
            cliente: {
              nombres: meta.cliente_nombre || 'Cliente en Terreno (Offline)',
              cedula: meta.cliente_cedula || 'S/N',
              telefono: 'Guardado en dispositivo',
              direccion: 'Registro local pendiente de sync',
              barrio: '',
            },
            detalles: (p.detalles || []).map((d) => ({
              cantidad: d.cantidad || 1,
              producto: { nombre: meta.articulos_resumen || 'Artículo en orden local' },
              valor_unitario_acordado: d.valor_unitario_acordado || 0,
            })),
            codeudor: p.codeudor || meta.codeudor || null,
            referencia: p.referencia || meta.referencia || null,
          };
        });
      } catch (queueErr) {
        console.warn('[VendedorDashboard] Error al consultar ventas locales en cola:', queueErr);
      }

      // Combinar primero las offline para feedback instantáneo y luego las del servidor
      setVentas([...ventasLocales, ...ventasServidor]);
    } catch (error) {
      console.warn('[VendedorDashboard] Error cargando ventas:', error);
    } finally {
      setIsLoadingVentas(false);
      setIsRefreshing(false);
    }
  }, [obtenerVentasLocalesPendientes]);

  useEffect(() => {
    cargarVentas();
    // Refrescar automáticamente al regresar a esta pantalla o cuando cambie la cola de pendientes
    const unsubscribe = navigation?.addListener?.('focus', () => {
      cargarVentas();
    });
    return unsubscribe;
  }, [navigation, cargarVentas, pendingCount]);

  const onRefresh = () => {
    setIsRefreshing(true);
    cargarVentas();
  };

  // ==========================================
  // FILTRADO Y CÁLCULOS DE HOY
  // ==========================================
  const todayStr = useMemo(() => {
    return new Date().toISOString().split('T')[0];
  }, []);

  const ventasHoy = useMemo(() => {
    return ventas.filter((v) => {
      if (!v.creado_en) return true;
      try {
        const fechaVenta = new Date(v.creado_en).toISOString().split('T')[0];
        return fechaVenta === todayStr;
      } catch (e) {
        return true;
      }
    });
  }, [ventas, todayStr]);

  const kpis = useMemo(() => {
    const totalColocado = ventasHoy.reduce(
      (acc, v) => acc + (Number(v.monto_financiado || 0) + Number(v.cuota_inicial || 0)),
      0
    );
    const aprobadas = ventasHoy.filter(
      (v) => v.estado === 'activo' || v.estado === 'terminado'
    ).length;
    const pendientes = ventasHoy.filter(
      (v) => v.estado === 'pendiente' || v.estado === 'offline_pending'
    ).length;
    const offlineCount = ventasHoy.filter((v) => v.estado === 'offline_pending').length;

    return {
      totalVentas: ventasHoy.length,
      totalColocado,
      aprobadas,
      pendientes,
      offlineCount,
    };
  }, [ventasHoy]);

  const ventasFiltradas = useMemo(() => {
    if (filtroEstado === 'pendiente') {
      return ventasHoy.filter((v) => v.estado === 'pendiente' || v.estado === 'offline_pending');
    }
    if (filtroEstado === 'activo') {
      return ventasHoy.filter((v) => v.estado === 'activo' || v.estado === 'terminado');
    }
    return ventasHoy;
  }, [ventasHoy, filtroEstado]);

  // ==========================================
  // CONFIGURACIÓN DE INDICADORES DE ESTADO
  // ==========================================
  const getEstadoConfig = (estado) => {
    const st = (estado || 'pendiente').toLowerCase();
    if (st === 'offline_pending') {
      return {
        label: 'Pendiente de Sincronización (Offline)',
        badgeText: 'Sin Enviar',
        dotColor: '#EA580C',
        bgColor: '#FFEDD5',
        borderColor: '#FED7AA',
        textColor: '#C2410C',
        icon: '☁️',
      };
    }
    if (st === 'pendiente') {
      return {
        label: 'Pendiente de Aprobación',
        badgeText: 'Por Revisar',
        dotColor: '#F59E0B',
        bgColor: '#FEF3C7',
        borderColor: '#FDE68A',
        textColor: '#B45309',
        icon: '⏳',
      };
    }
    if (st === 'activo') {
      return {
        label: 'Aprobado / En Ruta',
        badgeText: 'Aprobado',
        dotColor: '#10B981',
        bgColor: '#D1FAE5',
        borderColor: '#A7F3D0',
        textColor: '#047857',
        icon: '✓',
      };
    }
    if (st === 'terminado') {
      return {
        label: 'Venta de Contado',
        badgeText: 'Liquidado',
        dotColor: '#3B82F6',
        bgColor: '#EFF6FF',
        borderColor: '#BFDBFE',
        textColor: '#1D4ED8',
        icon: '★',
      };
    }
    if (st === 'mora') {
      return {
        label: 'En Mora',
        badgeText: 'Mora',
        dotColor: '#EF4444',
        bgColor: '#FEE2E2',
        borderColor: '#FECACA',
        textColor: '#B91C1C',
        icon: '⚠',
      };
    }
    return {
      label: 'Por Revisar',
      badgeText: 'Pendiente',
      dotColor: '#64748B',
      bgColor: '#F1F5F9',
      borderColor: '#E2E8F0',
      textColor: '#334155',
      icon: '•',
    };
  };

  // ==========================================
  // GESTIÓN DE CIERRE DE SESIÓN SEGURO Y REDIRECCIÓN FORZOSA
  // ==========================================
  const handleConfirmLogout = async () => {
    try {
      setShowLogoutModal(false);
      // 1. Limpieza profunda y exhaustiva en AsyncStorage, localStorage/sessionStorage y Axios
      await limpiarCredencialesLocales();
      // 2. Destruir sesión en el contexto global (token = null desmonta el dashboard de inmediato)
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
      console.error('[VendedorDashboard] Error al destruir sesión en AsyncStorage:', error);
      await logout();
      try {
        if (navigation?.navigate) {
          navigation.navigate('Login');
        }
      } catch (_) {}
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* BARRA SUPERIOR CORPORATIVA SAAS */}
      <View style={styles.topHeader}>
        <View style={styles.headerLeftCol}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.appTitle}>Remundial</Text>
            <View style={styles.vendedorBadge}>
              <Text style={styles.vendedorBadgeText}>VENDEDOR EN TERRENO</Text>
            </View>
          </View>
          <Text style={styles.headerSub}>Originación de Créditos y Ventas</Text>
        </View>

        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={() => setShowLogoutModal(true)}
          accessibilityRole="button"
          accessibilityLabel="Cerrar sesión"
        >
          <Text style={styles.logoutBtnText}>Salir</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            colors={['#10B981']}
            tintColor="#10B981"
          />
        }
      >
        {/* IDENTIFICACIÓN DEL ASESOR COMERCIAL */}
        <View style={styles.operatorCard}>
          <View style={styles.operatorAvatar}>
            <Text style={styles.operatorAvatarText}>
              {user?.nombre
                ? user.nombre
                    .split(' ')
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()
                : 'VE'}
            </Text>
          </View>
          <View style={styles.operatorDetails}>
            <Text style={styles.operatorName}>{user?.nombre || 'Juan Vendedor'}</Text>
            <Text style={styles.operatorPhone}>Tel: {user?.telefono || '3151234567'}</Text>
          </View>
          <View style={styles.onlineBadge}>
            <View style={styles.onlineDot} />
            <Text style={styles.onlineText}>Comercial</Text>
          </View>
        </View>

        {/* RESUMEN DE VENTAS DE HOY (KPIS DINÁMICOS) */}
        <View style={styles.kpiRow}>
          <View style={styles.kpiCardColocado}>
            <Text style={styles.kpiLabelColocado}>TOTAL HOY</Text>
            <Text style={styles.kpiValueColocado}>{formatCOP(kpis.totalColocado)}</Text>
            <Text style={styles.kpiSubColocado}>
              {kpis.totalVentas} venta{kpis.totalVentas !== 1 ? 's' : ''} en jornada
            </Text>
          </View>

          <View style={styles.kpiCardAprobadas}>
            <Text style={styles.kpiLabelAprobadas}>APROBADAS</Text>
            <Text style={styles.kpiValueAprobadas}>{kpis.aprobadas}</Text>
            <Text style={styles.kpiSubAprobadas}>En ruta de cobro</Text>
          </View>

          <View style={styles.kpiCardPendientes}>
            <Text style={styles.kpiLabelPendientes}>POR REVISAR</Text>
            <Text style={styles.kpiValuePendientes}>{kpis.pendientes}</Text>
            <Text style={styles.kpiSubPendientes}>En auditoría</Text>
          </View>
        </View>

        {/* SELECTOR SEGMENTADO DE VISTAS (TABS SAAS) */}
        <View style={styles.segmentedContainer}>
          <TouchableOpacity
            style={[styles.segmentBtn, activeTab === 'ventas' && styles.segmentBtnActive]}
            onPress={() => setActiveTab('ventas')}
            accessibilityRole="tab"
          >
            <Text
              style={[styles.segmentBtnText, activeTab === 'ventas' && styles.segmentBtnTextActive]}
            >
              🛍️ Mis Ventas de Hoy ({kpis.totalVentas})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.segmentBtn, activeTab === 'acciones' && styles.segmentBtnActive]}
            onPress={() => setActiveTab('acciones')}
            accessibilityRole="tab"
          >
            <Text
              style={[
                styles.segmentBtnText,
                activeTab === 'acciones' && styles.segmentBtnTextActive,
              ]}
            >
              ⚡ Acciones & Catálogo
            </Text>
          </TouchableOpacity>
        </View>

        {/* ========================================================================= */}
        {/* PESTAÑA 1: MIS VENTAS DEL DÍA (EN TIEMPO REAL CON ESTADOS Y DETALLES)    */}
        {/* ========================================================================= */}
        {activeTab === 'ventas' && (
          <View style={styles.salesSection}>
            {/* Cabecera de Sección con Filtros Rápidos */}
            <View style={styles.salesSectionHeader}>
              <View>
                <Text style={styles.salesSectionTitle}>VENTAS ORIGINADAS HOY</Text>
                <Text style={styles.salesSectionSub}>
                  Seguimiento de aprobación y despacho en tiempo real
                </Text>
              </View>

              <TouchableOpacity
                style={styles.refreshIconBtn}
                onPress={onRefresh}
                disabled={isLoadingVentas}
                accessibilityLabel="Actualizar listado de ventas"
              >
                {isLoadingVentas ? (
                  <ActivityIndicator size="small" color="#0F172A" />
                ) : (
                  <Text style={styles.refreshIconText}>🔄</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Chips de Filtro de Estado */}
            <View style={styles.filterChipsRow}>
              <TouchableOpacity
                style={[styles.chipBtn, filtroEstado === 'todas' && styles.chipBtnActive]}
                onPress={() => setFiltroEstado('todas')}
              >
                <Text
                  style={[
                    styles.chipBtnText,
                    filtroEstado === 'todas' && styles.chipBtnTextActive,
                  ]}
                >
                  Todas ({ventasHoy.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.chipBtn, filtroEstado === 'pendiente' && styles.chipBtnActive]}
                onPress={() => setFiltroEstado('pendiente')}
              >
                <Text
                  style={[
                    styles.chipBtnText,
                    filtroEstado === 'pendiente' && styles.chipBtnTextActive,
                  ]}
                >
                  ⏳ Pendientes ({kpis.pendientes})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.chipBtn, filtroEstado === 'activo' && styles.chipBtnActive]}
                onPress={() => setFiltroEstado('activo')}
              >
                <Text
                  style={[
                    styles.chipBtnText,
                    filtroEstado === 'activo' && styles.chipBtnTextActive,
                  ]}
                >
                  ✓ Aprobadas ({kpis.aprobadas})
                </Text>
              </TouchableOpacity>
            </View>

            {/* Banner de Ventas Offline Guardadas Localmente */}
            {kpis.offlineCount > 0 && (
              <View style={styles.offlineNoticeBox}>
                <View style={styles.offlineNoticeLeft}>
                  <Text style={styles.offlineNoticeIcon}>☁️</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.offlineNoticeTitle}>
                      {kpis.offlineCount} {kpis.offlineCount === 1 ? 'venta guardada localmente' : 'ventas guardadas localmente'}
                    </Text>
                    <Text style={styles.offlineNoticeSub}>
                      Guardada(s) en este teléfono sin señal. Se sincronizarán en segundo plano al recuperar red.
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.offlineSyncBtn, !isOnline && styles.offlineSyncBtnDisabled]}
                  onPress={forzarSincronizacion}
                  disabled={!isOnline}
                  activeOpacity={0.7}
                >
                  <Text style={styles.offlineSyncBtnText}>
                    {isOnline ? 'Sincronizar' : 'Sin Señal'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Listado de Tarjetas de Venta */}
            {isLoadingVentas && !isRefreshing && ventasHoy.length === 0 ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#10B981" />
                <Text style={styles.loadingText}>Consultando ventas de la jornada...</Text>
              </View>
            ) : ventasFiltradas.length === 0 ? (
              <View style={styles.emptyCard}>
                <View style={styles.emptyIconBox}>
                  <Text style={styles.emptyIconText}>🛍️</Text>
                </View>
                <Text style={styles.emptyTitle}>
                  {filtroEstado === 'todas'
                    ? 'Sin ventas registradas hoy'
                    : 'No hay contratos con este estado'}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {filtroEstado === 'todas'
                    ? 'Los contratos de crédito y ventas que registres en terreno aparecerán aquí con su estado de auditoría en tiempo real.'
                    : 'Prueba cambiando de filtro para visualizar las demás ventas de la jornada.'}
                </Text>
                <TouchableOpacity
                  style={styles.emptyActionBtn}
                  onPress={() => navigation?.navigate('NuevaVenta', { reset: true, timestamp: Date.now() })}
                  accessibilityRole="button"
                >
                  <Text style={styles.emptyActionBtnText}>＋ Registrar Nueva Venta</Text>
                </TouchableOpacity>
              </View>
            ) : (
              ventasFiltradas.map((item) => {
                const cfg = getEstadoConfig(item.estado);
                const contratoCodigo = item.id_contrato
                  ? (item.id_contrato.startsWith('VENTA-OFF-') ? item.id_contrato : `CTR-${item.id_contrato.slice(0, 8).toUpperCase()}`)
                  : 'CTR-PENDIENTE';

                let horaTexto = 'Hoy';
                if (item.creado_en) {
                  try {
                    horaTexto = new Date(item.creado_en).toLocaleTimeString('es-CO', {
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                  } catch (e) {
                    horaTexto = 'Hoy';
                  }
                }

                const totalVenta =
                  Number(item.monto_financiado || 0) + Number(item.cuota_inicial || 0);
                const cuotaInicial = Number(item.cuota_inicial || 0);
                const valorCuota = Number(item.valor_cuota || 0);
                const numeroCuotas = Number(item.numero_cuotas || 0);
                const frecuencia = (item.tipo_pago || 'MENSUAL').toUpperCase();

                const detalles = Array.isArray(item.detalles) ? item.detalles : [];

                return (
                  <View key={item.id_contrato || Math.random().toString()} style={styles.saleCard}>
                    {/* Cabecera de la Tarjeta */}
                    <View style={styles.cardHeader}>
                      <View style={styles.cardHeaderLeft}>
                        <Text style={styles.contratoText}>{contratoCodigo}</Text>
                        <Text style={styles.horaText}>• {horaTexto}</Text>
                      </View>

                      {/* Badge de Estado Visible */}
                      <View
                        style={[
                          styles.statusBadge,
                          { backgroundColor: cfg.bgColor, borderColor: cfg.borderColor },
                        ]}
                      >
                        <View style={[styles.statusDot, { backgroundColor: cfg.dotColor }]} />
                        <Text style={[styles.statusBadgeText, { color: cfg.textColor }]}>
                          {cfg.label}
                        </Text>
                      </View>
                    </View>

                    {/* Información del Cliente */}
                    <View style={styles.clientSection}>
                      <Text style={styles.clientName}>
                        👤 {item.cliente?.nombres || 'Cliente Titular'}
                      </Text>
                      <Text style={styles.clientDoc}>
                        CC: {item.cliente?.cedula || 'S/N'} • Tel: {item.cliente?.telefono || 'No registrado'}
                      </Text>
                      <Text style={styles.clientAddress} numberOfLines={1}>
                        📍 {item.cliente?.direccion || 'Dirección no especificada'}{' '}
                        {item.cliente?.barrio ? `(${item.cliente.barrio})` : ''}
                      </Text>
                    </View>

                    {/* Condiciones Financieras y Plan */}
                    <View style={styles.financialBox}>
                      <View style={styles.financialRow}>
                        <Text style={styles.financialLabel}>Total Venta:</Text>
                        <Text style={styles.financialValue}>{formatCOP(totalVenta)}</Text>
                      </View>

                      {cuotaInicial > 0 && (
                        <View style={styles.financialRow}>
                          <Text style={styles.financialLabel}>Cuota Inicial:</Text>
                          <Text style={styles.financialSubValue}>{formatCOP(cuotaInicial)}</Text>
                        </View>
                      )}

                      <View style={styles.financialRow}>
                        <Text style={styles.financialLabel}>Plan Acordado:</Text>
                        <Text style={styles.financialPlan}>
                          {numeroCuotas > 1
                            ? `${numeroCuotas} cuotas de ${formatCOP(valorCuota)} (${frecuencia})`
                            : `Venta de Contado (${formatCOP(totalVenta)})`}
                        </Text>
                      </View>
                    </View>

                    {/* Desglose de Artículos */}
                    <View style={styles.articlesBox}>
                      <Text style={styles.articlesHeader}>📦 ARTÍCULOS EN LA ORDEN:</Text>
                      {detalles.length === 0 ? (
                        <Text style={styles.articleItemEmpty}>• Mercancía general de catálogo</Text>
                      ) : (
                        detalles.map((d, idx) => (
                          <Text key={idx} style={styles.articleItem} numberOfLines={1}>
                            • {d.cantidad}x {d.producto?.nombre || 'Artículo de catálogo'} (
                            {formatCOP(d.valor_unitario_acordado || d.precio || 0)})
                          </Text>
                        ))
                      )}
                    </View>

                    {/* Botón de Acceso Rápido a Garantías */}
                    <TouchableOpacity
                      style={styles.verGarantiasSaleBtn}
                      onPress={() => abrirModalGarantias(item)}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                    >
                      <Text style={styles.verGarantiasSaleBtnText}>🛡️ Ver Garantías</Text>
                    </TouchableOpacity>
                  </View>
                );
              })
            )}

            {/* Botón Flotante/Inferior para Registrar Nueva Venta */}
            <TouchableOpacity
              style={styles.floatingAddBtn}
              onPress={() => navigation?.navigate('NuevaVenta', { reset: true, timestamp: Date.now() })}
              accessibilityRole="button"
            >
              <Text style={styles.floatingAddBtnIcon}>＋</Text>
              <Text style={styles.floatingAddBtnText}>Registrar Nueva Venta en Terreno</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ========================================================================= */}
        {/* PESTAÑA 2: ACCIONES OPERATIVAS Y CATÁLOGO                                */}
        {/* ========================================================================= */}
        {activeTab === 'acciones' && (
          <View style={styles.menuSection}>
            <Text style={styles.sectionHeading}>ACCIONES DE ORIGINACIÓN</Text>

            {/* Tarjeta Principal de Nueva Venta */}
            <TouchableOpacity
              style={styles.actionCardHighlight}
              onPress={() => navigation?.navigate('NuevaVenta', { reset: true, timestamp: Date.now() })}
              accessibilityRole="button"
            >
              <View style={styles.actionIconBoxHighlight}>
                <Text style={styles.actionIconTextHighlight}>＋</Text>
              </View>
              <View style={styles.actionTextCol}>
                <Text style={styles.actionTitleHighlight}>Nueva Venta / Crédito</Text>
                <Text style={styles.actionSubtitleHighlight}>
                  Registro de contrato, plan de cuotas y entrega de artículos
                </Text>
              </View>
              <Text style={styles.chevronIconHighlight}>→</Text>
            </TouchableOpacity>

            {/* Directorio de Clientes */}
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => navigation?.navigate('Clientes')}
              accessibilityRole="button"
            >
              <View style={styles.actionIconBox}>
                <Text style={styles.actionIconText}>👥</Text>
              </View>
              <View style={styles.actionTextCol}>
                <Text style={styles.actionTitle}>Directorio de Clientes</Text>
                <Text style={styles.actionSubtitle}>
                  Búsqueda, historial crediticio y coordenadas GPS
                </Text>
              </View>
              <Text style={styles.chevronIcon}>→</Text>
            </TouchableOpacity>

            {/* Catálogo de Productos */}
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => navigation?.navigate('Catalogo')}
              accessibilityRole="button"
            >
              <View style={styles.actionIconBox}>
                <Text style={styles.actionIconText}>📦</Text>
              </View>
              <View style={styles.actionTextCol}>
                <Text style={styles.actionTitle}>Catálogo de Artículos</Text>
                <Text style={styles.actionSubtitle}>
                  Precios vigentes, stock disponible y especificaciones
                </Text>
              </View>
              <Text style={styles.chevronIcon}>→</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Botón de Cierre de Sesión Secundario */}
        <TouchableOpacity
          style={styles.logoutButtonSecondary}
          onPress={() => setShowLogoutModal(true)}
          accessibilityRole="button"
          accessibilityLabel="Cerrar sesión activa"
        >
          <Text style={styles.logoutButtonSecondaryText}>Finalizar Turno / Salir</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ========================================================================= */}
      {/* MODAL DE CONFIRMACIÓN DE CIERRE DE SESIÓN (ESTÁNDAR CORPORATIVO WEB) */}
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
              Tu sesión actual será finalizada de forma segura. Tendrás que ingresar nuevamente con tus credenciales corporativas para acceder a la plataforma.
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

      {/* ========================================================================= */}
      {/* MODAL DE GARANTÍAS Y RESPALDO (CODEUDOR Y REFERENCIA)                    */}
      {/* ========================================================================= */}
      <InFrameModal
        visible={modalGarantiasVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setModalGarantiasVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.garantiasModalCard}>
            
            {/* Cabecera del Modal */}
            <View style={styles.garantiasModalHeader}>
              <View style={{ flex: 1 }}>
                <View style={styles.garantiasTagRow}>
                  <Text style={styles.garantiasShieldIcon}>🛡️</Text>
                  <Text style={styles.garantiasTagText}>DATOS DE RESPALDO</Text>
                </View>
                <Text style={styles.garantiasModalTitle}>Garantías y Respaldo</Text>
                <Text style={styles.garantiasModalSub} numberOfLines={1}>
                  {creditoGarantias?.cliente?.nombres || 'Cliente'} • {creditoGarantias?.numero_contrato || (creditoGarantias?.id_contrato ? (creditoGarantias.id_contrato.startsWith('VENTA-OFF-') ? creditoGarantias.id_contrato : `CTR-${String(creditoGarantias.id_contrato).slice(0, 8).toUpperCase()}`) : 'CTR-VENTA')}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.garantiasCloseBtn}
                onPress={() => setModalGarantiasVisible(false)}
                accessibilityLabel="Cerrar modal de garantías"
              >
                <Text style={styles.garantiasCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Contenido Scrollable */}
            <ScrollView
              style={styles.garantiasModalBody}
              contentContainerStyle={{ paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
            >
              {isLoadingGarantias ? (
                <View style={styles.garantiasLoadingBox}>
                  <ActivityIndicator size="small" color="#10B981" />
                  <Text style={styles.garantiasLoadingText}>Consultando datos de respaldo...</Text>
                </View>
              ) : (
                <>
                  {/* TARJETA 1: CODEUDOR SOLIDARIO */}
                  <View style={styles.garantiaCardCodeudor}>
                    <View style={styles.garantiaCardHeader}>
                      <View style={styles.garantiaIconBoxBlue}>
                        <Text style={styles.garantiaIcon}>🤝</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.garantiaCardBadgeBlue}>CODEUDOR SOLIDARIO</Text>
                        <Text style={styles.garantiaPersonaNombre}>
                          {creditoGarantias?.codeudor?.nombre || 'No registrado'}
                        </Text>
                      </View>
                    </View>

                    {creditoGarantias?.codeudor?.nombre ? (
                      <View style={styles.garantiaCardContent}>
                        <View style={styles.garantiaDataRow}>
                          <Text style={styles.garantiaDataLabel}>Cédula:</Text>
                          <Text style={styles.garantiaDataVal}>
                            {creditoGarantias?.codeudor?.cedula || 'Sin cédula registrada'}
                          </Text>
                        </View>

                        <View style={styles.garantiaDataRow}>
                          <Text style={styles.garantiaDataLabel}>Dirección:</Text>
                          <Text style={styles.garantiaDataVal}>
                            {creditoGarantias?.codeudor?.direccion || 'Sin dirección registrada'}
                          </Text>
                        </View>

                        <View style={styles.garantiaDataRow}>
                          <Text style={styles.garantiaDataLabel}>Teléfono:</Text>
                          <Text style={styles.garantiaDataValBold}>
                            {creditoGarantias?.codeudor?.telefono || 'Sin teléfono'}
                          </Text>
                        </View>

                        {/* Botones de Acción Rápida: Llamada y WhatsApp */}
                        {creditoGarantias?.codeudor?.telefono ? (
                          <View style={styles.garantiaActionBtnsRow}>
                            <TouchableOpacity
                              style={styles.actionCallBtn}
                              onPress={() => hacerLlamada(creditoGarantias.codeudor.telefono)}
                              activeOpacity={0.8}
                            >
                              <Text style={styles.actionCallBtnText}>📞 Llamar</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={styles.actionWhatsAppBtn}
                              onPress={() =>
                                abrirWhatsApp(
                                  creditoGarantias.codeudor.telefono,
                                  creditoGarantias.codeudor.nombre,
                                  'Codeudor Solidario'
                                )
                              }
                              activeOpacity={0.8}
                            >
                              <Text style={styles.actionWhatsAppBtnText}>💬 WhatsApp</Text>
                            </TouchableOpacity>
                          </View>
                        ) : null}
                      </View>
                    ) : (
                      <View style={styles.garantiaEmptyNotice}>
                        <Text style={styles.garantiaEmptyNoticeText}>
                          Este contrato o venta no tiene un codeudor solidario registrado.
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* TARJETA 2: REFERENCIA FAMILIAR O PERSONAL */}
                  <View style={styles.garantiaCardReferencia}>
                    <View style={styles.garantiaCardHeader}>
                      <View style={styles.garantiaIconBoxAmber}>
                        <Text style={styles.garantiaIcon}>👥</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.garantiaCardBadgeAmber}>REFERENCIA FAMILIAR</Text>
                        <Text style={styles.garantiaPersonaNombre}>
                          {creditoGarantias?.referencia?.nombre || 'No registrada'}
                        </Text>
                      </View>
                    </View>

                    {creditoGarantias?.referencia?.nombre ? (
                      <View style={styles.garantiaCardContent}>
                        <View style={styles.garantiaDataRow}>
                          <Text style={styles.garantiaDataLabel}>Parentesco:</Text>
                          <Text style={styles.garantiaDataValBadge}>
                            {creditoGarantias?.referencia?.parentesco || 'Familiar'}
                          </Text>
                        </View>

                        {creditoGarantias?.referencia?.direccion ? (
                          <View style={styles.garantiaDataRow}>
                            <Text style={styles.garantiaDataLabel}>Dirección:</Text>
                            <Text style={styles.garantiaDataVal}>
                              {creditoGarantias.referencia.direccion}
                            </Text>
                          </View>
                        ) : null}

                        <View style={styles.garantiaDataRow}>
                          <Text style={styles.garantiaDataLabel}>Teléfono:</Text>
                          <Text style={styles.garantiaDataValBold}>
                            {creditoGarantias?.referencia?.telefono || 'Sin teléfono'}
                          </Text>
                        </View>

                        {/* Botones de Acción Rápida: Llamada y WhatsApp */}
                        {creditoGarantias?.referencia?.telefono ? (
                          <View style={styles.garantiaActionBtnsRow}>
                            <TouchableOpacity
                              style={styles.actionCallBtn}
                              onPress={() => hacerLlamada(creditoGarantias.referencia.telefono)}
                              activeOpacity={0.8}
                            >
                              <Text style={styles.actionCallBtnText}>📞 Llamar</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={styles.actionWhatsAppBtn}
                              onPress={() =>
                                abrirWhatsApp(
                                  creditoGarantias.referencia.telefono,
                                  creditoGarantias.referencia.nombre,
                                  'Referencia Familiar'
                                )
                              }
                              activeOpacity={0.8}
                            >
                              <Text style={styles.actionWhatsAppBtnText}>💬 WhatsApp</Text>
                            </TouchableOpacity>
                          </View>
                        ) : null}
                      </View>
                    ) : (
                      <View style={styles.garantiaEmptyNotice}>
                        <Text style={styles.garantiaEmptyNoticeText}>
                          Esta venta no tiene una referencia familiar registrada.
                        </Text>
                      </View>
                    )}
                  </View>
                </>
              )}
            </ScrollView>

            {/* Botón Inferior de Cierre */}
            <View style={styles.garantiasModalFooter}>
              <TouchableOpacity
                style={styles.garantiasCerrarModalBtn}
                onPress={() => setModalGarantiasVisible(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.garantiasCerrarModalBtnText}>Entendido / Volver</Text>
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
    backgroundColor: '#F8FAFC',
    position: 'relative',
  },
  topHeader: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerLeftCol: {
    flex: 1,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  appTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  vendedorBadge: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  vendedorBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 0.5,
  },
  headerSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  logoutBtn: {
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  logoutBtnText: {
    color: '#E11D48',
    fontSize: 12,
    fontWeight: '700',
  },
  container: {
    paddingHorizontal: 14,
    paddingBottom: 28,
  },
  operatorCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  operatorAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  operatorAvatarText: {
    color: '#FBBF24',
    fontSize: 14,
    fontWeight: '800',
  },
  operatorDetails: {
    flex: 1,
  },
  operatorName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  operatorPhone: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F59E0B',
  },
  onlineText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B45309',
  },

  // KPIS DINÁMICOS
  kpiRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  kpiCardColocado: {
    flex: 1.3,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 12,
    padding: 10,
  },
  kpiLabelColocado: {
    fontSize: 9,
    fontWeight: '800',
    color: '#047857',
    letterSpacing: 0.5,
  },
  kpiValueColocado: {
    fontSize: 13,
    fontWeight: '800',
    color: '#065F46',
    marginTop: 2,
  },
  kpiSubColocado: {
    fontSize: 9,
    color: '#059669',
    marginTop: 1,
  },
  kpiCardAprobadas: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 10,
  },
  kpiLabelAprobadas: {
    fontSize: 9,
    fontWeight: '700',
    color: '#10B981',
    letterSpacing: 0.5,
  },
  kpiValueAprobadas: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  kpiSubAprobadas: {
    fontSize: 9,
    color: '#64748B',
    marginTop: 1,
  },
  kpiCardPendientes: {
    flex: 1,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    padding: 10,
  },
  kpiLabelPendientes: {
    fontSize: 9,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 0.5,
  },
  kpiValuePendientes: {
    fontSize: 14,
    fontWeight: '800',
    color: '#92400E',
    marginTop: 2,
  },
  kpiSubPendientes: {
    fontSize: 9,
    color: '#B45309',
    marginTop: 1,
  },

  // SELECTOR SEGMENTADO (TABS)
  segmentedContainer: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 12,
    padding: 3,
    marginTop: 14,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  segmentBtnTextActive: {
    fontWeight: '800',
    color: '#0F172A',
  },

  // SECCIÓN DE MIS VENTAS
  salesSection: {
    marginTop: 14,
  },
  salesSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  salesSectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.5,
  },
  salesSectionSub: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 1,
  },
  refreshIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshIconText: {
    fontSize: 14,
  },

  // CHIPS DE FILTRO
  filterChipsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  chipBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chipBtnActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  chipBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  chipBtnTextActive: {
    color: '#FFFFFF',
  },

  // TARJETA DE VENTA
  saleCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 8,
    marginBottom: 8,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  contratoText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  horaText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },

  // DETALLES DEL CLIENTE
  clientSection: {
    marginBottom: 8,
  },
  clientName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  clientDoc: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 2,
  },
  clientAddress: {
    fontSize: 11,
    color: '#475569',
  },

  // CONDICIONES FINANCIERAS
  financialBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    padding: 8,
    marginBottom: 8,
    gap: 3,
  },
  financialRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  financialLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
  },
  financialValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  financialSubValue: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  financialPlan: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F172A',
  },

  // ARTÍCULOS
  articlesBox: {
    paddingTop: 4,
  },
  articlesHeader: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  articleItem: {
    fontSize: 11,
    color: '#334155',
    fontWeight: '500',
    marginBottom: 2,
  },
  articleItemEmpty: {
    fontSize: 11,
    fontStyle: 'italic',
    color: '#94A3B8',
  },

  // BOTÓN FLOTANTE NUEVA VENTA
  floatingAddBtn: {
    backgroundColor: '#10B981',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 8,
    marginTop: 4,
    marginBottom: 10,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  floatingAddBtnIcon: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  floatingAddBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },

  // ESTADO DE CARGA Y VACÍO
  loadingContainer: {
    paddingVertical: 36,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 12,
    color: '#64748B',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 24,
    alignItems: 'center',
    textAlign: 'center',
    marginBottom: 10,
  },
  emptyIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  emptyIconText: {
    fontSize: 20,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 11,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: 14,
  },
  emptyActionBtn: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
  },
  emptyActionBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },

  // SECCIÓN ACCIONES
  menuSection: {
    marginTop: 14,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  actionCardHighlight: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#10B981',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  actionIconBoxHighlight: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconTextHighlight: {
    fontSize: 18,
    color: '#059669',
    fontWeight: 'bold',
  },
  actionTitleHighlight: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  actionSubtitleHighlight: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 15,
  },
  chevronIconHighlight: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#059669',
  },
  actionCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  actionIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconText: {
    fontSize: 16,
  },
  actionTextCol: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  actionSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 15,
  },
  chevronIcon: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#94A3B8',
  },
  logoutButtonSecondary: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  logoutButtonSecondaryText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '700',
  },

  // MODAL CONFIRMACIÓN DE SALIDA
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
  // Notificación de ventas locales offline
  offlineNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    gap: 10,
  },
  offlineNoticeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  offlineNoticeIcon: {
    fontSize: 22,
  },
  offlineNoticeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#9A3412',
  },
  offlineNoticeSub: {
    fontSize: 11,
    color: '#C2410C',
    marginTop: 2,
    lineHeight: 15,
  },
  offlineSyncBtn: {
    backgroundColor: '#EA580C',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  offlineSyncBtnDisabled: {
    backgroundColor: '#CBD5E1',
  },
  offlineSyncBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // BOTÓN DE ACCESO A GARANTÍAS EN TARJETA DE VENTA
  verGarantiasSaleBtn: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  verGarantiasSaleBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },

  // MODAL DE GARANTÍAS Y RESPALDO (VENDEDOR)
  modalBackdrop: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  garantiasModalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '88%',
    width: '100%',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 10,
  },
  garantiasModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  garantiasTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 3,
  },
  garantiasShieldIcon: {
    fontSize: 13,
  },
  garantiasTagText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0284C7',
    letterSpacing: 0.5,
  },
  garantiasModalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  garantiasModalSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  garantiasCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  garantiasCloseBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#64748B',
  },
  garantiasModalBody: {
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  garantiasLoadingBox: {
    paddingVertical: 36,
    alignItems: 'center',
    gap: 8,
  },
  garantiasLoadingText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  garantiaCardCodeudor: {
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  garantiaCardReferencia: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  garantiaCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
    paddingBottom: 8,
  },
  garantiaIconBoxBlue: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#E0F2FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  garantiaIconBoxAmber: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  garantiaIcon: {
    fontSize: 16,
  },
  garantiaCardBadgeBlue: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0369A1',
    letterSpacing: 0.5,
  },
  garantiaCardBadgeAmber: {
    fontSize: 9,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 0.5,
  },
  garantiaPersonaNombre: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 1,
  },
  garantiaCardContent: {
    gap: 6,
  },
  garantiaDataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  garantiaDataLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  garantiaDataVal: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E293B',
    flex: 1,
    textAlign: 'right',
    marginLeft: 8,
  },
  garantiaDataValBold: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  garantiaDataValBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  garantiaActionBtnsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  actionCallBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0284C7',
    paddingVertical: 9,
    borderRadius: 8,
  },
  actionCallBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  actionWhatsAppBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#16A34A',
    paddingVertical: 9,
    borderRadius: 8,
  },
  actionWhatsAppBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  garantiaEmptyNotice: {
    paddingVertical: 8,
  },
  garantiaEmptyNoticeText: {
    fontSize: 11,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  garantiasModalFooter: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#FAFAFA',
  },
  garantiasCerrarModalBtn: {
    backgroundColor: '#0F172A',
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  garantiasCerrarModalBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
