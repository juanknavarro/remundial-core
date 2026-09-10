from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.abono import Abono, CierreCaja, EstadoAbono
from app.models.credito import Credito, EstadoCredito
from app.models.usuario import Usuario
from app.schemas.abono import AbonoCreate


async def get_abono(db: AsyncSession, id_recibo: UUID) -> Optional[Abono]:
    """Obtiene un recibo de abono por su ID único."""
    query = (
        select(Abono)
        .options(
            selectinload(Abono.cobrador),
            selectinload(Abono.credito).selectinload(Credito.cliente),
        )
        .where(Abono.id_recibo == id_recibo)
    )
    result = await db.execute(query)
    a = result.scalar_one_or_none()
    if a:
        if a.credito:
            setattr(a, "numero_contrato", f"CTR-{str(a.credito_id)[:8].upper()}")
            if a.credito.cliente:
                setattr(a, "cliente_nombre", a.credito.cliente.nombres)
                setattr(a, "cliente_cedula", a.credito.cliente.cedula)
        else:
            setattr(a, "numero_contrato", f"CTR-{str(a.credito_id)[:8].upper()}")
        if not getattr(a, "metodo_pago", None):
            setattr(a, "metodo_pago", "efectivo")
    return a


async def get_abonos_by_credito(
    db: AsyncSession,
    credito_id: UUID,
    skip: int = 0,
    limit: int = 100,
) -> List[Abono]:
    """Lista todos los abonos aplicados a un contrato de crédito (historial para conciliación)."""
    # Validar que el crédito exista
    credito_existe = await db.get(Credito, credito_id)
    if not credito_existe:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Crédito con ID '{credito_id}' no encontrado",
        )

    query = (
        select(Abono)
        .options(
            selectinload(Abono.cobrador),
            selectinload(Abono.credito).selectinload(Credito.cliente),
        )
        .where(Abono.credito_id == credito_id)
        .offset(skip)
        .limit(limit)
        .order_by(Abono.fecha.desc())
    )
    result = await db.execute(query)
    abonos = list(result.scalars().all())
    for a in abonos:
        if a.credito:
            setattr(a, "numero_contrato", f"CTR-{str(a.credito_id)[:8].upper()}")
            if a.credito.cliente:
                setattr(a, "cliente_nombre", a.credito.cliente.nombres)
                setattr(a, "cliente_cedula", a.credito.cliente.cedula)
        else:
            setattr(a, "numero_contrato", f"CTR-{str(a.credito_id)[:8].upper()}")
        if not getattr(a, "metodo_pago", None):
            setattr(a, "metodo_pago", "efectivo")
    return abonos


async def get_abonos_list(
    db: AsyncSession,
    cobrador_id: Optional[UUID] = None,
    estado: Optional[EstadoAbono] = None,
    skip: int = 0,
    limit: int = 100,
) -> List[Abono]:
    """Lista abonos con filtros opcionales por cobrador o estado para conciliación administrativa."""
    query = (
        select(Abono)
        .options(
            selectinload(Abono.cobrador),
            selectinload(Abono.credito).selectinload(Credito.cliente),
        )
        .offset(skip)
        .limit(limit)
        .order_by(Abono.fecha.desc())
    )

    if cobrador_id:
        query = query.where(Abono.cobrador_id == cobrador_id)

    if estado:
        query = query.where(Abono.estado == estado)

    result = await db.execute(query)
    abonos = list(result.scalars().all())
    for a in abonos:
        if a.credito:
            setattr(a, "numero_contrato", f"CTR-{str(a.credito_id)[:8].upper()}")
            if a.credito.cliente:
                setattr(a, "cliente_nombre", a.credito.cliente.nombres)
                setattr(a, "cliente_cedula", a.credito.cliente.cedula)
            setattr(a, "saldo_restante_credito", a.credito.saldo_pendiente)
        else:
            setattr(a, "numero_contrato", f"CTR-{str(a.credito_id)[:8].upper()}")
            setattr(a, "saldo_restante_credito", Decimal("0.00"))
        if not getattr(a, "metodo_pago", None):
            setattr(a, "metodo_pago", "efectivo")
    return abonos


