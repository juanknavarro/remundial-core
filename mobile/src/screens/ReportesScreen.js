import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  FlatList,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  Linking,
  Platform,
  Alert,
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

const formatearFechaLarga = (fechaInput) => {
  if (!fechaInput) return 'Fecha reciente';
  const d = new Date(fechaInput);
  if (isNaN(d.getTime())) return 'Reciente';
  return d.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const CACHE_REPORTES_HISTORICOS = 'cache_reportes_historicos_mobile';

const CIUDADES_DEFAULT = [
  'Montería',
  'Cereté',
  'Sahagún',
  'Lorica',
  'Planeta Rica',
  'Montelíbano',
  'Ciénaga de Oro',
  'Tierralta',
];

export default function ReportesScreen({ navigation }) {
  // Datos del reporte
  const [operaciones, setOperaciones] = useState([]);
  const [metricas, setMetricas] = useState({
    total_vendido: 0,
    volumen_credito: 0,
    volumen_contado: 0,
    ticket_promedio: 0,
    total_operaciones: 0,
    operaciones_credito: 0,
    operaciones_contado: 0,
  });

  // Estados de carga
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filtros activos
  const [periodoPreset, setPeriodoPreset] = useState('mes'); // 'hoy' | 'semana' | 'mes' | 'personalizado' | 'todos'
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [tipoVenta, setTipoVenta] = useState('todos'); // 'todos' | 'credito' | 'contado'
  const [ciudadFiltro, setCiudadFiltro] = useState('todas');
  const [search, setSearch] = useState('');

  // Catálogo de ciudades
  const [ciudadesOperativas, setCiudadesOperativas] = useState(CIUDADES_DEFAULT);

  // Estado del Modal de Filtros Avanzados
  const [modalFiltrosVisible, setModalFiltrosVisible] = useState(false);

  // Estados temporales del modal (drafts)
  const [tempFechaInicio, setTempFechaInicio] = useState('');
  const [tempFechaFin, setTempFechaFin] = useState('');
  const [tempCiudad, setTempCiudad] = useState('todas');
  const [tempTipoVenta, setTempTipoVenta] = useState('todos');
  const [tempSearch, setTempSearch] = useState('');

  // Patrón Acordeón: primera tarjeta expandida por defecto (index = 0)
  const [expandedIndex, setExpandedIndex] = useState(0);

  // Inicializar fechas según el preset seleccionado
  const aplicarPresetFechas = useCallback((preset) => {
    setPeriodoPreset(preset);
    const hoy = new Date();
    const hoyStr = hoy.toISOString().split('T')[0];

    if (preset === 'hoy') {
      setFechaInicio(hoyStr);
      setFechaFin(hoyStr);
    } else if (preset === 'semana') {
      const primerDiaSemana = new Date(hoy);
      const diaSem = hoy.getDay();
      const diff = hoy.getDate() - diaSem + (diaSem === 0 ? -6 : 1);
      primerDiaSemana.setDate(diff);
      setFechaInicio(primerDiaSemana.toISOString().split('T')[0]);
      setFechaFin(hoyStr);
    } else if (preset === 'mes') {
      const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      setFechaInicio(primerDiaMes.toISOString().split('T')[0]);
      setFechaFin(hoyStr);
    } else if (preset === 'todos') {
      setFechaInicio('');
      setFechaFin('');
    }
  }, []);

  // Carga inicial del preset mes
  useEffect(() => {
    aplicarPresetFechas('mes');
  }, [aplicarPresetFechas]);

  // Cargar catálogo de ciudades autorizadas
  useEffect(() => {
    const fetchCiudades = async () => {
      try {
        const res = await apiClient.get('/config/ciudades');
        const data = res.data;
        const lista = Array.isArray(data)
          ? data
          : Array.isArray(data?.ciudades_plano)
          ? data.ciudades_plano
          : Array.isArray(data?.ciudades)
          ? data.ciudades
          : data?.ciudades && typeof data.ciudades === 'object'
          ? Object.values(data.ciudades).flat()
          : [];
        if (lista.length > 0) {
          setCiudadesOperativas(lista);
        }
      } catch (err) {
        console.warn('[ReportesScreen] Error cargando ciudades:', err);
      }
    };
    fetchCiudades();
  }, []);

  // Carga del reporte de ventas desde el backend (exacto a la web)
  const cargarReporte = useCallback(
    async (isPullRefresh = false) => {
      if (isPullRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      try {
        const params = {
          tipo_venta: tipoVenta,
        };

        if (fechaInicio) params.fecha_inicio = fechaInicio;
        if (fechaFin) params.fecha_fin = fechaFin;
        if (ciudadFiltro && ciudadFiltro !== 'todas') params.ciudad_venta = ciudadFiltro;
        if (search.trim()) params.search = search.trim();

        const res = await apiClient.get('/reportes/ventas', { params });

        if (res.data) {
          const nuevasMetricas = res.data.metricas || {
            total_vendido: 0,
            volumen_credito: 0,
            volumen_contado: 0,
            ticket_promedio: 0,
            total_operaciones: 0,
            operaciones_credito: 0,
            operaciones_contado: 0,
          };
          const nuevasOperaciones = Array.isArray(res.data.operaciones) ? res.data.operaciones : [];

          setMetricas(nuevasMetricas);
          setOperaciones(nuevasOperaciones);

          // Guardar en caché para disponibilidad offline
          guardarEnCache(CACHE_REPORTES_HISTORICOS, {
            metricas: nuevasMetricas,
            operaciones: nuevasOperaciones,
          });
        }
      } catch (error) {
        console.warn('[ReportesScreen] Error cargando reporte de ventas, recurriendo a caché:', error);
        const cached = await obtenerDeCache(CACHE_REPORTES_HISTORICOS);
        if (cached) {
          if (cached.metricas) setMetricas(cached.metricas);
          if (Array.isArray(cached.operaciones)) setOperaciones(cached.operaciones);
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [fechaInicio, fechaFin, tipoVenta, ciudadFiltro, search]
  );

  // Disparar carga cada vez que cambien los filtros
  useEffect(() => {
    cargarReporte();
  }, [cargarReporte]);

  // Manejador para abrir modal de filtros avanzados con valores actuales
  const handleAbrirFiltrosAvanzados = () => {
    setTempFechaInicio(fechaInicio);
    setTempFechaFin(fechaFin);
    setTempCiudad(ciudadFiltro);
    setTempTipoVenta(tipoVenta);
    setTempSearch(search);
    setModalFiltrosVisible(true);
  };

  // Manejador para aplicar filtros desde el modal
  const handleAplicarFiltrosModal = () => {
    setFechaInicio(tempFechaInicio);
    setFechaFin(tempFechaFin);
    setCiudadFiltro(tempCiudad);
    setTipoVenta(tempTipoVenta);
    setSearch(tempSearch);
    setPeriodoPreset('personalizado');
    setModalFiltrosVisible(false);
  };

  // Manejador para limpiar todos los filtros
  const handleLimpiarFiltrosModal = () => {
    aplicarPresetFechas('mes');
    setTempCiudad('todas');
    setCiudadFiltro('todas');
    setTempTipoVenta('todos');
    setTipoVenta('todos');
    setTempSearch('');
    setSearch('');
    setModalFiltrosVisible(false);
  };

  // Contactar cliente si tiene teléfono
  const handleContactarCliente = (telefono, nombre) => {
    if (!telefono) {
      Alert.alert('Sin Teléfono', `No hay teléfono registrado para ${nombre}.`);
      return;
    }
    const cleanTel = String(telefono).replace(/[^0-9]/g, '');
    Linking.openURL(`tel:${cleanTel}`).catch(() => {
      Alert.alert('Error', 'No es posible realizar llamadas desde este dispositivo.');
    });
  };

  // =========================================================================
  // RENDERIZADO DEL COMPONENTE DE OPERACIÓN CON PATRÓN ACORDEÓN
  // =========================================================================
  const renderOperacionCard = ({ item, index }) => {
    const isExpanded = index === expandedIndex;
    const esContado = item.tipo_venta === 'contado';
    const montoTotal = Number(item.monto_total || 0);
    const saldoPendiente = Number(item.saldo_pendiente || 0);
    const cuotaInicial = Number(item.cuota_inicial || 0);
    const valorCuota = Number(item.valor_cuota || 0);
    const numCuotas = Number(item.numero_cuotas || 1);
    const ciudad = item.ciudad_venta || 'Montería';
    const vendedor = item.vendedor_nombre || 'Asesor Comercial';
    const codigoContrato = item.codigo_contrato || `CTR-${String(item.id_contrato).slice(0, 8).toUpperCase()}`;

    return (
      <View style={[styles.card, isExpanded && styles.cardExpanded]}>
        {/* Cabecera Interactiva del Acordeón */}
        <TouchableOpacity
          style={styles.accordionHeaderTouchable}
          onPress={() => setExpandedIndex(isExpanded ? -1 : index)}
          activeOpacity={0.75}
        >
          {/* Fila Superior: Folio, Modalidad y Chevron */}
          <View style={styles.cardHeaderTop}>
            <View style={styles.contratoBadge}>
              <Text style={styles.contratoBadgeText}>{codigoContrato}</Text>
            </View>

            <View style={styles.headerRightGroup}>
              <View
                style={[
                  styles.modalidadBadge,
                  esContado ? styles.modalidadBadgeContado : styles.modalidadBadgeCredito,
                ]}
              >
                <Text
                  style={[
                    styles.modalidadBadgeText,
                    esContado ? styles.modalidadTextContado : styles.modalidadTextCredito,
                  ]}
                >
                  {esContado ? '💵 Contado' : '💳 Crédito'}
                </Text>
              </View>

              <Text style={styles.accordionChevronText}>
                {isExpanded ? '▲' : '▼'}
              </Text>
            </View>
          </View>

          {/* Resumen Permanente en Cabecera: Cliente, Ciudad y Monto */}
          <View style={styles.accordionSummaryRow}>
            <View style={styles.summaryClienteCol}>
              <Text style={styles.clienteNombre} numberOfLines={1}>
                {item.cliente_nombre || 'Cliente Titular'}
              </Text>
              <Text style={styles.ciudadSubtitle}>📍 {ciudad}</Text>
            </View>

            <View style={styles.summaryMontoCol}>
              <Text style={styles.montoLabel}>TOTAL FACTURADO</Text>
              <Text style={styles.montoPrincipal}>
                {formatCOP(montoTotal)}
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Cuerpo Expandido del Acordeón (index === expandedIndex) */}
        {isExpanded ? (
          <View style={styles.accordionExpandedContent}>
            {/* Metadatos de la operación */}
            <View style={styles.metaBox}>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>DOCUMENTO:</Text>
                <Text style={styles.metaValue}>CC {item.cliente_cedula || 'S/N'}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>FECHA:</Text>
                <Text style={styles.metaValue}>{formatearFechaLarga(item.fecha)}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>ASESOR:</Text>
                <Text style={styles.metaValue}>{vendedor}</Text>
              </View>
            </View>

            {/* Bloque de Artículos Facturados */}
            <View style={styles.articulosBox}>
              <Text style={styles.articulosTitle}>ARTÍCULOS FACTURADOS</Text>
              {item.articulos && Array.isArray(item.articulos) && item.articulos.length > 0 ? (
                item.articulos.map((art, idx) => (
                  <View key={idx} style={styles.articuloItemRow}>
                    <Text style={styles.articuloQty}>{art.cantidad}x</Text>
                    <Text style={styles.articuloNombre} numberOfLines={2}>
                      {art.nombre}
                    </Text>
                    <Text style={styles.articuloSubtotal}>
                      {formatCOP(art.subtotal || art.valor_unitario * art.cantidad)}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.articulosResumenText}>
                  {item.articulos_resumen || 'Artículos de catálogo'}
                </Text>
              )}
            </View>

            {/* Progreso Financiero y Saldos */}
            <View style={styles.progresoBox}>
              <Text style={styles.progresoBoxTitle}>PROGRESO Y CONDICIONES</Text>
              {esContado ? (
                <View style={styles.contadoStatusRow}>
                  <Text style={styles.contadoStatusIcon}>✅</Text>
                  <Text style={styles.contadoStatusText}>
                    Venta de Contado • Saldada al 100% en el momento de la entrega
                  </Text>
                </View>
              ) : (
                <View style={styles.creditoFinanzasGrid}>
                  <View style={styles.finanzaCol}>
                    <Text style={styles.finanzaLabel}>INICIAL</Text>
                    <Text style={styles.finanzaValue}>{formatCOP(cuotaInicial)}</Text>
                  </View>

                  <View style={styles.finanzaCol}>
                    <Text style={[styles.finanzaLabel, { color: '#BE123C' }]}>
                      SALDO PENDIENTE
                    </Text>
                    <Text
                      style={[
                        styles.finanzaValue,
                        saldoPendiente > 0 ? styles.finanzaValueRose : styles.finanzaValueOk,
                      ]}
                    >
                      {formatCOP(saldoPendiente)}
                    </Text>
                  </View>

                  <View style={styles.finanzaCol}>
                    <Text style={styles.finanzaLabel}>VALOR CUOTA</Text>
                    <Text style={styles.finanzaValue}>
                      {formatCOP(valorCuota)}
                    </Text>
                    <Text style={styles.finanzaSub}>
                      {numCuotas} {numCuotas === 1 ? 'cuota' : 'cuotas'} ({item.tipo_pago || 'semanal'})
                    </Text>
                  </View>
                </View>
              )}
            </View>

            {/* Botón de Contacto Rápido */}
            {item.cliente_telefono ? (
              <TouchableOpacity
                style={styles.btnContactar}
                onPress={() => handleContactarCliente(item.cliente_telefono, item.cliente_nombre)}
                activeOpacity={0.8}
              >
                <Text style={styles.btnContactarIcon}>📞</Text>
                <Text style={styles.btnContactarText}>
                  Llamar Cliente ({item.cliente_telefono})
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  // Porcentaje de colocación
  const pctCredito =
    metricas.total_vendido > 0
      ? ((metricas.volumen_credito / metricas.total_vendido) * 100).toFixed(1)
      : '0.0';
  const pctContado =
    metricas.total_vendido > 0
      ? ((metricas.volumen_contado / metricas.total_vendido) * 100).toFixed(1)
      : '0.0';

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
          <Text style={styles.headerTitle}>Reportes e Históricos</Text>
          <Text style={styles.headerSubtitle}>
            Auditoría de Ventas y Colocación Financiera
          </Text>
        </View>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => cargarReporte(true)}
          disabled={isRefreshing}
          activeOpacity={0.7}
        >
          <Text style={styles.refreshBtnText}>{isRefreshing ? '⏳' : '↻'}</Text>
        </TouchableOpacity>
      </View>

      {/* ========================================================================= */}
      {/* BARRA SUPERIOR DE FILTROS RÁPIDOS (SCROLLVIEW HORIZONTAL + BOTÓN MODAL)     */}
      {/* ========================================================================= */}
      <View style={styles.quickFilterBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickFilterScroll}
        >
          <TouchableOpacity
            style={[
              styles.filterPill,
              periodoPreset === 'hoy' && styles.filterPillActive,
            ]}
            onPress={() => aplicarPresetFechas('hoy')}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.filterPillText,
                periodoPreset === 'hoy' && styles.filterPillTextActive,
              ]}
            >
              📅 Hoy
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterPill,
              periodoPreset === 'semana' && styles.filterPillActive,
            ]}
            onPress={() => aplicarPresetFechas('semana')}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.filterPillText,
                periodoPreset === 'semana' && styles.filterPillTextActive,
              ]}
            >
              Esta Semana
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterPill,
              periodoPreset === 'mes' && styles.filterPillActive,
            ]}
            onPress={() => aplicarPresetFechas('mes')}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.filterPillText,
                periodoPreset === 'mes' && styles.filterPillTextActive,
              ]}
            >
              Este Mes
            </Text>
          </TouchableOpacity>

          {/* Filtros Rápidos de Tipo de Venta */}
          <TouchableOpacity
            style={[
              styles.filterPill,
              tipoVenta === 'credito' && styles.filterPillActiveBlue,
            ]}
            onPress={() => setTipoVenta(tipoVenta === 'credito' ? 'todos' : 'credito')}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.filterPillText,
                tipoVenta === 'credito' && styles.filterPillTextActiveBlue,
              ]}
            >
              💳 Crédito
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterPill,
              tipoVenta === 'contado' && styles.filterPillActiveEmerald,
            ]}
            onPress={() => setTipoVenta(tipoVenta === 'contado' ? 'todos' : 'contado')}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.filterPillText,
                tipoVenta === 'contado' && styles.filterPillTextActiveEmerald,
              ]}
            >
              💵 Contado
            </Text>
          </TouchableOpacity>

          {ciudadFiltro !== 'todas' ? (
            <View style={styles.filterPillCityActive}>
              <Text style={styles.filterPillCityText}>📍 {ciudadFiltro}</Text>
              <TouchableOpacity onPress={() => setCiudadFiltro('todas')}>
                <Text style={styles.filterPillCityClose}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>

        {/* Botón con Icono de Filtro para abrir InFrameModal */}
        <TouchableOpacity
          style={[
            styles.btnOpenModalFiltros,
            (periodoPreset === 'personalizado' || search || ciudadFiltro !== 'todas') &&
              styles.btnOpenModalFiltrosActive,
          ]}
          onPress={handleAbrirFiltrosAvanzados}
          activeOpacity={0.8}
        >
          <Text style={styles.btnOpenModalIcon}>⚙️</Text>
          <Text style={styles.btnOpenModalLabel}>Filtros</Text>
        </TouchableOpacity>
      </View>

      {/* ========================================================================= */}
      {/* LISTADO PRINCIPAL CON CUADRÍCULA DE KPIS EN HEADER DEL FLATLIST             */}
      {/* ========================================================================= */}
      {isLoading && !isRefreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#059669" />
          <Text style={styles.loadingText}>Compilando reporte de ventas y auditoría...</Text>
        </View>
      ) : (
        <FlatList
          data={operaciones}
          keyExtractor={(item) => String(item.id_contrato)}
          renderItem={renderOperacionCard}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => cargarReporte(true)}
              colors={['#059669']}
              tintColor="#059669"
            />
          }
          ListHeaderComponent={
            <View style={styles.listHeaderComponent}>
              {/* ========================================================================= */}
              {/* CUADRÍCULA DE KPIS (2x2 EXACTA AL DASHBOARD WEB)                          */}
              {/* ========================================================================= */}
              <View style={styles.kpiGrid}>
                {/* KPI 1: Total Facturado */}
                <View style={styles.kpiCard}>
                  <View style={styles.kpiCardTop}>
                    <Text style={styles.kpiLabel}>TOTAL FACTURADO</Text>
                    <View style={styles.kpiIconWrapDark}>
                      <Text style={styles.kpiIconText}>📈</Text>
                    </View>
                  </View>
                  <Text style={styles.kpiValueMain}>
                    {formatCOP(metricas.total_vendido)}
                  </Text>
                  <Text style={styles.kpiSubtext}>
                    {metricas.total_operaciones} {metricas.total_operaciones === 1 ? 'venta' : 'ventas en el período'}
                  </Text>
                </View>

                {/* KPI 2: Colocación a Crédito */}
                <View style={[styles.kpiCard, styles.kpiCardBlue]}>
                  <View style={styles.kpiCardTop}>
                    <Text style={[styles.kpiLabel, { color: '#1D4ED8' }]}>
                      COLOCACIÓN A CRÉDITO
                    </Text>
                    <View style={styles.kpiIconWrapBlue}>
                      <Text style={styles.kpiIconText}>💳</Text>
                    </View>
                  </View>
                  <Text style={styles.kpiValueMain}>
                    {formatCOP(metricas.volumen_credito)}
                  </Text>
                  <Text style={styles.kpiSubtext}>
                    {metricas.operaciones_credito} contratos • {pctCredito}%
                  </Text>
                </View>

                {/* KPI 3: Ventas de Contado */}
                <View style={[styles.kpiCard, styles.kpiCardEmerald]}>
                  <View style={styles.kpiCardTop}>
                    <Text style={[styles.kpiLabel, { color: '#047857' }]}>
                      VENTAS DE CONTADO
                    </Text>
                    <View style={styles.kpiIconWrapEmerald}>
                      <Text style={styles.kpiIconText}>💵</Text>
                    </View>
                  </View>
                  <Text style={styles.kpiValueMain}>
                    {formatCOP(metricas.volumen_contado)}
                  </Text>
                  <Text style={styles.kpiSubtext}>
                    {metricas.operaciones_contado} ventas • {pctContado}%
                  </Text>
                </View>

                {/* KPI 4: Ticket Promedio */}
                <View style={[styles.kpiCard, styles.kpiCardPurple]}>
                  <View style={styles.kpiCardTop}>
                    <Text style={[styles.kpiLabel, { color: '#6D28D9' }]}>
                      TICKET PROMEDIO
                    </Text>
                    <View style={styles.kpiIconWrapPurple}>
                      <Text style={styles.kpiIconText}>🏷️</Text>
                    </View>
                  </View>
                  <Text style={styles.kpiValueMain}>
                    {formatCOP(metricas.ticket_promedio)}
                  </Text>
                  <Text style={styles.kpiSubtext}>
                    Promedio por operación
                  </Text>
                </View>
              </View>

              {/* Título de la Sección de Desglose */}
              <View style={styles.sectionHeaderRow}>
                <View>
                  <Text style={styles.sectionTitle}>Desglose de Operaciones</Text>
                  <Text style={styles.sectionSubtitle}>
                    Toque una tarjeta para expandir artículos y detalles
                  </Text>
                </View>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>
                    {operaciones.length} transacciones
                  </Text>
                </View>
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>📊</Text>
              <Text style={styles.emptyTitle}>Sin operaciones en el período</Text>
              <Text style={styles.emptySubtitle}>
                {search || ciudadFiltro !== 'todas' || tipoVenta !== 'todos'
                  ? 'No hay registros que coincidan con los filtros aplicados. Intente ampliar el rango o limpiar filtros.'
                  : 'No se encontraron ventas ni colocaciones registradas en este período de tiempo.'}
              </Text>
              {(search || ciudadFiltro !== 'todas' || tipoVenta !== 'todos') ? (
                <TouchableOpacity
                  style={styles.btnResetEmpty}
                  onPress={handleLimpiarFiltrosModal}
                >
                  <Text style={styles.btnResetEmptyText}>Restablecer Filtros</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          }
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL DE FILTROS AVANZADOS (INFRAMEMODAL)                                 */}
      {/* ========================================================================= */}
      <InFrameModal
        visible={modalFiltrosVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setModalFiltrosVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {/* Cabecera del modal */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTitleWrap}>
                <Text style={styles.modalTitle}>Filtros Avanzados</Text>
                <Text style={styles.modalSubtitle}>
                  Personalice el rango, localidad y modalidad
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setModalFiltrosVisible(false)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.modalScroll}
              showsVerticalScrollIndicator={false}
            >
              {/* Búsqueda Rápida */}
              <View style={styles.modalFieldGroup}>
                <Text style={styles.modalLabel}>BÚSQUEDA RÁPIDA (CLIENTE, CÉDULA, CONTRATO)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Ej: Juan Pérez, 1067..., CTR-001"
                  placeholderTextColor="#94A3B8"
                  value={tempSearch}
                  onChangeText={setTempSearch}
                  clearButtonMode="while-editing"
                />
              </View>

              {/* Rango de Fechas */}
              <View style={styles.modalFieldGroup}>
                <Text style={styles.modalLabel}>RANGO DE FECHAS (AAAA-MM-DD)</Text>
                <View style={styles.dateInputsRow}>
                  <View style={styles.dateInputCol}>
                    <Text style={styles.subInputLabel}>Desde:</Text>
                    <TextInput
                      style={styles.modalInputSmall}
                      placeholder="2026-01-01"
                      placeholderTextColor="#94A3B8"
                      value={tempFechaInicio}
                      onChangeText={setTempFechaInicio}
                    />
                  </View>
                  <View style={styles.dateInputCol}>
                    <Text style={styles.subInputLabel}>Hasta:</Text>
                    <TextInput
                      style={styles.modalInputSmall}
                      placeholder="2026-12-31"
                      placeholderTextColor="#94A3B8"
                      value={tempFechaFin}
                      onChangeText={setTempFechaFin}
                    />
                  </View>
                </View>

                {/* Botones de presets en el modal */}
                <View style={styles.modalPresetsRow}>
                  <TouchableOpacity
                    style={styles.modalPresetBtn}
                    onPress={() => {
                      const hoyStr = new Date().toISOString().split('T')[0];
                      setTempFechaInicio(hoyStr);
                      setTempFechaFin(hoyStr);
                    }}
                  >
                    <Text style={styles.modalPresetBtnText}>Hoy</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.modalPresetBtn}
                    onPress={() => {
                      const hoy = new Date();
                      const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
                      setTempFechaInicio(primerDia.toISOString().split('T')[0]);
                      setTempFechaFin(hoy.toISOString().split('T')[0]);
                    }}
                  >
                    <Text style={styles.modalPresetBtnText}>Este Mes</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.modalPresetBtn}
                    onPress={() => {
                      setTempFechaInicio('');
                      setTempFechaFin('');
                    }}
                  >
                    <Text style={styles.modalPresetBtnText}>Limpiar Fechas</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Modalidad de Venta */}
              <View style={styles.modalFieldGroup}>
                <Text style={styles.modalLabel}>MODALIDAD DE VENTA</Text>
                <View style={styles.modalButtonGroup}>
                  <TouchableOpacity
                    style={[
                      styles.modalOptionBtn,
                      tempTipoVenta === 'todos' && styles.modalOptionBtnActive,
                    ]}
                    onPress={() => setTempTipoVenta('todos')}
                  >
                    <Text
                      style={[
                        styles.modalOptionText,
                        tempTipoVenta === 'todos' && styles.modalOptionTextActive,
                      ]}
                    >
                      Todas
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.modalOptionBtn,
                      tempTipoVenta === 'credito' && styles.modalOptionBtnActive,
                    ]}
                    onPress={() => setTempTipoVenta('credito')}
                  >
                    <Text
                      style={[
                        styles.modalOptionText,
                        tempTipoVenta === 'credito' && styles.modalOptionTextActive,
                      ]}
                    >
                      Solo Crédito
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.modalOptionBtn,
                      tempTipoVenta === 'contado' && styles.modalOptionBtnActive,
                    ]}
                    onPress={() => setTempTipoVenta('contado')}
                  >
                    <Text
                      style={[
                        styles.modalOptionText,
                        tempTipoVenta === 'contado' && styles.modalOptionTextActive,
                      ]}
                    >
                      Solo Contado
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Selector de Ciudad */}
              <View style={styles.modalFieldGroup}>
                <Text style={styles.modalLabel}>CIUDAD DE VENTA</Text>
                <View style={styles.cityChipsWrap}>
                  <TouchableOpacity
                    style={[
                      styles.cityChip,
                      tempCiudad === 'todas' && styles.cityChipActive,
                    ]}
                    onPress={() => setTempCiudad('todas')}
                  >
                    <Text
                      style={[
                        styles.cityChipText,
                        tempCiudad === 'todas' && styles.cityChipTextActive,
                      ]}
                    >
                      🌐 Todas las Ciudades
                    </Text>
                  </TouchableOpacity>

                  {ciudadesOperativas.map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[
                        styles.cityChip,
                        tempCiudad.toLowerCase() === c.toLowerCase() && styles.cityChipActive,
                      ]}
                      onPress={() => setTempCiudad(c)}
                    >
                      <Text
                        style={[
                          styles.cityChipText,
                          tempCiudad.toLowerCase() === c.toLowerCase() &&
                            styles.cityChipTextActive,
                        ]}
                      >
                        📍 {c}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </ScrollView>

            {/* Acciones del Modal */}
            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={styles.modalBtnClear}
                onPress={handleLimpiarFiltrosModal}
                activeOpacity={0.8}
              >
                <Text style={styles.modalBtnClearText}>Restablecer</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalBtnApply}
                onPress={handleAplicarFiltrosModal}
                activeOpacity={0.8}
              >
                <Text style={styles.modalBtnApplyText}>Aplicar Filtros</Text>
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
    color: '#94A3B8',
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
    color: '#34D399',
    fontWeight: '700',
  },

  // BARRA DE FILTROS RÁPIDOS SUPERIOR
  quickFilterBar: {
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: 8,
  },
  quickFilterScroll: {
    alignItems: 'center',
    gap: 6,
    paddingRight: 6,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterPillActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  filterPillActiveBlue: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  filterPillActiveEmerald: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  filterPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  filterPillTextActive: {
    color: '#FFFFFF',
  },
  filterPillTextActiveBlue: {
    color: '#1D4ED8',
  },
  filterPillTextActiveEmerald: {
    color: '#065F46',
  },
  filterPillCityActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#6EE7B7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  filterPillCityText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#065F46',
  },
  filterPillCityClose: {
    fontSize: 11,
    fontWeight: '900',
    color: '#047857',
    paddingLeft: 2,
  },
  btnOpenModalFiltros: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  btnOpenModalFiltrosActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  btnOpenModalIcon: {
    fontSize: 13,
  },
  btnOpenModalLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
  },

  // LISTADO Y HEADER
  listContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
    backgroundColor: '#F8FAFC',
  },
  listHeaderComponent: {
    marginBottom: 8,
  },

  // CUADRÍCULA DE KPIS (2x2)
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 16,
  },
  kpiCard: {
    width: '48.5%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  kpiCardBlue: {
    borderColor: '#DBEAFE',
    backgroundColor: '#F8FAFF',
  },
  kpiCardEmerald: {
    borderColor: '#D1FAE5',
    backgroundColor: '#F6FEF9',
  },
  kpiCardPurple: {
    borderColor: '#EDE9FE',
    backgroundColor: '#FAF8FF',
  },
  kpiCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  kpiLabel: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  kpiIconWrapDark: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiIconWrapBlue: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiIconWrapEmerald: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiIconWrapPurple: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: '#DDD6FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiIconText: {
    fontSize: 12,
  },
  kpiValueMain: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginBottom: 2,
  },
  kpiSubtext: {
    fontSize: 9.5,
    color: '#64748B',
    fontWeight: '600',
  },

  // SECCIÓN HEADER
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  sectionSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  countBadge: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  countBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#334155',
  },

  // CARD DE OPERACIÓN CON ACORDEÓN
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardExpanded: {
    borderColor: '#059669',
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  accordionHeaderTouchable: {
    paddingVertical: 2,
  },
  cardHeaderTop: {
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
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  contratoBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F172A',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  headerRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalidadBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  modalidadBadgeContado: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  modalidadBadgeCredito: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  modalidadBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  modalidadTextContado: {
    color: '#065F46',
  },
  modalidadTextCredito: {
    color: '#1D4ED8',
  },
  accordionChevronText: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '900',
    paddingHorizontal: 2,
  },

  // RESUMEN EN CABECERA (CLIENTE Y MONTO)
  accordionSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryClienteCol: {
    flex: 1,
    paddingRight: 8,
  },
  clienteNombre: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 2,
  },
  ciudadSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#059669',
  },
  summaryMontoCol: {
    alignItems: 'flex-end',
  },
  montoLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  montoPrincipal: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },

  // CUERPO EXPANDIDO
  accordionExpandedContent: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  metaBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    gap: 4,
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.4,
  },
  metaValue: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F172A',
  },

  // ARTÍCULOS
  articulosBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  articulosTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  articuloItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  articuloQty: {
    fontSize: 11,
    fontWeight: '800',
    color: '#059669',
    width: 24,
  },
  articuloNombre: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: '#1E293B',
    paddingRight: 6,
  },
  articuloSubtotal: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F172A',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  articulosResumenText: {
    fontSize: 11,
    color: '#475569',
    fontStyle: 'italic',
  },

  // PROGRESO Y FINANZAS
  progresoBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  progresoBoxTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  contadoStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  contadoStatusIcon: {
    fontSize: 14,
  },
  contadoStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#047857',
    flex: 1,
  },
  creditoFinanzasGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  finanzaCol: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  finanzaLabel: {
    fontSize: 7.5,
    fontWeight: '800',
    color: '#64748B',
    marginBottom: 2,
  },
  finanzaValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  finanzaValueRose: {
    color: '#BE123C',
  },
  finanzaValueOk: {
    color: '#059669',
  },
  finanzaSub: {
    fontSize: 8.5,
    color: '#94A3B8',
    marginTop: 2,
  },

  btnContactar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
    marginTop: 4,
  },
  btnContactarIcon: {
    fontSize: 12,
  },
  btnContactarText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  // ESTADO VACÍO
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
    marginBottom: 14,
  },
  btnResetEmpty: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  btnResetEmptyText: {
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
    color: '#059669',
    fontWeight: '700',
  },

  // MODAL DE FILTROS AVANZADOS
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxHeight: '85%',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
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
    paddingBottom: 10,
  },
  modalHeaderTitleWrap: {
    flex: 1,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSubtitle: {
    fontSize: 11,
    color: '#64748B',
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
  modalFieldGroup: {
    marginBottom: 16,
  },
  modalLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  modalInput: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '600',
  },
  dateInputsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  dateInputCol: {
    flex: 1,
  },
  subInputLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 3,
  },
  modalInputSmall: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 38,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    fontSize: 12,
    color: '#0F172A',
    fontWeight: '600',
  },
  modalPresetsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  modalPresetBtn: {
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  modalPresetBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#334155',
  },
  modalButtonGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  modalOptionBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  modalOptionBtnActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  modalOptionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  modalOptionTextActive: {
    color: '#FFFFFF',
  },
  cityChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  cityChip: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cityChipActive: {
    backgroundColor: '#ECFDF5',
    borderColor: '#059669',
  },
  cityChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  cityChipTextActive: {
    color: '#065F46',
    fontWeight: '800',
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 14,
    marginTop: 6,
  },
  modalBtnClear: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnClearText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#64748B',
  },
  modalBtnApply: {
    flex: 1.6,
    backgroundColor: '#059669',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnApplyText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
