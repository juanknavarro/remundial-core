import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import InFrameModal from './InFrameModal';
import apiClient from '../api/client';
import { obtenerDeCache, guardarEnCache, STORAGE_KEYS } from '../storage/database';

export const CATALOGO_DEPARTAMENTOS_DEFAULT = {
  'Córdoba': [
    'Montería',
    'Ayapel',
    'Buenavista',
    'Canalete',
    'Cereté',
    'Chimá',
    'Chinú',
    'Ciénaga de Oro',
    'Cotorra',
    'La Apartada',
    'Lorica',
    'Los Córdobas',
    'Momil',
    'Montelíbano',
    'Moñitos',
    'Planeta Rica',
    'Pueblo Nuevo',
    'Puerto Escondido',
    'Puerto Libertador',
    'Purísima',
    'Sahagún',
    'San Andrés de Sotavento',
    'San Antero',
    'San Bernardo del Viento',
    'San Carlos',
    'San José de Uré',
    'San Pelayo',
    'Tierralta',
    'Tuchín',
    'Valencia',
  ],
  'Sucre': [
    'Sincelejo',
    'Buenavista',
    'Caimito',
    'Colosó',
    'Corozal',
    'Coveñas',
    'Chalán',
    'El Roble',
    'Galeras',
    'Guaranda',
    'La Unión',
    'Los Palmitos',
    'Majagual',
    'Morroa',
    'Ovejas',
    'Palmito',
    'Sampués',
    'San Benito Abad',
    'San Juan de Betulia',
    'San Marcos',
    'San Onofre',
    'San Pedro',
    'Santiago de Tolú',
    'Sincé',
    'Sucre',
    'Toluviejo',
  ],
};

// Array plano para compatibilidad hacia atrás
export const CIUDADES_OPERATIVAS = [
  ...CATALOGO_DEPARTAMENTOS_DEFAULT['Córdoba'],
  ...CATALOGO_DEPARTAMENTOS_DEFAULT['Sucre'],
];

/**
 * Infiere el departamento a partir del nombre de un municipio buscando en el catálogo.
 */
export const inferirDepartamento = (ciudad, catalogo = CATALOGO_DEPARTAMENTOS_DEFAULT) => {
  if (!ciudad) return 'Córdoba';
  const cNorm = String(ciudad).trim().toLowerCase();
  for (const [dep, munis] of Object.entries(catalogo)) {
    if (Array.isArray(munis) && munis.some((m) => m.toLowerCase() === cNorm)) {
      return dep;
    }
  }
  return 'Córdoba';
};

/**
 * Selector desplegable y controlado de ciudad/departamento para el entorno móvil Remundial.
 * Compatible con Android, iOS y Web (mantenido en el marco InFrame).
 * Jerárquico: Departamento ➔ Municipio. Búsqueda instantánea en memoria (cero latencia).
 */
