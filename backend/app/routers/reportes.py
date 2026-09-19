from datetime import date, datetime, time
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import Date, String, cast, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import require_supervisor_o_secretaria
from app.models.abono import Abono, EstadoAbono
from app.models.cliente import Cliente
from app.models.credito import Credito, CreditoDetalle, EstadoCredito
from app.models.usuario import Usuario
from app.schemas.credito import calcular_fecha_vencimiento, generar_cronograma_con_arrastre
from app.services.pdf_reporte import generar_pdf_reporte_cartera, generar_pdf_reporte_ventas

router = APIRouter(
    prefix="/reportes",
    tags=["Reportes & Auditoría"],
)


def _es_venta_contado(credito: Credito) -> bool:
    """Determina si un registro corresponde a una venta de Contado o a un Crédito financiado."""
    saldo = Decimal(str(credito.saldo_pendiente or 0))
    financiado = Decimal(str(credito.monto_financiado or 0))
    cuotas = int(credito.numero_cuotas or 1)

    # Si no hay saldo pendiente ni financiado, o se configuró en una sola cuota saldada
    if saldo == Decimal("0.00") and financiado == Decimal("0.00"):
        return True
    if cuotas <= 1 and saldo == Decimal("0.00"):
        return True
    return False


async def _obtener_datos_reporte(
    db: AsyncSession,
    fecha_inicio: Optional[date] = None,
    fecha_fin: Optional[date] = None,
    tipo_venta: Optional[str] = "todos",
    cliente_id: Optional[UUID] = None,
    ciudad_venta: Optional[str] = None,
    numero_contrato: Optional[str] = None,
    search: Optional[str] = None,
) -> Dict[str, Any]:
    """Consulta la base de datos y calcula las métricas financieras del reporte."""
    # Query base con relaciones optimizadas
    query = (
        select(Credito)
        .join(Credito.cliente)
        .options(
            selectinload(Credito.cliente),
            selectinload(Credito.vendedor),
            selectinload(Credito.detalles).selectinload(CreditoDetalle.producto),
        )
        .order_by(desc(Credito.creado_en))
    )

    # Filtros de fecha
    if fecha_inicio:
        inicio_dt = datetime.combine(fecha_inicio, time.min)
        query = query.where(Credito.creado_en >= inicio_dt)
    if fecha_fin:
        fin_dt = datetime.combine(fecha_fin, time.max)
        query = query.where(Credito.creado_en <= fin_dt)

    # Filtro por cliente específico
    if cliente_id:
        query = query.where(Credito.cliente_id == cliente_id)

    # Filtro geográfico por ciudad de venta
    if ciudad_venta and ciudad_venta.strip():
        ciu_clean = ciudad_venta.strip()
        if ciu_clean.lower() not in ("todas", "todos", "todas las ciudades", "todas las localidades", "all"):
            query = query.where(Credito.ciudad_venta.ilike(ciu_clean))

    # Filtro por número de contrato o folio físico
    if numero_contrato and numero_contrato.strip():
        term_contrato = f"%{numero_contrato.strip()}%"
        query = query.where(
            or_(
                Credito.numero_contrato.ilike(term_contrato),
                cast(Credito.id_contrato, String).ilike(term_contrato),
            )
        )

    # Filtro por búsqueda de texto
    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.where(
            or_(
                Cliente.nombres.ilike(term),
                Cliente.cedula.ilike(term),
                cast(Credito.id_contrato, String).ilike(term),
                Credito.numero_contrato.ilike(term),
                Credito.ciudad_venta.ilike(term),
            )
        )

    res = await db.execute(query)
    todos_creditos = res.scalars().all()

    operaciones_raw: List[Dict[str, Any]] = []
    total_vendido = Decimal("0.00")
    volumen_credito = Decimal("0.00")
    volumen_contado = Decimal("0.00")
    ops_credito = 0
    ops_contado = 0

    cliente_filtrado_nombre = None
    if cliente_id and todos_creditos and todos_creditos[0].cliente:
        cliente_filtrado_nombre = todos_creditos[0].cliente.nombres

    for c in todos_creditos:
        es_contado = _es_venta_contado(c)
        tipo_str = "contado" if es_contado else "credito"

        # Aplicar filtro de tipo si no es 'todos'
        if tipo_venta in ("credito", "contado") and tipo_str != tipo_venta:
            continue

        monto_total = Decimal(str(c.monto_financiado or 0)) + Decimal(str(c.cuota_inicial or 0))
        saldo_pend = Decimal(str(c.saldo_pendiente or 0))

        # Acumuladores de métricas
        total_vendido += monto_total
        if es_contado:
            volumen_contado += monto_total
            ops_contado += 1
        else:
            volumen_credito += monto_total
            ops_credito += 1

        # Resumen de artículos
        articulos_list = []
        articulos_resumen_parts = []
        if c.detalles:
            for d in c.detalles:
                prod_nombre = d.producto.nombre if d.producto else "Artículo"
                articulos_list.append({
                    "nombre": prod_nombre,
                    "sku": d.producto.sku if d.producto else "N/A",
                    "cantidad": d.cantidad,
                    "valor_unitario": float(d.valor_unitario_acordado or 0),
                    "subtotal": float(d.subtotal or 0),
                })
                articulos_resumen_parts.append(f"{d.cantidad}x {prod_nombre}")

        articulos_resumen_txt = ", ".join(articulos_resumen_parts) if articulos_resumen_parts else "Artículos de catálogo"

        ctr_label = c.numero_contrato or f"CTR-{str(c.id_contrato)[:8].upper()}"
        operaciones_raw.append({
            "id_contrato": str(c.id_contrato),
            "codigo_contrato": ctr_label,
            "numero_contrato": c.numero_contrato,
            "ciudad_venta": c.ciudad_venta or "Montería",
            "fecha": c.creado_en.isoformat() if c.creado_en else datetime.now().isoformat(),
            "cliente_id": str(c.cliente_id),
            "cliente_nombre": c.cliente.nombres if c.cliente else "Consumidor Final",
            "cliente_cedula": c.cliente.cedula if c.cliente else "S/N",
            "cliente_telefono": c.cliente.telefono if c.cliente else "No registrado",
            "vendedor_id": str(c.vendedor_id) if c.vendedor_id else None,
            "vendedor_nombre": c.vendedor.nombre if c.vendedor else "Asesor Comercial",
            "tipo_venta": tipo_str,
            "monto_total": float(monto_total),
            "cuota_inicial": float(c.cuota_inicial or 0),
            "monto_financiado": float(c.monto_financiado or 0),
            "saldo_pendiente": float(saldo_pend),
            "numero_cuotas": c.numero_cuotas,
            "valor_cuota": float(c.valor_cuota or 0),
            "tipo_pago": c.tipo_pago.value if hasattr(c.tipo_pago, "value") else str(c.tipo_pago),
            "estado": c.estado.value if hasattr(c.estado, "value") else str(c.estado),
            "articulos": articulos_list,
            "articulos_resumen": articulos_resumen_txt,
        })

    total_ops = len(operaciones_raw)
    ticket_prom = float(total_vendido / total_ops) if total_ops > 0 else 0.0

    metricas = {
        "total_vendido": float(total_vendido),
        "volumen_credito": float(volumen_credito),
        "volumen_contado": float(volumen_contado),
        "ticket_promedio": ticket_prom,
        "total_operaciones": total_ops,
        "operaciones_credito": ops_credito,
        "operaciones_contado": ops_contado,
    }

    filtros_resumen = {
        "fecha_inicio": fecha_inicio.isoformat() if fecha_inicio else None,
        "fecha_fin": fecha_fin.isoformat() if fecha_fin else None,
        "tipo_venta": tipo_venta,
        "cliente_id": str(cliente_id) if cliente_id else None,
        "cliente_nombre": cliente_filtrado_nombre,
        "ciudad_venta": ciudad_venta.strip() if (ciudad_venta and ciudad_venta.strip().lower() not in ("todas", "todos", "all")) else None,
        "numero_contrato": numero_contrato.strip() if numero_contrato and numero_contrato.strip() else None,
        "search": search,
    }

    return {
        "metricas": metricas,
        "filtros": filtros_resumen,
        "operaciones": operaciones_raw,
    }


