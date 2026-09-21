'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  hasInactivityTimedOut,
  updateLastActivity,
  handleInactivityLogout,
  getStoredToken,
} from './auth';

export interface ResilienceToast {
  id: number;
  type: 'info' | 'warning' | 'success';
  title: string;
  message: string;
}

/**
 * Hook global de resiliencia y experiencia de usuario ante suspensiones de equipo,
 * reconexión de red y control de inactividad continua.
 */
export function useSessionResilience() {
  const router = useRouter();
  const [resilienceToast, setResilienceToast] = useState<ResilienceToast | null>(null);
  const lastWakeTimeRef = useRef<number>(Date.now());
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isHandlingTimeoutRef = useRef<boolean>(false);

  const showToast = useCallback((type: 'info' | 'warning' | 'success', title: string, message: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    const id = Date.now();
    setResilienceToast({ id, type, title, message });
    toastTimeoutRef.current = setTimeout(() => {
      setResilienceToast((curr) => (curr?.id === id ? null : curr));
    }, 4500);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setResilienceToast(null);
  }, []);

  // Verificar estado de sesión y recuperación de red
  const checkRecoveryAndTimeout = useCallback(
    (source: 'online' | 'focus' | 'visibility' | 'timeout-event') => {
      // Si no hay token activo, no realizamos comprobaciones de sesión protegida
      if (!getStoredToken()) return;

      // 1. Verificación de inactividad continua prolongada (> 3 horas)
      if (hasInactivityTimedOut()) {
        handleInactivityLogout('inactividad');
        return;
      }

      // 2. Si la sesión sigue vigente, registrar actividad y manejar reconexión
      const now = Date.now();
      const timeSinceLastWake = now - lastWakeTimeRef.current;
      lastWakeTimeRef.current = now;
      updateLastActivity(true);

      // Si se despierta tras una pausa notable (> 25s) o el evento fue 'online' o error de timeout
      if (source === 'online' || source === 'timeout-event' || timeSinceLastWake > 25000) {
        if (source === 'timeout-event') {
          showToast(
            'warning',
            'Sincronización Reanudada',
            'La conexión se interrumpió temporalmente por suspensión del equipo. Actualizando datos...'
          );
        } else {
          showToast(
            'success',
            'Conexión Restablecida',
            'Se detectó reactivación del navegador. Los datos de la sesión se encuentran sincronizados.'
          );
        }

        // Refresco suave de la ruta de Next.js para actualizar Server Components
        try {
          router.refresh();
        } catch {
          // Ignorar si el router no está disponible
        }

        // Emitir evento para que las vistas activas re-consulten si lo requieren
        window.dispatchEvent(new CustomEvent('remundial:sync-refresh'));
      }
    },
    [router, showToast]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // A. Capturar interacción activa del usuario para actualizar el temporizador de inactividad
    const onUserInteraction = () => {
      updateLastActivity();
    };

    const interactionEvents = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    interactionEvents.forEach((evt) => {
      window.addEventListener(evt, onUserInteraction, { passive: true });
    });

    // B. Detectar recuperación de conexión tras modo ahorro de energía / suspensión
    const onOnline = () => {
      checkRecoveryAndTimeout('online');
    };

    const onOffline = () => {
      showToast(
        'warning',
        'Sin Conexión a Internet',
        'El equipo se encuentra fuera de línea. La sincronización se reanudará tan pronto vuelva la red.'
      );
    };

    const onFocus = () => {
      checkRecoveryAndTimeout('focus');
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkRecoveryAndTimeout('visibility');
      }
    };

    // C. Escuchar evento de timeout / corte de petición disparado por Axios
    const onNetworkTimeout = (e: Event) => {
      // Evitar ráfagas de toasts si varias peticiones concurrentes fallan al mismo milisegundo
      if (isHandlingTimeoutRef.current) return;
      isHandlingTimeoutRef.current = true;
      checkRecoveryAndTimeout('timeout-event');
      setTimeout(() => {
        isHandlingTimeoutRef.current = false;
      }, 3000);
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('remundial:network-timeout', onNetworkTimeout);

    // D. Chequeo periódico cada 30 segundos para detectar inactividad pasiva prolongada
    const intervalId = setInterval(() => {
      if (getStoredToken()) {
        if (hasInactivityTimedOut()) {
          handleInactivityLogout('inactividad');
        }
      }
    }, 30000);

    return () => {
      interactionEvents.forEach((evt) => {
        window.removeEventListener(evt, onUserInteraction);
      });
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('remundial:network-timeout', onNetworkTimeout);
      clearInterval(intervalId);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, [checkRecoveryAndTimeout, showToast]);

  return {
    resilienceToast,
    dismissToast,
  };
}
