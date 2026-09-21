import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import SyncStatusBar from './SyncStatusBar';

/**
 * Contenedor adaptativo para simular un smartphone real cuando la aplicación
 * se ejecuta en navegadores web (React Native Web), evitando que la interfaz
 * se estire horizontalmente en monitores de escritorio.
 * 
 * En dispositivos físicos nativos (iOS / Android), ocupa el 100% de la pantalla.
 */
export default function DeviceWrapper({ children }) {
  React.useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const styleId = 'rnw-input-clean-focus';
      let style = document.getElementById(styleId);
      if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        document.head.appendChild(style);
      }
      style.textContent = `
        input, textarea, select {
          outline: none !important;
          box-shadow: none !important;
        }
        input:focus, textarea:focus, select:focus {
          outline: none !important;
          box-shadow: none !important;
        }
        /* Ocultar iconos nativos duplicados de revelado de contraseña en Windows Edge/Chrome */
        input::-ms-reveal,
        input::-ms-clear {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
        }
        input::-webkit-credentials-auto-fill-button {
          visibility: hidden !important;
          display: none !important;
          pointer-events: none !important;
        }
      `;
    }
  }, []);

  if (Platform.OS !== 'web') {
    return (
      <View style={styles.nativeContainer}>
        <SyncStatusBar />
        {children}
      </View>
    );
  }

  return (
    <View style={styles.webOuterContainer}>
      <View style={styles.phoneChassis}>
        {/* Barra superior de bocina / notch sutil */}
        <View style={styles.topNotchContainer}>
          <View style={styles.topSpeakerPill} />
        </View>

        {/* Barra de estado de sincronización y red */}
        <SyncStatusBar />

        {/* Pantalla del dispositivo */}
        <View style={styles.screenInner}>
          {children}
        </View>

        {/* Barra inferior de gestos (Home Indicator) */}
        <View style={styles.homeBarContainer}>
          <View style={styles.homeIndicator} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  nativeContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  webOuterContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#0F172A', // Fondo pizarra oscuro tipo estudio corporativo
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
  },
  phoneChassis: {
    width: '100%',
    maxWidth: 440,
    height: '100%',
    maxHeight: 900,
    backgroundColor: '#F8FAFC',
    borderRadius: 36,
    borderWidth: 6,
    borderColor: '#1E293B',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 25 },
    shadowOpacity: 0.45,
    shadowRadius: 35,
    elevation: 25,
    position: 'relative',
  },
  topNotchContainer: {
    height: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    zIndex: 50,
    pointerEvents: 'none',
  },
  topSpeakerPill: {
    width: 68,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#0F172A',
    opacity: 0.85,
  },
  screenInner: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    overflow: 'hidden',
    position: 'relative',
  },
  homeBarContainer: {
    height: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    zIndex: 50,
    pointerEvents: 'none',
  },
  homeIndicator: {
    width: 96,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#94A3B8',
  },
});
