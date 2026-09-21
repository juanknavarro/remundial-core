import React from 'react';
import { View, StyleSheet, Platform, Modal as RNModal } from 'react-native';

/**
 * Modal adaptativo que garantiza que las ventanas emergentes, bottom sheets
 * y cuadros de confirmación se mantengan estrictamente contenidos dentro
 * de los límites visuales del smartphone simulado (max-w-[480px]) en entorno Web,
 * evitando que se expandan a la pantalla completa de la PC.
 * 
 * En Web: Renderiza una vista con posicionamiento absoluto sobre el contenedor padre.
 * En Nativo (Android / iOS): Utiliza el componente Modal nativo de React Native.
 */
export default function InFrameModal({
  visible,
  children,
  animationType = 'fade',
  onRequestClose,
}) {
  if (!visible) return null;

  if (Platform.OS === 'web') {
    return (
      <View style={styles.webModalOverlay}>
        {children}
      </View>
    );
  }

  return (
    <RNModal
      visible={visible}
      transparent={true}
      animationType={animationType}
      onRequestClose={onRequestClose}
    >
      {children}
    </RNModal>
  );
}

const styles = StyleSheet.create({
  webModalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    zIndex: 9999,
    elevation: 9999,
    overflow: 'hidden',
  },
});