export default function CitySelectorModal({
  visible,
  onClose,
  selectedCity = 'Montería',
  selectedDepartment = '',
  onSelectCity,
  title = 'Seleccionar Ciudad de Venta',
}) {
  const [filtro, setFiltro] = useState('');
  const [catalogo, setCatalogo] = useState(CATALOGO_DEPARTAMENTOS_DEFAULT);
  const [departamentoFiltro, setDepartamentoFiltro] = useState('Todos');

  // Inicializar departamento según el valor seleccionado o inferido
  useEffect(() => {
    if (selectedDepartment && (selectedDepartment === 'Córdoba' || selectedDepartment === 'Sucre')) {
      setDepartamentoFiltro(selectedDepartment);
    } else if (selectedCity) {
      const depInferred = inferirDepartamento(selectedCity, catalogo);
      if (depInferred) {
        setDepartamentoFiltro(depInferred);
      }
    }
  }, [visible, selectedDepartment]);

  // Carga reactiva y offline-first del catálogo estructurado
  useEffect(() => {
    let isMounted = true;

    const normalizarCatalogo = (raw) => {
      if (!raw) return null;
      if (raw.departamentos && typeof raw.departamentos === 'object' && !Array.isArray(raw.departamentos)) {
        return raw.departamentos;
      }
      if (raw.ciudades && typeof raw.ciudades === 'object' && !Array.isArray(raw.ciudades)) {
        return raw.ciudades;
      }
      if (typeof raw === 'object' && !Array.isArray(raw) && (raw['Córdoba'] || raw['Sucre'])) {
        return raw;
      }
      if (Array.isArray(raw) || Array.isArray(raw?.ciudades)) {
        const arr = Array.isArray(raw) ? raw : raw.ciudades;
        return { 'Córdoba': arr, 'Sucre': [] };
      }
      return null;
    };

    const inicializarCiudades = async () => {
      // 1. Cargar de caché local inmediatamente (cero latencia offline)
      try {
        const cached = await obtenerDeCache(STORAGE_KEYS.CACHE_CIUDADES);
        const normCached = normalizarCatalogo(cached);
        if (isMounted && normCached && Object.keys(normCached).length > 0) {
          setCatalogo(normCached);
        }
      } catch {}

      // 2. Sincronizar catálogo actualizado con el servidor
      try {
        const res = await apiClient.get('/config/ciudades');
        const normServidor = normalizarCatalogo(res.data);
        if (isMounted && normServidor && Object.keys(normServidor).length > 0) {
          setCatalogo(normServidor);
          await guardarEnCache(STORAGE_KEYS.CACHE_CIUDADES, normServidor);
        }
      } catch (err) {
        // En ausencia de red opera transparentemente con caché o fallback
      }
    };

    inicializarCiudades();

    return () => {
      isMounted = false;
    };
  }, []);

  const listaDepartamentos = useMemo(() => {
    const keys = Object.keys(catalogo);
    return ['Todos', ...keys];
  }, [catalogo]);

  const itemsCatalogo = useMemo(() => {
    const items = [];
    for (const [dep, munis] of Object.entries(catalogo)) {
      if (departamentoFiltro !== 'Todos' && departamentoFiltro !== dep) {
        continue;
      }
      if (Array.isArray(munis)) {
        for (const m of munis) {
          items.push({
            municipio: m,
            departamento: dep,
            isLegacy: false,
          });
        }
      }
    }

    // Si la ciudad seleccionada no está en la lista actual, incluirla como fallback histórico
    if (
      selectedCity &&
      !items.some((it) => it.municipio.toLowerCase() === selectedCity.toLowerCase())
    ) {
      items.unshift({
        municipio: selectedCity,
        departamento: selectedDepartment || inferirDepartamento(selectedCity, catalogo),
        isLegacy: true,
      });
    }

    return items;
  }, [catalogo, departamentoFiltro, selectedCity, selectedDepartment]);

  // Búsqueda instantánea con cero latencia
  const ciudadesFiltradas = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return itemsCatalogo;
    return itemsCatalogo.filter(
      (it) =>
        it.municipio.toLowerCase().includes(q) ||
        it.departamento.toLowerCase().includes(q)
    );
  }, [filtro, itemsCatalogo]);

  return (
    <InFrameModal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleRow}>
              <Text style={styles.modalIcon}>📍</Text>
              <Text style={styles.modalTitle}>{title}</Text>
            </View>
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Cerrar selector"
            >
              <Text style={styles.modalCloseBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.modalSubtitle}>
            Catálogo geográfico oficial: seleccione el departamento y municipio de radicación comercial.
          </Text>

          {/* Filtro por Departamento (Pills) */}
          <View style={styles.deptoFilterRow}>
            {listaDepartamentos.map((dep) => {
              const active = departamentoFiltro === dep;
              const count = dep === 'Todos'
                ? Object.values(catalogo).reduce((acc, l) => acc + (Array.isArray(l) ? l.length : 0), 0)
                : (Array.isArray(catalogo[dep]) ? catalogo[dep].length : 0);
              return (
                <TouchableOpacity
                  key={dep}
                  style={[styles.deptoTab, active && styles.deptoTabActive]}
                  onPress={() => setDepartamentoFiltro(dep)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.deptoTabText, active && styles.deptoTabTextActive]}>
                    {dep} ({count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Barra de Búsqueda Rápida */}
          <View style={styles.searchBar}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Buscar municipio o departamento..."
              placeholderTextColor="#94A3B8"
              value={filtro}
              onChangeText={setFiltro}
              autoCapitalize="words"
            />
            {filtro.length > 0 && (
              <TouchableOpacity onPress={() => setFiltro('')} style={styles.clearFilterBtn}>
                <Text style={styles.clearFilterText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Lista de Ciudades */}
          <ScrollView
            style={styles.citiesList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {ciudadesFiltradas.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>
                  No se encontraron municipios coincidentes con "{filtro}".
                </Text>
              </View>
            ) : (
              ciudadesFiltradas.map((item) => {
                const isSelected = selectedCity === item.municipio;

                return (
                  <TouchableOpacity
                    key={`${item.departamento}-${item.municipio}`}
                    style={[
                      styles.cityItem,
                      isSelected && styles.cityItemActive,
                    ]}
                    onPress={() => {
                      if (onSelectCity) {
                        onSelectCity(item.municipio, item.departamento);
                      }
                      setFiltro('');
                      onClose();
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={styles.cityLeftCol}>
                      <View style={[styles.cityRadioCircle, isSelected && styles.cityRadioCircleActive]}>
                        {isSelected && <View style={styles.cityRadioInner} />}
                      </View>
                      <View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={[styles.cityName, isSelected && styles.cityNameActive]}>
                            {item.municipio}
                          </Text>
                          <View
                            style={[
                              styles.deptoTag,
                              item.departamento === 'Sucre'
                                ? styles.deptoTagSucre
                                : styles.deptoTagCordoba,
                            ]}
                          >
                            <Text
                              style={[
                                styles.deptoTagText,
                                item.departamento === 'Sucre'
                                  ? styles.deptoTagTextSucre
                                  : styles.deptoTagTextCordoba,
                              ]}
                            >
                              {item.departamento}
                            </Text>
                          </View>
                        </View>
                        {item.isLegacy && (
                          <Text style={styles.legacyTag}>Registrada previamente fuera de catálogo</Text>
                        )}
                      </View>
                    </View>

                    {isSelected ? (
                      <View style={styles.selectedBadge}>
                        <Text style={styles.selectedBadgeText}>✓ Seleccionada</Text>
                      </View>
                    ) : (
                      <Text style={styles.selectActionText}>Elegir →</Text>
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </InFrameModal>
  );
}

const styles = StyleSheet.create({
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
    padding: 16,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalIcon: {
    fontSize: 18,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalCloseBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  modalCloseBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  modalSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 10,
    lineHeight: 15,
  },
  deptoFilterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  deptoTab: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  deptoTabActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  deptoTabText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  deptoTabTextActive: {
    color: '#FFFFFF',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 42,
    marginBottom: 10,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '600',
    paddingVertical: 0,
  },
  clearFilterBtn: {
    padding: 4,
  },
  clearFilterText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: 'bold',
  },
  citiesList: {
    maxHeight: 320,
  },
  cityItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 6,
  },
  cityItemActive: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  cityLeftCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cityRadioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  cityRadioCircleActive: {
    borderColor: '#059669',
  },
  cityRadioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#059669',
  },
  cityName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  cityNameActive: {
    color: '#047857',
    fontWeight: '800',
  },
  deptoTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  deptoTagCordoba: {
    backgroundColor: '#ECFDF5',
  },
  deptoTagSucre: {
    backgroundColor: '#EFF6FF',
  },
  deptoTagText: {
    fontSize: 10,
    fontWeight: '700',
  },
  deptoTagTextCordoba: {
    color: '#059669',
  },
  deptoTagTextSucre: {
    color: '#2563EB',
  },
  legacyTag: {
    fontSize: 9,
    color: '#B45309',
    fontWeight: '600',
    marginTop: 1,
  },
  selectedBadge: {
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  selectedBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#065F46',
  },
  selectActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  emptyState: {
    padding: 20,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
  },
  modalFooter: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  cancelBtn: {
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
});
