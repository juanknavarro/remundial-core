from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import cast, select, String
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.abono import Abono, CierreCaja, EstadoAbono
from app.models.credito import Credito, EstadoCredito
from app.models.usuario import Usuario
from app.schemas.abono import AbonoCreate
from app.schemas.credito import generar_cronograma_con_arrastre
from app.services.pdf_recibo import guardar_firma_abono


def _enriquecer_abono_con_cronograma(a: Optional[Abono]) -> Optional[Abono]:
    """Popula campos contables derivados, saldo insoluto y arrastre a la siguiente cuota."""
    if not a:
        return a
    if not getattr(a, "metodo_pago", None):
        setattr(a, "metodo_pago", "efectivo")

    if a.cobrador:
        setattr(a, "cobrador_nombre", a.cobrador.nombre)

    if a.credito:
        setattr(a, "numero_contrato", f"CTR-{str(a.credito_id)[:8].upper()}")
        if a.credito.cliente:
            setattr(a, "cliente_nombre", a.credito.cliente.nombres)
            setattr(a, "cliente_cedula", a.credito.cliente.cedula)
        setattr(a, "saldo_restante_credito", a.credito.saldo_pendiente)

        # Si ya fue enriquecido por create_abono, retornar directamente
        if getattr(a, "es_abono_parcial", None) is not None:
            if a.cobrador and not getattr(a, "cobrador_nombre", None):
                setattr(a, "cobrador_nombre", a.cobrador.nombre)
            return a

        v_base = a.credito.valor_cuota or Decimal("0.00")
        monto_abono = a.valor_abonado or Decimal("0.00")

        cron_data = generar_cronograma_con_arrastre(
            fecha_primera_cuota=a.credito.fecha_primera_cuota,
            numero_cuotas=a.credito.numero_cuotas,
            monto_financiado=a.credito.monto_financiado,
            saldo_pendiente=a.credito.saldo_pendiente,
            valor_cuota_base=a.credito.valor_cuota,
            tipo_pago=a.credito.tipo_pago,
        )
        cronograma = cron_data["cronograma"]
        cuota_parcial = next((q for q in cronograma if q.es_parcial), None)

        if cuota_parcial:
            es_parcial = True
            cuota_afectada = cuota_parcial.numero
            diferencia = cuota_parcial.saldo_cuota
            cuota_sig = next((q for q in cronograma if q.numero == cuota_afectada + 1), None)
            valor_sig = cuota_sig.valor_cuota if cuota_sig else (v_base + diferencia)
        elif monto_abono < v_base and a.credito.saldo_pendiente > Decimal("0.00"):
            es_parcial = True
            diferencia = v_base - monto_abono
            cuota_afectada = cron_data["cuota_actual_numero"]
            valor_sig = v_base + diferencia
        else:
            es_parcial = False
            diferencia = Decimal("0.00")
            cuota_afectada = cron_data["cuota_actual_numero"]
            cuota_sig = next((q for q in cronograma if q.numero == cuota_afectada), None)
            valor_sig = cuota_sig.valor_cuota if cuota_sig else v_base

        setattr(a, "es_abono_parcial", es_parcial)
        setattr(a, "diferencia_arrastrada", diferencia)
        setattr(a, "cuota_afectada_numero", cuota_afectada)
        setattr(a, "valor_cuota_siguiente", valor_sig)
    else:
        setattr(a, "numero_contrato", f"CTR-{str(a.credito_id)[:8].upper()}")
        setattr(a, "saldo_restante_credito", Decimal("0.00"))
        setattr(a, "es_abono_parcial", False)
        setattr(a, "diferencia_arrastrada", Decimal("0.00"))
        setattr(a, "cuota_afectada_numero", None)
        setattr(a, "valor_cuota_siguiente", None)

    return a


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
    return _enriquecer_abono_con_cronograma(a)


