from datetime import date, datetime, time
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import Date, String, cast, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import require_supervisor
from app.models.cliente import Cliente
from app.models.credito import Credito, CreditoDetalle
from app.models.usuario import Usuario
from app.services.pdf_reporte import generar_pdf_reporte_ventas

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

    # Filtro por búsqueda de texto
    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.where(
            or_(
                Cliente.nombres.ilike(term),
                Cliente.cedula.ilike(term),
                cast(Credito.id_contrato, String).ilike(term),
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

        operaciones_raw.append({
            "id_contrato": str(c.id_contrato),
            "codigo_contrato": f"CTR-{str(c.id_contrato)[:8].upper()}",
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
    search: Optional[str] = Query(None, description="Término de búsqueda por cliente o cédula"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor),
) -> Dict[str, Any]:
    """Retorna las métricas ejecutivas y el desglose de operaciones filtradas en formato JSON."""
    datos = await _obtener_datos_reporte(
        db=db,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        tipo_venta=tipo_venta,
        cliente_id=cliente_id,
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
    search: Optional[str] = Query(None, description="Término de búsqueda por cliente o cédula"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor),
) -> Response:
    """Genera y descarga un documento PDF ejecutivo corporativo listo para imprimir o archivar."""
    datos = await _obtener_datos_reporte(
        db=db,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        tipo_venta=tipo_venta,
        cliente_id=cliente_id,
        search=search,
    )

    pdf_bytes = generar_pdf_reporte_ventas(
        metricas=datos["metricas"],
        operaciones=datos["operaciones"],
        filtros=datos["filtros"],
        usuario_auditor=f"{current_user.nombre} ({current_user.rol.value.capitalize()})",
    )

    filename = f"Reporte_Ventas_Remundial_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )
