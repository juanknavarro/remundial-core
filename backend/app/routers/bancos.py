from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import require_supervisor
from app.crud import crud_banco
from app.models.usuario import Usuario
from app.schemas.banco import (
    EntidadBancariaCreate,
    EntidadBancariaResponse,
    EntidadBancariaUpdate,
)

router = APIRouter(prefix="/bancos", tags=["Entidades Bancarias"])


@router.get(
    "",
    response_model=List[EntidadBancariaResponse],
    summary="Listar entidades bancarias y pasarelas de pago",
)
async def listar_bancos(
    solo_activas: bool = Query(False, description="Filtrar únicamente entidades bancarias habilitadas"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Retorna la lista de entidades bancarias configuradas para recaudo y venta."""
    return await crud_banco.get_bancos(
        db=db,
        solo_activas=solo_activas,
        skip=skip,
        limit=limit,
    )


@router.get(
    "/{banco_id}",
    response_model=EntidadBancariaResponse,
    summary="Obtener detalle de una entidad bancaria por ID",
)
async def obtener_banco(
    banco_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Consulta la información de una entidad bancaria específica."""
    banco = await crud_banco.get_banco(db=db, banco_id=banco_id)
    if not banco:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Entidad bancaria con ID '{banco_id}' no encontrada",
        )
    return banco


@router.post(
    "",
    response_model=EntidadBancariaResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Registrar una nueva entidad bancaria (Solo Supervisor o Master)",
)
async def crear_banco(
    banco_in: EntidadBancariaCreate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor),
):
    """Crea una nueva entidad bancaria o pasarela de pago para el sistema."""
    return await crud_banco.create_banco(db=db, banco_in=banco_in)


@router.put(
    "/{banco_id}",
    response_model=EntidadBancariaResponse,
    summary="Actualizar entidad bancaria o cambiar su estado activa (Solo Supervisor o Master)",
)
async def actualizar_banco(
    banco_id: UUID,
    banco_in: EntidadBancariaUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor),
):
    """Modifica el nombre o estado activo/inactivo de una entidad bancaria."""
    db_banco = await crud_banco.get_banco(db=db, banco_id=banco_id)
    if not db_banco:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Entidad bancaria con ID '{banco_id}' no encontrada",
        )
    return await crud_banco.update_banco(db=db, db_banco=db_banco, banco_in=banco_in)


@router.delete(
    "/{banco_id}",
    status_code=status.HTTP_200_OK,
    summary="Eliminar una entidad bancaria (Solo Supervisor o Master)",
)
async def eliminar_banco(
    banco_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor),
):
    """Elimina definitivamente una entidad bancaria."""
    db_banco = await crud_banco.get_banco(db=db, banco_id=banco_id)
    if not db_banco:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Entidad bancaria con ID '{banco_id}' no encontrada",
        )
    await crud_banco.delete_banco(db=db, db_banco=db_banco)
    return {"ok": True, "message": f"Entidad bancaria '{db_banco.nombre}' eliminada exitosamente"}
