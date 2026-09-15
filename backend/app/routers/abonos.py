from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    decode_access_token,
    get_current_user,
    get_user_from_header_or_query,
    require_cobrador_o_supervisor,
    require_supervisor_o_secretaria,
)
from app.crud import crud_abono
from app.models.abono import EstadoAbono
from app.models.usuario import RolUsuario, Usuario
from app.schemas.abono import (
    AbonoCreate,
    AbonoResponse,
    CierreCajaResponse,
    ConciliacionRutaRequest,
    ConciliacionRutaResponse,
    ReciboOfflinePdfRequest,
)
from app.services.pdf_recibo import (
    construir_nombre_archivo_pdf,
    generar_pdf_recibo_abono,
    guardar_firma_abono,
    obtener_firma_almacenada,
)

router = APIRouter(
    prefix="/abonos",
    tags=["Abonos y Recaudos"],
)


@router.post(
    "",
    response_model=AbonoResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Registrar un nuevo abono en terreno (Solo Cobrador o Supervisor)",
)
async def registrar_abono(
    abono_in: AbonoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_cobrador_o_supervisor),
):
    """Registra un recaudo en terreno.
    
    Seguridad RBAC: Solo accesible para roles 'cobrador' y 'supervisor'.
    Inmutable: No existen endpoints de modificación (PUT) ni eliminación (DELETE).
    """
    # Si quien registra es un cobrador, asegurar asignación inequívoca a su propia identidad autenticada
    if current_user.rol == RolUsuario.COBRADOR:
        if not abono_in.cobrador_id or abono_in.cobrador_id != current_user.id:
            abono_in.cobrador_id = current_user.id

    return await crud_abono.create_abono(db=db, abono_in=abono_in)