async def conciliar_ruta_abonos(
    db: AsyncSession,
    cobrador_id: UUID,
    efectivo_entregado: Decimal,
    responsable_id: UUID,
    notas: Optional[str] = None,
) -> dict:
    """Concilia todos los abonos en estado 'registrado' del cobrador, actualiza su estado a 'conciliado'
    y registra el acta contable de cierre en la tabla 'cierres_caja' para auditoría gerencial."""
    query = (
        select(Abono)
        .where(
            Abono.cobrador_id == cobrador_id,
            Abono.estado == EstadoAbono.REGISTRADO,
        )
    )
    result = await db.execute(query)
    abonos_pendientes = list(result.scalars().all())

    cobrador = await db.get(Usuario, cobrador_id)
    cobrador_nombre = cobrador.nombre if cobrador else "Cobrador"

    responsable = await db.get(Usuario, responsable_id)
    responsable_nombre = responsable.nombre if responsable else "Secretaría"

    total_esperado = sum((a.valor_abonado for a in abonos_pendientes), Decimal("0.00"))
    diferencia = efectivo_entregado - total_esperado

    if diferencia == Decimal("0.00"):
        cuadre_estado = "cuadrado"
    elif diferencia < Decimal("0.00"):
        cuadre_estado = "faltante"
    else:
        cuadre_estado = "sobrante"

    # Registrar el acta oficial en cierres_caja
    nuevo_cierre = CierreCaja(
        cobrador_id=cobrador_id,
        responsable_id=responsable_id,
        fecha_cierre=datetime.now(),
        total_esperado=total_esperado,
        efectivo_entregado=efectivo_entregado,
        diferencia=diferencia,
        cuadre_estado=cuadre_estado,
        abonos_conciliados_count=len(abonos_pendientes),
        notas=notas,
    )
    db.add(nuevo_cierre)
    await db.flush()  # Obtener el ID generado para relacionar los abonos

    for a in abonos_pendientes:
        a.estado = EstadoAbono.CONCILIADO
        a.cierre_caja_id = nuevo_cierre.id

    await db.commit()
    await db.refresh(nuevo_cierre)

    return {
        "id": nuevo_cierre.id,
        "cobrador_id": cobrador_id,
        "cobrador_nombre": cobrador_nombre,
        "responsable_id": responsable_id,
        "responsable_nombre": responsable_nombre,
        "total_esperado": total_esperado,
        "efectivo_entregado": efectivo_entregado,
        "diferencia": diferencia,
        "cuadre_estado": cuadre_estado,
        "abonos_conciliados_count": len(abonos_pendientes),
        "fecha_conciliacion": nuevo_cierre.fecha_cierre,
        "mensaje": f"Conciliación finalizada: {len(abonos_pendientes)} abonos conciliados. Estado de caja: {cuadre_estado}.",
        "notas": notas,
    }


async def get_cierres_caja_list(
    db: AsyncSession,
    cobrador_id: Optional[UUID] = None,
    skip: int = 0,
    limit: int = 100,
) -> List[dict]:
    """Lista las actas históricas de cierre de caja registradas para auditoría."""
    query = (
        select(CierreCaja)
        .options(
            selectinload(CierreCaja.cobrador),
            selectinload(CierreCaja.responsable),
        )
        .offset(skip)
        .limit(limit)
        .order_by(CierreCaja.fecha_cierre.desc())
    )

    if cobrador_id:
        query = query.where(CierreCaja.cobrador_id == cobrador_id)

    result = await db.execute(query)
    cierres = list(result.scalars().all())

    items = []
    for c in cierres:
        items.append({
            "id": c.id,
            "cobrador_id": c.cobrador_id,
            "cobrador_nombre": c.cobrador.nombre if c.cobrador else "Cobrador",
            "responsable_id": c.responsable_id,
            "responsable_nombre": c.responsable.nombre if c.responsable else "Secretaría",
            "fecha_cierre": c.fecha_cierre,
            "total_esperado": c.total_esperado,
            "efectivo_entregado": c.efectivo_entregado,
            "diferencia": c.diferencia,
            "cuadre_estado": c.cuadre_estado,
            "abonos_conciliados_count": c.abonos_conciliados_count,
            "notas": c.notas,
            "creado_en": c.creado_en,
        })
    return items



