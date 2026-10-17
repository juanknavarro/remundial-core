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
  Linking,
  Alert,
  StatusBar,
  Platform,
} from 'react-native';
import apiClient from '../api/client';
import {
  guardarEnCache,
  obtenerDeCache,
  STORAGE_KEYS,
} from '../storage/database';

export default function DirectorioScreen({ navigation }) {
  const [clientes, setClientes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filtroBusqueda, setFiltroBusqueda] = useState('');

  // Cargar lista de clientes desde FastAPI (con soporte de caché local offline)
  const cargarClientes = useCallback(async (isPullRefresh = false) => {
    if (isPullRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const res = await apiClient.get('/clientes');
      if (Array.isArray(res.data)) {
        setClientes(res.data);
        guardarEnCache(STORAGE_KEYS.CACHE_CLIENTES, res.data);
      } else {
        const cached = await obtenerDeCache(STORAGE_KEYS.CACHE_CLIENTES);
        if (Array.isArray(cached)) setClientes(cached);
      }
    } catch (error) {
      console.warn('[DirectorioScreen] Error cargando clientes desde API, recurriendo a caché:', error);
      const cached = await obtenerDeCache(STORAGE_KEYS.CACHE_CLIENTES);
      if (Array.isArray(cached)) setClientes(cached);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    cargarClientes();
  }, [cargarClientes]);

  // Filtrado reactivo en memoria por nombre o cédula/NIT
  const clientesFiltrados = useMemo(() => {
    if (!filtroBusqueda.trim()) return clientes;
    const query = filtroBusqueda.trim().toLowerCase();
    return clientes.filter((c) => {
      const nombre = (c.nombres || c.nombre_completo || '').toLowerCase();
      const cedula = (c.cedula || c.nit || '').toLowerCase();
      const ciudad = (c.ciudad || '').toLowerCase();
      const telefono = (c.telefono || '').toLowerCase();
      return (
        nombre.includes(query) ||
        cedula.includes(query) ||
        ciudad.includes(query) ||
        telefono.includes(query)
      );
    });
  }, [clientes, filtroBusqueda]);

  const handleLlamar = (telefono) => {
    if (!telefono) {
      Alert.alert('Contacto no disponible', 'El cliente no tiene un teléfono registrado.');
      return;
    }
    const cleanTel = String(telefono).replace(/[^0-9]/g, '');
    Linking.openURL(`tel:${cleanTel}`).catch(() => {
      Alert.alert('Error', 'No es posible realizar llamadas desde este dispositivo.');
    });
  };

  const handleWhatsApp = (telefono) => {
    if (!telefono) {
      Alert.alert('Contacto no disponible', 'El cliente no tiene un teléfono registrado.');
      return;
    }
    const cleanTel = String(telefono).replace(/[^0-9]/g, '');
    const num = cleanTel.startsWith('57') ? cleanTel : `57${cleanTel}`;
    Linking.openURL(`https://wa.me/${num}`).catch(() => {
      Alert.alert('Error', 'No fue posible abrir WhatsApp.');
    });
  };

  const renderClienteCard = ({ item }) => {
    const nombre = item.nombres || item.nombre_completo || 'Cliente Titular';
    const cedula = item.cedula || item.nit || 'Sin documento';
    const ciudad = item.ciudad || 'Montería';
    const telefono = item.telefono || '';
    const iniciales = nombre
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

    return (
      <View style={styles.card}>
        {/* Cabecera de la Tarjeta */}
        <View style={styles.cardHeader}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{iniciales}</Text>
          </View>
          <View style={styles.headerInfo}>
            <Text style={styles.clienteNombre} numberOfLines={1}>
              {nombre}
            </Text>
            <View style={styles.docRow}>
              <Text style={styles.docLabel}>CC / NIT:</Text>
              <Text style={styles.docValue}>{cedula}</Text>
            </View>
          </View>
        </View>

        {/* Ubicación y Dirección */}
        <View style={styles.cardLocationBox}>
          <View style={styles.locationRow}>
            <Text style={styles.locationIcon}>📍</Text>
            <Text style={styles.locationCity}>{ciudad}</Text>
            {item.barrio ? (
              <Text style={styles.locationBarrio}>• Barrio {item.barrio}</Text>
            ) : null}
          </View>
          {item.direccion ? (
            <Text style={styles.addressText} numberOfLines={1}>
              {item.direccion}
            </Text>
          ) : null}
        </View>

        {/* Botones de Contacto Rápido */}
        <View style={styles.cardActions}>
          <TouchableOpacity
            style={[styles.callBtn, !telefono && styles.btnDisabled]}
            onPress={() => handleLlamar(telefono)}
            disabled={!telefono}
            activeOpacity={0.8}
          >
            <Text style={styles.actionIcon}>📞</Text>
            <Text style={styles.callBtnText}>
              {telefono ? `Llamar (${telefono})` : 'Sin Teléfono'}
            </Text>
          </TouchableOpacity>

          {telefono ? (
            <TouchableOpacity
              style={styles.wsBtn}
              onPress={() => handleWhatsApp(telefono)}
              activeOpacity={0.8}
            >
              <Text style={styles.actionIcon}>💬</Text>
              <Text style={styles.wsBtnText}>WhatsApp</Text>
            </TouchableOpacity>
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
          <Text style={styles.headerTitle}>Directorio de Clientes</Text>
          <Text style={styles.headerSubtitle}>
            {clientes.length} {clientes.length === 1 ? 'cliente registrado' : 'clientes registrados'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => cargarClientes(true)}
          disabled={isRefreshing}
          activeOpacity={0.7}
        >
          <Text style={styles.refreshBtnText}>{isRefreshing ? '⏳' : '↻'}</Text>
        </TouchableOpacity>
      </View>

      {/* BARRA DE BÚSQUEDA */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por nombre, cédula o ciudad..."
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
      </View>

      {/* LISTA DE CLIENTES */}
      {isLoading && !isRefreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#059669" />
          <Text style={styles.loadingText}>Cargando directorio de clientes...</Text>
        </View>
      ) : (
        <FlatList
          data={clientesFiltrados}
          keyExtractor={(item, index) => item.id || item.cedula || String(index)}
          renderItem={renderClienteCard}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => cargarClientes(true)}
              colors={['#059669']}
              tintColor="#059669"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>👥</Text>
              <Text style={styles.emptyTitle}>No se encontraron clientes</Text>
              <Text style={styles.emptySubtitle}>
                {filtroBusqueda
                  ? `No hay coincidencias para "${filtroBusqueda}".`
                  : 'No hay clientes registrados en el sistema.'}
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
    paddingVertical: 12,
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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#059669',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  headerInfo: {
    flex: 1,
  },
  clienteNombre: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 2,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  docLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  docValue: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F172A',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  cardLocationBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  locationIcon: {
    fontSize: 12,
  },
  locationCity: {
    fontSize: 12,
    fontWeight: '800',
    color: '#059669',
  },
  locationBarrio: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  addressText: {
    fontSize: 11,
    color: '#64748B',
    paddingLeft: 18,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  callBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
    paddingVertical: 10,
    borderRadius: 12,
    gap: 6,
  },
  btnDisabled: {
    backgroundColor: '#E2E8F0',
  },
  actionIcon: {
    fontSize: 13,
  },
  callBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  wsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    gap: 4,
  },
  wsBtnText: {
    color: '#065F46',
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
