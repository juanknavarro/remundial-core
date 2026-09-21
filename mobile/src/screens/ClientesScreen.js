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
  Alert,
  Linking,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as Location from 'expo-location';
import apiClient from '../api/client';
import InFrameModal from '../components/InFrameModal';
import CitySelectorModal from '../components/CitySelectorModal';

export default function ClientesScreen({ navigation }) {
  const [clientes, setClientes] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filtroBusqueda, setFiltroBusqueda] = useState('');

  // Modal para creación de nuevo cliente
  const [modalNuevoCliente, setModalNuevoCliente] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Campos del formulario
  const [cedula, setCedula] = useState('');
  const [nombres, setNombres] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
  const [barrio, setBarrio] = useState('');
  const [ciudad, setCiudad] = useState('Montería');
  const [modalSeleccionarCiudad, setModalSeleccionarCiudad] = useState(false);
  const [gpsCoords, setGpsCoords] = useState(null);
  const [isCapturingGps, setIsCapturingGps] = useState(false);

  // Cargar lista de clientes desde FastAPI
  const cargarClientes = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await apiClient.get('/clientes');
      if (Array.isArray(res.data)) {
        setClientes(res.data);
      }
    } catch (error) {
      console.warn('[ClientesScreen] Error al cargar clientes:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    cargarClientes();
  }, [cargarClientes]);

  const onRefresh = () => {
    setIsRefreshing(true);
    cargarClientes();
  };

  // Capturar coordenadas GPS del domicilio
  const capturarGps = async () => {
    try {
      setIsCapturingGps(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('GPS', 'Permiso denegado. Se guardará sin coordenadas satelitales.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setGpsCoords({
        latitud: Number(loc.coords.latitude.toFixed(6)),
        longitud: Number(loc.coords.longitude.toFixed(6)),
      });
    } catch (err) {
      console.warn('Error capturando GPS:', err);
    } finally {
      setIsCapturingGps(false);
    }
  };

  // Crear cliente
  const handleCrearCliente = async () => {
    if (isSubmitting) return;
    setFormError('');
    if (!cedula.trim() || !nombres.trim() || !direccion.trim()) {
      setFormError('Cédula, Nombres y Dirección son campos obligatorios.');
      return;
    }

    try {
      setIsSubmitting(true);
      const payload = {
        cedula: cedula.trim(),
        nombres: nombres.trim(),
        telefono: telefono.trim() || null,
        direccion: direccion.trim(),
        barrio: barrio.trim() || null,
        ciudad: ciudad.trim() || 'Montería',
        coordenadas_gps: gpsCoords || null,
      };

      const res = await apiClient.post('/clientes', payload);
      if (res.data) {
        setClientes((prev) => [res.data, ...prev]);
        setModalNuevoCliente(false);
        // Reset form
        setCedula('');
        setNombres('');
        setTelefono('');
        setDireccion('');
        setBarrio('');
        setCiudad('Montería');
        setGpsCoords(null);
      }
    } catch (error) {
      console.error('[ClientesScreen] Error creando cliente:', error);
      let msg = 'No fue posible registrar al cliente.';
      if (error.response?.data?.detail) {
        msg = typeof error.response.data.detail === 'string'
          ? error.response.data.detail
          : JSON.stringify(error.response.data.detail);
      }
      setFormError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtro reactivo
  const clientesFiltrados = clientes.filter((c) => {
    const q = filtroBusqueda.toLowerCase();
    const n = c.nombres?.toLowerCase() || '';
    const doc = c.cedula?.toLowerCase() || '';
    const b = c.barrio?.toLowerCase() || '';
    const t = c.telefono?.toLowerCase() || '';
    return n.includes(q) || doc.includes(q) || b.includes(q) || t.includes(q);
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
          <Text style={styles.headerTitle}>Directorio de Clientes</Text>
          <Text style={styles.headerSub}>Base comercial en terreno</Text>
        </View>

        <TouchableOpacity
          style={styles.newClientBtn}
          onPress={() => {
            setFormError('');
            setModalNuevoCliente(true);
          }}
          accessibilityRole="button"
        >
          <Text style={styles.newClientBtnText}>+ Nuevo</Text>
        </TouchableOpacity>
      </View>

      {/* BUSCADOR */}
      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por nombre, cédula o barrio..."
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
          {clientesFiltrados.length} cliente{clientesFiltrados.length !== 1 ? 's' : ''} encontrado{clientesFiltrados.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {/* LISTADO DE CLIENTES */}
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
            <Text style={styles.loadingText}>Consultando clientes...</Text>
          </View>
        ) : clientesFiltrados.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>👥</Text>
            <Text style={styles.emptyTitle}>No se encontraron clientes</Text>
            <Text style={styles.emptySubtitle}>
              {filtroBusqueda
                ? 'Prueba con otro término de búsqueda o registra un nuevo cliente.'
                : 'Aún no hay clientes registrados en la plataforma.'}
            </Text>
            <TouchableOpacity
              style={styles.emptyActionBtn}
              onPress={() => setModalNuevoCliente(true)}
            >
              <Text style={styles.emptyActionBtnText}>+ Registrar Primer Cliente</Text>
            </TouchableOpacity>
          </View>
        ) : (
          clientesFiltrados.map((item) => {
            const initials = item.nombres
              ? item.nombres
                  .split(' ')
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()
              : 'CL';

            return (
              <View key={item.id} style={styles.clientCard}>
                <View style={styles.cardTopRow}>
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarText}>{initials}</Text>
                  </View>
                  <View style={styles.clientMainInfo}>
                    <Text style={styles.clientNameText}>{item.nombres}</Text>
                    <Text style={styles.clientCedulaText}>C.C. {item.cedula}</Text>
                  </View>
                  {item.telefono ? (
                    <TouchableOpacity
                      style={styles.callPill}
                      onPress={() => Linking.openURL(`tel:${item.telefono}`)}
                    >
                      <Text style={styles.callPillText}>📞 Llamar</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                <View style={styles.addressBox}>
                  <Text style={styles.addressText} numberOfLines={1}>
                    📍 {item.direccion || 'Sin dirección'}, {item.barrio || 'Sector no especificado'} ({item.ciudad || 'Montería'})
                  </Text>
                </View>

                <View style={styles.cardActionsRow}>
                  <TouchableOpacity
                    style={styles.originateSaleBtn}
                    onPress={() => navigation.navigate('NuevaVenta', { clientePreseleccionado: item, reset: true, timestamp: Date.now() })}
                  >
                    <Text style={styles.originateSaleBtnText}>+ Iniciar Venta / Crédito</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* MODAL IN-FRAME: REGISTRO DE NUEVO CLIENTE */}
      <InFrameModal
        visible={modalNuevoCliente}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setModalNuevoCliente(false)}
      >
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalContent}
          >
            {/* Header del Modal */}
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Nuevo Cliente</Text>
                <Text style={styles.modalSubtitle}>Registro comercial para ventas en terreno</Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setModalNuevoCliente(false)}
              >
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={styles.formScroll}>
              {formError ? (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorText}>⚠ {formError}</Text>
                </View>
              ) : null}

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>NÚMERO DE CÉDULA *</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="Ej. 1067890123"
                  placeholderTextColor="#94A3B8"
                  value={cedula}
                  onChangeText={setCedula}
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>NOMBRES Y APELLIDOS *</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="Ej. Carlos Mendoza Pérez"
                  placeholderTextColor="#94A3B8"
                  value={nombres}
                  onChangeText={setNombres}
                  autoCapitalize="words"
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>TELÉFONO MÓVIL</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="Ej. 3101234567"
                  placeholderTextColor="#94A3B8"
                  value={telefono}
                  onChangeText={setTelefono}
                  keyboardType="phone-pad"
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>DIRECCIÓN DEL DOMICILIO *</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="Ej. Calle 14 # 8-45"
                  placeholderTextColor="#94A3B8"
                  value={direccion}
                  onChangeText={setDireccion}
                />
              </View>

              <View style={styles.formRow}>
                <View style={[styles.formGroup, { flex: 1, marginRight: 8 }]}>
                  <Text style={styles.inputLabel}>BARRIO / SECTOR</Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder="Ej. La Granja"
                    placeholderTextColor="#94A3B8"
                    value={barrio}
                    onChangeText={setBarrio}
                  />
                </View>
                <View style={[styles.formGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>CIUDAD *</Text>
                  <TouchableOpacity
                    style={styles.dropdownCityBtn}
                    onPress={() => setModalSeleccionarCiudad(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.dropdownCityBtnText} numberOfLines={1}>
                      📍 {ciudad || 'Montería'}
                    </Text>
                    <Text style={styles.dropdownCityBtnChevron}>▾</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Botón GPS */}
              <TouchableOpacity
                style={[styles.gpsCaptureBtn, gpsCoords && styles.gpsCaptureBtnDone]}
                onPress={capturarGps}
                disabled={isCapturingGps}
              >
                {isCapturingGps ? (
                  <ActivityIndicator size="small" color="#059669" />
                ) : (
                  <Text style={styles.gpsCaptureBtnText}>
                    {gpsCoords
                      ? `✓ GPS Fijado (${gpsCoords.latitud}, ${gpsCoords.longitud})`
                      : '📍 Capturar Coordenadas GPS del Domicilio'}
                  </Text>
                )}
              </TouchableOpacity>

              {/* Botón de Envío */}
              <TouchableOpacity
                style={[styles.submitBtn, isSubmitting && styles.submitBtnDisabled]}
                onPress={handleCrearCliente}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.submitBtnText}>Guardar y Registrar Cliente</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </InFrameModal>

      {/* Selector Desplegable Controlado de Ciudad */}
      <CitySelectorModal
        visible={modalSeleccionarCiudad}
        onClose={() => setModalSeleccionarCiudad(false)}
        selectedCity={ciudad}
        onSelectCity={(c) => setCiudad(c)}
        title="Seleccionar Ciudad del Cliente"
      />
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
    justifyContent: 'space-between',
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
  newClientBtn: {
    backgroundColor: '#059669',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  newClientBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
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
    marginBottom: 16,
    lineHeight: 18,
  },
  emptyActionBtn: {
    backgroundColor: '#059669',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  emptyActionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  clientCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '800',
  },
  clientMainInfo: {
    flex: 1,
  },
  clientNameText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  clientCedulaText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  callPill: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  callPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
  addressBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginTop: 8,
  },
  addressText: {
    fontSize: 11,
    color: '#475569',
  },
  cardActionsRow: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 8,
  },
  originateSaleBtn: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
  },
  originateSaleBtnText: {
    color: '#047857',
    fontSize: 12,
    fontWeight: '700',
  },

  // MODAL NUEVO CLIENTE
  modalBackdrop: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 10,
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  formScroll: {
    maxHeight: 480,
  },
  errorBanner: {
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
    padding: 8,
    borderRadius: 8,
    marginBottom: 10,
  },
  errorText: {
    fontSize: 11,
    color: '#BE123C',
    fontWeight: '600',
  },
  formGroup: {
    marginBottom: 10,
  },
  formRow: {
    flexDirection: 'row',
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  formInput: {
    height: 40,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 13,
    color: '#0F172A',
  },
  dropdownCityBtn: {
    height: 40,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownCityBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
  },
  dropdownCityBtnChevron: {
    fontSize: 14,
    color: '#64748B',
    marginLeft: 4,
  },
  gpsCaptureBtn: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    marginVertical: 8,
  },
  gpsCaptureBtnDone: {
    backgroundColor: '#DCFCE7',
    borderColor: '#4ADE80',
  },
  gpsCaptureBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
  },
  submitBtn: {
    backgroundColor: '#059669',
    borderRadius: 8,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    marginBottom: 16,
  },
  submitBtnDisabled: {
    opacity: 0.65,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
