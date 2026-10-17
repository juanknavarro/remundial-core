import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  Platform,
} from 'react-native';
import apiClient from '../api/client';
import {
  guardarEnCache,
  obtenerDeCache,
  STORAGE_KEYS,
} from '../storage/database';

const formatCOP = (val) => {
  const num = Math.round(Number(val) || 0);
  return '$ ' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const CACHE_REPORTES = 'cache_reportes_gerenciales_mobile';

export default function ReportesScreen({ navigation }) {
  const [resumen, setResumen] = useState(null);
  const [abonos, setAbonos] = useState([]);
  const [creditos, setCreditos] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Carga unificada y paralela de métricas de auditoría
  const cargarReportes = useCallback(async (isPullRefresh = false) => {
    if (isPullRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const [resResumen, resAbonos, resCreditos] = await Promise.allSettled([
        apiClient.get('/reportes/resumen-gerencial'),
        apiClient.get('/abonos'),
        apiClient.get('/creditos'),
      ]);

      if (resResumen.status === 'fulfilled' && resResumen.value.data) {
        setResumen(resResumen.value.data);
      }

      if (resAbonos.status === 'fulfilled' && Array.isArray(resAbonos.value.data)) {
        setAbonos(resAbonos.value.data);
      }

      if (resCreditos.status === 'fulfilled' && Array.isArray(resCreditos.value.data)) {
        setCreditos(resCreditos.value.data);
      }

      // Guardar en caché consolidada
      guardarEnCache(CACHE_REPORTES, {
        resumen: resResumen.value?.data || null,
        abonos: resAbonos.value?.data || [],
        creditos: resCreditos.value?.data || [],
      });
    } catch (error) {
      console.warn('[ReportesScreen] Error consultando reportes, recurriendo a caché:', error);
      const cached = await obtenerDeCache(CACHE_REPORTES);
      if (cached) {
        if (cached.resumen) setResumen(cached.resumen);
        if (Array.isArray(cached.abonos)) setAbonos(cached.abonos);
        if (Array.isArray(cached.creditos)) setCreditos(cached.creditos);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    cargarReportes();
  }, [cargarReportes]);

  // Cálculos de recaudos temporales (Hoy, Semana y Mes) y ventas
  const metricas = useMemo(() => {
    const ahora = new Date();
    const hoyStr = ahora.toISOString().split('T')[0];

    // Inicio de la semana actual (Lunes)
    const inicioSemana = new Date(ahora);
    const diaSemana = ahora.getDay();
    const diff = ahora.getDate() - diaSemana + (diaSemana === 0 ? -6 : 1);
    inicioSemana.setDate(diff);
    inicioSemana.setHours(0, 0, 0, 0);

    // Inicio del mes actual
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);

    let recaudoHoy = 0;
    let countHoy = 0;
    let recaudoSemana = 0;
    let countSemana = 0;
    let recaudoMes = 0;
    let countMes = 0;

    // Arqueo por cobrador en ruta hoy
    const cobradoresHoy = {};

    abonos.forEach((a) => {
      if (a.estado === 'anulado') return;
      const fDt = new Date(a.fecha || a.creado_en || Date.now());
      const fStr = fDt.toISOString().split('T')[0];
      const val = Number(a.valor_abonado || 0);

      // Hoy
      if (fStr === hoyStr) {
        recaudoHoy += val;
        countHoy += 1;

        const cid = a.cobrador_id || 'desconocido';
        const cnom = a.cobrador?.nombre || a.cobrador_nombre || 'Cobrador en Ruta';
        if (!cobradoresHoy[cid]) {
          cobradoresHoy[cid] = { nombre: cnom, total: 0, recibos: 0 };
        }
        cobradoresHoy[cid].total += val;
        cobradoresHoy[cid].recibos += 1;
      }

      // Semana
      if (fDt >= inicioSemana) {
        recaudoSemana += val;
        countSemana += 1;
      }

      // Mes
      if (fDt >= inicioMes) {
        recaudoMes += val;
        countMes += 1;
      }
    });

    // Ventas Originadas este mes y colocación total
    let ventasMesTotal = 0;
    let countVentasMes = 0;
    let ventasContadoMes = 0;
    let ventasCreditoMes = 0;

    creditos.forEach((c) => {
      const fDt = new Date(c.creado_en || Date.now());
      const val = Number(c.monto_financiado || 0) + Number(c.cuota_inicial || 0);
      if (fDt >= inicioMes) {
        ventasMesTotal += val;
        countVentasMes += 1;
        if (Number(c.saldo_pendiente || 0) <= 0) {
          ventasContadoMes += val;
        } else {
          ventasCreditoMes += val;
        }
      }
    });

    // Lista ordenada de cobradores del arqueo
    const rankingCobradores = Object.values(cobradoresHoy).sort((a, b) => b.total - a.total);

    return {
      recaudoHoy: resumen?.total_recaudado_hoy ?? recaudoHoy,
      countHoy: resumen?.count_abonos_hoy ?? countHoy,
      recaudoSemana,
      countSemana,
      recaudoMes,
      countMes,
      ventasMesTotal,
      countVentasMes,
      ventasContadoMes,
      ventasCreditoMes,
      saldoTotalCartera: resumen?.saldo_total_cartera ?? 0,
      creditosActivos: resumen?.creditos_activos_count ?? 0,
      carteraMora: Number(resumen?.cartera_en_mora?.saldo_insoluto_mora || 0),
      porcentajeRiesgo: resumen?.cartera_en_mora?.porcentaje_riesgo || 0,
      contratosMora: resumen?.cartera_en_mora?.contratos_mora_count || 0,
      rankingCobradores,
    };
  }, [abonos, creditos, resumen]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />

      {/* HEADER SUPERIOR */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Reportes Gerenciales</Text>
          <Text style={styles.headerSubtitle}>Auditoría Financiera y Arqueo de Terreno</Text>
        </View>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => cargarReportes(true)}
          disabled={isRefreshing}
          activeOpacity={0.7}
        >
          <Text style={styles.refreshBtnText}>{isRefreshing ? '⏳' : '↻'}</Text>
        </TouchableOpacity>
      </View>

      {isLoading && !isRefreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#059669" />
          <Text style={styles.loadingText}>Consolidando estados financieros...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => cargarReportes(true)}
              colors={['#059669']}
              tintColor="#059669"
            />
          }
        >
          {/* ========================================================================= */}
          {/* TARJETA 1: ARQUEO DE CAJA DIARIO (EN TERRENO)                              */}
          {/* ========================================================================= */}
          <View style={styles.bigHeroCard}>
            <View style={styles.heroBadgeRow}>
              <View style={styles.liveBadge}>
                <View style={styles.livePulse} />
                <Text style={styles.liveBadgeText}>ARQUEO EN VIVO</Text>
              </View>
              <Text style={styles.dateLabel}>HOY</Text>
            </View>

            <Text style={styles.heroSectionTitle}>TOTAL RECAUDADO HOY</Text>
            <Text style={styles.heroBigAmount}>{formatCOP(metricas.recaudoHoy)}</Text>

            <View style={styles.heroSubRow}>
              <Text style={styles.heroSubText}>
                {metricas.countHoy} {metricas.countHoy === 1 ? 'comprobante de abono' : 'comprobantes de abono registrados'}
              </Text>
            </View>

            {/* Desglose de arqueo por cobradores hoy */}
            {metricas.rankingCobradores.length > 0 ? (
              <View style={styles.arqueoCobradoresBox}>
                <Text style={styles.arqueoSectionHeader}>ARQUEO POR COBRADOR EN RUTA</Text>
                {metricas.rankingCobradores.map((c, idx) => (
                  <View key={idx} style={styles.arqueoCobradorRow}>
                    <View style={styles.arqueoCobradorLeft}>
                      <Text style={styles.arqueoCobradorIcon}>🛵</Text>
                      <Text style={styles.arqueoCobradorName}>{c.nombre}</Text>
                    </View>
                    <View style={styles.arqueoCobradorRight}>
                      <Text style={styles.arqueoCobradorVal}>{formatCOP(c.total)}</Text>
                      <Text style={styles.arqueoCobradorSub}>{c.recibos} cobros</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {/* ========================================================================= */}
          {/* TARJETA 2: RECAUDOS CONSOLIDADOS (SEMANA VS MES)                           */}
          {/* ========================================================================= */}
          <View style={styles.metricCard}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.iconCircleEmerald}>
                <Text style={styles.cardHeaderIcon}>📅</Text>
              </View>
              <View>
                <Text style={styles.cardHeaderTitle}>Recaudos por Período</Text>
                <Text style={styles.cardHeaderSub}>Ingresos confirmados en caja</Text>
              </View>
            </View>

            <View style={styles.splitRow}>
              {/* Esta Semana */}
              <View style={styles.splitCol}>
                <Text style={styles.splitLabel}>ESTA SEMANA</Text>
                <Text style={styles.splitValueEmerald}>
                  {formatCOP(metricas.recaudoSemana)}
                </Text>
                <Text style={styles.splitSub}>{metricas.countSemana} operaciones</Text>
              </View>

              <View style={styles.splitDivider} />

              {/* Este Mes */}
              <View style={styles.splitCol}>
                <Text style={styles.splitLabel}>ESTE MES</Text>
                <Text style={styles.splitValueEmerald}>
                  {formatCOP(metricas.recaudoMes)}
                </Text>
                <Text style={styles.splitSub}>{metricas.countMes} operaciones</Text>
              </View>
            </View>
          </View>

          {/* ========================================================================= */}
          {/* TARJETA 3: VENTAS ORIGINADAS Y COLOCACIÓN COMERCIAL                        */}
          {/* ========================================================================= */}
          <View style={styles.metricCard}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.iconCircleBlue}>
                <Text style={styles.cardHeaderIcon}>🛍️</Text>
              </View>
              <View>
                <Text style={styles.cardHeaderTitle}>Colocación y Ventas del Mes</Text>
                <Text style={styles.cardHeaderSub}>Ventas originadas en terreno</Text>
              </View>
            </View>

            <View style={styles.bigNumberBox}>
              <Text style={styles.bigLabel}>TOTAL COLOCADO (MES)</Text>
              <Text style={styles.bigAmountDark}>{formatCOP(metricas.ventasMesTotal)}</Text>
              <Text style={styles.bigSubText}>
                {metricas.countVentasMes} {metricas.countVentasMes === 1 ? 'contrato radicado' : 'contratos radicados'}
              </Text>
            </View>

            <View style={styles.splitRowSlim}>
              <View style={styles.splitCol}>
                <Text style={styles.splitLabel}>CRÉDITO FINANCIADO</Text>
                <Text style={styles.splitValueSec}>{formatCOP(metricas.ventasCreditoMes)}</Text>
              </View>
              <View style={styles.splitDivider} />
              <View style={styles.splitCol}>
                <Text style={styles.splitLabel}>VENTAS CONTADO</Text>
                <Text style={styles.splitValueSec}>{formatCOP(metricas.ventasContadoMes)}</Text>
              </View>
            </View>
          </View>

          {/* ========================================================================= */}
          {/* TARJETA 4: SALUD DE CARTERA & CARTERA EN MORA                              */}
          {/* ========================================================================= */}
          <View style={styles.metricCard}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.iconCircleRose}>
                <Text style={styles.cardHeaderIcon}>🛡️</Text>
              </View>
              <View>
                <Text style={styles.cardHeaderTitle}>Salud de Cartera y Riesgo</Text>
                <Text style={styles.cardHeaderSub}>Monitoreo del saldo insoluto</Text>
              </View>
            </View>

            <View style={styles.splitRow}>
              <View style={styles.splitCol}>
                <Text style={styles.splitLabel}>SALDO ACTIVO TOTAL</Text>
                <Text style={styles.splitValueDark}>
                  {formatCOP(metricas.saldoTotalCartera)}
                </Text>
                <Text style={styles.splitSub}>{metricas.creditosActivos} créditos vigentes</Text>
              </View>

              <View style={styles.splitDivider} />

              <View style={styles.splitCol}>
                <Text style={[styles.splitLabel, { color: '#BE123C' }]}>CARTERA EN MORA</Text>
                <Text style={styles.splitValueRose}>
                  {formatCOP(metricas.carteraMora)}
                </Text>
                <Text style={[styles.splitSub, { color: '#E11D48' }]}>
                  {metricas.porcentajeRiesgo}% de riesgo ({metricas.contratosMora} contratos)
                </Text>
              </View>
            </View>
          </View>

          {/* NOTA DE AUDITORÍA */}
          <View style={styles.auditNote}>
            <Text style={styles.auditNoteIcon}>ℹ️</Text>
            <Text style={styles.auditNoteText}>
              Para descargar reportes detallados en PDF con firma digital o balances exportables a Excel, ingresa al módulo de Auditoría desde el Panel Web central.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    backgroundColor: '#0F172A',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    gap: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  backBtnText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 22,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 1,
    fontWeight: '600',
  },
  refreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  refreshBtnText: {
    fontSize: 16,
    color: '#34D399',
    fontWeight: '700',
  },
  scrollContent: {
    padding: 16,
    gap: 14,
    backgroundColor: '#F8FAFC',
    paddingBottom: 30,
  },
  bigHeroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  livePulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#059669',
  },
  liveBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#065F46',
    letterSpacing: 0.5,
  },
  dateLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  heroSectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  heroBigAmount: {
    fontSize: 32,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.8,
    marginBottom: 6,
  },
  heroSubRow: {
    paddingBottom: 8,
  },
  heroSubText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  arqueoCobradoresBox: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  arqueoSectionHeader: {
    fontSize: 9,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  arqueoCobradorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  arqueoCobradorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  arqueoCobradorIcon: {
    fontSize: 14,
  },
  arqueoCobradorName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  arqueoCobradorRight: {
    alignItems: 'flex-end',
  },
  arqueoCobradorVal: {
    fontSize: 12,
    fontWeight: '800',
    color: '#059669',
  },
  arqueoCobradorSub: {
    fontSize: 10,
    color: '#94A3B8',
  },
  metricCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  iconCircleEmerald: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleBlue: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleRose: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#FFF1F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderIcon: {
    fontSize: 17,
  },
  cardHeaderTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  cardHeaderSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  splitRow: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  splitRowSlim: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  splitCol: {
    flex: 1,
    alignItems: 'center',
  },
  splitDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#E2E8F0',
  },
  splitLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  splitValueEmerald: {
    fontSize: 17,
    fontWeight: '900',
    color: '#059669',
    marginBottom: 2,
  },
  splitValueDark: {
    fontSize: 17,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 2,
  },
  splitValueRose: {
    fontSize: 17,
    fontWeight: '900',
    color: '#BE123C',
    marginBottom: 2,
  },
  splitValueSec: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  splitSub: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '600',
  },
  bigNumberBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  bigLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  bigAmountDark: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.5,
    marginBottom: 2,
  },
  bigSubText: {
    fontSize: 11,
    color: '#059669',
    fontWeight: '700',
  },
  auditNote: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    padding: 14,
    gap: 10,
    alignItems: 'center',
  },
  auditNoteIcon: {
    fontSize: 16,
  },
  auditNoteText: {
    flex: 1,
    fontSize: 11,
    color: '#475569',
    lineHeight: 16,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: '#059669',
    fontWeight: '600',
  },
});
