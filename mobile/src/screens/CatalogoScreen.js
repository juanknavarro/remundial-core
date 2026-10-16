import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import apiClient from '../api/client';
import {
  guardarEnCache,
  obtenerDeCache,
  STORAGE_KEYS,
} from '../storage/database';
import ProductCard from '../components/ProductCard';

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

      {/* LISTADO EN CUADRÍCULA DE 2 COLUMNAS (FLATLIST) - MODO CONSULTA / VITRINA */}
      <FlatList
        data={productosFiltrados}
        keyExtractor={(item) => String(item.id || item.sku)}
        renderItem={({ item }) => <ProductCard item={item} />}
        numColumns={2}
        columnWrapperStyle={styles.columnWrapper}
        contentContainerStyle={styles.flatListContent}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} colors={['#059669']} />
        }
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          isLoading && !isRefreshing ? (
            <View style={styles.centerLoading}>
              <ActivityIndicator size="small" color="#059669" />
              <Text style={styles.loadingText}>Cargando inventario...</Text>
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyIcon}>📦</Text>
              <Text style={styles.emptyTitle}>Sin artículos encontrados</Text>
              <Text style={styles.emptySubtitle}>
                No hay productos que coincidan con los términos de búsqueda.
              </Text>
            </View>
          )
        }
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
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    marginRight: 10,
  },
  backBtnText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  headerTitleCol: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  headerSub: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 1,
  },
  searchSection: {
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 4,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 9,
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
    fontSize: 12,
    color: '#94A3B8',
    padding: 4,
  },
  counterText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 6,
    marginBottom: 4,
  },
  columnWrapper: {
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  flatListContent: {
    paddingTop: 12,
    paddingBottom: 28,
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
    marginHorizontal: 14,
    marginTop: 20,
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
});
