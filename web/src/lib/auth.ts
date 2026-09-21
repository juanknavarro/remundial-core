/**
 * Utilidades de Autenticación y Gestión de Sesión Segura para Remundial Core.
 */

export interface AuthUser {
  id?: string;
  nombre: string;
  rol: string;
  telefono?: string;
  cedula?: string;
  [key: string]: any;
}

export const AUTH_STORAGE_KEYS = {
  TOKEN: 'remundial_token',
  USER: 'remundial_user',
  COOKIE_NAME: 'remundial_token',
  LAST_ACTIVITY: 'remundial_last_activity',
};

// Umbral máximo de inactividad continua segura: 3 horas (en milisegundos)
export const MAX_INACTIVITY_MS = 3 * 60 * 60 * 1000;

/**
 * Valida la integridad estructural y vigencia de un token JWT.
 */
export function isTokenValid(token: string | null | undefined): boolean {
  if (!token || typeof token !== 'string') return false;
  const clean = token.trim();
  if (clean.length < 15) return false;

  try {
    const parts = clean.split('.');
    if (parts.length === 3) {
      // Base64Url decode de la carga útil (payload) con padding seguro
      let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      base64 = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      const parsed = JSON.parse(jsonPayload);
      if (parsed.exp && typeof parsed.exp === 'number') {
        const nowSec = Math.floor(Date.now() / 1000);
        // Expirado si el tiempo actual sobrepasa exp
        if (nowSec >= parsed.exp) {
          return false;
        }
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Obtiene el token de sesión almacenado en el cliente (localStorage o Cookie).
 */
export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const token = localStorage.getItem(AUTH_STORAGE_KEYS.TOKEN);
    if (isTokenValid(token)) return token;

    // Fallback: intentar leer desde cookie del navegador
    const cookieMatch = document.cookie
      .split('; ')
      .find((row) => row.startsWith(`${AUTH_STORAGE_KEYS.COOKIE_NAME}=`));
    if (cookieMatch) {
      const cookieToken = cookieMatch.split('=')[1];
      if (isTokenValid(cookieToken)) {
        // Resincronizar localStorage
        localStorage.setItem(AUTH_STORAGE_KEYS.TOKEN, cookieToken);
        return cookieToken;
      }
    }
  } catch {
    // Silencioso en caso de bloqueo de storage
  }
  return null;
}

/**
 * Obtiene el usuario autenticado desde localStorage.
 */
export function getStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEYS.USER);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Error al parsear JSON
  }
  return null;
}

let lastActivityInMemory = 0;

/**
 * Registra y persiste la marca de tiempo de la última interacción del usuario.
 * Aplica un throttling inteligente de 15 segundos para no sobrecargar el almacenamiento.
 */
export function updateLastActivity(force: boolean = false): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (force || now - lastActivityInMemory > 15000) {
    lastActivityInMemory = now;
    try {
      localStorage.setItem(AUTH_STORAGE_KEYS.LAST_ACTIVITY, String(now));
    } catch {
      // Ignora bloqueos de storage
    }
  }
}

/**
 * Obtiene el timestamp de la última actividad del usuario en milisegundos.
 */
export function getLastActivity(): number {
  if (typeof window === 'undefined') return Date.now();
  if (lastActivityInMemory > 0) return lastActivityInMemory;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEYS.LAST_ACTIVITY);
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed > 0) {
        lastActivityInMemory = parsed;
        return parsed;
      }
    }
  } catch {
    // Fallback
  }
  const now = Date.now();
  lastActivityInMemory = now;
  return now;
}

/**
 * Verifica si el usuario ha superado el tiempo máximo de inactividad continua (ej. 3 horas).
 */
export function hasInactivityTimedOut(maxDurationMs: number = MAX_INACTIVITY_MS): boolean {
  if (typeof window === 'undefined') return false;
  // Solo se valida si existe una sesión/token activa
  const token = localStorage.getItem(AUTH_STORAGE_KEYS.TOKEN);
  if (!token) return false;

  const lastActivity = getLastActivity();
  const elapsed = Date.now() - lastActivity;
  return elapsed > maxDurationMs;
}

/**
 * Cierre de sesión seguro y forzado por inactividad o expiración.
 */
export function handleInactivityLogout(reason: string = 'inactividad'): void {
  if (typeof window === 'undefined') return;
  clearAuthSession();
  if (!window.location.pathname.startsWith('/login')) {
    window.location.replace(`/login?reason=${encodeURIComponent(reason)}`);
  }
}

/**
 * Guarda las credenciales de sesión en localStorage y Cookie con SameSite.
 */
export function saveAuthSession(token: string, user: AuthUser): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AUTH_STORAGE_KEYS.TOKEN, token);
    localStorage.setItem(AUTH_STORAGE_KEYS.USER, JSON.stringify(user));
    // Guardar cookie accesible para el middleware de Next.js (7 días)
    document.cookie = `${AUTH_STORAGE_KEYS.COOKIE_NAME}=${token}; path=/; max-age=604800; SameSite=Lax`;
    updateLastActivity(true);
  } catch (e) {
    console.error('[Auth] Error guardando sesión:', e);
  }
}

/**
 * Limpia por completo cualquier credencial, token y almacenamiento de sesión.
 */
export function clearAuthSession(): void {
  if (typeof window === 'undefined') return;
  try {
    lastActivityInMemory = 0;
    localStorage.removeItem(AUTH_STORAGE_KEYS.TOKEN);
    localStorage.removeItem(AUTH_STORAGE_KEYS.USER);
    localStorage.removeItem(AUTH_STORAGE_KEYS.LAST_ACTIVITY);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('access_token');
    sessionStorage.clear();
    // Expirar la cookie inmediatamente en el navegador con múltiples combinaciones de path
    document.cookie = `${AUTH_STORAGE_KEYS.COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; SameSite=Lax`;
    document.cookie = `token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; SameSite=Lax`;
  } catch (e) {
    console.error('[Auth] Error limpiando sesión:', e);
  }
}