async def get_abono_por_id_o_hash(db: AsyncSession, id_o_hash: str) -> Optional[Abono]:
    """Obtiene un recibo de abono por su UUID exacto o por prefijo/hash (ej. REC-9F22935A o 9f22935a)."""
    raw = str(id_o_hash).strip()
    clean = raw.upper().replace("REC-", "").strip() if raw.upper().startswith("REC-") else raw

    # 1. Intentar como UUID completo
    try:
        uuid_obj = UUID(clean)
        return await get_abono(db, uuid_obj)
    except (ValueError, TypeError, AttributeError):
        pass

    # 2. Buscar por coincidencia inicial en id_recibo
    query = (
        select(Abono)
        .options(
            selectinload(Abono.cobrador),
            selectinload(Abono.credito).selectinload(Credito.cliente),
        )
        .where(cast(Abono.id_recibo, String).ilike(f"{clean}%"))
        .order_by(Abono.fecha.desc())
    )
    result = await db.execute(query)
    a = result.scalars().first()
    return _enriquecer_abono_con_cronograma(a)


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
    return [_enriquecer_abono_con_cronograma(a) for a in abonos]


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
    return [_enriquecer_abono_con_cronograma(a) for a in abonos]


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

        # E. Persistir firmas manuscritas digitales (cliente titular y cobrador) si fueron capturadas
        if getattr(abono_in, "firma_cliente", None) or getattr(abono_in, "firma_cobrador", None):
            try:
                guardar_firma_abono(
                    db_abono.id_recibo,
                    firma_cliente=getattr(abono_in, "firma_cliente", None),
                    firma_cobrador=getattr(abono_in, "firma_cobrador", None),
                )
                if getattr(abono_in, "firma_cliente", None):
                    setattr(db_abono, "firma_cliente", abono_in.firma_cliente)
                if getattr(abono_in, "firma_cobrador", None):
                    setattr(db_abono, "firma_cobrador", abono_in.firma_cobrador)
            except Exception as fe:
                print(f"[Abono] Advertencia guardando firmas digitales de abono: {fe}")
    except Exception:
        await db.rollback()
        raise

    # Cargar datos para serialización completa y calcular arrastre de saldo
    cron_data = generar_cronograma_con_arrastre(
        fecha_primera_cuota=credito.fecha_primera_cuota,
        numero_cuotas=credito.numero_cuotas,
        monto_financiado=credito.monto_financiado,
        saldo_pendiente=nuevo_saldo,
        valor_cuota_base=credito.valor_cuota,
        tipo_pago=credito.tipo_pago,
    )
    cronograma = cron_data["cronograma"]
    cuota_parcial = next((q for q in cronograma if q.es_parcial), None)

    if cuota_parcial:
        es_parcial = True
        cuota_afectada = cuota_parcial.numero
        diferencia = cuota_parcial.saldo_cuota
        cuota_sig = next((q for q in cronograma if q.numero == cuota_afectada + 1), None)
        valor_sig = cuota_sig.valor_cuota if cuota_sig else None
    else:
        es_parcial = False
        diferencia = Decimal("0.00")
        cuota_afectada = cron_data["cuota_actual_numero"]
        cuota_sig = next((q for q in cronograma if q.numero == cuota_afectada), None)
        valor_sig = cuota_sig.valor_cuota if cuota_sig else credito.valor_cuota

    raw_cobrador_nom = (
        getattr(abono_in, "cobrador_nombre", None)
        or (cobrador.nombre if cobrador and getattr(cobrador, "nombre", None) else None)
        or (cobrador.nombre_completo if cobrador and getattr(cobrador, "nombre_completo", None) else None)
        or getattr(cobrador, "nombre", None)
    )
    if raw_cobrador_nom and str(raw_cobrador_nom).strip() and str(raw_cobrador_nom).strip().lower() not in ["none", "null"]:
        cobrador_nombre_str = str(raw_cobrador_nom).strip()
    else:
        cobrador_nombre_str = "Pedro Cobrador"
    abono_creado = await get_abono(db, db_abono.id_recibo)
    if abono_creado:
        setattr(abono_creado, "saldo_restante_credito", nuevo_saldo)
        setattr(abono_creado, "es_abono_parcial", es_parcial)
        setattr(abono_creado, "diferencia_arrastrada", diferencia)
        setattr(abono_creado, "cuota_afectada_numero", cuota_afectada)
        setattr(abono_creado, "valor_cuota_siguiente", valor_sig)
        setattr(abono_creado, "cobrador_nombre", cobrador_nombre_str)
        if getattr(abono_in, "firma_cliente", None):
            setattr(abono_creado, "firma_cliente", abono_in.firma_cliente)
        if getattr(abono_in, "firma_cobrador", None):
            setattr(abono_creado, "firma_cobrador", abono_in.firma_cobrador)
        return abono_creado

    setattr(db_abono, "saldo_restante_credito", nuevo_saldo)
    setattr(db_abono, "es_abono_parcial", es_parcial)
    setattr(db_abono, "diferencia_arrastrada", diferencia)
    setattr(db_abono, "cuota_afectada_numero", cuota_afectada)
    setattr(db_abono, "valor_cuota_siguiente", valor_sig)
    setattr(db_abono, "cobrador_nombre", cobrador_nombre_str)
    if getattr(abono_in, "firma_cliente", None):
        setattr(db_abono, "firma_cliente", abono_in.firma_cliente)
    if getattr(abono_in, "firma_cobrador", None):
        setattr(db_abono, "firma_cobrador", abono_in.firma_cobrador)
    return db_abono
