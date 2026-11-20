import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../api/client';
import { CACHE_CONFIG } from '../storage/database';

export const DEFAULT_EMPRESA = {
  razon_social: process.env.EXPO_PUBLIC_APP_NAME || 'Sistema Comercial',
  ciudad: 'Ciudad Principal',
  nit: '000.000.000-0',
  direccion: 'Oficina Comercial',
  telefono_pbx: '',
  pie_mobile: '',
};

/**
 * Obtiene la configuración de identidad corporativa de la empresa.
 * Estrategia Offline-First:
 * 1. Lee inmediatamente de la caché local en AsyncStorage (CACHE_CONFIG).
 * 2. Si no hay caché o si se solicita refresco, consulta la API (/configuracion/parametros).
 * 3. Devuelve los valores con fallbacks neutros genéricos.
 *
 * @param {boolean} [forzarRefresco=false] Si es true, intenta actualizar desde el backend.
 * @returns {Promise<{razon_social: string, ciudad: string, nit: string, direccion: string, telefono_pbx: string, pie_mobile: string}>}
 */
export async function obtenerConfigEmpresa(forzarRefresco = false) {
  let configData = null;

  // 1. Intentar leer de AsyncStorage
  try {
    const cached = await AsyncStorage.getItem(CACHE_CONFIG);
    if (cached) {
      configData = JSON.parse(cached);
    }
  } catch (err) {
    console.warn('[Empresa] Error al leer caché local de configuración:', err);
  }

  // 2. Si se fuerza el refresco o no hay datos en caché, consultar al backend
  if (forzarRefresco || !configData) {
    try {
      const res = await apiClient.get('/configuracion/parametros');
      if (res?.data) {
        configData = res.data;
        await AsyncStorage.setItem(CACHE_CONFIG, JSON.stringify(res.data));
      }
    } catch (_) {
      // Si la API falla (offline), continúa con lo que haya en configData
    }
  }

  const emp = configData?.empresa || {};
  return {
    razon_social: emp.razon_social || process.env.EXPO_PUBLIC_APP_NAME || DEFAULT_EMPRESA.razon_social,
    ciudad: emp.ciudad || DEFAULT_EMPRESA.ciudad,
    nit: emp.nit || DEFAULT_EMPRESA.nit,
    direccion: emp.direccion || DEFAULT_EMPRESA.direccion,
    telefono_pbx: emp.telefono_pbx || '',
    pie_mobile: configData?.identidad_visual?.pie_mobile || '',
  };
}

/**
 * Extrae la información de empresa de un objeto configData ya parseado en memoria
 * @param {object} configData
 * @returns {{razon_social: string, ciudad: string, nit: string, direccion: string, telefono_pbx: string}}
 */
export function extraerConfigEmpresaSync(configData) {
  const emp = configData?.empresa || {};
  return {
    razon_social: emp.razon_social || process.env.EXPO_PUBLIC_APP_NAME || DEFAULT_EMPRESA.razon_social,
    ciudad: emp.ciudad || DEFAULT_EMPRESA.ciudad,
    nit: emp.nit || DEFAULT_EMPRESA.nit,
    direccion: emp.direccion || DEFAULT_EMPRESA.direccion,
    telefono_pbx: emp.telefono_pbx || '',
  };
}
