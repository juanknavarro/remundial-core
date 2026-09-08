from datetime import date
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.cliente import Cliente, ReferenciaCliente, TipoReferenciaEnum
from app.models.credito import Credito, CreditoDetalle, EstadoCredito
from app.models.producto import Producto
from app.models.usuario import Usuario
from app.schemas.credito import CreditoCreate, CreditoUpdate


def _poblar_codeudor_y_referencia(credito: Optional[Credito]) -> Optional[Credito]:
    """Asigna los objetos de codeudor y referencia familiar si el cliente titular los tiene registrados."""
    if not credito or not credito.cliente:
        return credito
    referencias = getattr(credito.cliente, "referencias", None)
    if referencias:
        for ref in referencias:
            if ref.tipo == TipoReferenciaEnum.CODEUDOR and not getattr(credito, "codeudor", None):
                credito.codeudor = {
                    "nombre": ref.nombre,
                    "cedula": ref.cedula,
                    "telefono": ref.telefono,
                    "direccion": ref.direccion,
                }
            elif ref.tipo == TipoReferenciaEnum.FAMILIAR and not getattr(credito, "referencia", None):
                parentesco = None
                direccion_limpia = ref.direccion
                if ref.direccion and "Parentesco:" in ref.direccion:
                    partes = ref.direccion.split(" • ")
                    for p in partes:
                        if p.startswith("Parentesco:"):
                            parentesco = p.replace("Parentesco:", "").strip()
                        else:
                            direccion_limpia = p
                credito.referencia = {
                    "nombre": ref.nombre,
                    "telefono": ref.telefono,
                    "parentesco": parentesco,
                    "direccion": direccion_limpia,
                }
    return credito


async def get_credito(db: AsyncSession, id_contrato: UUID) -> Optional[Credito]:
    """Obtiene un crédito por su ID de contrato con cliente, vendedor y artículos cargados."""
    query = (
        select(Credito)
        .options(
            selectinload(Credito.detalles).selectinload(CreditoDetalle.producto),
            selectinload(Credito.cliente).selectinload(Cliente.referencias),
            selectinload(Credito.vendedor),
            selectinload(Credito.supervisor),
            selectinload(Credito.cobrador),
        )
        .where(Credito.id_contrato == id_contrato)
    )
    result = await db.execute(query)
    return _poblar_codeudor_y_referencia(result.scalar_one_or_none())


