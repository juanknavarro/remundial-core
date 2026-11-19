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
  Image,
  Alert,
  Platform,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../api/client';
import InFrameModal from '../components/InFrameModal';
import BankSelectorModal from '../components/BankSelectorModal';
import { useSync } from '../context/SyncContext';

const CACHE_KEY_ANULADAS = '@remundial_cache_ventas_anuladas';

const formatCOP = (val) => {
  const num = Math.round(Number(val) || 0);
  return '$ ' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const formatearFechaHora = (fechaStr) => {
  if (!fechaStr) return 'N/A';
  try {
    const d = new Date(fechaStr);
    if (isNaN(d.getTime())) return String(fechaStr);
    return d.toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(fechaStr);
  }
};

const normalizarBase64 = (str) => {
  if (!str) return null;
  const trimmed = str.trim();
  if (trimmed.startsWith('data:image/')) return trimmed;
  return `data:image/png;base64,${trimmed}`;
};

export default function VentasAnuladasScreen({ navigation }) {
  const { bancos: bancosContexto } = useSync();

  // Estados de control de datos
  const [ventasAnuladas, setVentasAnuladas] = useState([]);
  const [bancosList, setBancosList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('pendientes'); // 'pendientes' | 'historial'
  const [feedbackMsg, setFeedbackMsg] = useState(null);

  // Acordeón: Índice de la tarjeta expandida (por defecto la primera, índice 0)
  const [expandedIndex, setExpandedIndex] = useState(0);

  // Resetear acordeón al cambiar de pestaña o al buscar
  useEffect(() => {
    setExpandedIndex(0);
  }, [activeTab, searchTerm]);

  const toggleExpand = (index) => {
    setExpandedIndex((prev) => (prev === index ? null : index));
  };

  // Estados para modal de legalización
  const [modalLegalizar, setModalLegalizar] = useState({
    isOpen: false,
    item: null,
    referenciaPago: '',
    bancoSalida: 'Bancolombia',
    fechaGiro: new Date().toISOString().split('T')[0],
    notasOficina: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectorBancoVisible, setSelectorBancoVisible] = useState(false);

  // Estados para modal de firmas
  const [modalFirmas, setModalFirmas] = useState({
    isOpen: false,
    item: null,
  });

  // Cargar catálogo de bancos activos
  useEffect(() => {
    const cargarBancos = async () => {
      try {
        const res = await apiClient.get('/bancos?solo_activas=true');
        if (Array.isArray(res.data) && res.data.length > 0) {
          setBancosList(res.data);
          return;
        }
      } catch (err) {
        console.warn('[VentasAnuladasScreen] Fallo al cargar bancos desde backend:', err?.message);
      }
      if (Array.isArray(bancosContexto) && bancosContexto.length > 0) {
        setBancosList(bancosContexto);
      } else {
        setBancosList([
          { id: 1, nombre: 'Bancolombia', activa: true },
          { id: 2, nombre: 'Nequi', activa: true },
          { id: 3, nombre: 'Daviplata', activa: true },
        ]);
      }
    };
    cargarBancos();
  }, [bancosContexto]);

  // Consultar ventas anuladas desde backend con fallback a caché
  const cargarVentasAnuladas = useCallback(async (isPullRefresh = false) => {
    if (isPullRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const res = await apiClient.get('/auditoria/anuladas');
      if (Array.isArray(res.data)) {
        setVentasAnuladas(res.data);
        await AsyncStorage.setItem(CACHE_KEY_ANULADAS, JSON.stringify(res.data));
      }
    } catch (err) {
      console.warn('[VentasAnuladasScreen] Error al consultar auditoría, cargando caché:', err?.message);
      try {
        const cachedStr = await AsyncStorage.getItem(CACHE_KEY_ANULADAS);
        if (cachedStr) {
          const cached = JSON.parse(cachedStr);
          if (Array.isArray(cached)) {
            setVentasAnuladas(cached);
          }
        }
      } catch (_) {}
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    cargarVentasAnuladas();
  }, [cargarVentasAnuladas]);

  // Segmentación por estado
  const pendientes = useMemo(() => {
    return ventasAnuladas.filter((v) => v.estado_devolucion === 'PENDIENTE_REEMBOLSO_TRANSFERENCIA');
  }, [ventasAnuladas]);

  const historial = useMemo(() => {
    return ventasAnuladas.filter(
      (v) => v.estado_devolucion === 'REEMBOLSADO_OFICINA' || v.estado_devolucion === 'EFECTIVO_DEVUELTO_EN_RUTA'
    );
  }, [ventasAnuladas]);

  // Cálculo de KPIs superiores
  const kpis = useMemo(() => {
    const totalMontoPendiente = pendientes.reduce((acc, curr) => acc + Number(curr.monto_total || 0), 0);
    const totalMontoLegalizado = historial.reduce((acc, curr) => acc + Number(curr.monto_total || 0), 0);
    return {
      pendientesCount: pendientes.length,
      historialCount: historial.length,
      totalMontoPendiente,
      totalMontoLegalizado,
    };
  }, [pendientes, historial]);

  // Filtrado reactivo en vivo
  const itemsFiltrados = useMemo(() => {
    const baseList = activeTab === 'pendientes' ? pendientes : historial;
    if (!searchTerm.trim()) return baseList;

    const term = searchTerm.toLowerCase().trim();
    return baseList.filter((item) => {
      const vendedor = (item.vendedor_nombre || '').toLowerCase();
      const vendedorId = (item.vendedor_id || '').toLowerCase();
      const banco = (item.banco_destino_cliente || item.banco_origen_reembolso || '').toLowerCase();
      const cuenta = (item.cuenta_destino_cliente || '').toLowerCase();
      const ref = (item.referencia_original || item.referencia_reembolso_oficina || '').toLowerCase();
      const notas = (item.notas_vendedor || '').toLowerCase();
      const notasOfi = (item.notas_oficina || '').toLowerCase();

      const articulos = Array.isArray(item.articulos_json) ? item.articulos_json : [];
      const articulosTexto = articulos.map((a) => a.nombre || '').join(' ').toLowerCase();

      return (
        vendedor.includes(term) ||
        vendedorId.includes(term) ||
        banco.includes(term) ||
        cuenta.includes(term) ||
        ref.includes(term) ||
        notas.includes(term) ||
        notasOfi.includes(term) ||
        articulosTexto.includes(term)
      );
    });
  }, [activeTab, pendientes, historial, searchTerm]);

  // Abrir Modal de Legalización
  const abrirModalLegalizar = (item) => {
    const defaultBanco = bancosList[0]?.nombre || 'Bancolombia';
    setModalLegalizar({
      isOpen: true,
      item,
      referenciaPago: '',
      bancoSalida: defaultBanco,
      fechaGiro: new Date().toISOString().split('T')[0],
      notasOficina: '',
    });
  };

  const cerrarModalLegalizar = () => {
    if (isSubmitting) return;
    setModalLegalizar((prev) => ({ ...prev, isOpen: false, item: null }));
  };

  // Confirmar y registrar legalización
  const handleConfirmarLegalizacion = async () => {
    if (!modalLegalizar.item) return;

    if (!modalLegalizar.referenciaPago.trim()) {
      Alert.alert(
        'Campo Requerido',
        'Por favor ingresa la Referencia de Pago / Comprobante de Giro emitido por tesorería.'
      );
      return;
    }

    try {
      setIsSubmitting(true);
      const payload = {
        referencia_reembolso_oficina: modalLegalizar.referenciaPago.trim(),
        banco_origen_reembolso: modalLegalizar.bancoSalida.trim(),
        fecha_reembolso: modalLegalizar.fechaGiro
          ? new Date(modalLegalizar.fechaGiro).toISOString()
          : new Date().toISOString(),
        notas_oficina: modalLegalizar.notasOficina.trim() || undefined,
      };

      const res = await apiClient.patch(
        `/auditoria/anuladas/${modalLegalizar.item.id}/reembolsar`,
        payload
      );

      if (res.status === 200 || res.status === 204) {
        setFeedbackMsg({
          tipo: 'success',
          texto: `Reembolso legalizado exitosamente con comprobante ${modalLegalizar.referenciaPago.trim()}.`,
        });
        cerrarModalLegalizar();
        await cargarVentasAnuladas();
      }
    } catch (err) {
      console.error('[VentasAnuladasScreen] Error al legalizar:', err);
      const detail = err.response?.data?.detail || err.message || 'Error en la operación';
      Alert.alert(
        'Error al Legalizar',
        typeof detail === 'string' ? detail : JSON.stringify(detail)
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Renderizar cada tarjeta de anulación
  const renderItem = ({ item, index }) => {
    const isExpanded = expandedIndex === index;
    const articulos = Array.isArray(item.articulos_json) ? item.articulos_json : [];
    const esTransferencia = item.estado_devolucion === 'PENDIENTE_REEMBOLSO_TRANSFERENCIA';
    const esEfectivoRuta = item.estado_devolucion === 'EFECTIVO_DEVUELTO_EN_RUTA';
    const esReembolsadoOficina = item.estado_devolucion === 'REEMBOLSADO_OFICINA';
    const tieneFirmas = Boolean(item.firma_cliente || item.firma_vendedor);

    return (
      <View style={styles.cardItem}>
        {/* Cabecera Clickeable / Toggle del Acordeón */}
        <TouchableOpacity
          onPress={() => toggleExpand(index)}
          activeOpacity={0.7}
          style={styles.cardHeaderTouchable}
        >
          {/* Cabecera de la tarjeta: Fecha y Badge de Estado */}
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardFecha}>
              {formatearFechaHora(item.fecha || item.creado_en)}
            </Text>

            <View style={styles.headerRightWrap}>
              {esTransferencia && (
                <View style={styles.badgeAmber}>
                  <Text style={styles.badgeAmberText}>⏳ PENDIENTE GIRO</Text>
                </View>
              )}
              {esEfectivoRuta && (
                <View style={styles.badgeGreen}>
                  <Text style={styles.badgeGreenText}>💵 DEVUELTO EN RUTA</Text>
                </View>
              )}
              {esReembolsadoOficina && (
                <View style={styles.badgeBlue}>
                  <Text style={styles.badgeBlueText}>✓ REEMBOLSADO OFICINA</Text>
                </View>
              )}
            </View>
          </View>

          {/* Fila Asesor y Monto */}
          <View style={[styles.cardMainRow, !isExpanded && { paddingBottom: 2 }]}>
            <View style={styles.vendedorWrap}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarText}>
                  {item.vendedor_nombre ? item.vendedor_nombre.slice(0, 2).toUpperCase() : 'VE'}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.vendedorNombre} numberOfLines={1}>
                  {item.vendedor_nombre || 'Asesor Comercial'}
                </Text>
                <Text style={styles.vendedorId}>
                  ID: {item.vendedor_id ? String(item.vendedor_id).slice(0, 8) : 'N/A'}...
                </Text>
              </View>
            </View>

            <View style={styles.montoWrap}>
              <Text style={styles.montoLabel}>Monto a Devolver</Text>
              <Text style={styles.montoValor}>{formatCOP(item.monto_total)}</Text>
              <Text style={styles.montoOrig}>
                Orig: {item.metodo_pago_original}
                {item.referencia_original ? ` (${item.referencia_original})` : ''}
              </Text>
            </View>
          </View>

          {/* Indicador visual sutil de acordeón */}
          <View style={styles.accordionToggleRow}>
            <Text style={styles.accordionToggleText}>
              {isExpanded ? 'Ocultar detalle ▴' : 'Ver detalle ▾'}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Bloque Detallado Expandible (Solo visible si isExpanded) */}
        {isExpanded && (
          <View style={styles.cardExpandedContent}>
            {/* Desglose de Artículos */}
            <View style={styles.articulosBox}>
              <Text style={styles.articulosLabel}>Artículos Devueltos:</Text>
              <Text style={styles.articulosTexto}>
                {articulos.length > 0
                  ? articulos.map((a) => `${a.cantidad || 1}x ${a.nombre || 'Artículo'}`).join(', ')
                  : 'Venta por catálogo'}
              </Text>
              {item.notas_vendedor ? (
                <Text style={styles.notasVendedor} numberOfLines={2}>
                  "{item.notas_vendedor}"
                </Text>
              ) : null}
            </View>

            {/* Datos Bancarios de Destino o Comprobante */}
            {activeTab === 'pendientes' ? (
              <View style={styles.infoBancariaBox}>
                <View style={styles.infoBancariaRow}>
                  <Text style={styles.infoBancariaIcon}>🏦</Text>
                  <Text style={styles.infoBancariaBanco}>
                    {item.banco_destino_cliente || 'Banco no especificado'}
                  </Text>
                </View>
                <Text style={styles.infoBancariaCuenta}>
                  No. Cuenta: {item.cuenta_destino_cliente || 'N/A'}
                </Text>
              </View>
            ) : (
              <View style={styles.infoBancariaBox}>
                {esEfectivoRuta ? (
                  <View style={styles.infoBancariaRow}>
                    <Text style={styles.infoBancariaIcon}>💵</Text>
                    <Text style={styles.infoBancariaVerde}>
                      Efectivo devuelto en mano al cliente en terreno
                    </Text>
                  </View>
                ) : (
                  <View>
                    <Text style={styles.infoReembolsoRef}>
                      Ref Giro Tesorería: {item.referencia_reembolso_oficina || 'S/R'}
                    </Text>
                    <Text style={styles.infoReembolsoDetalle}>
                      Salida: {item.banco_origen_reembolso || 'Oficina'} • {formatearFechaHora(item.fecha_reembolso)}
                    </Text>
                    {item.notas_oficina ? (
                      <Text style={styles.infoReembolsoNotas}>"{item.notas_oficina}"</Text>
                    ) : null}
                  </View>
                )}
              </View>
            )}

            {/* Pie de la Tarjeta con Badges de Firma y Botones de Acción */}
            <View style={styles.cardFooter}>
              {/* Indicador de Firmas */}
              <View>
                {item.firma_cliente && item.firma_vendedor ? (
                  <View style={styles.badgeDobleFirma}>
                    <Text style={styles.badgeDobleFirmaText}>✓ Doble Firma OK</Text>
                  </View>
                ) : tieneFirmas ? (
                  <View style={styles.badgeUnaFirma}>
                    <Text style={styles.badgeUnaFirmaText}>✍️ 1 Firma Registrada</Text>
                  </View>
                ) : (
                  <Text style={styles.sinFirmasText}>Sin firmas registradas</Text>
                )}
              </View>

              {/* Botones de Acción */}
              <View style={styles.actionsRow}>
                {tieneFirmas && (
                  <TouchableOpacity
                    style={styles.btnFirmas}
                    onPress={() => setModalFirmas({ isOpen: true, item })}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.btnFirmasText}>✍️ Ver Firmas</Text>
                  </TouchableOpacity>
                )}

                {activeTab === 'pendientes' && (
                  <TouchableOpacity
                    style={styles.btnLegalizar}
                    onPress={() => abrirModalLegalizar(item)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.btnLegalizarText}>Legalizar Giro →</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* CABECERA PRINCIPAL */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            accessibilityLabel="Regresar al panel"
          >
            <Text style={styles.backBtnText}>←</Text>
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>Ventas Anuladas & Devoluciones</Text>
            <Text style={styles.headerSubtitle}>
              Auditoría de quiebres, retornos y liquidación de reembolsos
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => cargarVentasAnuladas(true)}
          disabled={isRefreshing}
          accessibilityLabel="Refrescar datos"
        >
          {isRefreshing ? (
            <ActivityIndicator size="small" color="#059669" />
          ) : (
            <Text style={styles.refreshBtnText}>↻</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* FEEDBACK BANNER SI APLICA */}
      {feedbackMsg && (
        <View
          style={[
            styles.feedbackBanner,
            feedbackMsg.tipo === 'success' ? styles.feedbackSuccess : styles.feedbackError,
          ]}
        >
          <Text style={styles.feedbackText}>{feedbackMsg.texto}</Text>
          <TouchableOpacity onPress={() => setFeedbackMsg(null)}>
            <Text style={styles.feedbackClose}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* SCROLL HORIZONTAL DE 3 TARJETAS KPI */}
      <View style={styles.kpiContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.kpiScroll}
        >
          {/* KPI 1: Pendientes por Girar */}
          <TouchableOpacity
            style={[styles.kpiCard, activeTab === 'pendientes' && styles.kpiCardActiveAmber]}
            onPress={() => setActiveTab('pendientes')}
            activeOpacity={0.8}
          >
            <View style={styles.kpiIconWrapAmber}>
              <Text style={styles.kpiIconText}>⏳</Text>
            </View>
            <Text style={styles.kpiLabel}>PENDIENTES POR GIRAR</Text>
            <Text style={styles.kpiValueAmber}>{formatCOP(kpis.totalMontoPendiente)}</Text>
            <Text style={styles.kpiSub}>
              {kpis.pendientesCount} {kpis.pendientesCount === 1 ? 'caso pendiente' : 'casos pendientes'}
            </Text>
          </TouchableOpacity>

          {/* KPI 2: Historial Legalizado */}
          <TouchableOpacity
            style={[styles.kpiCard, activeTab === 'historial' && styles.kpiCardActiveGreen]}
            onPress={() => setActiveTab('historial')}
            activeOpacity={0.8}
          >
            <View style={styles.kpiIconWrapGreen}>
              <Text style={styles.kpiIconText}>📑</Text>
            </View>
            <Text style={styles.kpiLabel}>HISTORIAL LEGALIZADO</Text>
            <Text style={styles.kpiValueGreen}>{formatCOP(kpis.totalMontoLegalizado)}</Text>
            <Text style={styles.kpiSub}>{kpis.historialCount} casos conciliados</Text>
          </TouchableOpacity>

          {/* KPI 3: Control de Inventario */}
          <View style={styles.kpiCard}>
            <View style={styles.kpiIconWrapBlue}>
              <Text style={styles.kpiIconText}>📦</Text>
            </View>
            <Text style={styles.kpiLabel}>CONTROL DE INVENTARIO</Text>
            <Text style={styles.kpiValueBlue}>100% Stock Reintegrado</Text>
            <Text style={styles.kpiSub}>0% tolerancia sobreventa</Text>
          </View>
        </ScrollView>
      </View>

      {/* PESTAÑAS OPERATIVAS (TABS) */}
      <View style={styles.tabsRow}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'pendientes' && styles.tabBtnActive]}
          onPress={() => setActiveTab('pendientes')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabBtnText, activeTab === 'pendientes' && styles.tabBtnTextActive]}>
            Pendientes de Reembolso
          </Text>
          <View
            style={[
              styles.tabCounter,
              activeTab === 'pendientes' ? styles.tabCounterActive : styles.tabCounterInactive,
            ]}
          >
            <Text
              style={[
                styles.tabCounterText,
                activeTab === 'pendientes' && styles.tabCounterTextActive,
              ]}
            >
              {kpis.pendientesCount}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'historial' && styles.tabBtnActive]}
          onPress={() => setActiveTab('historial')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabBtnText, activeTab === 'historial' && styles.tabBtnTextActive]}>
            Historial Legalizado
          </Text>
          <View
            style={[
              styles.tabCounter,
              activeTab === 'historial' ? styles.tabCounterActive : styles.tabCounterInactive,
            ]}
          >
            <Text
              style={[
                styles.tabCounterText,
                activeTab === 'historial' && styles.tabCounterTextActive,
              ]}
            >
              {kpis.historialCount}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* BARRA DE BÚSQUEDA REACTIVA */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por asesor, banco, cuenta o ref..."
            placeholderTextColor="#94A3B8"
            value={searchTerm}
            onChangeText={setSearchTerm}
            clearButtonMode="while-editing"
          />
          {searchTerm.length > 0 && (
            <TouchableOpacity onPress={() => setSearchTerm('')} style={styles.searchClearBtn}>
              <Text style={styles.searchClearText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* LISTADO DE CASOS / ESTADO DE CARGA / VACÍO */}
      {isLoading && !isRefreshing ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#059669" />
          <Text style={styles.loadingText}>Consultando auditoría de ventas anuladas...</Text>
        </View>
      ) : itemsFiltrados.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>
            {activeTab === 'pendientes' ? '✓' : '📂'}
          </Text>
          <Text style={styles.emptyTitle}>
            {activeTab === 'pendientes'
              ? '¡Al día! No hay reembolsos pendientes'
              : 'No hay registros en el historial legalizado'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {activeTab === 'pendientes'
              ? 'Todas las ventas anuladas por transferencia han sido legalizadas con comprobante de tesorería.'
              : 'Las devoluciones conciliadas aparecerán aquí para trazabilidad contable.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={itemsFiltrados}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          extraData={expandedIndex}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => cargarVentasAnuladas(true)}
              colors={['#059669']}
              tintColor="#059669"
            />
          }
        />
      )}

      {/* MODAL: AUDITORÍA VISUAL DE FIRMAS DIGITALES */}
      <InFrameModal
        visible={modalFirmas.isOpen}
        animationType="fade"
        onRequestClose={() => setModalFirmas({ isOpen: false, item: null })}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCardWide}>
            {/* Header del Modal */}
            <View style={styles.modalHeaderDark}>
              <View style={{ flex: 1 }}>
                <View style={styles.modalHeaderBadgeRow}>
                  <Text style={styles.modalHeaderIcon}>✍️</Text>
                  <Text style={styles.modalHeaderTitle}>Auditoría de Firmas</Text>
                  <View style={styles.modalLegalBadge}>
                    <Text style={styles.modalLegalBadgeText}>SOPORTE LEGAL</Text>
                  </View>
                </View>
                <Text style={styles.modalHeaderSub}>
                  Expediente ID: {modalFirmas.item?.id ? String(modalFirmas.item.id).slice(0, 12) : ''}...
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setModalFirmas({ isOpen: false, item: null })}
                style={styles.modalCloseBtn}
              >
                <Text style={styles.modalCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Contenido de Firmas */}
            <ScrollView style={styles.modalScrollBody} showsVerticalScrollIndicator={false}>
              {/* Tarjeta de Resumen Rápido */}
              <View style={styles.modalSummaryBox}>
                <View style={styles.modalSummaryRow}>
                  <Text style={styles.modalSummaryLabel}>Asesor:</Text>
                  <Text style={styles.modalSummaryValue}>
                    {modalFirmas.item?.vendedor_nombre || 'Asesor'}
                  </Text>
                </View>
                <View style={styles.modalSummaryRow}>
                  <Text style={styles.modalSummaryLabel}>Monto Anulado:</Text>
                  <Text style={styles.modalSummaryMonto}>
                    {formatCOP(modalFirmas.item?.monto_total)}
                  </Text>
                </View>
                <View style={styles.modalSummaryRow}>
                  <Text style={styles.modalSummaryLabel}>Fecha:</Text>
                  <Text style={styles.modalSummaryValue}>
                    {formatearFechaHora(modalFirmas.item?.fecha || modalFirmas.item?.creado_en)}
                  </Text>
                </View>
              </View>

              {/* Firma 1: Cliente */}
              <View style={styles.firmaBox}>
                <View style={styles.firmaHeaderRow}>
                  <Text style={styles.firmaTitulo}>1. FIRMA DEL CLIENTE</Text>
                  <Text style={styles.firmaBadge}>Reembolso Aceptado</Text>
                </View>
                <Text style={styles.firmaDesc}>
                  Constancia de liquidación y cuenta saldada a satisfacción.
                </Text>
                <View style={styles.firmaCanvasArea}>
                  {modalFirmas.item?.firma_cliente ? (
                    <Image
                      source={{ uri: normalizarBase64(modalFirmas.item.firma_cliente) }}
                      style={styles.firmaImage}
                      resizeMode="contain"
                    />
                  ) : (
                    <View style={styles.firmaEmptyArea}>
                      <Text style={styles.firmaEmptyIcon}>⚠️</Text>
                      <Text style={styles.firmaEmptyText}>Sin firma del cliente registrada</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Firma 2: Asesor Comercial */}
              <View style={styles.firmaBox}>
                <View style={styles.firmaHeaderRow}>
                  <Text style={styles.firmaTitulo}>2. FIRMA DEL ASESOR / VENDEDOR</Text>
                  <Text style={styles.firmaBadgeIndigo}>Responsable en Ruta</Text>
                </View>
                <Text style={styles.firmaDesc}>
                  Declaración jurada del estado de entrega e inventario reintegrado.
                </Text>
                <View style={styles.firmaCanvasArea}>
                  {modalFirmas.item?.firma_vendedor ? (
                    <Image
                      source={{ uri: normalizarBase64(modalFirmas.item.firma_vendedor) }}
                      style={styles.firmaImage}
                      resizeMode="contain"
                    />
                  ) : (
                    <View style={styles.firmaEmptyArea}>
                      <Text style={styles.firmaEmptyIcon}>⚠️</Text>
                      <Text style={styles.firmaEmptyText}>Sin firma del asesor registrada</Text>
                    </View>
                  )}
                </View>
              </View>
            </ScrollView>

            {/* Pie del Modal */}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalBtnCerrar}
                onPress={() => setModalFirmas({ isOpen: false, item: null })}
              >
                <Text style={styles.modalBtnCerrarText}>Cerrar Expediente</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </InFrameModal>

      {/* MODAL: LEGALIZAR REEMBOLSO BANCARIO */}
      <InFrameModal
        visible={modalLegalizar.isOpen}
        animationType="fade"
        onRequestClose={cerrarModalLegalizar}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalCard}>
            {/* Header del Modal */}
            <View style={styles.modalHeaderDark}>
              <View style={{ flex: 1 }}>
                <View style={styles.modalHeaderBadgeRow}>
                  <Text style={styles.modalHeaderIcon}>🏦</Text>
                  <Text style={styles.modalHeaderTitle}>Legalizar Reembolso</Text>
                </View>
                <Text style={styles.modalHeaderSub}>
                  Comprobante de giro emitido por la tesorería
                </Text>
              </View>
              <TouchableOpacity
                onPress={cerrarModalLegalizar}
                disabled={isSubmitting}
                style={styles.modalCloseBtn}
              >
                <Text style={styles.modalCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScrollBody} showsVerticalScrollIndicator={false}>
              {/* Tarjeta de Resumen del Caso */}
              <View style={styles.modalSummaryBox}>
                <View style={styles.modalSummaryRow}>
                  <Text style={styles.modalSummaryLabel}>Monto a Devolver:</Text>
                  <Text style={styles.modalSummaryMontoRojo}>
                    {formatCOP(modalLegalizar.item?.monto_total)}
                  </Text>
                </View>
                <View style={styles.modalSummaryRow}>
                  <Text style={styles.modalSummaryLabel}>Asesor en Ruta:</Text>
                  <Text style={styles.modalSummaryValue}>
                    {modalLegalizar.item?.vendedor_nombre || 'Asesor'}
                  </Text>
                </View>
                <View style={styles.modalSummaryDivider} />
                <View style={styles.modalSummaryRow}>
                  <Text style={styles.modalSummaryLabel}>Banco Destino:</Text>
                  <Text style={styles.modalSummaryBanco}>
                    {modalLegalizar.item?.banco_destino_cliente || 'N/A'}
                  </Text>
                </View>
                <View style={styles.modalSummaryRow}>
                  <Text style={styles.modalSummaryLabel}>Cuenta Destino:</Text>
                  <Text style={styles.modalSummaryCuenta}>
                    {modalLegalizar.item?.cuenta_destino_cliente || 'N/A'}
                  </Text>
                </View>
              </View>

              {/* Formulario */}
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>
                  NUEVA REFERENCIA / COMPROBANTE DE GIRO (*)
                </Text>
                <TextInput
                  style={styles.textInputBold}
                  placeholder="Ej: NEQ-987654321, BCOL-554433"
                  placeholderTextColor="#94A3B8"
                  value={modalLegalizar.referenciaPago}
                  onChangeText={(val) =>
                    setModalLegalizar((prev) => ({ ...prev, referenciaPago: val }))
                  }
                  autoCapitalize="characters"
                />
                <Text style={styles.inputHelp}>
                  Código o ID de aprobación entregado por el banco al transferir los fondos.
                </Text>
              </View>

              {/* Selector de Banco de Salida */}
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>BANCO DE SALIDA (OFICINA) (*)</Text>
                <TouchableOpacity
                  style={styles.selectBancoBtn}
                  onPress={() => setSelectorBancoVisible(true)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.selectBancoText}>
                    🏦 {modalLegalizar.bancoSalida || 'Seleccionar Banco...'}
                  </Text>
                  <Text style={styles.selectBancoArrow}>▼</Text>
                </TouchableOpacity>
              </View>

              {/* Fecha de Giro */}
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>FECHA DE GIRO (YYYY-MM-DD) (*)</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#94A3B8"
                  value={modalLegalizar.fechaGiro}
                  onChangeText={(val) =>
                    setModalLegalizar((prev) => ({ ...prev, fechaGiro: val }))
                  }
                />
              </View>

              {/* Observaciones de Oficina */}
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>OBSERVACIONES DE TESORERÍA (OPCIONAL)</Text>
                <TextInput
                  style={styles.textArea}
                  placeholder="Ej: Giro realizado por tesorería. Comprobante enviado por WhatsApp al cliente..."
                  placeholderTextColor="#94A3B8"
                  value={modalLegalizar.notasOficina}
                  onChangeText={(val) =>
                    setModalLegalizar((prev) => ({ ...prev, notasOficina: val }))
                  }
                  multiline
                  numberOfLines={3}
                />
              </View>
            </ScrollView>

            {/* Acciones del Modal */}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalBtnCancelar}
                onPress={cerrarModalLegalizar}
                disabled={isSubmitting}
              >
                <Text style={styles.modalBtnCancelarText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalBtnConfirmar}
                onPress={handleConfirmarLegalizacion}
                disabled={isSubmitting}
                activeOpacity={0.8}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalBtnConfirmarText}>Confirmar Giro ✓</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </InFrameModal>

      {/* SELECTOR MODAL DE BANCO REUTILIZABLE */}
      <BankSelectorModal
        visible={selectorBancoVisible}
        onClose={() => setSelectorBancoVisible(false)}
        bancos={bancosList}
        selectedBanco={modalLegalizar.bancoSalida}
        onSelectBanco={(banco) => {
          setModalLegalizar((prev) => ({ ...prev, bancoSalida: banco }));
          setSelectorBancoVisible(false);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  backBtnText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  refreshBtnText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#059669',
  },

  /* FEEDBACK */
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 14,
    marginTop: 10,
    borderRadius: 10,
  },
  feedbackSuccess: {
    backgroundColor: '#D1FAE5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  feedbackError: {
    backgroundColor: '#FFE4E6',
    borderWidth: 1,
    borderColor: '#FECDD3',
  },
  feedbackText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#065F46',
    flex: 1,
  },
  feedbackClose: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#065F46',
    marginLeft: 8,
  },

  /* KPIS */
  kpiContainer: {
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  kpiScroll: {
    paddingHorizontal: 14,
    gap: 10,
  },
  kpiCard: {
    width: 200,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  kpiCardActiveAmber: {
    borderColor: '#F59E0B',
    backgroundColor: '#FFFBEB',
  },
  kpiCardActiveGreen: {
    borderColor: '#10B981',
    backgroundColor: '#ECFDF5',
  },
  kpiIconWrapAmber: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  kpiIconWrapGreen: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#D1FAE5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  kpiIconWrapBlue: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  kpiIconText: {
    fontSize: 16,
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  kpiValueAmber: {
    fontSize: 16,
    fontWeight: '800',
    color: '#D97706',
  },
  kpiValueGreen: {
    fontSize: 16,
    fontWeight: '800',
    color: '#059669',
  },
  kpiValueBlue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#2563EB',
  },
  kpiSub: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },

  /* TABS */
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: 8,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
  },
  tabBtnActive: {
    backgroundColor: '#0F172A',
  },
  tabBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  tabBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  tabCounter: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
  },
  tabCounterActive: {
    backgroundColor: '#334155',
  },
  tabCounterInactive: {
    backgroundColor: '#E2E8F0',
  },
  tabCounterText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
  },
  tabCounterTextActive: {
    color: '#FFFFFF',
  },

  /* BUSCADOR */
  searchContainer: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    height: 38,
  },
  searchIcon: {
    fontSize: 13,
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    color: '#0F172A',
    paddingVertical: 0,
  },
  searchClearBtn: {
    padding: 4,
  },
  searchClearText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: 'bold',
  },

  /* LISTADO */
  listContent: {
    padding: 14,
    gap: 12,
  },
  cardItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  cardHeaderTouchable: {
    // Área interactiva de cabecera para toggle de acordeón
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerRightWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardFecha: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  badgeAmber: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  badgeAmberText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#92400E',
  },
  badgeGreen: {
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  badgeGreenText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#065F46',
  },
  badgeBlue: {
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  badgeBlueText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1E40AF',
  },

  cardMainRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 10,
    gap: 12,
  },
  vendedorWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  avatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  avatarText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#475569',
  },
  vendedorNombre: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  vendedorId: {
    fontSize: 10,
    color: '#94A3B8',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  montoWrap: {
    alignItems: 'flex-end',
  },
  montoLabel: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '600',
  },
  montoValor: {
    fontSize: 15,
    fontWeight: '800',
    color: '#E11D48',
  },
  montoOrig: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 1,
  },

  /* ACORDEÓN EXPANDIBLE */
  accordionToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 6,
    paddingBottom: 2,
  },
  accordionToggleText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#2563EB',
    letterSpacing: 0.2,
  },
  cardExpandedContent: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    marginTop: 4,
  },

  articulosBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    marginBottom: 10,
  },
  articulosLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  articulosTexto: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0F172A',
  },
  notasVendedor: {
    fontSize: 11,
    fontStyle: 'italic',
    color: '#64748B',
    marginTop: 4,
  },

  infoBancariaBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#DBEAFE',
    marginBottom: 10,
  },
  infoBancariaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoBancariaIcon: {
    fontSize: 12,
  },
  infoBancariaBanco: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E40AF',
  },
  infoBancariaCuenta: {
    fontSize: 11,
    fontWeight: '600',
    color: '#3B82F6',
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  infoBancariaVerde: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  infoReembolsoRef: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  infoReembolsoDetalle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  infoReembolsoNotas: {
    fontSize: 11,
    fontStyle: 'italic',
    color: '#475569',
    marginTop: 3,
  },

  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    gap: 8,
  },
  badgeDobleFirma: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  badgeDobleFirmaText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4338CA',
  },
  badgeUnaFirma: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  badgeUnaFirmaText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B45309',
  },
  sinFirmasText: {
    fontSize: 10,
    color: '#94A3B8',
    fontStyle: 'italic',
  },

  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  btnFirmas: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  btnFirmasText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  btnLegalizar: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#2563EB',
  },
  btnLegalizarText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  /* EMPTY / LOADING */
  loadingBox: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  emptyBox: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 14,
    marginTop: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyIcon: {
    fontSize: 28,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 11,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
  },

  /* MODALES */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
    maxHeight: '85%',
  },
  modalCardWide: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
    maxHeight: '90%',
  },
  modalHeaderDark: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalHeaderBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modalHeaderIcon: {
    fontSize: 16,
  },
  modalHeaderTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  modalLegalBadge: {
    backgroundColor: 'rgba(99, 102, 241, 0.25)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(165, 180, 252, 0.3)',
  },
  modalLegalBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#C7D2FE',
  },
  modalHeaderSub: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: 6,
  },
  modalCloseBtnText: {
    fontSize: 16,
    color: '#94A3B8',
    fontWeight: 'bold',
  },
  modalScrollBody: {
    padding: 16,
  },
  modalSummaryBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
    gap: 6,
  },
  modalSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalSummaryLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  modalSummaryValue: {
    fontSize: 11,
    color: '#0F172A',
    fontWeight: '700',
  },
  modalSummaryMonto: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSummaryMontoRojo: {
    fontSize: 15,
    fontWeight: '800',
    color: '#E11D48',
  },
  modalSummaryDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 2,
  },
  modalSummaryBanco: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
  },
  modalSummaryCuenta: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F172A',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  /* FORM LEGALIZAR */
  formGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  inputHelp: {
    fontSize: 9,
    color: '#94A3B8',
    marginTop: 3,
  },
  textInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 12,
    color: '#0F172A',
  },
  textInputBold: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#3B82F6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 12,
    fontWeight: 'bold',
    color: '#0F172A',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  textArea: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 12,
    color: '#0F172A',
    textAlignVertical: 'top',
  },
  selectBancoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  selectBancoText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  selectBancoArrow: {
    fontSize: 10,
    color: '#64748B',
  },

  /* FIRMAS BOX */
  firmaBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  firmaHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  firmaTitulo: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F172A',
  },
  firmaBadge: {
    fontSize: 9,
    fontWeight: '700',
    backgroundColor: '#D1FAE5',
    color: '#065F46',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  firmaBadgeIndigo: {
    fontSize: 9,
    fontWeight: '700',
    backgroundColor: '#EEF2FF',
    color: '#4338CA',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  firmaDesc: {
    fontSize: 10,
    color: '#64748B',
    marginBottom: 8,
  },
  firmaCanvasArea: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
    borderRadius: 10,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  firmaImage: {
    width: '100%',
    height: '100%',
  },
  firmaEmptyArea: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  firmaEmptyIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  firmaEmptyText: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },

  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    gap: 10,
  },
  modalBtnCancelar: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  modalBtnCancelarText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  modalBtnConfirmar: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  modalBtnConfirmarText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalBtnCerrar: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  modalBtnCerrarText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
