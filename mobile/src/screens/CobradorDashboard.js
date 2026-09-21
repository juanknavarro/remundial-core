import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Linking,
  Platform,
} from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import apiClient, { STORAGE_KEYS, limpiarCredencialesLocales } from '../api/client';
import InFrameModal from '../components/InFrameModal';
import SignatureCanvas from '../components/SignatureCanvas';
import {
  guardarEnCache,
  obtenerDeCache,
  STORAGE_KEYS as DB_STORAGE_KEYS,
} from '../storage/database';

// Función auxiliar de formateo en pesos colombianos
const formatCOP = (val) => {
  const num = Math.round(Number(val) || 0);
  return '$ ' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

// Formateador de fecha local YYYY-MM-DD
const getFechaLocal = (isoOrDate) => {
  if (!isoOrDate) return '';
  if (typeof isoOrDate === 'string') {
    const s = isoOrDate.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return s;
    }
  }
  const d = new Date(isoOrDate);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Motor de cálculo de fecha de vencimiento escalonada (soporte frontend / offline)
const calcularVencimientoCuota = (credito) => {
  if (!credito) return null;
  if (credito.fecha_proximo_vencimiento) {
    return getFechaLocal(credito.fecha_proximo_vencimiento);
  }
  const fPrimera = credito.fecha_primera_cuota || credito.fecha_desembolso || credito.fecha_compra || credito.creado_en;
  if (!fPrimera) return null;

  const totalFinanciado = Number(credito.monto_financiado || credito.valorTotal || credito.valor_total || 0);
  const saldo = Number(credito.saldo_pendiente || 0);
  const cuota = Number(credito.valor_cuota || 0);
  const totalCuotas = Number(credito.numero_cuotas || credito.cuotas || 1);
  const amortizado = Math.max(0, totalFinanciado - saldo);
  const cuotasPagadas = cuota > 0 ? Math.floor(amortizado / cuota) : 0;
  const proximaIdx = Math.min(Math.max(0, totalCuotas - 1), cuotasPagadas);

  const tipoPago = String(credito.tipo_pago || 'mensual').toLowerCase();
  const fStr = getFechaLocal(fPrimera);
  if (!fStr) return null;
  const [yearStr, monthStr, dayStr] = fStr.split('-');
  const y = parseInt(yearStr, 10);
  const m = parseInt(monthStr, 10) - 1;
  const d = parseInt(dayStr, 10);

  const targetDate = new Date(y, m, d);

  if (tipoPago === 'quincenal') {
    targetDate.setDate(targetDate.getDate() + 15 * proximaIdx);
  } else if (tipoPago === 'semanal') {
    targetDate.setDate(targetDate.getDate() + 7 * proximaIdx);
  } else if (tipoPago === 'diario') {
    targetDate.setDate(targetDate.getDate() + proximaIdx);
  } else {
    // mensual
    const origDay = targetDate.getDate();
    targetDate.setMonth(targetDate.getMonth() + proximaIdx);
    if (targetDate.getDate() !== origDay) {
      targetDate.setDate(0);
    }
  }
  return getFechaLocal(targetDate);
};

// Desglose escalonado de cuotas con indicadores visuales de verificación, pagos parciales y arrastre de saldo
const obtenerCuotasConChulos = (credito) => {
  if (!credito) return [];

  // Si el backend ya devolvió el cronograma enriquecido con arrastre y parciales:
  const rawCronograma = credito.cronograma || credito.cronograma_cuotas;
  if (Array.isArray(rawCronograma) && rawCronograma.length > 0) {
    return rawCronograma.map((c) => ({
      numero: c.numero,
      monto: Number(c.valor_exigible || c.valor_cuota || 0),
      valor_base: Number(c.valor_base || c.valor_cuota || 0),
      valor_exigible: Number(c.valor_exigible || c.valor_cuota || 0),
      valor_pagado: Number(c.valor_pagado || 0),
      saldo_cuota: Number(c.saldo_cuota || 0),
      monto_arrastrado: Number(c.monto_arrastrado || 0),
      fecha: getFechaLocal(c.fecha_vencimiento),
      pagada: Boolean(c.pagada),
      es_parcial: Boolean(c.es_parcial || c.estado === 'parcial'),
      estado: c.estado || (c.pagada ? 'pagada' : 'pendiente'),
    }));
  }

  // Cálculo autónomo local / offline con amortización escalonada y arrastre de saldo insoluto:
  const totalFinanciado = Number(credito.monto_financiado || credito.valorTotal || credito.valor_total || 0);
  const saldo = Number(credito.saldo_pendiente || 0);
  const totalCuotas = Math.max(1, Number(credito.numero_cuotas || credito.cuotas || 1));
  const valorCuotaBase = Number(credito.valor_cuota || (totalCuotas > 0 ? totalFinanciado / totalCuotas : 0));
  const amortizado = Math.max(0, totalFinanciado - saldo);

  const fPrimera = credito.fecha_primera_cuota || credito.fecha_desembolso || credito.fecha_compra || credito.creado_en;
  const tipoPago = String(credito.tipo_pago || 'mensual').toLowerCase();
  
  let montoDisponible = amortizado;
  let arrastreSiguiente = 0;
  const cuotas = [];

  for (let i = 0; i < totalCuotas; i++) {
    const numCuota = i + 1;
    
    let fechaCuota = '';
    if (fPrimera) {
      const fStr = getFechaLocal(fPrimera);
      if (fStr) {
        const [yS, mS, dS] = fStr.split('-');
        const y = parseInt(yS, 10);
        const m = parseInt(mS, 10);
        const d = parseInt(dS, 10);
        const dt = new Date(y, m - 1, d);
        if (tipoPago === 'quincenal') {
          dt.setDate(dt.getDate() + 15 * i);
          fechaCuota = getFechaLocal(dt);
        } else if (tipoPago === 'semanal') {
          dt.setDate(dt.getDate() + 7 * i);
          fechaCuota = getFechaLocal(dt);
        } else if (tipoPago === 'diario') {
          dt.setDate(dt.getDate() + i);
          fechaCuota = getFechaLocal(dt);
        } else {
          // Fin de mes sucesivo
          const finMes = new Date(y, m + i, 0);
          fechaCuota = getFechaLocal(finMes);
          if (!fechaCuota) fechaCuota = getFechaLocal(dt);
        }
      }
    }

    const valorBase = valorCuotaBase;
    const montoArrastrado = arrastreSiguiente;
    arrastreSiguiente = 0; // Se incorpora en esta cuota
    const valorExigible = valorBase + montoArrastrado;

    let valorPagado = 0;
    let saldoCuota = 0;
    let pagada = false;
    let esParcial = false;
    let estado = 'pendiente';

    if (montoDisponible >= valorExigible) {
      valorPagado = valorExigible;
      montoDisponible -= valorExigible;
      saldoCuota = 0;
      pagada = true;
      esParcial = false;
      estado = 'pagada';
    } else if (montoDisponible > 0) {
      valorPagado = montoDisponible;
      saldoCuota = valorExigible - montoDisponible;
      if (i + 1 < totalCuotas) {
        arrastreSiguiente = saldoCuota;
      }
      montoDisponible = 0;
      pagada = false;
      esParcial = true;
      estado = 'parcial';
    } else {
      valorPagado = 0;
      saldoCuota = valorExigible;
      pagada = false;
      esParcial = false;
      estado = 'pendiente';
    }

    cuotas.push({
      numero: numCuota,
      monto: valorExigible,
      valor_base: valorBase,
      valor_exigible: valorExigible,
      valor_pagado: valorPagado,
      saldo_cuota: saldoCuota,
      monto_arrastrado: montoArrastrado,
      fecha: fechaCuota,
      pagada,
      es_parcial: esParcial,
      estado,
    });
  }
  return cuotas;
};

// Contar cuotas vencidas en un crédito
const contarCuotasVencidas = (credito) => {
  if (!credito) return 0;
  if (typeof credito.cuotas_vencidas_count === 'number') {
    return credito.cuotas_vencidas_count;
  }
  const cuotas = obtenerCuotasConChulos(credito);
  return cuotas.filter((q) => q.estado === 'vencida').length;
};

// Determina si un contrato está en Cartera Crítica (>= 3 cuotas vencidas y plazo total > 2)
const esCreditoCarteraCritica = (credito) => {
  if (!credito) return false;
  const saldo = Number(credito.saldo_pendiente || 0);
  if (saldo <= 0) return false;

  const totalCuotas = Number(credito.numero_cuotas || credito.cuotas || 0);
  // Exclusión estricta de créditos con plazo total de 2 cuotas
  if (totalCuotas === 2) return false;

  if (credito.es_cartera_critica !== undefined && credito.es_cartera_critica !== null) {
    return Boolean(credito.es_cartera_critica);
  }

  const vencidas = contarCuotasVencidas(credito);
  return totalCuotas > 2 && vencidas >= 3;
};

// Formateador de hora exacta para auditoría de recaudo
const formatHoraExacta = (fechaIso) => {
  if (!fechaIso) return '--:--';
  try {
    const d = new Date(fechaIso);
    if (isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch {
    return '--:--';
  }
};

// Sanitiza texto plano para comandos PDF (evita romper literales de texto PDF)
function sanitizarTextoPdf(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

// Generador de Comprobante Oficial PDF en memoria (Arquitectura Offline-First / Blob de Navegador)
function generarPdfReciboAbonoOfflineBlob(recibo, cobradorNombre) {
  if (!recibo) throw new Error('No hay datos de recibo para generar PDF.');

  const isParcial = Boolean(recibo.es_abono_parcial);
  const titulo = isParcial ? 'COMPROBANTE DE ABONO PARCIAL' : 'COMPROBANTE DE PAGO TOTAL DE CUOTA';
  const idRecibo = sanitizarTextoPdf(recibo.id_recibo || 'ABONO-OFF');
  const contrato = sanitizarTextoPdf(recibo.numero_contrato || 'CTR-RUTA');
  const cliente = sanitizarTextoPdf(recibo.cliente || 'Cliente');
  const cedula = sanitizarTextoPdf(recibo.cliente_cedula || 'No registrada');
  const telefono = sanitizarTextoPdf(recibo.cliente_telefono || 'No registrado');
  const cobrador = sanitizarTextoPdf(cobradorNombre || recibo.cobrador_nombre || recibo.cobrador || 'Pedro Cobrador');
  const fecha = sanitizarTextoPdf(recibo.fecha_completa || new Date().toISOString().slice(0, 10));
  const hora = sanitizarTextoPdf(recibo.fecha || '');
  const metodo = sanitizarTextoPdf((recibo.metodo_pago || 'efectivo').toUpperCase());
  const valorFmt = sanitizarTextoPdf('$' + Math.round(Number(recibo.valor || 0)).toLocaleString('es-CO'));
  const saldoFmt = sanitizarTextoPdf('$' + Math.round(Number(recibo.nuevoSaldo || 0)).toLocaleString('es-CO'));
  const insolutoFmt = sanitizarTextoPdf('$' + Math.round(Number(recibo.saldo_insoluto || 0)).toLocaleString('es-CO'));
  const cuotaSigFmt = sanitizarTextoPdf('$' + Math.round(Number(recibo.valor_cuota_siguiente || 0)).toLocaleString('es-CO'));
  const cuotaTxt = sanitizarTextoPdf(recibo.cuota_texto || ('Cuota ' + (recibo.cuota_numero || 1)));
  const gpsLat = Number(recibo.gps?.latitud || 8.756412).toFixed(6);
  const gpsLon = Number(recibo.gps?.longitud || -75.884129).toFixed(6);

  let stream = '';

  // Barra de cabecera principal (Azul Marino Corporativo)
  stream += '0.08 0.13 0.24 rg\n';
  stream += '36 700 540 56 re f\n';

  // Título Empresa
  stream += 'BT\n';
  stream += '/F2 18 Tf\n';
  stream += '1 1 1 rg\n';
  stream += '48 732 Td\n';
  stream += '(REMUNDIAL ARTE\'S) Tj\n';
  stream += 'ET\n';

  // Subtítulo
  stream += 'BT\n';
  stream += '/F1 9 Tf\n';
  stream += '0.8 0.85 0.95 rg\n';
  stream += '48 714 Td\n';
  stream += '(Muebles, Electrodomesticos y Credito Directo - NIT 901.452.889-1) Tj\n';
  stream += 'ET\n';

  // Banner de Contingencia Local Offline
  stream += '0.98 0.95 0.88 rg\n';
  stream += '36 666 540 26 re f\n';
  stream += '0.7 0.5 0.1 RG\n';
  stream += '1 w\n';
  stream += '36 666 540 26 re S\n';

  stream += 'BT\n';
  stream += '/F2 9 Tf\n';
  stream += '0.6 0.35 0.05 rg\n';
  stream += '48 676 Td\n';
  stream += '([COMPROBANTE LOCAL EN COLA OFFLINE - PENDIENTE DE SINCRONIZACION CON SERVIDOR]) Tj\n';
  stream += 'ET\n';

  // Título del Recibo
  stream += 'BT\n';
  stream += '/F2 13 Tf\n';
  stream += '0.1 0.15 0.25 rg\n';
  stream += '36 638 Td\n';
  stream += '(' + titulo + ') Tj\n';
  stream += 'ET\n';

  // Caja de Metadatos (Panel con Borde)
  stream += '0.96 0.97 0.98 rg\n';
  stream += '36 540 540 86 re f\n';
  stream += '0.85 0.88 0.92 RG\n';
  stream += '1 w\n';
  stream += '36 540 540 86 re S\n';

  // Columna 1
  stream += 'BT\n';
  stream += '/F2 9 Tf\n';
  stream += '0.3 0.35 0.4 rg\n';
  stream += '48 608 Td\n';
  stream += '(No. RECIBO LOCAL: ) Tj\n';
  stream += '/F2 10 Tf\n';
  stream += '0.08 0.13 0.24 rg\n';
  stream += '(' + idRecibo + ') Tj\n';
  stream += 'ET\n';

  stream += 'BT\n';
  stream += '/F2 9 Tf\n';
  stream += '0.3 0.35 0.4 rg\n';
  stream += '48 590 Td\n';
  stream += '(CONTRATO REF: ) Tj\n';
  stream += '/F2 10 Tf\n';
  stream += '0.08 0.13 0.24 rg\n';
  stream += '(' + contrato + ') Tj\n';
  stream += 'ET\n';

  stream += 'BT\n';
  stream += '/F1 9 Tf\n';
  stream += '0.3 0.35 0.4 rg\n';
  stream += '48 572 Td\n';
  stream += '(FECHA Y HORA: ' + fecha + ' ' + hora + ') Tj\n';
  stream += 'ET\n';

  stream += 'BT\n';
  stream += '/F1 9 Tf\n';
  stream += '0.3 0.35 0.4 rg\n';
  stream += '48 554 Td\n';
  stream += '(ESTADO CONTABLE: REGISTRADO LOCALMENTE / EN RUTA) Tj\n';
  stream += 'ET\n';

  // Columna 2
  stream += 'BT\n';
  stream += '/F2 9 Tf\n';
  stream += '0.3 0.35 0.4 rg\n';
  stream += '330 608 Td\n';
  stream += '(COBRADOR EN RUTA: ) Tj\n';
  stream += '/F1 9 Tf\n';
  stream += '0.1 0.15 0.25 rg\n';
  stream += '(' + cobrador + ') Tj\n';
  stream += 'ET\n';

  stream += 'BT\n';
  stream += '/F1 9 Tf\n';
  stream += '0.3 0.35 0.4 rg\n';
  stream += '330 590 Td\n';
  stream += '(UBICACION GPS: Lat ' + gpsLat + ', Lon ' + gpsLon + ') Tj\n';
  stream += 'ET\n';

  stream += 'BT\n';
  stream += '/F1 9 Tf\n';
  stream += '0.3 0.35 0.4 rg\n';
  stream += '330 572 Td\n';
  stream += '(METODO DE PAGO: ' + metodo + ') Tj\n';
  stream += 'ET\n';

  // SECCIÓN TITULAR DEL CRÉDITO
  stream += '0.92 0.94 0.97 rg\n';
  stream += '36 505 540 22 re f\n';
  stream += 'BT\n';
  stream += '/F2 10 Tf\n';
  stream += '0.08 0.13 0.24 rg\n';
  stream += '48 512 Td\n';
  stream += '(DATOS DEL TITULAR DEL CREDITO) Tj\n';
  stream += 'ET\n';

  stream += '0.98 0.98 0.99 rg\n';
  stream += '36 450 540 55 re f\n';
  stream += '0.88 0.9 0.93 RG\n';
  stream += '1 w\n';
  stream += '36 450 540 55 re S\n';

  stream += 'BT\n';
  stream += '/F2 9 Tf\n';
  stream += '0.2 0.25 0.3 rg\n';
  stream += '48 488 Td\n';
  stream += '(Cliente: ) Tj\n';
  stream += '/F1 10 Tf\n';
  stream += '0.05 0.1 0.2 rg\n';
  stream += '(' + cliente + ') Tj\n';
  stream += 'ET\n';

  stream += 'BT\n';
  stream += '/F2 9 Tf\n';
  stream += '0.2 0.25 0.3 rg\n';
  stream += '48 466 Td\n';
  stream += '(Documento C.C.: ) Tj\n';
  stream += '/F1 9 Tf\n';
  stream += '0.05 0.1 0.2 rg\n';
  stream += '(' + cedula + ') Tj\n';
  stream += 'ET\n';

  stream += 'BT\n';
  stream += '/F2 9 Tf\n';
  stream += '0.2 0.25 0.3 rg\n';
  stream += '330 466 Td\n';
  stream += '(Telefono: ) Tj\n';
  stream += '/F1 9 Tf\n';
  stream += '0.05 0.1 0.2 rg\n';
  stream += '(' + telefono + ') Tj\n';
  stream += 'ET\n';

  // SECCIÓN DETALLE ECONÓMICO
  stream += '0.92 0.94 0.97 rg\n';
  stream += '36 415 540 22 re f\n';
  stream += 'BT\n';
  stream += '/F2 10 Tf\n';
  stream += '0.08 0.13 0.24 rg\n';
  stream += '48 422 Td\n';
  stream += '(DETALLE ECONOMICO DEL RECAUDO) Tj\n';
  stream += 'ET\n';

  stream += '1 1 1 rg\n';
  stream += '36 260 540 155 re f\n';
  stream += '0.85 0.88 0.92 RG\n';
  stream += '1 w\n';
  stream += '36 260 540 155 re S\n';

  // Fila 1: Concepto de Cuota
  stream += 'BT\n';
  stream += '/F1 10 Tf\n';
  stream += '0.2 0.25 0.3 rg\n';
  stream += '48 392 Td\n';
  stream += '(Concepto de Cuota:) Tj\n';
  stream += 'ET\n';
  stream += 'BT\n';
  stream += '/F2 10 Tf\n';
  stream += '0.08 0.13 0.24 rg\n';
  stream += '350 392 Td\n';
  stream += '(' + cuotaTxt + ') Tj\n';
  stream += 'ET\n';

  stream += '0.88 0.9 0.93 RG\n';
  stream += '48 382 516 0.5 re f\n';

  // Fila 2: Monto Abonado
  stream += '0.92 0.98 0.94 rg\n';
  stream += '48 348 516 28 re f\n';
  stream += 'BT\n';
  stream += '/F2 11 Tf\n';
  stream += '0.05 0.45 0.2 rg\n';
  stream += '56 358 Td\n';
  stream += '(VALOR RECIBIDO / ABONADO:) Tj\n';
  stream += 'ET\n';
  stream += 'BT\n';
  stream += '/F2 14 Tf\n';
  stream += '0.05 0.5 0.2 rg\n';
  stream += '350 358 Td\n';
  stream += '(' + valorFmt + ') Tj\n';
  stream += 'ET\n';

  // Fila 3: Saldo Insoluto si es parcial
  if (isParcial) {
    stream += '0.99 0.96 0.92 rg\n';
    stream += '48 316 516 26 re f\n';
    stream += 'BT\n';
    stream += '/F2 10 Tf\n';
    stream += '0.7 0.3 0.05 rg\n';
    stream += '56 324 Td\n';
    stream += '(SALDO INSOLUTO (DEFICIT DE CUOTA):) Tj\n';
    stream += 'ET\n';
    stream += 'BT\n';
    stream += '/F2 11 Tf\n';
    stream += '0.7 0.3 0.05 rg\n';
    stream += '350 324 Td\n';
    stream += '(' + insolutoFmt + ') Tj\n';
    stream += 'ET\n';

    stream += 'BT\n';
    stream += '/F1 9.5 Tf\n';
    stream += '0.3 0.35 0.4 rg\n';
    stream += '48 296 Td\n';
    stream += '(Exigibilidad proyectada cuota siguiente (con arrastre):) Tj\n';
    stream += 'ET\n';
    stream += 'BT\n';
    stream += '/F2 10 Tf\n';
    stream += '0.1 0.15 0.25 rg\n';
    stream += '350 296 Td\n';
    stream += '(' + cuotaSigFmt + ') Tj\n';
    stream += 'ET\n';
  }

  // Fila 4: Nuevo Saldo Restante
  stream += '0.88 0.9 0.93 RG\n';
  stream += '48 288 516 0.5 re f\n';

  stream += 'BT\n';
  stream += '/F2 10 Tf\n';
  stream += '0.15 0.2 0.3 rg\n';
  stream += '48 270 Td\n';
  stream += '(NUEVO SALDO PENDIENTE DEL CREDITO:) Tj\n';
  stream += 'ET\n';
  stream += 'BT\n';
  stream += '/F2 12 Tf\n';
  stream += '0.08 0.13 0.24 rg\n';
  stream += '350 270 Td\n';
  stream += '(' + saldoFmt + ') Tj\n';
  stream += 'ET\n';

  // PIE DE PÁGINA AUDITABLE Y LEGAL
  stream += '0.97 0.98 0.99 rg\n';
  stream += '36 170 540 75 re f\n';
  stream += '0.88 0.9 0.93 RG\n';
  stream += '1 w\n';
  stream += '36 170 540 75 re S\n';

  stream += 'BT\n';
  stream += '/F2 8.5 Tf\n';
  stream += '0.2 0.25 0.35 rg\n';
  stream += '48 228 Td\n';
  stream += '(VALIDEZ Y CLAUSULA DE SEGURIDAD OPERATIVA OFFLINE:) Tj\n';
  stream += 'ET\n';

  stream += 'BT\n';
  stream += '/F1 7.5 Tf\n';
  stream += '0.35 0.4 0.45 rg\n';
  stream += '48 214 Td\n';
  stream += '(Este comprobante ha sido generado localmente en el dispositivo movil del cobrador autorizado bajo contingencia) Tj\n';
  stream += 'ET\n';

  stream += 'BT\n';
  stream += '/F1 7.5 Tf\n';
  stream += '0.35 0.4 0.45 rg\n';
  stream += '48 202 Td\n';
  stream += '(offline. La transaccion se encuentra en cola criptografica local y sera sincronizada de manera automatica tan pronto) Tj\n';
  stream += 'ET\n';

  stream += 'BT\n';
  stream += '/F1 7.5 Tf\n';
  stream += '0.35 0.4 0.45 rg\n';
  stream += '48 190 Td\n';
  stream += '(se restablezca el enlace de datos con el servidor central de Remundial Arte\'s, garantizando su conciliacion formal.) Tj\n';
  stream += 'ET\n';

  stream += 'BT\n';
  stream += '/F1 7.5 Tf\n';
  stream += '0.35 0.4 0.45 rg\n';
  stream += '48 178 Td\n';
  stream += '(Para verificar o solicitar copia oficial digital contacte a Atencion al Cliente Remundial Arte\'s en Monteria, Cordoba.) Tj\n';
  stream += 'ET\n';

  // Firmas
  stream += '0.7 0.75 0.8 RG\n';
  stream += '1 w\n';
  stream += '60 110 200 0.5 re f\n';
  stream += '350 110 200 0.5 re f\n';

  // Si existe firma capturada en memoria, certificar conformidad digital sobre la línea
  if (recibo.firma_cliente) {
    stream += 'BT\n';
    stream += '/F2 8 Tf\n';
    stream += '0.05 0.5 0.2 rg\n';
    stream += '65 116 Td\n';
    stream += '([FIRMA DIGITAL DEL CLIENTE VALIDADA]) Tj\n';
    stream += 'ET\n';
  }

  if (recibo.firma_cobrador) {
    stream += 'BT\n';
    stream += '/F2 8 Tf\n';
    stream += '0.05 0.5 0.2 rg\n';
    stream += '355 116 Td\n';
    stream += '([FIRMA DIGITAL COBRADOR EN RUTA]) Tj\n';
    stream += 'ET\n';
  }

  stream += 'BT\n';
  stream += '/F2 8.5 Tf\n';
  stream += '0.2 0.25 0.3 rg\n';
  stream += '85 96 Td\n';
  stream += '(FIRMA / CONFORMIDAD CLIENTE) Tj\n';
  stream += 'ET\n';
  stream += 'BT\n';
  stream += '/F1 7.5 Tf\n';
  stream += '0.4 0.45 0.5 rg\n';
  stream += '80 84 Td\n';
  stream += '(C.C. ' + cedula + ') Tj\n';
  stream += 'ET\n';

  stream += 'BT\n';
  stream += '/F2 8.5 Tf\n';
  stream += '0.2 0.25 0.3 rg\n';
  stream += '380 96 Td\n';
  stream += '(COBRADOR AUTORIZADO EN RUTA) Tj\n';
  stream += 'ET\n';
  stream += 'BT\n';
  stream += '/F1 7.5 Tf\n';
  stream += '0.4 0.45 0.5 rg\n';
  stream += '385 84 Td\n';
  stream += '(' + cobrador + ') Tj\n';
  stream += 'ET\n';

  // Paginación
  stream += 'BT\n';
  stream += '/F1 7 Tf\n';
  stream += '0.5 0.55 0.6 rg\n';
  stream += '210 45 Td\n';
  stream += '(Remundial Arte\'s - Sistema ERP de Gestion y Cartera - Pagina 1 de 1) Tj\n';
  stream += 'ET\n';

  const encoder = typeof TextEncoder !== 'undefined'
    ? new TextEncoder()
    : { encode: (s) => new Uint8Array(unescape(encodeURIComponent(s)).split('').map((c) => c.charCodeAt(0))) };

  const streamBytes = encoder.encode(stream);
  const streamLen = streamBytes.length;

  const header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  const obj3 = '3 0 obj\n<<\n  /Type /Page\n  /Parent 2 0 R\n  /MediaBox [0 0 612 792]\n  /Resources <<\n    /Font <<\n      /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\n      /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\n    >>\n  >>\n  /Contents 4 0 R\n>>\nendobj\n';
  const obj4Header = '4 0 obj\n<< /Length ' + streamLen + ' >>\nstream\n';
  const obj4Footer = '\nendstream\nendobj\n';

  const hBytes = encoder.encode(header);
  const o1Bytes = encoder.encode(obj1);
  const o2Bytes = encoder.encode(obj2);
  const o3Bytes = encoder.encode(obj3);
  const o4HBytes = encoder.encode(obj4Header);
  const o4FBytes = encoder.encode(obj4Footer);

  const offset1 = hBytes.length;
  const offset2 = offset1 + o1Bytes.length;
  const offset3 = offset2 + o2Bytes.length;
  const offset4 = offset3 + o3Bytes.length;
  const offsetEnd4 = offset4 + o4HBytes.length + streamBytes.length + o4FBytes.length;

  const pad10 = (n) => String(n).padStart(10, '0');
  const xref = 'xref\n0 5\n0000000000 65535 f \n' +
    pad10(offset1) + ' 00000 n \n' +
    pad10(offset2) + ' 00000 n \n' +
    pad10(offset3) + ' 00000 n \n' +
    pad10(offset4) + ' 00000 n \n';

  const trailer = 'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n' + offsetEnd4 + '\n%%EOF\n';
  const xrefBytes = encoder.encode(xref);
  const trailerBytes = encoder.encode(trailer);

  return new Blob([
    hBytes,
    o1Bytes,
    o2Bytes,
    o3Bytes,
    o4HBytes,
    streamBytes,
    o4FBytes,
    xrefBytes,
    trailerBytes,
  ], { type: 'application/pdf' });
}

export default function CobradorDashboard({ navigation }) {
  const { user, token: authToken, logout } = useAuth();
  const { encolarAbono, obtenerAbonosLocalesPendientes, pendingCount } = useSync();

  // Control de Pestañas Principales: 'recaudos' (Mis Recaudos del Día) | 'ruta' (Hoja de Ruta)
  const [activeTab, setActiveTab] = useState('recaudos');

  // Estados de Cartera y Ruta
  const [creditos, setCreditos] = useState([]);
  const [isLoadingCreditos, setIsLoadingCreditos] = useState(false);
  const [filtroBusquedaRuta, setFiltroBusquedaRuta] = useState('');

  // Estados de Historial de Recaudos
  const [recaudos, setRecaudos] = useState([]);
  const [isLoadingRecaudos, setIsLoadingRecaudos] = useState(false);
  const [filtroConciliacion, setFiltroConciliacion] = useState('todos'); // 'todos' | 'pendiente' | 'conciliado'
  const [filtroBusquedaRecaudos, setFiltroBusquedaRecaudos] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Estados de Proyección y Próximos Vencimientos
  const [creditosProyeccion, setCreditosProyeccion] = useState([]);
  const [isLoadingProyeccion, setIsLoadingProyeccion] = useState(false);
  const [filtroPeriodoProyeccion, setFiltroPeriodoProyeccion] = useState('todos'); // 'manana' | 'semana' | 'mes' | 'todos'
  const [busquedaProyeccion, setBusquedaProyeccion] = useState('');

  // Estados del Modal de Abono
  const [modalAbonoVisible, setModalAbonoVisible] = useState(false);
  const [creditoSeleccionado, setCreditoSeleccionado] = useState(null);
  const [montoAbono, setMontoAbono] = useState('');
  const [gpsCoords, setGpsCoords] = useState(null);
  const [isCapturingGps, setIsCapturingGps] = useState(false);
  const [gpsStatusText, setGpsStatusText] = useState('Esperando captura satelital...');
  const [isSubmittingAbono, setIsSubmittingAbono] = useState(false);
  const isSubmittingAbonoRef = useRef(false);
  const [firmaCliente, setFirmaCliente] = useState(null);
  const [firmaCobrador, setFirmaCobrador] = useState(null);

  // Estados del Modal de Comprobante / Recibo
  const [reciboExitoso, setReciboExitoso] = useState(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  // Estados del Modal de Orden de Retiro por Mora Crítica
  const [modalRetiroVisible, setModalRetiroVisible] = useState(false);
  const [creditoRetiro, setCreditoRetiro] = useState(null);
  const [motivoRetiro, setMotivoRetiro] = useState('Incumplimiento de pago con 3 o más cuotas en mora vencidas');
  const [observacionesRetiro, setObservacionesRetiro] = useState('');
  const [firmaClienteRetiro, setFirmaClienteRetiro] = useState(null);
  const [firmaCobradorRetiro, setFirmaCobradorRetiro] = useState(null);
  const [isSubmittingRetiro, setIsSubmittingRetiro] = useState(false);
  const isSubmittingRetiroRef = useRef(false);
  const [actaGenerada, setActaGenerada] = useState(null);
  const [modalActaExitosaVisible, setModalActaExitosaVisible] = useState(false);

  // Estado del Modal de Confirmación de Cierre de Sesión
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // ==========================================
  // GESTIÓN DE SALUD Y CONEXIÓN A INTERNET
  // ==========================================
  const [isOnline, setIsOnline] = useState(true);

  // ==========================================
  // ESTADOS Y GESTIÓN DE GARANTÍAS Y RESPALDO
  // ==========================================
  const [modalGarantiasVisible, setModalGarantiasVisible] = useState(false);
  const [creditoGarantias, setCreditoGarantias] = useState(null);
  const [isLoadingGarantias, setIsLoadingGarantias] = useState(false);

  const hacerLlamada = (tel) => {
    if (!tel) {
      Alert.alert('Sin Teléfono', 'No hay un número registrado para realizar la llamada.');
      return;
    }
    const clean = String(tel).replace(/\D/g, '');
    Linking.openURL(`tel:${clean}`).catch((err) => {
      console.warn('Error al iniciar llamada:', err);
      Alert.alert('Error', 'No se pudo abrir la aplicación de llamadas.');
    });
  };

  const abrirWhatsApp = (tel, nombre, rol) => {
    if (!tel) {
      Alert.alert('Sin WhatsApp', 'No hay un número telefónico registrado para WhatsApp.');
      return;
    }
    let clean = String(tel).replace(/\D/g, '');
    if (clean.length === 10 && !clean.startsWith('57')) {
      clean = '57' + clean;
    }
    const texto = encodeURIComponent(
      `Hola ${nombre || ''}, te contacto de Remundial referente al cobro del contrato respaldado (${rol || 'Garantía'}).`
    );
    Linking.openURL(`https://wa.me/${clean}?text=${texto}`).catch((err) => {
      console.warn('Error al abrir WhatsApp:', err);
      Alert.alert('Error', 'No se pudo abrir WhatsApp.');
    });
  };

  const abrirModalGarantias = async (item) => {
    setCreditoGarantias(item);
    setModalGarantiasVisible(true);

    const clienteId = item?.cliente_id || item?.cliente?.id;
    const tieneCodeudor = item?.codeudor && (item.codeudor.nombre || item.codeudor.telefono);
    const tieneRef = item?.referencia && (item.referencia.nombre || item.referencia.telefono);

    if (clienteId && (!tieneCodeudor || !tieneRef)) {
      try {
        setIsLoadingGarantias(true);
        const res = await apiClient.get(`/clientes/${clienteId}/garantias`);
        if (res?.data) {
          setCreditoGarantias((prev) => ({
            ...prev,
            codeudor: res.data.codeudor || prev?.codeudor,
            referencia: res.data.referencia_familiar || res.data.referencia || prev?.referencia,
          }));
        }
      } catch (err) {
        console.log('[CobradorDashboard] Garantías previas no encontradas en servidor:', err);
      } finally {
        setIsLoadingGarantias(false);
      }
    }
  };

  // ==========================================
  // GESTIÓN DE CIERRE DE SESIÓN SEGURO Y REDIRECCIÓN FORZOSA
  // ==========================================
  const handleConfirmLogout = async () => {
    try {
      setShowLogoutModal(false);
      // 1. Limpieza profunda y exhaustiva en AsyncStorage, localStorage/sessionStorage y Axios
      await limpiarCredencialesLocales();
      // 2. Destruir sesión en el contexto global (token = null desmonta el dashboard de inmediato)
      await logout();
      // 3. Redirección forzosa e inmediata a la pantalla de Login
      try {
        if (navigation?.reset) {
          navigation.reset({
            index: 0,
            routes: [{ name: 'Login' }],
          });
        } else if (navigation?.navigate) {
          navigation.navigate('Login');
        }
      } catch (_) {}
    } catch (error) {
      console.error('[CobradorDashboard] Error al destruir sesión en AsyncStorage:', error);
      await logout();
      try {
        if (navigation?.navigate) {
          navigation.navigate('Login');
        }
      } catch (_) {}
    }
  };

  // ==========================================
  // 1. CARGAR CARTERA ASIGNADA AL COBRADOR
  // ==========================================
  const cargarCreditosRuta = useCallback(async () => {
    try {
      setIsLoadingCreditos(true);
      const endpoint = user?.id
        ? `/creditos?cobrador_id=${user.id}&solo_exigibles=true`
        : '/creditos?solo_exigibles=true';

      const res = await apiClient.get(endpoint).catch(() => null);
      if (res && Array.isArray(res.data) && res.data.length > 0) {
        setCreditos(res.data);
        guardarEnCache(DB_STORAGE_KEYS.CACHE_CREDITOS, res.data);
      } else if (!res) {
        const cached = await obtenerDeCache(DB_STORAGE_KEYS.CACHE_CREDITOS);
        if (cached && Array.isArray(cached)) {
          setCreditos(cached);
        }
      }
    } catch (error) {
      console.warn('[CobradorDashboard] Error al consultar cartera:', error);
      const cached = await obtenerDeCache(DB_STORAGE_KEYS.CACHE_CREDITOS);
      if (cached && Array.isArray(cached)) {
        setCreditos(cached);
      }
    } finally {
      setIsLoadingCreditos(false);
    }
  }, [user?.id]);

  // ==========================================
  // 2. CARGAR HISTORIAL DE RECAUDOS DEL COBRADOR
  // ==========================================
  const cargarRecaudos = useCallback(async () => {
    try {
      setIsLoadingRecaudos(true);
      let recaudosServidor = [];

      // 1. Consultar backend FastAPI
      try {
        const res = await apiClient.get('/abonos');
        if (res && Array.isArray(res.data)) {
          recaudosServidor = res.data;
          guardarEnCache(DB_STORAGE_KEYS.CACHE_ABONOS, res.data);
        }
      } catch (apiErr) {
        console.warn('[CobradorDashboard] Error consultando /abonos al servidor, usando caché:', apiErr);
        const cached = await obtenerDeCache(DB_STORAGE_KEYS.CACHE_ABONOS);
        if (cached && Array.isArray(cached)) {
          recaudosServidor = cached;
        }
      }

      // 2. Consultar abonos locales pendientes de sincronización (Offline-First)
      let abonosLocales = [];
      try {
        const colaOffline = await obtenerAbonosLocalesPendientes();
        abonosLocales = (colaOffline || []).map((item) => {
          const p = item.payload || {};
          const meta = item.meta || {};
          return {
            id_recibo: item.id,
            es_offline: true,
            estado: 'registrado', // Pendiente de arqueo
            fecha: item.createdAt || meta.fecha || new Date().toISOString(),
            creado_en: item.createdAt || meta.fecha || new Date().toISOString(),
            valor_abonado: p.valor_abonado || meta.valor || 0,
            metodo_pago: p.metodo_pago || 'efectivo',
            numero_contrato: meta.numero_contrato || 'CTR-EN-RUTA',
            cliente_nombre: meta.cliente_nombre || 'Cliente en Terreno',
            cliente_cedula: meta.cliente_cedula || '',
            credito_id: p.credito_id || meta.credito_id,
            numero_cuota: p.numero_cuota || meta.numero_cuota,
            cuota_texto: meta.cuota_texto,
            total_cuotas: meta.total_cuotas,
            es_abono_parcial: Boolean(meta.es_abono_parcial),
            diferencia_arrastrada: meta.diferencia_arrastrada || 0,
            saldo_insoluto: meta.diferencia_arrastrada || 0,
            cuota_afectada_numero: meta.cuota_afectada_numero,
            valor_cuota_siguiente: meta.valor_cuota_siguiente,
            valor_cuota_exigible: meta.valor_cuota_exigible,
          };
        });
      } catch (queueErr) {
        console.warn('[CobradorDashboard] Error al consultar abonos en cola offline:', queueErr);
      }

      // Combinar primero locales (más inmediatos) y luego servidor
      setRecaudos([...abonosLocales, ...recaudosServidor]);
    } catch (error) {
      console.warn('[CobradorDashboard] Error general al cargar recaudos:', error);
    } finally {
      setIsLoadingRecaudos(false);
      setIsRefreshing(false);
    }
  }, [obtenerAbonosLocalesPendientes]);

  // ==========================================
  // 3. CARGAR CARTERA COMPLETA PARA PROYECCIÓN
  // ==========================================
  const cargarCreditosProyeccion = useCallback(async () => {
    try {
      setIsLoadingProyeccion(true);
      const endpoint = user?.id ? `/creditos?cobrador_id=${user.id}` : '/creditos';
      const res = await apiClient.get(endpoint).catch(() => null);
      if (res && Array.isArray(res.data) && res.data.length > 0) {
        setCreditosProyeccion(res.data);
        guardarEnCache('cache_creditos_proyeccion', res.data);
      } else {
        const cached = await obtenerDeCache('cache_creditos_proyeccion');
        if (cached && Array.isArray(cached)) {
          setCreditosProyeccion(cached);
        }
      }
    } catch (error) {
      console.warn('[CobradorDashboard] Error al consultar proyección:', error);
      const cached = await obtenerDeCache('cache_creditos_proyeccion');
      if (cached && Array.isArray(cached)) {
        setCreditosProyeccion(cached);
      }
    } finally {
      setIsLoadingProyeccion(false);
    }
  }, [user?.id]);

  // Carga inicial y reactiva
  useEffect(() => {
    cargarCreditosRuta();
    cargarRecaudos();
    cargarCreditosProyeccion();
  }, [cargarCreditosRuta, cargarRecaudos, cargarCreditosProyeccion, pendingCount]);

  const onRefresh = () => {
    setIsRefreshing(true);
    cargarCreditosRuta();
    cargarRecaudos();
    cargarCreditosProyeccion();
  };

  // ==========================================
  // FILTROS Y MÉTRICAS DE RECAUDOS (HOY)
  // ==========================================
  const todayStr = useMemo(() => getFechaLocal(new Date()), []);

  // Filtrar exclusivamente los recaudos realizados en la jornada de hoy
  const recaudosHoy = useMemo(() => {
    return recaudos.filter((r) => {
      const fecha = r.fecha || r.creado_en;
      if (!fecha) return true;
      const fStr = getFechaLocal(fecha);
      return fStr === todayStr;
    });
  }, [recaudos, todayStr]);

  // Consolidado Financiero de la Jornada
  const kpisRecaudos = useMemo(() => {
    let totalRecaudadoHoy = 0;
    let totalPendienteArqueo = 0;
    let totalConciliado = 0;
    let countPendiente = 0;
    let countConciliado = 0;

    recaudosHoy.forEach((r) => {
      const val = Number(r.valor_abonado || 0);
      totalRecaudadoHoy += val;
      const st = (r.estado || 'registrado').toLowerCase();
      if (st === 'conciliado') {
        totalConciliado += val;
        countConciliado += 1;
      } else {
        totalPendienteArqueo += val;
        countPendiente += 1;
      }
    });

    return {
      totalRecaudadoHoy,
      totalPendienteArqueo,
      totalConciliado,
      countPendiente,
      countConciliado,
      totalCount: recaudosHoy.length,
    };
  }, [recaudosHoy]);

  // Filtrado y ordenamiento cronológico de la lista de recaudos
  const recaudosFiltrados = useMemo(() => {
    return recaudosHoy.filter((r) => {
      const st = (r.estado || 'registrado').toLowerCase();
      if (filtroConciliacion === 'pendiente' && st === 'conciliado') return false;
      if (filtroConciliacion === 'conciliado' && st !== 'conciliado') return false;

      if (filtroBusquedaRecaudos.trim()) {
        const q = filtroBusquedaRecaudos.toLowerCase();
        const nom = (r.cliente_nombre || '').toLowerCase();
        const num = (r.numero_contrato || '').toLowerCase();
        const cc = (r.cliente_cedula || '').toLowerCase();
        return nom.includes(q) || num.includes(q) || cc.includes(q);
      }
      return true;
    });
  }, [recaudosHoy, filtroConciliacion, filtroBusquedaRecaudos]);

  const recaudosOrdenados = useMemo(() => {
    return [...recaudosFiltrados].sort((a, b) => {
      const dateA = new Date(a.fecha || a.creado_en || 0).getTime();
      const dateB = new Date(b.fecha || b.creado_en || 0).getTime();
      return dateB - dateA; // Cronológico descendente (más reciente primero)
    });
  }, [recaudosFiltrados]);

  // Set de identificadores de contratos cobrados en la jornada de hoy (para exclusión visual inmediata)
  const creditosCobradosHoySet = useMemo(() => {
    const set = new Set();
    recaudosHoy.forEach((r) => {
      if (r.credito_id) set.add(String(r.credito_id).toLowerCase());
      if (r.numero_contrato) set.add(String(r.numero_contrato).toLowerCase());
    });
    return set;
  }, [recaudosHoy]);

  // ==========================================
  // FILTRADO DE CARTERA EN RUTA (EXCLUSIÓN AUTOMÁTICA)
  // ==========================================
  const creditosFiltrados = useMemo(() => {
    const query = filtroBusquedaRuta.toLowerCase().trim();
    return creditos.filter((c) => {
      // 1. Excluir automáticamente contratos con saldo_pendiente <= 0
      const saldo = Number(c.saldo_pendiente ?? 0);
      if (saldo <= 0) {
        return false;
      }

      // 2. Excluir automáticamente contratos que ya tengan un abono registrado en la jornada de hoy
      const idContrato = String(c.id_contrato || c.id || '').toLowerCase();
      const numContrato = String(c.numero_contrato || '').toLowerCase();
      const yaCobradoHoy = Boolean(
        c.cobradoHoy ||
        (idContrato && creditosCobradosHoySet.has(idContrato)) ||
        (numContrato && creditosCobradosHoySet.has(numContrato))
      );
      if (yaCobradoHoy) {
        return false;
      }

      // 3. Filtro de Hoja de Ruta por Vencimiento: solo mostrar cuotas exigibles hoy o vencidas
      const fVencStr = calcularVencimientoCuota(c);
      if (fVencStr && todayStr && fVencStr > todayStr) {
        return false; // Cuota futura, no corresponde a la jornada de hoy
      }

      // 4. Filtrado por término de búsqueda (cliente, cédula, barrio, dirección o contrato)
      if (query) {
        const nombre = c.cliente?.nombres?.toLowerCase() || '';
        const cedula = c.cliente?.cedula?.toLowerCase() || '';
        const barrio = c.cliente?.barrio?.toLowerCase() || '';
        const direccion = c.cliente?.direccion?.toLowerCase() || '';
        const contrato = c.numero_contrato?.toLowerCase() || '';
        return (
          nombre.includes(query) ||
          cedula.includes(query) ||
          barrio.includes(query) ||
          direccion.includes(query) ||
          contrato.includes(query)
        );
      }
      return true;
    });
  }, [creditos, filtroBusquedaRuta, creditosCobradosHoySet, todayStr]);

  // ==========================================
  // AGRUPACIÓN CENTRADA EN EL CLIENTE (MULTICONTRATO UNIFICADO)
  // ==========================================
  const clientesAgrupados = useMemo(() => {
    const map = new Map();

    creditosFiltrados.forEach((item) => {
      const cliente = item.cliente || {};
      const cId = item.cliente_id || cliente.id;
      const cCedula = cliente.cedula ? String(cliente.cedula).trim() : '';
      const cNombre = cliente.nombres ? String(cliente.nombres).trim().toLowerCase() : '';

      // Clave única y consistente para agrupar contratos de un mismo titular
      const key = cId
        ? `id-${cId}`
        : (cCedula
          ? `cc-${cCedula}`
          : (cNombre
            ? `nom-${cNombre}`
            : `ctr-${item.id_contrato || item.id}`));

      if (!map.has(key)) {
        map.set(key, {
          clienteKey: key,
          cliente: { ...cliente },
          primerCredito: item,
          contratos: [],
          totalSaldo: 0,
        });
      }

      const grupo = map.get(key);
      // Enriquecer datos de contacto si algún contrato contiene datos más completos
      if (!grupo.cliente.telefono && cliente.telefono) grupo.cliente.telefono = cliente.telefono;
      if (!grupo.cliente.direccion && cliente.direccion) grupo.cliente.direccion = cliente.direccion;
      if (!grupo.cliente.barrio && cliente.barrio) grupo.cliente.barrio = cliente.barrio;
      if (!grupo.cliente.cedula && cliente.cedula) grupo.cliente.cedula = cliente.cedula;
      if (!grupo.cliente.nombres && cliente.nombres) grupo.cliente.nombres = cliente.nombres;

      grupo.contratos.push(item);
      grupo.totalSaldo += Number(item.saldo_pendiente || 0);
    });

    return Array.from(map.values());
  }, [creditosFiltrados]);

  // ==========================================
  // PROYECCIÓN DE CARTERA Y PRÓXIMOS VENCIMIENTOS
  // ==========================================
  const tomorrowStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return getFechaLocal(d);
  }, []);

  const nextWeekStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return getFechaLocal(d);
  }, []);

  const endOfMonthStr = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1, 0);
    return getFechaLocal(d);
  }, []);

  // Proyección enriquecida con fecha de próximo vencimiento y desglose de cuotas
  const creditosProyeccionEnriquecidos = useMemo(() => {
    return (creditosProyeccion || [])
      .filter((c) => Number(c.saldo_pendiente || 0) > 0)
      .map((c) => {
        const fVenc = calcularVencimientoCuota(c) || '';
        const cuotas = obtenerCuotasConChulos(c);
        const cuotaPendiente = cuotas.find((q) => !q.pagada);

        let diasParaVencer = 0;
        if (fVenc && todayStr) {
          const tVenc = new Date(fVenc + 'T00:00:00').getTime();
          const tToday = new Date(todayStr + 'T00:00:00').getTime();
          diasParaVencer = Math.round((tVenc - tToday) / (1000 * 60 * 60 * 24));
        }

        return {
          ...c,
          fechaVencimientoCalculada: fVenc,
          diasParaVencer,
          cuotasDesglose: cuotas,
          proximaCuota: cuotaPendiente || cuotas[0] || null,
        };
      });
  }, [creditosProyeccion, todayStr]);

  // Conteos y métricas de proyección por periodo
  const metricasProyeccion = useMemo(() => {
    let countManana = 0;
    let valorManana = 0;

    let countSemana = 0;
    let valorSemana = 0;

    let countMes = 0;
    let valorMes = 0;

    let countTotal = 0;
    let valorTotal = 0;

    creditosProyeccionEnriquecidos.forEach((item) => {
      const f = item.fechaVencimientoCalculada;
      const cuotaMonto = Number(item.valor_cuota || 0) || Number(item.proximaCuota?.monto || 0);

      countTotal += 1;
      valorTotal += cuotaMonto;

      if (f === tomorrowStr) {
        countManana += 1;
        valorManana += cuotaMonto;
      }
      if (f > todayStr && f <= nextWeekStr) {
        countSemana += 1;
        valorSemana += cuotaMonto;
      }
      if (f > todayStr && f <= endOfMonthStr) {
        countMes += 1;
        valorMes += cuotaMonto;
      }
    });

    return {
      countManana,
      valorManana,
      countSemana,
      valorSemana,
      countMes,
      valorMes,
      countTotal,
      valorTotal,
    };
  }, [creditosProyeccionEnriquecidos, tomorrowStr, todayStr, nextWeekStr, endOfMonthStr]);

  // Filtrado final de la lista de proyección según periodo y término de búsqueda
  const proyeccionFiltrada = useMemo(() => {
    const q = busquedaProyeccion.toLowerCase().trim();

    return creditosProyeccionEnriquecidos.filter((item) => {
      const f = item.fechaVencimientoCalculada;

      // Filtro de periodo
      if (filtroPeriodoProyeccion === 'manana' && f !== tomorrowStr) {
        return false;
      }
      if (filtroPeriodoProyeccion === 'semana' && !(f > todayStr && f <= nextWeekStr)) {
        return false;
      }
      if (filtroPeriodoProyeccion === 'mes' && !(f > todayStr && f <= endOfMonthStr)) {
        return false;
      }

      // Filtro de búsqueda
      if (q) {
        const clienteNom = (item.cliente?.nombres || '').toLowerCase();
        const cedula = (item.cliente?.cedula || '').toLowerCase();
        const barrio = (item.cliente?.barrio || '').toLowerCase();
        const contrato = (item.numero_contrato || '').toLowerCase();
        return (
          clienteNom.includes(q) ||
          cedula.includes(q) ||
          barrio.includes(q) ||
          contrato.includes(q)
        );
      }
      return true;
    }).sort((a, b) => {
      return (a.fechaVencimientoCalculada || '9999').localeCompare(b.fechaVencimientoCalculada || '9999');
    });
  }, [creditosProyeccionEnriquecidos, filtroPeriodoProyeccion, busquedaProyeccion, tomorrowStr, todayStr, nextWeekStr, endOfMonthStr]);

  // ==========================================
  // CAPTURA AUTOMÁTICA DE GEOLOCALIZACIÓN GPS
  // ==========================================
  const capturarUbicacionGps = async () => {
    try {
      setIsCapturingGps(true);
      setGpsStatusText('Conectando con satélites GPS...');

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setGpsStatusText('Permiso de GPS denegado. Se usará coordenada de referencia.');
        setGpsCoords({
          latitud: 8.750000,
          longitud: -75.880000,
          precision: 0,
        });
        setIsCapturingGps(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
        timeout: 10000,
      });

      const coords = {
        latitud: Number(location.coords.latitude.toFixed(6)),
        longitud: Number(location.coords.longitude.toFixed(6)),
        precision: Number(location.coords.accuracy?.toFixed(1) || 5),
      };

      setGpsCoords(coords);
      setGpsStatusText(`GPS verificado (±${coords.precision}m)`);
    } catch (error) {
      console.warn('[CobradorDashboard] Error capturando GPS:', error);
      setGpsCoords({
        latitud: 8.756412,
        longitud: -75.884129,
        precision: 10,
      });
      setGpsStatusText('Ubicación capturada por triangulación');
    } finally {
      setIsCapturingGps(false);
    }
  };

  // ==========================================
  // GESTIÓN DE ORDEN DE RETIRO POR MORA CRÍTICA
  // ==========================================
  const abrirModalRetiro = (credito) => {
    isSubmittingRetiroRef.current = false;
    setIsSubmittingRetiro(false);
    setCreditoRetiro(credito);
    const cuotasVencidas = contarCuotasVencidas(credito);
    setMotivoRetiro(
      `Incumplimiento grave de pago con acumulación de ${cuotasVencidas} cuotas morosas vencidas (Causal de restitución prendaria).`
    );
    setObservacionesRetiro('Bienes muebles entregados para custodia y amortización del saldo deudor.');
    setFirmaClienteRetiro(null);
    setFirmaCobradorRetiro(null);
    setModalRetiroVisible(true);
    capturarUbicacionGps();
  };

  const handleConfirmarOrdenRetiro = async () => {
    if (isSubmittingRetiroRef.current || isSubmittingRetiro) {
      return;
    }

    if (!creditoRetiro) return;

    if (!firmaClienteRetiro) {
      Alert.alert(
        'Firma del Cliente Requerida',
        'Debe capturar la firma manuscrita de entrega y conformidad del cliente titular en el recuadro digital.'
      );
      return;
    }

    if (!firmaCobradorRetiro) {
      Alert.alert(
        'Firma del Cobrador Requerida',
        'Debe estampar su firma digital como gestor de cobro en ruta para certificar la custodia de los bienes.'
      );
      return;
    }

    isSubmittingRetiroRef.current = true;
    setIsSubmittingRetiro(true);

    try {
      const targetId = creditoRetiro.id_contrato || creditoRetiro.id;
      let cobradorNombre =
        user?.nombre ||
        user?.nombre_completo ||
        user?.nombres ||
        user?.usuario ||
        null;

      if (!cobradorNombre) {
        try {
          const storedUserRaw = await AsyncStorage.getItem(STORAGE_KEYS.USER);
          if (storedUserRaw) {
            const u = JSON.parse(storedUserRaw);
            cobradorNombre = u?.nombre || u?.nombre_completo || u?.nombres || u?.usuario || null;
          }
        } catch (_) {}
      }

      if (!cobradorNombre || !String(cobradorNombre).trim()) {
        cobradorNombre = 'Gestor de Cobro Autorizado';
      }

      const payload = {
        motivo: motivoRetiro || 'Mora crítica mayor o igual a 3 cuotas',
        firma_cliente: firmaClienteRetiro,
        firma_cobrador: firmaCobradorRetiro,
        cobrador_nombre: cobradorNombre,
        observaciones: observacionesRetiro || 'Bienes recibidos en custodia oficial en diligencia presencial.',
        latitud: gpsCoords?.latitud || 8.756412,
        longitud: gpsCoords?.longitud || -75.884129,
      };

      const res = await apiClient.post(`/creditos/${targetId}/orden-retiro`, payload);

      setModalRetiroVisible(false);
      setActaGenerada({
        id_contrato: targetId,
        numero_contrato: creditoRetiro.numero_contrato || `CTR-${String(targetId).slice(0, 8).toUpperCase()}`,
        cliente_nombre: creditoRetiro.cliente?.nombres
          ? `${creditoRetiro.cliente.nombres} ${creditoRetiro.cliente.apellidos || ''}`.trim()
          : 'Cliente Titular',
        cliente_cedula: creditoRetiro.cliente?.documento_numero || creditoRetiro.cliente?.cedula || 'No registrada',
        cuotas_vencidas: res.data?.cuotas_vencidas || contarCuotasVencidas(creditoRetiro),
        saldo_pendiente: res.data?.saldo_pendiente || creditoRetiro.saldo_pendiente,
        fecha_acta: res.data?.fecha_acta || new Date().toISOString().slice(0, 19).replace('T', ' '),
        pdf_url: res.data?.pdf_url || `/creditos/${targetId}/acta-pdf`,
      });
      setModalActaExitosaVisible(true);

      // Refrescar cartera en segundo plano
      cargarCreditosRuta();
    } catch (error) {
      console.error('[CobradorDashboard] Error registrando orden de retiro:', error);
      const msg = error.response?.data?.detail || error.message || 'No se pudo generar la orden de retiro.';
      Alert.alert('Error al Generar Orden de Retiro', msg);
    } finally {
      setIsSubmittingRetiro(false);
      isSubmittingRetiroRef.current = false;
    }
  };

  const handleDescargarActaPdf = async () => {
    if (!actaGenerada?.id_contrato) return;
    try {
      const baseURL = apiClient.defaults.baseURL || 'http://localhost:8000';
      const rawToken =
        authToken ||
        (await AsyncStorage.getItem(STORAGE_KEYS.TOKEN)) ||
        (await AsyncStorage.getItem('@remundial_token')) ||
        (await AsyncStorage.getItem('token')) ||
        apiClient.defaults.headers.common?.['Authorization'] ||
        apiClient.defaults.headers?.['Authorization'];

      const tokenLimpio = rawToken ? String(rawToken).replace(/^Bearer\s+/i, '').trim() : '';
      const downloadUrl = `${baseURL}/creditos/${actaGenerada.id_contrato}/acta-pdf${tokenLimpio ? `?token=${encodeURIComponent(tokenLimpio)}` : ''}`;

      if (Platform.OS === 'web' || typeof window !== 'undefined') {
        // Método seguro directo mediante enlace virtual <a> y window.open para prevenir TypeError: Failed to fetch
        const filename = `Acta_Restitucion_${actaGenerada.numero_contrato || 'Contrato'}.pdf`;
        try {
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            try {
              document.body.removeChild(a);
            } catch (_) {}
          }, 150);
        } catch (_) {
          window.open(downloadUrl, '_blank');
        }
      } else {
        Linking.openURL(downloadUrl).catch(() => {
          Alert.alert('Descarga', 'No se pudo abrir el enlace del acta PDF.');
        });
      }
    } catch (err) {
      console.error('[CobradorDashboard] Error descargando acta PDF:', err);
      Alert.alert('Error', 'No se pudo descargar el archivo PDF del acta de restitución.');
    }
  };

  // ==========================================
  // ABRIR MODAL DE REGISTRO DE ABONO
  // ==========================================
  const abrirModalAbono = (credito) => {
    isSubmittingAbonoRef.current = false;
    setIsSubmittingAbono(false);
    setCreditoSeleccionado(credito);
    setFirmaCliente(null);
    setFirmaCobrador(null);
    const cuotas = obtenerCuotasConChulos(credito);
    const cuotaPendiente = cuotas.find((q) => !q.pagada);
    const cuotaSugerida = cuotaPendiente
      ? String(Math.round(cuotaPendiente.saldo_cuota || cuotaPendiente.valor_exigible || cuotaPendiente.monto || credito.valor_cuota || 0))
      : (credito.valor_cuota ? String(Math.round(credito.valor_cuota)) : '');
    setMontoAbono(cuotaSugerida);
    setGpsCoords(null);
    setModalAbonoVisible(true);
    capturarUbicacionGps();
  };

  // ==========================================
  // TRANSMITIR ABONO AL SERVIDOR FASTAPI
  // ==========================================
  const handleConfirmarAbono = async () => {
    console.log("👉 [DEBUG 1 - CLICK] Botón 'Confirmar y Registrar Pago' presionado.", {
      isSubmittingAbono,
      refSubmitting: isSubmittingAbonoRef.current,
      montoAbono,
      creditoSeleccionadoId: creditoSeleccionado?.id_contrato || creditoSeleccionado?.id,
      cliente: creditoSeleccionado?.cliente?.nombres,
    });

    // Bloqueo síncrono inmediato contra doble toque rápido (Anti-Desincronización)
    if (isSubmittingAbonoRef.current || isSubmittingAbono) {
      console.warn('❌ [DEBUG 1b - BLOQUEO] Intento de cobro ignorado por anti-doble clic:', {
        isSubmittingAbono,
        ref: isSubmittingAbonoRef.current,
      });
      return;
    }

    const valor = parseFloat(String(montoAbono).replace(/[^0-9.-]+/g, ''));
    console.log("👉 [DEBUG 2 - MONTO] Monto parseado:", { raw: montoAbono, valor });

    if (!valor || valor <= 0) {
      console.warn("❌ [DEBUG 2b - ERROR VALOR] Valor menor o igual a cero o inválido:", valor);
      Alert.alert('Valor inválido', 'Ingrese un valor de abono mayor a cero.');
      return;
    }

    if (!creditoSeleccionado) {
      console.warn("❌ [DEBUG 3 - ERROR CREDITO] creditoSeleccionado es nulo o indefinido");
      return;
    }

    console.log("👉 [DEBUG 3 - CONTRATO] Datos del contrato seleccionado:", {
      id_contrato: creditoSeleccionado.id_contrato,
      id: creditoSeleccionado.id,
      numero_contrato: creditoSeleccionado.numero_contrato,
      saldo_pendiente: creditoSeleccionado.saldo_pendiente,
      cliente: creditoSeleccionado.cliente?.nombres,
    });

    // Validación preventiva de crédito ya liquidado ($0)
    const saldoPendienteActual = Number(creditoSeleccionado.saldo_pendiente || 0);
    console.log("👉 [DEBUG 4 - SALDO] Saldo pendiente actual:", saldoPendienteActual, "Monto a abonar:", valor);

    if (saldoPendienteActual <= 0) {
      console.warn("❌ [DEBUG 4b - CREDITO LIQUIDADO] El crédito ya tiene saldo 0.");
      Alert.alert(
        'Crédito Liquidado',
        'Este crédito ya se encuentra completamente cancelado con saldo $0. No admite más recaudos.'
      );
      setModalAbonoVisible(false);
      return;
    }

    // Validación preventiva de valor mayor al saldo pendiente
    if (valor > saldoPendienteActual) {
      console.warn("❌ [DEBUG 4c - MONTO EXCEDE SALDO] Abono mayor que saldo pendiente:", { valor, saldoPendienteActual });
      Alert.alert(
        'Monto Excede Saldo',
        `El valor a abonar ($${valor.toLocaleString('es-CO')}) no puede superar el saldo pendiente ($${saldoPendienteActual.toLocaleString('es-CO')}).`
      );
      return;
    }

    // Validación preventiva obligatoria de la firma manuscrita del cliente titular
    if (!firmaCliente) {
      console.warn('❌ [DEBUG 4d - FIRMA REQUERIDA] No se ha capturado la firma del cliente titular.');
      Alert.alert(
        'Firma del Cliente Requerida',
        'Debe capturar la firma manuscrita de conformidad del cliente titular en el recuadro digital antes de confirmar el recaudo.'
      );
      return;
    }

    // Validación preventiva obligatoria de la firma manuscrita del cobrador autorizado
    if (!firmaCobrador) {
      console.warn('❌ [DEBUG 4e - FIRMA COBRADOR REQUERIDA] No se ha capturado la firma del cobrador autorizado.');
      Alert.alert(
        'Firma del Cobrador Requerida',
        'Debe estampar su firma digital como cobrador autorizado en el recuadro correspondiente para certificar el recaudo.'
      );
      return;
    }

    // Bloquear inmediatamente al primer toque
    isSubmittingAbonoRef.current = true;
    setIsSubmittingAbono(true);
    console.log("👉 [DEBUG 5 - BLOQUEO ACTIVADO] isSubmittingAbono establecido en true");

    try {
      const targetCreditoId = creditoSeleccionado.id_contrato || creditoSeleccionado.id;
      const targetContrato = creditoSeleccionado.numero_contrato || (targetCreditoId ? `CTR-${String(targetCreditoId).slice(0, 6).toUpperCase()}` : 'CTR-RUTA');
      const lat = gpsCoords?.latitud || 8.756412;
      const lon = gpsCoords?.longitud || -75.884129;

      // Si el usuario autenticado es cobrador, asignar estrictamente su ID para cumplir la regla RBAC del backend
      const targetCobradorId = (user?.rol?.toLowerCase() === 'cobrador' && user?.id)
        ? user.id
        : (creditoSeleccionado.cobrador_id || creditoSeleccionado.cobrador?.id || user?.id);

      let nombreCobradorReal =
        user?.nombre ||
        user?.nombre_completo ||
        user?.nombres ||
        user?.usuario ||
        null;

      if (!nombreCobradorReal) {
        try {
          const storedUserRaw = await AsyncStorage.getItem(STORAGE_KEYS.USER);
          if (storedUserRaw) {
            const u = JSON.parse(storedUserRaw);
            nombreCobradorReal = u?.nombre || u?.nombre_completo || u?.nombres || u?.usuario || null;
          }
        } catch (_) {}
      }

      if (!nombreCobradorReal || !String(nombreCobradorReal).trim()) {
        nombreCobradorReal = creditoSeleccionado?.cobrador?.nombre || 'Pedro Cobrador';
      } else {
        nombreCobradorReal = String(nombreCobradorReal).trim();
      }

      // Cálculo del ordinal de la cuota recaudada con soporte de abono parcial y saldo insoluto
      const cuotas = obtenerCuotasConChulos(creditoSeleccionado);
      const cuotaActualObj = cuotas.find((q) => !q.pagada) || cuotas[cuotas.length - 1];
      const cActual = cuotaActualObj?.numero || 1;
      const tCuotas = cuotas.length || 1;

      // Monto exigible de la cuota actual (incluye arrastre previo si venía de un déficit anterior)
      const valorCuotaExigible = Number(cuotaActualObj?.saldo_cuota || cuotaActualObj?.valor_exigible || creditoSeleccionado?.valor_cuota || valor);
      const esAbonoParcialCalc = valor < valorCuotaExigible;
      const saldoInsolutoCalc = esAbonoParcialCalc ? Math.max(0, valorCuotaExigible - valor) : 0;
      const cuotaAfectadaNumCalc = cActual;
      const cuotaSiguienteNumCalc = Math.min(tCuotas, cuotaAfectadaNumCalc + 1);
      const valorCuotaBaseSiguiente = Number(creditoSeleccionado?.valor_cuota || cuotaActualObj?.valor_base || valorCuotaExigible);
      const valorCuotaSiguienteCalc = esAbonoParcialCalc ? (valorCuotaBaseSiguiente + saldoInsolutoCalc) : valorCuotaBaseSiguiente;

      const cuotaTexto = esAbonoParcialCalc
        ? `Cuota ${cActual} de ${tCuotas} (Abono Parcial en Terreno)`
        : `Cuota ${cActual} de ${tCuotas} (Pago Total de Cuota)`;

      const payload = {
        credito_id: targetCreditoId,
        cobrador_id: targetCobradorId,
        valor_abonado: valor,
        numero_cuota: cActual,
        coordenadas_gps_cobro: {
          latitud: lat,
          longitud: lon,
        },
        metodo_pago: 'efectivo',
        notas: `Abono en ruta (${cuotaTexto}) - Cobrador ${nombreCobradorReal}`,
        firma_cliente: firmaCliente,
        firma_cobrador: firmaCobrador,
        cobrador_nombre: nombreCobradorReal,
      };

      // Metadatos para respaldo visual y persistencia offline
      const meta = {
        cliente_nombre: creditoSeleccionado.cliente?.nombres || 'Cliente en Ruta',
        cliente_cedula: creditoSeleccionado.cliente?.cedula || '',
        cliente_telefono: creditoSeleccionado.cliente?.telefono || '',
        numero_contrato: targetContrato,
        valor,
        credito_id: targetCreditoId,
        cobrador_id: targetCobradorId,
        cobrador_nombre: nombreCobradorReal,
        cobrador: nombreCobradorReal,
        saldo_pendiente: Math.max(0, saldoPendienteActual - valor),
        numero_cuota: cActual,
        total_cuotas: tCuotas,
        cuota_texto: cuotaTexto,
        es_abono_parcial: esAbonoParcialCalc,
        diferencia_arrastrada: saldoInsolutoCalc,
        saldo_insoluto: saldoInsolutoCalc,
        cuota_afectada_numero: cuotaAfectadaNumCalc,
        valor_cuota_siguiente: valorCuotaSiguienteCalc,
        valor_cuota_exigible: valorCuotaExigible,
        firma_cliente: firmaCliente,
        firma_cobrador: firmaCobrador,
        fecha: new Date().toISOString(),
      };

      console.log("👉 [DEBUG 6 - INVOCANDO encolarAbono] Enviando a SyncContext con payload:", payload, "y meta:", meta);
      const res = await encolarAbono(payload, meta);
      console.log("👉 [DEBUG 7 - RETORNO DE encolarAbono] Resultado obtenido:", res);

      // Si el servidor devolvió un rechazo de negocio o validación (ej. 400 saldo excedido, 422, etc.):
      if (!res || !res.ok) {
        console.warn("❌ [DEBUG 7b - RESPUESTA NO OK] encolarAbono falló:", res);
        setIsSubmittingAbono(false);
        isSubmittingAbonoRef.current = false;
        return;
      }

      // Saldo actualizado confirmado por servidor o calculado
      const nuevoSaldoConfirmado = res.data?.saldo_restante_credito != null
        ? Number(res.data.saldo_restante_credito)
        : (res.data?.saldo_restante != null ? Number(res.data.saldo_restante) : Math.max(0, saldoPendienteActual - valor));

      console.log("👉 [DEBUG 8 - ACTUALIZANDO HOJA DE RUTA] Nuevo saldo:", nuevoSaldoConfirmado);

      // Actualizar estado de créditos en ruta y persistir en caché local
      setCreditos((prevCreditos) => {
        const updated = prevCreditos.map((c) => {
          const currentId = c.id_contrato || c.id;
          if (currentId === targetCreditoId) {
            return {
              ...c,
              saldo_pendiente: nuevoSaldoConfirmado,
              cobradoHoy: true,
            };
          }
          return c;
        });
        guardarEnCache(DB_STORAGE_KEYS.CACHE_CREDITOS, updated);
        return updated;
      });

      console.log("👉 [DEBUG 9 - REFRESCANDO RECAUDOS] Invocando cargarRecaudos()");
      cargarRecaudos().catch((e) => console.warn('[CobradorDashboard] Error refrescando recaudos:', e));

      console.log("👉 [DEBUG 10 - CERRANDO MODAL] Cerrando modal de abono y abriendo comprobante de recibo");
      setModalAbonoVisible(false);

      // Consolidación de datos auditables y nomenclatura legible del comprobante PDF
      const esParcialFinal = res.data?.es_abono_parcial != null ? Boolean(res.data.es_abono_parcial) : esAbonoParcialCalc;
      const saldoInsolutoFinal = res.data?.diferencia_arrastrada != null ? Number(res.data.diferencia_arrastrada) : saldoInsolutoCalc;
      const cuotaAfectadaNumFinal = res.data?.cuota_afectada_numero != null ? Number(res.data.cuota_afectada_numero) : cuotaAfectadaNumCalc;
      const valorCuotaSiguienteFinal = res.data?.valor_cuota_siguiente != null ? Number(res.data.valor_cuota_siguiente) : valorCuotaSiguienteCalc;

      const cuotaNumFinal = cuotaAfectadaNumFinal || 1;
      const cuotaTag = `Cuota-${cuotaNumFinal}`;
      const idCtrClean = String(res.data?.numero_contrato || targetContrato).replace(/[^a-zA-Z0-9_-]/g, '_');
      const idCtrFormatted = idCtrClean.startsWith('CTR-') ? idCtrClean : `CTR-${idCtrClean.replace(/^REC-/, '')}`;
      const nomCliente = res.data?.cliente_nombre || creditoSeleccionado.cliente?.nombres || 'Cliente';
      const nomLimpio = String(nomCliente).trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
      const fEmisionStr = new Date().toISOString();
      const fEmisionFecha = getFechaLocal(new Date());
      const nombreArchivoPdf = `Recibo_${idCtrFormatted}_${cuotaTag}_${nomLimpio}_${fEmisionFecha}.pdf`;

      // Desplegar de inmediato el comprobante con los datos procesados en la UI
      setReciboExitoso({
        id_recibo: res.data?.id_recibo || res.data?.id || res.idLocal,
        cliente: nomCliente,
        cliente_cedula: creditoSeleccionado.cliente?.cedula || '',
        cliente_telefono: creditoSeleccionado.cliente?.telefono || '',
        cliente_correo: creditoSeleccionado.cliente?.correo || creditoSeleccionado.cliente?.email || '',
        numero_contrato: res.data?.numero_contrato || targetContrato,
        cuota_texto: cuotaTexto,
        cuota_numero: cuotaNumFinal,
        cuota_siguiente_numero: cuotaSiguienteNumCalc,
        valor: res.data?.valor_abonado != null ? Number(res.data.valor_abonado) : valor,
        valor_cuota_exigible: valorCuotaExigible,
        es_abono_parcial: esParcialFinal,
        saldo_insoluto: saldoInsolutoFinal,
        valor_cuota_siguiente: valorCuotaSiguienteFinal,
        nombre_archivo_pdf: nombreArchivoPdf,
        metodo_pago: res.data?.metodo_pago || 'efectivo',
        nuevoSaldo: nuevoSaldoConfirmado,
        firma_cliente: firmaCliente,
        firma_cobrador: firmaCobrador,
        cobrador_nombre: res.data?.cobrador_nombre || nombreCobradorReal,
        cobrador: res.data?.cobrador_nombre || nombreCobradorReal,
        fecha: res.data?.fecha
          ? new Date(res.data.fecha).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        fecha_completa: fEmisionStr,
        gps: res.data?.coordenadas_gps_cobro || gpsCoords || { latitud: lat, longitud: lon },
        offline: Boolean(res.offline),
      });
      console.log("👉 [DEBUG 11 - COMPROBANTE LISTO] Recibo desplegado con éxito.");
    } catch (error) {
      console.error('❌ [DEBUG ERROR CATCH] Error registrando abono:', error);
      Alert.alert('Error al Registrar Abono', error.message || 'No se pudo procesar el cobro en el dispositivo.');
    } finally {
      console.log("👉 [DEBUG 12 - FINALLY] Liberando bloqueo isSubmittingAbono");
      setIsSubmittingAbono(false);
      isSubmittingAbonoRef.current = false;
    }
  };

  // ==========================================
  // DISPARADORES DE DESCARGA Y ENVÍO DEL RECIBO
  // ==========================================
  const handleDescargarReciboPdf = async (customId = null) => {
    const idRecibo = customId || reciboExitoso?.id_recibo;
    const esOffline = Boolean(
      reciboExitoso?.offline ||
      (idRecibo && String(idRecibo).startsWith('ABONO-OFF-')) ||
      (idRecibo && String(idRecibo).startsWith('VENTA-OFF-'))
    );

    if (!idRecibo && !reciboExitoso) {
      Alert.alert('Comprobante', 'No hay datos del comprobante para descargar.');
      return;
    }

    setIsDownloadingPdf(true);
    try {
      const filename = reciboExitoso?.nombre_archivo_pdf || `Recibo_${idRecibo || 'Offline'}.pdf`;
      let cobradorNombre =
        user?.nombre ||
        user?.nombre_completo ||
        user?.nombres ||
        user?.usuario ||
        reciboExitoso?.cobrador_nombre ||
        reciboExitoso?.cobrador ||
        null;

      if (!cobradorNombre) {
        try {
          const storedUserRaw = await AsyncStorage.getItem(STORAGE_KEYS.USER);
          if (storedUserRaw) {
            const u = JSON.parse(storedUserRaw);
            cobradorNombre = u?.nombre || u?.nombre_completo || u?.nombres || u?.usuario || null;
          }
        } catch (_) {}
      }

      if (!cobradorNombre || !String(cobradorNombre).trim()) {
        cobradorNombre = 'Pedro Cobrador';
      } else {
        cobradorNombre = String(cobradorNombre).trim();
      }

      const rawToken =
        authToken ||
        (await AsyncStorage.getItem(STORAGE_KEYS.TOKEN)) ||
        (await AsyncStorage.getItem('@remundial_token')) ||
        (await AsyncStorage.getItem('token')) ||
        apiClient.defaults.headers.common?.['Authorization'] ||
        apiClient.defaults.headers?.['Authorization'];

      const tokenLimpio = rawToken ? String(rawToken).replace(/^Bearer\s+/i, '').trim() : '';
      const authHeaders = tokenLimpio ? { Authorization: `Bearer ${tokenLimpio}` } : {};
      const baseURL = apiClient.defaults.baseURL || 'http://localhost:8000';

      // 1. MODO OFFLINE / COLA LOCAL (ID temporal o registro offline)
      // Enviar a FastAPI /abonos/recibo-offline-pdf para renderizar el PDF oficial con ReportLab (firma real + cobrador)
      if (esOffline && reciboExitoso) {
        console.log('[CobradorDashboard] Invocando ReportLab oficial para comprobante offline...', reciboExitoso);
        try {
          const offlinePayload = {
            id_recibo: String(idRecibo || reciboExitoso.id_recibo || 'ABONO-OFF'),
            numero_contrato: reciboExitoso.numero_contrato,
            credito_id: creditoSeleccionado?.id_contrato || creditoSeleccionado?.id,
            cliente: reciboExitoso.cliente,
            cliente_nombre: reciboExitoso.cliente,
            cliente_cedula: reciboExitoso.cliente_cedula,
            cliente_telefono: reciboExitoso.cliente_telefono,
            cobrador_nombre: cobradorNombre,
            valor: reciboExitoso.valor,
            valor_abonado: reciboExitoso.valor,
            nuevoSaldo: reciboExitoso.nuevoSaldo,
            saldo_restante_credito: reciboExitoso.nuevoSaldo,
            es_abono_parcial: Boolean(reciboExitoso.es_abono_parcial),
            saldo_insoluto: reciboExitoso.saldo_insoluto || 0,
            cuota_numero: reciboExitoso.cuota_numero || 1,
            cuota_afectada_numero: reciboExitoso.cuota_numero || 1,
            cuota_siguiente_numero: reciboExitoso.cuota_siguiente_numero || 2,
            valor_cuota_siguiente: reciboExitoso.valor_cuota_siguiente,
            valor_cuota_exigible: reciboExitoso.valor_cuota_exigible,
            metodo_pago: reciboExitoso.metodo_pago || 'efectivo',
            fecha: reciboExitoso.fecha,
            fecha_completa: reciboExitoso.fecha_completa,
            nombre_archivo_pdf: filename,
            firma_cliente: reciboExitoso.firma_cliente || null,
            firma_cobrador: reciboExitoso.firma_cobrador || firmaCobrador || null,
          };

          const resPdf = await fetch(`${baseURL}/abonos/recibo-offline-pdf`, {
            method: 'POST',
            headers: {
              ...authHeaders,
              'Content-Type': 'application/json',
              Accept: 'application/pdf',
            },
            body: JSON.stringify(offlinePayload),
          });

          if (resPdf.ok) {
            const blobPdf = await resPdf.blob();
            if (Platform.OS === 'web' || typeof window !== 'undefined') {
              const blobUrl = window.URL.createObjectURL(blobPdf);
              const a = document.createElement('a');
              a.href = blobUrl;
              a.download = filename;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              window.URL.revokeObjectURL(blobUrl);
              return;
            }
          } else {
            console.warn('[CobradorDashboard] Endpoint ReportLab offline no respondió 200, recurriendo a blob local');
          }
        } catch (serverErr) {
          console.warn('[CobradorDashboard] Servidor backend inaccesible en offline, usando blob local:', serverErr);
        }

        // Respaldo 100% desconectado en cliente
        if (Platform.OS === 'web' || typeof window !== 'undefined') {
          const blob = generarPdfReciboAbonoOfflineBlob(reciboExitoso, cobradorNombre);
          const blobUrl = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(blobUrl);
          return;
        } else {
          Alert.alert('Comprobante Offline', 'Comprobante generado localmente en memoria.');
          return;
        }
      }

      // 2. MODO ONLINE (ID sincronizado de servidor)
      if (Platform.OS === 'web') {
        const queryParams = [];
        if (tokenLimpio) queryParams.push(`token=${encodeURIComponent(tokenLimpio)}`);
        if (cobradorNombre && cobradorNombre.trim() && cobradorNombre.trim().toLowerCase() !== 'null') {
          queryParams.push(`cobrador_nombre=${encodeURIComponent(cobradorNombre.trim())}`);
        }
        const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';
        const downloadUrl = `${baseURL}/abonos/${idRecibo}/recibo-pdf${queryString}`;
        const res = await fetch(downloadUrl, {
          method: 'GET',
          headers: {
            ...authHeaders,
            Accept: 'application/pdf',
          },
        });
        if (!res.ok) {
          const errText = await res.text();
          console.warn('[CobradorDashboard] Servidor rechazó o no encontró recibo, recurriendo a generación ReportLab:', errText);
          if (reciboExitoso) {
            try {
              const offlinePayload = {
                id_recibo: String(idRecibo),
                numero_contrato: reciboExitoso.numero_contrato,
                cliente: reciboExitoso.cliente,
                cliente_nombre: reciboExitoso.cliente,
                cliente_cedula: reciboExitoso.cliente_cedula,
                cliente_telefono: reciboExitoso.cliente_telefono,
                cobrador_nombre: cobradorNombre,
                valor: reciboExitoso.valor,
                valor_abonado: reciboExitoso.valor,
                nuevoSaldo: reciboExitoso.nuevoSaldo,
                saldo_restante_credito: reciboExitoso.nuevoSaldo,
                es_abono_parcial: Boolean(reciboExitoso.es_abono_parcial),
                saldo_insoluto: reciboExitoso.saldo_insoluto || 0,
                cuota_numero: reciboExitoso.cuota_numero || 1,
                cuota_afectada_numero: reciboExitoso.cuota_numero || 1,
                cuota_siguiente_numero: reciboExitoso.cuota_siguiente_numero || 2,
                valor_cuota_siguiente: reciboExitoso.valor_cuota_siguiente,
                valor_cuota_exigible: reciboExitoso.valor_cuota_exigible,
                metodo_pago: reciboExitoso.metodo_pago || 'efectivo',
                fecha: reciboExitoso.fecha,
                fecha_completa: reciboExitoso.fecha_completa,
                nombre_archivo_pdf: filename,
                firma_cliente: reciboExitoso.firma_cliente || null,
                firma_cobrador: reciboExitoso.firma_cobrador || firmaCobrador || null,
              };
              const resPost = await fetch(`${baseURL}/abonos/recibo-offline-pdf`, {
                method: 'POST',
                headers: { ...authHeaders, 'Content-Type': 'application/json', Accept: 'application/pdf' },
                body: JSON.stringify(offlinePayload),
              });
              if (resPost.ok) {
                const blobPdf = await resPost.blob();
                const blobUrl = window.URL.createObjectURL(blobPdf);
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(blobUrl);
                return;
              }
            } catch (_) {}

            const blob = generarPdfReciboAbonoOfflineBlob(reciboExitoso, cobradorNombre);
            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(blobUrl);
            return;
          }
          throw new Error(errText || 'No fue posible generar el recibo PDF.');
        }
        const blob = await res.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(blobUrl);
      } else {
        const baseURL = apiClient.defaults.baseURL || 'http://10.0.2.2:8000';
        const targetUrl = `${baseURL}/abonos/${idRecibo}/recibo-pdf?token=${encodeURIComponent(tokenLimpio || '')}&cobrador_nombre=${encodeURIComponent(cobradorNombre || '')}`;
        await Linking.openURL(targetUrl);
      }
    } catch (err) {
      console.error('[CobradorDashboard] Error al descargar recibo PDF:', err);
      // Fallback final con datos en memoria
      if (reciboExitoso && (Platform.OS === 'web' || typeof window !== 'undefined')) {
        try {
          const filename = reciboExitoso?.nombre_archivo_pdf || `Recibo_${idRecibo || 'Offline'}.pdf`;
          const cobradorNombre = user?.nombre || user?.nombre_completo || reciboExitoso?.cobrador_nombre || 'Pedro Cobrador';
          const blob = generarPdfReciboAbonoOfflineBlob(reciboExitoso, cobradorNombre);
          const blobUrl = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(blobUrl);
          return;
        } catch (fallbackErr) {
          console.error('[CobradorDashboard] Fallback offline error:', fallbackErr);
        }
      }
      Alert.alert(
        'Comprobante PDF',
        err.message || 'No se pudo descargar el archivo en este momento. Verifique la conexión con el servidor.'
      );
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleCompartirReciboWhatsApp = () => {
    if (!reciboExitoso) return;
    const tel = (reciboExitoso.cliente_telefono || '').replace(/\D/g, '');
    const telColombia = tel.length >= 10 ? (tel.startsWith('57') ? tel : `57${tel}`) : '';
    const tipoTitulo = reciboExitoso.es_abono_parcial ? 'COMPROBANTE DE ABONO PARCIAL' : 'COMPROBANTE DE PAGO DE CUOTA';
    const nomPdf = reciboExitoso.nombre_archivo_pdf || 'Recibo_Caja.pdf';

    let detalleInsoluto = '';
    if (reciboExitoso.es_abono_parcial) {
      detalleInsoluto =
        `⚠️ *ESTADO:* Abono Parcial registrado\n` +
        `📉 *Saldo Insoluto Trasladado:* ${formatCOP(reciboExitoso.saldo_insoluto)}\n` +
        `📅 *Exigible Próxima Cuota (#${reciboExitoso.cuota_siguiente_numero || 2}):* ${formatCOP(reciboExitoso.valor_cuota_siguiente)}\n`;
    } else {
      detalleInsoluto = `✅ *ESTADO:* Cuota cancelada en su totalidad ($0 saldo insoluto)\n`;
    }

    const mensaje =
      `*REMUNDIAL S.A.S. - ${tipoTitulo}*\n\n` +
      `Estimado(a) *${reciboExitoso.cliente}*,\n` +
      `Confirmamos el recaudo registrado en terreno por su cobrador autorizado.\n\n` +
      `🧾 *No. Recibo:* ${String(reciboExitoso.id_recibo).slice(0, 8).toUpperCase()}\n` +
      `📋 *Contrato:* ${reciboExitoso.numero_contrato}\n` +
      `📌 *Cuota:* ${reciboExitoso.cuota_texto || `Cuota #${reciboExitoso.cuota_numero}`}\n` +
      `💵 *Monto Recaudado:* ${formatCOP(reciboExitoso.valor)}\n` +
      detalleInsoluto +
      `💰 *Nuevo Saldo Restante:* ${formatCOP(reciboExitoso.nuevoSaldo)}\n` +
      `🕒 *Fecha/Hora:* ${reciboExitoso.fecha_completa || ''} ${reciboExitoso.fecha || ''}\n` +
      `📄 *Archivo PDF:* ${nomPdf}\n\n` +
      `Gracias por su compromiso y puntualidad.\n` +
      `_Remundial S.A.S. - Gestión de Créditos_`;

    const waUrl = telColombia
      ? `https://api.whatsapp.com/send?phone=${telColombia}&text=${encodeURIComponent(mensaje)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(mensaje)}`;

    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(waUrl, '_blank');
      } else {
        Linking.openURL(waUrl);
      }
    } catch (e) {
      console.warn('Error abriendo WhatsApp:', e);
      Alert.alert('WhatsApp', 'No se pudo abrir WhatsApp automáticamente.');
    }
  };

  const handleCompartirReciboEmail = () => {
    if (!reciboExitoso) return;
    const email = reciboExitoso.cliente_correo || '';
    const tipoTitulo = reciboExitoso.es_abono_parcial ? 'Abono Parcial' : 'Pago de Cuota';
    const asunto = `Comprobante de ${tipoTitulo} - Contrato ${reciboExitoso.numero_contrato} - Remundial`;

    let detalleInsoluto = '';
    if (reciboExitoso.es_abono_parcial) {
      detalleInsoluto =
        `Estado: Abono Parcial Registrado\n` +
        `Saldo Insoluto Trasladado: ${formatCOP(reciboExitoso.saldo_insoluto)}\n` +
        `Monto Exigible Siguiente Cuota: ${formatCOP(reciboExitoso.valor_cuota_siguiente)}\n`;
    } else {
      detalleInsoluto = `Estado: Cuota Cancelada en su Totalidad\n`;
    }

    const cuerpo =
      `Estimado(a) ${reciboExitoso.cliente},\n\n` +
      `Confirmamos el recaudo registrado en terreno correspondiente a su contrato:\n\n` +
      `No. Recibo: ${String(reciboExitoso.id_recibo).slice(0, 8).toUpperCase()}\n` +
      `Contrato: ${reciboExitoso.numero_contrato}\n` +
      `Concepto: ${reciboExitoso.cuota_texto || 'Abono a Crédito'}\n` +
      `Valor Recaudado: ${formatCOP(reciboExitoso.valor)}\n` +
      detalleInsoluto +
      `Saldo Restante: ${formatCOP(reciboExitoso.nuevoSaldo)}\n` +
      `Fecha: ${reciboExitoso.fecha_completa || ''} ${reciboExitoso.fecha || ''}\n` +
      `Documento Oficial: ${reciboExitoso.nombre_archivo_pdf || ''}\n\n` +
      `Atentamente,\nEquipo de Cobranzas y Recaudos Remundial S.A.S.`;

    const mailtoUrl = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.href = mailtoUrl;
    } else {
      Linking.openURL(mailtoUrl).catch((err) => {
        console.warn('Error abriendo cliente de correo:', err);
        Alert.alert('Correo', 'No se pudo abrir la aplicación de correo electrónico.');
      });
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      
      {/* BARRA SUPERIOR CORPORATIVA SAAS */}
      <View style={styles.topHeader}>
        <View style={styles.headerLeftCol}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.appTitle}>Remundial</Text>
            <View style={styles.cobradorBadge}>
              <Text style={styles.cobradorBadgeText}>COBRADOR EN RUTA</Text>
            </View>
          </View>
          <Text style={styles.headerSub}>Módulo Operativo y Control de Recaudos</Text>
        </View>

        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={() => setShowLogoutModal(true)}
          accessibilityLabel="Cerrar sesión"
          accessibilityRole="button"
        >
          <Text style={styles.logoutBtnText}>Salir</Text>
        </TouchableOpacity>
      </View>

      {/* PESTAÑAS PRINCIPALES DEL COBRADOR */}
      <View style={styles.tabBarContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'recaudos' && styles.tabButtonActive]}
          onPress={() => setActiveTab('recaudos')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'recaudos' }}
        >
          <Text style={[styles.tabButtonText, activeTab === 'recaudos' && styles.tabButtonTextActive]}>
            💵 Recaudos
          </Text>
          <View style={[styles.tabBadge, activeTab === 'recaudos' ? styles.tabBadgeActive : styles.tabBadgeInactive]}>
            <Text style={[styles.tabBadgeText, activeTab === 'recaudos' ? styles.tabBadgeTextActive : styles.tabBadgeTextInactive]}>
              {kpisRecaudos.totalCount}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'ruta' && styles.tabButtonActive]}
          onPress={() => setActiveTab('ruta')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'ruta' }}
        >
          <Text style={[styles.tabButtonText, activeTab === 'ruta' && styles.tabButtonTextActive]}>
            📋 En Ruta
          </Text>
          <View style={[styles.tabBadge, activeTab === 'ruta' ? styles.tabBadgeActive : styles.tabBadgeInactive]}>
            <Text style={[styles.tabBadgeText, activeTab === 'ruta' ? styles.tabBadgeTextActive : styles.tabBadgeTextInactive]}>
              {creditosFiltrados.length}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'proyeccion' && styles.tabButtonActive]}
          onPress={() => setActiveTab('proyeccion')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'proyeccion' }}
        >
          <Text style={[styles.tabButtonText, activeTab === 'proyeccion' && styles.tabButtonTextActive]}>
            📅 Proyección
          </Text>
          <View style={[styles.tabBadge, activeTab === 'proyeccion' ? styles.tabBadgeActive : styles.tabBadgeInactive]}>
            <Text style={[styles.tabBadgeText, activeTab === 'proyeccion' ? styles.tabBadgeTextActive : styles.tabBadgeTextInactive]}>
              {metricasProyeccion.countTotal}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} colors={['#059669']} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* IDENTIFICACIÓN COMPACTA DEL COBRADOR */}
        <View style={styles.operatorCard}>
          <View style={styles.operatorAvatar}>
            <Text style={styles.operatorAvatarText}>
              {user?.nombre
                ? user.nombre
                    .split(' ')
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()
                : 'CO'}
            </Text>
          </View>
          <View style={styles.operatorDetails}>
            <Text style={styles.operatorName}>{user?.nombre || 'Pedro Cobrador'}</Text>
            <Text style={styles.operatorPhone}>Ruta Activa • {todayStr}</Text>
          </View>
          <View style={styles.onlineBadge}>
            <View style={styles.onlineDot} />
            <Text style={styles.onlineText}>En Turno</Text>
          </View>
        </View>

        {/* ========================================================================= */}
        {/* VISTA 1: MIS RECAUDOS DEL DÍA (HISTORIAL DIARIO + CONSOLIDADO FINANCIERO)  */}
        {/* ========================================================================= */}
        {activeTab === 'recaudos' && (
          <View style={styles.recaudosSectionWrapper}>
            
            {/* TARJETA SUPERIOR DE CONSOLIDADO FINANCIERO (ARQUEO DE LA JORNADA) */}
            <View style={styles.consolidadoCard}>
              <View style={styles.consolidadoHeaderRow}>
                <View style={styles.consolidadoIconBox}>
                  <Text style={styles.consolidadoIcon}>💰</Text>
                </View>
                <View style={styles.consolidadoTitleBox}>
                  <Text style={styles.consolidadoBadgeLabel}>BALANCE DE LA JORNADA</Text>
                  <Text style={styles.consolidadoSubLabel}>Control y arqueo de caja de hoy ({todayStr})</Text>
                </View>
              </View>

              {/* TOTAL RECAUDADO HOY */}
              <View style={styles.totalRecaudadoHoyBlock}>
                <Text style={styles.totalRecaudadoLabel}>TOTAL RECAUDADO HOY</Text>
                <Text style={styles.totalRecaudadoValue}>{formatCOP(kpisRecaudos.totalRecaudadoHoy)}</Text>
                <Text style={styles.totalRecaudadoSub}>
                  Consolidado total de {kpisRecaudos.totalCount} pago(s) registrado(s) en terreno
                </Text>
              </View>

              {/* DESGLOSE DE ARQUEO FÍSICO (PENDIENTE VS CONCILIADO) */}
              <View style={styles.arqueoCardsRow}>
                
                {/* TARJETA 1: PENDIENTE DE ARQUEO (DINERO EN RUTA) */}
                <TouchableOpacity
                  style={[
                    styles.arqueoSubCard,
                    styles.arqueoPendienteCard,
                    filtroConciliacion === 'pendiente' && styles.arqueoSubCardActive,
                  ]}
                  onPress={() => setFiltroConciliacion(filtroConciliacion === 'pendiente' ? 'todos' : 'pendiente')}
                  activeOpacity={0.8}
                >
                  <View style={styles.arqueoCardTop}>
                    <View style={styles.dotArqueoAmber} />
                    <Text style={styles.arqueoSubCardTagAmber}>EN RUTA (PENDIENTE)</Text>
                  </View>
                  <Text style={styles.arqueoAmountAmber}>{formatCOP(kpisRecaudos.totalPendienteArqueo)}</Text>
                  <Text style={styles.arqueoFootnoteAmber}>
                    {kpisRecaudos.countPendiente} cobro(s) • Dinero físico en tu poder
                  </Text>
                </TouchableOpacity>

                {/* TARJETA 2: CONCILIADO POR SECRETARÍA (EN CAJA CENTRAL) */}
                <TouchableOpacity
                  style={[
                    styles.arqueoSubCard,
                    styles.arqueoConciliadoCard,
                    filtroConciliacion === 'conciliado' && styles.arqueoSubCardActive,
                  ]}
                  onPress={() => setFiltroConciliacion(filtroConciliacion === 'conciliado' ? 'todos' : 'conciliado')}
                  activeOpacity={0.8}
                >
                  <View style={styles.arqueoCardTop}>
                    <View style={styles.dotArqueoGreen} />
                    <Text style={styles.arqueoSubCardTagGreen}>CONCILIADO EN OFICINA</Text>
                  </View>
                  <Text style={styles.arqueoAmountGreen}>{formatCOP(kpisRecaudos.totalConciliado)}</Text>
                  <Text style={styles.arqueoFootnoteGreen}>
                    {kpisRecaudos.countConciliado} cobro(s) • Validado por secretaría
                  </Text>
                </TouchableOpacity>

              </View>

              {/* NOTA DE AUDITORÍA FÍSICA PARA EL COBRADOR */}
              <View style={styles.arqueoTipBox}>
                <Text style={styles.arqueoTipIcon}>💡</Text>
                <Text style={styles.arqueoTipText}>
                  Coteja que tu dinero físico en efectivo coincida exactamente con{' '}
                  <Text style={styles.arqueoTipBold}>{formatCOP(kpisRecaudos.totalPendienteArqueo)}</Text> antes de entregar el arqueo en la oficina.
                </Text>
              </View>
            </View>

            {/* SECCIÓN DE FILTROS Y BÚSQUEDA DE RECAUDOS */}
            <View style={styles.recaudosFilterSection}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>HISTORIAL CRONOLÓGICO DE COBROS</Text>
                <Text style={styles.sectionCountBadge}>{recaudosOrdenados.length} recaudos</Text>
              </View>

              {/* PASTILLAS DE FILTRADO POR ESTADO */}
              <View style={styles.filterPillsRow}>
                <TouchableOpacity
                  style={[styles.filterPill, filtroConciliacion === 'todos' && styles.filterPillActive]}
                  onPress={() => setFiltroConciliacion('todos')}
                >
                  <Text style={[styles.filterPillText, filtroConciliacion === 'todos' && styles.filterPillTextActive]}>
                    Todos ({kpisRecaudos.totalCount})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.filterPill, filtroConciliacion === 'pendiente' && styles.filterPillActiveAmber]}
                  onPress={() => setFiltroConciliacion('pendiente')}
                >
                  <Text style={[styles.filterPillText, filtroConciliacion === 'pendiente' && styles.filterPillTextActiveAmber]}>
                    ⏳ Pendientes de Arqueo ({kpisRecaudos.countPendiente})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.filterPill, filtroConciliacion === 'conciliado' && styles.filterPillActiveGreen]}
                  onPress={() => setFiltroConciliacion('conciliado')}
                >
                  <Text style={[styles.filterPillText, filtroConciliacion === 'conciliado' && styles.filterPillTextActiveGreen]}>
                    ✓ Conciliados ({kpisRecaudos.countConciliado})
                  </Text>
                </TouchableOpacity>
              </View>

              {/* BARRA DE BÚSQUEDA DE RECAUDOS */}
              <View style={styles.searchBar}>
                <Text style={styles.searchIcon}>🔍</Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Buscar por cliente, cédula o contrato..."
                  placeholderTextColor="#94A3B8"
                  value={filtroBusquedaRecaudos}
                  onChangeText={setFiltroBusquedaRecaudos}
                />
                {filtroBusquedaRecaudos.length > 0 && (
                  <TouchableOpacity onPress={() => setFiltroBusquedaRecaudos('')}>
                    <Text style={styles.clearSearchIcon}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* LISTADO DE TARJETAS DE RECAUDO DETALLADAS */}
            {isLoadingRecaudos && !isRefreshing ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color="#059669" />
                <Text style={styles.loadingText}>Cargando historial de recaudos de hoy...</Text>
              </View>
            ) : recaudosOrdenados.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Sin Recaudos en la Jornada</Text>
                <Text style={styles.emptySubtitle}>
                  {filtroConciliacion !== 'todos' || filtroBusquedaRecaudos
                    ? 'No se encontraron recaudos que coincidan con los filtros aplicados.'
                    : 'Aún no has registrado ningún pago en terreno el día de hoy. Consulta tu Hoja de Ruta para iniciar las visitas.'}
                </Text>
                {filtroConciliacion !== 'todos' || filtroBusquedaRecaudos ? (
                  <TouchableOpacity
                    style={styles.reloadButton}
                    onPress={() => {
                      setFiltroConciliacion('todos');
                      setFiltroBusquedaRecaudos('');
                    }}
                  >
                    <Text style={styles.reloadButtonText}>Limpiar Filtros</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.reloadButton, { backgroundColor: '#059669' }]}
                    onPress={() => setActiveTab('ruta')}
                  >
                    <Text style={styles.reloadButtonText}>Ir a Hoja de Ruta →</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <View style={styles.recaudosList}>
                {recaudosOrdenados.map((item, index) => {
                  const valor = Number(item.valor_abonado || 0);
                  const st = (item.estado || 'registrado').toLowerCase();
                  const esConciliado = !item.es_offline && st === 'conciliado';
                  const hora = formatHoraExacta(item.fecha || item.creado_en);
                  const metodo = (item.metodo_pago || 'efectivo').toLowerCase();

                  // Determinar con precisión el número de cuota cobrada (ej. "Cuota 2 de 6")
                  let textoCuota = item.cuota_texto;
                  if (!textoCuota && (item.notas || '')) {
                    const matchNotas = String(item.notas).match(/Cuota\s+(\d+)\s+de\s+(\d+)/i);
                    if (matchNotas) {
                      textoCuota = `Cuota ${matchNotas[1]} de ${matchNotas[2]}`;
                    }
                  }
                  if (!textoCuota) {
                    const cred = creditos.find((c) => {
                      const cId = String(c.id_contrato || c.id || '').toLowerCase();
                      const cNum = String(c.numero_contrato || '').toLowerCase();
                      const iCredId = String(item.credito_id || '').toLowerCase();
                      const iNum = String(item.numero_contrato || '').toLowerCase();
                      return (iCredId && cId === iCredId) || (iNum && cNum === iNum);
                    });

                    if (cred) {
                      const vCuota = Number(cred.valor_cuota || 0);
                      const mFinanciado = Number(cred.monto_financiado || cred.valor_total || 0);
                      const tCuotas = Number(cred.numero_cuotas || cred.cuotas || (vCuota > 0 ? Math.round(mFinanciado / vCuota) : 1)) || 1;
                      if (item.numero_cuota) {
                        textoCuota = `Cuota ${item.numero_cuota} de ${tCuotas}`;
                      } else {
                        const saldoActual = Number(cred.saldo_pendiente || 0);
                        const amort = Math.max(0, mFinanciado - saldoActual);
                        const cPagas = vCuota > 0 ? Math.floor(amort / vCuota) : 0;
                        const cActual = Math.min(tCuotas, Math.max(1, cPagas));
                        textoCuota = `Cuota ${cActual} de ${tCuotas}`;
                      }
                    } else if (item.numero_cuota && item.total_cuotas) {
                      textoCuota = `Cuota ${item.numero_cuota} de ${item.total_cuotas}`;
                    } else if (item.numero_cuota) {
                      textoCuota = `Cuota ${item.numero_cuota}`;
                    } else {
                      textoCuota = 'Abono a Capital';
                    }
                  }

                  return (
                    <View key={item.id_recibo || index} style={styles.recaudoCard}>
                      
                      {/* ENCABEZADO DE LA TARJETA: CLIENTE, CONTRATO Y NÚMERO DE CUOTA */}
                      <View style={styles.recaudoCardHeader}>
                        <View style={styles.recaudoClientCol}>
                          <Text style={styles.recaudoClientName} numberOfLines={1}>
                            {item.cliente_nombre || 'Cliente Titular'}
                          </Text>
                          {item.cliente_cedula ? (
                            <Text style={styles.recaudoClientDoc}>C.C. {item.cliente_cedula}</Text>
                          ) : null}
                        </View>
                        <View style={styles.recaudoHeaderRightCol}>
                          <View style={styles.recaudoContractBadge}>
                            <Text style={styles.recaudoContractBadgeText}>
                              {item.numero_contrato || 'CTR-S/N'}
                            </Text>
                          </View>
                          <View style={styles.recaudoCuotaBadge}>
                            <Text style={styles.recaudoCuotaBadgeText}>
                              📌 {textoCuota}
                            </Text>
                          </View>
                          {item.es_abono_parcial ? (
                            <View style={[styles.recaudoCheckmarkBadge, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A', borderWidth: 1 }]}>
                              <Text style={[styles.recaudoCheckmarkBadgeText, { color: '#B45309' }]}>
                                ⚠️ Abono Parcial (Déficit: {formatCOP(item.diferencia_arrastrada || item.saldo_insoluto || 0)})
                              </Text>
                            </View>
                          ) : (
                            <View style={styles.recaudoCheckmarkBadge}>
                              <Text style={styles.recaudoCheckmarkBadgeText}>
                                ✓ Pago Total Cuota
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>

                      {/* FILA PRINCIPAL: MONTO RECIBIDO Y MÉTODO DE PAGO */}
                      <View style={styles.recaudoFinanceRow}>
                        <View style={styles.recaudoValueBlock}>
                          <Text style={styles.recaudoValueLabel}>VALOR RECIBIDO</Text>
                          <Text style={styles.recaudoValueAmount}>+ {formatCOP(valor)}</Text>
                        </View>

                        <View style={styles.recaudoMethodBadge}>
                          <Text style={styles.recaudoMethodText}>
                            {metodo === 'transferencia' ? '💳 Transferencia' : '💵 Efectivo'}
                          </Text>
                        </View>
                      </View>

                      {/* FILA DE DETALLES TEMPORALES Y TRANSACCIONALES */}
                      <View style={styles.recaudoMetaRow}>
                        <View style={styles.recaudoTimeCol}>
                          <Text style={styles.recaudoTimeLabel}>HORA TRANSACCIÓN</Text>
                          <Text style={styles.recaudoTimeValue}>⏰ {hora}</Text>
                        </View>

                        <View style={styles.recaudoCuotaCenterCol}>
                          <Text style={styles.recaudoTimeLabel}>CONCEPTO COBRO</Text>
                          <Text style={styles.recaudoCuotaCenterValue}>{textoCuota}</Text>
                        </View>

                        <View style={styles.recaudoRefCol}>
                          <Text style={styles.recaudoTimeLabel}>NO. RECIBO</Text>
                          <Text style={styles.recaudoRefMono}>
                            #{String(item.id_recibo).slice(0, 8).toUpperCase()}
                          </Text>
                        </View>
                      </View>

                      {/* INDICADOR VISUAL DE ESTATUS DE CONCILIACIÓN */}
                      <View style={styles.recaudoStatusWrapper}>
                        {esConciliado ? (
                          <View style={styles.statusBadgeConciliado}>
                            <View style={styles.statusDotGreen} />
                            <View style={styles.statusTextCol}>
                              <Text style={styles.statusTitleGreen}>Confirmado / Conciliado por Secretaría</Text>
                              <Text style={styles.statusSubGreen}>
                                Efectivo verificado y cerrado en caja de oficina central.
                              </Text>
                            </View>
                          </View>
                        ) : (
                          <View style={styles.statusBadgePendiente}>
                            <View style={styles.statusDotAmber} />
                            <View style={styles.statusTextCol}>
                              <Text style={styles.statusTitleAmber}>
                                {item.es_offline ? 'Pendiente de Arqueo (En Cola Offline)' : 'Pendiente de Arqueo'}
                              </Text>
                              <Text style={styles.statusSubAmber}>
                                El dinero físico aún lo tienes en ruta. Pendiente entrega y validación.
                              </Text>
                            </View>
                          </View>
                        )}
                      </View>

                      {/* ACCIÓN RÁPIDA: VER / COMPARTIR COMPROBANTE OFICIAL */}
                      <View style={styles.recaudoCardFooterRow}>
                        <TouchableOpacity
                          style={styles.recaudoVerPdfBtn}
                          onPress={() => {
                            const cuotaNum = item.numero_cuota || item.cuota_afectada_numero || 1;
                            const cuotaTag = `Cuota-${cuotaNum}`;
                            const idCtrClean = String(item.numero_contrato || 'CTR').replace(/[^a-zA-Z0-9_-]/g, '_');
                            const idCtrFormatted = idCtrClean.startsWith('CTR-') ? idCtrClean : `CTR-${idCtrClean.replace(/^REC-/, '')}`;
                            const fEmision = getFechaLocal(item.fecha || item.creado_en || new Date());
                            const nomArchivo = `Recibo_${idCtrFormatted}_${cuotaTag}_${nomLimpio}_${fEmision}.pdf`;

                            setReciboExitoso({
                              id_recibo: item.id_recibo,
                              cliente: nomCliente,
                              cliente_cedula: item.cliente_cedula || '',
                              cliente_telefono: item.cliente_telefono || '',
                              cliente_correo: item.cliente_correo || '',
                              numero_contrato: item.numero_contrato || idCtrClean,
                              cuota_texto: textoCuota,
                              cuota_numero: item.numero_cuota || 1,
                              cuota_siguiente_numero: item.numero_cuota ? item.numero_cuota + 1 : 2,
                              valor: valor,
                              valor_cuota_exigible: item.valor_cuota_exigible || valor,
                              es_abono_parcial: esParc,
                              saldo_insoluto: Number(item.diferencia_arrastrada || item.saldo_insoluto || 0),
                              valor_cuota_siguiente: item.valor_cuota_siguiente,
                              nombre_archivo_pdf: nomArchivo,
                              metodo_pago: item.metodo_pago || 'efectivo',
                              nuevoSaldo: item.saldo_restante_credito || item.saldo_restante || 0,
                              fecha: formatHoraExacta(item.fecha || item.creado_en),
                              fecha_completa: fEmision,
                              offline: Boolean(item.es_offline),
                            });
                          }}
                        >
                          <Text style={styles.recaudoVerPdfBtnText}>📄 Ver / Compartir Comprobante Oficial</Text>
                        </TouchableOpacity>
                      </View>

                    </View>
                  );
                })}
              </View>
            )}

          </View>
        )}

        {/* ========================================================================= */}
        {/* VISTA 2: HOJA DE RUTA (COBROS ASIGNADOS Y ACCIONES EN TERRENO)            */}
        {/* ========================================================================= */}
        {activeTab === 'ruta' && (
          <View style={styles.rutaSectionWrapper}>
            
            {/* RESUMEN RÁPIDO DE CARTERA ASIGNADA */}
            <View style={styles.kpiRow}>
              <View style={styles.kpiCardHalf}>
                <Text style={styles.kpiLabelDark}>CARTERA ASIGNADA</Text>
                <Text style={styles.kpiValueDark}>{creditos.length} créditos</Text>
              </View>
              <View style={styles.kpiCardHalf}>
                <Text style={styles.kpiLabelDark}>RECAUDOS HOY</Text>
                <Text style={styles.kpiValueDark}>{kpisRecaudos.totalCount} cobrados</Text>
              </View>
            </View>

            {/* BARRA DE BÚSQUEDA EN HOJA DE RUTA */}
            <View style={styles.searchSection}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>HOJA DE RUTA DEL DÍA</Text>
                <Text style={styles.sectionCountBadge}>
                  {clientesAgrupados.length} {clientesAgrupados.length === 1 ? 'cliente' : 'clientes'} • {creditosFiltrados.length} {creditosFiltrados.length === 1 ? 'crédito' : 'créditos'}
                </Text>
              </View>
              <View style={styles.searchBar}>
                <Text style={styles.searchIcon}>🔍</Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Buscar por cliente, cédula o barrio..."
                  placeholderTextColor="#94A3B8"
                  value={filtroBusquedaRuta}
                  onChangeText={setFiltroBusquedaRuta}
                />
              </View>
            </View>

            {/* LISTADO DE CRÉDITOS Y COBROS EN TERRENO */}
            {isLoadingCreditos && !isRefreshing ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color="#059669" />
                <Text style={styles.loadingText}>Cargando cartera de la ruta...</Text>
              </View>
            ) : creditosFiltrados.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>
                  {filtroBusquedaRuta.trim() ? 'Sin Resultados de Búsqueda' : '¡Ruta al Día!'}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {filtroBusquedaRuta.trim()
                    ? 'No se encontraron contratos en la ruta con los términos buscados.'
                    : 'Todos los contratos asignados a tu ruta ya tienen abono registrado hoy o se encuentran totalmente cancelados ($0 saldo).'}
                </Text>
                <TouchableOpacity style={styles.reloadButton} onPress={cargarCreditosRuta}>
                  <Text style={styles.reloadButtonText}>Recargar Hoja de Ruta</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.creditsList}>
                {clientesAgrupados.map((grupo, gIndex) => {
                  const cliente = grupo.cliente || {};
                  const contratos = grupo.contratos || [];
                  const primerCredito = grupo.primerCredito || contratos[0] || {};
                  const tieneMultiples = contratos.length > 1;

                  return (
                    <View key={grupo.clienteKey || gIndex} style={styles.clientUnifiedCard}>
                      
                      {/* 1. CABECERA UNIFICADA DE IDENTIFICACIÓN DEL CLIENTE */}
                      <View style={styles.clientCardHeader}>
                        <View style={styles.clientAvatarContainer}>
                          <Text style={styles.clientAvatarText}>
                            {(cliente.nombres || 'C').charAt(0).toUpperCase()}
                          </Text>
                        </View>

                        <View style={styles.clientInfoBlock}>
                          <View style={styles.clientNameRow}>
                            <Text style={styles.clientTitleName} numberOfLines={1}>
                              {cliente.nombres || 'Cliente Titular'}
                            </Text>
                            {tieneMultiples && (
                              <View style={styles.clientMultiBadge}>
                                <Text style={styles.clientMultiBadgeText}>
                                  ⚡ {contratos.length} Contratos
                                </Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.clientDocText}>
                            C.C. {cliente.cedula || 'Sin documento'}
                          </Text>
                        </View>
                      </View>

                      {/* 2. DIRECCIÓN, BARRIO Y ACCIONES DE CONTACTO Y GARANTÍAS */}
                      <View style={styles.clientDetailsBar}>
                        <View style={styles.clientAddressRow}>
                          <Text style={styles.addressIcon}>📍</Text>
                          <Text style={styles.clientAddressText} numberOfLines={1}>
                            {cliente.direccion || 'Sin dirección'}{cliente.barrio ? `, ${cliente.barrio}` : ''}
                          </Text>
                        </View>

                        <View style={styles.clientActionsBar}>
                          {cliente.telefono ? (
                            <>
                              <TouchableOpacity
                                style={styles.clientContactBtn}
                                onPress={() => hacerLlamada(cliente.telefono)}
                                accessibilityRole="button"
                                activeOpacity={0.7}
                              >
                                <Text style={styles.clientContactBtnText}>📞 Llamar</Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={styles.clientWhatsappBtn}
                                onPress={() => abrirWhatsApp(cliente.telefono, cliente.nombres, 'Titular')}
                                accessibilityRole="button"
                                activeOpacity={0.7}
                              >
                                <Text style={styles.clientWhatsappBtnText}>💬 WhatsApp</Text>
                              </TouchableOpacity>
                            </>
                          ) : null}

                          <TouchableOpacity
                            style={styles.clientGarantiasBtn}
                            onPress={() => abrirModalGarantias(primerCredito)}
                            accessibilityRole="button"
                            activeOpacity={0.7}
                          >
                            <Text style={styles.clientGarantiasBtnText}>🛡️ Garantías</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* 3. TÍTULO DE SECCIÓN DE CONTRATOS */}
                      <View style={styles.contractsSectionHeader}>
                        <Text style={styles.contractsSectionTitle}>
                          {tieneMultiples ? `CONTRATOS ACTIVOS (${contratos.length})` : 'CONTRATO ASIGNADO'}
                        </Text>
                        {tieneMultiples && (
                          <Text style={styles.contractsTotalSaldoText}>
                            Total Cartera: {formatCOP(grupo.totalSaldo)}
                          </Text>
                        )}
                      </View>

                      {/* 4. SUB-BLOQUES INDEPENDIENTES POR CONTRATO */}
                      <View style={styles.contractsSubList}>
                        {contratos.map((item, cIndex) => {
                          const saldo = Number(item.saldo_pendiente || 0);
                          const cuota = Number(item.valor_cuota || 0);
                          const yaCobrado = Boolean(
                            item.cobradoHoy ||
                            (item.id_contrato && creditosCobradosHoySet.has(String(item.id_contrato).toLowerCase())) ||
                            (item.id && creditosCobradosHoySet.has(String(item.id).toLowerCase())) ||
                            (item.numero_contrato && creditosCobradosHoySet.has(String(item.numero_contrato).toLowerCase()))
                          );

                          const targetId = item.id_contrato || item.id;
                          const numContrato = item.numero_contrato || (targetId ? `CTR-${String(targetId).slice(0, 8).toUpperCase()}` : 'CTR-RUTA');
                          const totalFinanciado = Number(item.monto_financiado || item.valorTotal || item.valor_total || 0);
                          const totalCuotas = Number(item.numero_cuotas || item.cuotas || (cuota > 0 ? Math.round(totalFinanciado / cuota) : 1)) || 1;
                          const amortizado = Math.max(0, totalFinanciado - saldo);
                          const cuotasPagadas = cuota > 0 ? Math.floor(amortizado / cuota) : 0;
                          const cuotaActual = Math.min(totalCuotas, Math.max(1, cuotasPagadas + 1));

                          // Vencimiento y exigibilidad de la cuota
                          const fechaVenc = calcularVencimientoCuota(item);
                          const esVenceHoy = Boolean(fechaVenc && fechaVenc === todayStr);
                          const esVencido = Boolean(fechaVenc && fechaVenc < todayStr);
                          const fechaVencCorta = fechaVenc ? fechaVenc.slice(5) : '';

                          // Cartera crítica (>= 3 cuotas vencidas y plazo > 2)
                          const esCritica = esCreditoCarteraCritica(item);
                          const cuotasVencidas = contarCuotasVencidas(item);

                          // Contexto del crédito: artículos y modalidad
                          let contextoArticulos = '';
                          if (Array.isArray(item.detalles) && item.detalles.length > 0) {
                            contextoArticulos = item.detalles
                              .map((d) => `${d.cantidad > 1 ? `${d.cantidad}x ` : ''}${d.producto?.nombre || d.descripcion || 'Artículo'}`)
                              .join(', ');
                          } else if (item.descripcion_articulos) {
                            contextoArticulos = item.descripcion_articulos;
                          } else if (item.articulos) {
                            contextoArticulos = item.articulos;
                          }
                          const modalidadTexto = item.tipo_pago ? String(item.tipo_pago).toUpperCase() : 'CUOTAS';

                          return (
                            <View
                              key={item.id_contrato || item.id || cIndex}
                              style={[
                                styles.contractSubCard,
                                yaCobrado && styles.contractSubCardDone,
                                esCritica && styles.contractSubCardCritica,
                              ]}
                            >
                              {/* Encabezado del Sub-bloque: Número de Contrato y Cuota */}
                              <View style={styles.contractSubHeader}>
                                <View style={styles.contractSubNumberBlock}>
                                  <Text style={styles.contractSubNumberText}>{numContrato}</Text>
                                </View>

                                <View style={styles.contractSubBadgesRow}>
                                  <View style={styles.contractSubCuotaBadge}>
                                    <Text style={styles.contractSubCuotaBadgeText}>
                                      Cuota {cuotaActual}/{totalCuotas}
                                    </Text>
                                  </View>

                                  {/* Badge de Alerta de Cartera Crítica */}
                                  {esCritica && (
                                    <View style={styles.badgeCarteraCritica}>
                                      <Text style={styles.badgeCarteraCriticaText}>
                                        🚨 {cuotasVencidas} VENCIDAS
                                      </Text>
                                    </View>
                                  )}

                                  {/* Badge de Vencimiento de Cuota */}
                                  {esVencido && !esCritica ? (
                                    <View style={styles.badgeVencido}>
                                      <Text style={styles.badgeVencidoText}>⚠️ Vence {fechaVencCorta}</Text>
                                    </View>
                                  ) : esVenceHoy ? (
                                    <View style={styles.badgeVenceHoy}>
                                      <Text style={styles.badgeVenceHoyText}>🗓️ Vence Hoy</Text>
                                    </View>
                                  ) : null}

                                  <View style={yaCobrado ? styles.badgeCobrado : styles.badgePendiente}>
                                    <Text style={yaCobrado ? styles.badgeCobradoText : styles.badgePendienteText}>
                                      {yaCobrado ? '✓ COBRADO' : 'PENDIENTE'}
                                    </Text>
                                  </View>
                                </View>
                              </View>

                              {/* Artículos Asociados y Modalidad */}
                              <View style={styles.contractSubContextRow}>
                                <Text style={styles.contextBadgeIcon}>📦</Text>
                                <Text style={styles.contractSubContextText} numberOfLines={1}>
                                  {contextoArticulos ? contextoArticulos : 'Operación a Crédito'} • {modalidadTexto}
                                </Text>
                              </View>

                              {/* Fila Financiera del Contrato */}
                              <View style={styles.contractSubFinanceRow}>
                                <View style={styles.contractSubFinanceCol}>
                                  <Text style={styles.contractSubFinanceLabel}>SALDO RESTANTE</Text>
                                  <Text style={[styles.contractSubFinanceSaldo, esCritica && { color: '#DC2626' }]}>
                                    {formatCOP(saldo)}
                                  </Text>
                                </View>
                                <View style={styles.contractSubFinanceColRight}>
                                  <Text style={styles.contractSubFinanceLabel}>VALOR CUOTA</Text>
                                  <Text style={styles.contractSubFinanceCuota}>{formatCOP(cuota)}</Text>
                                </View>
                              </View>

                              {/* Botón de Pago Individual Aislado para este Contrato */}
                              {yaCobrado ? (
                                <View style={styles.contractSubDoneBanner}>
                                  <Text style={styles.contractSubDoneBannerText}>✓ Cobrado hoy</Text>
                                </View>
                              ) : (
                                <TouchableOpacity
                                  style={styles.contractSubActionBtn}
                                  onPress={() => abrirModalAbono(item)}
                                  accessibilityRole="button"
                                  activeOpacity={0.8}
                                >
                                  <Text style={styles.contractSubActionBtnText}>💵 Registrar Abono de este Contrato</Text>
                                </TouchableOpacity>
                              )}

                              {/* Botón de Orden de Retiro por Mora Crítica */}
                              {esCritica && (
                                <TouchableOpacity
                                  style={styles.contractSubRetiroBtn}
                                  onPress={() => abrirModalRetiro(item)}
                                  accessibilityRole="button"
                                  activeOpacity={0.8}
                                >
                                  <Text style={styles.contractSubRetiroBtnText}>
                                    🚨 Registrar Orden de Retiro por Mora
                                  </Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          );
                        })}
                      </View>

                    </View>
                  );
                })}
              </View>
            )}

          </View>
        )}

        {/* ========================================================================= */}
        {/* PESTAÑA 3: PROYECCIÓN / PRÓXIMOS VENCIMIENTOS                             */}
        {/* ========================================================================= */}
        {activeTab === 'proyeccion' && (
          <View style={styles.proyeccionSectionWrapper}>
            
            {/* BANNER INFORMATIVO Y KPI GENERAL */}
            <View style={styles.proyeccionBanner}>
              <View style={styles.proyeccionBannerHeader}>
                <View style={styles.proyeccionIconBox}>
                  <Text style={styles.proyeccionIcon}>📅</Text>
                </View>
                <View style={styles.proyeccionBannerTitleCol}>
                  <Text style={styles.proyeccionBannerTitle}>Proyección de Cartera</Text>
                  <Text style={styles.proyeccionBannerSub}>Calendario de Pagos y Próximos Vencimientos</Text>
                </View>
              </View>

              {/* Total Proyectado Card */}
              <View style={styles.proyeccionKpiBox}>
                <Text style={styles.proyeccionKpiLabel}>
                  RECAUDO PROYECTADO ({filtroPeriodoProyeccion === 'manana' ? 'MAÑANA' : filtroPeriodoProyeccion === 'semana' ? 'PRÓXIMA SEMANA' : filtroPeriodoProyeccion === 'mes' ? 'ESTE MES' : 'TOTAL CARTERA'})
                </Text>
                <Text style={styles.proyeccionKpiAmount}>
                  {formatCOP(
                    filtroPeriodoProyeccion === 'manana'
                      ? metricasProyeccion.valorManana
                      : filtroPeriodoProyeccion === 'semana'
                      ? metricasProyeccion.valorSemana
                      : filtroPeriodoProyeccion === 'mes'
                      ? metricasProyeccion.valorMes
                      : metricasProyeccion.valorTotal
                  )}
                </Text>
                <Text style={styles.proyeccionKpiCount}>
                  {proyeccionFiltrada.length} contratos programados con cuotas por vencer
                </Text>
              </View>
            </View>

            {/* SELECTOR DE FILTROS DE TIEMPO (MAÑANA / SEMANA / MES / TODOS) */}
            <View style={styles.periodFilterWrapper}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodFilterRow}>
                <TouchableOpacity
                  style={[styles.periodPill, filtroPeriodoProyeccion === 'manana' && styles.periodPillActive]}
                  onPress={() => setFiltroPeriodoProyeccion('manana')}
                  accessibilityRole="button"
                >
                  <Text style={[styles.periodPillText, filtroPeriodoProyeccion === 'manana' && styles.periodPillTextActive]}>
                    Mañana ({metricasProyeccion.countManana})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.periodPill, filtroPeriodoProyeccion === 'semana' && styles.periodPillActive]}
                  onPress={() => setFiltroPeriodoProyeccion('semana')}
                  accessibilityRole="button"
                >
                  <Text style={[styles.periodPillText, filtroPeriodoProyeccion === 'semana' && styles.periodPillTextActive]}>
                    Próx. Semana ({metricasProyeccion.countSemana})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.periodPill, filtroPeriodoProyeccion === 'mes' && styles.periodPillActive]}
                  onPress={() => setFiltroPeriodoProyeccion('mes')}
                  accessibilityRole="button"
                >
                  <Text style={[styles.periodPillText, filtroPeriodoProyeccion === 'mes' && styles.periodPillTextActive]}>
                    Este Mes ({metricasProyeccion.countMes})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.periodPill, filtroPeriodoProyeccion === 'todos' && styles.periodPillActive]}
                  onPress={() => setFiltroPeriodoProyeccion('todos')}
                  accessibilityRole="button"
                >
                  <Text style={[styles.periodPillText, filtroPeriodoProyeccion === 'todos' && styles.periodPillTextActive]}>
                    Todos ({metricasProyeccion.countTotal})
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            </View>

            {/* BARRA DE BÚSQUEDA */}
            <View style={styles.searchBar}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Buscar por cliente, cédula o contrato..."
                placeholderTextColor="#94A3B8"
                value={busquedaProyeccion}
                onChangeText={setBusquedaProyeccion}
                clearButtonMode="while-editing"
              />
              {busquedaProyeccion ? (
                <TouchableOpacity onPress={() => setBusquedaProyeccion('')}>
                  <Text style={styles.clearSearchIcon}>✕</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* LISTADO DE CONTRATOS PROYECTADOS */}
            {isLoadingProyeccion && creditosProyeccion.length === 0 ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color="#059669" />
                <Text style={styles.loadingText}>Calculando proyección de cartera...</Text>
              </View>
            ) : proyeccionFiltrada.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyIcon}>📅</Text>
                <Text style={styles.emptyTitle}>Sin vencimientos en este periodo</Text>
                <Text style={styles.emptySubtitle}>
                  No se encontraron créditos programados para el filtro seleccionado.
                </Text>
              </View>
            ) : (
              <View style={styles.proyeccionList}>
                {proyeccionFiltrada.map((item, idx) => {
                  const cliente = item.cliente || {};
                  const saldo = Number(item.saldo_pendiente || 0);
                  const cuota = Number(item.valor_cuota || item.proximaCuota?.monto || 0);
                  const fVenc = item.fechaVencimientoCalculada;
                  const dias = item.diasParaVencer;

                  // Estado del vencimiento
                  let badgeColorStyle = styles.badgeFuture;
                  let badgeTextStyle = styles.badgeFutureText;
                  let vencLabel = `📅 Vence: ${fVenc}`;

                  if (fVenc === tomorrowStr) {
                    badgeColorStyle = styles.badgeTomorrow;
                    badgeTextStyle = styles.badgeTomorrowText;
                    vencLabel = `⏰ Vence Mañana (${fVenc})`;
                  } else if (dias > 1 && dias <= 7) {
                    badgeColorStyle = styles.badgeWeek;
                    badgeTextStyle = styles.badgeWeekText;
                    vencLabel = `⚡ En ${dias} días (${fVenc})`;
                  } else if (dias > 7) {
                    badgeColorStyle = styles.badgeFuture;
                    badgeTextStyle = styles.badgeFutureText;
                    vencLabel = `📅 En ${dias} días (${fVenc})`;
                  } else if (fVenc === todayStr) {
                    badgeColorStyle = styles.badgeToday;
                    badgeTextStyle = styles.badgeTodayText;
                    vencLabel = `📌 Vence Hoy (${fVenc})`;
                  } else if (fVenc && fVenc < todayStr) {
                    badgeColorStyle = styles.badgeOverdue;
                    badgeTextStyle = styles.badgeOverdueText;
                    vencLabel = `⚠️ Vencido (${fVenc})`;
                  }

                  const cuotas = item.cuotasDesglose || [];
                  const cuotasPagadasTotal = cuotas.filter(q => q.pagada).length;

                  return (
                    <View key={item.id_contrato || item.id || idx} style={styles.proyeccionCard}>
                      {/* CABECERA: CLIENTE Y CONTRATO */}
                      <View style={styles.proyeccionCardHeader}>
                        <View style={styles.proyeccionClientCol}>
                          <Text style={styles.proyeccionClientName} numberOfLines={1}>
                            {cliente.nombres || 'Cliente Titular'}
                          </Text>
                          <Text style={styles.proyeccionClientDoc}>
                            C.C. {cliente.cedula || 'S/N'} {cliente.barrio ? `• ${cliente.barrio}` : ''}
                          </Text>
                          {cliente.direccion ? (
                            <Text style={styles.proyeccionClientDir} numberOfLines={1}>
                              📍 {cliente.direccion}
                            </Text>
                          ) : null}
                        </View>
                        <View style={styles.proyeccionContractCol}>
                          <View style={styles.proyeccionContractBadge}>
                            <Text style={styles.proyeccionContractBadgeText}>
                              {item.numero_contrato || 'CTR'}
                            </Text>
                          </View>
                        </View>
                      </View>

                      {/* BADGE DE ALERTA DE CARTERA CRÍTICA */}
                      {esCreditoCarteraCritica(item) && (
                        <View style={styles.badgeCarteraCriticaProy}>
                          <Text style={styles.badgeCarteraCriticaText}>
                            🚨 CARTERA CRÍTICA ({contarCuotasVencidas(item)} CUOTAS VENCIDAS)
                          </Text>
                        </View>
                      )}

                      {/* BADGE DE VENCIMIENTO PROGRAMADO */}
                      <View style={[styles.vencimientoBadge, badgeColorStyle]}>
                        <Text style={[styles.vencimientoBadgeText, badgeTextStyle]}>
                          {vencLabel}
                        </Text>
                      </View>

                      {/* RESUMEN FINANCIERO */}
                      <View style={styles.proyeccionFinanceRow}>
                        <View style={styles.proyeccionFinanceBlock}>
                          <Text style={styles.proyeccionFinanceLabel}>PRÓXIMA CUOTA</Text>
                          <Text style={styles.proyeccionCuotaAmount}>{formatCOP(cuota)}</Text>
                          <Text style={styles.proyeccionFinanceFreq}>
                            Frecuencia {item.tipo_pago || 'Mensual'}
                          </Text>
                        </View>
                        <View style={[styles.proyeccionFinanceBlock, styles.proyeccionFinanceBlockRight]}>
                          <Text style={styles.proyeccionFinanceLabel}>SALDO RESTANTE</Text>
                          <Text style={[styles.proyeccionSaldoAmount, esCreditoCarteraCritica(item) && { color: '#DC2626' }]}>
                            {formatCOP(saldo)}
                          </Text>
                          <Text style={styles.proyeccionFinanceTotal}>
                            Total: {formatCOP(item.monto_financiado || item.valor_total || 0)}
                          </Text>
                        </View>
                      </View>

                      {/* DESGLOSE DE CUOTAS CON CHULOS DE VERIFICACIÓN */}
                      <View style={styles.cuotasTimelineWrapper}>
                        <Text style={styles.cuotasTimelineHeading}>
                          CRONOGRAMA DE CUOTAS ({cuotasPagadasTotal}/{cuotas.length} PAGADAS):
                        </Text>
                        <ScrollView
                          horizontal={true}
                          showsHorizontalScrollIndicator={true}
                          nestedScrollEnabled={true}
                          keyboardShouldPersistTaps="handled"
                          style={[
                            styles.cuotasChipsScroll,
                            Platform.OS === 'web' ? { overflowX: 'auto', WebkitOverflowScrolling: 'touch' } : {}
                          ]}
                          contentContainerStyle={[styles.cuotasChipsRow, { paddingRight: 20 }]}
                        >
                          {cuotas.map((q) => {
                            const isPagada = Boolean(q.pagada);
                            const isParcial = Boolean(q.es_parcial);
                            const hasArrastre = !isPagada && Number(q.monto_arrastrado || 0) > 0;

                            let chipStyle = styles.cuotaChipPendiente;
                            let textStyle = styles.cuotaChipTextPendiente;
                            let dateStyle = styles.cuotaChipDatePendiente;

                            if (isPagada) {
                              chipStyle = styles.cuotaChipPagada;
                              textStyle = styles.cuotaChipTextPagada;
                              dateStyle = styles.cuotaChipDatePagada;
                            } else if (isParcial) {
                              chipStyle = styles.cuotaChipParcial;
                              textStyle = styles.cuotaChipTextParcial;
                              dateStyle = styles.cuotaChipDateParcial;
                            } else if (hasArrastre) {
                              chipStyle = styles.cuotaChipArrastre;
                              textStyle = styles.cuotaChipTextArrastre;
                              dateStyle = styles.cuotaChipDateArrastre;
                            }

                            let tituloTexto = `⏳ C${q.numero}: ${formatCOP(q.monto)}`;
                            if (isPagada) {
                              tituloTexto = `✓ C${q.numero} Pagada`;
                            } else if (isParcial) {
                              tituloTexto = `🟡 C${q.numero} Parcial: ${formatCOP(q.valor_pagado || 0)}`;
                            } else if (hasArrastre) {
                              tituloTexto = `⚠️ C${q.numero}: ${formatCOP(q.valor_exigible || q.monto)}`;
                            }

                            let subTexto = q.fecha;
                            if (isParcial) {
                              subTexto = `Faltan: ${formatCOP(q.saldo_cuota || 0)}`;
                            } else if (hasArrastre) {
                              subTexto = `(+${formatCOP(q.monto_arrastrado)} arrastre)`;
                            }

                            return (
                              <View key={q.numero} style={[styles.cuotaChip, chipStyle]}>
                                <Text style={[styles.cuotaChipText, textStyle]} numberOfLines={1}>
                                  {tituloTexto}
                                </Text>
                                {subTexto ? (
                                  <Text style={[styles.cuotaChipDate, dateStyle]} numberOfLines={1}>
                                    {subTexto}
                                  </Text>
                                ) : null}
                              </View>
                            );
                          })}
                        </ScrollView>
                      </View>

                      {/* ACCIONES DEL COBRADOR */}
                      <View style={styles.proyeccionActionsRow}>
                        {cliente.telefono ? (
                          <TouchableOpacity
                            style={styles.actionBtnCall}
                            onPress={() => hacerLlamada(cliente.telefono)}
                            accessibilityRole="button"
                          >
                            <Text style={styles.actionBtnCallText}>📞 Llamar</Text>
                          </TouchableOpacity>
                        ) : null}

                        {cliente.telefono ? (
                          <TouchableOpacity
                            style={styles.actionBtnWa}
                            onPress={() => abrirWhatsApp(cliente.telefono, cliente.nombres, 'Titular')}
                            accessibilityRole="button"
                          >
                            <Text style={styles.actionBtnWaText}>💬 WhatsApp</Text>
                          </TouchableOpacity>
                        ) : null}

                        <TouchableOpacity
                          style={styles.actionBtnGarantias}
                          onPress={() => abrirModalGarantias(item)}
                          accessibilityRole="button"
                        >
                          <Text style={styles.actionBtnGarantiasText}>🛡️ Respaldo</Text>
                        </TouchableOpacity>

                        {esCreditoCarteraCritica(item) && (
                          <TouchableOpacity
                            style={styles.actionBtnRetiro}
                            onPress={() => abrirModalRetiro(item)}
                            accessibilityRole="button"
                          >
                            <Text style={styles.actionBtnRetiroText}>🚨 Retiro</Text>
                          </TouchableOpacity>
                        )}

                        <TouchableOpacity
                          style={styles.actionBtnCobrar}
                          onPress={() => abrirModalAbono(item)}
                          accessibilityRole="button"
                        >
                          <Text style={styles.actionBtnCobrarText}>💵 Cobrar</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

          </View>
        )}

      </ScrollView>

      {/* ========================================================================= */}
      {/* MODAL DE REGISTRO DE ABONO                                                */}
      {/* ========================================================================= */}
      <InFrameModal
        visible={modalAbonoVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setModalAbonoVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            
            {/* Cabecera del Modal */}
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalHeading}>Registrar Recaudo en Terreno</Text>
                <Text style={styles.modalSubheading}>
                  {creditoSeleccionado?.cliente?.nombres || 'Cliente'} • {creditoSeleccionado?.numero_contrato || 'Contrato'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setModalAbonoVisible(false)}
              >
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.modalScrollBody}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalScrollContent}
            >
              {/* Pastilla Informativa de Cuota Actual y Progreso de Recaudo */}
              {(() => {
                const vCuota = Number(creditoSeleccionado?.valor_cuota || 0);
                const mFinanciado = Number(creditoSeleccionado?.monto_financiado || creditoSeleccionado?.valor_total || 0);
                const sPendiente = Number(creditoSeleccionado?.saldo_pendiente || 0);
                const tCuotas = Number(creditoSeleccionado?.numero_cuotas || creditoSeleccionado?.cuotas || (vCuota > 0 ? Math.round(mFinanciado / vCuota) : 1)) || 1;
                const amort = Math.max(0, mFinanciado - sPendiente);
                const cPagas = vCuota > 0 ? Math.floor(amort / vCuota) : 0;
                const cActual = Math.min(tCuotas, Math.max(1, cPagas + 1));

                return (
                  <View style={styles.cuotaPillContainer}>
                    <View style={styles.cuotaPillBadge}>
                      <Text style={styles.cuotaPillIcon}>🗓️</Text>
                      <Text style={styles.cuotaPillText}>
                        Próximo Cobro: Cuota {cActual} de {tCuotas}
                      </Text>
                    </View>
                    <Text style={styles.cuotaPillSub}>
                      {formatCOP(vCuota)} / cuota
                    </Text>
                  </View>
                );
              })()}

              {/* Caja de Geolocalización GPS */}
              <View style={styles.gpsBox}>
                <View style={styles.gpsHeaderRow}>
                  <View style={styles.gpsPulseDot} />
                  <Text style={styles.gpsTitle}>Georreferenciación Satelital de Cobro</Text>
                </View>
                {isCapturingGps ? (
                  <View style={styles.gpsLoadingRow}>
                    <ActivityIndicator size="small" color="#2563EB" />
                    <Text style={styles.gpsCoordText}>Fijando coordenadas satelitales en terreno...</Text>
                  </View>
                ) : (
                  <View>
                    <Text style={styles.gpsCoordText}>
                      Lat: {gpsCoords ? Number(gpsCoords.latitud).toFixed(6) : '8.756412'} • Lon: {gpsCoords ? Number(gpsCoords.longitud).toFixed(6) : '-75.884129'}
                    </Text>
                    <Text style={styles.gpsPrecText}>
                      {gpsStatusText}
                    </Text>
                  </View>
                )}
              </View>

              {/* Chips de Selección Rápida de Monto a Recaudar */}
              {(() => {
                const vCuota = Number(creditoSeleccionado?.valor_cuota || 0);
                const mFinanciado = Number(creditoSeleccionado?.monto_financiado || creditoSeleccionado?.valor_total || 0);
                const sPendiente = Number(creditoSeleccionado?.saldo_pendiente || 0);
                const tCuotas = Number(creditoSeleccionado?.numero_cuotas || creditoSeleccionado?.cuotas || (vCuota > 0 ? Math.round(mFinanciado / vCuota) : 1)) || 1;

                const cuotas = obtenerCuotasConChulos(creditoSeleccionado);
                const cuotaActualObj = cuotas.find((q) => !q.pagada) || cuotas[cuotas.length - 1];
                const cActual = cuotaActualObj?.numero || 1;
                const cSiguiente = Math.min(tCuotas, cActual + 1);

                const montoCuotaActual = Math.round(Number(cuotaActualObj?.saldo_cuota || cuotaActualObj?.valor_exigible || vCuota || 0));
                const montoCuotaSiguiente = Math.round(Number(cuotas.find((q) => q.numero === cSiguiente)?.valor_exigible || vCuota || 0));
                const montoDosCuotas = cActual < tCuotas ? (montoCuotaActual + montoCuotaSiguiente) : 0;

                const currentValNum = parseFloat(String(montoAbono).replace(/[^0-9.-]+/g, '')) || 0;
                const isSelected1 = currentValNum === montoCuotaActual && montoCuotaActual > 0;
                const isSelected2 = montoDosCuotas > 0 ? (currentValNum === montoDosCuotas) : (currentValNum === Math.round(sPendiente) && sPendiente > 0);

                return (
                  <View style={styles.quickChipsContainer}>
                    <TouchableOpacity
                      style={[
                        styles.quickChip,
                        isSelected1 && styles.quickChipActive,
                        isSubmittingAbono && styles.buttonDisabled,
                      ]}
                      disabled={isSubmittingAbono}
                      onPress={() => {
                        if (montoCuotaActual > 0) {
                          setMontoAbono(String(montoCuotaActual));
                        }
                      }}
                    >
                      <Text style={[styles.quickChipText, isSelected1 && styles.quickChipTextActive]}>
                        Pagar Cuota #{cActual} ({formatCOP(montoCuotaActual)})
                      </Text>
                    </TouchableOpacity>

                    {montoDosCuotas > 0 && cActual < tCuotas ? (
                      <TouchableOpacity
                        style={[
                          styles.quickChip,
                          isSelected2 && styles.quickChipActive,
                          isSubmittingAbono && styles.buttonDisabled,
                        ]}
                        disabled={isSubmittingAbono}
                        onPress={() => {
                          if (montoDosCuotas > 0) {
                            setMontoAbono(String(montoDosCuotas));
                          }
                        }}
                      >
                        <Text style={[styles.quickChipText, isSelected2 && styles.quickChipTextActive]}>
                          Pagar 2 Cuotas (#{cActual} y #{cSiguiente}) ({formatCOP(montoDosCuotas)})
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[
                          styles.quickChip,
                          isSelected2 && styles.quickChipActive,
                          isSubmittingAbono && styles.buttonDisabled,
                        ]}
                        disabled={isSubmittingAbono}
                        onPress={() => {
                          if (sPendiente > 0) {
                            setMontoAbono(String(Math.round(sPendiente)));
                          } else if (montoCuotaActual > 0) {
                            setMontoAbono(String(montoCuotaActual));
                          }
                        }}
                      >
                        <Text style={[styles.quickChipText, isSelected2 && styles.quickChipTextActive]}>
                          Liquidar Saldo ({formatCOP(sPendiente || montoCuotaActual)})
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })()}

              {/* Input de Monto */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>VALOR A RECAUDAR ($ COP)</Text>
                <TextInput
                  style={styles.montoInput}
                  keyboardType="numeric"
                  editable={!isSubmittingAbono}
                  value={montoAbono}
                  onChangeText={setMontoAbono}
                  placeholder="0"
                  placeholderTextColor="#94A3B8"
                />
              </View>

              {/* Lienzo de Firma Digital Manuscrita del Cliente Titular */}
              <View style={styles.signatureContainer}>
                <SignatureCanvas
                  label="Firma de Conformidad del Cliente"
                  subtitle="Firme con el dedo o lápiz óptico dentro del recuadro"
                  obligatorio={true}
                  signerName={creditoSeleccionado?.cliente?.nombres || 'Cliente Titular'}
                  signerDoc={creditoSeleccionado?.cliente?.cedula || ''}
                  value={firmaCliente}
                  onChange={setFirmaCliente}
                  height={125}
                />
              </View>

              {/* Lienzo de Firma Digital Manuscrita del Cobrador Autorizado */}
              <View style={styles.signatureContainer}>
                <SignatureCanvas
                  label="Firma del Cobrador Autorizado en Ruta"
                  subtitle="Firme con el dedo o lápiz óptico para certificar el recaudo"
                  obligatorio={true}
                  signerName={user?.nombre || user?.nombre_completo || 'Pedro Cobrador'}
                  signerDoc="Cobrador en Ruta"
                  value={firmaCobrador}
                  onChange={setFirmaCobrador}
                  height={125}
                />
              </View>

              {/* Botones de Confirmación con Protección Anti-Doble Clic */}
              <TouchableOpacity
                style={[styles.confirmPaymentBtn, isSubmittingAbono && styles.confirmPaymentBtnDisabled]}
                onPress={handleConfirmarAbono}
                disabled={isSubmittingAbono}
                activeOpacity={isSubmittingAbono ? 1 : 0.7}
                accessibilityRole="button"
                accessibilityState={{ disabled: isSubmittingAbono, busy: isSubmittingAbono }}
              >
                {isSubmittingAbono ? (
                  <View style={styles.btnLoadingRow}>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                    <Text style={styles.confirmPaymentBtnText}>Transmitiendo Recaudo...</Text>
                  </View>
                ) : (
                  <Text style={styles.confirmPaymentBtnText}>✓ Confirmar y Registrar Pago</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.cancelPaymentBtn}
                onPress={() => {
                  if (!isSubmittingAbono) {
                    isSubmittingAbonoRef.current = false;
                    setIsSubmittingAbono(false);
                    setModalAbonoVisible(false);
                  }
                }}
                disabled={isSubmittingAbono}
              >
                <Text style={styles.cancelPaymentBtnText}>Cancelar Operación</Text>
              </TouchableOpacity>
            </ScrollView>

          </View>
        </View>
      </InFrameModal>

      {/* ========================================================================= */}
      {/* MODAL DE COMPROBANTE DIGITAL DE RECIBO (PAGO TOTAL VS ABONO PARCIAL)      */}
      {/* ========================================================================= */}
      <InFrameModal
        visible={!!reciboExitoso}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setReciboExitoso(null)}
      >
        <View style={styles.modalBackdropCenter}>
          <View style={styles.receiptCard}>
            
            {/* CABECERA CON DIFERENCIACIÓN VISUAL */}
            <View style={styles.receiptHeader}>
              <View
                style={[
                  styles.receiptCheckBadge,
                  reciboExitoso?.offline
                    ? { backgroundColor: '#FEF3C7' }
                    : reciboExitoso?.es_abono_parcial
                    ? { backgroundColor: '#FEF3C7' }
                    : { backgroundColor: '#DCFCE7' },
                ]}
              >
                <Text
                  style={[
                    styles.receiptCheckIcon,
                    reciboExitoso?.offline
                      ? { color: '#B45309' }
                      : reciboExitoso?.es_abono_parcial
                      ? { color: '#D97706' }
                      : { color: '#15803D' },
                  ]}
                >
                  {reciboExitoso?.offline ? '⏱' : reciboExitoso?.es_abono_parcial ? '⚠️' : '✓'}
                </Text>
              </View>

              <Text
                style={[
                  styles.receiptBadge,
                  reciboExitoso?.offline
                    ? { color: '#B45309' }
                    : reciboExitoso?.es_abono_parcial
                    ? { color: '#B45309' }
                    : { color: '#047857' },
                ]}
              >
                {reciboExitoso?.offline
                  ? 'PAGO EN COLA LOCAL (OFFLINE)'
                  : reciboExitoso?.es_abono_parcial
                  ? 'ABONO PARCIAL A CUOTA'
                  : 'PAGO TOTAL DE CUOTA'}
              </Text>

              <Text style={styles.receiptTitle}>
                {reciboExitoso?.es_abono_parcial
                  ? 'Recibo de Abono Parcial'
                  : 'Recibo de Pago de Cuota'}
              </Text>

              <Text style={styles.receiptSub}>
                {reciboExitoso?.offline
                  ? 'Guardado en cola offline • Se sincronizará automáticamente'
                  : reciboExitoso?.es_abono_parcial
                  ? 'Saldo insoluto trasladado a la siguiente cuota programada'
                  : 'Cuota cancelada en su totalidad sin saldo pendiente'}
              </Text>
            </View>

            {reciboExitoso && (
              <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                <View style={styles.receiptBody}>
                  
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptKey}>No. Recibo:</Text>
                    <Text style={styles.receiptValMono}>
                      {String(reciboExitoso.id_recibo).slice(0, 12).toUpperCase()}
                    </Text>
                  </View>

                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptKey}>Cliente Titular:</Text>
                    <Text style={styles.receiptVal}>{reciboExitoso.cliente}</Text>
                  </View>

                  {reciboExitoso.numero_contrato ? (
                    <View style={styles.receiptRow}>
                      <Text style={styles.receiptKey}>No. Contrato:</Text>
                      <Text style={styles.receiptVal}>{reciboExitoso.numero_contrato}</Text>
                    </View>
                  ) : null}

                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptKey}>Cobrador en Ruta:</Text>
                    <Text style={styles.receiptVal}>
                      {reciboExitoso.cobrador_nombre || reciboExitoso.cobrador || user?.nombre || 'Pedro Cobrador'}
                    </Text>
                  </View>

                  {reciboExitoso.cuota_texto ? (
                    <View style={styles.receiptRow}>
                      <Text style={styles.receiptKey}>Concepto / Cuota:</Text>
                      <Text
                        style={[
                          styles.receiptVal,
                          {
                            color: reciboExitoso.es_abono_parcial ? '#B45309' : '#047857',
                            fontWeight: '800',
                          },
                        ]}
                      >
                        📌 {reciboExitoso.cuota_texto}
                      </Text>
                    </View>
                  ) : null}

                  {/* MONTO RECAUDADO DESTACADO */}
                  <View
                    style={[
                      styles.receiptRowHighlight,
                      reciboExitoso.es_abono_parcial && {
                        backgroundColor: '#FFFBEB',
                        borderColor: '#FDE68A',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.receiptKeyHighlight,
                        reciboExitoso.es_abono_parcial && { color: '#B45309' },
                      ]}
                    >
                      VALOR RECAUDADO:
                    </Text>
                    <Text
                      style={[
                        styles.receiptValHighlight,
                        reciboExitoso.es_abono_parcial && { color: '#B45309' },
                      ]}
                    >
                      {formatCOP(reciboExitoso.valor)}
                    </Text>
                  </View>

                  {/* DESGLOSE EXCLUSIVO DE SALDO INSOLUTO (ABONO PARCIAL) */}
                  {reciboExitoso.es_abono_parcial ? (
                    <View style={styles.insolutoCard}>
                      <View style={styles.insolutoCardHeader}>
                        <Text style={styles.insolutoIcon}>⚠️</Text>
                        <Text style={styles.insolutoHeading}>AUDITORÍA DE SALDO INSOLUTO</Text>
                      </View>
                      
                      <View style={styles.insolutoDataRow}>
                        <Text style={styles.insolutoLabel}>Valor Cuota Exigible:</Text>
                        <Text style={styles.insolutoValue}>{formatCOP(reciboExitoso.valor_cuota_exigible)}</Text>
                      </View>

                      <View style={styles.insolutoDataRow}>
                        <Text style={styles.insolutoLabel}>Monto Abonado Hoy:</Text>
                        <Text style={[styles.insolutoValue, { color: '#059669' }]}>- {formatCOP(reciboExitoso.valor)}</Text>
                      </View>

                      <View style={[styles.insolutoDataRow, styles.insolutoHighlightRow]}>
                        <Text style={styles.insolutoHighlightLabel}>Saldo Insoluto (Déficit):</Text>
                        <Text style={styles.insolutoHighlightValue}>{formatCOP(reciboExitoso.saldo_insoluto)}</Text>
                      </View>

                      <View style={styles.insolutoDataRow}>
                        <Text style={styles.insolutoLabel}>
                          Exigible Cuota #{reciboExitoso.cuota_siguiente_numero || 2}:
                        </Text>
                        <Text style={[styles.insolutoValue, { color: '#4338CA', fontWeight: '900' }]}>
                          {formatCOP(reciboExitoso.valor_cuota_siguiente)}
                        </Text>
                      </View>

                      <Text style={styles.insolutoNotice}>
                        ℹ️ El saldo insoluto de {formatCOP(reciboExitoso.saldo_insoluto)} se suma automáticamente al valor exigible de la cuota #{reciboExitoso.cuota_siguiente_numero || 2}.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.pagoTotalBadgeBox}>
                      <Text style={styles.pagoTotalBadgeText}>
                        ✓ Cuota liquidada al 100% • Sin saldo insoluto arrastrado ($0)
                      </Text>
                    </View>
                  )}

                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptKey}>Método de Pago:</Text>
                    <Text style={styles.receiptVal}>💵 Efectivo en Terreno</Text>
                  </View>

                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptKey}>Nuevo Saldo del Crédito:</Text>
                    <Text style={styles.receiptVal}>{formatCOP(reciboExitoso.nuevoSaldo)}</Text>
                  </View>

                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptKey}>Hora de Registro:</Text>
                    <Text style={styles.receiptVal}>{reciboExitoso.fecha}</Text>
                  </View>

                  {reciboExitoso.firma_cliente ? (
                    <View style={styles.receiptRow}>
                      <Text style={styles.receiptKey}>Firma del Cliente:</Text>
                      <Text style={[styles.receiptVal, { color: '#059669', fontWeight: 'bold' }]}>
                        ✓ Capturada y Validada
                      </Text>
                    </View>
                  ) : null}

                  {reciboExitoso.firma_cobrador ? (
                    <View style={styles.receiptRow}>
                      <Text style={styles.receiptKey}>Firma del Cobrador:</Text>
                      <Text style={[styles.receiptVal, { color: '#059669', fontWeight: 'bold' }]}>
                        ✓ Certificada en Terreno
                      </Text>
                    </View>
                  ) : null}

                  {/* CAJA CON NOMBRE FORMATEADO DEL ARCHIVO PDF */}
                  <View style={styles.receiptFilenameBox}>
                    <Text style={styles.receiptFilenameLabel}>📄 COMPROBANTE OFICIAL PDF:</Text>
                    <Text style={styles.receiptFilenameText} numberOfLines={1} ellipsizeMode="middle">
                      {reciboExitoso.nombre_archivo_pdf}
                    </Text>
                  </View>

                </View>
              </ScrollView>
            )}

            {/* ACCIONES Y DISPARADORES DE ENVÍO Y DESCARGA */}
            <View style={styles.receiptActionsCol}>
              
              {/* BOTÓN DESCARGAR PDF */}
              <TouchableOpacity
                style={styles.receiptDownloadBtn}
                onPress={() => handleDescargarReciboPdf(reciboExitoso?.id_recibo)}
                disabled={isDownloadingPdf}
                activeOpacity={0.8}
              >
                {isDownloadingPdf ? (
                  <View style={styles.btnLoadingRow}>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                    <Text style={styles.receiptDownloadBtnText}>Descargando PDF...</Text>
                  </View>
                ) : (
                  <Text style={styles.receiptDownloadBtnText}>📥 Descargar Comprobante PDF</Text>
                )}
              </TouchableOpacity>

              {/* BOTONES COMPARTIR WHATSAPP & CORREO */}
              <View style={styles.receiptShareRow}>
                <TouchableOpacity
                  style={styles.receiptShareBtnWa}
                  onPress={handleCompartirReciboWhatsApp}
                  activeOpacity={0.8}
                >
                  <Text style={styles.receiptShareBtnWaText}>💬 WhatsApp</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.receiptShareBtnMail}
                  onPress={handleCompartirReciboEmail}
                  activeOpacity={0.8}
                >
                  <Text style={styles.receiptShareBtnMailText}>✉️ Correo</Text>
                </TouchableOpacity>
              </View>

              {/* NAVEGACIÓN DIRECTA */}
              <TouchableOpacity
                style={styles.receiptViewRecaudosBtn}
                onPress={() => {
                  setReciboExitoso(null);
                  setActiveTab('recaudos');
                }}
              >
                <Text style={styles.receiptViewRecaudosBtnText}>💵 Ver en Mis Recaudos del Día</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.receiptCloseBtn}
                onPress={() => setReciboExitoso(null)}
              >
                <Text style={styles.receiptCloseBtnText}>Continuar Ruta →</Text>
              </TouchableOpacity>
            </View>

          </View>
        </View>
      </InFrameModal>

      {/* ========================================================================= */}
      {/* MODAL DE ORDEN DE RETIRO POR MORA CRÍTICA                                 */}
      {/* ========================================================================= */}
      <InFrameModal
        visible={modalRetiroVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setModalRetiroVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            
            {/* Cabecera del Modal */}
            <View style={[styles.modalHeader, styles.modalHeaderRetiro]}>
              <View>
                <Text style={styles.modalHeadingRetiro}>🚨 Orden de Retiro por Mora Crítica</Text>
                <Text style={styles.modalSubheadingRetiro}>
                  {creditoRetiro?.cliente?.nombres || 'Cliente'} • {creditoRetiro?.numero_contrato || 'Contrato'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setModalRetiroVisible(false)}
              >
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.modalScrollBody}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalScrollContent}
            >
              {/* Alerta de Causal Legal */}
              <View style={styles.retiroAlertBanner}>
                <Text style={styles.retiroAlertTitle}>
                  ⚠️ DILIGENCIA DE RECUPERACIÓN PRENDARIA
                </Text>
                <Text style={styles.retiroAlertText}>
                  Este contrato acumula {contarCuotasVencidas(creditoRetiro)} cuotas en mora vencidas (≥ 3). Procede la restitución de los artículos financiados con reserva de dominio.
                </Text>
              </View>

              {/* Ficha Resumen del Contrato */}
              <View style={styles.retiroInfoCard}>
                <View style={styles.retiroInfoRow}>
                  <Text style={styles.retiroInfoLabel}>Cliente Titular:</Text>
                  <Text style={styles.retiroInfoValue} numberOfLines={1}>
                    {creditoRetiro?.cliente?.nombres || 'Cliente'} {creditoRetiro?.cliente?.apellidos || ''}
                  </Text>
                </View>
                <View style={styles.retiroInfoRow}>
                  <Text style={styles.retiroInfoLabel}>Cédula / Documento:</Text>
                  <Text style={styles.retiroInfoValue}>
                    {creditoRetiro?.cliente?.documento_numero || creditoRetiro?.cliente?.cedula || 'No registrada'}
                  </Text>
                </View>
                <View style={styles.retiroInfoRow}>
                  <Text style={styles.retiroInfoLabel}>Dirección Diligencia:</Text>
                  <Text style={styles.retiroInfoValue} numberOfLines={1}>
                    {creditoRetiro?.cliente?.direccion || 'Montería'}
                  </Text>
                </View>
                <View style={styles.retiroInfoRow}>
                  <Text style={styles.retiroInfoLabel}>Saldo Pendiente:</Text>
                  <Text style={[styles.retiroInfoValue, { color: '#991B1B', fontWeight: 'bold' }]}>
                    {formatCOP(creditoRetiro?.saldo_pendiente || 0)}
                  </Text>
                </View>
                <View style={styles.retiroInfoRow}>
                  <Text style={styles.retiroInfoLabel}>Plazo Contractual:</Text>
                  <Text style={styles.retiroInfoValue}>
                    {creditoRetiro?.numero_cuotas || 0} cuotas ({creditoRetiro?.tipo_pago || 'Mensual'})
                  </Text>
                </View>
              </View>

              {/* Lista de Artículos Sujetos a Restitución */}
              <View style={styles.retiroArticulosSection}>
                <Text style={styles.retiroSectionHeading}>📦 ARTÍCULOS SUJETOS A RESTITUCIÓN:</Text>
                {Array.isArray(creditoRetiro?.detalles) && creditoRetiro.detalles.length > 0 ? (
                  creditoRetiro.detalles.map((d, i) => (
                    <View key={i} style={styles.retiroArticuloItem}>
                      <Text style={styles.retiroArticuloBullet}>•</Text>
                      <Text style={styles.retiroArticuloText}>
                        <Text style={{ fontWeight: 'bold' }}>{d.cantidad}x </Text>
                        {d.producto?.nombre || d.descripcion || 'Artículo'}
                        {d.producto?.sku ? ` (SKU: ${d.producto.sku})` : ''}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.retiroArticuloTextEmpty}>
                    Bienes muebles pactados en contrato de compraventa a crédito.
                  </Text>
                )}
              </View>

              {/* Campo de Motivo */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>MOTIVO FORMAL DE RESTITUCIÓN</Text>
                <TextInput
                  style={[styles.montoInput, { fontSize: 13, height: 44, textAlign: 'left', paddingHorizontal: 12 }]}
                  editable={!isSubmittingRetiro}
                  value={motivoRetiro}
                  onChangeText={setMotivoRetiro}
                  placeholder="Motivo del retiro"
                  placeholderTextColor="#94A3B8"
                />
              </View>

              {/* Campo de Observaciones */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>OBSERVACIONES / ESTADO DE LOS BIENES</Text>
                <TextInput
                  style={[styles.montoInput, { fontSize: 13, height: 64, textAlign: 'left', paddingHorizontal: 12, paddingVertical: 8 }]}
                  multiline={true}
                  editable={!isSubmittingRetiro}
                  value={observacionesRetiro}
                  onChangeText={setObservacionesRetiro}
                  placeholder="Detalle estado de conservación, accesorios devueltos o notas de la diligencia..."
                  placeholderTextColor="#94A3B8"
                />
              </View>

              {/* Firma 1: Cliente Titular */}
              <View style={styles.signatureContainer}>
                <SignatureCanvas
                  label="Firma de Entrega del Cliente Titular"
                  subtitle="El cliente firma en conformidad de entrega voluntaria de los bienes"
                  obligatorio={true}
                  signerName={creditoRetiro?.cliente?.nombres || 'Cliente Titular'}
                  signerDoc={creditoRetiro?.cliente?.documento_numero || creditoRetiro?.cliente?.cedula || ''}
                  value={firmaClienteRetiro}
                  onChange={setFirmaClienteRetiro}
                  height={125}
                />
              </View>

              {/* Firma 2: Cobrador Gestor */}
              <View style={styles.signatureContainer}>
                <SignatureCanvas
                  label="Firma del Gestor de Cobro / Cobrador en Ruta"
                  subtitle="Firme para certificar la recepción en custodia de los bienes muebles"
                  obligatorio={true}
                  signerName={user?.nombre || user?.nombre_completo || 'Pedro Cobrador'}
                  signerDoc="Cobrador / Gestor de Cobro"
                  value={firmaCobradorRetiro}
                  onChange={setFirmaCobradorRetiro}
                  height={125}
                />
              </View>

              {/* Botón de Confirmación con Protección Anti-Doble Clic */}
              <TouchableOpacity
                style={[styles.confirmRetiroBtn, isSubmittingRetiro && styles.confirmPaymentBtnDisabled]}
                onPress={handleConfirmarOrdenRetiro}
                disabled={isSubmittingRetiro}
                activeOpacity={isSubmittingRetiro ? 1 : 0.7}
                accessibilityRole="button"
              >
                {isSubmittingRetiro ? (
                  <View style={styles.btnLoadingRow}>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                    <Text style={styles.confirmPaymentBtnText}>Generando Acta de Restitución...</Text>
                  </View>
                ) : (
                  <Text style={styles.confirmPaymentBtnText}>🚨 Confirmar y Generar Acta PDF</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.cancelPaymentBtn}
                onPress={() => setModalRetiroVisible(false)}
                disabled={isSubmittingRetiro}
              >
                <Text style={styles.cancelPaymentBtnText}>Cancelar</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </InFrameModal>

      {/* ========================================================================= */}
      {/* MODAL DE ACTA DE RESTITUCIÓN EXITOSA                                      */}
      {/* ========================================================================= */}
      <InFrameModal
        visible={modalActaExitosaVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setModalActaExitosaVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.receiptCard, { borderTopColor: '#991B1B' }]}>
            
            {/* Header del comprobante de retiro */}
            <View style={styles.receiptSuccessHeader}>
              <View style={[styles.receiptIconSuccess, { backgroundColor: '#FEE2E2' }]}>
                <Text style={{ fontSize: 24 }}>🚨</Text>
              </View>
              <Text style={[styles.receiptTitleSuccess, { color: '#991B1B' }]}>
                ¡Acta de Restitución Generada!
              </Text>
              <Text style={styles.receiptSubtitleSuccess}>
                Orden de retiro registrada con doble firma digital inmutable
              </Text>
            </View>

            {/* Ficha Resumen */}
            <View style={styles.receiptSummaryBlock}>
              <View style={styles.receiptSummaryRow}>
                <Text style={styles.receiptSummaryLabel}>Contrato:</Text>
                <Text style={styles.receiptSummaryValue}>{actaGenerada?.numero_contrato}</Text>
              </View>
              <View style={styles.receiptSummaryRow}>
                <Text style={styles.receiptSummaryLabel}>Cliente:</Text>
                <Text style={styles.receiptSummaryValue}>{actaGenerada?.cliente_nombre}</Text>
              </View>
              <View style={styles.receiptSummaryRow}>
                <Text style={styles.receiptSummaryLabel}>Cuotas en Mora:</Text>
                <Text style={[styles.receiptSummaryValue, { color: '#991B1B', fontWeight: 'bold' }]}>
                  {actaGenerada?.cuotas_vencidas} Cuotas Vencidas
                </Text>
              </View>
              <View style={styles.receiptSummaryRow}>
                <Text style={styles.receiptSummaryLabel}>Saldo Insoluto:</Text>
                <Text style={styles.receiptSummaryValue}>{formatCOP(actaGenerada?.saldo_pendiente || 0)}</Text>
              </View>
              <View style={styles.receiptSummaryRow}>
                <Text style={styles.receiptSummaryLabel}>Fecha y Hora Local:</Text>
                <Text style={styles.receiptSummaryValue}>{actaGenerada?.fecha_acta}</Text>
              </View>
            </View>

            {/* Acciones */}
            <View style={styles.receiptActionsWrapper}>
              <TouchableOpacity
                style={[styles.receiptDownloadBtn, { backgroundColor: '#991B1B' }]}
                onPress={handleDescargarActaPdf}
                activeOpacity={0.8}
              >
                <Text style={styles.receiptDownloadBtnText}>📄 Ver / Descargar Acta de Retiro (PDF)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.receiptCloseBtn}
                onPress={() => setModalActaExitosaVisible(false)}
              >
                <Text style={styles.receiptCloseBtnText}>Cerrar y Continuar Ruta →</Text>
              </TouchableOpacity>
            </View>

          </View>
        </View>
      </InFrameModal>

      {/* ========================================================================= */}
      {/* MODAL DE CONFIRMACIÓN DE CIERRE DE SESIÓN                                 */}
      {/* ========================================================================= */}
      <InFrameModal
        visible={showLogoutModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowLogoutModal(false)}
      >
        <View style={styles.modalBackdropCenter}>
          <View style={styles.logoutModalCard}>
            <View style={styles.logoutModalHeader}>
              <View style={styles.logoutIconBadge}>
                <Text style={styles.logoutIconText}>⎋</Text>
              </View>
              <View style={styles.logoutModalTitleCol}>
                <Text style={styles.logoutBadgeText}>CONFIRMACIÓN DE SALIDA</Text>
                <Text style={styles.logoutModalQuestion}>
                  ¿Estás seguro de que deseas cerrar sesión?
                </Text>
              </View>
            </View>

            <Text style={styles.logoutModalMessage}>
              Tu sesión actual será finalizada de forma segura. Tendrás que ingresar nuevamente con tus credenciales corporativas para acceder a la plataforma.
            </Text>

            <View style={styles.logoutModalActions}>
              <TouchableOpacity
                style={styles.logoutCancelBtn}
                onPress={() => setShowLogoutModal(false)}
                accessibilityRole="button"
                accessibilityLabel="Cancelar cierre de sesión"
              >
                <Text style={styles.logoutCancelBtnText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.logoutConfirmBtn}
                onPress={handleConfirmLogout}
                accessibilityRole="button"
                accessibilityLabel="Confirmar salida y cerrar sesión"
              >
                <Text style={styles.logoutConfirmBtnText}>Sí, Salir</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </InFrameModal>

      {/* ========================================================================= */}
      {/* MODAL DE GARANTÍAS Y RESPALDO (CODEUDOR Y REFERENCIA)                    */}
      {/* ========================================================================= */}
      <InFrameModal
        visible={modalGarantiasVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setModalGarantiasVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.garantiasModalCard}>
            
            {/* Cabecera del Modal */}
            <View style={styles.garantiasModalHeader}>
              <View style={{ flex: 1 }}>
                <View style={styles.garantiasTagRow}>
                  <Text style={styles.garantiasShieldIcon}>🛡️</Text>
                  <Text style={styles.garantiasTagText}>DATOS DE RESPALDO</Text>
                </View>
                <Text style={styles.garantiasModalTitle}>Garantías y Respaldo</Text>
                <Text style={styles.garantiasModalSub} numberOfLines={1}>
                  {creditoGarantias?.cliente?.nombres || 'Cliente'} • {creditoGarantias?.numero_contrato || (creditoGarantias?.id_contrato ? `CTR-${String(creditoGarantias.id_contrato).slice(0, 8).toUpperCase()}` : 'CTR-RUTA')}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.garantiasCloseBtn}
                onPress={() => setModalGarantiasVisible(false)}
                accessibilityLabel="Cerrar modal de garantías"
              >
                <Text style={styles.garantiasCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Contenido Scrollable */}
            <ScrollView
              style={styles.garantiasModalBody}
              contentContainerStyle={{ paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
            >
              {isLoadingGarantias ? (
                <View style={styles.garantiasLoadingBox}>
                  <ActivityIndicator size="small" color="#059669" />
                  <Text style={styles.garantiasLoadingText}>Consultando datos de respaldo...</Text>
                </View>
              ) : (
                <>
                  {/* TARJETA 1: CODEUDOR SOLIDARIO */}
                  <View style={styles.garantiaCardCodeudor}>
                    <View style={styles.garantiaCardHeader}>
                      <View style={styles.garantiaIconBoxBlue}>
                        <Text style={styles.garantiaIcon}>🤝</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.garantiaCardBadgeBlue}>CODEUDOR SOLIDARIO</Text>
                        <Text style={styles.garantiaPersonaNombre}>
                          {creditoGarantias?.codeudor?.nombre || 'No registrado'}
                        </Text>
                      </View>
                    </View>

                    {creditoGarantias?.codeudor?.nombre ? (
                      <View style={styles.garantiaCardContent}>
                        <View style={styles.garantiaDataRow}>
                          <Text style={styles.garantiaDataLabel}>Cédula:</Text>
                          <Text style={styles.garantiaDataVal}>
                            {creditoGarantias?.codeudor?.cedula || 'Sin cédula registrada'}
                          </Text>
                        </View>

                        <View style={styles.garantiaDataRow}>
                          <Text style={styles.garantiaDataLabel}>Dirección:</Text>
                          <Text style={styles.garantiaDataVal}>
                            {creditoGarantias?.codeudor?.direccion || 'Sin dirección registrada'}
                          </Text>
                        </View>

                        <View style={styles.garantiaDataRow}>
                          <Text style={styles.garantiaDataLabel}>Teléfono:</Text>
                          <Text style={styles.garantiaDataValBold}>
                            {creditoGarantias?.codeudor?.telefono || 'Sin teléfono'}
                          </Text>
                        </View>

                        {/* Botones de Acción Rápida: Llamada y WhatsApp */}
                        {creditoGarantias?.codeudor?.telefono ? (
                          <View style={styles.garantiaActionBtnsRow}>
                            <TouchableOpacity
                              style={styles.actionCallBtn}
                              onPress={() => hacerLlamada(creditoGarantias.codeudor.telefono)}
                              activeOpacity={0.8}
                            >
                              <Text style={styles.actionCallBtnText}>📞 Llamar</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={styles.actionWhatsAppBtn}
                              onPress={() =>
                                abrirWhatsApp(
                                  creditoGarantias.codeudor.telefono,
                                  creditoGarantias.codeudor.nombre,
                                  'Codeudor Solidario'
                                )
                              }
                              activeOpacity={0.8}
                            >
                              <Text style={styles.actionWhatsAppBtnText}>💬 WhatsApp</Text>
                            </TouchableOpacity>
                          </View>
                        ) : null}
                      </View>
                    ) : (
                      <View style={styles.garantiaEmptyNotice}>
                        <Text style={styles.garantiaEmptyNoticeText}>
                          Este contrato o cliente no tiene un codeudor solidario registrado.
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* TARJETA 2: REFERENCIA FAMILIAR O PERSONAL */}
                  <View style={styles.garantiaCardReferencia}>
                    <View style={styles.garantiaCardHeader}>
                      <View style={styles.garantiaIconBoxAmber}>
                        <Text style={styles.garantiaIcon}>👥</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.garantiaCardBadgeAmber}>REFERENCIA FAMILIAR</Text>
                        <Text style={styles.garantiaPersonaNombre}>
                          {creditoGarantias?.referencia?.nombre || 'No registrada'}
                        </Text>
                      </View>
                    </View>

                    {creditoGarantias?.referencia?.nombre ? (
                      <View style={styles.garantiaCardContent}>
                        <View style={styles.garantiaDataRow}>
                          <Text style={styles.garantiaDataLabel}>Parentesco:</Text>
                          <Text style={styles.garantiaDataValBadge}>
                            {creditoGarantias?.referencia?.parentesco || 'Familiar'}
                          </Text>
                        </View>

                        {creditoGarantias?.referencia?.direccion ? (
                          <View style={styles.garantiaDataRow}>
                            <Text style={styles.garantiaDataLabel}>Dirección:</Text>
                            <Text style={styles.garantiaDataVal}>
                              {creditoGarantias.referencia.direccion}
                            </Text>
                          </View>
                        ) : null}

                        <View style={styles.garantiaDataRow}>
                          <Text style={styles.garantiaDataLabel}>Teléfono:</Text>
                          <Text style={styles.garantiaDataValBold}>
                            {creditoGarantias?.referencia?.telefono || 'Sin teléfono'}
                          </Text>
                        </View>

                        {/* Botones de Acción Rápida: Llamada y WhatsApp */}
                        {creditoGarantias?.referencia?.telefono ? (
                          <View style={styles.garantiaActionBtnsRow}>
                            <TouchableOpacity
                              style={styles.actionCallBtn}
                              onPress={() => hacerLlamada(creditoGarantias.referencia.telefono)}
                              activeOpacity={0.8}
                            >
                              <Text style={styles.actionCallBtnText}>📞 Llamar</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={styles.actionWhatsAppBtn}
                              onPress={() =>
                                abrirWhatsApp(
                                  creditoGarantias.referencia.telefono,
                                  creditoGarantias.referencia.nombre,
                                  'Referencia Familiar'
                                )
                              }
                              activeOpacity={0.8}
                            >
                              <Text style={styles.actionWhatsAppBtnText}>💬 WhatsApp</Text>
                            </TouchableOpacity>
                          </View>
                        ) : null}
                      </View>
                    ) : (
                      <View style={styles.garantiaEmptyNotice}>
                        <Text style={styles.garantiaEmptyNoticeText}>
                          Este contrato o cliente no tiene una referencia familiar registrada.
                        </Text>
                      </View>
                    )}
                  </View>
                </>
              )}
            </ScrollView>

            {/* Botón Inferior de Cierre */}
            <View style={styles.garantiasModalFooter}>
              <TouchableOpacity
                style={styles.garantiasCerrarModalBtn}
                onPress={() => setModalGarantiasVisible(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.garantiasCerrarModalBtnText}>Entendido / Volver</Text>
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
    backgroundColor: '#F8FAFC',
    position: 'relative',
  },
  topHeader: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerLeftCol: {
    flex: 1,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  appTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  cobradorBadge: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  cobradorBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#047857',
    letterSpacing: 0.5,
  },
  headerSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  logoutBtn: {
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  logoutBtnText: {
    color: '#E11D48',
    fontSize: 12,
    fontWeight: '700',
  },

  // BARRA DE PESTAÑAS (TABS)
  tabBarContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingTop: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: 8,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    gap: 6,
  },
  tabButtonActive: {
    borderBottomColor: '#059669',
  },
  tabButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  tabButtonTextActive: {
    color: '#059669',
  },
  tabBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  tabBadgeActive: {
    backgroundColor: '#ECFDF5',
  },
  tabBadgeInactive: {
    backgroundColor: '#F1F5F9',
  },
  tabBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  tabBadgeTextActive: {
    color: '#059669',
  },
  tabBadgeTextInactive: {
    color: '#94A3B8',
  },

  scrollContent: {
    paddingHorizontal: 14,
    paddingBottom: 36,
  },

  // OPERATOR CARD
  operatorCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  operatorAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  operatorAvatarText: {
    color: '#34D399',
    fontSize: 14,
    fontWeight: '800',
  },
  operatorDetails: {
    flex: 1,
  },
  operatorName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  operatorPhone: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  onlineText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#047857',
  },

  // SECCIÓN MIS RECAUDOS DEL DÍA
  recaudosSectionWrapper: {
    marginTop: 12,
  },

  // CONSOLIDADO CARD
  consolidadoCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  consolidadoHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 10,
  },
  consolidadoIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  consolidadoIcon: {
    fontSize: 18,
  },
  consolidadoTitleBox: {
    flex: 1,
  },
  consolidadoBadgeLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.8,
  },
  consolidadoSubLabel: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },

  // BLOQUE TOTAL RECAUDADO HOY
  totalRecaudadoHoyBlock: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  totalRecaudadoLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#047857',
    letterSpacing: 0.8,
  },
  totalRecaudadoValue: {
    fontSize: 28,
    fontWeight: '900',
    color: '#065F46',
    marginTop: 2,
    letterSpacing: -0.5,
  },
  totalRecaudadoSub: {
    fontSize: 11,
    color: '#059669',
    marginTop: 3,
    fontWeight: '500',
  },

  // SUB-CARDS DESGLOSE DE ARQUEO
  arqueoCardsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  arqueoSubCard: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
  },
  arqueoSubCardActive: {
    borderWidth: 2,
  },
  arqueoPendienteCard: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  arqueoConciliadoCard: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  arqueoCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  dotArqueoAmber: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F59E0B',
  },
  dotArqueoGreen: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  arqueoSubCardTagAmber: {
    fontSize: 9,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 0.5,
  },
  arqueoSubCardTagGreen: {
    fontSize: 9,
    fontWeight: '800',
    color: '#047857',
    letterSpacing: 0.5,
  },
  arqueoAmountAmber: {
    fontSize: 16,
    fontWeight: '800',
    color: '#92400E',
    marginTop: 2,
  },
  arqueoAmountGreen: {
    fontSize: 16,
    fontWeight: '800',
    color: '#065F46',
    marginTop: 2,
  },
  arqueoFootnoteAmber: {
    fontSize: 10,
    color: '#B45309',
    marginTop: 4,
    lineHeight: 14,
  },
  arqueoFootnoteGreen: {
    fontSize: 10,
    color: '#047857',
    marginTop: 4,
    lineHeight: 14,
  },

  // NOTA / TIP DE ARQUEO FÍSICO
  arqueoTipBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
  },
  arqueoTipIcon: {
    fontSize: 14,
  },
  arqueoTipText: {
    fontSize: 11,
    color: '#475569',
    flex: 1,
    lineHeight: 16,
  },
  arqueoTipBold: {
    fontWeight: '800',
    color: '#0F172A',
  },

  // FILTROS Y BÚSQUEDA DE RECAUDOS
  recaudosFilterSection: {
    marginTop: 18,
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.5,
  },
  sectionCountBadge: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  filterPillsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
  },
  filterPill: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  filterPillActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  filterPillActiveAmber: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  filterPillActiveGreen: {
    backgroundColor: '#DCFCE7',
    borderColor: '#BBF7D0',
  },
  filterPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  filterPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  filterPillTextActiveAmber: {
    color: '#B45309',
    fontWeight: '700',
  },
  filterPillTextActiveGreen: {
    color: '#15803D',
    fontWeight: '700',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 40,
  },
  searchIcon: {
    fontSize: 13,
    marginRight: 6,
  },
  clearSearchIcon: {
    fontSize: 13,
    color: '#94A3B8',
    paddingHorizontal: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    paddingVertical: 0,
  },

  // LISTADO Y TARJETAS DE RECAUDO
  recaudosList: {
    gap: 10,
  },
  recaudoCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  recaudoCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 10,
  },
  recaudoClientCol: {
    flex: 1,
    marginRight: 8,
  },
  recaudoClientName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  recaudoClientDoc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  recaudoHeaderRightCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  recaudoContractBadge: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  recaudoContractBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
    letterSpacing: 0.5,
  },
  recaudoCuotaBadge: {
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  recaudoCuotaBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#4338CA',
    letterSpacing: 0.2,
  },
  recaudoCheckmarkBadge: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  recaudoCheckmarkBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#065F46',
    letterSpacing: 0.2,
  },

  recaudoFinanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  recaudoValueBlock: {},
  recaudoValueLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  recaudoValueAmount: {
    fontSize: 18,
    fontWeight: '900',
    color: '#047857',
    marginTop: 2,
    letterSpacing: -0.3,
  },
  recaudoMethodBadge: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  recaudoMethodText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },

  recaudoMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  recaudoTimeCol: {},
  recaudoTimeLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  recaudoTimeValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 1,
  },
  recaudoCuotaCenterCol: {
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  recaudoCuotaCenterValue: {
    fontSize: 11,
    fontWeight: '800',
    color: '#3B82F6',
    marginTop: 1,
  },
  recaudoRefCol: {
    alignItems: 'flex-end',
  },
  recaudoRefMono: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#64748B',
    fontWeight: '600',
    marginTop: 1,
  },

  // ESTATUS DE CONCILIACIÓN EN TARJETA
  recaudoStatusWrapper: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  statusBadgePendiente: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 8,
    padding: 8,
  },
  statusDotAmber: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#D97706',
    marginTop: 3,
  },
  statusTitleAmber: {
    fontSize: 11,
    fontWeight: '800',
    color: '#92400E',
  },
  statusSubAmber: {
    fontSize: 10,
    color: '#B45309',
    marginTop: 1,
    lineHeight: 14,
  },
  statusBadgeConciliado: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 8,
    padding: 8,
  },
  statusDotGreen: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginTop: 3,
  },
  statusTitleGreen: {
    fontSize: 11,
    fontWeight: '800',
    color: '#14532D',
  },
  statusSubGreen: {
    fontSize: 10,
    color: '#15803D',
    marginTop: 1,
    lineHeight: 14,
  },
  statusTextCol: {
    flex: 1,
  },

  // SECCIÓN HOJA DE RUTA
  rutaSectionWrapper: {
    marginTop: 12,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  kpiCardHalf: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
  },
  kpiLabelDark: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  kpiValueDark: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 3,
  },
  searchSection: {
    marginBottom: 10,
  },
  loadingBox: {
    paddingVertical: 32,
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 24,
    alignItems: 'center',
    marginTop: 6,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 14,
    lineHeight: 18,
  },
  reloadButton: {
    backgroundColor: '#0F172A',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  reloadButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  creditsList: {
    gap: 12,
  },

  // TARJETA UNIFICADA CENTRADA EN EL CLIENTE
  clientUnifiedCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
    marginBottom: 4,
  },
  clientCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  clientAvatarContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  clientAvatarText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#4F46E5',
  },
  clientInfoBlock: {
    flex: 1,
  },
  clientNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  clientTitleName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    flex: 1,
  },
  clientDocText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 1,
  },
  clientMultiBadge: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  clientMultiBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#92400E',
    letterSpacing: 0.3,
  },
  clientDetailsBar: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
    gap: 8,
  },
  clientAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  clientAddressText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '500',
    flex: 1,
  },
  clientActionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  clientContactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
  },
  clientContactBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  clientWhatsappBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
  },
  clientWhatsappBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#047857',
  },
  clientGarantiasBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
  },
  clientGarantiasBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },

  // SECCIÓN SUB-BLOQUES DE CONTRATOS
  contractsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    paddingBottom: 8,
  },
  contractsSectionTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  contractsTotalSaldoText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#E11D48',
  },
  contractsSubList: {
    gap: 8,
  },

  // SUB-BLOQUE INDIVIDUAL DE CONTRATO
  contractSubCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
  },
  contractSubCardDone: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
  },
  contractSubHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  contractSubNumberBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  contractSubNumberText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 0.3,
  },
  contractSubBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  contractSubCuotaBadge: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  contractSubCuotaBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1D4ED8',
  },
  badgePendiente: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  badgePendienteText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 0.3,
  },
  badgeVenceHoy: {
    backgroundColor: '#FEF9C3',
    borderWidth: 1,
    borderColor: '#FDE047',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  badgeVenceHoyText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#854D0E',
    letterSpacing: 0.3,
  },
  badgeVencido: {
    backgroundColor: '#FFE4E6',
    borderWidth: 1,
    borderColor: '#FECDD3',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  badgeVencidoText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#BE123C',
    letterSpacing: 0.3,
  },
  badgeCobrado: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  badgeCobradoText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#15803D',
    letterSpacing: 0.3,
  },
  contractSubContextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },
  contextBadgeIcon: {
    fontSize: 11,
  },
  contractSubContextText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '500',
    flex: 1,
  },
  contractSubFinanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  contractSubFinanceCol: {},
  contractSubFinanceColRight: {
    alignItems: 'flex-end',
  },
  contractSubFinanceLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.4,
  },
  contractSubFinanceSaldo: {
    fontSize: 13,
    fontWeight: '900',
    color: '#E11D48',
    marginTop: 1,
  },
  contractSubFinanceCuota: {
    fontSize: 13,
    fontWeight: '900',
    color: '#0F172A',
    marginTop: 1,
  },
  contractSubActionBtn: {
    backgroundColor: '#059669',
    borderRadius: 8,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contractSubActionBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  contractSubCardCritica: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    borderWidth: 1.5,
  },
  badgeCarteraCritica: {
    backgroundColor: '#991B1B',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  badgeCarteraCriticaText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  badgeCarteraCriticaProy: {
    backgroundColor: '#991B1B',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  contractSubRetiroBtn: {
    backgroundColor: '#991B1B',
    borderRadius: 8,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  contractSubRetiroBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  actionBtnRetiro: {
    backgroundColor: '#991B1B',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnRetiroText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },

  // ESTILOS DE MODAL DE ORDEN DE RETIRO
  modalHeaderRetiro: {
    backgroundColor: '#FEF2F2',
    borderBottomColor: '#FCA5A5',
  },
  modalHeadingRetiro: {
    fontSize: 16,
    fontWeight: '800',
    color: '#991B1B',
  },
  modalSubheadingRetiro: {
    fontSize: 12,
    color: '#7F1D1D',
    marginTop: 2,
  },
  retiroAlertBanner: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  retiroAlertTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#991B1B',
    marginBottom: 3,
  },
  retiroAlertText: {
    fontSize: 11,
    color: '#7F1D1D',
    lineHeight: 15,
  },
  retiroInfoCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
    gap: 5,
  },
  retiroInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  retiroInfoLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  retiroInfoValue: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F172A',
  },
  retiroArticulosSection: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  retiroSectionHeading: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  retiroArticuloItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  retiroArticuloBullet: {
    fontSize: 14,
    color: '#991B1B',
    fontWeight: 'bold',
  },
  retiroArticuloText: {
    fontSize: 11,
    color: '#334155',
    flex: 1,
  },
  retiroArticuloTextEmpty: {
    fontSize: 11,
    color: '#64748B',
    fontStyle: 'italic',
  },
  confirmRetiroBtn: {
    backgroundColor: '#991B1B',
    borderRadius: 10,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#991B1B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  contractSubDoneBanner: {
    backgroundColor: '#DCFCE7',
    borderRadius: 8,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contractSubDoneBannerText: {
    color: '#15803D',
    fontSize: 12,
    fontWeight: '700',
  },
  addressIcon: {
    fontSize: 12,
  },

  // MODALES
  modalBackdrop: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  modalBackdropCenter: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    maxHeight: '92%',
  },
  modalScrollBody: {
    maxHeight: '100%',
  },
  modalScrollContent: {
    paddingBottom: 24,
  },
  signatureContainer: {
    marginVertical: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 12,
  },
  modalHeading: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSubheading: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
  },
  gpsBox: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 10,
    padding: 10,
    marginTop: 14,
  },
  gpsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  gpsPulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  gpsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#047857',
  },
  gpsLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  gpsStatusText: {
    fontSize: 12,
    color: '#059669',
  },
  gpsCoordsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  gpsCoordsText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#065F46',
  },
  gpsAccuracyText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#059669',
  },
  cuotaPillContainer: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cuotaPillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cuotaPillIcon: {
    fontSize: 14,
  },
  cuotaPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#047857',
  },
  cuotaPillSub: {
    fontSize: 11,
    fontWeight: '600',
    color: '#065F46',
  },
  quickAmountsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    marginBottom: 2,
  },
  quickChip: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  quickChipActive: {
    backgroundColor: '#ECFDF5',
    borderColor: '#059669',
  },
  quickChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
    textAlign: 'center',
    lineHeight: 15,
  },
  quickChipTextActive: {
    color: '#047857',
  },
  inputGroup: {
    marginVertical: 14,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  montoInput: {
    height: 44,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  confirmPaymentBtn: {
    backgroundColor: '#059669',
    height: 46,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  confirmPaymentBtnDisabled: {
    backgroundColor: '#94A3B8',
    shadowOpacity: 0,
    elevation: 0,
  },
  confirmPaymentBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  cancelPaymentBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelPaymentBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  btnLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonDisabled: {
    opacity: 0.65,
  },

  // MODAL RECIBO DIGITAL
  receiptCard: {
    backgroundColor: '#FFFFFF',
    width: '100%',
    maxWidth: 380,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  receiptHeader: {
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 14,
  },
  receiptCheckBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  receiptCheckIcon: {
    fontSize: 20,
    color: '#15803D',
    fontWeight: 'bold',
  },
  receiptBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: '#047857',
    letterSpacing: 0.8,
  },
  receiptTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  receiptSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  receiptBody: {
    paddingVertical: 14,
    gap: 8,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  receiptKey: {
    fontSize: 12,
    color: '#64748B',
  },
  receiptVal: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  receiptValMono: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#0F172A',
    fontWeight: '600',
  },
  receiptRowHighlight: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 8,
    padding: 8,
    marginVertical: 4,
  },
  receiptKeyHighlight: {
    fontSize: 11,
    fontWeight: '800',
    color: '#047857',
  },
  receiptValHighlight: {
    fontSize: 16,
    fontWeight: '900',
    color: '#047857',
  },
  receiptActionsCol: {
    gap: 8,
    marginTop: 6,
  },
  receiptViewRecaudosBtn: {
    backgroundColor: '#059669',
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptViewRecaudosBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  receiptCloseBtn: {
    backgroundColor: '#0F172A',
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptCloseBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },

  // MODAL CONFIRMACIÓN DE SALIDA
  logoutModalCard: {
    backgroundColor: '#FFFFFF',
    width: '100%',
    maxWidth: 380,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 14,
    elevation: 6,
  },
  logoutModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  logoutIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutIconText: {
    fontSize: 18,
    color: '#E11D48',
    fontWeight: 'bold',
  },
  logoutModalTitleCol: {
    flex: 1,
  },
  logoutBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#E11D48',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  logoutModalQuestion: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 20,
  },
  logoutModalMessage: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 16,
  },
  logoutModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },
  logoutCancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
  },
  logoutCancelBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  logoutConfirmBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#E11D48',
  },
  logoutConfirmBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // ACCIONES DE CARTERA (ABONO + GARANTÍAS)
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  garantiasBtn: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  garantiasBtnText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  abonoButtonSmall: {
    flex: 1.3,
    backgroundColor: '#059669',
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBannerSmall: {
    flex: 1.3,
    backgroundColor: '#DCFCE7',
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBannerSmallText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#15803D',
  },

  // MODAL DE GARANTÍAS Y RESPALDO
  garantiasModalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '88%',
    width: '100%',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 10,
  },
  garantiasModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  garantiasTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 3,
  },
  garantiasShieldIcon: {
    fontSize: 13,
  },
  garantiasTagText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0284C7',
    letterSpacing: 0.5,
  },
  garantiasModalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  garantiasModalSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  garantiasCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  garantiasCloseBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#64748B',
  },
  garantiasModalBody: {
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  garantiasLoadingBox: {
    paddingVertical: 36,
    alignItems: 'center',
    gap: 8,
  },
  garantiasLoadingText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  garantiaCardCodeudor: {
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  garantiaCardReferencia: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  garantiaCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
    paddingBottom: 8,
  },
  garantiaIconBoxBlue: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#E0F2FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  garantiaIconBoxAmber: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  garantiaIcon: {
    fontSize: 16,
  },
  garantiaCardBadgeBlue: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0369A1',
    letterSpacing: 0.5,
  },
  garantiaCardBadgeAmber: {
    fontSize: 9,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 0.5,
  },
  garantiaPersonaNombre: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 1,
  },
  garantiaCardContent: {
    gap: 6,
  },
  garantiaDataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  garantiaDataLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  garantiaDataVal: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E293B',
    flex: 1,
    textAlign: 'right',
    marginLeft: 8,
  },
  garantiaDataValBold: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  garantiaDataValBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  garantiaActionBtnsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  actionCallBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0284C7',
    paddingVertical: 9,
    borderRadius: 8,
  },
  actionCallBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  actionWhatsAppBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#16A34A',
    paddingVertical: 9,
    borderRadius: 8,
  },
  actionWhatsAppBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  garantiaEmptyNotice: {
    paddingVertical: 8,
  },
  garantiaEmptyNoticeText: {
    fontSize: 11,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  garantiasModalFooter: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#FAFAFA',
  },
  garantiasCerrarModalBtn: {
    backgroundColor: '#0F172A',
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  garantiasCerrarModalBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },

  // ==========================================
  // ESTILOS DE LA PESTAÑA PROYECCIÓN
  // ==========================================
  proyeccionSectionWrapper: {
    marginTop: 12,
  },
  proyeccionBanner: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  proyeccionBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 10,
  },
  proyeccionIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  proyeccionIcon: {
    fontSize: 18,
  },
  proyeccionBannerTitleCol: {
    flex: 1,
  },
  proyeccionBannerTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  proyeccionBannerSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  proyeccionKpiBox: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  proyeccionKpiLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#047857',
    letterSpacing: 0.8,
  },
  proyeccionKpiAmount: {
    fontSize: 26,
    fontWeight: '900',
    color: '#065F46',
    marginTop: 2,
    letterSpacing: -0.5,
  },
  proyeccionKpiCount: {
    fontSize: 11,
    color: '#059669',
    marginTop: 3,
    fontWeight: '600',
  },
  periodFilterWrapper: {
    marginTop: 14,
    marginBottom: 6,
  },
  periodFilterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  periodPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  periodPillActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  periodPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  periodPillTextActive: {
    color: '#FFFFFF',
  },
  proyeccionList: {
    gap: 12,
    marginTop: 8,
  },
  proyeccionCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  proyeccionCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 10,
  },
  proyeccionClientCol: {
    flex: 1,
    marginRight: 8,
  },
  proyeccionClientName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  proyeccionClientDoc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  proyeccionClientDir: {
    fontSize: 11,
    color: '#0284C7',
    marginTop: 2,
    fontWeight: '600',
  },
  proyeccionContractCol: {
    alignItems: 'flex-end',
  },
  proyeccionContractBadge: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  proyeccionContractBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
    letterSpacing: 0.5,
  },
  vencimientoBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginVertical: 10,
    alignSelf: 'flex-start',
  },
  vencimientoBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  badgeTomorrow: {
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FDBA74',
  },
  badgeTomorrowText: {
    color: '#C2410C',
  },
  badgeWeek: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#93C5FD',
  },
  badgeWeekText: {
    color: '#1D4ED8',
  },
  badgeFuture: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  badgeFutureText: {
    color: '#475569',
  },
  badgeToday: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  badgeTodayText: {
    color: '#B45309',
  },
  badgeOverdue: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  badgeOverdueText: {
    color: '#DC2626',
  },
  proyeccionFinanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    marginBottom: 10,
  },
  proyeccionFinanceBlock: {
    flex: 1,
  },
  proyeccionFinanceBlockRight: {
    alignItems: 'flex-end',
  },
  proyeccionFinanceLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  proyeccionCuotaAmount: {
    fontSize: 16,
    fontWeight: '900',
    color: '#059669',
    marginTop: 2,
  },
  proyeccionFinanceFreq: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 2,
  },
  proyeccionSaldoAmount: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
    marginTop: 2,
  },
  proyeccionFinanceTotal: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '500',
    marginTop: 2,
  },
  cuotasTimelineWrapper: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  cuotasTimelineHeading: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  cuotasChipsScroll: {
    flexGrow: 0,
  },
  cuotasChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingRight: 20,
  },
  cuotaChip: {
    width: 110,
    minWidth: 110,
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  cuotaChipPagada: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  cuotaChipParcial: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  cuotaChipArrastre: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  cuotaChipPendiente: {
    backgroundColor: '#FFFFFF',
    borderColor: '#CBD5E1',
  },
  cuotaChipText: {
    fontSize: 10,
    fontWeight: '800',
  },
  cuotaChipTextPagada: {
    color: '#047857',
  },
  cuotaChipTextParcial: {
    color: '#B45309',
  },
  cuotaChipTextArrastre: {
    color: '#B91C1C',
  },
  cuotaChipTextPendiente: {
    color: '#334155',
  },
  cuotaChipDate: {
    fontSize: 9,
    marginTop: 3,
    fontWeight: '600',
  },
  cuotaChipDatePagada: {
    color: '#059669',
  },
  cuotaChipDateParcial: {
    color: '#D97706',
  },
  cuotaChipDateArrastre: {
    color: '#DC2626',
  },
  cuotaChipDatePendiente: {
    color: '#94A3B8',
  },
  proyeccionActionsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  actionBtnCall: {
    flex: 1,
    backgroundColor: '#0284C7',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnCallText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  actionBtnWa: {
    flex: 1,
    backgroundColor: '#16A34A',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnWaText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  actionBtnGarantias: {
    flex: 1,
    backgroundColor: '#D97706',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnGarantiasText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  actionBtnCobrar: {
    flex: 1.2,
    backgroundColor: '#059669',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnCobrarText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },

  // ESTILOS DE RECIBOS DE RECAUDO (PAGO TOTAL VS ABONO PARCIAL Y SALDO INSOLUTO)
  insolutoCard: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    padding: 12,
    marginVertical: 6,
  },
  insolutoCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#FEF3C7',
    paddingBottom: 4,
  },
  insolutoIcon: {
    fontSize: 14,
  },
  insolutoHeading: {
    fontSize: 10,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 0.5,
  },
  insolutoDataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  insolutoLabel: {
    fontSize: 11,
    color: '#78350F',
    fontWeight: '500',
  },
  insolutoValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
  },
  insolutoHighlightRow: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginVertical: 4,
  },
  insolutoHighlightLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#DC2626',
  },
  insolutoHighlightValue: {
    fontSize: 13,
    fontWeight: '900',
    color: '#DC2626',
  },
  insolutoNotice: {
    fontSize: 10,
    color: '#92400E',
    marginTop: 6,
    lineHeight: 14,
    fontStyle: 'italic',
  },
  pagoTotalBadgeBox: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginVertical: 4,
  },
  pagoTotalBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#047857',
    textAlign: 'center',
  },
  receiptFilenameBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
  },
  receiptFilenameLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  receiptFilenameText: {
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontWeight: '700',
    color: '#0F172A',
  },
  receiptDownloadBtn: {
    backgroundColor: '#059669',
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptDownloadBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  receiptShareRow: {
    flexDirection: 'row',
    gap: 8,
  },
  receiptShareBtnWa: {
    flex: 1,
    backgroundColor: '#16A34A',
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptShareBtnWaText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  receiptShareBtnMail: {
    flex: 1,
    backgroundColor: '#0284C7',
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptShareBtnMailText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  recaudoCardFooterRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  recaudoVerPdfBtn: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 8,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recaudoVerPdfBtnText: {
    color: '#15803D',
    fontSize: 11,
    fontWeight: '700',
  },
});