@router.get(
    "/credito/{credito_id}",
    response_model=List[AbonoResponse],
    summary="Consultar historial de abonos de un crédito",
    status_code=status.HTTP_200_OK,
)
async def listar_abonos_por_credito(
    credito_id: UUID,
    skip: int = Query(0, ge=0, description="Registros a omitir para paginación"),
    limit: int = Query(100, ge=1, le=500, description="Límite de registros a retornar"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Devuelve la cronología completa de pagos de un crédito para efectos de conciliación administrativa y contable."""
    return await crud_abono.get_abonos_by_credito(
        db=db,
        credito_id=credito_id,
        skip=skip,
        limit=limit,
    )


@router.get(
    "/cierres-caja",
    response_model=List[CierreCajaResponse],
    summary="Listar actas históricas de cierre de caja (Supervisor o Secretaria)",
    status_code=status.HTTP_200_OK,
)
async def listar_cierres_caja(
    cobrador_id: Optional[UUID] = Query(None, description="Filtrar por cobrador asignado"),
    skip: int = Query(0, ge=0, description="Paginación: registros a omitir"),
    limit: int = Query(100, ge=1, le=500, description="Límite de registros"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor_o_secretaria),
):
    """Retorna las actas históricas de arqueo y cierre de caja realizadas en secretaría."""
    return await crud_abono.get_cierres_caja_list(
        db=db,
        cobrador_id=cobrador_id,
        skip=skip,
        limit=limit,
    )


@router.get(
    "/{id_recibo}",
    response_model=AbonoResponse,
    summary="Consultar un recibo de recaudo por ID",
    status_code=status.HTTP_200_OK,
)
async def obtener_abono(
    id_recibo: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Consulta la información inmutable de un comprobante de abono específico."""
    abono = await crud_abono.get_abono(db=db, id_recibo=id_recibo)
    if not abono:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Recibo de abono con ID '{id_recibo}' no encontrado",
        )
    return abono


@router.get(
    "/{id_recibo}/recibo-pdf",
    summary="Generar Recibo Digital de Abono (PDF) - Formato Remundial Arte's",
    description="Genera el comprobante digital oficial de recaudo y abono a cartera en formato PDF.",
    status_code=status.HTTP_200_OK,
)
async def descargar_recibo_abono_pdf(
    id_recibo: str,
    cobrador_nombre: Optional[str] = Query(None, description="Nombre real del cobrador autenticado para el recibo"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_user_from_header_or_query),
):
    abono = await crud_abono.get_abono_por_id_o_hash(db=db, id_o_hash=id_recibo)
    if not abono:
        if str(id_recibo).startswith("ABONO-OFF-") or str(id_recibo).startswith("OFF-"):
            nombre_cobrador = (
                (cobrador_nombre.strip() if cobrador_nombre and cobrador_nombre.strip() and cobrador_nombre.strip().lower() not in ["none", "null"] else None)
                or (getattr(current_user, "nombre", "").strip() if current_user and getattr(current_user, "nombre", None) and str(current_user.nombre).strip() and str(current_user.nombre).strip().lower() not in ["none", "null"] else None)
                or (getattr(current_user, "nombre_completo", "").strip() if current_user and getattr(current_user, "nombre_completo", None) and str(current_user.nombre_completo).strip() else None)
                or "Pedro Cobrador"
            )
            dt_actual = datetime.now()
            firma_guardada = obtener_firma_almacenada(id_recibo, "cliente")
            mock_cliente = SimpleNamespace(
                nombres="Cliente Titular",
                nombre_completo="Cliente Titular",
                cedula="S/N",
                telefono="No registrado",
                direccion="Montería, Córdoba",
                barrio="Centro",
                ciudad="Montería",
            )
            mock_credito = SimpleNamespace(
                id_contrato="CTR-RUTA",
                numero_contrato="CTR-RUTA",
                cliente=mock_cliente,
                saldo_pendiente=Decimal("0.00"),
                monto_financiado=Decimal("0.00"),
                numero_cuotas=12,
                valor_cuota=Decimal("0.00"),
                tipo_pago="mensual",
            )
            mock_cobrador = SimpleNamespace(
                id=current_user.id,
                nombre=nombre_cobrador,
                nombre_completo=nombre_cobrador,
                telefono=getattr(current_user, "telefono", "No registrado"),
            )
            abono = SimpleNamespace(
                id_recibo=id_recibo,
                credito_id="CTR-RUTA",
                numero_contrato="CTR-RUTA",
                fecha=dt_actual,
                creado_en=dt_actual,
                estado="registrado",
                valor_abonado=Decimal("0.00"),
                metodo_pago="efectivo",
                cliente_nombre="Cliente Titular",
                cliente_cedula="S/N",
                credito=mock_credito,
                cobrador=mock_cobrador,
                cobrador_id=current_user.id,
                cobrador_nombre=nombre_cobrador,
                cobrador_telefono=getattr(current_user, "telefono", "No registrado"),
                saldo_restante_credito=Decimal("0.00"),
                es_abono_parcial=False,
                diferencia_arrastrada=Decimal("0.00"),
                cuota_afectada_numero=1,
                cuota_siguiente_numero=2,
                valor_cuota_siguiente=Decimal("0.00"),
                firma_cliente=firma_guardada,
                firma_cobrador=obtener_firma_almacenada(id_recibo, "cobrador"),
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Recibo de abono con ID '{id_recibo}' no encontrado.",
            )

    # Autorización RBAC: cobrador activo solo se restringe si el recaudo pertenece explícitamente a otro cobrador
    rol_str = getattr(current_user.rol, "value", str(current_user.rol)).lower()
    if rol_str == "cobrador" and getattr(abono, "cobrador_id", None) and str(abono.cobrador_id) != str(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No cuenta con autorización para visualizar o descargar un comprobante de recaudo de otro cobrador.",
        )

    nombre_cobrador_real = (
        (cobrador_nombre.strip() if cobrador_nombre and cobrador_nombre.strip() and cobrador_nombre.strip().lower() not in ["none", "null"] else None)
        or (getattr(abono, "cobrador_nombre", "").strip() if getattr(abono, "cobrador_nombre", None) and str(abono.cobrador_nombre).strip() and str(abono.cobrador_nombre).strip().lower() not in ["none", "null"] else None)
        or (current_user.nombre.strip() if current_user and getattr(current_user, "nombre", None) else None)
        or (current_user.nombre_completo.strip() if current_user and getattr(current_user, "nombre_completo", None) else None)
        or (abono.cobrador.nombre.strip() if getattr(abono, "cobrador", None) and getattr(abono.cobrador, "nombre", None) else None)
        or "Pedro Cobrador"
    )

    pdf_bytes = generar_pdf_recibo_abono(abono, cobrador_nombre=nombre_cobrador_real)
    cliente_nombre = getattr(abono, "cliente_nombre", None)
    if not cliente_nombre and getattr(abono, "credito", None) and getattr(abono.credito, "cliente", None):
        cliente_nombre = getattr(abono.credito.cliente, "nombre_completo", None) or getattr(abono.credito.cliente, "nombres", "Cliente")
    if not cliente_nombre:
        cliente_nombre = "Cliente"
    id_contrato = f"CTR-{str(abono.credito_id)[:8].upper()}" if getattr(abono, "credito_id", None) else f"REC-{str(abono.id_recibo)[:8].upper()}"
    fecha_abono = getattr(abono, "fecha_pago", None) or getattr(abono, "creado_en", None)
    cuota_num = getattr(abono, "cuota_afectada_numero", None) or 1
    cuota_tag = f"Cuota-{cuota_num}"
    filename = construir_nombre_archivo_pdf("Recibo", id_contrato, cliente_nombre, fecha_abono, cuota=cuota_tag)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


@router.post(
    "/recibo-offline-pdf",
    summary="Generar Recibo Digital de Abono Offline (PDF) con ReportLab",
    description="Genera el comprobante digital oficial de ReportLab con la firma manuscrita del cliente y el cobrador real autenticado.",
    status_code=status.HTTP_200_OK,
)
async def generar_recibo_offline_pdf(
    datos: ReciboOfflinePdfRequest,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(None),
    token_query: Optional[str] = Query(None, alias="token"),
):
    """Permite generar el PDF oficial de ReportLab directamente desde los datos capturados en terreno/offline."""
    current_user = None
    token = None
    if authorization and isinstance(authorization, str) and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif token_query and isinstance(token_query, str):
        token = token_query.strip()
    if token:
        try:
            payload = decode_access_token(token)
            uid = payload.get("sub")
            if uid:
                current_user = await db.get(Usuario, UUID(uid))
        except Exception:
            pass

    # Resolver nombre real del cobrador:
    # 1. Del body datos.cobrador_nombre
    # 2. Del usuario autenticado en sesión activa (current_user.nombre)
    # 3. Fallback
    nombre_cobrador = (
        (datos.cobrador_nombre.strip() if datos.cobrador_nombre and datos.cobrador_nombre.strip() and datos.cobrador_nombre.strip().lower() not in ["none", "null"] else None)
        or (current_user.nombre.strip() if current_user and getattr(current_user, "nombre", None) else None)
        or (current_user.nombre_completo.strip() if current_user and getattr(current_user, "nombre_completo", None) else None)
        or "Pedro Cobrador"
    )

    # Persistir firmas si vienen en el payload para trazabilidad inmutable
    if datos.id_recibo and (datos.firma_cliente or datos.firma_cobrador):
        try:
            guardar_firma_abono(
                datos.id_recibo,
                firma_cliente=datos.firma_cliente,
                firma_cobrador=datos.firma_cobrador,
            )
        except Exception as e:
            print(f"[PDF] Advertencia guardando firmas offline: {e}")

    valor_abono_num = (
        datos.valor_abonado
        if datos.valor_abonado is not None
        else (datos.valor if datos.valor is not None else Decimal("0.00"))
    )

    saldo_restante_num = (
        datos.saldo_restante_credito
        if datos.saldo_restante_credito is not None
        else (
            datos.nuevoSaldo
            if datos.nuevoSaldo is not None
            else (datos.saldo_pendiente if datos.saldo_pendiente is not None else Decimal("0.00"))
        )
    )

    saldo_insoluto_num = (
        datos.saldo_insoluto
        if datos.saldo_insoluto is not None
        else (datos.diferencia_arrastrada if datos.diferencia_arrastrada is not None else Decimal("0.00"))
    )

    cuota_afectada = datos.cuota_afectada_numero or datos.cuota_numero or 1
    cuota_siguiente = datos.cuota_siguiente_numero or (cuota_afectada + 1)
    valor_cuota_sig = (
        datos.valor_cuota_siguiente
        if datos.valor_cuota_siguiente is not None
        else (
            (datos.valor_cuota_exigible or Decimal("0.00")) + saldo_insoluto_num
            if datos.es_abono_parcial
            else (datos.valor_cuota_exigible or valor_abono_num)
        )
    )

    cliente_nom = datos.cliente_nombre or datos.cliente or "Cliente Titular"
    cliente_cc = datos.cliente_cedula or "S/N"
    cliente_tel = datos.cliente_telefono or "No registrado"

    mock_cliente = SimpleNamespace(
        nombres=cliente_nom,
        nombre_completo=cliente_nom,
        cedula=cliente_cc,
        telefono=cliente_tel,
        direccion="Montería, Córdoba",
        barrio="Centro",
        ciudad="Montería",
    )

    mock_credito = SimpleNamespace(
        id_contrato=datos.credito_id or "CTR-RUTA",
        numero_contrato=datos.numero_contrato or "CTR-RUTA",
        cliente=mock_cliente,
        saldo_pendiente=saldo_restante_num,
        monto_financiado=Decimal("0.00"),
        numero_cuotas=12,
        valor_cuota=datos.valor_cuota_exigible or valor_abono_num,
        tipo_pago="mensual",
    )

    mock_cobrador = SimpleNamespace(
        id=getattr(current_user, "id", None),
        nombre=nombre_cobrador,
        nombre_completo=nombre_cobrador,
        nombres=nombre_cobrador,
        telefono=datos.cobrador_telefono or (getattr(current_user, "telefono", "No registrado") if current_user else "No registrado"),
    )

    dt_actual = datetime.now()
    if datos.fecha_completa:
        try:
            dt_actual = datetime.fromisoformat(datos.fecha_completa)
        except Exception:
            pass

    mock_abono = SimpleNamespace(
        id_recibo=datos.id_recibo or "ABONO-OFF",
        credito_id=datos.credito_id or "CTR-RUTA",
        numero_contrato=datos.numero_contrato or "CTR-RUTA",
        fecha=dt_actual,
        creado_en=dt_actual,
        estado="registrado",
        valor_abonado=valor_abono_num,
        metodo_pago=datos.metodo_pago or "efectivo",
        cliente_nombre=cliente_nom,
        cliente_cedula=cliente_cc,
        credito=mock_credito,
        cobrador=mock_cobrador,
        cobrador_nombre=nombre_cobrador,
        cobrador_telefono=datos.cobrador_telefono or (getattr(current_user, "telefono", "No registrado") if current_user else "No registrado"),
        saldo_restante_credito=saldo_restante_num,
        es_abono_parcial=bool(datos.es_abono_parcial),
        diferencia_arrastrada=saldo_insoluto_num,
        saldo_insoluto=saldo_insoluto_num,
        cuota_afectada_numero=cuota_afectada,
        cuota_siguiente_numero=cuota_siguiente,
        valor_cuota_siguiente=valor_cuota_sig,
        firma_cliente=datos.firma_cliente,
        firma_cobrador=datos.firma_cobrador,
    )

    pdf_bytes = generar_pdf_recibo_abono(
        mock_abono,
        cobrador_nombre=nombre_cobrador,
        firma_cobrador=datos.firma_cobrador,
    )

    id_contrato = datos.numero_contrato or (f"CTR-{str(datos.credito_id)[:8].upper()}" if datos.credito_id else "CTR-RUTA")
    cuota_tag = f"Cuota-{cuota_afectada}"
    filename = datos.nombre_archivo_pdf or construir_nombre_archivo_pdf("Recibo", id_contrato, cliente_nom, dt_actual, cuota=cuota_tag)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


@router.get(
    "",
    response_model=List[AbonoResponse],
    summary="Listar abonos con filtros (Cobrador, Secretaria o Supervisor)",
    status_code=status.HTTP_200_OK,
)
async def listar_abonos(
    cobrador_id: Optional[UUID] = Query(None, description="Filtrar por cobrador asignado"),
    estado: Optional[EstadoAbono] = Query(None, description="Filtrar por estado del abono"),
    skip: int = Query(0, ge=0, description="Paginación: registros a omitir"),
    limit: int = Query(100, ge=1, le=500, description="Límite de registros"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Retorna listado de abonos para auditoría, conciliación y consulta operativa móvil.
    
    Seguridad RBAC:
    - Si es COBRADOR: se restringe estrictamente a consultar sus propios recaudos (cobrador_id = current_user.id).
    - Si es SUPERVISOR, SECRETARIA o MASTER: puede consultar cualquier cobrador o toda la cartera.
    """
    if current_user.rol == RolUsuario.COBRADOR:
        cobrador_id = current_user.id
    elif current_user.rol not in [RolUsuario.SECRETARIA, RolUsuario.SUPERVISOR, RolUsuario.MASTER]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No posee autorización para consultar el historial de recaudos.",
        )

    return await crud_abono.get_abonos_list(
        db=db,
        cobrador_id=cobrador_id,
        estado=estado,
        skip=skip,
        limit=limit,
    )


@router.post(
    "/conciliar-ruta",
    response_model=ConciliacionRutaResponse,
    summary="Conciliar y cerrar caja de una ruta (Secretaria o Supervisor)",
    status_code=status.HTTP_200_OK,
)
async def conciliar_ruta(
    datos: ConciliacionRutaRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor_o_secretaria),
):
    """Realiza el arqueo y conciliación de caja para la ruta de un cobrador.
    
    Marca todos los abonos en estado 'registrado' del cobrador como 'conciliado',
    compara el efectivo esperado en sistema vs el entregado en caja física,
    y emite el comprobante de cuadre.
    """
    return await crud_abono.conciliar_ruta_abonos(
        db=db,
        cobrador_id=datos.cobrador_id,
        efectivo_entregado=datos.efectivo_entregado,
        responsable_id=current_user.id,
        notas=datos.notas,
    )
