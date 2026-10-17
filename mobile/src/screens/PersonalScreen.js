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
} from 'react-native';
import apiClient from '../api/client';
import {
  guardarEnCache,
  obtenerDeCache,
  STORAGE_KEYS,
} from '../storage/database';

const CACHE_PERSONAL = 'cache_personal_usuarios_mobile';

const ROL_CONFIG = {
  vendedor: {
    label: 'Vendedor en Terreno',
    badgeText: '💼 Vendedor',
    bg: '#EFF6FF',
    border: '#BFDBFE',
    color: '#1D4ED8',
  },
  cobrador: {
    label: 'Cobrador de Ruta',
    badgeText: '🛵 Cobrador',
    bg: '#FEF3C7',
    border: '#FDE68A',
    color: '#B45309',
  },
  supervisor: {
    label: 'Supervisor de Zona',
    badgeText: '🛡️ Supervisor',
    bg: '#ECFDF5',
    border: '#A7F3D0',
    color: '#065F46',
  },
  secretaria: {
    label: 'Secretaría / Caja',
    badgeText: '📑 Secretaría',
    bg: '#F3E8FF',
    border: '#E9D5FF',
    color: '#7E22CE',
  },
  master: {
    label: 'Administrador Master',
    badgeText: '👑 Master',
    bg: '#F1F5F9',
    border: '#CBD5E1',
    color: '#0F172A',
  },
};

