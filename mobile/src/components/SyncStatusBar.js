import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useSync } from '../context/SyncContext';

export default function SyncStatusBar() {
  const { isOnline, isSyncing, pendingCount, forzarSincronizacion } = useSync();

  // Si está sincronizando actualmente
  if (isSyncing) {
    return (
      <View style={[styles.container, styles.syncingBg]}>
        <ActivityIndicator size="small" color="#1D4ED8" style={styles.iconSpacing} />
        <Text style={[styles.text, styles.syncingText]}>
          Sincronizando {pendingCount} {pendingCount === 1 ? 'operación' : 'operaciones'} con el servidor...
        </Text>
      </View>
    );
  }

  // Si está sin conexión
  if (!isOnline) {
    return (
      <View style={[styles.container, styles.offlineBg]}>
        <View style={styles.offlineDot} />
        <Text style={[styles.text, styles.offlineText]}>
          Modo Sin Conexión (Offline){pendingCount > 0 ? ` • ${pendingCount} en cola` : ''}
        </Text>
      </View>
    );
  }

  // Si está en línea pero tiene registros pendientes en cola
  if (pendingCount > 0) {
    return (
      <View style={[styles.container, styles.pendingBg]}>
        <View style={styles.pendingDot} />
        <Text style={[styles.text, styles.pendingText]}>
          Conexión activa • {pendingCount} {pendingCount === 1 ? 'operación pendiente' : 'operaciones pendientes'}
        </Text>
        <TouchableOpacity
          onPress={forzarSincronizacion}
          style={styles.syncButton}
          activeOpacity={0.7}
        >
          <Text style={styles.syncButtonText}>Sincronizar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // En línea y completamente sincronizado (micro-indicador discreto)
  return (
    <View style={[styles.container, styles.onlineBg]}>
      <View style={styles.onlineDot} />
      <Text style={[styles.text, styles.onlineText]}>
        En línea • Sistema Sincronizado
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingVertical: 5,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
  },
  iconSpacing: {
    marginRight: 6,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
  },
  // Estados de fondo y bordes
  onlineBg: {
    backgroundColor: '#F0FDF4',
    borderBottomColor: '#DCFCE7',
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#16A34A',
    marginRight: 6,
  },
  onlineText: {
    color: '#15803D',
  },

  offlineBg: {
    backgroundColor: '#FFFBEB',
    borderBottomColor: '#FEF3C7',
  },
  offlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D97706',
    marginRight: 6,
  },
  offlineText: {
    color: '#B45309',
  },

  syncingBg: {
    backgroundColor: '#EFF6FF',
    borderBottomColor: '#DBEAFE',
  },
  syncingText: {
    color: '#1D4ED8',
  },

  pendingBg: {
    backgroundColor: '#FEF3C7',
    borderBottomColor: '#FDE68A',
    justifyContent: 'space-between',
  },
  pendingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F59E0B',
    marginRight: 6,
  },
  pendingText: {
    color: '#92400E',
    flex: 1,
  },
  syncButton: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 8,
  },
  syncButtonText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
});
