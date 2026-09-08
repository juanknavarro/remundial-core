from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    get_current_user,
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
    # Si quien registra es un cobrador, asegurar que el cobrador_id coincida con su identidad autenticada
    if current_user.rol == RolUsuario.COBRADOR and abono_in.cobrador_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Un cobrador solo puede registrar abonos a su propio nombre.",
        )

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
    limit: int = Query(100, ge=1, le=200, description="Límite de registros a retornar"),
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
    limit: int = Query(100, ge=1, le=200, description="Límite de registros"),
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
    "",
    response_model=List[AbonoResponse],
    summary="Listar abonos con filtros (Cobrador, Secretaria o Supervisor)",
    status_code=status.HTTP_200_OK,
)
async def listar_abonos(
    cobrador_id: Optional[UUID] = Query(None, description="Filtrar por cobrador asignado"),
    estado: Optional[EstadoAbono] = Query(None, description="Filtrar por estado del abono"),
    skip: int = Query(0, ge=0, description="Paginación: registros a omitir"),
    limit: int = Query(100, ge=1, le=200, description="Límite de registros"),
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