export default function PersonalScreen({ navigation }) {
  const [usuarios, setUsuarios] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [filtroRol, setFiltroRol] = useState('todos'); // 'todos' | 'vendedor' | 'cobrador' | 'supervisor'

  // Cargar lista de empleados/usuarios desde FastAPI
  const cargarUsuarios = useCallback(async (isPullRefresh = false) => {
    if (isPullRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const res = await apiClient.get('/usuarios');
      if (Array.isArray(res.data)) {
        setUsuarios(res.data);
        guardarEnCache(CACHE_PERSONAL, res.data);
      } else {
        const cached = await obtenerDeCache(CACHE_PERSONAL);
        if (Array.isArray(cached)) setUsuarios(cached);
      }
    } catch (error) {
      console.warn('[PersonalScreen] Error cargando usuarios desde API, usando caché:', error);
      const cached = await obtenerDeCache(CACHE_PERSONAL);
      if (Array.isArray(cached)) setUsuarios(cached);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    cargarUsuarios();
  }, [cargarUsuarios]);

  // Filtrado reactivo en memoria por rol y búsqueda textual
  const usuariosFiltrados = useMemo(() => {
    return usuarios.filter((u) => {
      const rolStr = (u.rol || '').toLowerCase();
      if (filtroRol !== 'todos' && rolStr !== filtroRol) {
        return false;
      }

      if (!busqueda.trim()) return true;
      const q = busqueda.trim().toLowerCase();
      const nombre = (u.nombre || '').toLowerCase();
      const tel = (u.telefono || '').toLowerCase();
      return nombre.includes(q) || tel.includes(q) || rolStr.includes(q);
    });
  }, [usuarios, filtroRol, busqueda]);

  // Métricas rápidas de personal
  const resumen = useMemo(() => {
    let activos = 0;
    let vendedores = 0;
    let cobradores = 0;

    usuarios.forEach((u) => {
      if (u.estado_activo !== false) activos += 1;
      const r = (u.rol || '').toLowerCase();
      if (r === 'vendedor') vendedores += 1;
      if (r === 'cobrador') cobradores += 1;
    });

    return { total: usuarios.length, activos, vendedores, cobradores };
  }, [usuarios]);

  const handleLlamar = (telefono) => {
    if (!telefono) {
      Alert.alert('Contacto no disponible', 'El colaborador no tiene un teléfono registrado.');
      return;
    }
    const cleanTel = String(telefono).replace(/[^0-9]/g, '');
    Linking.openURL(`tel:${cleanTel}`).catch(() => {
      Alert.alert('Error', 'No es posible realizar llamadas desde este dispositivo.');
    });
  };

  const handleWhatsApp = (telefono) => {
    if (!telefono) {
      Alert.alert('Contacto no disponible', 'El colaborador no tiene un teléfono registrado.');
      return;
    }
    const cleanTel = String(telefono).replace(/[^0-9]/g, '');
    const num = cleanTel.startsWith('57') ? cleanTel : `57${cleanTel}`;
    Linking.openURL(`https://wa.me/${num}`).catch(() => {
      Alert.alert('Error', 'No fue posible abrir WhatsApp.');
    });
  };

  const renderUsuarioCard = ({ item }) => {
    const rolKey = (item.rol || '').toLowerCase();
    const config = ROL_CONFIG[rolKey] || {
      label: item.rol || 'Empleado',
      badgeText: item.rol || 'Colaborador',
      bg: '#F1F5F9',
      border: '#E2E8F0',
      color: '#475569',
    };

    const esActivo = item.estado_activo !== false;
    const iniciales = (item.nombre || 'U')
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

    const telefono = item.telefono;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          {/* Avatar con iniciales */}
          <View style={[styles.avatarCircle, { borderColor: config.color }]}>
            <Text style={styles.avatarText}>{iniciales}</Text>
          </View>

          {/* Información: Nombre y Rol */}
          <View style={styles.headerInfo}>
            <Text style={styles.usuarioNombre} numberOfLines={1}>
              {item.nombre}
            </Text>
            <View style={styles.rolesRow}>
              <View
                style={[
                  styles.rolBadge,
                  { backgroundColor: config.bg, borderColor: config.border },
                ]}
              >
                <Text style={[styles.rolBadgeText, { color: config.color }]}>
                  {config.badgeText}
                </Text>
              </View>

              {/* Estado Activo / Inactivo */}
              {esActivo ? (
                <View style={styles.statusActiveBadge}>
                  <View style={styles.statusActiveDot} />
                  <Text style={styles.statusActiveText}>Activo</Text>
                </View>
              ) : (
                <View style={styles.statusInactiveBadge}>
                  <View style={styles.statusInactiveDot} />
                  <Text style={styles.statusInactiveText}>Inactivo</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Teléfono y Línea de Contacto */}
        <View style={styles.contactRow}>
          <Text style={styles.phoneLabel}>Teléfono móvil / WhatsApp:</Text>
          <Text style={styles.phoneValue}>
            {telefono ? telefono : 'Sin número asignado'}
          </Text>
        </View>

        {/* Botones de Acción Inmediata: Llamar y Mensaje */}
        <View style={styles.cardActions}>
          <TouchableOpacity
            style={[styles.btnLlamar, !telefono && styles.btnDisabled]}
            onPress={() => handleLlamar(telefono)}
            disabled={!telefono}
            activeOpacity={0.8}
          >
            <Text style={styles.actionIcon}>📞</Text>
            <Text style={styles.btnLlamarText}>
              {telefono ? `Llamar` : 'Sin Línea'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btnWhatsApp, !telefono && styles.btnDisabledWs]}
            onPress={() => handleWhatsApp(telefono)}
            disabled={!telefono}
            activeOpacity={0.8}
          >
            <Text style={styles.actionIcon}>💬</Text>
            <Text style={styles.btnWhatsAppText}>WhatsApp</Text>
          </TouchableOpacity>
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
          <Text style={styles.headerTitle}>Personal de Operaciones</Text>
          <Text style={styles.headerSubtitle}>
            {resumen.activos} activos • {resumen.vendedores} vendedores • {resumen.cobradores} cobradores
          </Text>
        </View>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => cargarUsuarios(true)}
          disabled={isRefreshing}
          activeOpacity={0.7}
        >
          <Text style={styles.refreshBtnText}>{isRefreshing ? '⏳' : '↻'}</Text>
        </TouchableOpacity>
      </View>

      {/* BUSCADOR Y PÍLDORAS DE ROL */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar colaborador por nombre o celular..."
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

        {/* Píldoras de Filtro por Rol */}
        <View style={styles.filterPillsRow}>
          <TouchableOpacity
            style={[styles.filterPill, filtroRol === 'todos' && styles.filterPillActive]}
            onPress={() => setFiltroRol('todos')}
          >
            <Text
              style={[
                styles.filterPillText,
                filtroRol === 'todos' && styles.filterPillTextActive,
              ]}
            >
              Todos ({usuarios.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterPill, filtroRol === 'vendedor' && styles.filterPillActiveBlue]}
            onPress={() => setFiltroRol('vendedor')}
          >
            <Text
              style={[
                styles.filterPillText,
                filtroRol === 'vendedor' && styles.filterPillTextActiveBlue,
              ]}
            >
              💼 Vendedores ({resumen.vendedores})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterPill, filtroRol === 'cobrador' && styles.filterPillActiveAmber]}
            onPress={() => setFiltroRol('cobrador')}
          >
            <Text
              style={[
                styles.filterPillText,
                filtroRol === 'cobrador' && styles.filterPillTextActiveAmber,
              ]}
            >
              🛵 Cobradores ({resumen.cobradores})
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* LISTADO DE EMPLEADOS */}
      {isLoading && !isRefreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#059669" />
          <Text style={styles.loadingText}>Cargando equipo de colaboradores...</Text>
        </View>
      ) : (
        <FlatList
          data={usuariosFiltrados}
          keyExtractor={(item, index) => item.id || String(index)}
          renderItem={renderUsuarioCard}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => cargarUsuarios(true)}
              colors={['#059669']}
              tintColor="#059669"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>👥</Text>
              <Text style={styles.emptyTitle}>No se encontró personal</Text>
              <Text style={styles.emptySubtitle}>
                {busqueda
                  ? `No hay colaboradores que coincidan con "${busqueda}".`
                  : 'No hay usuarios registrados bajo el rol seleccionado.'}
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
  filterPillActiveBlue: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  filterPillActiveAmber: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
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
  filterPillTextActiveAmber: {
    color: '#B45309',
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
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  headerInfo: {
    flex: 1,
  },
  usuarioNombre: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  rolesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rolBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  rolBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  statusActiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusActiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#059669',
  },
  statusActiveText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#065F46',
  },
  statusInactiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusInactiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#DC2626',
  },
  statusInactiveText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#DC2626',
  },
  contactRow: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  phoneLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  phoneValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  btnLlamar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
    paddingVertical: 10,
    borderRadius: 12,
    gap: 6,
  },
  btnWhatsApp: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ECFDF5',
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    gap: 6,
  },
  btnDisabled: {
    backgroundColor: '#E2E8F0',
  },
  btnDisabledWs: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
  },
  actionIcon: {
    fontSize: 13,
  },
  btnLlamarText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  btnWhatsAppText: {
    color: '#065F46',
    fontSize: 12,
    fontWeight: '800',
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
