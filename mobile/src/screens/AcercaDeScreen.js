import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Image,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { version as appVersion } from '../../package.json';
import { CACHE_CONFIG } from '../storage/database';
import apiClient, { DEFAULT_API_URL } from '../api/client';

export default function AcercaDeScreen({ navigation }) {
  const [empresa, setEmpresa] = useState({
    razon_social: '',
    nit: '',
    telefono_soporte: '',
    lema: '',
    ciudad_principal: '',
  });

  const [identidadVisual, setIdentidadVisual] = useState({
    eslogan_mobile: '',
    pie_mobile: '',
    tiene_logo: false,
    logo_url: null,
  });

  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const aplicarDatos = (cfg) => {
      if (!cfg || !isMounted) return;

      if (cfg.empresa) {
        setEmpresa((prev) => ({
          ...prev,
          razon_social: cfg.empresa.razon_social || prev.razon_social,
          nit: cfg.empresa.nit || prev.nit,
          telefono_soporte: cfg.empresa.telefono_soporte || prev.telefono_soporte,
          lema: cfg.empresa.lema || prev.lema,
          ciudad_principal: cfg.empresa.ciudad_principal || prev.ciudad_principal,
        }));
      }

      const iv = cfg.identidad_visual || {};
      const rawUrl = iv.logo_url || cfg.logo_url;
      const fullLogoUrl = rawUrl
        ? rawUrl.startsWith('http')
          ? rawUrl
          : `${apiClient.defaults.baseURL || DEFAULT_API_URL}${rawUrl}`
        : null;

      const tieneLogo = Boolean(
        (iv.tiene_logo !== undefined ? iv.tiene_logo : cfg.tiene_logo) && fullLogoUrl
      );

      setIdentidadVisual({
        eslogan_mobile: iv.eslogan_mobile || cfg.eslogan_mobile || '',
        pie_mobile: iv.pie_mobile || cfg.pie_mobile || '',
        tiene_logo: tieneLogo,
        logo_url: fullLogoUrl,
      });
    };

    const cargarInformacion = async () => {
      try {
        // 1. Lectura inmediata desde caché local (Offline-First)
        const cached = await AsyncStorage.getItem(CACHE_CONFIG);
        if (cached) {
          aplicarDatos(JSON.parse(cached));
        }

        // 2. Consulta de sincronización con el servidor
        const response = await apiClient.get('/configuracion/parametros');
        if (response?.data) {
          await AsyncStorage.setItem(CACHE_CONFIG, JSON.stringify(response.data));
          aplicarDatos(response.data);
        }
      } catch (err) {
        // En ausencia de red se conservan los datos de la caché local
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    cargarInformacion();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleLlamarSoporte = () => {
    if (empresa.telefono_soporte) {
      const telLimpio = empresa.telefono_soporte.replace(/[^\d+]/g, '');
      Linking.openURL(`tel:${telLimpio}`).catch(() => {});
    }
  };

  const handleWhatsAppSoporte = () => {
    if (empresa.telefono_soporte) {
      const telLimpio = empresa.telefono_soporte.replace(/[^\d]/g, '');
      const telFull = telLimpio.startsWith('57') ? telLimpio : `57${telLimpio}`;
      const msg = encodeURIComponent(
        `Hola, me comunico desde la aplicación móvil corporativa v${appVersion} solicitando asistencia.`
      );
      Linking.openURL(`https://wa.me/${telFull}?text=${msg}`).catch(() => {});
    }
  };

  const nombreEmpresa = empresa.razon_social || 'Plataforma Corporativa';
  const esloganMostrar =
    empresa.lema ||
    identidadVisual.eslogan_mobile ||
    'Plataforma Central de Operaciones de Campo & Cobranza';

  const footerDinamico = identidadVisual.pie_mobile && !identidadVisual.pie_mobile.includes('v1.2.0')
    ? identidadVisual.pie_mobile
    : `${nombreEmpresa} v${appVersion} • Operaciones de Campo`;

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* BARRA SUPERIOR DE NAVEGACIÓN */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Volver a la pantalla anterior"
        >
          <Text style={styles.backIcon}>←</Text>
          <Text style={styles.backText}>Volver</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Acerca de la Aplicación</Text>
        <View style={styles.topBarRightPlaceholder} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#059669" />
            <Text style={styles.loadingText}>Cargando información corporativa...</Text>
          </View>
        ) : (
          <>
            {/* HERO CARD INSTITUCIONAL */}
            <View style={styles.heroCard}>
              <View style={styles.logoWrapper}>
                {identidadVisual.tiene_logo && identidadVisual.logo_url ? (
                  <Image
                    source={{ uri: identidadVisual.logo_url }}
                    style={styles.logoImage}
                    resizeMode="contain"
                    onError={() =>
                      setIdentidadVisual((prev) => ({ ...prev, tiene_logo: false }))
                    }
                  />
                ) : (
                  <View style={styles.defaultLogoBadge}>
                    <Text style={styles.defaultLogoIcon}>❖</Text>
                  </View>
                )}
              </View>

              {/* Nombre de la Empresa en texto grande */}
              <Text style={styles.empresaNombre}>{nombreEmpresa}</Text>

              {/* Lema o Eslogan */}
              <Text style={styles.empresaEslogan}>{esloganMostrar}</Text>

              <View style={styles.badgePillRow}>
                <View style={styles.versionBadge}>
                  <Text style={styles.versionBadgeText}>Versión: v{appVersion}</Text>
                </View>
                <View style={styles.activeServiceBadge}>
                  <View style={styles.activeDot} />
                  <Text style={styles.activeServiceText}>En línea</Text>
                </View>
              </View>
            </View>

            {/* SECCIÓN 1: DATOS INSTITUCIONALES Y TRIBUTARIOS */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionHeaderTitle}>Información Institucional</Text>

              <View style={styles.dataRow}>
                <View style={styles.iconBox}>
                  <Text style={styles.rowIcon}>🏛</Text>
                </View>
                <View style={styles.dataCol}>
                  <Text style={styles.dataLabel}>RAZÓN SOCIAL</Text>
                  <Text style={styles.dataValue}>{nombreEmpresa}</Text>
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.dataRow}>
                <View style={styles.iconBox}>
                  <Text style={styles.rowIcon}>📋</Text>
                </View>
                <View style={styles.dataCol}>
                  <Text style={styles.dataLabel}>NÚMERO DE IDENTIFICACIÓN TRIBUTARIA (NIT)</Text>
                  <Text style={styles.dataValue}>
                    {empresa.nit && empresa.nit.trim() !== '' ? empresa.nit : 'No especificado'}
                  </Text>
                </View>
              </View>

              {empresa.ciudad_principal ? (
                <>
                  <View style={styles.divider} />
                  <View style={styles.dataRow}>
                    <View style={styles.iconBox}>
                      <Text style={styles.rowIcon}>📍</Text>
                    </View>
                    <View style={styles.dataCol}>
                      <Text style={styles.dataLabel}>SEDE PRINCIPAL</Text>
                      <Text style={styles.dataValue}>{empresa.ciudad_principal}</Text>
                    </View>
                  </View>
                </>
              ) : null}
            </View>

            {/* SECCIÓN 2: CANALES DE ATENCIÓN Y SOPORTE */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionHeaderTitle}>Soporte y Asistencia Técnica</Text>

              <View style={styles.dataRow}>
                <View style={styles.iconBox}>
                  <Text style={styles.rowIcon}>📞</Text>
                </View>
                <View style={styles.dataCol}>
                  <Text style={styles.dataLabel}>LÍNEA DIRECTA DE ATENCIÓN</Text>
                  <Text style={styles.dataValue}>
                    {empresa.telefono_soporte && empresa.telefono_soporte.trim() !== ''
                      ? empresa.telefono_soporte
                      : 'No configurado'}
                  </Text>
                </View>
              </View>

              {empresa.telefono_soporte ? (
                <View style={styles.actionButtonsRow}>
                  <TouchableOpacity
                    style={styles.btnActionCall}
                    onPress={handleLlamarSoporte}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.btnActionIcon}>📞</Text>
                    <Text style={styles.btnActionCallText}>Llamar</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.btnActionWhatsApp}
                    onPress={handleWhatsAppSoporte}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.btnActionIcon}>💬</Text>
                    <Text style={styles.btnActionWhatsAppText}>WhatsApp</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>

            {/* SECCIÓN 3: ESPECIFICACIONES DE LA PLATAFORMA */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionHeaderTitle}>Especificaciones Técnicas</Text>

              <View style={styles.dataRow}>
                <View style={styles.iconBox}>
                  <Text style={styles.rowIcon}>📱</Text>
                </View>
                <View style={styles.dataCol}>
                  <Text style={styles.dataLabel}>ARQUITECTURA DE SOFTWARE</Text>
                  <Text style={styles.dataValue}>React Native Mobile • Offline-First</Text>
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.dataRow}>
                <View style={styles.iconBox}>
                  <Text style={styles.rowIcon}>⚡</Text>
                </View>
                <View style={styles.dataCol}>
                  <Text style={styles.dataLabel}>VERSIÓN DE PRODUCCIÓN</Text>
                  <Text style={styles.dataValueBold}>v{appVersion}</Text>
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.dataRow}>
                <View style={styles.iconBox}>
                  <Text style={styles.rowIcon}>🛡</Text>
                </View>
                <View style={styles.dataCol}>
                  <Text style={styles.dataLabel}>SEGURIDAD TRANSACCIONAL</Text>
                  <Text style={styles.dataValue}>
                    Cifrado AES-256 • Autenticación JWT OAuth2
                  </Text>
                </View>
              </View>
            </View>

            {/* PIE INSTITUCIONAL DINÁMICO */}
            <View style={styles.footerContainer}>
              <Text style={styles.footerBrandText}>{footerDinamico}</Text>
              <Text style={styles.footerSubText}>
                Todos los derechos reservados conforme a las leyes comerciales aplicables.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  topBar: {
    height: 56,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
      },
      android: {
        elevation: 2,
      },
      web: {
        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
      },
    }),
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
    cursor: 'pointer',
  },
  backIcon: {
    fontSize: 18,
    color: '#059669',
    fontWeight: '700',
  },
  backText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#059669',
  },
  topBarTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  topBarRightPlaceholder: {
    width: 60,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 16,
  },
  loadingContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
      },
      android: {
        elevation: 3,
      },
      web: {
        boxShadow: '0 4px 12px rgba(15, 23, 42, 0.05)',
      },
    }),
  },
  logoWrapper: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 8,
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  defaultLogoBadge: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  defaultLogoIcon: {
    color: '#10B981',
    fontSize: 26,
    fontWeight: '900',
  },
  empresaNombre: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0F172A',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  empresaEslogan: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  badgePillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  versionBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  versionBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#065F46',
  },
  activeServiceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  activeServiceText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sectionHeaderTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 14,
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 4,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  rowIcon: {
    fontSize: 16,
  },
  dataCol: {
    flex: 1,
    gap: 2,
  },
  dataLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.4,
  },
  dataValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
    lineHeight: 18,
  },
  dataValueBold: {
    fontSize: 14,
    fontWeight: '900',
    color: '#059669',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 10,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  btnActionCall: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#0F172A',
    cursor: 'pointer',
  },
  btnActionCallText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  btnActionWhatsApp: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#10B981',
    cursor: 'pointer',
  },
  btnActionWhatsAppText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  btnActionIcon: {
    fontSize: 14,
  },
  footerContainer: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 4,
  },
  footerBrandText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textAlign: 'center',
  },
  footerSubText: {
    fontSize: 10,
    fontWeight: '500',
    color: '#94A3B8',
    textAlign: 'center',
    maxWidth: 280,
  },
});
