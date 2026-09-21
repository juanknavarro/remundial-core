import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient, { STORAGE_KEYS, limpiarCredencialesLocales, setOnUnauthorized } from '../api/client';

export const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  /**
   * Carga la sesión almacenada en AsyncStorage al iniciar la aplicación.
   * Restaura el token, los datos del usuario y determina su rol en el sistema.
   */
  const loadStoredSession = useCallback(async () => {
    try {
      setIsLoading(true);
      const [storedToken, storedUser, storedRole, altToken, altUser] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.TOKEN),
        AsyncStorage.getItem(STORAGE_KEYS.USER),
        AsyncStorage.getItem(STORAGE_KEYS.ROLE),
        AsyncStorage.getItem('token'),
        AsyncStorage.getItem('user'),
      ]);

      const tokenEfectivo = storedToken || altToken;
      const userEfectivo = storedUser || altUser;

      if (tokenEfectivo && userEfectivo) {
        const parsedUser = JSON.parse(userEfectivo);
        setToken(tokenEfectivo);
        setUser(parsedUser);
        setUserRole(storedRole || parsedUser.rol);
      } else {
        // Si no hay credenciales completas válidas, asegurar almacenamiento limpio
        setToken(null);
        setUser(null);
        setUserRole(null);
      }
    } catch (error) {
      console.error('[AuthContext] Error restaurando sesión persistida:', error);
      // Limpieza profunda preventiva si los datos estuvieran corruptos
      try {
        await limpiarCredencialesLocales();
      } catch (cleanErr) {
        console.warn('[AuthContext] Error limpiando credenciales corruptas:', cleanErr);
      }
      setToken(null);
      setUser(null);
      setUserRole(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStoredSession();
  }, [loadStoredSession]);

  // Manejador reactivo global: cualquier petición interceptada con HTTP 401 fuerza el cierre y redirección a Login
  useEffect(() => {
    setOnUnauthorized(() => {
      console.warn('[AuthContext] Sesión expirada o token revocado (401). Forzando redirección inmediata a Login...');
      setToken(null);
      setUser(null);
      setUserRole(null);
      setAuthError('Tu sesión ha expirado o ya no es válida. Inicia sesión nuevamente.');
    });
    return () => setOnUnauthorized(null);
  }, []);


  /**
   * Inicia sesión contra el endpoint FastAPI /auth/login.
   * Envía credenciales en formato x-www-form-urlencoded conforme al estándar OAuth2 de FastAPI.
   *
   * @param {string} identifier - Teléfono o nombre del usuario.
   * @param {string} password - Contraseña del usuario.
   */
  const login = async (identifier, password) => {
    try {
      setAuthError(null);

      if (!identifier || !password) {
        const errorMsg = 'Ingrese su identificador y contraseña';
        setAuthError(errorMsg);
        return { success: false, error: errorMsg };
      }

      // Preparar payload compatible con OAuth2PasswordRequestForm de FastAPI
      const params = new URLSearchParams();
      params.append('username', identifier.trim());
      params.append('password', password);

      const response = await apiClient.post('/auth/login', params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const { access_token, usuario } = response.data;

      // Persistir token y datos del usuario en almacenamiento local
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.TOKEN, access_token),
        AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(usuario)),
        AsyncStorage.setItem(STORAGE_KEYS.ROLE, usuario.rol),
      ]);

      // Actualizar el estado global
      setToken(access_token);
      setUser(usuario);
      setUserRole(usuario.rol);

      return { success: true, user: usuario };
    } catch (error) {
      console.error('[AuthContext] Error en login:', error);

      let mensaje = 'Error de conexión con el servidor.';
      if (error.response?.data?.detail) {
        mensaje = typeof error.response.data.detail === 'string'
          ? error.response.data.detail
          : JSON.stringify(error.response.data.detail);
      } else if (error.message) {
        mensaje = error.message;
      }

      setAuthError(mensaje);
      return { success: false, error: mensaje };
    }
  };

  /**
   * Cierra la sesión activa y elimina las credenciales locales de forma exhaustiva (AsyncStorage y Web).
   * Destruye tokens, datos de usuario, cabeceras y limpia el estado global inmediatamente.
   */
  const logout = async () => {
    try {
      await limpiarCredencialesLocales();
    } catch (error) {
      console.error('[AuthContext] Error durante el cierre de sesión:', error);
    } finally {
      // Limpieza inmediata y síncrona del estado global para desmontar dashboards y conmutar a Login
      setToken(null);
      setUser(null);
      setUserRole(null);
      setAuthError(null);
    }
  };

  const value = {
    user,
    token,
    userRole,
    isAuthenticated: !!token,
    isLoading,
    authError,
    setAuthError,
    login,
    logout,
    refreshSession: loadStoredSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/**
 * Hook personalizado para acceder fácilmente al AuthContext
 */
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe ser utilizado dentro de un AuthProvider');
  }
  return context;
};

export default AuthContext;
