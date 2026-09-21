import axios from 'axios';
import {
  getStoredToken,
  clearAuthSession,
  hasInactivityTimedOut,
  handleInactivityLogout,
  updateLastActivity,
} from './auth';

/**
 * Instancia base de Axios para el Panel Web Administrativo.
 * Conecta directamente al servidor FastAPI en http://localhost:8000.
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

// Interceptor para inyectar token JWT si existe y es válido, actualizando actividad
api.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      // 1. Validar si la inactividad continua superó el umbral seguro (3h)
      if (hasInactivityTimedOut()) {
        handleInactivityLogout('inactividad');
        return Promise.reject(new axios.Cancel('Sesión cerrada por inactividad continua prolongada'));
      }

      const token = getStoredToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      updateLastActivity();
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Interceptor de respuesta para capturar expiración (401) y congelamiento por suspensión / red
api.interceptors.response.use(
  (response) => {
    if (typeof window !== 'undefined') {
      updateLastActivity();
    }
    return response;
  },
  (error) => {
    if (typeof window !== 'undefined') {
      // 1. Expiración o rechazo de credenciales por el servidor (401)
      if (error.response && error.response.status === 401) {
        clearAuthSession();
        if (!window.location.pathname.startsWith('/login')) {
          window.location.replace('/login?reason=expirado');
        }
        return Promise.reject(error);
      }

      // 2. Verificar si durante la espera se excedió el tiempo máximo de suspensión/inactividad
      if (hasInactivityTimedOut()) {
        handleInactivityLogout('inactividad');
        return Promise.reject(error);
      }

      // 3. Capturar congelamiento por suspensión de equipo, timeout o corte de red
      const isTimeout = error.code === 'ECONNABORTED' || (error.message && error.message.toLowerCase().includes('timeout'));
      const isNetworkError = error.message === 'Network Error' || (!error.response && !axios.isCancel(error));

      if (isTimeout || isNetworkError) {
        // Emitir evento global de desconexión/congelamiento para recuperación automática
        window.dispatchEvent(
          new CustomEvent('remundial:network-timeout', {
            detail: {
              url: error.config?.url,
              isTimeout,
              isNetworkError,
            },
          })
        );
      }
    }
    return Promise.reject(error);
  }
);

export default api;
