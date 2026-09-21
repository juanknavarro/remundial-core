import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import apiClient from '../api/client';
import {
  guardarEnCache,
  obtenerDeCache,
  STORAGE_KEYS,
} from '../storage/database';

const formatCOP = (val) => {
  const num = Math.round(Number(val) || 0);
  return '$ ' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

export default function CatalogoScreen({ navigation }) {
  const [productos, setProductos] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filtroBusqueda, setFiltroBusqueda] = useState('');

  // Cargar catálogo de productos desde FastAPI (con soporte de caché offline)
  const cargarProductos = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await apiClient.get('/productos');
      if (Array.isArray(res.data)) {
        const activos = res.data.filter((p) => p.estado_activo !== false);
        setProductos(activos);
        guardarEnCache(STORAGE_KEYS.CACHE_PRODUCTOS, activos);
      } else {
        const cached = await obtenerDeCache(STORAGE_KEYS.CACHE_PRODUCTOS);
        if (cached) setProductos(cached);
      }
    } catch (error) {
      console.warn('[CatalogoScreen] Sin conexión o error cargando productos:', error);
      const cached = await obtenerDeCache(STORAGE_KEYS.CACHE_PRODUCTOS);
      if (cached) setProductos(cached);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    cargarProductos();
  }, [cargarProductos]);

  const onRefresh = () => {
    setIsRefreshing(true);
    cargarProductos();
  };

  // Filtrado reactivo
  const productosFiltrados = productos.filter((p) => {
    const q = filtroBusqueda.toLowerCase();
    const nombre = p.nombre?.toLowerCase() || '';
    const sku = p.sku?.toLowerCase() || '';
    return nombre.includes(q) || sku.includes(q);
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
          <Text style={styles.headerTitle}>Catálogo de Artículos</Text>
          <Text style={styles.headerSub}>Inventario y Precios Vigentes</Text>
        </View>
      </View>

      {/* BUSCADOR */}
      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por artículo o código SKU..."
            placeholderTextColor="#94A3B8"
            value={filtroBusqueda}
            onChangeText={setFiltroBusqueda}
          />
          {filtroBusqueda ? (
            <TouchableOpacity onPress={() => setFiltroBusqueda('')}>
              <Text style={styles.clearIcon}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={styles.counterText}>
          {productosFiltrados.length} artículo{productosFiltrados.length !== 1 ? 's' : ''} en catálogo
        </Text>
      </View>

      {/* LISTADO DE PRODUCTOS */}
      <ScrollView
        contentContainerStyle={styles.scrollList}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} colors={['#059669']} />
        }
        showsVerticalScrollIndicator={false}
      >
        {isLoading && !isRefreshing ? (
          <View style={styles.centerLoading}>
            <ActivityIndicator size="small" color="#059669" />
            <Text style={styles.loadingText}>Cargando inventario...</Text>
          </View>
        ) : productosFiltrados.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>📦</Text>
            <Text style={styles.emptyTitle}>Sin artículos encontrados</Text>
            <Text style={styles.emptySubtitle}>
              No hay productos que coincidan con los términos de búsqueda.
            </Text>
          </View>
        ) : (
          productosFiltrados.map((item) => {
            const precioBase = Number(item.precio_base || 0);
            const manejaStock = item.maneja_stock !== false;
            const stockDisp = item.stock != null ? Number(item.stock) : 0;
            const estaAgotado = manejaStock && stockDisp <= 0;
            const bajoStock = manejaStock && stockDisp > 0 && stockDisp <= 5;

            return (
              <View key={item.id || item.sku} style={[styles.productCard, estaAgotado && styles.productCardAgotado]}>
                <View style={styles.cardHeaderRow}>
                  <View style={styles.skuBadge}>
                    <Text style={styles.skuBadgeText}>{item.sku}</Text>
                  </View>
                  {item.es_precio_variable ? (
                    <View style={styles.variableBadge}>
                      <Text style={styles.variableBadgeText}>🎨 Arte / Precio Negociable</Text>
                    </View>
                  ) : (
                    <View style={styles.fixedBadge}>
                      <Text style={styles.fixedBadgeText}>Precio Estándar</Text>
                    </View>
                  )}
                </View>

                <Text style={[styles.productName, estaAgotado && { color: '#64748B' }]}>{item.nombre}</Text>

                <View style={styles.priceRow}>
                  <View>
                    <Text style={styles.priceLabel}>PRECIO BASE REFERENCIA</Text>
                    <Text style={styles.priceValue}>{formatCOP(precioBase)}</Text>
                  </View>
                  
                  {/* Badge de Stock en tiempo real */}
                  {!manejaStock ? (
                    <View style={styles.encargoBadge}>
                      <Text style={styles.encargoBadgeText}>🎨 Por Encargo</Text>
                    </View>
                  ) : estaAgotado ? (
                    <View style={styles.agotadoBadge}>
                      <View style={[styles.stockDot, { backgroundColor: '#EF4444' }]} />
                      <Text style={styles.agotadoBadgeText}>Agotado (0 disp.)</Text>
                    </View>
                  ) : bajoStock ? (
                    <View style={styles.bajoStockBadge}>
                      <View style={[styles.stockDot, { backgroundColor: '#F59E0B' }]} />
                      <Text style={styles.bajoStockBadgeText}>Bajo Stock ({stockDisp} disp.)</Text>
                    </View>
                  ) : (
                    <View style={styles.stockBadge}>
                      <View style={styles.stockDot} />
                      <Text style={styles.stockText}>{stockDisp} disponibles</Text>
                    </View>
                  )}
                </View>

                {item.es_precio_variable && (
                  <View style={styles.artNoteBox}>
                    <Text style={styles.artNoteText}>
                      💡 Obra de arte con precio unitario variable personalizable al originar la venta.
                    </Text>
                  </View>
                )}

                {estaAgotado ? (
                  <TouchableOpacity
                    style={styles.agotadoBlockedBtn}
                    activeOpacity={0.8}
                    onPress={() => {
                      Alert.alert(
                        'Artículo Agotado en Bodega',
                        `El producto "${item.nombre}" (SKU: ${item.sku}) no cuenta con existencias disponibles en almacén. No es posible generar ventas hasta que el supervisor registre un reabastecimiento.`
                      );
                    }}
                  >
                    <Text style={styles.agotadoBlockedBtnText}>⚠️ Agotado en Bodega (Bloqueado)</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.sellBtn}
                    onPress={() => navigation.navigate('NuevaVenta', { productoPreseleccionado: item, reset: true, timestamp: Date.now() })}
                  >
                    <Text style={styles.sellBtnText}>+ Vender Este Artículo</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
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
  searchSection: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 38,
  },
  searchIcon: {
    fontSize: 13,
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
  },
  clearIcon: {
    fontSize: 13,
    color: '#94A3B8',
    paddingHorizontal: 4,
  },
  counterText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 6,
  },
  scrollList: {
    padding: 14,
    paddingBottom: 28,
    gap: 10,
  },
  centerLoading: {
    paddingVertical: 40,
    alignItems: 'center',
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
    marginTop: 10,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 4,
  },
  productCard: {
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
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  skuBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  skuBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    color: '#475569',
  },
  variableBadge: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  variableBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B45309',
  },
  fixedBadge: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  fixedBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
  },
  productName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 10,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  priceLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  priceValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  stockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  stockDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  stockText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#047857',
  },
  artNoteBox: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FEF3C7',
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
  },
  artNoteText: {
    fontSize: 11,
    color: '#B45309',
    lineHeight: 15,
  },
  sellBtn: {
    backgroundColor: '#059669',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  sellBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  productCardAgotado: {
    backgroundColor: '#F8FAFC',
    opacity: 0.85,
  },
  encargoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3E8FF',
    borderWidth: 1,
    borderColor: '#D8B4FE',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  encargoBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#7E22CE',
  },
  agotadoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  agotadoBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B91C1C',
  },
  bajoStockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  bajoStockBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B45309',
  },
  agotadoBlockedBtn: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  agotadoBlockedBtnText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
  },
});
