import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  SafeAreaView,
  Image,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import apiClient, { DEFAULT_API_URL } from '../api/client';

export default function LoginScreen() {
  const { login, authError, setAuthError } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isIdentifierFocused, setIsIdentifierFocused] = useState(false);
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);

  const [brandInfo, setBrandInfo] = useState({
    brandTitle: 'Remundial Core',
    brandSubtitle: 'Plataforma Central de Campo & Cobranza',
    footerText: 'Remundial Core v1.2.0 • Operaciones de Campo',
    hasLogo: false,
    logoUrl: null,
  });

  React.useEffect(() => {
    let isMounted = true;
    const cargarIdentidad = async () => {
      try {
        const response = await apiClient.get('/configuracion/identidad-publica');
        if (response.data && isMounted) {
          const rawUrl = response.data.logo_url;
          const fullLogoUrl = rawUrl
            ? (rawUrl.startsWith('http') ? rawUrl : `${apiClient.defaults.baseURL || DEFAULT_API_URL}${rawUrl}`)
            : null;
          setBrandInfo({
            brandTitle: response.data.razon_social || 'Remundial Core',
            brandSubtitle: response.data.eslogan_mobile || 'Plataforma Central de Campo & Cobranza',
            footerText: response.data.pie_mobile || 'Remundial Core v1.2.0 • Operaciones de Campo',
            hasLogo: Boolean(response.data.tiene_logo && fullLogoUrl),
            logoUrl: fullLogoUrl,
          });
        }
      } catch (err) {
        // En caso de error o sin conexión, mantiene fallbacks nativos
      }
    };
    cargarIdentidad();
    return () => {
      isMounted = false;
    };
  }, []);

  React.useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const styleId = 'rnw-login-clean-focus';
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

  const handleLogin = async () => {
    if (!identifier.trim() || !password) {
      setAuthError('Por favor complete su usuario/teléfono y contraseña');
      return;
    }

    setIsSubmitting(true);
    await login(identifier, password);
    setIsSubmitting(false);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardContainer}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* IDENTIDAD DE MARCA CORPORATIVA */}
          <View style={styles.brandContainer}>
            {brandInfo.hasLogo && brandInfo.logoUrl ? (
              <View style={styles.customLogoContainer}>
                <Image
                  source={{ uri: brandInfo.logoUrl }}
                  style={styles.customLogoImage}
                  resizeMode="contain"
                  onError={() => setBrandInfo((prev) => ({ ...prev, hasLogo: false }))}
                />
              </View>
            ) : (
              <View style={styles.logoBadge}>
                <Text style={styles.logoIcon}>❖</Text>
              </View>
            )}
            <Text style={styles.brandTitle}>{brandInfo.brandTitle}</Text>
            <Text style={styles.brandSubtitle}>
              {brandInfo.brandSubtitle}
            </Text>
            <View style={styles.statusPill}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>Servicio Móvil Activo</Text>
            </View>
          </View>

          {/* TARJETA DE ACCESO LIMPIA Y ENFOCADA */}
          <View style={styles.loginCard}>
            <Text style={styles.cardHeaderTitle}>Iniciar Sesión</Text>
            <Text style={styles.cardHeaderSubtitle}>
              Ingresa tus credenciales autorizadas
            </Text>

            {/* ALERTA DE ERROR */}
            {authError ? (
              <View style={styles.errorBanner} accessibilityRole="alert">
                <Text style={styles.errorIcon}>⚠</Text>
                <Text style={styles.errorText}>{authError}</Text>
              </View>
            ) : null}

            {/* INPUTS DE ACCESO */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>TELÉFONO O USUARIO</Text>
              <TextInput
                style={[styles.input, isIdentifierFocused && styles.inputFocused]}
                placeholder="Ej. 3189998877"
                placeholderTextColor="#94A3B8"
                value={identifier}
                onChangeText={setIdentifier}
                onFocus={() => setIsIdentifierFocused(true)}
                onBlur={() => setIsIdentifierFocused(false)}
                keyboardType="phone-pad"
                autoCapitalize="none"
                autoCorrect={false}
                underlineColorAndroid="transparent"
                selectionColor="#059669"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>CONTRASEÑA</Text>
              <View
                style={[
                  styles.passwordInputContainer,
                  isPasswordFocused && styles.passwordInputContainerFocused,
                ]}
              >
                <TextInput
                  style={styles.passwordInput}
                  placeholder="••••••••"
                  placeholderTextColor="#94A3B8"
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setIsPasswordFocused(true)}
                  onBlur={() => setIsPasswordFocused(false)}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  underlineColorAndroid="transparent"
                  selectionColor="#059669"
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowPassword(!showPassword)}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <View style={styles.eyeContainer}>
                    <Text style={[styles.eyeIcon, !showPassword && styles.eyeIconMuted]}>👁</Text>
                    {!showPassword && <View style={styles.eyeSlash} />}
                  </View>
                </TouchableOpacity>
              </View>
            </View>

            {/* BOTÓN PRINCIPAL ESMERALDA */}
            <TouchableOpacity
              style={[styles.primaryButton, isSubmitting && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={isSubmitting}
              accessibilityRole="button"
            >
              {isSubmitting ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.primaryButtonText}>Verificando...</Text>
                </View>
              ) : (
                <Text style={styles.primaryButtonText}>Acceder al Sistema</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* PIE CORPORATIVO MINIMALISTA */}
          <View style={styles.footerContainer}>
            <Text style={styles.footerText}>
              {brandInfo.footerText}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    position: 'relative',
  },
  keyboardContainer: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingVertical: 24,
    justifyContent: 'center',
  },
  brandContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  customLogoContainer: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 5,
  },
  customLogoImage: {
    width: '100%',
    height: '100%',
  },
  logoBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 10,
  },
  logoIcon: {
    color: '#34D399',
    fontSize: 20,
    fontWeight: '900',
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  brandSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    marginTop: 10,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#047857',
  },
  loginCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 20,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  cardHeaderTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  cardHeaderSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    marginBottom: 16,
  },
  errorBanner: {
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorIcon: {
    color: '#E11D48',
    fontSize: 15,
    fontWeight: 'bold',
  },
  errorText: {
    color: '#BE123C',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  inputGroup: {
    marginBottom: 14,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  input: {
    height: 46,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 14,
    color: '#0F172A',
  },
  inputFocused: {
    borderColor: '#059669',
    backgroundColor: '#FFFFFF',
  },
  passwordInputContainer: {
    height: 46,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 8,
    overflow: 'hidden',
  },
  passwordInputContainerFocused: {
    borderColor: '#059669',
    backgroundColor: '#FFFFFF',
  },
  passwordInput: {
    flex: 1,
    height: '100%',
    fontSize: 14,
    color: '#0F172A',
    paddingHorizontal: 0,
    paddingVertical: 0,
    margin: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
  },
  eyeButton: {
    height: '100%',
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  eyeContainer: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  eyeIcon: {
    fontSize: 17,
  },
  eyeIconMuted: {
    opacity: 0.4,
  },
  eyeSlash: {
    position: 'absolute',
    width: 20,
    height: 2,
    backgroundColor: '#64748B',
    transform: [{ rotate: '-45deg' }],
    borderRadius: 1,
  },
  primaryButton: {
    height: 44,
    backgroundColor: '#059669',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  footerContainer: {
    marginTop: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
});
