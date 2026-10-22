import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  StatusBar,
  Alert,
  Platform,
  Share,
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

const formatearFechaHora = (fechaInput) => {
  if (!fechaInput) return 'Hoy';
  const d = new Date(fechaInput);
  if (isNaN(d.getTime())) return 'Reciente';
  return d.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function ArqueoScreen({ navigation, route }) {
  const initialCobradorId = route?.params?.cobradorId || null;

  // Estados principales de navegación y pestañas
  const [activeTab, setActiveTab] = useState('arqueo'); // 'arqueo' | 'historial'

  // Datos maestros
  const [cobradores, setCobradores] = useState([]);
  const [cobradorSeleccionado, setCobradorSeleccionado] = useState(null);
  const [abonos, setAbonos] = useState([]);
  const [cierresHistoricos, setCierresHistoricos] = useState([]);

  // Estados de carga
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Filtros de recibos en ruta
  const [busqueda, setBusqueda] = useState('');
  const [filtroPill, setFiltroPill] = useState('todos'); // 'todos' | 'pendientes' | 'conciliados' | 'efectivo' | 'transferencia' | 'saldados'

  // Formulario de Arqueo
  const [efectivoEntregadoInput, setEfectivoEntregadoInput] = useState('');
  const [notasCierre, setNotasCierre] = useState('');

  // Modales
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showComprobanteModal, setShowComprobanteModal] = useState(false);
  const [ultimoCierre, setUltimoCierre] = useState(null);

  // =========================================================================
  // CARGA DE DATOS ASÍNCRONA DESDE FASTAPI
  // =========================================================================
  const cargarDatos = useCallback(async (isPullRefresh = false) => {
    if (isPullRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const [resUsers, resAbonos, resCierres] = await Promise.allSettled([
        apiClient.get('/usuarios?rol=cobrador'),
        apiClient.get('/abonos'),
        apiClient.get('/abonos/cierres-caja'),
      ]);

      let cobradoresCargados = [];
      if (resUsers.status === 'fulfilled' && Array.isArray(resUsers.value?.data)) {
        cobradoresCargados = resUsers.value.data.map((u, idx) => ({
          id: u.id,
          nombre: u.nombre,
          telefono: u.telefono || 'Sin teléfono',
          zona: `Ruta ${idx + 1}: Sector Operativo`,
          estado_activo: u.estado_activo,
        }));
        setCobradores(cobradoresCargados);
        guardarEnCache('cache_cobradores_arqueo', cobradoresCargados);
      } else {
        const cachedUsers = await obtenerDeCache('cache_cobradores_arqueo');
        if (Array.isArray(cachedUsers)) {
          cobradoresCargados = cachedUsers;
          setCobradores(cachedUsers);
        }
      }

      if (resAbonos.status === 'fulfilled' && Array.isArray(resAbonos.value?.data)) {
        const mappedAbonos = resAbonos.value.data.map((a) => ({
          id_recibo: a.id_recibo,
          cobrador_id: a.cobrador_id,
          credito_id: a.credito_id,
          cliente_nombre: a.cliente_nombre || 'Cliente Titular',
          cliente_cedula: a.cliente_cedula || '',
          valor_abonado: Number(a.valor_abonado || 0),
          fecha: a.fecha,
          estado: a.estado,
          cierre_caja_id: a.cierre_caja_id,
          metodo_pago: (a.metodo_pago || 'efectivo').toLowerCase().trim(),
          saldo_restante_credito:
            a.saldo_restante_credito !== undefined && a.saldo_restante_credito !== null
              ? Number(a.saldo_restante_credito)
              : undefined,
          numero_contrato: a.numero_contrato,
        }));
        setAbonos(mappedAbonos);
        guardarEnCache('cache_abonos_arqueo', mappedAbonos);
      } else {
        const cachedAbonos = await obtenerDeCache('cache_abonos_arqueo');
        if (Array.isArray(cachedAbonos)) setAbonos(cachedAbonos);
      }

      if (resCierres.status === 'fulfilled' && Array.isArray(resCierres.value?.data)) {
        const mappedCierres = resCierres.value.data.map((c) => ({
          id: c.id,
          cobrador_id: c.cobrador_id,
          cobrador_nombre: c.cobrador_nombre,
          responsable_id: c.responsable_id,
          responsable_nombre: c.responsable_nombre,
          fecha_cierre: c.fecha_cierre,
          total_esperado: Number(c.total_esperado || 0),
          efectivo_entregado: Number(c.efectivo_entregado || 0),
          diferencia: Number(c.diferencia || 0),
          cuadre_estado: c.cuadre_estado,
          abonos_conciliados_count: c.abonos_conciliados_count,
          notas: c.notas,
        }));
        setCierresHistoricos(mappedCierres);
        guardarEnCache('cache_cierres_arqueo', mappedCierres);
      } else {
        const cachedCierres = await obtenerDeCache('cache_cierres_arqueo');
        if (Array.isArray(cachedCierres)) setCierresHistoricos(cachedCierres);
      }

      // Asignar cobrador inicial seleccionado
      if (cobradoresCargados.length > 0) {
        setCobradorSeleccionado((prev) => {
          if (prev) {
            const stillExists = cobradoresCargados.find((c) => c.id === prev.id);
            if (stillExists) return stillExists;
          }
          if (initialCobradorId) {
            const match = cobradoresCargados.find((c) => c.id === initialCobradorId);
            if (match) return match;
          }
          return cobradoresCargados[0];
        });
      }
    } catch (err) {
      console.warn('[ArqueoScreen] Error consultando datos de arqueo:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [initialCobradorId]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  // =========================================================================
  // CLASIFICACIÓN REACTIVA DE RECAUDOS POR COBRADOR
  // =========================================================================
  const todosAbonosCobrador = useMemo(() => {
    if (!cobradorSeleccionado) return [];
    return abonos.filter((a) => a.cobrador_id === cobradorSeleccionado.id);
  }, [abonos, cobradorSeleccionado]);

  const abonosPendientes = useMemo(() => {
    return todosAbonosCobrador.filter((a) => a.estado === 'registrado');
  }, [todosAbonosCobrador]);

  const abonosConciliados = useMemo(() => {
    return todosAbonosCobrador.filter((a) => a.estado === 'conciliado');
  }, [todosAbonosCobrador]);

  // Clasificación por Método de Pago en Pendientes
  const pendientesEfectivo = useMemo(() => {
    return abonosPendientes.filter((a) => a.metodo_pago === 'efectivo');
  }, [abonosPendientes]);

  const pendientesTransferencias = useMemo(() => {
    return abonosPendientes.filter((a) => a.metodo_pago !== 'efectivo');
  }, [abonosPendientes]);

  // Clasificación por Impacto en Cartera
  const pendientesParciales = useMemo(() => {
    return abonosPendientes.filter((a) => (a.saldo_restante_credito ?? 1) > 0);
  }, [abonosPendientes]);

  const pendientesSaldados = useMemo(() => {
    return abonosPendientes.filter(
      (a) => a.saldo_restante_credito !== undefined && a.saldo_restante_credito <= 0
    );
  }, [abonosPendientes]);

  // Cálculos Financieros del Arqueo
  const totalEsperadoGeneral = useMemo(() => {
    return abonosPendientes.reduce((acc, a) => acc + a.valor_abonado, 0);
  }, [abonosPendientes]);

  const totalEsperadoEfectivo = useMemo(() => {
    return pendientesEfectivo.reduce((acc, a) => acc + a.valor_abonado, 0);
  }, [pendientesEfectivo]);

  const totalEsperadoTransferencias = useMemo(() => {
    return pendientesTransferencias.reduce((acc, a) => acc + a.valor_abonado, 0);
  }, [pendientesTransferencias]);

  // Sincronizar input de efectivo físico sugerido cuando cambia el cobrador o los totales
  useEffect(() => {
    setEfectivoEntregadoInput(totalEsperadoGeneral > 0 ? String(totalEsperadoGeneral) : '');
  }, [totalEsperadoGeneral, cobradorSeleccionado]);

  const efectivoEntregadoNum = parseFloat(efectivoEntregadoInput) || 0;
  const diferencia = efectivoEntregadoNum - totalEsperadoGeneral;

  const estadoCuadre = useMemo(() => {
    if (diferencia === 0) return 'cuadrado';
    if (diferencia < 0) return 'faltante';
    return 'sobrante';
  }, [diferencia]);

  // Filtrado reactivo del FlatList de recibos
  const abonosFiltrados = useMemo(() => {
    return todosAbonosCobrador.filter((a) => {
      if (filtroPill === 'pendientes' && a.estado !== 'registrado') return false;
      if (filtroPill === 'conciliados' && a.estado !== 'conciliado') return false;
      if (filtroPill === 'efectivo' && a.metodo_pago !== 'efectivo') return false;
      if (filtroPill === 'transferencia' && a.metodo_pago === 'efectivo') return false;
      if (filtroPill === 'saldados' && !(a.saldo_restante_credito !== undefined && a.saldo_restante_credito <= 0)) {
        return false;
      }

      if (busqueda.trim() === '') return true;
      const term = busqueda.toLowerCase();
      return (
        a.cliente_nombre.toLowerCase().includes(term) ||
        (a.cliente_cedula && a.cliente_cedula.toLowerCase().includes(term)) ||
        a.id_recibo.toLowerCase().includes(term) ||
        (a.numero_contrato && a.numero_contrato.toLowerCase().includes(term))
      );
    });
  }, [todosAbonosCobrador, filtroPill, busqueda]);

  // =========================================================================
  // EJECUCIÓN DEL ARQUEO Y CONCILIACIÓN (POST /abonos/conciliar-ruta)
  // =========================================================================
  const handleEjecutarConciliacion = async () => {
    if (!cobradorSeleccionado) return;
    setIsProcessing(true);
    const ahora = new Date().toLocaleString('es-CO');

    try {
      const res = await apiClient.post('/abonos/conciliar-ruta', {
        cobrador_id: cobradorSeleccionado.id,
        efectivo_entregado: efectivoEntregadoNum,
        notas: notasCierre,
      });

      const data = res.data;

      setUltimoCierre({
        id: data?.id,
        cobrador: data?.cobrador_nombre || cobradorSeleccionado.nombre,
        responsable: data?.responsable_nombre || 'Supervisor',
        totalEsperado: Number(data?.total_esperado ?? totalEsperadoGeneral),
        efectivoEntregado: Number(data?.efectivo_entregado ?? efectivoEntregadoNum),
        diferencia: Number(data?.diferencia ?? diferencia),
        cuadreEstado: data?.cuadre_estado || estadoCuadre,
        cantidadAbonos: data?.abonos_conciliados_count ?? abonosPendientes.length,
        totalEfectivo: totalEsperadoEfectivo,
        totalTransferencias: totalEsperadoTransferencias,
        saldadosCount: pendientesSaldados.length,
        parcialesCount: pendientesParciales.length,
        fechaHora: ahora,
        reciboIds: abonosPendientes.map((a) => a.id_recibo),
        notas: notasCierre,
      });

      setShowConfirmModal(false);
      setShowComprobanteModal(true);
      setNotasCierre('');

      // Recargar datos actualizados
      await cargarDatos();
    } catch (err) {
      console.error('Error al conciliar ruta:', err);
      const detailMsg = err.response?.data?.detail || err.message || 'Error en conciliación';
      if (Platform.OS === 'web') {
        alert('Error al registrar conciliación: ' + detailMsg);
      } else {
        Alert.alert('Error al Conciliar', detailMsg);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCompartirActa = async () => {
    if (!ultimoCierre) return;
    const texto = `=== ACTA DE ARQUEO Y CIERRE DE CAJA ===\n` +
      `Folio: ${ultimoCierre.id ? String(ultimoCierre.id).slice(0, 8).toUpperCase() : 'N/A'}\n` +
      `Fecha/Hora: ${ultimoCierre.fechaHora}\n` +
      `Cobrador: ${ultimoCierre.cobrador}\n` +
      `Auditor/Supervisor: ${ultimoCierre.responsable}\n` +
      `------------------------------------\n` +
      `Total Esperado: ${formatCOP(ultimoCierre.totalEsperado)}\n` +
      `  • Efectivo: ${formatCOP(ultimoCierre.totalEfectivo)}\n` +
      `  • Transferencia: ${formatCOP(ultimoCierre.totalTransferencias)}\n` +
      `Efectivo Entregado: ${formatCOP(ultimoCierre.efectivoEntregado)}\n` +
      `Diferencia: ${formatCOP(ultimoCierre.diferencia)} (${ultimoCierre.cuadreEstado.toUpperCase()})\n` +
      `Recaudos Conciliados: ${ultimoCierre.cantidadAbonos}\n` +
      (ultimoCierre.notas ? `Notas: ${ultimoCierre.notas}\n` : '') +
      `------------------------------------\n` +
      `Remundial Core - Control Operativo`;

    try {
      await Share.share({
        message: texto,
        title: 'Acta de Cierre de Caja',
      });
    } catch (_) {}
  };

  // =========================================================================
  // RENDER ITEM DE RECIBO
  // =========================================================================
  const renderReciboItem = ({ item }) => {
    const esPendiente = item.estado === 'registrado';
    const esEfectivo = item.metodo_pago === 'efectivo';
    const esSaldado = item.saldo_restante_credito !== undefined && item.saldo_restante_credito <= 0;

    return (
      <View style={[styles.reciboCard, !esPendiente && styles.reciboCardConciliado]}>
        {/* Cabecera del Recibo */}
        <View style={styles.reciboHeaderRow}>
          <View style={styles.reciboFolioBadge}>
            <Text style={styles.reciboFolioText}>
              {item.numero_contrato || `REC-${String(item.id_recibo).slice(0, 8).toUpperCase()}`}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 6 }}>
            {/* Badge de Método de Pago */}
            <View
              style={[
                styles.reciboMetodoBadge,
                esEfectivo ? styles.reciboMetodoEfectivo : styles.reciboMetodoTransf,
              ]}
            >
              <Text
                style={[
                  styles.reciboMetodoText,
                  esEfectivo ? styles.reciboMetodoTextEf : styles.reciboMetodoTextTr,
                ]}
              >
                {esEfectivo ? '💵 Efectivo' : '💳 Transf.'}
              </Text>
            </View>

            {/* Badge de Estado */}
            <View
              style={[
                styles.reciboEstadoBadge,
                esPendiente ? styles.reciboEstadoPendiente : styles.reciboEstadoConciliado,
              ]}
            >
              <Text
                style={[
                  styles.reciboEstadoText,
                  esPendiente ? styles.reciboEstadoTextPend : styles.reciboEstadoTextConc,
                ]}
              >
                {esPendiente ? '⏳ Por Arquear' : '✓ Conciliado'}
              </Text>
            </View>
          </View>
        </View>

        {/* Cliente y Cédula */}
        <View style={styles.reciboBody}>
          <Text style={styles.reciboClienteNombre} numberOfLines={1}>
            {item.cliente_nombre}
          </Text>
          <Text style={styles.reciboClienteSub}>
            {item.cliente_cedula ? `CC ${item.cliente_cedula} • ` : ''}
            {formatearFechaHora(item.fecha)}
          </Text>
        </View>

        {/* Monto y Estado en Cartera */}
        <View style={styles.reciboFooterRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {esSaldado ? (
              <View style={styles.saldadoBadge}>
                <Text style={styles.saldadoBadgeText}>🎉 Crédito Saldado</Text>
              </View>
            ) : item.saldo_restante_credito !== undefined ? (
              <Text style={styles.saldoRestanteText}>
                Resta: {formatCOP(item.saldo_restante_credito)}
              </Text>
            ) : null}
          </View>

          <Text style={styles.reciboMontoText}>{formatCOP(item.valor_abonado)}</Text>
        </View>
      </View>
    );
  };

  // =========================================================================
  // RENDER ITEM DE HISTORIAL DE CIERRES
  // =========================================================================
  const renderCierreHistoricoItem = ({ item }) => {
    const estado = (item.cuadre_estado || '').toLowerCase();
    const esCuadrado = estado === 'cuadrado';
    const esFaltante = estado === 'faltante';

    return (
      <View style={styles.cierreCard}>
        <View style={styles.cierreCardHeader}>
          <View>
            <Text style={styles.cierreFolioText}>
              CIERRE #{String(item.id).slice(0, 8).toUpperCase()}
            </Text>
            <Text style={styles.cierreFechaText}>
              {formatearFechaHora(item.fecha_cierre)}
            </Text>
          </View>

          <View
            style={[
              styles.cierreEstadoBadge,
              esCuadrado
                ? styles.cierreBadgeCuadrado
                : esFaltante
                ? styles.cierreBadgeFaltante
                : styles.cierreBadgeSobrante,
            ]}
          >
            <Text
              style={[
                styles.cierreEstadoBadgeText,
                esCuadrado
                  ? styles.cierreBadgeTextCuadrado
                  : esFaltante
                  ? styles.cierreBadgeTextFaltante
                  : styles.cierreBadgeTextSobrante,
              ]}
            >
              {esCuadrado ? '✓ Cuadrado' : esFaltante ? '⚠️ Faltante' : 'ℹ️ Sobrante'}
            </Text>
          </View>
        </View>

        <View style={styles.cierrePersonasRow}>
          <Text style={styles.cierrePersonaText}>
            <Text style={{ fontWeight: '800' }}>Cobrador:</Text> {item.cobrador_nombre}
          </Text>
          <Text style={styles.cierrePersonaText}>
            <Text style={{ fontWeight: '800' }}>Auditor:</Text> {item.responsable_nombre}
          </Text>
        </View>

        <View style={styles.cierreMontosGrid}>
          <View style={styles.cierreMontoCol}>
            <Text style={styles.cierreMontoLabel}>ESPERADO</Text>
            <Text style={styles.cierreMontoVal}>{formatCOP(item.total_esperado)}</Text>
          </View>
          <View style={styles.cierreMontoCol}>
            <Text style={styles.cierreMontoLabel}>ENTREGADO</Text>
            <Text style={styles.cierreMontoVal}>{formatCOP(item.efectivo_entregado)}</Text>
          </View>
          <View style={styles.cierreMontoCol}>
            <Text style={styles.cierreMontoLabel}>DIFERENCIA</Text>
            <Text
              style={[
                styles.cierreMontoVal,
                item.diferencia < 0 ? { color: '#BE123C' } : { color: '#059669' },
              ]}
            >
              {formatCOP(item.diferencia)}
            </Text>
          </View>
        </View>

        {item.notas ? (
          <View style={styles.cierreNotasBox}>
            <Text style={styles.cierreNotasText}>"{item.notas}"</Text>
          </View>
        ) : null}

        <View style={styles.cierreFooter}>
          <Text style={styles.cierreAbonosCountText}>
            ✓ {item.abonos_conciliados_count} recaudos auditados
          </Text>
        </View>
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
          <Text style={styles.headerTitle}>Arqueo & Conciliación</Text>
          <Text style={styles.headerSubtitle}>Auditoría de caja física en terreno</Text>
        </View>

        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => cargarDatos(true)}
          disabled={isRefreshing}
          activeOpacity={0.7}
        >
          <Text style={styles.refreshBtnText}>{isRefreshing ? '⏳' : '↻'}</Text>
        </TouchableOpacity>
      </View>

      {/* PESTAÑAS PRINCIPALES: MESA DE ARQUEO vs HISTORIAL */}
      <View style={styles.topTabBar}>
        <TouchableOpacity
          style={[styles.topTabBtn, activeTab === 'arqueo' && styles.topTabBtnActive]}
          onPress={() => setActiveTab('arqueo')}
          activeOpacity={0.7}
        >
          <Text
            style={[styles.topTabBtnText, activeTab === 'arqueo' && styles.topTabBtnTextActive]}
          >
            ⚖️ Mesa de Arqueo
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.topTabBtn, activeTab === 'historial' && styles.topTabBtnActive]}
          onPress={() => setActiveTab('historial')}
          activeOpacity={0.7}
        >
          <Text
            style={[styles.topTabBtnText, activeTab === 'historial' && styles.topTabBtnTextActive]}
          >
            📋 Historial ({cierresHistoricos.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* CONTENIDO PRINCIPAL */}
      {isLoading && !isRefreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#059669" />
          <Text style={styles.loadingText}>Sincronizando información de recaudos...</Text>
        </View>
      ) : activeTab === 'historial' ? (
        <FlatList
          data={cierresHistoricos}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderCierreHistoricoItem}
          contentContainerStyle={styles.historialListContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => cargarDatos(true)}
              colors={['#059669']}
              tintColor="#059669"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={styles.emptyTitle}>Sin cierres de caja previos</Text>
              <Text style={styles.emptySubtitle}>
                Aún no se han ejecutado cierres contables ni arqueos de rutas en el sistema.
              </Text>
            </View>
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.arqueoScrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => cargarDatos(true)}
              colors={['#059669']}
              tintColor="#059669"
            />
          }
        >
          {/* ========================================================================= */}
          {/* SELECTOR HORIZONTAL DE COBRADORES EN RUTA */}
          {/* ========================================================================= */}
          <View style={styles.cobradorSelectorSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeaderLabel}>SELECCIONAR COBRADOR EN BASE</Text>
              <Text style={styles.sectionHeaderCount}>
                {cobradores.length} {cobradores.length === 1 ? 'ruta' : 'rutas'}
              </Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.cobradoresPillsRow}
            >
              {cobradores.map((cob) => {
                const esSeleccionado = cobradorSeleccionado?.id === cob.id;
                const pendientesCob = abonos.filter(
                  (a) => a.cobrador_id === cob.id && a.estado === 'registrado'
                ).length;

                return (
                  <TouchableOpacity
                    key={cob.id}
                    style={[
                      styles.cobradorPill,
                      esSeleccionado && styles.cobradorPillSelected,
                    ]}
                    onPress={() => setCobradorSeleccionado(cob)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.cobradorPillIcon}>🛵</Text>
                    <Text
                      style={[
                        styles.cobradorPillNombre,
                        esSeleccionado && styles.cobradorPillNombreSelected,
                      ]}
                      numberOfLines={1}
                    >
                      {cob.nombre.split(' ')[0]}
                    </Text>
                    {pendientesCob > 0 ? (
                      <View
                        style={[
                          styles.cobradorPendingBadge,
                          esSeleccionado && styles.cobradorPendingBadgeSelected,
                        ]}
                      >
                        <Text
                          style={[
                            styles.cobradorPendingBadgeText,
                            esSeleccionado && styles.cobradorPendingBadgeTextSelected,
                          ]}
                        >
                          {pendientesCob}
                        </Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* ========================================================================= */}
          {/* TARJETAS DE CUADRE FINANCIERO (TOTAL ESPERADO, EFECTIVO, SEMÁFORO)         */}
          {/* ========================================================================= */}
          <View style={styles.cuadreCardsContainer}>
            {/* Tarjeta 1: Total Esperado en Sistema */}
            <View style={styles.totalEsperadoCard}>
              <View style={styles.esperadoCardHeader}>
                <Text style={styles.esperadoCardLabel}>TOTAL ESPERADO EN SISTEMA</Text>
                <View style={styles.esperadoLiveBadge}>
                  <Text style={styles.esperadoLiveDot}>•</Text>
                  <Text style={styles.esperadoLiveText}>
                    {abonosPendientes.length} pendientes
                  </Text>
                </View>
              </View>

              <Text style={styles.esperadoMontoBig}>
                {formatCOP(totalEsperadoGeneral)}
              </Text>

              {/* Desglose por método de pago */}
              <View style={styles.esperadoBreakdownRow}>
                <View style={styles.esperadoBreakdownCol}>
                  <Text style={styles.esperadoBreakdownLabel}>💵 EN EFECTIVO</Text>
                  <Text style={styles.esperadoBreakdownVal}>
                    {formatCOP(totalEsperadoEfectivo)}
                  </Text>
                </View>
                <View style={styles.esperadoBreakdownDivider} />
                <View style={styles.esperadoBreakdownCol}>
                  <Text style={styles.esperadoBreakdownLabel}>💳 TRANSFERENCIA</Text>
                  <Text style={styles.esperadoBreakdownVal}>
                    {formatCOP(totalEsperadoTransferencias)}
                  </Text>
                </View>
              </View>

              {/* Indicador de impacto en cartera */}
              <View style={styles.carteraImpactPill}>
                <Text style={styles.carteraImpactText}>
                  📑 {pendientesParciales.length} cuotas parciales • {pendientesSaldados.length} créditos saldados
                </Text>
              </View>
            </View>

            {/* Tarjeta 2: Efectivo Entregado en Base (Input Físico) */}
            <View style={styles.efectivoInputCard}>
              <Text style={styles.efectivoCardLabel}>EFECTIVO ENTREGADO EN CAJA FÍSICA</Text>
              
              <View style={styles.efectivoInputRow}>
                <Text style={styles.efectivoInputPrefix}>$</Text>
                <TextInput
                  style={styles.efectivoTextInput}
                  keyboardType="numeric"
                  value={efectivoEntregadoInput}
                  onChangeText={setEfectivoEntregadoInput}
                  placeholder="0"
                  placeholderTextColor="#94A3B8"
                  selectTextOnFocus
                />
              </View>

              {/* Botones de Ayuda Rápida (Helper Chips) */}
              <View style={styles.helperChipsRow}>
                <TouchableOpacity
                  style={styles.helperChip}
                  onPress={() => setEfectivoEntregadoInput(String(totalEsperadoGeneral))}
                  activeOpacity={0.7}
                >
                  <Text style={styles.helperChipText}>⚡ Auto-llenar Total</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.helperChip}
                  onPress={() => setEfectivoEntregadoInput(String(totalEsperadoEfectivo))}
                  activeOpacity={0.7}
                >
                  <Text style={styles.helperChipText}>💵 Solo Efectivo</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.helperChip, styles.helperChipReset]}
                  onPress={() => setEfectivoEntregadoInput('0')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.helperChipText, { color: '#64748B' }]}>$ 0</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Tarjeta 3: Indicador Semántico de Cuadre */}
            <View
              style={[
                styles.cuadreSemanticoCard,
                estadoCuadre === 'cuadrado'
                  ? styles.cuadreExactoCard
                  : estadoCuadre === 'faltante'
                  ? styles.cuadreFaltanteCard
                  : styles.cuadreSobranteCard,
              ]}
            >
              <View style={styles.cuadreSemanticoHeader}>
                <Text style={styles.cuadreSemanticoIcon}>
                  {estadoCuadre === 'cuadrado' ? '✓' : estadoCuadre === 'faltante' ? '⚠️' : 'ℹ️'}
                </Text>
                <Text
                  style={[
                    styles.cuadreSemanticoTitulo,
                    estadoCuadre === 'cuadrado'
                      ? styles.cuadreExactoText
                      : estadoCuadre === 'faltante'
                      ? styles.cuadreFaltanteText
                      : styles.cuadreSobranteText,
                  ]}
                >
                  {estadoCuadre === 'cuadrado'
                    ? 'CAJA CUADRADA EXACTA'
                    : estadoCuadre === 'faltante'
                    ? 'FALTANTE EN CAJA'
                    : 'SOBRANTE EN CAJA'}
                </Text>
                <Text
                  style={[
                    styles.cuadreSemanticoMonto,
                    estadoCuadre === 'cuadrado'
                      ? styles.cuadreExactoText
                      : estadoCuadre === 'faltante'
                      ? styles.cuadreFaltanteText
                      : styles.cuadreSobranteText,
                  ]}
                >
                  {diferencia === 0
                    ? '$ 0'
                    : diferencia < 0
                    ? `- ${formatCOP(Math.abs(diferencia))}`
                    : `+ ${formatCOP(diferencia)}`}
                </Text>
              </View>
              <Text
                style={[
                  styles.cuadreSemanticoSub,
                  estadoCuadre === 'cuadrado'
                    ? styles.cuadreExactoSub
                    : estadoCuadre === 'faltante'
                    ? styles.cuadreFaltanteSub
                    : styles.cuadreSobranteSub,
                ]}
              >
                {estadoCuadre === 'cuadrado'
                  ? 'El monto físico en mano coincide con el total de recibos en la ruta.'
                  : estadoCuadre === 'faltante'
                  ? 'El dinero entregado en efectivo es menor al registrado en sistema.'
                  : 'El dinero entregado en efectivo supera el total registrado en sistema.'}
              </Text>
            </View>

            {/* Textarea de Observaciones */}
            <View style={styles.notasContainer}>
              <Text style={styles.notasLabel}>OBSERVACIONES DE AUDITORÍA (OPCIONAL)</Text>
              <TextInput
                style={styles.notasInput}
                multiline
                numberOfLines={2}
                placeholder="Anotaciones sobre novedades, justificación de diferencias..."
                placeholderTextColor="#94A3B8"
                value={notasCierre}
                onChangeText={setNotasCierre}
              />
            </View>
          </View>

          {/* ========================================================================= */}
          {/* FLATLIST / DETALLE DE RECIBOS EN RUTA CON FILTROS                          */}
          {/* ========================================================================= */}
          <View style={styles.recibosSection}>
            <View style={styles.recibosHeaderRow}>
              <Text style={styles.recibosSectionTitle}>
                Recibos de la Ruta ({todosAbonosCobrador.length})
              </Text>
              <Text style={styles.recibosSectionSub}>
                {abonosPendientes.length} pendientes por cerrar
              </Text>
            </View>

            {/* Buscador de Recibos */}
            <View style={styles.recibosSearchBar}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={styles.recibosSearchInput}
                placeholder="Buscar por cliente, cédula o contrato..."
                placeholderTextColor="#94A3B8"
                value={busqueda}
                onChangeText={setBusqueda}
                clearButtonMode="while-editing"
              />
              {busqueda.length > 0 ? (
                <TouchableOpacity onPress={() => setBusqueda('')}>
                  <Text style={styles.searchClearBtn}>✕</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Píldoras de Filtro */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterPillsScroll}
            >
              <TouchableOpacity
                style={[styles.filterPill, filtroPill === 'todos' && styles.filterPillActive]}
                onPress={() => setFiltroPill('todos')}
              >
                <Text
                  style={[styles.filterPillText, filtroPill === 'todos' && styles.filterPillTextActive]}
                >
                  Todos ({todosAbonosCobrador.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.filterPill,
                  filtroPill === 'pendientes' && styles.filterPillActiveAmber,
                ]}
                onPress={() => setFiltroPill('pendientes')}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    filtroPill === 'pendientes' && styles.filterPillTextActiveAmber,
                  ]}
                >
                  ⏳ Pendientes ({abonosPendientes.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.filterPill,
                  filtroPill === 'conciliados' && styles.filterPillActiveEmerald,
                ]}
                onPress={() => setFiltroPill('conciliados')}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    filtroPill === 'conciliados' && styles.filterPillTextActiveEmerald,
                  ]}
                >
                  ✓ Conciliados ({abonosConciliados.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.filterPill, filtroPill === 'efectivo' && styles.filterPillActive]}
                onPress={() => setFiltroPill('efectivo')}
              >
                <Text
                  style={[styles.filterPillText, filtroPill === 'efectivo' && styles.filterPillTextActive]}
                >
                  💵 Efectivo ({pendientesEfectivo.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.filterPill, filtroPill === 'transferencia' && styles.filterPillActive]}
                onPress={() => setFiltroPill('transferencia')}
              >
                <Text
                  style={[styles.filterPillText, filtroPill === 'transferencia' && styles.filterPillTextActive]}
                >
                  💳 Transf. ({pendientesTransferencias.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.filterPill, filtroPill === 'saldados' && styles.filterPillActiveEmerald]}
                onPress={() => setFiltroPill('saldados')}
              >
                <Text
                  style={[styles.filterPillText, filtroPill === 'saldados' && styles.filterPillTextActiveEmerald]}
                >
                  🎉 Saldados ({pendientesSaldados.length})
                </Text>
              </TouchableOpacity>
            </ScrollView>

            {/* Listado de Recibos */}
            {abonosFiltrados.length === 0 ? (
              <View style={styles.emptyRecibosBox}>
                <Text style={styles.emptyIcon}>📂</Text>
                <Text style={styles.emptyTitle}>Sin recibos para mostrar</Text>
                <Text style={styles.emptySubtitle}>
                  No hay pagos registrados bajo el filtro seleccionado en la ruta de este cobrador.
                </Text>
              </View>
            ) : (
              abonosFiltrados.map((item, idx) => (
                <View key={item.id_recibo || idx}>
                  {renderReciboItem({ item })}
                </View>
              ))
            )}
          </View>

          {/* Espaciado para el Bottom Bar */}
          <View style={{ height: 100 }} />
        </ScrollView>
      )}

      {/* ========================================================================= */}
      {/* BOTÓN PRINCIPAL FLOTANTE DE CIERRE Y CONCILIACIÓN                          */}
      {/* ========================================================================= */}
      {activeTab === 'arqueo' && (
        <View style={styles.bottomBarContainer}>
          <TouchableOpacity
            style={[
              styles.btnConciliarPrincipal,
              (abonosPendientes.length === 0 || isProcessing) && styles.btnConciliarDisabled,
            ]}
            onPress={() => setShowConfirmModal(true)}
            disabled={abonosPendientes.length === 0 || isProcessing}
            activeOpacity={0.85}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Text style={styles.btnConciliarIcon}>⚖️</Text>
                <Text style={styles.btnConciliarText}>
                  Conciliar Ruta ({abonosPendientes.length} {abonosPendientes.length === 1 ? 'recibo' : 'recibos'})
                </Text>
                <Text style={styles.btnConciliarSub}>
                  {formatCOP(totalEsperadoGeneral)}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: CONFIRMACIÓN DE CONCILIACIÓN Y CIERRE                             */}
      {/* ========================================================================= */}
      <InFrameModal
        visible={showConfirmModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => !isProcessing && setShowConfirmModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={styles.modalDismissArea}
            activeOpacity={1}
            onPress={() => !isProcessing && setShowConfirmModal(false)}
          />

          <View style={styles.confirmSheet}>
            <View style={styles.menuHandleBar} />
            <Text style={styles.confirmSheetTitle}>Confirmar Cierre de Caja</Text>
            <Text style={styles.confirmSheetSub}>
              Ruta de {cobradorSeleccionado?.nombre}
            </Text>

            <View style={styles.confirmSummaryBox}>
              <View style={styles.confirmSummaryRow}>
                <Text style={styles.confirmSummaryLabel}>Recaudos a Conciliar:</Text>
                <Text style={styles.confirmSummaryVal}>{abonosPendientes.length} recibos</Text>
              </View>
              <View style={styles.confirmSummaryRow}>
                <Text style={styles.confirmSummaryLabel}>Total Esperado en Sistema:</Text>
                <Text style={styles.confirmSummaryVal}>{formatCOP(totalEsperadoGeneral)}</Text>
              </View>
              <View style={styles.confirmSummaryRow}>
                <Text style={styles.confirmSummaryLabel}>Efectivo Físico Entregado:</Text>
                <Text style={[styles.confirmSummaryVal, { color: '#059669' }]}>
                  {formatCOP(efectivoEntregadoNum)}
                </Text>
              </View>
              <View style={styles.confirmSummaryDivider} />
              <View style={styles.confirmSummaryRow}>
                <Text style={styles.confirmSummaryLabel}>Diferencia Resultante:</Text>
                <Text
                  style={[
                    styles.confirmSummaryVal,
                    diferencia === 0
                      ? { color: '#059669' }
                      : diferencia < 0
                      ? { color: '#BE123C' }
                      : { color: '#D97706' },
                  ]}
                >
                  {diferencia === 0
                    ? '$ 0 (Cuadrada)'
                    : diferencia < 0
                    ? `- ${formatCOP(Math.abs(diferencia))} (Faltante)`
                    : `+ ${formatCOP(diferencia)} (Sobrante)`}
                </Text>
              </View>
            </View>

            <Text style={styles.confirmDisclaimer}>
              ⚠️ Esta operación marcará los recibos como "conciliados" contablemente y generará el acta definitiva de cierre para auditoría.
            </Text>

            <View style={styles.confirmActionsRow}>
              <TouchableOpacity
                style={styles.confirmCancelBtn}
                onPress={() => setShowConfirmModal(false)}
                disabled={isProcessing}
              >
                <Text style={styles.confirmCancelBtnText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.confirmOkBtn}
                onPress={handleEjecutarConciliacion}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.confirmOkBtnText}>Confirmar y Cerrar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </InFrameModal>

      {/* ========================================================================= */}
      {/* MODAL 2: ACTA DE CIERRE / COMPROBANTE FINALIZADO                           */}
      {/* ========================================================================= */}
      <InFrameModal
        visible={showComprobanteModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowComprobanteModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={styles.modalDismissArea}
            activeOpacity={1}
            onPress={() => setShowComprobanteModal(false)}
          />

          <View style={styles.comprobanteSheet}>
            <View style={styles.menuHandleBar} />
            <View style={styles.comprobanteCheckCircle}>
              <Text style={{ fontSize: 26 }}>✓</Text>
            </View>
            <Text style={styles.comprobanteTitle}>¡Ruta Conciliada Exitosamente!</Text>
            <Text style={styles.comprobanteSub}>
              Cierre contable radicado en el sistema
            </Text>

            {ultimoCierre ? (
              <View style={styles.actaCard}>
                <View style={styles.actaHeader}>
                  <Text style={styles.actaFolio}>
                    ACTA #{ultimoCierre.id ? String(ultimoCierre.id).slice(0, 8).toUpperCase() : 'OK'}
                  </Text>
                  <Text style={styles.actaFecha}>{ultimoCierre.fechaHora}</Text>
                </View>

                <View style={styles.actaRow}>
                  <Text style={styles.actaLabel}>Cobrador:</Text>
                  <Text style={styles.actaVal}>{ultimoCierre.cobrador}</Text>
                </View>
                <View style={styles.actaRow}>
                  <Text style={styles.actaLabel}>Auditor / Supervisor:</Text>
                  <Text style={styles.actaVal}>{ultimoCierre.responsable}</Text>
                </View>
                <View style={styles.actaRow}>
                  <Text style={styles.actaLabel}>Recibos Conciliados:</Text>
                  <Text style={styles.actaVal}>{ultimoCierre.cantidadAbonos}</Text>
                </View>
                <View style={styles.actaRow}>
                  <Text style={styles.actaLabel}>Total Esperado:</Text>
                  <Text style={styles.actaVal}>{formatCOP(ultimoCierre.totalEsperado)}</Text>
                </View>
                <View style={styles.actaRow}>
                  <Text style={styles.actaLabel}>Efectivo Recibido:</Text>
                  <Text style={[styles.actaVal, { color: '#059669' }]}>
                    {formatCOP(ultimoCierre.efectivoEntregado)}
                  </Text>
                </View>
                <View style={styles.actaDivider} />
                <View style={styles.actaRow}>
                  <Text style={styles.actaLabel}>Diferencia:</Text>
                  <Text
                    style={[
                      styles.actaVal,
                      ultimoCierre.diferencia < 0 ? { color: '#BE123C' } : { color: '#059669' },
                    ]}
                  >
                    {formatCOP(ultimoCierre.diferencia)} ({ultimoCierre.cuadreEstado.toUpperCase()})
                  </Text>
                </View>
              </View>
            ) : null}

            <View style={styles.comprobanteActions}>
              <TouchableOpacity
                style={styles.comprobanteShareBtn}
                onPress={handleCompartirActa}
                activeOpacity={0.8}
              >
                <Text style={styles.comprobanteShareIcon}>📤</Text>
                <Text style={styles.comprobanteShareText}>Compartir Acta de Cierre</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.comprobanteDoneBtn}
                onPress={() => setShowComprobanteModal(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.comprobanteDoneText}>Finalizar y Continuar</Text>
              </TouchableOpacity>
            </View>
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
  topTabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  topTabBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  topTabBtnActive: {
    borderBottomColor: '#0F172A',
  },
  topTabBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  topTabBtnTextActive: {
    color: '#0F172A',
    fontWeight: '800',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  arqueoScrollContent: {
    padding: 16,
    backgroundColor: '#F8FAFC',
  },
  // COBRADOR SELECTOR
  cobradorSelectorSection: {
    marginBottom: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionHeaderLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  sectionHeaderCount: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
  },
  cobradoresPillsRow: {
    gap: 8,
    paddingVertical: 4,
  },
  cobradorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  cobradorPillSelected: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  cobradorPillIcon: {
    fontSize: 13,
  },
  cobradorPillNombre: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  cobradorPillNombreSelected: {
    color: '#FFFFFF',
  },
  cobradorPendingBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  cobradorPendingBadgeSelected: {
    backgroundColor: '#059669',
  },
  cobradorPendingBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#92400E',
  },
  cobradorPendingBadgeTextSelected: {
    color: '#FFFFFF',
  },
  // CUADRE CARDS CONTAINER
  cuadreCardsContainer: {
    gap: 12,
    marginBottom: 20,
  },
  totalEsperadoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  esperadoCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  esperadoCardLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.8,
  },
  esperadoLiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  esperadoLiveDot: {
    color: '#059669',
    fontSize: 12,
    fontWeight: '900',
  },
  esperadoLiveText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#065F46',
  },
  esperadoMontoBig: {
    fontSize: 28,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.6,
    marginBottom: 12,
  },
  esperadoBreakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    marginBottom: 10,
  },
  esperadoBreakdownCol: {
    alignItems: 'center',
  },
  esperadoBreakdownLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    marginBottom: 2,
  },
  esperadoBreakdownVal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  esperadoBreakdownDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E2E8F0',
  },
  carteraImpactPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  carteraImpactText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  // EFECTIVO INPUT CARD
  efectivoInputCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  efectivoCardLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  efectivoInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 52,
    borderWidth: 2,
    borderColor: '#059669',
    marginBottom: 10,
  },
  efectivoInputPrefix: {
    fontSize: 20,
    fontWeight: '900',
    color: '#059669',
    marginRight: 6,
  },
  efectivoTextInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '900',
    color: '#0F172A',
    paddingVertical: 0,
  },
  helperChipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  helperChip: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  helperChipReset: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
  },
  helperChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  // SEMÁFORO DE CUADRE
  cuadreSemanticoCard: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
  },
  cuadreExactoCard: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  cuadreFaltanteCard: {
    backgroundColor: '#FFF1F2',
    borderColor: '#FECDD3',
  },
  cuadreSobranteCard: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  cuadreSemanticoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cuadreSemanticoIcon: {
    fontSize: 14,
    marginRight: 4,
  },
  cuadreSemanticoTitulo: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.4,
    flex: 1,
  },
  cuadreSemanticoMonto: {
    fontSize: 14,
    fontWeight: '900',
  },
  cuadreExactoText: {
    color: '#065F46',
  },
  cuadreFaltanteText: {
    color: '#BE123C',
  },
  cuadreSobranteText: {
    color: '#92400E',
  },
  cuadreSemanticoSub: {
    fontSize: 11,
    fontWeight: '600',
  },
  cuadreExactoSub: {
    color: '#047857',
  },
  cuadreFaltanteSub: {
    color: '#9F1239',
  },
  cuadreSobranteSub: {
    color: '#78350F',
  },
  // OBSERVACIONES TEXTAREA
  notasContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  notasLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  notasInput: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    fontSize: 12,
    color: '#0F172A',
    minHeight: 50,
    textAlignVertical: 'top',
  },
  // RECIBOS SECTION
  recibosSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  recibosHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  recibosSectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  recibosSectionSub: {
    fontSize: 11,
    fontWeight: '600',
    color: '#D97706',
  },
  recibosSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 38,
    gap: 8,
    marginBottom: 10,
  },
  searchIcon: {
    fontSize: 13,
  },
  recibosSearchInput: {
    flex: 1,
    fontSize: 12,
    color: '#0F172A',
    fontWeight: '600',
    paddingVertical: 0,
  },
  searchClearBtn: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '800',
  },
  filterPillsScroll: {
    gap: 6,
    marginBottom: 12,
  },
  filterPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
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
    fontSize: 10,
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
  reciboCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  reciboCardConciliado: {
    backgroundColor: '#F8FAFC',
    borderColor: '#F1F5F9',
    opacity: 0.85,
  },
  reciboHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  reciboFolioBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  reciboFolioText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0F172A',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  reciboMetodoBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  reciboMetodoEfectivo: {
    backgroundColor: '#ECFDF5',
  },
  reciboMetodoTransf: {
    backgroundColor: '#EFF6FF',
  },
  reciboMetodoText: {
    fontSize: 9,
    fontWeight: '700',
  },
  reciboMetodoTextEf: {
    color: '#065F46',
  },
  reciboMetodoTextTr: {
    color: '#1D4ED8',
  },
  reciboEstadoBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  reciboEstadoPendiente: {
    backgroundColor: '#FEF3C7',
  },
  reciboEstadoConciliado: {
    backgroundColor: '#F1F5F9',
  },
  reciboEstadoText: {
    fontSize: 9,
    fontWeight: '700',
  },
  reciboEstadoTextPend: {
    color: '#92400E',
  },
  reciboEstadoTextConc: {
    color: '#64748B',
  },
  reciboBody: {
    marginBottom: 6,
  },
  reciboClienteNombre: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 1,
  },
  reciboClienteSub: {
    fontSize: 11,
    color: '#64748B',
  },
  reciboFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 6,
  },
  saldadoBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  saldadoBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#059669',
  },
  saldoRestanteText: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '600',
  },
  reciboMontoText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#059669',
  },
  emptyRecibosBox: {
    padding: 30,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 28,
    marginBottom: 6,
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  emptySubtitle: {
    fontSize: 11,
    color: '#64748B',
    textAlign: 'center',
  },
  // BOTTOM BAR PRINCIPAL
  bottomBarContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 8,
  },
  btnConciliarPrincipal: {
    backgroundColor: '#059669',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  btnConciliarDisabled: {
    backgroundColor: '#94A3B8',
    opacity: 0.6,
  },
  btnConciliarIcon: {
    fontSize: 18,
  },
  btnConciliarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
    marginLeft: 8,
  },
  btnConciliarSub: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  // HISTORIAL DE CIERRES
  historialListContent: {
    padding: 16,
    gap: 12,
  },
  cierreCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 2,
  },
  cierreCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cierreFolioText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#0F172A',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  cierreFechaText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  cierreEstadoBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  cierreBadgeCuadrado: {
    backgroundColor: '#ECFDF5',
  },
  cierreBadgeFaltante: {
    backgroundColor: '#FFF1F2',
  },
  cierreBadgeSobrante: {
    backgroundColor: '#FEF3C7',
  },
  cierreEstadoBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  cierreBadgeTextCuadrado: {
    color: '#065F46',
  },
  cierreBadgeTextFaltante: {
    color: '#BE123C',
  },
  cierreBadgeTextSobrante: {
    color: '#92400E',
  },
  cierrePersonasRow: {
    marginBottom: 10,
    gap: 2,
  },
  cierrePersonaText: {
    fontSize: 11,
    color: '#475569',
  },
  cierreMontosGrid: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  cierreMontoCol: {
    flex: 1,
    alignItems: 'center',
  },
  cierreMontoLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#94A3B8',
    marginBottom: 2,
  },
  cierreMontoVal: {
    fontSize: 12,
    fontWeight: '900',
    color: '#0F172A',
  },
  cierreNotasBox: {
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
  cierreNotasText: {
    fontSize: 11,
    fontStyle: 'italic',
    color: '#475569',
  },
  cierreFooter: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 8,
  },
  cierreAbonosCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  // MODALES
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  modalDismissArea: {
    flex: 1,
  },
  menuHandleBar: {
    width: 36,
    height: 4,
    backgroundColor: '#CBD5E1',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 14,
  },
  confirmSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
  },
  confirmSheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
  },
  confirmSheetSub: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 14,
  },
  confirmSummaryBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
    gap: 8,
  },
  confirmSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  confirmSummaryLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  confirmSummaryVal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  confirmSummaryDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 2,
  },
  confirmDisclaimer: {
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: 16,
  },
  confirmActionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  confirmCancelBtn: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  confirmOkBtn: {
    flex: 1,
    backgroundColor: '#059669',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmOkBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  // COMPROBANTE FINAL
  comprobanteSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    alignItems: 'center',
  },
  comprobanteCheckCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#ECFDF5',
    borderWidth: 2,
    borderColor: '#A7F3D0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  comprobanteTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 2,
  },
  comprobanteSub: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 14,
  },
  actaCard: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
    gap: 8,
  },
  actaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingBottom: 8,
    marginBottom: 2,
  },
  actaFolio: {
    fontSize: 11,
    fontWeight: '900',
    color: '#0F172A',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  actaFecha: {
    fontSize: 10,
    color: '#64748B',
  },
  actaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actaLabel: {
    fontSize: 11,
    color: '#64748B',
  },
  actaVal: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  actaDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 2,
  },
  comprobanteActions: {
    width: '100%',
    gap: 10,
  },
  comprobanteShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    paddingVertical: 12,
    gap: 8,
  },
  comprobanteShareIcon: {
    fontSize: 14,
  },
  comprobanteShareText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  comprobanteDoneBtn: {
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  comprobanteDoneText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
