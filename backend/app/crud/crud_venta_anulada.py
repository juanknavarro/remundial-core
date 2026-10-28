from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.usuario import Usuario
from app.models.venta_anulada import EstadoDevolucion, VentaAnulada
from app.schemas.venta_anulada import VentaAnuladaCreate, VentaAnuladaReembolsoUpdate


async def crear_venta_anulada(
    db: AsyncSession,
    obj_in: VentaAnuladaCreate,
    vendedor_id_auth: Optional[UUID] = None,
) -> VentaAnulada:
    """Registra una venta rechazada/en cuarentena para devolución o reembolso."""
    final_vendedor_id = obj_in.vendedor_id or vendedor_id_auth
    if not final_vendedor_id:
        raise ValueError("Se requiere el identificador del vendedor")

    # Asegurar fecha
    fecha_registro = obj_in.fecha or datetime.now(timezone.utc)

    db_obj = VentaAnulada(
        fecha=fecha_registro,
        vendedor_id=final_vendedor_id,
        monto_total=Decimal(str(obj_in.monto_total)),
        metodo_pago_original=obj_in.metodo_pago_original.strip(),
        referencia_original=obj_in.referencia_original.strip() if obj_in.referencia_original else None,
        articulos_json=obj_in.articulos_json if obj_in.articulos_json is not None else [],
        estado_devolucion=obj_in.estado_devolucion.strip(),
        banco_destino_cliente=obj_in.banco_destino_cliente.strip() if obj_in.banco_destino_cliente else None,
        cuenta_destino_cliente=obj_in.cuenta_destino_cliente.strip() if obj_in.cuenta_destino_cliente else None,
        notas_vendedor=obj_in.notas_vendedor.strip() if obj_in.notas_vendedor else None,
        firma_vendedor=obj_in.firma_vendedor.strip() if obj_in.firma_vendedor else None,
        firma_cliente=obj_in.firma_cliente.strip() if obj_in.firma_cliente else None,
    )
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj


async def get_ventas_anuladas(
    db: AsyncSession,
    estado: Optional[str] = None,
    vendedor_id: Optional[UUID] = None,
    skip: int = 0,
    limit: int = 100,
) -> List[VentaAnulada]:
    """Obtiene el listado de ventas anuladas con soporte de filtros y orden descendente."""
    stmt = (
        select(VentaAnulada)
        .options(selectinload(VentaAnulada.vendedor))
        .order_by(desc(VentaAnulada.fecha), desc(VentaAnulada.creado_en))
    )
    if estado:
        stmt = stmt.where(VentaAnulada.estado_devolucion == estado)
    if vendedor_id:
        stmt = stmt.where(VentaAnulada.vendedor_id == vendedor_id)

    stmt = stmt.offset(skip).limit(limit)
    res = await db.execute(stmt)
    return list(res.scalars().all())


async def get_venta_anulada(db: AsyncSession, id: UUID) -> Optional[VentaAnulada]:
    """Obtiene el registro individual por su UUID."""
    stmt = (
        select(VentaAnulada)
        .options(selectinload(VentaAnulada.vendedor))
        .where(VentaAnulada.id == id)
    )
    res = await db.execute(stmt)
    return res.scalars().first()


async def reembolsar_venta_anulada(
    db: AsyncSession,
    id: UUID,
    obj_in: VentaAnuladaReembolsoUpdate,
) -> Optional[VentaAnulada]:
    """Legaliza el reembolso de oficina emitido por transferencia."""
    db_obj = await get_venta_anulada(db, id)
    if not db_obj:
        return None

    db_obj.referencia_reembolso_oficina = obj_in.referencia_reembolso_oficina.strip()
    if obj_in.banco_origen_reembolso:
        db_obj.banco_origen_reembolso = obj_in.banco_origen_reembolso.strip()
    db_obj.fecha_reembolso = obj_in.fecha_reembolso or datetime.now(timezone.utc)
    db_obj.estado_devolucion = EstadoDevolucion.REEMBOLSADO_OFICINA.value

    if obj_in.notas_oficina:
        nota_extra = f"\n[Oficina]: {obj_in.notas_oficina.strip()}"
        db_obj.notas_vendedor = (db_obj.notas_vendedor or "") + nota_extra

    await db.commit()
    await db.refresh(db_obj)
    return db_obj