@router.get(
    "/ventas",
    summary="Consultar reporte de ventas y métricas financieras (JSON)",
    status_code=status.HTTP_200_OK,
)
async def reporte_ventas_json(
    fecha_inicio: Optional[date] = Query(None, description="Fecha inicial del filtro (YYYY-MM-DD)"),
    fecha_fin: Optional[date] = Query(None, description="Fecha final del filtro (YYYY-MM-DD)"),
    tipo_venta: Optional[str] = Query("todos", pattern="^(todos|credito|contado)$", description="Modalidad de venta"),
    cliente_id: Optional[UUID] = Query(None, description="ID del cliente para ver su histórico"),
    ciudad_venta: Optional[str] = Query(None, description="Filtrar por ciudad o localidad de venta"),
    numero_contrato: Optional[str] = Query(None, description="Filtrar por número de contrato o folio"),
    search: Optional[str] = Query(None, description="Término de búsqueda por cliente o cédula"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor_o_secretaria),
) -> Dict[str, Any]:
    """Retorna las métricas ejecutivas y el desglose de operaciones filtradas en formato JSON."""
    datos = await _obtener_datos_reporte(
        db=db,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        tipo_venta=tipo_venta,
        cliente_id=cliente_id,
        ciudad_venta=ciudad_venta,
        numero_contrato=numero_contrato,
        search=search,
    )
    return datos


