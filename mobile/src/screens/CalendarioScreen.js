import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  Linking,
  Alert,
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

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const toISODate = (d) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function CalendarioScreen({ navigation }) {
  // Fecha actualmente seleccionada
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  
  // Datos del mes cargados desde el backend
  const [calendarData, setCalendarData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filtroEstado, setFiltroEstado] = useState('todos'); // 'todos' | 'pendientes' | 'pagadas'

  const currentYear = selectedDate.getFullYear();
  const currentMonth = selectedDate.getMonth() + 1;
  const selectedDateStr = toISODate(selectedDate);

  // Cargar datos del mes actual desde /reportes/calendario
  const cargarCalendarioMes = useCallback(async (year, month, isPullRefresh = false) => {
    if (isPullRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    const cacheKey = `cache_calendario_${year}_${month}`;

    try {
      const res = await apiClient.get('/reportes/calendario', {
        params: { year, month },
      });

      if (res.data && res.data.dias) {
        setCalendarData(res.data);
        guardarEnCache(cacheKey, res.data);
      } else {
        const cached = await obtenerDeCache(cacheKey);
        if (cached) setCalendarData(cached);
      }
    } catch (error) {
      console.warn('[CalendarioScreen] Error cargando calendario desde API, usando caché:', error);
      const cached = await obtenerDeCache(cacheKey);
      if (cached) setCalendarData(cached);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Cargar cada vez que cambie de mes o año
  useEffect(() => {
    cargarCalendarioMes(currentYear, currentMonth);
  }, [currentYear, currentMonth, cargarCalendarioMes]);

  // Navegación de fechas
  const cambiarDia = (offset) => {
    const nuevaFecha = new Date(selectedDate);
    nuevaFecha.setDate(nuevaFecha.getDate() + offset);
    setSelectedDate(nuevaFecha);
  };

  const irAHoy = () => {
    setSelectedDate(new Date());
  };

  // Cuotas correspondientes exclusivamente al día seleccionado
  const diaData = calendarData?.dias?.[selectedDateStr] || null;
  const itemsDelDia = useMemo(() => {
    const rawItems = diaData?.items || [];
    if (filtroEstado === 'todos') return rawItems;
    if (filtroEstado === 'pagadas') return rawItems.filter((i) => i.pagada);
    if (filtroEstado === 'pendientes') return rawItems.filter((i) => !i.pagada);
    return rawItems;
  }, [diaData, filtroEstado]);

  const handleLlamar = (telefono) => {
    if (!telefono) {
      Alert.alert('Sin Teléfono', 'El cliente no tiene un teléfono de contacto registrado.');
      return;
    }
    const cleanTel = String(telefono).replace(/[^0-9]/g, '');
    Linking.openURL(`tel:${cleanTel}`).catch(() => {
      Alert.alert('Error', 'No es posible realizar llamadas desde este dispositivo.');
    });
  };

  // Texto amigable de la fecha actual
  const fechaTitulo = useMemo(() => {
    const diaNom = DIAS_SEMANA[selectedDate.getDay()];
    const diaNum = selectedDate.getDate();
    const mesNom = MESES[selectedDate.getMonth()];
    const anio = selectedDate.getFullYear();
    const esHoy = selectedDateStr === toISODate(new Date());

    return {
      principal: `${diaNom}, ${diaNum} de ${mesNom}`,
      sub: `${anio} ${esHoy ? '• HOY' : ''}`,
      esHoy,
    };
  }, [selectedDate, selectedDateStr]);

  const renderCuotaCard = ({ item }) => {
    const cliente = item.cliente_nombre || 'Cliente Titular';
    const contrato = item.codigo_contrato || `CTR-${String(item.id_contrato || '').slice(0, 8).toUpperCase()}`;
    const ciudad = item.ciudad || 'Montería';
    const cuotaTxt = item.cuota_texto || `Cuota ${item.numero_cuota}/${item.total_cuotas}`;
    const valor = Number(item.valor_cuota || 0);
    const esPagada = Boolean(item.pagada);
    const estado = item.estado || (esPagada ? 'pagada' : 'pendiente');
    const esVencida = !esPagada && estado === 'vencida';
    const telefono = item.cliente_telefono;

    return (
      <View style={[styles.card, esPagada && styles.cardPagada]}>
        {/* Fila Superior: Contrato y Badge de Estado */}
        <View style={styles.cardHeader}>
          <View style={styles.contratoBadge}>
            <Text style={styles.contratoText}>{contrato}</Text>
          </View>

          {esPagada ? (
            <View style={styles.badgePagada}>
              <Text style={styles.badgePagadaText}>✓ Pagada</Text>
            </View>
          ) : esVencida ? (
            <View style={styles.badgeVencida}>
              <Text style={styles.badgeVencidaText}>⚠️ Vencida</Text>
            </View>
          ) : (
            <View style={styles.badgePendiente}>
              <Text style={styles.badgePendienteText}>⏳ Pendiente</Text>
            </View>
          )}
        </View>

        {/* Cliente y Ciudad */}
        <View style={styles.cardBody}>
          <Text style={styles.clienteNombre} numberOfLines={1}>
            {cliente}
          </Text>
          <View style={styles.ciudadRow}>
            <Text style={styles.ciudadIcon}>📍</Text>
            <Text style={styles.ciudadText}>{ciudad}</Text>
            {item.cobrador_nombre ? (
              <Text style={styles.cobradorText}>• Ruta: {item.cobrador_nombre}</Text>
            ) : null}
          </View>
        </View>

        {/* Fila de Finanzas: Cuota y Valor */}
        <View style={styles.finanzasRow}>
          <View style={styles.cuotaPill}>
            <Text style={styles.cuotaPillText}>{cuotaTxt}</Text>
          </View>

          <View style={styles.valorCol}>
            <Text style={styles.valorLabel}>VALOR A COBRAR</Text>
            <Text
              style={[
                styles.valorText,
                esPagada ? styles.valorPagadaText : styles.valorPendienteText,
              ]}
            >
              {formatCOP(valor)}
            </Text>
          </View>
        </View>

        {/* Acciones Rápidas */}
        {telefono ? (
          <View style={styles.cardFooter}>
            <TouchableOpacity
              style={styles.callBtn}
              onPress={() => handleLlamar(telefono)}
              activeOpacity={0.8}
            >
              <Text style={styles.callBtnIcon}>📞</Text>
              <Text style={styles.callBtnText}>Llamar al Cliente ({telefono})</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

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
          <Text style={styles.headerTitle}>Calendario de Cartera</Text>
          <Text style={styles.headerSubtitle}>
            {calendarData?.nombre_mes || `${MESES[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => cargarCalendarioMes(currentYear, currentMonth, true)}
          disabled={isRefreshing}
          activeOpacity={0.7}
        >
          <Text style={styles.refreshBtnText}>{isRefreshing ? '⏳' : '↻'}</Text>
        </TouchableOpacity>
      </View>

      {/* SELECTOR DE FECHA MÓVIL (DÍA ANTERIOR / FECHA / DÍA SIGUIENTE) */}
      <View style={styles.dateSelectorContainer}>
        <View style={styles.dateNavigatorRow}>
          <TouchableOpacity
            style={styles.navDayBtn}
            onPress={() => cambiarDia(-1)}
            activeOpacity={0.75}
          >
            <Text style={styles.navDayBtnText}>◀ Día Ant.</Text>
          </TouchableOpacity>

          <View style={styles.currentDateBox}>
            <Text style={styles.currentDateTitle}>{fechaTitulo.principal}</Text>
            <Text style={[styles.currentDateSubtitle, fechaTitulo.esHoy && styles.currentDateHoy]}>
              {fechaTitulo.sub}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.navDayBtn}
            onPress={() => cambiarDia(1)}
            activeOpacity={0.75}
          >
            <Text style={styles.navDayBtnText}>Día Sig. ▶</Text>
          </TouchableOpacity>
        </View>

        {/* Acceso Rápido a Hoy si no está en la fecha actual */}
        {!fechaTitulo.esHoy ? (
          <TouchableOpacity style={styles.todayShortcutBtn} onPress={irAHoy} activeOpacity={0.8}>
            <Text style={styles.todayShortcutText}>📅 Ir a la fecha de Hoy</Text>
          </TouchableOpacity>
        ) : null}

        {/* Mini Resumen del Día */}
        <View style={styles.daySummaryBox}>
          <View style={styles.daySummaryItem}>
            <Text style={styles.daySummaryLabel}>PROGRAMADO</Text>
            <Text style={styles.daySummaryValue}>
              {formatCOP(diaData?.total_programado || 0)}
            </Text>
          </View>
          <View style={styles.daySummaryDivider} />
          <View style={styles.daySummaryItem}>
            <Text style={[styles.daySummaryLabel, { color: '#059669' }]}>RECAUDADO</Text>
            <Text style={[styles.daySummaryValue, { color: '#059669' }]}>
              {formatCOP(diaData?.total_recaudado || 0)}
            </Text>
          </View>
          <View style={styles.daySummaryDivider} />
          <View style={styles.daySummaryItem}>
            <Text style={[styles.daySummaryLabel, { color: '#D97706' }]}>PENDIENTE</Text>
            <Text style={[styles.daySummaryValue, { color: '#D97706' }]}>
              {formatCOP(diaData?.total_pendiente || 0)}
            </Text>
          </View>
        </View>

        {/* Filtro Rápido: Todos / Pendientes / Pagadas */}
        <View style={styles.filterPillsRow}>
          <TouchableOpacity
            style={[styles.filterPill, filtroEstado === 'todos' && styles.filterPillActive]}
            onPress={() => setFiltroEstado('todos')}
          >
            <Text
              style={[
                styles.filterPillText,
                filtroEstado === 'todos' && styles.filterPillTextActive,
              ]}
            >
              Todos ({diaData?.items?.length || 0})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterPill, filtroEstado === 'pendientes' && styles.filterPillActiveAmber]}
            onPress={() => setFiltroEstado('pendientes')}
          >
            <Text
              style={[
                styles.filterPillText,
                filtroEstado === 'pendientes' && styles.filterPillTextActiveAmber,
              ]}
            >
              ⏳ Pendientes ({diaData?.cuotas_pendientes || 0})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterPill, filtroEstado === 'pagadas' && styles.filterPillActiveEmerald]}
            onPress={() => setFiltroEstado('pagadas')}
          >
            <Text
              style={[
                styles.filterPillText,
                filtroEstado === 'pagadas' && styles.filterPillTextActiveEmerald,
              ]}
            >
              ✓ Pagadas ({diaData?.cuotas_pagadas || 0})
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* LISTADO DE COBROS PROGRAMADOS */}
      {isLoading && !isRefreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#059669" />
          <Text style={styles.loadingText}>Cargando agenda de cobros...</Text>
        </View>
      ) : (
        <FlatList
          data={itemsDelDia}
          keyExtractor={(item, index) => `${item.id_contrato}-${item.numero_cuota}-${index}`}
          renderItem={renderCuotaCard}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => cargarCalendarioMes(currentYear, currentMonth, true)}
              colors={['#059669']}
              tintColor="#059669"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>📅</Text>
              <Text style={styles.emptyTitle}>Sin cobros para esta fecha</Text>
              <Text style={styles.emptySubtitle}>
                No hay cuotas con vencimiento programado para el día seleccionado. Usa los botones de navegación para consultar otras fechas.
              </Text>
            </View>
          }
        />
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
  dateSelectorContainer: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  dateNavigatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  navDayBtn: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  navDayBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
  },
  currentDateBox: {
    flex: 1,
    alignItems: 'center',
  },
  currentDateTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
  },
  currentDateSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
    fontWeight: '700',
  },
  currentDateHoy: {
    color: '#059669',
  },
  todayShortcutBtn: {
    marginTop: 8,
    alignSelf: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  todayShortcutText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#065F46',
  },
  daySummaryBox: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  daySummaryItem: {
    alignItems: 'center',
  },
  daySummaryLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  daySummaryValue: {
    fontSize: 13,
    fontWeight: '900',
    color: '#0F172A',
  },
  daySummaryDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E2E8F0',
  },
  filterPillsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterPillActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  filterPillActiveAmber: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  filterPillActiveEmerald: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  filterPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  filterPillTextActive: {
    color: '#FFFFFF',
  },
  filterPillTextActiveAmber: {
    color: '#92400E',
  },
  filterPillTextActiveEmerald: {
    color: '#065F46',
  },
  listContent: {
    padding: 16,
    gap: 12,
    backgroundColor: '#F8FAFC',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardPagada: {
    borderColor: '#A7F3D0',
    backgroundColor: '#FCFDFD',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  contratoBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  contratoText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F172A',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  badgePagada: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  badgePagadaText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#065F46',
  },
  badgePendiente: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  badgePendienteText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#92400E',
  },
  badgeVencida: {
    backgroundColor: '#FFF1F2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FECDD3',
  },
  badgeVencidaText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#BE123C',
  },
  cardBody: {
    marginBottom: 12,
  },
  clienteNombre: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 3,
  },
  ciudadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ciudadIcon: {
    fontSize: 11,
  },
  ciudadText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#059669',
  },
  cobradorText: {
    fontSize: 11,
    color: '#64748B',
  },
  finanzasRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  cuotaPill: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  cuotaPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
  },
  valorCol: {
    alignItems: 'flex-end',
  },
  valorLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  valorText: {
    fontSize: 15,
    fontWeight: '900',
  },
  valorPagadaText: {
    color: '#059669',
  },
  valorPendienteText: {
    color: '#0F172A',
  },
  cardFooter: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
    paddingVertical: 9,
    borderRadius: 10,
    gap: 6,
  },
  callBtnIcon: {
    fontSize: 13,
  },
  callBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
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
    color: '#64748B',
    fontWeight: '600',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
});
