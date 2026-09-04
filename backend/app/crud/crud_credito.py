from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.cliente import Cliente
from app.models.credito import Credito, CreditoDetalle, EstadoCredito
from app.models.producto import Producto
from app.models.usuario import Usuario
from app.schemas.credito import CreditoCreate


async def get_credito(db: AsyncSession, id_contrato: UUID) -> Optional[Credito]:
    """Obtiene un crédito por su ID de contrato con cliente, vendedor y artículos cargados."""
    query = (
        select(Credito)
        .options(
            selectinload(Credito.detalles).selectinload(CreditoDetalle.producto),
            selectinload(Credito.cliente),
            selectinload(Credito.vendedor),
            selectinload(Credito.supervisor),
            selectinload(Credito.cobrador),
        )
        .where(Credito.id_contrato == id_contrato)
    )
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def get_creditos(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 50,
    cliente_id: Optional[UUID] = None,
    vendedor_id: Optional[UUID] = None,
    cobrador_id: Optional[UUID] = None,
    estado: Optional[EstadoCredito] = None,
) -> List[Credito]:
    """Lista créditos con opciones de paginación y filtros operativos."""
    query = (
        select(Credito)
        .options(
            selectinload(Credito.detalles).selectinload(CreditoDetalle.producto),
            selectinload(Credito.cliente),
            selectinload(Credito.vendedor),
        )
        .offset(skip)
        .limit(limit)
        .order_by(Credito.creado_en.desc())
    )

    if cliente_id:
        query = query.where(Credito.cliente_id == cliente_id)
    if vendedor_id:
        query = query.where(Credito.vendedor_id == vendedor_id)
    if cobrador_id:
        query = query.where(Credito.cobrador_id == cobrador_id)
    if estado:
        query = query.where(Credito.estado == estado)

    result = await db.execute(query)
    return list(result.scalars().all())


async def create_credito(db: AsyncSession, credito_in: CreditoCreate) -> Credito:
    """Origina un nuevo crédito con sus líneas de detalle bajo una transacción estricta."""
    # 1. Validaciones financieras estrictas
    total_calculado_cuotas = round(
        Decimal(credito_in.numero_cuotas) * Decimal(credito_in.valor_cuota), 2
    )
    monto_financiado_redondeado = round(Decimal(credito_in.monto_financiado), 2)

    # Permitir tolerancia para redondeos en COP (moneda sin centavos físicos)
    tolerancia_redondeo = max(Decimal("100.00"), Decimal(credito_in.numero_cuotas))
    if abs(total_calculado_cuotas - monto_financiado_redondeado) > tolerancia_redondeo:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Inconsistencia financiera: El cálculo de las cuotas ({credito_in.numero_cuotas} cuotas de "
                f"${credito_in.valor_cuota:.2f} = ${total_calculado_cuotas:.2f}) "
                f"no coincide con el monto financiado declarado (${monto_financiado_redondeado:.2f})."
            ),
        )

    # Validar sumatoria de artículos contra cuota inicial + monto financiado
    total_articulos = round(
        sum(
            Decimal(item.cantidad) * Decimal(item.valor_unitario_acordado)
            for item in credito_in.detalles
        ),
        2,
    )
    total_venta = round(
        Decimal(credito_in.cuota_inicial) + monto_financiado_redondeado, 2
    )

    if abs(total_articulos - total_venta) > Decimal("0.10"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Inconsistencia comercial: El valor total de los artículos (${total_articulos:.2f}) "
                f"no cuadra con la suma de la cuota inicial (${credito_in.cuota_inicial:.2f}) "
                f"+ monto financiado (${monto_financiado_redondeado:.2f}) = ${total_venta:.2f}."
            ),
        )

    # Validar unicidad de productos dentro de la misma venta
    productos_ids = [item.producto_id for item in credito_in.detalles]
    if len(productos_ids) != len(set(productos_ids)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Se encontraron productos duplicados en la lista de detalles. Consolide las cantidades.",
        )

    # 2. Validar existencia previa de participantes en la base de datos
    cliente = await db.get(Cliente, credito_in.cliente_id)
    if not cliente:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cliente con ID '{credito_in.cliente_id}' no existe",
        )

    vendedor = await db.get(Usuario, credito_in.vendedor_id)
    if not vendedor:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Vendedor con ID '{credito_in.vendedor_id}' no existe",
        )

    if credito_in.supervisor_id:
        supervisor = await db.get(Usuario, credito_in.supervisor_id)
        if not supervisor:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supervisor con ID '{credito_in.supervisor_id}' no existe",
            )

    if credito_in.cobrador_id:
        cobrador = await db.get(Usuario, credito_in.cobrador_id)
        if not cobrador:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Cobrador con ID '{credito_in.cobrador_id}' no existe",
            )

    # Validar existencia de cada producto incluido
    for item in credito_in.detalles:
        prod = await db.get(Producto, item.producto_id)
        if not prod:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Producto con ID '{item.producto_id}' no existe en el catálogo",
            )

    # 3. Transacción atómica estricta
    es_contado = monto_financiado_redondeado == Decimal("0.00")
    estado_final = EstadoCredito.TERMINADO if es_contado else credito_in.estado
    saldo_inicial = (
        Decimal("0.00")
        if es_contado
        else (credito_in.saldo_pendiente if credito_in.saldo_pendiente is not None else credito_in.monto_financiado)
    )

    try:
        # A. Insertar cabecera del crédito
        db_credito = Credito(
            cliente_id=credito_in.cliente_id,
            vendedor_id=credito_in.vendedor_id,
            supervisor_id=credito_in.supervisor_id,
            cobrador_id=credito_in.cobrador_id,
            estado=estado_final,
            tipo_pago=credito_in.tipo_pago,
            cuota_inicial=credito_in.cuota_inicial,
            monto_financiado=credito_in.monto_financiado,
            numero_cuotas=credito_in.numero_cuotas,
            valor_cuota=credito_in.valor_cuota,
            fecha_primera_cuota=credito_in.fecha_primera_cuota,
            saldo_pendiente=saldo_inicial,
        )
        db.add(db_credito)
        # Flush para obtener db_credito.id_contrato sin comprometer la transacción
        await db.flush()

        # B. Iterar e insertar los detalles amarrados al ID del nuevo crédito
        for detalle_in in credito_in.detalles:
            db_detalle = CreditoDetalle(
                credito_id=db_credito.id_contrato,
                producto_id=detalle_in.producto_id,
                cantidad=detalle_in.cantidad,
                valor_unitario_acordado=detalle_in.valor_unitario_acordado,
            )
            db.add(db_detalle)

        # C. Confirmación única atómica (Commit)
        await db.commit()
    except Exception:
        # Reversión completa en caso de cualquier excepción
        await db.rollback()
        raise

    # 4. Retornar el crédito completo con todas sus relaciones cargadas
    credito_creado = await get_credito(db, db_credito.id_contrato)
    if not credito_creado:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error al recuperar el crédito recién originado",
        )
    return credito_creado
