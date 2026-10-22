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
  Linking,
  Alert,
  Platform,
} from 'react-native';
import apiClient from '../api/client';
import InFrameModal from '../components/InFrameModal';
import {
  guardarEnCache,
  obtenerDeCache,
} from '../storage/database';

const formatCOP = (val) => {
  const num = Math.round(Number(val) || 0);
  return '$ ' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const DIAS_SEMANA_HEADERS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const DIAS_NOMBRE_COMPLETO = [
  'Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'
];

const toISODate = (d) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function CalendarioScreen({ navigation }) {
  // Mes y Año en visualización
  const [currentDate, setCurrentDate] = useState(() => new Date());
  
  // Día seleccionado para el Bottom Sheet
  const [selectedDateStr, setSelectedDateStr] = useState(null);
  const [bottomSheetVisible, setBottomSheetVisible] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState(0); // Acordeón: primera tarjeta expandida por defecto

  // Datos del mes cargados desde /reportes/calendario
  const [calendarData, setCalendarData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filtroEstado, setFiltroEstado] = useState('todos'); // 'todos' | 'pendientes' | 'pagadas'

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1; // 1-12
  const hoyStr = useMemo(() => toISODate(new Date()), []);

  // =========================================================================
  // CARGA DE DATOS ASÍNCRONA DESDE EL BACKEND
  // =========================================================================
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

  useEffect(() => {
    cargarCalendarioMes(currentYear, currentMonth);
  }, [currentYear, currentMonth, cargarCalendarioMes]);

  // Navegación de Meses
  const cambiarMes = (offset) => {
    setCurrentDate((prev) => {
      const nuevo = new Date(prev.getFullYear(), prev.getMonth() + offset, 1);
      return nuevo;
    });
  };

  const irAMesActual = () => {
    const hoy = new Date();
    setCurrentDate(hoy);
    abrirDia(toISODate(hoy));
  };

  // =========================================================================
  // CONSTRUCCIÓN DE LA CUADRÍCULA MENSUAL NATIVA (FLEXBOX 7 COLUMNAS)
  // =========================================================================
  const gridCells = useMemo(() => {
    const year = currentYear;
    const month = currentMonth; // 1..12

    // Cantidad de días en el mes actual
    const daysInMonth = new Date(year, month, 0).getDate();
    // Cantidad de días en el mes anterior
    const daysInPrevMonth = new Date(year, month - 1, 0).getDate();

    // Día de la semana del primer día (0=Dom, 1=Lun, ..., 6=Sáb)
    const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
    // Ajustar a Lunes como primer día de la semana (0=Lun, 1=Mar, ..., 6=Dom)
    const leadingPadding = (firstDayOfWeek + 6) % 7;

    const cells = [];

    // 1. Celdas de relleno del mes anterior
    for (let i = leadingPadding - 1; i >= 0; i--) {
      const dNum = daysInPrevMonth - i;
      const prevM = month - 1 === 0 ? 12 : month - 1;
      const prevY = month - 1 === 0 ? year - 1 : year;
      const dateStr = `${prevY}-${String(prevM).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`;
      cells.push({
        key: `prev-${dNum}`,
        dayNum: dNum,
        dateStr,
        isCurrentMonth: false,
      });
    }

    // 2. Celdas del mes actual
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayData = calendarData?.dias?.[dateStr] || null;

      cells.push({
        key: `curr-${d}`,
        dayNum: d,
        dateStr,
        isCurrentMonth: true,
        isToday: dateStr === hoyStr,
        dayData,
        cuotasTotales: dayData?.cuotas_totales || 0,
        cuotasPendientes: dayData?.cuotas_pendientes || 0,
        cuotasPagadas: dayData?.cuotas_pagadas || 0,
        totalProgramado: dayData?.total_programado || 0,
      });
    }

    // 3. Celdas de relleno del mes siguiente para completar la cuadrícula de 7 columnas
    const totalCurrentCells = cells.length;
    const trailingPadding = (7 - (totalCurrentCells % 7)) % 7;
    for (let nextD = 1; nextD <= trailingPadding; nextD++) {
      const nextM = month + 1 > 12 ? 1 : month + 1;
      const nextY = month + 1 > 12 ? year + 1 : year;
      const dateStr = `${nextY}-${String(nextM).padStart(2, '0')}-${String(nextD).padStart(2, '0')}`;
      cells.push({
        key: `next-${nextD}`,
        dayNum: nextD,
        dateStr,
        isCurrentMonth: false,
      });
    }

    return cells;
  }, [currentYear, currentMonth, calendarData, hoyStr]);

  // =========================================================================
  // GESTIÓN DEL BOTTOM SHEET (IN-FRAME MODAL) Y ACORDEÓN
  // =========================================================================
  const abrirDia = (dateStr) => {
    setSelectedDateStr(dateStr);
    setFiltroEstado('todos');
    setExpandedIndex(0); // Primera tarjeta expandida por defecto
    setBottomSheetVisible(true);
  };

  const selectedDayData = useMemo(() => {
    if (!selectedDateStr) return null;
    return calendarData?.dias?.[selectedDateStr] || null;
  }, [calendarData, selectedDateStr]);

  // Cuotas filtradas dentro del Bottom Sheet
  const itemsFiltradosDelDia = useMemo(() => {
    const rawItems = selectedDayData?.items || [];
    if (filtroEstado === 'todos') return rawItems;
    if (filtroEstado === 'pagadas') return rawItems.filter((i) => i.pagada);
    if (filtroEstado === 'pendientes') return rawItems.filter((i) => !i.pagada);
    return rawItems;
  }, [selectedDayData, filtroEstado]);

  // Título amigable del día seleccionado
  const tituloDiaSeleccionado = useMemo(() => {
    if (!selectedDateStr) return '';
    const parts = selectedDateStr.split('-');
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    const diaNom = DIAS_NOMBRE_COMPLETO[d.getDay()];
    const diaNum = d.getDate();
    const mesNom = MESES[d.getMonth()];
    const anio = d.getFullYear();
    const esHoy = selectedDateStr === hoyStr;

    return `${diaNom}, ${diaNum} de ${mesNom} ${anio}${esHoy ? ' • HOY' : ''}`;
  }, [selectedDateStr, hoyStr]);

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

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />

      {/* HEADER PRINCIPAL */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>

        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Calendario de Cobros</Text>
          <Text style={styles.headerSubtitle}>
            {calendarData?.nombre_mes || `${MESES[currentMonth - 1]} ${currentYear}`}
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

      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => cargarCalendarioMes(currentYear, currentMonth, true)}
            colors={['#059669']}
            tintColor="#059669"
          />
        }
      >
        {/* ========================================================================= */}
        {/* NAVEGADOR DE MES & RESUMEN MENSUAL                                         */}
        {/* ========================================================================= */}
        <View style={styles.monthNavigatorCard}>
          <View style={styles.monthNavigatorRow}>
            <TouchableOpacity
              style={styles.monthNavBtn}
              onPress={() => cambiarMes(-1)}
              activeOpacity={0.75}
            >
              <Text style={styles.monthNavBtnText}>◀ Mes Ant.</Text>
            </TouchableOpacity>

            <View style={styles.monthTitleBox}>
              <Text style={styles.monthTitleText}>
                {MESES[currentMonth - 1]} {currentYear}
              </Text>
              <TouchableOpacity onPress={irAMesActual} activeOpacity={0.7}>
                <Text style={styles.monthTodayLink}>• Ir a Hoy</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.monthNavBtn}
              onPress={() => cambiarMes(1)}
              activeOpacity={0.75}
            >
              <Text style={styles.monthNavBtnText}>Mes Sig. ▶</Text>
            </TouchableOpacity>
          </View>

          {/* Tarjetas de Métricas del Mes Completo */}
          <View style={styles.monthMetricsRow}>
            <View style={styles.monthMetricCol}>
              <Text style={styles.monthMetricLabel}>PROGRAMADO</Text>
              <Text style={styles.monthMetricVal}>
                {formatCOP(calendarData?.total_programado_mes || 0)}
              </Text>
            </View>
            <View style={styles.monthMetricDivider} />
            <View style={styles.monthMetricCol}>
              <Text style={[styles.monthMetricLabel, { color: '#059669' }]}>RECAUDADO</Text>
              <Text style={[styles.monthMetricVal, { color: '#059669' }]}>
                {formatCOP(calendarData?.total_recaudado_mes || 0)}
              </Text>
            </View>
            <View style={styles.monthMetricDivider} />
            <View style={styles.monthMetricCol}>
              <Text style={[styles.monthMetricLabel, { color: '#D97706' }]}>PENDIENTE</Text>
              <Text style={[styles.monthMetricVal, { color: '#D97706' }]}>
                {formatCOP(calendarData?.total_pendiente_mes || 0)}
              </Text>
            </View>
          </View>
        </View>

        {/* ========================================================================= */}
        {/* CUADRÍCULA MENSUAL NATIVA (FLEXBOX 7 COLUMNAS)                             */}
        {/* ========================================================================= */}
        <View style={styles.calendarGridCard}>
          {/* Fila de Encabezados de Días de la Semana (Lun - Dom) */}
          <View style={styles.weekHeaderRow}>
            {DIAS_SEMANA_HEADERS.map((dia, idx) => (
              <View key={idx} style={styles.weekHeaderCell}>
                <Text
                  style={[
                    styles.weekHeaderText,
                    (idx === 5 || idx === 6) && styles.weekHeaderWeekend,
                  ]}
                >
                  {dia}
                </Text>
              </View>
            ))}
          </View>

          {/* Celdas del Calendario (Días) */}
          {isLoading && !isRefreshing ? (
            <View style={styles.loadingGridBox}>
              <ActivityIndicator size="small" color="#059669" />
              <Text style={styles.loadingGridText}>Cargando cronograma...</Text>
            </View>
          ) : (
            <View style={styles.gridContainer}>
              {gridCells.map((cell) => {
                const tieneCobros = cell.cuotasTotales > 0;
                const todasPagadas = tieneCobros && cell.cuotasPendientes === 0;
                const tienePendientes = tieneCobros && cell.cuotasPendientes > 0;

                return (
                  <TouchableOpacity
                    key={cell.key}
                    style={[
                      styles.dayCell,
                      !cell.isCurrentMonth && styles.dayCellOutside,
                      cell.isToday && styles.dayCellToday,
                    ]}
                    onPress={() => abrirDia(cell.dateStr)}
                    activeOpacity={0.7}
                  >
                    {/* Número del día */}
                    <View
                      style={[
                        styles.dayNumBadge,
                        cell.isToday && styles.dayNumBadgeToday,
                      ]}
                    >
                      <Text
                        style={[
                          styles.dayNumText,
                          !cell.isCurrentMonth && styles.dayNumTextOutside,
                          cell.isToday && styles.dayNumTextToday,
                        ]}
                      >
                        {cell.dayNum}
                      </Text>
                    </View>

                    {/* Indicadores visuales de cobros */}
                    {cell.isCurrentMonth && tieneCobros ? (
                      <View style={styles.dayIndicatorsWrap}>
                        {/* Badge de cantidad de cuotas */}
                        <View
                          style={[
                            styles.dayCuotasBadge,
                            todasPagadas
                              ? styles.badgePagadaBg
                              : styles.badgePendienteBg,
                          ]}
                        >
                          <Text
                            style={[
                              styles.dayCuotasBadgeText,
                              todasPagadas
                                ? styles.badgePagadaText
                                : styles.badgePendienteText,
                            ]}
                          >
                            {cell.cuotasTotales}
                          </Text>
                        </View>

                        {/* Punto semántico */}
                        <View
                          style={[
                            styles.dayStatusDot,
                            todasPagadas
                              ? styles.statusDotGreen
                              : tienePendientes
                              ? styles.statusDotAmber
                              : styles.statusDotGray,
                          ]}
                        />
                      </View>
                    ) : (
                      <View style={styles.dayPlaceholder} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Leyenda de Estados del Calendario */}
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.statusDotGreen]} />
              <Text style={styles.legendText}>Al Día / Pagado</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.statusDotAmber]} />
              <Text style={styles.legendText}>Pendiente</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={styles.legendTodayDot} />
              <Text style={styles.legendText}>Hoy</Text>
            </View>
          </View>
        </View>

        {/* Instrucción rápida */}
        <View style={styles.hintBox}>
          <Text style={styles.hintText}>
            💡 Toca cualquier día para inspeccionar el detalle de cobros programados en la ruta.
          </Text>
        </View>
      </ScrollView>

      {/* ========================================================================= */}
      {/* BOTTOM SHEET (IN-FRAME MODAL): LISTA DE COBROS CON ACORDEÓN                */}
      {/* ========================================================================= */}
      <InFrameModal
        visible={bottomSheetVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setBottomSheetVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={styles.modalDismissArea}
            activeOpacity={1}
            onPress={() => setBottomSheetVisible(false)}
          />

          <View style={styles.bottomSheetCard}>
            {/* Barra de Arrastre */}
            <View style={styles.sheetHandleBar} />

            {/* Cabecera del Bottom Sheet */}
            <View style={styles.sheetHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetDateTitle}>{tituloDiaSeleccionado}</Text>
                <Text style={styles.sheetDateSub}>
                  {selectedDayData?.cuotas_totales || 0} {selectedDayData?.cuotas_totales === 1 ? 'cuota programada' : 'cuotas programadas'}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.sheetCloseBtn}
                onPress={() => setBottomSheetVisible(false)}
              >
                <Text style={styles.sheetCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Mini Tarjeta Financiera del Día Seleccionado */}
            <View style={styles.sheetDayMetricsBox}>
              <View style={styles.sheetDayMetricCol}>
                <Text style={styles.sheetDayMetricLabel}>PROGRAMADO</Text>
                <Text style={styles.sheetDayMetricVal}>
                  {formatCOP(selectedDayData?.total_programado || 0)}
                </Text>
              </View>
              <View style={styles.sheetDayMetricDivider} />
              <View style={styles.sheetDayMetricCol}>
                <Text style={[styles.sheetDayMetricLabel, { color: '#059669' }]}>RECAUDADO</Text>
                <Text style={[styles.sheetDayMetricVal, { color: '#059669' }]}>
                  {formatCOP(selectedDayData?.total_recaudado || 0)}
                </Text>
              </View>
              <View style={styles.sheetDayMetricDivider} />
              <View style={styles.sheetDayMetricCol}>
                <Text style={[styles.sheetDayMetricLabel, { color: '#D97706' }]}>PENDIENTE</Text>
                <Text style={[styles.sheetDayMetricVal, { color: '#D97706' }]}>
                  {formatCOP(selectedDayData?.total_pendiente || 0)}
                </Text>
              </View>
            </View>

            {/* Píldoras de Filtro (Todos / Pendientes / Pagadas) */}
            <View style={styles.sheetPillsRow}>
              <TouchableOpacity
                style={[styles.sheetPill, filtroEstado === 'todos' && styles.sheetPillActive]}
                onPress={() => setFiltroEstado('todos')}
              >
                <Text
                  style={[
                    styles.sheetPillText,
                    filtroEstado === 'todos' && styles.sheetPillTextActive,
                  ]}
                >
                  Todos ({selectedDayData?.items?.length || 0})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.sheetPill,
                  filtroEstado === 'pendientes' && styles.sheetPillActiveAmber,
                ]}
                onPress={() => setFiltroEstado('pendientes')}
              >
                <Text
                  style={[
                    styles.sheetPillText,
                    filtroEstado === 'pendientes' && styles.sheetPillTextActiveAmber,
                  ]}
                >
                  ⏳ Pendientes ({selectedDayData?.cuotas_pendientes || 0})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.sheetPill,
                  filtroEstado === 'pagadas' && styles.sheetPillActiveEmerald,
                ]}
                onPress={() => setFiltroEstado('pagadas')}
              >
                <Text
                  style={[
                    styles.sheetPillText,
                    filtroEstado === 'pagadas' && styles.sheetPillTextActiveEmerald,
                  ]}
                >
                  ✓ Pagadas ({selectedDayData?.cuotas_pagadas || 0})
                </Text>
              </TouchableOpacity>
            </View>

            {/* ========================================================================= */}
            {/* LISTA DE COBROS COMO ACORDEÓN (expandedIndex === 0 POR DEFECTO)           */}
            {/* ========================================================================= */}
            <ScrollView
              style={{ maxHeight: 360 }}
              contentContainerStyle={{ paddingBottom: 16, gap: 10 }}
              showsVerticalScrollIndicator={false}
            >
              {itemsFiltradosDelDia.length === 0 ? (
                <View style={styles.sheetEmptyBox}>
                  <Text style={styles.sheetEmptyIcon}>📅</Text>
                  <Text style={styles.sheetEmptyTitle}>Sin cobros para esta fecha</Text>
                  <Text style={styles.sheetEmptySub}>
                    No hay cuotas programadas que coincidan con el filtro seleccionado.
                  </Text>
                </View>
              ) : (
                itemsFiltradosDelDia.map((item, idx) => {
                  const isExpanded = expandedIndex === idx;
                  const cliente = item.cliente_nombre || 'Cliente Titular';
                  const contrato =
                    item.codigo_contrato ||
                    `CTR-${String(item.id_contrato || '').slice(0, 8).toUpperCase()}`;
                  const ciudad = item.ciudad || 'Montería';
                  const cuotaTxt =
                    item.cuota_texto || `Cuota ${item.numero_cuota}/${item.total_cuotas}`;
                  const valor = Number(item.valor_cuota || 0);
                  const esPagada = Boolean(item.pagada);
                  const esVencida = !esPagada && item.estado === 'vencida';
                  const telefono = item.cliente_telefono;

                  return (
                    <View
                      key={`${item.id_contrato}-${item.numero_cuota}-${idx}`}
                      style={[
                        styles.accordionCard,
                        esPagada && styles.accordionCardPagada,
                        isExpanded && styles.accordionCardExpanded,
                      ]}
                    >
                      {/* Cabecera del Acordeón (Interactiva) */}
                      <TouchableOpacity
                        style={styles.accordionHeader}
                        onPress={() => setExpandedIndex(isExpanded ? -1 : idx)}
                        activeOpacity={0.8}
                      >
                        <View style={styles.accordionHeaderLeft}>
                          <View style={styles.accordionFolioBadge}>
                            <Text style={styles.accordionFolioText}>{contrato}</Text>
                          </View>
                          <Text style={styles.accordionClienteNombre} numberOfLines={1}>
                            {cliente}
                          </Text>
                        </View>

                        <View style={styles.accordionHeaderRight}>
                          <Text
                            style={[
                              styles.accordionValorText,
                              esPagada && { color: '#059669' },
                            ]}
                          >
                            {formatCOP(valor)}
                          </Text>

                          <View
                            style={[
                              styles.accordionBadgeStatus,
                              esPagada
                                ? styles.badgePagadaBg
                                : esVencida
                                ? styles.badgeVencidaBg
                                : styles.badgePendienteBg,
                            ]}
                          >
                            <Text
                              style={[
                                styles.accordionBadgeStatusText,
                                esPagada
                                  ? styles.badgePagadaText
                                  : esVencida
                                  ? styles.badgeVencidaText
                                  : styles.badgePendienteText,
                              ]}
                            >
                              {esPagada ? '✓' : esVencida ? '⚠️' : '⏳'}
                            </Text>
                          </View>

                          <Text style={styles.accordionChevron}>
                            {isExpanded ? '▲' : '▼'}
                          </Text>
                        </View>
                      </TouchableOpacity>

                      {/* Cuerpo Expandido del Acordeón */}
                      {isExpanded ? (
                        <View style={styles.accordionBody}>
                          {/* Datos Adicionales del Cliente y Ubicación */}
                          <View style={styles.accordionDetailRow}>
                            <Text style={styles.accordionDetailLabel}>📍 Ubicación:</Text>
                            <Text style={styles.accordionDetailVal}>{ciudad}</Text>
                          </View>

                          {item.cobrador_nombre ? (
                            <View style={styles.accordionDetailRow}>
                              <Text style={styles.accordionDetailLabel}>🛵 Cobrador:</Text>
                              <Text style={styles.accordionDetailVal}>
                                {item.cobrador_nombre}
                              </Text>
                            </View>
                          ) : null}

                          <View style={styles.accordionDetailRow}>
                            <Text style={styles.accordionDetailLabel}>📑 Plazo:</Text>
                            <Text style={styles.accordionDetailVal}>{cuotaTxt}</Text>
                          </View>

                          {item.saldo_pendiente !== undefined ? (
                            <View style={styles.accordionDetailRow}>
                              <Text style={styles.accordionDetailLabel}>Saldo Pendiente:</Text>
                              <Text style={[styles.accordionDetailVal, { fontWeight: '800' }]}>
                                {formatCOP(item.saldo_pendiente)}
                              </Text>
                            </View>
                          ) : null}

                          {/* Acciones de Contacto */}
                          {telefono ? (
                            <View style={styles.accordionActionsRow}>
                              <TouchableOpacity
                                style={styles.accordionCallBtn}
                                onPress={() => handleLlamar(telefono)}
                                activeOpacity={0.75}
                              >
                                <Text style={styles.accordionBtnIcon}>📞</Text>
                                <Text style={styles.accordionCallBtnText}>
                                  Llamar ({telefono})
                                </Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={styles.accordionWsBtn}
                                onPress={() => Linking.openURL(`https://wa.me/57${telefono}`)}
                                activeOpacity={0.75}
                              >
                                <Text style={styles.accordionBtnIcon}>💬</Text>
                                <Text style={styles.accordionWsBtnText}>WhatsApp</Text>
                              </TouchableOpacity>
                            </View>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </InFrameModal>
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
  scrollContainer: {
    padding: 16,
    backgroundColor: '#F8FAFC',
  },
  // NAVEGADOR DE MES & MÉTRICAS
  monthNavigatorCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  monthNavigatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  monthNavBtn: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  monthNavBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
  },
  monthTitleBox: {
    alignItems: 'center',
  },
  monthTitleText: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
  },
  monthTodayLink: {
    fontSize: 10,
    fontWeight: '700',
    color: '#059669',
    marginTop: 2,
  },
  monthMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  monthMetricCol: {
    alignItems: 'center',
  },
  monthMetricLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#64748B',
    marginBottom: 2,
    letterSpacing: 0.5,
  },
  monthMetricVal: {
    fontSize: 12,
    fontWeight: '900',
    color: '#0F172A',
  },
  monthMetricDivider: {
    width: 1,
    height: 22,
    backgroundColor: '#E2E8F0',
  },
  // CUADRÍCULA DEL CALENDARIO (7 COLUMNAS FLEXBOX)
  calendarGridCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  weekHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 8,
    marginBottom: 4,
  },
  weekHeaderCell: {
    width: '14.285%',
    alignItems: 'center',
  },
  weekHeaderText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
  },
  weekHeaderWeekend: {
    color: '#94A3B8',
  },
  loadingGridBox: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingGridText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.285%',
    height: 60,
    padding: 4,
    alignItems: 'center',
    justifyContent: 'flex-start',
    borderWidth: 0.5,
    borderColor: '#F1F5F9',
  },
  dayCellOutside: {
    opacity: 0.3,
  },
  dayCellToday: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderRadius: 8,
  },
  dayNumBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  dayNumBadgeToday: {
    backgroundColor: '#059669',
  },
  dayNumText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  dayNumTextOutside: {
    color: '#94A3B8',
  },
  dayNumTextToday: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  dayIndicatorsWrap: {
    alignItems: 'center',
    gap: 2,
  },
  dayCuotasBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  dayCuotasBadgeText: {
    fontSize: 8,
    fontWeight: '800',
  },
  dayStatusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  statusDotGreen: {
    backgroundColor: '#059669',
  },
  statusDotAmber: {
    backgroundColor: '#D97706',
  },
  statusDotGray: {
    backgroundColor: '#CBD5E1',
  },
  dayPlaceholder: {
    height: 10,
  },
  // LEYENDA
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingTop: 10,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendTodayDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#059669',
  },
  legendText: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '600',
  },
  hintBox: {
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  hintText: {
    fontSize: 11,
    color: '#64748B',
    textAlign: 'center',
  },
  // BOTTOM SHEET (IN-FRAME MODAL)
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  modalDismissArea: {
    flex: 1,
  },
  bottomSheetCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    maxHeight: '82%',
  },
  sheetHandleBar: {
    width: 36,
    height: 4,
    backgroundColor: '#CBD5E1',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetDateTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  sheetDateSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
    fontWeight: '600',
  },
  sheetCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCloseBtnText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '700',
  },
  sheetDayMetricsBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  sheetDayMetricCol: {
    alignItems: 'center',
  },
  sheetDayMetricLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#64748B',
    marginBottom: 2,
    letterSpacing: 0.5,
  },
  sheetDayMetricVal: {
    fontSize: 12,
    fontWeight: '900',
    color: '#0F172A',
  },
  sheetDayMetricDivider: {
    width: 1,
    height: 22,
    backgroundColor: '#E2E8F0',
  },
  sheetPillsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  sheetPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sheetPillActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  sheetPillActiveAmber: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  sheetPillActiveEmerald: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  sheetPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
  },
  sheetPillTextActive: {
    color: '#FFFFFF',
  },
  sheetPillTextActiveAmber: {
    color: '#92400E',
  },
  sheetPillTextActiveEmerald: {
    color: '#065F46',
  },
  // ACORDEÓN DE CUOTAS
  accordionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  accordionCardPagada: {
    borderColor: '#A7F3D0',
    backgroundColor: '#FCFDFD',
  },
  accordionCardExpanded: {
    borderColor: '#0F172A',
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  accordionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    marginRight: 6,
  },
  accordionFolioBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  accordionFolioText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0F172A',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  accordionClienteNombre: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
  },
  accordionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  accordionValorText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#0F172A',
  },
  accordionBadgeStatus: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  accordionBadgeStatusText: {
    fontSize: 9,
    fontWeight: '800',
  },
  badgePagadaBg: {
    backgroundColor: '#ECFDF5',
  },
  badgePagadaText: {
    color: '#065F46',
  },
  badgePendienteBg: {
    backgroundColor: '#FEF3C7',
  },
  badgePendienteText: {
    color: '#92400E',
  },
  badgeVencidaBg: {
    backgroundColor: '#FFF1F2',
  },
  badgeVencidaText: {
    color: '#BE123C',
  },
  accordionChevron: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '800',
    marginLeft: 2,
  },
  accordionBody: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    gap: 6,
  },
  accordionDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  accordionDetailLabel: {
    fontSize: 11,
    color: '#64748B',
  },
  accordionDetailVal: {
    fontSize: 11,
    color: '#0F172A',
    fontWeight: '600',
  },
  accordionActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  accordionCallBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 8,
    paddingVertical: 8,
    gap: 4,
  },
  accordionBtnIcon: {
    fontSize: 11,
  },
  accordionCallBtnText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  accordionWsBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ECFDF5',
    borderRadius: 8,
    paddingVertical: 8,
    gap: 4,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  accordionWsBtnText: {
    color: '#065F46',
    fontSize: 10,
    fontWeight: '700',
  },
  sheetEmptyBox: {
    padding: 30,
    alignItems: 'center',
  },
  sheetEmptyIcon: {
    fontSize: 28,
    marginBottom: 6,
  },
  sheetEmptyTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 2,
  },
  sheetEmptySub: {
    fontSize: 11,
    color: '#64748B',
    textAlign: 'center',
  },
});