async def get_creditos(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 50,
    cliente_id: Optional[UUID] = None,
    vendedor_id: Optional[UUID] = None,
    cobrador_id: Optional[UUID] = None,
    estado: Optional[EstadoCredito] = None,
    fecha: Optional[date] = None,
) -> List[Credito]:
    """Lista créditos con opciones de paginación y filtros operativos."""
    query = (
        select(Credito)
        .options(
            selectinload(Credito.detalles).selectinload(CreditoDetalle.producto),
            selectinload(Credito.cliente).selectinload(Cliente.referencias),
            selectinload(Credito.vendedor),
            selectinload(Credito.supervisor),
            selectinload(Credito.cobrador),
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
    if fecha:
        query = query.where(func.date(Credito.creado_en) == fecha)

    result = await db.execute(query)
    creditos = list(result.scalars().all())
    for c in creditos:
        _poblar_codeudor_y_referencia(c)
    return creditos



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

        # C. Insertar datos de respaldo (Codeudor y Referencia Familiar) si se proporcionaron
        if credito_in.codeudor and credito_in.codeudor.nombre:
            ref_codeudor = ReferenciaCliente(
                cliente_id=credito_in.cliente_id,
                tipo=TipoReferenciaEnum.CODEUDOR,
                nombre=credito_in.codeudor.nombre.strip(),
                cedula=credito_in.codeudor.cedula.strip() if credito_in.codeudor.cedula else None,
                telefono=credito_in.codeudor.telefono.strip() if credito_in.codeudor.telefono else None,
                direccion=credito_in.codeudor.direccion.strip() if credito_in.codeudor.direccion else None,
            )
            db.add(ref_codeudor)

        if credito_in.referencia and credito_in.referencia.nombre:
            partes_dir = []
            if credito_in.referencia.parentesco:
                partes_dir.append(f"Parentesco: {credito_in.referencia.parentesco.strip()}")
            if credito_in.referencia.direccion:
                partes_dir.append(credito_in.referencia.direccion.strip())
            dir_final = " • ".join(partes_dir) if partes_dir else None

            ref_familiar = ReferenciaCliente(
                cliente_id=credito_in.cliente_id,
                tipo=TipoReferenciaEnum.FAMILIAR,
                nombre=credito_in.referencia.nombre.strip(),
                telefono=credito_in.referencia.telefono.strip() if credito_in.referencia.telefono else None,
                direccion=dir_final,
            )
            db.add(ref_familiar)

        # D. Confirmación única atómica (Commit)
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

    # Garantizar presencia de codeudor y referencia en la respuesta inmediata
    if credito_in.codeudor:
        credito_creado.codeudor = credito_in.codeudor
    if credito_in.referencia:
        credito_creado.referencia = credito_in.referencia

    return credito_creado



async def update_credito(
    db: AsyncSession,
    id_contrato: UUID,
    credito_in: CreditoUpdate,
    supervisor_id: Optional[UUID] = None,
) -> Optional[Credito]:
    """Actualiza de forma persistente los datos administrativos o el estado de un crédito."""
    credito = await db.get(Credito, id_contrato)
    if not credito:
        return None

    if credito_in.estado is not None:
        credito.estado = credito_in.estado
        if credito_in.estado == EstadoCredito.ACTIVO and supervisor_id is not None:
            credito.supervisor_id = supervisor_id

    if supervisor_id is not None and credito.supervisor_id is None:
        credito.supervisor_id = supervisor_id
    elif credito_in.supervisor_id is not None:
        credito.supervisor_id = credito_in.supervisor_id

    if credito_in.cobrador_id is not None:
        credito.cobrador_id = credito_in.cobrador_id

    if credito_in.saldo_pendiente is not None:
        credito.saldo_pendiente = credito_in.saldo_pendiente

    # Actualizar o registrar datos del Codeudor Solidario si se envían
    if credito_in.codeudor and credito_in.codeudor.nombre:
        q_codeudor = select(ReferenciaCliente).where(
            ReferenciaCliente.cliente_id == credito.cliente_id,
            ReferenciaCliente.tipo == TipoReferenciaEnum.CODEUDOR,
        )
        res_c = await db.execute(q_codeudor)
        ref_codeudor = res_c.scalars().first()
        if ref_codeudor:
            ref_codeudor.nombre = credito_in.codeudor.nombre.strip()
            ref_codeudor.cedula = credito_in.codeudor.cedula.strip() if credito_in.codeudor.cedula else None
            ref_codeudor.telefono = credito_in.codeudor.telefono.strip() if credito_in.codeudor.telefono else None
            ref_codeudor.direccion = credito_in.codeudor.direccion.strip() if credito_in.codeudor.direccion else None
        else:
            db.add(
                ReferenciaCliente(
                    cliente_id=credito.cliente_id,
                    tipo=TipoReferenciaEnum.CODEUDOR,
                    nombre=credito_in.codeudor.nombre.strip(),
                    cedula=credito_in.codeudor.cedula.strip() if credito_in.codeudor.cedula else None,
                    telefono=credito_in.codeudor.telefono.strip() if credito_in.codeudor.telefono else None,
                    direccion=credito_in.codeudor.direccion.strip() if credito_in.codeudor.direccion else None,
                )
            )

    # Actualizar o registrar datos de la Referencia Familiar si se envían
    if credito_in.referencia and credito_in.referencia.nombre:
        q_ref = select(ReferenciaCliente).where(
            ReferenciaCliente.cliente_id == credito.cliente_id,
            ReferenciaCliente.tipo == TipoReferenciaEnum.FAMILIAR,
        )
        res_r = await db.execute(q_ref)
        ref_familiar = res_r.scalars().first()
        parentesco_str = credito_in.referencia.parentesco.strip() if credito_in.referencia.parentesco else "Familiar"
        dir_val = (
            f"{credito_in.referencia.direccion.strip()} • Parentesco: {parentesco_str}"
            if credito_in.referencia.direccion
            else f"Parentesco: {parentesco_str}"
        )
        if ref_familiar:
            ref_familiar.nombre = credito_in.referencia.nombre.strip()
            ref_familiar.telefono = credito_in.referencia.telefono.strip() if credito_in.referencia.telefono else None
            ref_familiar.direccion = dir_val
        else:
            db.add(
                ReferenciaCliente(
                    cliente_id=credito.cliente_id,
                    tipo=TipoReferenciaEnum.FAMILIAR,
                    nombre=credito_in.referencia.nombre.strip(),
                    telefono=credito_in.referencia.telefono.strip() if credito_in.referencia.telefono else None,
                    direccion=dir_val,
                )
            )

    await db.commit()
    return await get_credito(db, id_contrato)


async def aprobar_credito(
    db: AsyncSession,
    id_contrato: UUID,
    supervisor_id: UUID,
    cobrador_id: Optional[UUID] = None,
) -> Optional[Credito]:
    """Aprueba un contrato de crédito pendiente, activándolo y asignando cobrador permanente si se indica."""
    credito = await db.get(Credito, id_contrato)
    if not credito:
        return None

    credito.estado = EstadoCredito.ACTIVO
    credito.supervisor_id = supervisor_id
    if cobrador_id is not None:
        credito.cobrador_id = cobrador_id
    await db.commit()
    return await get_credito(db, id_contrato)


async def rechazar_credito(
    db: AsyncSession,
    id_contrato: UUID,
    supervisor_id: UUID,
) -> Optional[Credito]:
    """Rechaza un contrato de crédito pendiente marcándolo como terminado sin saldo."""
    credito = await db.get(Credito, id_contrato)
    if not credito:
        return None

    credito.estado = EstadoCredito.TERMINADO
    credito.supervisor_id = supervisor_id
    credito.saldo_pendiente = Decimal("0.00")
    await db.commit()
    return await get_credito(db, id_contrato)
