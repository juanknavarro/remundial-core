import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  Platform,
} from 'react-native';

/**
 * Selector de Entidades Bancarias para React Native y Expo Web.
 * Presenta un modal limpio y reactivo sin cuadros nativos de navegador,
 * con buscador integrado y soporte para bancos activos locales y sincronizados.
 */
export default function BankSelectorModal({
  visible,
  onClose,
  bancos = [],
  selectedBanco = '',
  onSelectBanco,
}) {
  const [busqueda, setBusqueda] = useState('');

  const bancosActivos = useMemo(() => {
    const list = Array.isArray(bancos) ? bancos : [];
    const activas = list.filter((b) => b.activa !== false);
    if (!busqueda.trim()) return activas;
    const term = busqueda.toLowerCase().trim();
    return activas.filter((b) => b.nombre.toLowerCase().includes(term));
  }, [bancos, busqueda]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>🏦 Entidad Bancaria</Text>
              <Text style={styles.subtitle}>Seleccione el banco o billetera del comprobante</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Buscar banco (ej. Nequi, Bancolombia)..."
              placeholderTextColor="#94A3B8"
              value={busqueda}
              onChangeText={setBusqueda}
            />
          </View>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={true} keyboardShouldPersistTaps="handled">
            {bancosActivos.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No se encontraron entidades bancarias</Text>
              </View>
            ) : (
              bancosActivos.map((banco) => {
                const isSelected = selectedBanco === banco.nombre;
                return (
                  <TouchableOpacity
                    key={banco.id || banco.nombre}
                    style={[styles.item, isSelected && styles.itemSelected]}
                    onPress={() => {
                      onSelectBanco(banco.nombre);
                      onClose();
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={styles.itemInfo}>
                      <View style={[styles.iconWrapper, isSelected && styles.iconWrapperSelected]}>
                        <Text style={styles.itemIcon}>🏛️</Text>
                      </View>
                      <Text style={[styles.itemText, isSelected && styles.itemTextSelected]}>
                        {banco.nombre}
                      </Text>
                    </View>
                    {isSelected && (
                      <View style={styles.checkBadge}>
                        <Text style={styles.checkBadgeText}>✓</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.cancelBtnText}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    zIndex: 99999,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: '#0F172A',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 25,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  subtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: 'bold',
  },
  searchContainer: {
    marginBottom: 12,
  },
  searchInput: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
    color: '#F8FAFC',
  },
  list: {
    maxHeight: 280,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    marginBottom: 6,
    backgroundColor: '#1E293B50',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  itemSelected: {
    backgroundColor: '#1E3A8A40',
    borderColor: '#3B82F6',
  },
  itemInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  iconWrapperSelected: {
    backgroundColor: '#3B82F6',
  },
  itemIcon: {
    fontSize: 14,
  },
  itemText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E2E8F0',
    flex: 1,
  },
  itemTextSelected: {
    color: '#60A5FA',
    fontWeight: 'bold',
  },
  checkBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  emptyContainer: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: '#64748B',
    fontSize: 13,
  },
  cancelBtn: {
    marginTop: 14,
    paddingVertical: 12,
    backgroundColor: '#1E293B',
    borderRadius: 14,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
