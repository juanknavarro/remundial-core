from datetime import date
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, require_supervisor, require_vendedor_o_supervisor
from app.crud import crud_credito
from app.models.credito import EstadoCredito
from app.models.usuario import RolUsuario, Usuario
from app.schemas.credito import CreditoCreate, CreditoResponse, CreditoUpdate

router = APIRouter(
    prefix="/creditos",
    tags=["Créditos"],
)


@router.post(
    "",
    response_model=CreditoResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Originar un nuevo crédito con artículos asociados (Solo Vendedor o Supervisor)",
)
async def originar_credito(
    credito_in: CreditoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_vendedor_o_supervisor),
):
    """Crea un nuevo contrato de crédito y sus líneas de detalle de forma transaccional.
    
    Seguridad RBAC: Solo accesible para roles 'vendedor' y 'supervisor'.
    """
    # Resolver vendedor: si es vendedor se asigna a sí mismo; si no se envió vendedor_id, toma el usuario en sesión
    if current_user.rol == RolUsuario.VENDEDOR or not credito_in.vendedor_id:
        credito_in.vendedor_id = current_user.id

    # Los créditos deben nacer limpios de ruta y cobrador (asignación posterior desde Cartera/Supervisión)
    credito_in.cobrador_id = None

    return await crud_credito.create_credito(db=db, credito_in=credito_in)


@router.get(
    "/{id_contrato}",
    response_model=CreditoResponse,
    summary="Obtener crédito por ID de contrato",
    status_code=status.HTTP_200_OK,
)
async def obtener_credito(
    id_contrato: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Consulta la información detallada de un crédito. Requiere autenticación."""
    credito = await crud_credito.get_credito(db=db, id_contrato=id_contrato)
    if not credito:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Crédito con ID de contrato '{id_contrato}' no encontrado",
        )
    return credito


@router.get(
    "",
    response_model=List[CreditoResponse],
    summary="Listar créditos",
    status_code=status.HTTP_200_OK,
)
async def listar_creditos(
    skip: int = Query(0, ge=0, description="Registros a omitir para paginación"),
    limit: int = Query(100, ge=1, le=500, description="Límite de registros a retornar"),
    cliente_id: Optional[UUID] = Query(None, description="Filtrar por cliente"),
    vendedor_id: Optional[UUID] = Query(None, description="Filtrar por vendedor"),
    cobrador_id: Optional[UUID] = Query(None, description="Filtrar por cobrador asignado"),
    estado: Optional[EstadoCredito] = Query(None, description="Filtrar por estado del crédito"),
    fecha: Optional[date] = Query(None, description="Filtrar por fecha de creación (YYYY-MM-DD)"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Lista los créditos registrados en el sistema. Requiere autenticación.
    
    Seguridad RBAC:
    - Si el usuario en sesión es VENDEDOR, se acota estrictamente a sus ventas originadas.
    """
    vendedor_filtro = vendedor_id
    if current_user.rol == RolUsuario.VENDEDOR:
        vendedor_filtro = current_user.id

    return await crud_credito.get_creditos(
        db=db,
        skip=skip,
        limit=limit,
        cliente_id=cliente_id,
        vendedor_id=vendedor_filtro,
        cobrador_id=cobrador_id,
        estado=estado,
        fecha=fecha,
    )


@router.patch(
    "/{id_contrato}",
    response_model=CreditoResponse,
    summary="Actualizar estado o datos de un crédito (Solo Supervisor o Master)",
    status_code=status.HTTP_200_OK,
)
@router.put(
    "/{id_contrato}",
    response_model=CreditoResponse,
    summary="Actualizar estado o datos de un crédito (Solo Supervisor o Master)",
    status_code=status.HTTP_200_OK,
)
async def actualizar_credito(
    id_contrato: str,
    credito_in: CreditoUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor),
):
    """Actualiza administrativamente el crédito (ej: estado activo, supervisor asignado)."""
    try:
        uuid_obj = UUID(str(id_contrato).strip())
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Identificador de contrato '{id_contrato}' inválido.",
        )

    credito = await crud_credito.update_credito(
        db=db,
        id_contrato=uuid_obj,
        credito_in=credito_in,
        supervisor_id=current_user.id if current_user.rol in (RolUsuario.SUPERVISOR, RolUsuario.MASTER) else None,
    )
    if not credito:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Crédito con ID '{id_contrato}' no encontrado.",
        )
    return credito


class AprobarCreditoBody(BaseModel):
    cobrador_id: Optional[UUID] = None


@router.post(
    "/{id_contrato}/aprobar",
    response_model=CreditoResponse,
    summary="Aprobar crédito pendiente y activarlo en cartera (Solo Supervisor o Master)",
    status_code=status.HTTP_200_OK,
)
@router.patch(
    "/{id_contrato}/aprobar",
    response_model=CreditoResponse,
    summary="Aprobar crédito pendiente y activarlo en cartera (Solo Supervisor o Master)",
    status_code=status.HTTP_200_OK,
)
async def aprobar_credito(
    id_contrato: str,
    cobrador_id: Optional[UUID] = Query(None, description="Cobrador asignado de forma permanente"),
    body: Optional[AprobarCreditoBody] = None,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor),
):
    """Aprueba formalmente un crédito pendiente, cambiando su estado a 'activo' y fijando cobrador si se asigna."""
    try:
        uuid_obj = UUID(str(id_contrato).strip())
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Identificador de contrato '{id_contrato}' inválido.",
        )

    target_cobrador = cobrador_id or (body.cobrador_id if body else None)

    credito = await crud_credito.aprobar_credito(
        db=db,
        id_contrato=uuid_obj,
        supervisor_id=current_user.id,
        cobrador_id=target_cobrador,
    )
    if not credito:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Crédito con ID '{id_contrato}' no encontrado.",
        )
    return credito


@router.post(
    "/{id_contrato}/rechazar",
    response_model=CreditoResponse,
    summary="Rechazar crédito pendiente (Solo Supervisor o Master)",
    status_code=status.HTTP_200_OK,
)
@router.patch(
    "/{id_contrato}/rechazar",
    response_model=CreditoResponse,
    summary="Rechazar crédito pendiente (Solo Supervisor o Master)",
    status_code=status.HTTP_200_OK,
)
async def rechazar_credito(
    id_contrato: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor),
):
    """Rechaza formalmente un crédito pendiente, cambiándolo a terminado sin saldo."""
    try:
        uuid_obj = UUID(str(id_contrato).strip())
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Identificador de contrato '{id_contrato}' inválido.",
        )

    credito = await crud_credito.rechazar_credito(
        db=db,
        id_contrato=uuid_obj,
        supervisor_id=current_user.id,
    )
    if not credito:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Crédito con ID '{id_contrato}' no encontrado.",
        )
    return credito
