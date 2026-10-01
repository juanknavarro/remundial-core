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
  Alert,
  Modal,
  Pressable,
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

export default function CatalogoScreen({ navigation }) {
  const [productos, setProductos] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filtroBusqueda, setFiltroBusqueda] = useState('');

  // Estado para el modal de visualización a pantalla completa (Lightbox)
  const [imagenModal, setImagenModal] = useState(null);

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

  const renderProductCard = ({ item }) => {
    const precioBase = Number(item.precio_base || 0);
    const manejaStock = item.maneja_stock !== false;
    const stockDisp = item.stock != null ? Number(item.stock) : 0;
    const estaAgotado = manejaStock && stockDisp <= 0;
    const bajoStock = manejaStock && stockDisp > 0 && stockDisp <= 5;
    const uriImagen = resolveImageUrl(item.imagen_url);

    return (
      <View style={[styles.productCard, estaAgotado && styles.productCardAgotado]}>
        {/* ZONA SUPERIOR: IMAGEN CON BADGES FLOTANTES SUPERPUESTOS */}
        <View style={styles.imageContainer}>
          {/* Tocar la imagen para abrir el Lightbox a pantalla completa */}
          <TouchableOpacity
            activeOpacity={uriImagen ? 0.85 : 1}
            style={styles.imageTouchWrapper}
            onPress={() => {
              if (uriImagen) {
                setImagenModal({ uri: uriImagen, nombre: item.nombre, sku: item.sku });
              }
            }}
            accessibilityRole={uriImagen ? 'button' : undefined}
            accessibilityLabel={uriImagen ? `Ampliar imagen de ${item.nombre}` : undefined}
          >
            {uriImagen ? (
              <Image
                source={{ uri: uriImagen }}
                style={styles.cardImage}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Text style={styles.placeholderIcon}>🖼️</Text>
                <Text style={styles.placeholderText}>Sin imagen</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* BADGES FLOTANTES (Punto de Equilibrio: Ahorro de espacio) */}
          <View style={styles.floatingTopRow} pointerEvents="box-none">
            {/* SKU flotante en píldora oscura translúcida */}
            <View style={styles.floatingSkuBadge}>
              <Text style={styles.floatingSkuText} numberOfLines={1}>
                {item.sku}
              </Text>
            </View>

            {/* Indicador de estado flotante a la derecha */}
            {!manejaStock ? (
              <View style={[styles.floatingBadge, styles.floatingBadgeEncargo]}>
                <Text style={styles.floatingBadgeText}>🎨 Encargo</Text>
              </View>
            ) : estaAgotado ? (
              <View style={[styles.floatingBadge, styles.floatingBadgeAgotado]}>
                <Text style={styles.floatingBadgeText}>Agotado</Text>
              </View>
            ) : bajoStock ? (
              <View style={[styles.floatingBadge, styles.floatingBadgeBajo]}>
                <Text style={styles.floatingBadgeText}>{stockDisp} disp.</Text>
              </View>
            ) : item.es_precio_variable ? (
              <View style={[styles.floatingBadge, styles.floatingBadgeArte]}>
                <Text style={styles.floatingBadgeText}>🎨 Arte</Text>
              </View>
            ) : (
              <View style={[styles.floatingBadge, styles.floatingBadgeStock]}>
                <Text style={styles.floatingBadgeText}>{stockDisp} disp.</Text>
              </View>
            )}
          </View>
        </View>

        {/* ZONA INFERIOR: DATOS Y ACCIÓN */}
        <View style={styles.cardBody}>
          <Text
            style={[styles.productName, estaAgotado && styles.productNameAgotado]}
            numberOfLines={2}
          >
            {item.nombre}
          </Text>

          <View style={styles.priceContainer}>
            <Text style={styles.priceLabel}>PRECIO BASE</Text>
            <Text style={styles.priceValue}>{formatCOP(precioBase)}</Text>
          </View>

          {/* Botón de acción compacto */}
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
              <Text style={styles.agotadoBlockedBtnText}>Agotado</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.sellBtn}
              onPress={() =>
                navigation.navigate('NuevaVenta', {
                  productoPreseleccionado: item,
                  reset: true,
                  timestamp: Date.now(),
                })
              }
            >
              <Text style={styles.sellBtnText}>+ Vender</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

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

      {/* LISTADO EN CUADRÍCULA DE 2 COLUMNAS (FLATLIST) */}
      <FlatList
        data={productosFiltrados}
        keyExtractor={(item) => String(item.id || item.sku)}
        renderItem={renderProductCard}
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

      {/* MODAL LIGHTBOX (VISOR DE IMAGEN A PANTALLA COMPLETA) */}
      <Modal
        visible={Boolean(imagenModal)}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setImagenModal(null)}
      >
        <View style={styles.lightboxBackdrop}>
          {/* Fondo interactivo: permite cerrar tocando el fondo oscuro */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setImagenModal(null)}
          />

          {/* Cabecera del Lightbox con nombre, SKU y botón de cerrar */}
          <SafeAreaView style={styles.lightboxHeaderSafe} pointerEvents="box-none">
            <View style={styles.lightboxHeader}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.lightboxTitle} numberOfLines={1}>
                  {imagenModal?.nombre || 'Artículo'}
                </Text>
                <Text style={styles.lightboxSku}>
                  SKU: {imagenModal?.sku || 'S/N'}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.lightboxCloseBtn}
                onPress={() => setImagenModal(null)}
                accessibilityRole="button"
                accessibilityLabel="Cerrar visor"
              >
                <Text style={styles.lightboxCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>

          {/* Contenedor de la Imagen completa sin recortes (contentFit="contain") */}
          <View style={styles.lightboxImageContainer} pointerEvents="box-none">
            {imagenModal?.uri && (
              <Image
                source={{ uri: imagenModal.uri }}
                style={styles.lightboxImage}
                contentFit="contain"
                transition={200}
              />
            )}
          </View>
        </View>
      </Modal>
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
  productCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 2,
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  productCardAgotado: {
    backgroundColor: '#F8FAFC',
    opacity: 0.85,
  },
  imageContainer: {
    width: '100%',
    height: 140,
    position: 'relative',
    backgroundColor: '#F1F5F9',
  },
  imageTouchWrapper: {
    width: '100%',
    height: 140,
  },
  cardImage: {
    width: '100%',
    height: 140,
    borderTopLeftRadius: 11,
    borderTopRightRadius: 11,
  },
  imagePlaceholder: {
    width: '100%',
    height: 140,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: 11,
    borderTopRightRadius: 11,
  },
  placeholderIcon: {
    fontSize: 28,
    opacity: 0.5,
  },
  placeholderText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94A3B8',
    marginTop: 2,
  },
  floatingTopRow: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  floatingSkuBadge: {
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    maxWidth: '52%',
  },
  floatingSkuText: {
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
    color: '#FFFFFF',
  },
  floatingBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 1,
  },
  floatingBadgeEncargo: {
    backgroundColor: 'rgba(126, 34, 206, 0.92)',
  },
  floatingBadgeAgotado: {
    backgroundColor: 'rgba(220, 38, 38, 0.92)',
  },
  floatingBadgeBajo: {
    backgroundColor: 'rgba(217, 119, 6, 0.92)',
  },
  floatingBadgeArte: {
    backgroundColor: 'rgba(14, 116, 144, 0.92)',
  },
  floatingBadgeStock: {
    backgroundColor: 'rgba(5, 150, 105, 0.9)',
  },
  floatingBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  cardBody: {
    padding: 10,
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  productName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 17,
    minHeight: 34,
    marginBottom: 6,
  },
  productNameAgotado: {
    color: '#64748B',
  },
  priceContainer: {
    marginBottom: 8,
  },
  priceLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  priceValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#059669',
    marginTop: 1,
  },
  sellBtn: {
    backgroundColor: '#059669',
    borderRadius: 7,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  agotadoBlockedBtn: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 7,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agotadoBlockedBtnText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
  },
  // ESTILOS DEL MODAL LIGHTBOX
  lightboxBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxHeaderSafe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  lightboxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  lightboxTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  lightboxSku: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  lightboxCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxCloseText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  lightboxImageContainer: {
    width: '100%',
    height: '75%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  lightboxImage: {
    width: '100%',
    height: '100%',
  },
});
