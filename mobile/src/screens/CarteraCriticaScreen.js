import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import apiClient from '../api/client';
import InFrameModal from '../components/InFrameModal';
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

export default function CarteraCriticaScreen({ navigation }) {
  const [contratos, setContratos] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busqueda, setBusqueda] = useState('');

  // Estado para el modal de detalle de contrato
  const [contratoSeleccionado, setContratoSeleccionado] = useState(null);
  const [detalleModalVisible, setDetalleModalVisible] = useState(false);

  // Estado del patrón Acordeón (primera tarjeta expandida por defecto)
  const [expandedIndex, setExpandedIndex] = useState(0);

  // Carga de datos de Cartera Crítica
  const cargarCarteraCritica = useCallback(async (isPullRefresh = false) => {
    if (isPullRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

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
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    cargarCarteraCritica();
  }, [cargarCarteraCritica]);

  // Filtrado reactivo por cliente, cédula o código de contrato
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
          <Text style={styles.headerTitle}>Cartera Crítica</Text>
          <Text style={styles.headerSubtitle}>
            {contratos.length} {contratos.length === 1 ? 'caso en alerta' : 'casos en alerta máxima (≥ 3 cuotas)'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => cargarCarteraCritica(true)}
          disabled={isRefreshing}
          activeOpacity={0.7}
        >
          <Text style={styles.refreshBtnText}>{isRefreshing ? '⏳' : '↻'}</Text>
        </TouchableOpacity>
      </View>

      {/* BANNER DE ALERTA GERENCIAL */}
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

      {/* BUSCADOR */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por cliente, cédula, contrato o ciudad..."
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

      {/* LISTA DE ALERTAS */}
      {isLoading && !isRefreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#E11D48" />
          <Text style={styles.loadingText}>Auditando contratos en mora crítica...</Text>
        </View>
      ) : (
        <FlatList
          data={contratosFiltrados}
          keyExtractor={(item) => String(item.id_contrato)}
          renderItem={renderCardCritica}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => cargarCarteraCritica(true)}
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
});
