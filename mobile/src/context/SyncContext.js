import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { AppState, Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient, { STORAGE_KEYS } from '../api/client';
import {
  encolarTransaccion,
  obtenerCola,
  obtenerColaPendiente,
  actualizarItemCola,
  eliminarDeCola,
  registrarFalloEnCola,
  limpiarItemsFallidosCola,
  guardarEnCache,
  STORAGE_KEYS as DB_STORAGE_KEYS,
} from '../storage/database';

/**
 * Determina si un error de axios/fetch corresponde a un fallo de red o conectividad real
 * (servidor inalcanzable, sin conexión, timeout, fallo DNS, proxy 502-504).
 */
export function esErrorDeRed(error) {
  if (!error) return true;
  // Sin respuesta HTTP del servidor (offline real, server caído, conexión rechazada)
  if (!error.response) return true;
  // Códigos de red/timeout
  if (error.code === 'ECONNABORTED' || error.code === 'ERR_NETWORK') return true;
  // Caída de proxy / gateway
  if (error.response.status >= 502 && error.response.status <= 504) return true;
  // Mensajes comunes de fallo de red
  const msg = String(error.message || '').toLowerCase();
  if (msg.includes('network') || msg.includes('timeout') || msg.includes('failed to fetch')) return true;
  return false;
}

const SyncContext = createContext(null);

export function SyncProvider({ children }) {
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [syncErrors, setSyncErrors] = useState([]);

  const isSyncingRef = useRef(false);

  // =========================================================================
  // 1. REFRESCAR CONTADOR DE PENDIENTES
  // =========================================================================
  const refrescarContador = useCallback(async () => {
    try {
      await limpiarItemsFallidosCola();
      const cola = await obtenerColaPendiente();
      setPendingCount(cola.length);
    } catch {
      // ignore
    }
  }, []);

  // =========================================================================
  // 2. DETECTOR DE RED Y LATIDO (HEARTBEAT)
  // =========================================================================
  const verificarConectividad = useCallback(async () => {
    // Si estamos en navegador y el browser dice offline
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOnline(false);
      return false;
    }

    try {
      // Ping rápido de verificación al backend
      const res = await apiClient.get('/health', { timeout: 3500 });
      const online = res.status === 200;
      setIsOnline(online);
      return online;
    } catch {
      setIsOnline(false);
      return false;
    }
  }, []);

  // =========================================================================
  // 3. PROCESADOR DE COLA EN SEGUNDO PLANO (SIN RETENCIONES INNECESARIAS)
  // =========================================================================
  const procesarCola = useCallback(async () => {
    if (isSyncingRef.current) return;

    isSyncingRef.current = true;
    setIsSyncing(true);

    try {
      const colaPendiente = await obtenerColaPendiente();
      if (colaPendiente.length === 0) {
        setPendingCount(0);
        return;
      }

      const errores = [];

      for (const item of colaPendiente) {
        try {
          if (item.type === 'venta') {
            await apiClient.post('/creditos', item.payload);
            await eliminarDeCola(item.id);
          } else if (item.type === 'abono') {
            const rawP = item.payload || {};
            let cobId = String(rawP.cobrador_id || rawP.cobradorId || '').trim();
            if (!cobId) {
              try {
                const storedUserRaw = await AsyncStorage.getItem(STORAGE_KEYS.USER);
                if (storedUserRaw) {
                  const u = JSON.parse(storedUserRaw);
                  if (u?.id) cobId = String(u.id).trim();
                }
              } catch (_) {}
            }

            const payloadCola = {
              credito_id: String(rawP.credito_id || rawP.creditoId || rawP.id_contrato || '').trim(),
              cobrador_id: cobId,
              valor_abonado: parseFloat(Number(rawP.valor_abonado ?? rawP.valor_abono ?? rawP.monto ?? rawP.valor ?? 0).toFixed(2)),
              coordenadas_gps_cobro: {
                latitud: Number(rawP.coordenadas_gps_cobro?.latitud ?? rawP.latitud ?? 8.756412),
                longitud: Number(rawP.coordenadas_gps_cobro?.longitud ?? rawP.longitud ?? -75.884129),
              },
              metodo_pago: String(rawP.metodo_pago || 'efectivo').trim(),
            };
            if (rawP.notas) {
              payloadCola.notas = String(rawP.notas).trim();
            }
            if (rawP.numero_cuota != null && !isNaN(Number(rawP.numero_cuota))) {
              payloadCola.numero_cuota = Number(rawP.numero_cuota);
            }
            if (rawP.firma_cliente) {
              payloadCola.firma_cliente = rawP.firma_cliente;
            }
            if (rawP.firma_cobrador || item.meta?.firma_cobrador) {
              payloadCola.firma_cobrador = rawP.firma_cobrador || item.meta?.firma_cobrador;
            }
            const nomCobradorCola = rawP.cobrador_nombre || item.meta?.cobrador_nombre || item.meta?.cobrador;
            if (nomCobradorCola) {
              payloadCola.cobrador_nombre = nomCobradorCola;
            }

            console.log(`[SyncContext] Sincronizando abono ${item.id} con el servidor...`, payloadCola);
            const resPost = await apiClient.post('/abonos', payloadCola);
            await eliminarDeCola(item.id);
            console.log(`[SyncContext] Abono ${item.id} sincronizado exitosamente con el servidor. ID Servidor: ${resPost.data?.id_recibo || 'OK'}`);
          }
        } catch (itemErr) {
          // Si el servidor respondió con un error de cliente (400, 422, etc.), registrar para auditoría y remover de cola
          if (itemErr.response && itemErr.response.status >= 400 && itemErr.response.status < 500) {
            console.warn(`[SyncContext - Auditoría Producción] Transacción ${item.id} (${item.type}) descartada por validación del servidor (${itemErr.response.status}):`, {
              payload: item.payload,
              error_detail: itemErr.response?.data,
            });
            // Cortar de raíz cualquier bucle eliminando la transacción rechazada de la cola SQLite
            await eliminarDeCola(item.id);
            const msg = typeof itemErr.response.data?.detail === 'string'
              ? itemErr.response.data.detail
              : JSON.stringify(itemErr.response.data?.detail || itemErr.response.data);
            errores.push({ id: item.id, error: msg });
            continue;
          }

          const msg = itemErr.response?.data?.detail || itemErr.message || 'Error de comunicación';
          console.warn(`[SyncContext] Fallo transitorio sincronizando transacción ${item.id}:`, msg);
          await registrarFalloEnCola(item.id, typeof msg === 'string' ? msg : JSON.stringify(msg));
          errores.push({ id: item.id, error: msg });

          // Si el fallo es de conectividad / red, sabemos que el servidor sigue inalcanzable
          if (esErrorDeRed(itemErr)) {
            setIsOnline(false);
            break; // No seguir bombardeando peticiones si no hay red
          }
        }
      }

      setSyncErrors(errores);
      setLastSyncTime(new Date());
    } catch (err) {
      console.warn('[SyncContext] Error durante la sincronización de cola:', err);
    } finally {
      await refrescarContador();
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [refrescarContador]);

  // =========================================================================
  // 3b. SINCRONIZACIÓN DE CATÁLOGO DE CIUDADES OPERATIVAS
  // =========================================================================
  const sincronizarCiudadesOperativas = useCallback(async () => {
    try {
      const res = await apiClient.get('/config/ciudades', { timeout: 4000 });
      const data = res.data;
      let estructura = null;
      if (data?.departamentos && typeof data.departamentos === 'object' && !Array.isArray(data.departamentos)) {
        estructura = data.departamentos;
      } else if (data?.ciudades && typeof data.ciudades === 'object' && !Array.isArray(data.ciudades)) {
        estructura = data.ciudades;
      } else if (Array.isArray(data?.ciudades) || Array.isArray(data)) {
        const flat = Array.isArray(data?.ciudades) ? data.ciudades : data;
        estructura = {
          'Córdoba': flat,
          'Sucre': [],
        };
      }
      if (estructura && Object.keys(estructura).length > 0) {
        await guardarEnCache(DB_STORAGE_KEYS.CACHE_CIUDADES, estructura);
        return estructura;
      }
    } catch (err) {
      console.warn('[SyncContext] Fallo transitorio al actualizar catálogo de ciudades:', err?.message);
    }
    return null;
  }, []);

  // =========================================================================
  // 4. LISTENERS DE CICLO DE VIDA (AppState y Navegador)
  // =========================================================================
  useEffect(() => {
    refrescarContador();
    verificarConectividad().then((online) => {
      if (online) sincronizarCiudadesOperativas();
    });

    // Eventos Web online / offline: sincronizar al instante sin retardos
    const handleOnline = () => {
      setIsOnline(true);
      procesarCola();
      sincronizarCiudadesOperativas();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }

    // AppState listener (detección al volver de segundo plano o suspensión)
    const appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        verificarConectividad().then((online) => {
          if (online) {
            procesarCola();
            sincronizarCiudadesOperativas();
          }
        });
      }
    });

    // Verificación y sincronización ultra-rápida cada 3 segundos cuando haya transacciones pendientes
    const interval = setInterval(() => {
      if (pendingCount > 0) {
        procesarCola();
      }
    }, 3000);

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      }
      appStateSubscription.remove();
      clearInterval(interval);
    };
  }, [procesarCola, verificarConectividad, refrescarContador, sincronizarCiudadesOperativas, pendingCount]);

  // =========================================================================
  // 5. REGISTRO DIRECTO A LA API CON RESCATE AUTOMÁTICO OFFLINE
  // =========================================================================

  /**
   * Registra una venta priorizando el envío directo a la API de FastAPI.
   * Si la petición es exitosa, se procesa al instante.
   * Solo si ocurre una excepción de red o falta de conexión, se rescata en SQLite.
   */
  const encolarVenta = async (payload, meta = {}) => {
    // 1. INTENTO DIRECTO INMEDIATO A LA API
    try {
      console.log('[SyncContext] Transmitiendo venta directa a la API...');
      const res = await apiClient.post('/creditos', payload);
      
      setIsOnline(true);

      // Si había operaciones previas en cola, vaciar cola inmediatamente
      if (pendingCount > 0) {
        procesarCola();
      }

      return {
        ok: true,
        offline: false,
        data: res.data,
      };
    } catch (netErr) {
      // 1. Log de inspección de error 400
      if (netErr.response && (netErr.response.status === 400 || (netErr.response.status >= 400 && netErr.response.status < 500))) {
        console.error("DETALLE DEL ERROR 400 EN VENTA:", netErr.response?.data);
      } else {
        console.warn('[SyncContext] Error capturado en envío directo de venta:', netErr?.message);
      }

      // 2. CORTE DEL BUCLE: Si es error de cliente (400, 422, etc.), no encolar ni reintentar
      if (netErr.response && netErr.response.status >= 400 && netErr.response.status < 500) {
        let errorMsg = 'Error en los datos de la venta.';
        const detail = netErr.response?.data?.detail;
        if (typeof detail === 'string') {
          errorMsg = detail;
        } else if (Array.isArray(detail)) {
          errorMsg = detail.map((d) => d.msg || d.message || JSON.stringify(d)).join('\n');
        } else if (typeof detail === 'object') {
          errorMsg = detail.msg || detail.message || JSON.stringify(detail);
        } else if (netErr.response?.data?.message) {
          errorMsg = netErr.response.data.message;
        } else if (netErr.message) {
          errorMsg = netErr.message;
        }

        return {
          ok: false,
          offline: false,
          status: netErr.response.status,
          error: errorMsg,
        };
      }

      // 3. RESCATE DE EMERGENCIA: Solo si es fallo de red / conectividad
      if (esErrorDeRed(netErr)) {
        setIsOnline(false);
        try {
          console.log('[SyncContext] Activando rescate offline: guardando venta en SQLite...');
          const itemEncolado = await encolarTransaccion('venta', payload, {
            ...meta,
            motivo_offline: 'Fallo de conectividad en vuelo',
          });
          await refrescarContador();

          return {
            ok: true,
            offline: true,
            data: {
              id: itemEncolado.id,
              id_contrato: itemEncolado.id,
            },
            idLocal: itemEncolado.id,
            error: 'Sin conexión al servidor. Venta en cola local offline.',
          };
        } catch (dbErr) {
          console.error('[SyncContext] Error guardando venta en SQLite:', dbErr);
          return {
            ok: false,
            offline: true,
            error: 'Fallo de red y no se pudo guardar en almacenamiento local.',
          };
        }
      }

      return {
        ok: false,
        offline: false,
        error: netErr.message || 'Error inesperado al procesar la venta.',
      };
    }
  };

  /**
   * Registra un abono de cartera de forma atómica en SQLite (Arquitectura Offline-First).
   * Devuelve el resultado de forma instantánea (< 10ms) para garantizar fluidez visual absoluta
   * en la hoja de ruta, cerrando el modal y desplegando el comprobante sin congelar la app.
   * La cola se sincroniza automáticamente en segundo plano cada 3 segundos hacia FastAPI.
   */
  const encolarAbono = async (payload, meta = {}) => {
    console.log("👉 [DEBUG ENCOLAR 1 - INICIO] encolarAbono invocado con payload:", payload, "y meta:", meta);

    // 0. CONSTRUCCIÓN Y ALINEACIÓN MILIMÉTRICA DEL PAYLOAD (JSON)
    // FastAPI / Pydantic espera: credito_id (UUID), cobrador_id (UUID), valor_abonado (Decimal > 0), coordenadas_gps_cobro ({ latitud: float, longitud: float })
    const creditoId = (payload.credito_id || payload.creditoId || payload.id_contrato || '').toString().trim();
    const cobradorId = (payload.cobrador_id || payload.cobradorId || '').toString().trim();
    const rawMonto = payload.valor_abonado ?? payload.valor_abono ?? payload.monto ?? payload.valor ?? 0;
    const valorAbonado = parseFloat(Number(rawMonto).toFixed(2));

    const latGps = Number(
      payload.coordenadas_gps_cobro?.latitud ??
      payload.latitud ??
      payload.lat ??
      8.756412
    );
    const lonGps = Number(
      payload.coordenadas_gps_cobro?.longitud ??
      payload.longitud ??
      payload.lon ??
      payload.lng ??
      -75.884129
    );

    const payloadAbono = {
      credito_id: creditoId,
      cobrador_id: cobradorId,
      valor_abonado: valorAbonado,
      coordenadas_gps_cobro: {
        latitud: isNaN(latGps) ? 8.756412 : latGps,
        longitud: isNaN(lonGps) ? -75.884129 : lonGps,
      },
      metodo_pago: (payload.metodo_pago || 'efectivo').toString().trim(),
    };

    if (payload.notas && typeof payload.notas === 'string' && payload.notas.trim().length > 0) {
      payloadAbono.notas = payload.notas.trim();
    }
    if (payload.numero_cuota != null && !isNaN(Number(payload.numero_cuota))) {
      payloadAbono.numero_cuota = Number(payload.numero_cuota);
    }
    if (payload.firma_cliente) {
      payloadAbono.firma_cliente = payload.firma_cliente;
    }
    if (payload.firma_cobrador) {
      payloadAbono.firma_cobrador = payload.firma_cobrador;
    }
    if (payload.cobrador_nombre || meta?.cobrador_nombre || meta?.cobrador) {
      payloadAbono.cobrador_nombre = payload.cobrador_nombre || meta?.cobrador_nombre || meta?.cobrador;
    }

    console.log("👉 [DEBUG ENCOLAR 2 - PAYLOAD LISTO] Objeto estructurado para SQLite:", payloadAbono);

    // Validaciones preventivas de datos antes del almacenamiento local
    if (!payloadAbono.credito_id) {
      console.error('❌ [DEBUG ENCOLAR ERROR] credito_id no puede ser nulo ni vacío.', payload);
      Alert.alert('Error de Registro', 'El identificador del crédito (credito_id) es obligatorio.');
      return { ok: false, offline: true, error: 'credito_id es obligatorio' };
    }
    if (!payloadAbono.cobrador_id) {
      console.error('❌ [DEBUG ENCOLAR ERROR] cobrador_id no puede ser nulo ni vacío.', payload);
      Alert.alert('Error de Registro', 'El identificador del cobrador (cobrador_id) es obligatorio.');
      return { ok: false, offline: true, error: 'cobrador_id es obligatorio' };
    }
    if (isNaN(payloadAbono.valor_abonado) || payloadAbono.valor_abonado <= 0) {
      console.error('❌ [DEBUG ENCOLAR ERROR] valor_abonado debe ser mayor a cero.', payload);
      Alert.alert('Error de Registro', 'El monto a abonar debe ser mayor a $0.');
      return { ok: false, offline: true, error: 'valor_abonado debe ser mayor a 0' };
    }

    // 1. REGISTRO ATÓMICO INMEDIATO EN SQLITE (Offline-First Garantizado)
    try {
      console.log('👉 [DEBUG ENCOLAR 3 - INSERT SQLITE] Ejecutando encolarTransaccion en SQLite local...');
      const itemEncolado = await encolarTransaccion('abono', payloadAbono, {
        ...meta,
        fecha: meta?.fecha || new Date().toISOString(),
        cliente_nombre: meta?.cliente_nombre || 'Cliente en Ruta',
        numero_contrato: meta?.numero_contrato || 'CTR-RUTA',
        valor: valorAbonado,
        saldo_pendiente: meta?.saldo_pendiente != null ? meta.saldo_pendiente : null,
        firma_cliente: payloadAbono.firma_cliente || null,
        firma_cobrador: payloadAbono.firma_cobrador || null,
        cobrador_nombre: meta?.cobrador_nombre || meta?.cobrador || null,
      });

      console.log('👉 [DEBUG ENCOLAR 4 - INSERT EXITOSO] Inserción en SQLite completada:', itemEncolado);
      await refrescarContador();

      // Disparar sincronización asíncrona de fondo de inmediato (sin demoras ni bloqueos en la interfaz)
      setTimeout(() => {
        console.log('👉 [DEBUG ENCOLAR 5 - DISPARAR COLA] Disparando procesarCola() en segundo plano...');
        procesarCola().catch((syncErr) => {
          console.warn('[SyncContext] Vaciado background encolarAbono:', syncErr?.message);
        });
      }, 80);

      const respuestaSync = {
        ok: true,
        offline: true,
        data: {
          id_recibo: itemEncolado.id,
          id: itemEncolado.id,
          saldo_restante_credito: meta?.saldo_pendiente != null ? meta.saldo_pendiente : null,
          cliente_nombre: meta?.cliente_nombre || 'Cliente en Ruta',
          numero_contrato: meta?.numero_contrato || 'CTR-RUTA',
          valor_abonado: valorAbonado,
          metodo_pago: payloadAbono.metodo_pago,
          fecha: new Date().toISOString(),
          coordenadas_gps_cobro: payloadAbono.coordenadas_gps_cobro,
          firma_cliente: payloadAbono.firma_cliente || null,
          firma_cobrador: payloadAbono.firma_cobrador || null,
          cobrador_nombre: meta?.cobrador_nombre || meta?.cobrador || null,
        },
        idLocal: itemEncolado.id,
      };

      console.log('👉 [DEBUG ENCOLAR 6 - RETORNO] Retornando resultado atómico a CobradorDashboard:', respuestaSync);
      return respuestaSync;
    } catch (dbErr) {
      console.error('❌ [DEBUG ENCOLAR ERROR CATCH] Error crítico guardando abono en SQLite:', dbErr);
      Alert.alert('Error de Almacenamiento', 'No se pudo guardar el abono en el almacenamiento local SQLite.');
      return {
        ok: false,
        offline: true,
        error: 'Fallo al guardar en base de datos local SQLite.',
      };
    }
  };

  /**
   * Obtiene las ventas locales en cola pendientes para visualización inmediata en "Mis Ventas".
   */
  const obtenerVentasLocalesPendientes = async () => {
    try {
      const cola = await obtenerCola();
      return cola.filter((item) => item.type === 'venta' && item.status === 'pending');
    } catch {
      return [];
    }
  };

  /**
   * Obtiene los abonos locales en cola pendientes para visualización inmediata en "Mis Recaudos".
   */
  const obtenerAbonosLocalesPendientes = async () => {
    try {
      const cola = await obtenerCola();
      return cola.filter((item) => item.type === 'abono' && item.status === 'pending');
    } catch {
      return [];
    }
  };

  return (
    <SyncContext.Provider
      value={{
        isOnline,
        isSyncing,
        pendingCount,
        lastSyncTime,
        syncErrors,
        forzarSincronizacion: procesarCola,
        sincronizarCiudadesOperativas,
        encolarVenta,
        encolarAbono,
        obtenerVentasLocalesPendientes,
        obtenerAbonosLocalesPendientes,
        refrescarContador,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useSync debe ser utilizado dentro de un SyncProvider');
  }
  return context;
}
