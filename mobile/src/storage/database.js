import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Capa de Persistencia Local para Arquitectura Offline-First de Remundial Core.
 * Compatible con Android, iOS y React Native Web.
 */

export const STORAGE_KEYS = {
  SYNC_QUEUE: '@remundial_sync_queue',
  DRAFT_VENTA: '@remundial_form_draft_venta',
  CACHE_CLIENTES: '@remundial_cache_clientes',
  CACHE_PRODUCTOS: '@remundial_cache_productos',
  CACHE_CREDITOS: '@remundial_cache_creditos',
  CACHE_ABONOS: '@remundial_cache_abonos',
  CACHE_CIUDADES: '@remundial_cache_ciudades',
};

// ============================================================================
// COLA DE SINCRONIZACIÓN (TRANSACCIONES OFFLINE)
// ============================================================================

/**
 * Obtiene todos los elementos en la cola de sincronización.
 * @returns {Promise<Array>} Lista de transacciones en cola.
 */
export async function obtenerCola() {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.SYNC_QUEUE);
    return data ? JSON.parse(data) : [];
  } catch (err) {
    console.warn('[Database] Error al leer cola de sincronización:', err);
    return [];
  }
}

/**
 * Obtiene únicamente las transacciones pendientes por enviar al backend.
 * @returns {Promise<Array>}
 */
export async function obtenerColaPendiente() {
  const cola = await obtenerCola();
  return cola.filter((item) => item.status === 'pending');
}

// Mutex para serializar operaciones en cola y prevenir condiciones de carrera (race conditions)
let queueLock = Promise.resolve();

function withQueueLock(fn) {
  const next = queueLock.then(() => fn(), () => fn());
  queueLock = next.catch(() => {});
  return next;
}

/**
 * Encola una nueva transacción (venta o abono) para envío seguro.
 * @param {'venta' | 'abono'} type
 * @param {Object} payload Datos a transmitir por HTTP
 * @param {Object} meta Metadatos descriptivos para la interfaz
 * @returns {Promise<Object>} El elemento encolado con su ID local
 */
export function encolarTransaccion(type, payload, meta = {}) {
  return withQueueLock(async () => {
    try {
      const cola = await obtenerCola();
      const idLocal = `${type.toUpperCase()}-OFF-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

      const nuevoItem = {
        id: idLocal,
        type,
        payload,
        meta,
        createdAt: new Date().toISOString(),
        retryCount: 0,
        lastError: null,
        status: 'pending', // 'pending' | 'syncing' | 'synced' | 'failed'
      };

      const nuevaCola = [...cola, nuevoItem];
      await AsyncStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(nuevaCola));
      return nuevoItem;
    } catch (err) {
      console.warn('[Database] Error al encolar transacción:', err);
      throw err;
    }
  });
}

/**
 * Actualiza el estado o respuesta de un elemento de la cola.
 */
export function actualizarItemCola(id, updates = {}) {
  return withQueueLock(async () => {
    try {
      const cola = await obtenerCola();
      const nuevaCola = cola.map((item) => {
        if (item.id === id) {
          return { ...item, ...updates };
        }
        return item;
      });
      await AsyncStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(nuevaCola));
    } catch (err) {
      console.warn('[Database] Error actualizando item de cola:', err);
    }
  });
}

/**
 * Remueve un elemento de la cola tras una sincronización confirmada.
 */
export function eliminarDeCola(id) {
  return withQueueLock(async () => {
    try {
      const cola = await obtenerCola();
      const nuevaCola = cola.filter((item) => item.id !== id);
      await AsyncStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(nuevaCola));
    } catch (err) {
      console.warn('[Database] Error al eliminar item de cola:', err);
    }
  });
}

/**
 * Incrementa el contador de reintentos y registra el error.
 */
export function registrarFalloEnCola(id, errorMsg) {
  return withQueueLock(async () => {
    try {
      const cola = await obtenerCola();
      const nuevaCola = cola.map((item) => {
        if (item.id === id) {
          const retries = (item.retryCount || 0) + 1;
          // Si el error es un 400/4xx de cliente o excede 3 reintentos, marcar 'failed' inmediatamente
          const isClientError = typeof errorMsg === 'string' && (errorMsg.includes('400') || errorMsg.includes('cancelado') || errorMsg.includes('Bad Request'));
          return {
            ...item,
            status: (isClientError || retries >= 3) ? 'failed' : 'pending',
            retryCount: retries,
            lastError: errorMsg,
            lastAttemptAt: new Date().toISOString(),
          };
        }
        return item;
      });
      await AsyncStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(nuevaCola));
    } catch (err) {
      console.warn('[Database] Error al registrar fallo en cola:', err);
    }
  });
}

/**
 * Purga de la cola elementos que hayan fallado permanentemente o rechazados por reglas de negocio (400, cancelados).
 */
export function limpiarItemsFallidosCola() {
  return withQueueLock(async () => {
    try {
      const cola = await obtenerCola();
      const nuevaCola = cola.filter((item) => {
        if (item.status === 'failed') return false;
        if (item.lastError && (item.lastError.includes('400') || item.lastError.includes('cancelado') || item.lastError.includes('Bad Request'))) {
          return false;
        }
        return true;
      });
      await AsyncStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(nuevaCola));
      return nuevaCola;
    } catch (err) {
      console.warn('[Database] Error purgando items fallidos de la cola:', err);
    }
  });
}

// ============================================================================
// PROTECCIÓN CONTRA SUSPENSIÓN / AHORRO DE ENERGÍA: BORRADOR DE FORMULARIO
// ============================================================================

/**
 * Guarda el estado actual del formulario de Nueva Venta.
 */
export async function guardarBorradorVenta(draftData) {
  try {
    if (!draftData) {
      await AsyncStorage.removeItem(STORAGE_KEYS.DRAFT_VENTA);
      return;
    }
    const payload = {
      ...draftData,
      savedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(STORAGE_KEYS.DRAFT_VENTA, JSON.stringify(payload));
  } catch (err) {
    console.warn('[Database] Error al guardar borrador de venta:', err);
  }
}

/**
 * Obtiene el borrador persistido del formulario si existe.
 */
export async function obtenerBorradorVenta() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.DRAFT_VENTA);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn('[Database] Error al leer borrador de venta:', err);
    return null;
  }
}

/**
 * Limpia el borrador al finalizar o cancelar la venta.
 */
export async function limpiarBorradorVenta() {
  try {
    await AsyncStorage.removeItem(STORAGE_KEYS.DRAFT_VENTA);
  } catch (err) {
    console.warn('[Database] Error al limpiar borrador:', err);
  }
}

// ============================================================================
// CACHÉ LOCAL OFFLINE (CLIENTES, PRODUCTOS, CRÉDITOS)
// ============================================================================

export async function guardarEnCache(key, data) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.warn(`[Database] Error guardando caché para ${key}:`, err);
  }
}

export async function obtenerDeCache(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn(`[Database] Error leyendo caché para ${key}:`, err);
    return null;
  }
}
