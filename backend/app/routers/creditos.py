from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, require_vendedor_o_supervisor
from app.crud import crud_credito
from app.models.credito import EstadoCredito
from app.models.usuario import RolUsuario, Usuario
from app.schemas.credito import CreditoCreate, CreditoResponse

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
    # Si quien origina es un vendedor, validar que se asigne a su propio ID
    if current_user.rol == RolUsuario.VENDEDOR and credito_in.vendedor_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Un asesor comercial solo puede originar créditos asignándose como vendedor.",
        )

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
    limit: int = Query(50, ge=1, le=100, description="Límite de registros a retornar"),
    cliente_id: Optional[UUID] = Query(None, description="Filtrar por cliente"),
    vendedor_id: Optional[UUID] = Query(None, description="Filtrar por vendedor"),
    cobrador_id: Optional[UUID] = Query(None, description="Filtrar por cobrador asignado"),
    estado: Optional[EstadoCredito] = Query(None, description="Filtrar por estado del crédito"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Lista los créditos registrados en el sistema. Requiere autenticación."""
    return await crud_credito.get_creditos(
        db=db,
        skip=skip,
        limit=limit,
        cliente_id=cliente_id,
        vendedor_id=vendedor_id,
        cobrador_id=cobrador_id,
        estado=estado,
    )
