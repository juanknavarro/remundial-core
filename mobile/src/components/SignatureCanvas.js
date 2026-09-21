import React, { useRef, useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';

/**
 * Componente de Captura de Firma Táctil / Stylus para Remundial Core Mobile.
 * Diseñado con alto rendimiento táctil (60fps), soporte para dedos y lápiz óptico,
 * escalado para pantallas retina/alta densidad (DPR) y exportación limpia en PNG Base64.
 */
export default function SignatureCanvas({
  label = 'Firma',
  subtitle = 'Firme con el dedo o lápiz óptico dentro del recuadro',
  obligatorio = false,
  signerName = '',
  signerDoc = '',
  value = null,
  onChange,
  height = 140,
}) {
  const canvasRef = useRef(null);
  const isDrawingRef = useRef(false);
  const hasStrokesRef = useRef(false);
  const [hasSignature, setHasSignature] = useState(Boolean(value));

  // Inicialización y configuración del canvas con DPR escalado
  useEffect(() => {
    if (Platform.OS === 'web' && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

      // Obtener ancho real del elemento o contenedor
      const rect = canvas.getBoundingClientRect();
      const cssWidth = rect.width || 340;
      const cssHeight = height;

      canvas.width = cssWidth * dpr;
      canvas.height = cssHeight * dpr;
      ctx.scale(dpr, dpr);

      // Configuración de trazo suave y anti-aliased
      ctx.strokeStyle = '#0F172A'; // Azul medianoche profesional
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Si ya hay un valor previo (Base64), restaurarlo en el lienzo
      if (value) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, cssWidth, cssHeight);
          hasStrokesRef.current = true;
          setHasSignature(true);
        };
        img.src = value;
      }
    }
  }, [height]);

  // Manejo de eventos de dibujo (Pointer / Touch)
  const getCoordinates = (e) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = e.clientX !== undefined ? e.clientX : e.touches?.[0]?.clientX || 0;
    const clientY = e.clientY !== undefined ? e.clientY : e.touches?.[0]?.clientY || 0;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const handlePointerDown = (e) => {
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { x, y } = getCoordinates(e);

    isDrawingRef.current = true;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handlePointerMove = (e) => {
    if (!isDrawingRef.current || !canvasRef.current) return;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { x, y } = getCoordinates(e);

    ctx.lineTo(x, y);
    ctx.stroke();
    hasStrokesRef.current = true;
  };

  const handlePointerUp = (e) => {
    if (!isDrawingRef.current || !canvasRef.current) return;
    isDrawingRef.current = false;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.closePath();

    if (hasStrokesRef.current) {
      setHasSignature(true);
      const dataUrl = canvas.toDataURL('image/png');
      if (onChange) onChange(dataUrl);
    }
  };

  // Limpiar lienzo
  const limpiarFirma = () => {
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    }
    hasStrokesRef.current = false;
    isDrawingRef.current = false;
    setHasSignature(false);
    if (onChange) onChange(null);
  };

  return (
    <View style={styles.container}>
      {/* Encabezado del Bloque de Firma */}
      <View style={styles.headerRow}>
        <View style={styles.titleCol}>
          <View style={styles.labelBadgeRow}>
            <Text style={styles.label}>{label}</Text>
            {obligatorio ? (
              <View style={styles.badgeObligatorio}>
                <Text style={styles.badgeObligatorioText}>Obligatoria *</Text>
              </View>
            ) : (
              <View style={styles.badgeOpcional}>
                <Text style={styles.badgeOpcionalText}>Opcional</Text>
              </View>
            )}
          </View>
          {(signerName || signerDoc) && (
            <Text style={styles.signerInfo}>
              {signerName} {signerDoc ? `• CC ${signerDoc}` : ''}
            </Text>
          )}
        </View>

        {hasSignature && (
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={limpiarFirma}
            accessibilityRole="button"
            accessibilityLabel="Borrar firma"
          >
            <Text style={styles.clearBtnText}>✕ Borrar</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Recuadro de Lienzo Táctil */}
      <View
        style={[
          styles.canvasBox,
          { height },
          hasSignature ? styles.canvasBoxSigned : styles.canvasBoxEmpty,
        ]}
      >
        {Platform.OS === 'web' ? (
          <canvas
            ref={canvasRef}
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              cursor: 'crosshair',
              touchAction: 'none', // Evita scroll de pantalla mientras se firma en móvil
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
          />
        ) : (
          <View style={styles.nativeFallback}>
            <Text style={styles.nativeFallbackText}>Firma no disponible en este entorno</Text>
          </View>
        )}

        {/* Línea guía base y marca de agua sutil */}
        <View style={styles.guidelineRow} pointerEvents="none">
          <Text style={styles.guidelineIcon}>✕</Text>
          <View style={styles.guidelineLine} />
        </View>

        {!hasSignature && (
          <View style={styles.watermarkOverlay} pointerEvents="none">
            <Text style={styles.watermarkText}>✍️ {subtitle}</Text>
          </View>
        )}
      </View>

      {/* Pie de estado */}
      <View style={styles.footerRow}>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              hasSignature ? styles.statusDotSuccess : obligatorio ? styles.statusDotPending : styles.statusDotOptional,
            ]}
          />
          <Text
            style={[
              styles.statusText,
              hasSignature
                ? styles.statusTextSuccess
                : obligatorio
                ? styles.statusTextPending
                : styles.statusTextOptional,
            ]}
          >
            {hasSignature
              ? '✓ Firma capturada en pantalla'
              : obligatorio
              ? 'Firma obligatoria pendiente'
              : 'Firma opcional (puede omitirse en campo)'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  titleCol: {
    flex: 1,
    paddingRight: 8,
  },
  labelBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  badgeObligatorio: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeObligatorioText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#DC2626',
  },
  badgeOpcional: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeOpcionalText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
  },
  signerInfo: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  clearBtn: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  clearBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#DC2626',
  },
  canvasBox: {
    width: '100%',
    borderRadius: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#FAFAFA',
  },
  canvasBoxEmpty: {
    borderColor: '#CBD5E1',
  },
  canvasBoxSigned: {
    borderColor: '#10B981',
    borderStyle: 'solid',
    backgroundColor: '#FFFFFF',
  },
  guidelineRow: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    opacity: 0.35,
  },
  guidelineIcon: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#64748B',
  },
  guidelineLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#64748B',
  },
  watermarkOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  watermarkText: {
    fontSize: 12,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  nativeFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nativeFallbackText: {
    fontSize: 12,
    color: '#94A3B8',
  },
  footerRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusDotSuccess: {
    backgroundColor: '#10B981',
  },
  statusDotPending: {
    backgroundColor: '#EF4444',
  },
  statusDotOptional: {
    backgroundColor: '#94A3B8',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
  },
  statusTextSuccess: {
    color: '#059669',
    fontWeight: '600',
  },
  statusTextPending: {
    color: '#DC2626',
    fontWeight: '600',
  },
  statusTextOptional: {
    color: '#64748B',
  },
});
