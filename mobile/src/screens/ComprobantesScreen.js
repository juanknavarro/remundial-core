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
  Share,
  Platform,
} from 'react-native';
import apiClient from '../api/client';
import {
  guardarEnCache,
  obtenerDeCache,
  STORAGE_KEYS,
} from '../storage/database';
import { obtenerConfigEmpresa } from '../utils/empresa';

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

export default function ComprobantesScreen({ navigation }) {
  const [transacciones, setTransacciones] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('todos'); // 'todos' | 'abono' | 'venta'
  const [expandedIndex, setExpandedIndex] = useState(0);
  const [empresaNombre, setEmpresaNombre] = useState(process.env.EXPO_PUBLIC_APP_NAME || 'Sistema Comercial');

  useEffect(() => {
    obtenerConfigEmpresa().then((cfg) => {
      if (cfg?.razon_social) {
        setEmpresaNombre(cfg.razon_social);
      }
    });
  }, []);

  // Cargar historial reciente de transacciones (Abonos + Ventas)
  const cargarHistorial = useCallback(async (isPullRefresh = false) => {
    if (isPullRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const [resAbonos, resCreditos] = await Promise.allSettled([
        apiClient.get('/abonos'),
        apiClient.get('/creditos'),
      ]);

      const listaUnificada = [];

      // 1. Procesar Abonos
      if (resAbonos.status === 'fulfilled' && Array.isArray(resAbonos.value.data)) {
        resAbonos.value.data.forEach((a) => {
          if (a.estado === 'anulado') return;
          const fDt = new Date(a.fecha || a.creado_en || Date.now());
          const folio = a.id_recibo ? `REC-${String(a.id_recibo).slice(0, 10).toUpperCase()}` : 'REC-S/N';
          const metodo = (a.metodo_pago || 'efectivo').toLowerCase().trim();
          const transfArr = Array.isArray(a.transferencias) && a.transferencias.length > 0
            ? a.transferencias.map((t) => ({
                entidad_bancaria: t.entidad_bancaria || '',
                referencia_pago: t.referencia_pago || '',
                monto: Number(t.monto || 0),
              }))
            : (a.banco_transferencia || a.referencia_pago)
              ? [{
                  entidad_bancaria: a.banco_transferencia || 'Bancolombia',
                  referencia_pago: a.referencia_pago || 'S/R',
                  monto: Number(a.monto_transferencia || a.valor_abonado || 0),
                }]
              : [];

          const sumTransf = transfArr.reduce((acc, t) => acc + (Number(t.monto) || 0), 0);
          const montoTransf = a.monto_transferencia !== undefined && a.monto_transferencia !== null && Number(a.monto_transferencia) > 0
            ? Number(a.monto_transferencia)
            : sumTransf > 0
            ? sumTransf
            : (metodo === 'transferencia' ? Number(a.valor_abonado || 0) : 0);

          const montoEf = a.monto_efectivo !== undefined && a.monto_efectivo !== null && Number(a.monto_efectivo) > 0
            ? Number(a.monto_efectivo)
            : (metodo === 'efectivo' ? Number(a.valor_abonado || 0) : Math.max(0, Number(a.valor_abonado || 0) - montoTransf));

          listaUnificada.push({
            id: `abono-${a.id_recibo}`,
            folio,
            cliente: a.cliente_nombre || 'Cliente Titular',
            cedula: a.cliente_cedula || '',
            tipo: 'Abono de Cuota',
            tipoCodigo: 'abono',
            monto: Number(a.valor_abonado || 0),
            fecha: fDt,
            fechaTexto: formatearFechaLarga(fDt),
            responsable: a.cobrador?.nombre || a.cobrador_nombre || 'Cobrador en Ruta',
            sector: a.ciudad || a.ciudad_venta || 'Ruta de Cobro',
            contratoReferencia: a.credito_id ? `CTR-${String(a.credito_id).slice(0, 8).toUpperCase()}` : null,
            metodo_pago: metodo,
            monto_efectivo: montoEf,
            monto_transferencia: montoTransf,
            transferencias: transfArr,
          });
        });
        guardarEnCache(STORAGE_KEYS.CACHE_ABONOS, resAbonos.value.data);
      } else {
        const cached = await obtenerDeCache(STORAGE_KEYS.CACHE_ABONOS);
        if (Array.isArray(cached)) {
          cached.forEach((a) => {
            const fDt = new Date(a.fecha || Date.now());
            const metodo = (a.metodo_pago || 'efectivo').toLowerCase().trim();
            const transfArr = Array.isArray(a.transferencias) ? a.transferencias : [];
            listaUnificada.push({
              id: `abono-${a.id_recibo}`,
              folio: `REC-${String(a.id_recibo).slice(0, 10).toUpperCase()}`,
              cliente: a.cliente_nombre || 'Cliente Titular',
              cedula: a.cliente_cedula || '',
              tipo: 'Abono de Cuota',
              tipoCodigo: 'abono',
              monto: Number(a.valor_abonado || 0),
              fecha: fDt,
              fechaTexto: formatearFechaLarga(fDt),
              responsable: a.cobrador_nombre || 'Cobrador',
              sector: 'Ruta de Cobro',
              metodo_pago: metodo,
              monto_efectivo: Number(a.monto_efectivo || (metodo === 'efectivo' ? a.valor_abonado : 0)),
              monto_transferencia: Number(a.monto_transferencia || (metodo === 'transferencia' ? a.valor_abonado : 0)),
              transferencias: transfArr,
            });
          });
        }
      }

      // 2. Procesar Ventas Originadas
      if (resCreditos.status === 'fulfilled' && Array.isArray(resCreditos.value.data)) {
        resCreditos.value.data.forEach((c) => {
          const fDt = new Date(c.creado_en || Date.now());
          const folio = c.codigo_contrato || `CTR-${String(c.id_contrato || '').slice(0, 8).toUpperCase()}`;
          const totalVenta = Number(c.monto_financiado || 0) + Number(c.cuota_inicial || 0);
          const cInicial = Number(c.cuota_inicial || 0);
          const metodo = (c.metodo_pago_inicial || (cInicial > 0 ? 'efectivo' : 'credito_directo')).toLowerCase().trim();
          const transfArr = Array.isArray(c.transferencias) && c.transferencias.length > 0
            ? c.transferencias.map((t) => ({
                entidad_bancaria: t.entidad_bancaria || '',
                referencia_pago: t.referencia_pago || '',
                monto: Number(t.monto || 0),
              }))
            : (c.banco_transferencia || c.referencia_pago_inicial)
              ? [{
                  entidad_bancaria: c.banco_transferencia || 'Bancolombia',
                  referencia_pago: c.referencia_pago_inicial || 'S/R',
                  monto: Number(c.monto_inicial_transferencia || cInicial || 0),
                }]
              : [];

          const sumTransf = transfArr.reduce((acc, t) => acc + (Number(t.monto) || 0), 0);
          const montoTransf = c.monto_inicial_transferencia !== undefined && c.monto_inicial_transferencia !== null && Number(c.monto_inicial_transferencia) > 0
            ? Number(c.monto_inicial_transferencia)
            : sumTransf > 0
            ? sumTransf
            : (metodo === 'transferencia' ? cInicial : 0);

          const montoEf = metodo === 'efectivo' ? cInicial : Math.max(0, cInicial - montoTransf);

          listaUnificada.push({
            id: `credito-${c.id_contrato}`,
            folio,
            cliente: c.cliente?.nombres || c.cliente?.nombre_completo || 'Cliente Titular',
            cedula: c.cliente?.cedula || '',
            tipo: c.estado === 'pendiente' ? 'Solicitud de Crédito' : 'Venta Originada',
            tipoCodigo: 'venta',
            monto: totalVenta,
            cuotaInicial: cInicial,
            fecha: fDt,
            fechaTexto: formatearFechaLarga(fDt),
            responsable: c.vendedor?.nombre || 'Asesor Comercial',
            sector: c.ciudad_venta || c.cliente?.ciudad || 'Punto de Venta',
            contratoReferencia: folio,
            metodo_pago: metodo,
            monto_efectivo: montoEf,
            monto_transferencia: montoTransf,
            transferencias: transfArr,
          });
        });
        guardarEnCache(STORAGE_KEYS.CACHE_CREDITOS, resCreditos.value.data);
      } else {
        const cached = await obtenerDeCache(STORAGE_KEYS.CACHE_CREDITOS);
        if (Array.isArray(cached)) {
          cached.forEach((c) => {
            const fDt = new Date(c.creado_en || Date.now());
            const metodo = (c.metodo_pago_inicial || 'efectivo').toLowerCase().trim();
            const transfArr = Array.isArray(c.transferencias) ? c.transferencias : [];
            listaUnificada.push({
              id: `credito-${c.id_contrato}`,
              folio: c.codigo_contrato || `CTR-${String(c.id_contrato).slice(0, 8).toUpperCase()}`,
              cliente: c.cliente?.nombres || 'Cliente',
              tipo: 'Venta Originada',
              tipoCodigo: 'venta',
              monto: Number(c.monto_financiado || 0),
              fecha: fDt,
              fechaTexto: formatearFechaLarga(fDt),
              responsable: 'Asesor Comercial',
              sector: 'Punto de Venta',
              metodo_pago: metodo,
              monto_efectivo: Number(c.cuota_inicial || 0),
              monto_transferencia: 0,
              transferencias: transfArr,
            });
          });
        }
      }

      // Ordenar cronológicamente descendente
      listaUnificada.sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
      setTransacciones(listaUnificada);
    } catch (error) {
      console.warn('[ComprobantesScreen] Error al sincronizar historial:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    cargarHistorial();
  }, [cargarHistorial]);

  // Filtrado reactivo en memoria
  const transaccionesFiltradas = useMemo(() => {
    return transacciones.filter((t) => {
      if (filtroTipo !== 'todos' && t.tipoCodigo !== filtroTipo) {
        return false;
      }

      if (!busqueda.trim()) return true;
      const q = busqueda.trim().toLowerCase();
      const folio = (t.folio || '').toLowerCase();
      const cli = (t.cliente || '').toLowerCase();
      const resp = (t.responsable || '').toLowerCase();
      const sec = (t.sector || '').toLowerCase();

      return folio.includes(q) || cli.includes(q) || resp.includes(q) || sec.includes(q);
    });
  }, [transacciones, filtroTipo, busqueda]);

  // Función de Compartir nativa de React Native con detalle bancario completo
  const handleCompartir = async (item) => {
    try {
      const metodo = (item.metodo_pago || 'efectivo').toLowerCase().trim();
      let metodoEtiqueta = '💵 Efectivo';
      if (metodo === 'transferencia') metodoEtiqueta = '💳 Transferencia';
      if (metodo === 'mixto') metodoEtiqueta = '💵+💳 Pago Mixto (Efectivo + Transferencia)';

      const lineas = [
        '🧾 *COMPROBANTE TRANSACCIONAL OFICIAL*',
        `🏢 ${empresaNombre || 'Sistema Comercial'} • Sistema Core`,
        '-----------------------------------------',
        `📄 *Folio:* ${item.folio}`,
        `👤 *Cliente:* ${item.cliente}${item.cedula ? ` (CC: ${item.cedula})` : ''}`,
        `📌 *Operación:* ${item.tipo}`,
        `💰 *Monto Total:* ${formatCOP(item.monto)}`,
        `💳 *Método de Pago:* ${metodoEtiqueta}`,
      ];

      if (metodo === 'mixto') {
        lineas.push(`  • *Efectivo:* ${formatCOP(item.monto_efectivo || 0)}`);
        lineas.push(`  • *Transferencia:* ${formatCOP(item.monto_transferencia || 0)}`);
      }

      if (Array.isArray(item.transferencias) && item.transferencias.length > 0) {
        lineas.push('🏦 *Soportes de Transferencia:*');
        item.transferencias.forEach((t, idx) => {
          lineas.push(`  ${idx + 1}. ${t.entidad_bancaria || 'Banco'}: ${formatCOP(t.monto)} (Ref: ${t.referencia_pago || 'S/R'})`);
        });
      }

      lineas.push(
        `📅 *Fecha:* ${item.fechaTexto}`,
        `📍 *Sede/Ruta:* ${item.sector}`,
        `💼 *Atendido por:* ${item.responsable}`,
        '-----------------------------------------',
        '✅ Transacción registrada y verificada en el sistema central.'
      );

      await Share.share({
        title: `Comprobante ${item.folio}`,
        message: lineas.join('\n'),
      });
    } catch (error) {
      console.warn('[ComprobantesScreen] Error compartiendo comprobante:', error);
    }
  };

  const renderComprobanteCard = ({ item, index }) => {
    const isExpanded = expandedIndex === index;
    const esAbono = item.tipoCodigo === 'abono';
    const metodo = (item.metodo_pago || 'efectivo').toLowerCase().trim();

    return (
      <View style={[styles.card, isExpanded && styles.cardExpanded]}>
        {/* Cabecera Interactiva del Acordeón */}
        <TouchableOpacity
          style={styles.accordionHeaderTouchable}
          onPress={() => setExpandedIndex(isExpanded ? -1 : index)}
          activeOpacity={0.7}
        >
          <View style={styles.cardHeader}>
            <View style={styles.folioBadge}>
              <Text style={styles.folioText}>{item.folio}</Text>
            </View>

            <View style={styles.headerRightGroup}>
              {/* Badge de Método de Pago */}
              <View
                style={[
                  styles.metodoBadge,
                  metodo === 'efectivo'
                    ? styles.metodoBadgeEf
                    : metodo === 'mixto'
                    ? styles.metodoBadgeMix
                    : styles.metodoBadgeTr,
                ]}
              >
                <Text
                  style={[
                    styles.metodoBadgeText,
                    metodo === 'efectivo'
                      ? styles.metodoTextEf
                      : metodo === 'mixto'
                      ? styles.metodoTextMix
                      : styles.metodoTextTr,
                  ]}
                >
                  {metodo === 'efectivo'
                    ? '💵 Efec'
                    : metodo === 'mixto'
                    ? '💵+💳 Mixto'
                    : '💳 Transf'}
                </Text>
              </View>

              <View
                style={[
                  styles.tipoBadge,
                  esAbono ? styles.tipoBadgeAbono : styles.tipoBadgeVenta,
                ]}
              >
                <Text
                  style={[
                    styles.tipoBadgeText,
                    esAbono ? styles.tipoTextAbono : styles.tipoTextVenta,
                  ]}
                >
                  {esAbono ? '💵 Abono' : '🛍️ Venta'}
                </Text>
              </View>

              <Text style={styles.accordionChevronText}>
                {isExpanded ? '▲' : '▼'}
              </Text>
            </View>
          </View>

          {/* Resumen Permanente en Cabecera */}
          <View style={styles.accordionSummaryRow}>
            <Text style={styles.clienteNombre} numberOfLines={1}>
              {item.cliente}
            </Text>
            <Text
              style={[
                styles.summaryMonto,
                esAbono ? styles.montoAbono : styles.montoVenta,
              ]}
            >
              {esAbono ? `+${formatCOP(item.monto)}` : formatCOP(item.monto)}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Cuerpo Expandido del Acordeón (index === expandedIndex) */}
        {isExpanded ? (
          <View style={styles.accordionExpandedContent}>
            <View style={styles.cardBody}>
              <View style={styles.infoRow}>
                <Text style={styles.sectorText}>📍 {item.sector}</Text>
                <Text style={styles.dotSeparator}>•</Text>
                <Text style={styles.responsableText}>{item.responsable}</Text>
              </View>
              {item.cedula ? (
                <Text style={styles.docText}>CC / NIT: {item.cedula}</Text>
              ) : null}
              {item.contratoReferencia ? (
                <Text style={styles.refText}>Contrato: {item.contratoReferencia}</Text>
              ) : null}
              <Text style={styles.fechaText}>🕒 {item.fechaTexto}</Text>

              {/* Detalle visual de Pago Mixto */}
              {metodo === 'mixto' && (
                <View style={styles.mixtoDesgloseBox}>
                  <Text style={styles.mixtoDesgloseTitle}>Desglose Pago Mixto:</Text>
                  <View style={styles.mixtoDesgloseRow}>
                    <Text style={styles.mixtoEfText}>
                      💵 Efec: <Text style={{ fontWeight: '800' }}>{formatCOP(item.monto_efectivo || 0)}</Text>
                    </Text>
                    <Text style={styles.mixtoSepText}>•</Text>
                    <Text style={styles.mixtoTrText}>
                      💳 Transf: <Text style={{ fontWeight: '800' }}>{formatCOP(item.monto_transferencia || 0)}</Text>
                    </Text>
                  </View>
                </View>
              )}

              {/* Soportes Bancarios de Transferencia */}
              {Array.isArray(item.transferencias) && item.transferencias.length > 0 && (
                <View style={styles.transfCardBox}>
                  <Text style={styles.transfCardTitle}>
                    🏦 Soportes Bancarios ({item.transferencias.length}):
                  </Text>
                  {item.transferencias.map((t, tIdx) => (
                    <View
                      key={tIdx}
                      style={[styles.transfCardItem, tIdx > 0 && styles.transfCardItemBorder]}
                    >
                      <View style={{ flex: 1, paddingRight: 6 }}>
                        <Text style={styles.transfCardBanco}>
                          {t.entidad_bancaria || 'Transferencia'}
                        </Text>
                        <Text style={styles.transfCardRef}>
                          Ref: {t.referencia_pago || 'Sin referencia'}
                        </Text>
                      </View>
                      <Text style={styles.transfCardMonto}>
                        {formatCOP(t.monto)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Monto detallado y Botón de Compartir */}
            <View style={styles.cardFooter}>
              <View style={styles.montoBox}>
                <Text style={styles.montoLabel}>TOTAL OPERACIÓN</Text>
                <Text
                  style={[
                    styles.montoValue,
                    esAbono ? styles.montoAbono : styles.montoVenta,
                  ]}
                >
                  {esAbono ? `+${formatCOP(item.monto)}` : formatCOP(item.monto)}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.btnCompartir}
                onPress={() => handleCompartir(item)}
                activeOpacity={0.8}
              >
                <Text style={styles.btnCompartirIcon}>📤</Text>
                <Text style={styles.btnCompartirText}>Compartir</Text>
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
          <Text style={styles.headerTitle}>Comprobantes y Recibos</Text>
          <Text style={styles.headerSubtitle}>
            Historial de auditoría y recibos en terreno
          </Text>
        </View>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => cargarHistorial(true)}
          disabled={isRefreshing}
          activeOpacity={0.7}
        >
          <Text style={styles.refreshBtnText}>{isRefreshing ? '⏳' : '↻'}</Text>
        </TouchableOpacity>
      </View>

      {/* BUSCADOR Y FILTROS RÁPIDOS */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por folio, cliente o cobrador..."
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

        {/* Píldoras de Filtro por Tipo */}
        <View style={styles.filterPillsRow}>
          <TouchableOpacity
            style={[styles.filterPill, filtroTipo === 'todos' && styles.filterPillActive]}
            onPress={() => setFiltroTipo('todos')}
          >
            <Text
              style={[
                styles.filterPillText,
                filtroTipo === 'todos' && styles.filterPillTextActive,
              ]}
            >
              Todos ({transacciones.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterPill, filtroTipo === 'abono' && styles.filterPillActiveEmerald]}
            onPress={() => setFiltroTipo('abono')}
          >
            <Text
              style={[
                styles.filterPillText,
                filtroTipo === 'abono' && styles.filterPillTextActiveEmerald,
              ]}
            >
              💵 Abonos
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterPill, filtroTipo === 'venta' && styles.filterPillActiveBlue]}
            onPress={() => setFiltroTipo('venta')}
          >
            <Text
              style={[
                styles.filterPillText,
                filtroTipo === 'venta' && styles.filterPillTextActiveBlue,
              ]}
            >
              🛍️ Ventas
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* LISTADO DE COMPROBANTES */}
      {isLoading && !isRefreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#059669" />
          <Text style={styles.loadingText}>Sincronizando comprobantes...</Text>
        </View>
      ) : (
        <FlatList
          data={transaccionesFiltradas}
          keyExtractor={(item) => item.id}
          renderItem={renderComprobanteCard}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => cargarHistorial(true)}
              colors={['#059669']}
              tintColor="#059669"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🧾</Text>
              <Text style={styles.emptyTitle}>Sin comprobantes encontrados</Text>
              <Text style={styles.emptySubtitle}>
                {busqueda
                  ? `No hay registros que coincidan con "${busqueda}".`
                  : 'Aún no se han originado ventas o recaudos para generar comprobantes.'}
              </Text>
            </View>
          }
        />
      )}
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
  searchContainer: {
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
  clearBtnText: {
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
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterPillActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  filterPillActiveEmerald: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  filterPillActiveBlue: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  filterPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  filterPillTextActive: {
    color: '#FFFFFF',
  },
  filterPillTextActiveEmerald: {
    color: '#065F46',
  },
  filterPillTextActiveBlue: {
    color: '#1D4ED8',
  },
  listContent: {
    padding: 16,
    gap: 12,
    backgroundColor: '#F8FAFC',
  },
  card: {
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
  cardExpanded: {
    borderColor: '#059669',
    shadowOpacity: 0.1,
    shadowRadius: 10,
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
    color: '#059669',
    fontWeight: '800',
    paddingHorizontal: 4,
  },
  accordionSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  summaryMonto: {
    fontSize: 15,
    fontWeight: '900',
  },
  accordionExpandedContent: {
    marginTop: 10,
  },
  docText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    marginBottom: 2,
  },
  refText: {
    fontSize: 11,
    color: '#2563EB',
    fontWeight: '700',
    marginBottom: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  folioBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  folioText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F172A',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  tipoBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  tipoBadgeAbono: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  tipoBadgeVenta: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  tipoBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  tipoTextAbono: {
    color: '#065F46',
  },
  tipoTextVenta: {
    color: '#1D4ED8',
  },
  metodoBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  metodoBadgeEf: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  metodoBadgeTr: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  metodoBadgeMix: {
    backgroundColor: '#F5F3FF',
    borderColor: '#DDD6FE',
  },
  metodoBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
  },
  metodoTextEf: {
    color: '#065F46',
  },
  metodoTextTr: {
    color: '#1D4ED8',
  },
  metodoTextMix: {
    color: '#6D28D9',
  },
  mixtoDesgloseBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 6,
    marginBottom: 6,
  },
  mixtoDesgloseTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    marginBottom: 4,
    letterSpacing: 0.4,
  },
  mixtoDesgloseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mixtoEfText: {
    fontSize: 10.5,
    color: '#065F46',
    fontWeight: '600',
  },
  mixtoSepText: {
    color: '#CBD5E1',
    fontWeight: '800',
    fontSize: 10,
  },
  mixtoTrText: {
    fontSize: 10.5,
    color: '#1D4ED8',
    fontWeight: '600',
  },
  transfCardBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 6,
    marginBottom: 6,
  },
  transfCardTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: '#1E293B',
    marginBottom: 6,
    letterSpacing: 0.4,
  },
  transfCardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  transfCardItemBorder: {
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    marginTop: 3,
    paddingTop: 4,
  },
  transfCardBanco: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#1E293B',
  },
  transfCardRef: {
    fontSize: 9.5,
    fontWeight: '600',
    color: '#64748B',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  transfCardMonto: {
    fontSize: 11,
    fontWeight: '900',
    color: '#1D4ED8',
  },
  cardBody: {
    marginBottom: 12,
  },
  clienteNombre: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  sectorText: {
    fontSize: 11,
    color: '#059669',
    fontWeight: '700',
  },
  dotSeparator: {
    color: '#CBD5E1',
    fontSize: 10,
  },
  responsableText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  fechaText: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '600',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  montoBox: {
    justifyContent: 'center',
  },
  montoLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  montoValue: {
    fontSize: 16,
    fontWeight: '900',
  },
  montoAbono: {
    color: '#059669',
  },
  montoVenta: {
    color: '#0F172A',
  },
  btnCompartir: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    gap: 6,
  },
  btnCompartirIcon: {
    fontSize: 13,
  },
  btnCompartirText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
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
    color: '#64748B',
    fontWeight: '600',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 16,
  },
});