@router.get(
    "/ventas/pdf",
    summary="Descargar reporte ejecutivo de ventas en PDF (ReportLab)",
    status_code=status.HTTP_200_OK,
)
async def reporte_ventas_pdf(
    fecha_inicio: Optional[date] = Query(None, description="Fecha inicial del filtro (YYYY-MM-DD)"),
    fecha_fin: Optional[date] = Query(None, description="Fecha final del filtro (YYYY-MM-DD)"),
    tipo_venta: Optional[str] = Query("todos", pattern="^(todos|credito|contado)$", description="Modalidad de venta"),
    cliente_id: Optional[UUID] = Query(None, description="ID del cliente para ver su histórico"),
    ciudad_venta: Optional[str] = Query(None, description="Filtrar por ciudad o localidad de venta"),
    numero_contrato: Optional[str] = Query(None, description="Filtrar por número de contrato o folio"),
    search: Optional[str] = Query(None, description="Término de búsqueda por cliente o cédula"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor_o_secretaria),
) -> Response:
    """Genera y descarga un documento PDF ejecutivo corporativo listo para imprimir o archivar."""
    datos = await _obtener_datos_reporte(
        db=db,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        tipo_venta=tipo_venta,
        cliente_id=cliente_id,
        ciudad_venta=ciudad_venta,
        numero_contrato=numero_contrato,
        search=search,
    )

    pdf_bytes = generar_pdf_reporte_ventas(
        metricas=datos["metricas"],
        operaciones=datos["operaciones"],
        filtros=datos["filtros"],
        usuario_auditor=f"{current_user.nombre} ({current_user.rol.value.capitalize()})",
    )

    anio = datetime.now().year
    filename = f"Reporte_Ventas_Remundial_{anio}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


