import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * URL base por defecto para el backend FastAPI:
 * - Emulador Android: 10.0.2.2 apunta al localhost de la máquina anfitriona.
 * - Simulador iOS / Web: localhost apunta directamente a la máquina.
 * - Para dispositivo físico con Expo Go: Cambiar a la IP local (ej: http://192.168.1.X:8000).
 */
export const DEFAULT_API_URL = Platform.select({
  android: 'http://10.0.2.2:8000',
  ios: 'http://localhost:8000',
  default: 'http://localhost:8000',
});

export const STORAGE_KEYS = {
  TOKEN: '@remundial_token',
  USER: '@remundial_user',
  ROLE: '@remundial_role',
  API_URL: '@remundial_api_url',
};

// Crear instancia de Axios
const apiClient = axios.create({
  baseURL: DEFAULT_API_URL,
  timeout: 15000,
  headers: {
    'Accept': 'application/json',
  },
});

// Interceptor de Solicitud: Inyecta el token Bearer si existe en AsyncStorage
apiClient.interceptors.request.use(
  async (config) => {
    try {
      // Permitir sobreescritura dinámica de la URL si se guardó una IP personalizada
      const customUrl = await AsyncStorage.getItem(STORAGE_KEYS.API_URL);
      if (customUrl) {
        config.baseURL = customUrl;
      }

      const token = await AsyncStorage.getItem(STORAGE_KEYS.TOKEN);
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      console.warn('[API Client] Error al leer credenciales de AsyncStorage:', error);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Manejador registrado para eventos de sesión inválida / expirada (401)
let onUnauthorizedCallback = null;

/**
 * Permite a AuthContext registrar un callback para reaccionar inmediatamente
 * a respuestas 401 del backend, purgando el estado en memoria y forzando la redirección a Login.
 */
export function setOnUnauthorized(callback) {
  onUnauthorizedCallback = callback;
}

/**
 * Ejecuta un borrado total y selectivo de credenciales guardadas en AsyncStorage
 * y window.localStorage / sessionStorage (en entorno Web), removiendo tanto claves
 * canónicas (@remundial_*) como claves alternativas ('token', 'user', etc.) y
 * revocando las cabeceras de Axios para evitar sesiones fantasmas o zombis.
 */
export async function limpiarCredencialesLocales() {
  const llavesCriticas = [
    STORAGE_KEYS.TOKEN,
    STORAGE_KEYS.USER,
    STORAGE_KEYS.ROLE,
    '@remundial_token',
    '@remundial_user',
    '@remundial_role',
    'token',
    'user',
    'role',
    'authToken',
    'auth_token',
    'usuario',
    'access_token',
    'current_user',
  ];

  // 1. Limpieza secuencial en AsyncStorage
  for (const k of llavesCriticas) {
    try {
      await AsyncStorage.removeItem(k);
    } catch (_) {}
  }

  // 1b. Si AsyncStorage implementa getAllKeys, remover cualquier clave residual de autenticación
  try {
    if (typeof AsyncStorage.getAllKeys === 'function') {
      const allKeys = await AsyncStorage.getAllKeys();
      const keysToPurge = (allKeys || []).filter((key) => {
        const lower = String(key).toLowerCase();
        return (
          lower.includes('token') ||
          lower.includes('user') ||
          lower.includes('role') ||
          lower.includes('auth') ||
          lower.includes('session')
        );
      });
      for (const k of keysToPurge) {
        try {
          await AsyncStorage.removeItem(k);
        } catch (_) {}
      }
    }
  } catch (_) {}

  // 2. Limpieza exhaustiva en entorno Web (localStorage y sessionStorage)
  if (typeof window !== 'undefined') {
    llavesCriticas.forEach((k) => {
      try {
        window.localStorage?.removeItem(k);
      } catch (_) {}
      try {
        window.sessionStorage?.removeItem(k);
      } catch (_) {}
    });

    try {
      if (window.localStorage && window.localStorage.length) {
        for (let i = window.localStorage.length - 1; i >= 0; i--) {
          const k = window.localStorage.key(i);
          if (k) {
            const lower = k.toLowerCase();
            if (
              lower.includes('token') ||
              lower.includes('user') ||
              lower.includes('role') ||
              lower.includes('auth') ||
              lower.includes('session')
            ) {
              window.localStorage.removeItem(k);
            }
          }
        }
      }
    } catch (_) {}

    try {
      if (window.sessionStorage && window.sessionStorage.length) {
        for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
          const k = window.sessionStorage.key(i);
          if (k) {
            const lower = k.toLowerCase();
            if (
              lower.includes('token') ||
              lower.includes('user') ||
              lower.includes('role') ||
              lower.includes('auth')
            ) {
              window.sessionStorage.removeItem(k);
            }
          }
        }
      }
    } catch (_) {}
  }

  // 3. Destruir cabeceras de autorización en Axios en memoria
  try {
    delete apiClient.defaults.headers.common['Authorization'];
    delete apiClient.defaults.headers['Authorization'];
  } catch (_) {}
}

// Interceptor de Respuesta: Monitorea errores comunes (401 no autorizado)
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response && error.response.status === 401) {
      console.warn('[API Client] Sesión no autorizada o expirada (401). Purgando credenciales locales...');
      try {
        await limpiarCredencialesLocales();
      } catch (_) {}
      if (typeof onUnauthorizedCallback === 'function') {
        try {
          onUnauthorizedCallback();
        } catch (cbErr) {
          console.warn('[API Client] Error en callback de sesión expirada:', cbErr);
        }
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;

