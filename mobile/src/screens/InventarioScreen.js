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
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import apiClient, { DEFAULT_API_URL } from '../api/client';
import {
  guardarEnCache,
  obtenerDeCache,
  STORAGE_KEYS,
} from '../storage/database';

const formatCOP = (val) => {
  const num = Math.round(Number(val) || 0);
  return '$ ' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const resolveImageUrl = (imgUrl) => {
  if (!imgUrl || typeof imgUrl !== 'string') return null;
  const trimmed = imgUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('file://')) {
    return trimmed;
  }
  const base = apiClient?.defaults?.baseURL || DEFAULT_API_URL || 'http://localhost:8000';
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${cleanBase}${cleanPath}`;
};

export default function InventarioScreen({ navigation }) {
  const [productos, setProductos] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filtroBusqueda, setFiltroBusqueda] = useState('');
  const [filtroStock, setFiltroStock] = useState('todos'); // 'todos' | 'bajo' | 'disponible'

  // Cargar lista de productos desde FastAPI (con soporte de caché offline)
  const cargarProductos = useCallback(async (isPullRefresh = false) => {
    if (isPullRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const res = await apiClient.get('/productos');
      if (Array.isArray(res.data)) {
        setProductos(res.data);
        guardarEnCache(STORAGE_KEYS.CACHE_PRODUCTOS, res.data);
      } else {
        const cached = await obtenerDeCache(STORAGE_KEYS.CACHE_PRODUCTOS);
        if (Array.isArray(cached)) setProductos(cached);
      }
    } catch (error) {
      console.warn('[InventarioScreen] Error cargando productos desde API, recurriendo a caché:', error);
      const cached = await obtenerDeCache(STORAGE_KEYS.CACHE_PRODUCTOS);
      if (Array.isArray(cached)) setProductos(cached);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    cargarProductos();
  }, [cargarProductos]);

  // Filtrado reactivo en memoria por nombre, SKU/referencia y estado de stock
  const productosFiltrados = useMemo(() => {
    return productos.filter((p) => {
      const stock = p.stock != null ? Number(p.stock) : 0;
      const manejaStock = p.maneja_stock !== false;

      // Filtro por píldora de stock
      if (filtroStock === 'bajo') {
        if (!manejaStock || stock >= 5) return false;
      } else if (filtroStock === 'disponible') {
        if (manejaStock && stock <= 0) return false;
      }

      // Filtro por texto de búsqueda
      if (!filtroBusqueda.trim()) return true;
      const query = filtroBusqueda.trim().toLowerCase();
      const nombre = (p.nombre || '').toLowerCase();
      const ref = (p.referencia || p.sku || '').toLowerCase();

      return nombre.includes(query) || ref.includes(query);
    });
  }, [productos, filtroBusqueda, filtroStock]);

  // Métricas rápidas de stock
  const resumenStock = useMemo(() => {
    let criticos = 0;
    let totalItems = productos.length;
    productos.forEach((p) => {
      const s = p.stock != null ? Number(p.stock) : 0;
      if (p.maneja_stock !== false && s < 5) {
        criticos += 1;
      }
    });
    return { totalItems, criticos };
  }, [productos]);

  const renderProductoCard = ({ item }) => {
    const nombre = item.nombre || 'Producto sin nombre';
    const referencia = item.referencia || item.sku || 'REF-N/A';
    const precio = Number(item.precio_base || item.precio_venta || item.precio || 0);
    const manejaStock = item.maneja_stock !== false;
    const stock = item.stock != null ? Number(item.stock) : 0;
    const esBajoStock = manejaStock && stock < 5;
    const esAgotado = manejaStock && stock <= 0;
    const uriImagen = resolveImageUrl(item.imagen_url);

    return (
      <View style={styles.card}>
        <View style={styles.cardMainRow}>
          {/* Miniatura o Ícono de Producto */}
          <View style={styles.thumbnailContainer}>
            {uriImagen ? (
              <Image
                source={{ uri: uriImagen }}
                style={styles.thumbnailImage}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <View style={styles.thumbnailPlaceholder}>
                <Text style={styles.thumbnailIcon}>📦</Text>
              </View>
            )}
          </View>

          {/* Información Principal: Nombre y Referencia */}
          <View style={styles.infoCol}>
            <View style={styles.refRow}>
              <View style={styles.refBadge}>
                <Text style={styles.refText}>REF: {referencia}</Text>
              </View>
              {item.estado_activo === false ? (
                <View style={styles.inactiveBadge}>
                  <Text style={styles.inactiveBadgeText}>Inactivo</Text>
                </View>
              ) : null}
            </View>

            <Text style={styles.productName} numberOfLines={2}>
              {nombre}
            </Text>

            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>PRECIO UNITARIO</Text>
              <Text style={styles.priceValue}>{formatCOP(precio)}</Text>
            </View>
          </View>
        </View>

        {/* Barra Inferior Semántica: Stock y Estado */}
        <View style={styles.cardFooter}>
          <View style={styles.stockCol}>
            <Text style={styles.stockLabel}>STOCK EN BODEGA</Text>
            <View style={styles.stockStatusRow}>
              {!manejaStock ? (
                <View style={[styles.stockPill, styles.stockPillIndigo]}>
                  <Text style={[styles.stockPillText, styles.stockPillTextIndigo]}>
                    🎨 Sobre Encargo (Sin Límite)
                  </Text>
                </View>
              ) : esAgotado ? (
                <View style={[styles.stockPill, styles.stockPillRose]}>
                  <View style={styles.stockDotRose} />
                  <Text style={[styles.stockPillText, styles.stockPillTextRose]}>
                    Agotado (0 unidades)
                  </Text>
                </View>
              ) : esBajoStock ? (
                <View style={[styles.stockPill, styles.stockPillRose]}>
                  <View style={styles.stockDotRose} />
                  <Text style={[styles.stockPillText, styles.stockPillTextRose]}>
                    Bajo Stock ({stock} {stock === 1 ? 'unidad' : 'unidades'})
                  </Text>
                </View>
              ) : (
                <View style={[styles.stockPill, styles.stockPillEmerald]}>
                  <View style={styles.stockDotEmerald} />
                  <Text style={[styles.stockPillText, styles.stockPillTextEmerald]}>
                    Normal ({stock} {stock === 1 ? 'unidad' : 'unidades'})
                  </Text>
                </View>
              )}
            </View>
          </View>

          {item.es_precio_variable ? (
            <View style={styles.variableTag}>
              <Text style={styles.variableTagText}>Precio Negociable</Text>
            </View>
          ) : null}
        </View>
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
          <Text style={styles.headerTitle}>Inventario y Stock</Text>
          <Text style={styles.headerSubtitle}>
            {resumenStock.totalItems} artículos • {resumenStock.criticos} con stock crítico (&lt; 5)
          </Text>
        </View>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => cargarProductos(true)}
          disabled={isRefreshing}
          activeOpacity={0.7}
        >
          <Text style={styles.refreshBtnText}>{isRefreshing ? '⏳' : '↻'}</Text>
        </TouchableOpacity>
      </View>

      {/* BARRA DE BÚSQUEDA Y FILTROS RÁPIDOS */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por nombre o referencia (SKU)..."
            placeholderTextColor="#94A3B8"
            value={filtroBusqueda}
            onChangeText={setFiltroBusqueda}
            clearButtonMode="while-editing"
          />
          {filtroBusqueda.length > 0 ? (
            <TouchableOpacity onPress={() => setFiltroBusqueda('')}>
              <Text style={styles.clearBtnText}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Píldoras de Filtro Rápido */}
        <View style={styles.filterPillsRow}>
          <TouchableOpacity
            style={[
              styles.filterPill,
              filtroStock === 'todos' && styles.filterPillActive,
            ]}
            onPress={() => setFiltroStock('todos')}
          >
            <Text
              style={[
                styles.filterPillText,
                filtroStock === 'todos' && styles.filterPillTextActive,
              ]}
            >
              Todos ({productos.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterPill,
              filtroStock === 'bajo' && styles.filterPillActiveRose,
            ]}
            onPress={() => setFiltroStock('bajo')}
          >
            <Text
              style={[
                styles.filterPillText,
                filtroStock === 'bajo' && styles.filterPillTextActiveRose,
              ]}
            >
              ⚠️ Crítico &lt; 5 ({resumenStock.criticos})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterPill,
              filtroStock === 'disponible' && styles.filterPillActiveEmerald,
            ]}
            onPress={() => setFiltroStock('disponible')}
          >
            <Text
              style={[
                styles.filterPillText,
                filtroStock === 'disponible' && styles.filterPillTextActiveEmerald,
              ]}
            >
              ✓ Disponibles
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* LISTA DE PRODUCTOS */}
      {isLoading && !isRefreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#059669" />
          <Text style={styles.loadingText}>Cargando inventario de productos...</Text>
        </View>
      ) : (
        <FlatList
          data={productosFiltrados}
          keyExtractor={(item, index) => item.id || item.sku || String(index)}
          renderItem={renderProductoCard}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => cargarProductos(true)}
              colors={['#059669']}
              tintColor="#059669"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>📦</Text>
              <Text style={styles.emptyTitle}>No se encontraron productos</Text>
              <Text style={styles.emptySubtitle}>
                {filtroBusqueda
                  ? `No hay coincidencias para "${filtroBusqueda}".`
                  : 'No hay artículos registrados en el inventario.'}
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
    height: 42,
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
    backgroundColor: '#FFF1F2',
    borderColor: '#FECDD3',
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
  filterPillTextActiveRose: {
    color: '#BE123C',
  },
  filterPillTextActiveEmerald: {
    color: '#065F46',
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
  cardMainRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 12,
  },
  thumbnailContainer: {
    width: 72,
    height: 72,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  thumbnailIcon: {
    fontSize: 28,
  },
  infoCol: {
    flex: 1,
    justifyContent: 'space-between',
  },
  refRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  refBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  refText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  inactiveBadge: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  inactiveBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#DC2626',
  },
  productName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    lineHeight: 18,
    marginBottom: 4,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  priceLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.4,
  },
  priceValue: {
    fontSize: 15,
    fontWeight: '900',
    color: '#059669',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  stockCol: {
    flex: 1,
  },
  stockLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  stockStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  stockPillEmerald: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  stockDotEmerald: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#059669',
  },
  stockPillTextEmerald: {
    fontSize: 11,
    fontWeight: '800',
    color: '#065F46',
  },
  stockPillRose: {
    backgroundColor: '#FFF1F2',
    borderColor: '#FECDD3',
  },
  stockDotRose: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E11D48',
  },
  stockPillTextRose: {
    fontSize: 11,
    fontWeight: '800',
    color: '#BE123C',
  },
  stockPillIndigo: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
  },
  stockPillTextIndigo: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4338CA',
  },
  variableTag: {
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  variableTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
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