@router.get(
    "/ventas/excel",
    summary="Exportar Auditoría Financiera a Excel",
    description="Genera y descarga la auditoría financiera de operaciones en formato compatible con Excel.",
)
async def exportar_excel_reporte_ventas(
    fecha_inicio: Optional[date] = Query(None, description="Fecha de inicio (YYYY-MM-DD)"),
    fecha_fin: Optional[date] = Query(None, description="Fecha de fin (YYYY-MM-DD)"),
    tipo_venta: Optional[str] = Query("todos", description="Tipo de venta: 'todos', 'credito', 'contado'"),
    cliente_id: Optional[UUID] = Query(None, description="ID del cliente para ver su histórico"),
    ciudad_venta: Optional[str] = Query(None, description="Filtrar por ciudad o localidad de venta"),
    numero_contrato: Optional[str] = Query(None, description="Filtrar por número de contrato o folio"),
    search: Optional[str] = Query(None, description="Término de búsqueda por cliente o cédula"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor_o_secretaria),
) -> Response:
    """Genera y descarga la auditoría financiera con nombre corporativo oficial."""
    datos = await _obtener_datos_reporte(
        db=db,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        tipo_venta=tipo_venta,
        cliente_id=cliente_id,
        ciudad_venta=ciudad_venta,
        numero_contrato=numero_contrato,
        search=search,
    )

    operaciones = datos["operaciones"]
    headers = [
        "CONTRATO",
        "CIUDAD_VENTA",
        "FECHA",
        "CLIENTE_TITULAR",
        "CEDULA",
        "TELEFONO",
        "MODALIDAD",
        "NUM_CUOTAS",
        "VALOR_CUOTA",
        "MONTO_TOTAL",
        "CUOTA_INICIAL",
        "MONTO_FINANCIADO",
        "SALDO_PENDIENTE",
        "ASESOR_COMERCIAL",
        "ARTICULOS_DETALLE",
        "ESTADO_OPERATIVO",
    ]
    lines = [";".join(headers)]
    for op in operaciones:
        fecha_val = op.get("fecha")
        if isinstance(fecha_val, datetime):
            fecha_str = fecha_val.strftime("%Y-%m-%d %H:%M:%S")
        elif isinstance(fecha_val, str):
            fecha_str = fecha_val[:19].replace("T", " ")
        else:
            fecha_str = ""

        row = [
            f'"{op.get("codigo_contrato", "")}"',
            f'"{str(op.get("ciudad_venta", "")).replace(chr(34), chr(34)*2)}"',
            f'"{fecha_str}"',
            f'"{str(op.get("cliente_nombre", "")).replace(chr(34), chr(34)*2)}"',
            f'"{op.get("cliente_cedula", "")}"',
            f'"{op.get("cliente_telefono", "")}"',
            f'"{str(op.get("tipo_venta", "")).upper()}"',
            str(op.get("numero_cuotas", 1)),
            str(op.get("valor_cuota", 0)),
            str(op.get("monto_total", 0)),
            str(op.get("cuota_inicial", 0)),
            str(op.get("monto_financiado", 0)),
            str(op.get("saldo_pendiente", 0)),
            f'"{str(op.get("vendedor_nombre", "")).replace(chr(34), chr(34)*2)}"',
            f'"{str(op.get("articulos_resumen", "")).replace(chr(34), chr(34)*2)}"',
            f'"{str(op.get("estado", "")).upper()}"',
        ]
        lines.append(";".join(row))

    csv_bytes = ("\ufeff" + "\r\n".join(lines)).encode("utf-8")
    filename = "Auditoria_Financiera_Remundial.xlsx"

    return Response(
        content=csv_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


# =========================================================================
# REPORTE DE CARTERA & PLAN DE CUOTAS CON MARCA DE VERIFICACIÓN (CHULOS)
# =========================================================================

async def _obtener_datos_reporte_cartera(
    db: AsyncSession,
    cobrador_id: Optional[UUID] = None,
    fecha_inicio: Optional[date] = None,
    fecha_fin: Optional[date] = None,
    periodo_preset: Optional[str] = "mes",
    ciudad_venta: Optional[str] = None,
    numero_contrato: Optional[str] = None,
    search: Optional[str] = None,
) -> Dict[str, Any]:
    """Consulta la cartera asignada a cobradores y desglosa el cronograma de cuotas con su marca de verificación."""
    query = (
        select(Credito)
        .join(Credito.cliente)
        .options(
            selectinload(Credito.cliente),
            selectinload(Credito.cobrador),
            selectinload(Credito.vendedor),
            selectinload(Credito.detalles),
        )
        .order_by(desc(Credito.creado_en))
    )

    if cobrador_id:
        query = query.where(Credito.cobrador_id == cobrador_id)

    if fecha_inicio:
        inicio_dt = datetime.combine(fecha_inicio, time.min)
        query = query.where(Credito.creado_en >= inicio_dt)
    if fecha_fin:
        fin_dt = datetime.combine(fecha_fin, time.max)
        query = query.where(Credito.creado_en <= fin_dt)

    # Filtro geográfico por ciudad de venta
    if ciudad_venta and ciudad_venta.strip():
        ciu_clean = ciudad_venta.strip()
        if ciu_clean.lower() not in ("todas", "todos", "todas las ciudades", "todas las localidades", "all"):
            query = query.where(Credito.ciudad_venta.ilike(ciu_clean))

    # Filtro por número de contrato o folio físico
    if numero_contrato and numero_contrato.strip():
        term_contrato = f"%{numero_contrato.strip()}%"
        query = query.where(
            or_(
                Credito.numero_contrato.ilike(term_contrato),
                cast(Credito.id_contrato, String).ilike(term_contrato),
            )
        )

    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.where(
            or_(
                Cliente.nombres.ilike(term),
                Cliente.cedula.ilike(term),
                cast(Credito.id_contrato, String).ilike(term),
                Credito.numero_contrato.ilike(term),
                Credito.ciudad_venta.ilike(term),
            )
        )

    res = await db.execute(query)
    creditos_db = res.scalars().all()

    cobrador_nombre = "Todos los Cobradores"
    if cobrador_id:
        c_user = await db.get(Usuario, cobrador_id)
        if c_user:
            cobrador_nombre = c_user.nombre

    total_cartera = Decimal("0.00")
    saldo_total_pendiente = Decimal("0.00")
    total_recaudado = Decimal("0.00")
    cuotas_totales = 0
    cuotas_pagadas = 0
    cuotas_pendientes = 0

    creditos_out: List[Dict[str, Any]] = []
    hoy = date.today()

    for c in creditos_db:
        m_fin = Decimal(str(c.monto_financiado or 0))
        s_pen = Decimal(str(c.saldo_pendiente or 0))
        val_c = Decimal(str(c.valor_cuota or 0))
        n_cuotas = int(c.numero_cuotas or 1)

        total_cartera += m_fin
        saldo_total_pendiente += s_pen
        amort = max(Decimal("0.00"), m_fin - s_pen)
        total_recaudado += amort

        f_base = c.fecha_primera_cuota or (c.creado_en.date() if c.creado_en else hoy)
        cron_info = generar_cronograma_con_arrastre(
            fecha_primera_cuota=f_base,
            numero_cuotas=n_cuotas,
            monto_financiado=m_fin,
            saldo_pendiente=s_pen,
            valor_cuota_base=val_c,
            tipo_pago=c.tipo_pago,
            hoy=hoy,
        )
        cron_objs = cron_info["cronograma"]
        cronograma = [co.model_dump() if hasattr(co, "model_dump") else co.dict() for co in cron_objs]
        # Convert date objects to isoformat string if not already
        for item in cronograma:
            if isinstance(item.get("fecha_vencimiento"), (date, datetime)):
                item["fecha_vencimiento"] = item["fecha_vencimiento"].isoformat()

        c_pagas_count = cron_info["cuotas_pagadas_count"]
        c_pen_count = max(0, n_cuotas - c_pagas_count)

        cuotas_totales += n_cuotas
        cuotas_pagadas += c_pagas_count
        cuotas_pendientes += c_pen_count

        ctr_label = c.numero_contrato or f"CTR-{str(c.id_contrato)[:8].upper()}"
        creditos_out.append({
            "id_contrato": str(c.id_contrato),
            "codigo_contrato": ctr_label,
            "numero_contrato": c.numero_contrato,
            "ciudad_venta": c.ciudad_venta or "Montería",
            "fecha_inicio": c.creado_en.isoformat() if c.creado_en else None,
            "cliente_nombre": c.cliente.nombres if c.cliente else "Cliente Titular",
            "cliente_cedula": c.cliente.cedula if c.cliente else "",
            "cliente_telefono": c.cliente.telefono if c.cliente else "",
            "cobrador_id": str(c.cobrador_id) if c.cobrador_id else None,
            "cobrador_nombre": c.cobrador.nombre if c.cobrador else "Sin asignar",
            "monto_financiado": float(m_fin),
            "saldo_pendiente": float(s_pen),
            "valor_cuota": float(val_c),
            "numero_cuotas": n_cuotas,
            "tipo_pago": c.tipo_pago.value if hasattr(c.tipo_pago, "value") else str(c.tipo_pago),
            "estado": c.estado.value if hasattr(c.estado, "value") else str(c.estado),
            "cuotas_pagadas_count": c_pagas_count,
            "cuotas_pendientes_count": c_pen_count,
            "cronograma": cronograma,
        })

    periodo_map = {
        "hoy": "Día de Hoy",
        "semana": "Semana Actual",
        "mes": "Mes en Curso",
        "todos": "Todo el Historial",
        "personalizado": "Rango Personalizado",
    }

    return {
        "metricas": {
            "total_cartera": float(total_cartera),
            "saldo_total_pendiente": float(saldo_total_pendiente),
            "total_recaudado": float(total_recaudado),
            "total_creditos": len(creditos_out),
            "cuotas_totales": cuotas_totales,
            "cuotas_pagadas": cuotas_pagadas,
            "cuotas_pendientes": cuotas_pendientes,
        },
        "filtros": {
            "cobrador_id": str(cobrador_id) if cobrador_id else None,
            "cobrador_nombre": cobrador_nombre,
            "periodo_texto": periodo_map.get(periodo_preset or "mes", "Periodo Seleccionado"),
            "fecha_inicio": fecha_inicio.isoformat() if fecha_inicio else None,
            "fecha_fin": fecha_fin.isoformat() if fecha_fin else None,
            "ciudad_venta": ciudad_venta.strip() if (ciudad_venta and ciudad_venta.strip().lower() not in ("todas", "todos", "all")) else None,
            "numero_contrato": numero_contrato.strip() if numero_contrato and numero_contrato.strip() else None,
            "search": search,
        },
        "creditos": creditos_out,
    }


@router.get(
    "/cartera",
    summary="Consultar datos de cartera y cuotas para supervisión",
    status_code=status.HTTP_200_OK,
)
async def reporte_cartera_datos(
    cobrador_id: Optional[UUID] = Query(None, description="ID del cobrador"),
    fecha_inicio: Optional[date] = Query(None, description="Fecha de inicio (YYYY-MM-DD)"),
    fecha_fin: Optional[date] = Query(None, description="Fecha de fin (YYYY-MM-DD)"),
    periodo_preset: Optional[str] = Query("mes", description="Preset de periodo: hoy, semana, mes, todos"),
    ciudad_venta: Optional[str] = Query(None, description="Filtrar por ciudad o localidad de venta"),
    numero_contrato: Optional[str] = Query(None, description="Filtrar por número de contrato o folio"),
    search: Optional[str] = Query(None, description="Búsqueda por cliente o cédula"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor_o_secretaria),
) -> Dict[str, Any]:
    """Retorna los datos de cartera con el desglose de cuotas y marcas de recaudo para supervisión."""
    return await _obtener_datos_reporte_cartera(
        db=db,
        cobrador_id=cobrador_id,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        periodo_preset=periodo_preset,
        ciudad_venta=ciudad_venta,
        numero_contrato=numero_contrato,
        search=search,
    )


@router.get(
    "/cartera/pdf",
    summary="Descargar reporte de cartera y plan de cuotas en PDF (ReportLab)",
    status_code=status.HTTP_200_OK,
)
async def reporte_cartera_pdf(
    cobrador_id: Optional[UUID] = Query(None, description="ID del cobrador asignado"),
    fecha_inicio: Optional[date] = Query(None, description="Fecha de inicio (YYYY-MM-DD)"),
    fecha_fin: Optional[date] = Query(None, description="Fecha de fin (YYYY-MM-DD)"),
    periodo_preset: Optional[str] = Query("mes", description="Preset de periodo: hoy, semana, mes, todos"),
    ciudad_venta: Optional[str] = Query(None, description="Filtrar por ciudad o localidad de venta"),
    numero_contrato: Optional[str] = Query(None, description="Filtrar por número de contrato o folio"),
    search: Optional[str] = Query(None, description="Búsqueda por cliente o cédula"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor_o_secretaria),
) -> Response:
    """Genera y descarga un PDF ejecutivo con ReportLab detallando el plan de cuotas y marcas de recaudo (chulos)."""
    datos = await _obtener_datos_reporte_cartera(
        db=db,
        cobrador_id=cobrador_id,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        periodo_preset=periodo_preset,
        ciudad_venta=ciudad_venta,
        numero_contrato=numero_contrato,
        search=search,
    )

    pdf_bytes = generar_pdf_reporte_cartera(
        metricas=datos["metricas"],
        creditos=datos["creditos"],
        filtros=datos["filtros"],
        usuario_auditor=f"{current_user.nombre} ({current_user.rol.value.capitalize()})",
    )

    filename = f"Reporte_Cartera_Cuotas_{datetime.now().strftime('%Y%m%d')}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


@router.get(
    "/calendario",
    summary="Consultar calendario mensual de cuotas y vencimientos de cartera",
    status_code=status.HTTP_200_OK,
)
async def reporte_calendario_mensual(
    year: Optional[int] = Query(None, description="Año a consultar (ej. 2026)"),
    month: Optional[int] = Query(None, ge=1, le=12, description="Mes a consultar (1..12)"),
    cobrador_id: Optional[UUID] = Query(None, description="ID del cobrador asignado"),
    ciudad_venta: Optional[str] = Query(None, description="Filtrar por ciudad o localidad de venta"),
    numero_contrato: Optional[str] = Query(None, description="Filtrar por número de contrato o folio"),
    search: Optional[str] = Query(None, description="Búsqueda por cliente o contrato"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor_o_secretaria),
) -> Dict[str, Any]:
    """Retorna la matriz del calendario mensual con todos los cobros programados agrupados por día."""
    hoy = date.today()
    y = year if isinstance(year, int) else (hoy.year if year is None else int(year))
    m = month if isinstance(month, int) else (hoy.month if month is None else int(month))
    c_id = cobrador_id if isinstance(cobrador_id, UUID) else None
    s_term = search.strip() if isinstance(search, str) and search.strip() else None

    # Obtenemos toda la cartera activa o histórica
    datos_cartera = await _obtener_datos_reporte_cartera(
        db=db,
        cobrador_id=c_id,
        periodo_preset="todos",
        ciudad_venta=ciudad_venta,
        numero_contrato=numero_contrato,
        search=s_term,
    )
    creditos = datos_cartera.get("creditos", [])

    dias_map: Dict[str, Dict[str, Any]] = {}
    total_prog_mes = Decimal("0.00")
    total_recaudado_mes = Decimal("0.00")
    total_pendiente_mes = Decimal("0.00")
    cuotas_totales_mes = 0
    cuotas_pagadas_mes = 0
    cuotas_pendientes_mes = 0

    for c in creditos:
        c_cobrador = c.get("cobrador_nombre") or "Sin asignar"
        c_cliente = c.get("cliente_nombre") or "Cliente"
        c_cedula = c.get("cliente_cedula") or ""
        c_tel = c.get("cliente_telefono") or ""
        c_contrato = c.get("codigo_contrato") or f"CTR-{c.get('id_contrato', '')[:8].upper()}"
        n_cuotas = c.get("numero_cuotas") or 1

        for q in c.get("cronograma", []):
            f_str = q.get("fecha_vencimiento")  # 'YYYY-MM-DD'
            if not f_str:
                continue
            try:
                f_dt = date.fromisoformat(f_str)
            except Exception:
                continue

            if f_dt.year != y or f_dt.month != m:
                continue

            val = Decimal(str(q.get("valor_cuota") or 0))
            is_pagada = bool(q.get("pagada"))

            total_prog_mes += val
            cuotas_totales_mes += 1
            if is_pagada:
                total_recaudado_mes += val
                cuotas_pagadas_mes += 1
            else:
                total_pendiente_mes += val
                cuotas_pendientes_mes += 1

            if f_str not in dias_map:
                dias_map[f_str] = {
                    "fecha": f_str,
                    "dia": f_dt.day,
                    "total_programado": 0.0,
                    "total_recaudado": 0.0,
                    "total_pendiente": 0.0,
                    "cuotas_totales": 0,
                    "cuotas_pagadas": 0,
                    "cuotas_pendientes": 0,
                    "items": [],
                }

            dia_entry = dias_map[f_str]
            dia_entry["total_programado"] += float(val)
            dia_entry["cuotas_totales"] += 1
            if is_pagada:
                dia_entry["total_recaudado"] += float(val)
                dia_entry["cuotas_pagadas"] += 1
            else:
                dia_entry["total_pendiente"] += float(val)
                dia_entry["cuotas_pendientes"] += 1

            dia_entry["items"].append({
                "id_contrato": c.get("id_contrato"),
                "codigo_contrato": c_contrato,
                "cliente_nombre": c_cliente,
                "cliente_cedula": c_cedula,
                "cliente_telefono": c_tel,
                "cobrador_nombre": c_cobrador,
                "numero_cuota": q.get("numero"),
                "total_cuotas": n_cuotas,
                "cuota_texto": f"Cuota {q.get('numero')}/{n_cuotas}",
                "valor_cuota": float(val),
                "pagada": is_pagada,
                "estado": "pagada" if is_pagada else ("vencida" if f_dt < hoy else ("hoy" if f_dt == hoy else "futura")),
            })

    meses_es = [
        "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ]
    nombre_mes = f"{meses_es[m]} {y}"
    pct = float((total_recaudado_mes / total_prog_mes) * 100) if total_prog_mes > 0 else 0.0

    return {
        "year": y,
        "month": m,
        "nombre_mes": nombre_mes,
        "metricas_mes": {
            "total_programado": float(total_prog_mes),
            "total_recaudado": float(total_recaudado_mes),
            "total_pendiente": float(total_pendiente_mes),
            "cuotas_totales": cuotas_totales_mes,
            "cuotas_pagadas": cuotas_pagadas_mes,
            "cuotas_pendientes": cuotas_pendientes_mes,
            "dias_con_actividad": len(dias_map),
            "porcentaje_recaudo": round(pct, 1),
        },
        "filtros": {
            "year": y,
            "month": m,
            "cobrador_id": str(cobrador_id) if cobrador_id else None,
            "search": search,
        },
        "dias": dias_map,
    }


@router.get(
    "/resumen-gerencial",
    summary="Resumen ejecutivo y KPIs consolidados del Dashboard Gerencial",
    status_code=status.HTTP_200_OK,
)
async def resumen_gerencial(
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor_o_secretaria),
) -> Dict[str, Any]:
    """Calcula y retorna en tiempo real las métricas financieras ejecutivas,
    incluyendo dinero total colocado, recaudos del día, cartera en mora por saldo insoluto
    de cuotas vencidas y porcentaje de riesgo.
    """
    res_c = await db.execute(select(Credito).options(selectinload(Credito.cobrador)))
    creditos = res_c.scalars().all()

    res_a = await db.execute(
        select(Abono)
        .options(selectinload(Abono.cobrador))
        .where(Abono.estado != EstadoAbono.ANULADO)
    )
    abonos = res_a.scalars().all()

    hoy = date.today()

    total_colocado = Decimal("0.00")
    saldo_total_cartera = Decimal("0.00")
    saldo_mora_vencidas = Decimal("0.00")
    contratos_con_mora = 0
    total_cuotas_vencidas = 0
    contratos_criticos_count = 0
    saldo_cartera_critica = Decimal("0.00")

    creditos_colocados_count = 0
    creditos_activos_count = 0
    creditos_pendientes_count = 0
    creditos_terminados_count = 0

    modalidades = {"quincenal": Decimal("0.00"), "mensual": Decimal("0.00")}

    for c in creditos:
        if c.estado == EstadoCredito.PENDIENTE:
            creditos_pendientes_count += 1
            continue
        if c.estado == EstadoCredito.ACTIVO:
            creditos_activos_count += 1
        elif c.estado == EstadoCredito.TERMINADO:
            creditos_terminados_count += 1

        creditos_colocados_count += 1
        m_fin = Decimal(str(c.monto_financiado or 0))
        c_ini = Decimal(str(c.cuota_inicial or 0))
        s_pen = Decimal(str(c.saldo_pendiente or 0))
        total_colocado += (m_fin + c_ini)
        saldo_total_cartera += s_pen

        tipo_str = c.tipo_pago.value if hasattr(c.tipo_pago, "value") else str(c.tipo_pago)
        if tipo_str == "quincenal":
            modalidades["quincenal"] += m_fin
        elif tipo_str == "mensual":
            modalidades["mensual"] += m_fin

        if s_pen > Decimal("0.00") and c.fecha_primera_cuota:
            cron_info = generar_cronograma_con_arrastre(
                fecha_primera_cuota=c.fecha_primera_cuota,
                numero_cuotas=c.numero_cuotas,
                monto_financiado=m_fin,
                saldo_pendiente=s_pen,
                valor_cuota_base=c.valor_cuota or Decimal("0.00"),
                tipo_pago=c.tipo_pago,
                hoy=hoy,
            )
            cuotas_venc = [q for q in cron_info["cronograma"] if q.estado == "vencida"]
            if cuotas_venc:
                contratos_con_mora += 1
                total_cuotas_vencidas += len(cuotas_venc)
                saldo_mora_vencidas += sum(Decimal(str(q.saldo_cuota or 0)) for q in cuotas_venc)
            if cron_info.get("es_cartera_critica"):
                contratos_criticos_count += 1
                saldo_cartera_critica += s_pen

    pct_riesgo = (
        round(float((saldo_mora_vencidas / saldo_total_cartera * 100)), 2)
        if saldo_total_cartera > Decimal("0.00")
        else 0.0
    )

    # Abonos de la jornada actual
    abonos_hoy = [
        a
        for a in abonos
        if a.fecha
        and (
            (isinstance(a.fecha, datetime) and a.fecha.date() == hoy)
            or (isinstance(a.fecha, date) and a.fecha == hoy)
        )
    ]
    total_recaudado_hoy = sum((Decimal(str(a.valor_abonado or 0))) for a in abonos_hoy)
    total_recaudado_historico = sum((Decimal(str(a.valor_abonado or 0))) for a in abonos)

    # Cobrador líder hoy
    recaudos_por_cobrador: Dict[str, Dict[str, Any]] = {}
    for a in abonos_hoy:
        cid = str(a.cobrador_id) if a.cobrador_id else "desconocido"
        cnombre = a.cobrador.nombre if a.cobrador else "Cobrador en Ruta"
        if cid not in recaudos_por_cobrador:
            recaudos_por_cobrador[cid] = {"nombre": cnombre, "total": 0.0, "cobros": 0}
        recaudos_por_cobrador[cid]["total"] += float(a.valor_abonado or 0)
        recaudos_por_cobrador[cid]["cobros"] += 1

    lista_cobradores = sorted(recaudos_por_cobrador.values(), key=lambda x: x["total"], reverse=True)
    cobrador_lider = lista_cobradores[0] if lista_cobradores else None

    total_financiado_ambas = modalidades["quincenal"] + modalidades["mensual"]
    pct_quincenal = (
        round(float(modalidades["quincenal"] / total_financiado_ambas * 100))
        if total_financiado_ambas > 0
        else 0
    )
    pct_mensual = (
        round(float(modalidades["mensual"] / total_financiado_ambas * 100))
        if total_financiado_ambas > 0
        else 0
    )

    return {
        "total_colocado": float(total_colocado),
        "total_creditos_colocados": creditos_colocados_count,
        "saldo_total_cartera": float(saldo_total_cartera),
        "total_recaudado_hoy": float(total_recaudado_hoy),
        "count_abonos_hoy": len(abonos_hoy),
        "total_recaudado_historico": float(total_recaudado_historico),
        "count_abonos_historico": len(abonos),
        "cartera_en_mora": {
            "saldo_insoluto_mora": float(saldo_mora_vencidas),
            "contratos_mora_count": contratos_con_mora,
            "cuotas_vencidas_count": total_cuotas_vencidas,
            "porcentaje_riesgo": pct_riesgo,
            "contratos_criticos_count": contratos_criticos_count,
            "saldo_cartera_critica": float(saldo_cartera_critica),
        },
        "creditos_activos_count": creditos_activos_count,
        "creditos_pendientes_count": creditos_pendientes_count,
        "creditos_terminados_count": creditos_terminados_count,
        "modalidades": {
            "quincenal": float(modalidades["quincenal"]),
            "mensual": float(modalidades["mensual"]),
            "pct_quincenal": pct_quincenal,
            "pct_mensual": pct_mensual,
        },
        "cobrador_lider": cobrador_lider,
    }