async def create_abono(db: AsyncSession, abono_in: AbonoCreate) -> Abono:
    """Registra un recaudo en terreno y amortiza el saldo del crédito en una única transacción atómica."""
    # 1. Buscar y bloquear a nivel de fila el crédito (concurrencia segura con SELECT FOR UPDATE)
    query_credito = (
        select(Credito)
        .where(Credito.id_contrato == abono_in.credito_id)
        .with_for_update()
    )
    result = await db.execute(query_credito)
    credito = result.scalar_one_or_none()

    if not credito:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El crédito con ID '{abono_in.credito_id}' no existe",
        )

    # Validar que el crédito tenga saldo pendiente por pagar
    if credito.saldo_pendiente <= Decimal("0.00"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"El crédito '{abono_in.credito_id}' ya se encuentra completamente cancelado "
                f"(Saldo pendiente actual: ${credito.saldo_pendiente:.2f})."
            ),
        )

    # 2. Validar que el valor abonado no supere el saldo pendiente
    monto_abono = round(Decimal(abono_in.valor_abonado), 2)
    if monto_abono > credito.saldo_pendiente:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"El valor abonado (${monto_abono:.2f}) no puede superar el saldo pendiente "
                f"del crédito (${credito.saldo_pendiente:.2f})."
            ),
        )

    # 3. Validar cobrador activo
    cobrador = await db.get(Usuario, abono_in.cobrador_id)
    if not cobrador or not cobrador.estado_activo:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El cobrador con ID '{abono_in.cobrador_id}' no existe o se encuentra inactivo.",
        )

    # 4. Procesar coordenadas GPS
    gps_tuple = (
        float(abono_in.coordenadas_gps_cobro.longitud),
        float(abono_in.coordenadas_gps_cobro.latitud),
    )

    try:
        # A. Insertar el recibo en la tabla abonos
        db_abono = Abono(
            credito_id=credito.id_contrato,
            cobrador_id=cobrador.id,
            valor_abonado=monto_abono,
            coordenadas_gps_cobro=gps_tuple,
            metodo_pago=(abono_in.metodo_pago or "efectivo").lower().strip(),
            estado=EstadoAbono.REGISTRADO,
        )
        db.add(db_abono)

        # B. Amortizar el saldo pendiente del contrato de crédito
        nuevo_saldo = round(credito.saldo_pendiente - monto_abono, 2)
        credito.saldo_pendiente = nuevo_saldo

        # C. Transición de estados del crédito y asignación permanente del cobrador
        if credito.cobrador_id is None:
            credito.cobrador_id = cobrador.id

        if nuevo_saldo == Decimal("0.00"):
            credito.estado = EstadoCredito.TERMINADO
        elif credito.estado == EstadoCredito.PENDIENTE:
            credito.estado = EstadoCredito.ACTIVO

        # D. Confirmar ambas operaciones atómicamente en una sola transacción
        await db.commit()
        await db.refresh(db_abono)
    except Exception:
        await db.rollback()
        raise

    # Cargar datos para serialización completa
    abono_creado = await get_abono(db, db_abono.id_recibo)
    if abono_creado:
        setattr(abono_creado, "saldo_restante_credito", nuevo_saldo)
        return abono_creado

    return db_abono
