import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Pressable,
  SafeAreaView,
} from 'react-native';
import { Image } from 'expo-image';
import apiClient, { DEFAULT_API_URL } from '../api/client';
import InFrameModal from './InFrameModal';

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

export default function ProductCard({
  item,
  onActionPress,
  actionLabel,
  containerStyle,
  style,
}) {
  const [lightboxVisible, setLightboxVisible] = useState(false);

  if (!item) return null;

  const precioBase = Number(item.precio_base || 0);
  const manejaStock = item.maneja_stock !== false;
  const stockDisp = item.stock != null ? Number(item.stock) : 0;
  const estaAgotado = manejaStock && stockDisp <= 0;
  const bajoStock = manejaStock && stockDisp > 0 && stockDisp <= 5;
  const uriImagen = resolveImageUrl(item.imagen_url);

  const hasAction = Boolean(actionLabel && onActionPress);

  return (
    <>
      <View style={[styles.productCard, estaAgotado && styles.productCardAgotado, containerStyle, style]}>
        {/* ZONA SUPERIOR: IMAGEN CON BADGES FLOTANTES SUPERPUESTOS */}
        <View style={styles.imageContainer}>
          <TouchableOpacity
            activeOpacity={uriImagen ? 0.85 : 1}
            style={styles.imageTouchWrapper}
            onPress={() => {
              if (uriImagen) {
                setLightboxVisible(true);
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

          {/* BADGES FLOTANTES */}
          <View style={styles.floatingTopRow} pointerEvents="box-none">
            {/* SKU flotante */}
            <View style={styles.floatingSkuBadge}>
              <Text style={styles.floatingSkuText} numberOfLines={1}>
                {item.sku}
              </Text>
            </View>

            {/* Indicador de estado */}
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

          {/* BOTÓN DE ACCIÓN CONDICIONAL */}
          {hasAction ? (
            estaAgotado ? (
              <TouchableOpacity
                style={styles.agotadoBlockedBtn}
                activeOpacity={0.8}
                onPress={() => {
                  Alert.alert(
                    'Artículo Agotado en Bodega',
                    `El producto "${item.nombre}" (SKU: ${item.sku}) no cuenta con existencias disponibles en almacén. No es posible agregarlo a la venta hasta su reabastecimiento.`
                  );
                }}
              >
                <Text style={styles.agotadoBlockedBtnText}>Agotado</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.actionBtn}
                activeOpacity={0.85}
                onPress={() => onActionPress(item)}
              >
                <Text style={styles.actionBtnText}>{actionLabel}</Text>
              </TouchableOpacity>
            )
          ) : null}
        </View>
      </View>

      {/* MODAL LIGHTBOX (VISOR DE IMAGEN A PANTALLA COMPLETA) */}
      <InFrameModal
        visible={lightboxVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setLightboxVisible(false)}
      >
        <View style={styles.lightboxBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setLightboxVisible(false)}
          />

          <SafeAreaView style={styles.lightboxHeaderSafe} pointerEvents="box-none">
            <View style={styles.lightboxHeader}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.lightboxTitle} numberOfLines={1}>
                  {item.nombre || 'Artículo'}
                </Text>
                <Text style={styles.lightboxSku}>
                  SKU: {item.sku || 'S/N'}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.lightboxCloseBtn}
                onPress={() => setLightboxVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Cerrar visor"
              >
                <Text style={styles.lightboxCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>

          <View style={styles.lightboxImageContainer} pointerEvents="box-none">
            {uriImagen && (
              <Image
                source={{ uri: uriImagen }}
                style={styles.lightboxImage}
                contentFit="contain"
                transition={200}
              />
            )}
          </View>
        </View>
      </InFrameModal>
    </>
  );
}

const styles = StyleSheet.create({
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
  actionBtn: {
    backgroundColor: '#059669',
    borderRadius: 7,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
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
