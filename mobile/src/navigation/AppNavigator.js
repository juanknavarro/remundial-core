import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import {
  LoginScreen,
  VendedorDashboard,
  CobradorDashboard,
  ClientesScreen,
  NuevaVentaScreen,
  CatalogoScreen,
} from '../screens';

const Stack = createNativeStackNavigator();

/**
 * Pantalla informativa de respaldo si un usuario con rol distinto (ej. supervisor/secretaria)
 * inicia sesión en la aplicación móvil de terreno.
 */
function RolNoAutorizadoScreen() {
  const { user, userRole, logout } = useAuth();

  return (
    <SafeAreaView style={styles.unauthorizedContainer}>
      <View style={styles.unauthorizedCard}>
        <View style={styles.unauthorizedIconBadge}>
          <Text style={styles.unauthorizedIconText}>🛡</Text>
        </View>
        <Text style={styles.unauthorizedBadge}>ACCESO RESTRINGIDO</Text>
        <Text style={styles.unauthorizedTitle}>Rol No Compatible</Text>
        <Text style={styles.unauthorizedText}>
          Esta aplicación móvil está diseñada exclusivamente para la operación en terreno de Vendedores y Cobradores.
        </Text>
        <View style={styles.unauthorizedInfoBox}>
          <Text style={styles.unauthorizedInfoLabel}>USUARIO CONECTADO</Text>
          <Text style={styles.unauthorizedInfoName}>{user?.nombre || 'Usuario'}</Text>
          <Text style={styles.unauthorizedInfoRole}>Rol detectado: {userRole || 'Desconocido'}</Text>
        </View>
        <TouchableOpacity
          style={styles.unauthorizedButton}
          onPress={logout}
          accessibilityRole="button"
        >
          <Text style={styles.unauthorizedButtonText}>Cerrar Sesión</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

export default function AppNavigator() {
  const { token, userRole, isLoading } = useAuth();

  // Pantalla de carga mientras se verifica AsyncStorage
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color="#059669" />
        <Text style={styles.loadingText}>Iniciando Remundial Core...</Text>
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#F8FAFC' },
        animation: 'slide_from_right',
      }}
    >
      {!token ? (
        // Flujo Público: Usuario no autenticado
        <Stack.Screen name="Login" component={LoginScreen} />
      ) : userRole === 'vendedor' ? (
        // Flujo Privado: Rol Vendedor en Terreno
        <Stack.Group>
          <Stack.Screen name="VendedorDashboard" component={VendedorDashboard} />
          <Stack.Screen name="NuevaVenta" component={NuevaVentaScreen} />
          <Stack.Screen name="Clientes" component={ClientesScreen} />
          <Stack.Screen name="Catalogo" component={CatalogoScreen} />
        </Stack.Group>
      ) : userRole === 'cobrador' ? (
        // Flujo Privado: Rol Cobrador en Terreno
        <Stack.Group>
          <Stack.Screen name="CobradorDashboard" component={CobradorDashboard} />
          <Stack.Screen name="Clientes" component={ClientesScreen} />
        </Stack.Group>
      ) : (
        // Flujo de Respaldo: Roles no contemplados en móvil de campo
        <Stack.Screen name="RolNoAutorizado" component={RolNoAutorizadoScreen} />
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  unauthorizedContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    padding: 20,
  },
  unauthorizedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 24,
    alignItems: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  unauthorizedIconBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  unauthorizedIconText: {
    fontSize: 22,
  },
  unauthorizedBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: '#E11D48',
    letterSpacing: 1,
    marginBottom: 4,
  },
  unauthorizedTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  unauthorizedText: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 16,
  },
  unauthorizedInfoBox: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    marginBottom: 18,
  },
  unauthorizedInfoLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  unauthorizedInfoName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  unauthorizedInfoRole: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  unauthorizedButton: {
    width: '100%',
    backgroundColor: '#0F172A',
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unauthorizedButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
