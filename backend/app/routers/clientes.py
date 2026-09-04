from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, require_supervisor
from app.crud import crud_cliente
from app.models.usuario import Usuario
from app.schemas.cliente import ClienteCreate, ClienteResponse, ClienteUpdate

router = APIRouter(
    prefix="/clientes",
    tags=["Clientes"],
)


@router.get(
    "",
    response_model=List[ClienteResponse],
    summary="Listar clientes",
    status_code=status.HTTP_200_OK,
)
async def listar_clientes(
    skip: int = Query(0, ge=0, description="Registros a omitir para paginación"),
    limit: int = Query(50, ge=1, le=100, description="Límite de registros a retornar"),
    search: Optional[str] = Query(None, description="Búsqueda por nombres, cédula o teléfono"),
    ciudad: Optional[str] = Query(None, description="Filtrar por ciudad o municipio"),
    barrio: Optional[str] = Query(None, description="Filtrar por barrio o sector"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Retorna la lista paginada de clientes registrados. Requiere autenticación."""
    return await crud_cliente.get_clientes(
        db=db,
        skip=skip,
        limit=limit,
        search=search,
        ciudad=ciudad,
        barrio=barrio,
    )


@router.get(
    "/cedula/{cedula}",
    response_model=ClienteResponse,
    summary="Buscar cliente por número de Cédula",
    status_code=status.HTTP_200_OK,
)
async def obtener_cliente_por_cedula(
    cedula: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Consulta los datos de un cliente a través de su número de identificación/cédula."""
    cliente = await crud_cliente.get_cliente_by_cedula(db=db, cedula=cedula)
    if not cliente:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró ningún cliente registrado con la cédula '{cedula}'",
        )
    return cliente


@router.get(
    "/{cliente_id}",
    response_model=ClienteResponse,
    summary="Obtener cliente por ID",
    status_code=status.HTTP_200_OK,
)
async def obtener_cliente(
    cliente_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Consulta la información completa de un cliente por su UUID. Requiere autenticación."""
    cliente = await crud_cliente.get_cliente(db=db, cliente_id=cliente_id)
    if not cliente:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cliente con ID '{cliente_id}' no encontrado",
        )
    return cliente


@router.post(
    "",
    response_model=ClienteResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Crear un nuevo cliente",
)
async def crear_cliente(
    cliente_in: ClienteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Registra un nuevo cliente validando la unicidad del número de cédula."""
    cliente_existente = await crud_cliente.get_cliente_by_cedula(db=db, cedula=cliente_in.cedula)
    if cliente_existente:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un cliente registrado con la cédula '{cliente_in.cedula}'",
        )

    try:
        return await crud_cliente.create_cliente(db=db, cliente_in=cliente_in)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Error de integridad al registrar el cliente",
        ) from exc


@router.put(
    "/{cliente_id}",
    response_model=ClienteResponse,
    summary="Actualizar datos de un cliente",
    status_code=status.HTTP_200_OK,
)
async def actualizar_cliente(
    cliente_id: UUID,
    cliente_in: ClienteUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Actualiza la información de contacto, domicilio o ubicación de un cliente."""
    cliente = await crud_cliente.get_cliente(db=db, cliente_id=cliente_id)
    if not cliente:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cliente con ID '{cliente_id}' no encontrado",
        )

    if cliente_in.cedula and cliente_in.cedula.strip() != cliente.cedula:
        cedula_existente = await crud_cliente.get_cliente_by_cedula(db=db, cedula=cliente_in.cedula)
        if cedula_existente and cedula_existente.id != cliente_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"La cédula '{cliente_in.cedula}' ya pertenece a otro cliente",
            )

    try:
        return await crud_cliente.update_cliente(
            db=db, db_cliente=cliente, cliente_in=cliente_in
        )
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Error de integridad al actualizar el cliente",
        ) from exc


@router.delete(
    "/{cliente_id}",
    status_code=status.HTTP_200_OK,
    summary="Eliminar un cliente (Solo Supervisor)",
)
async def eliminar_cliente(
    cliente_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor),
):
    """Elimina un cliente si no tiene créditos históricos o activos registrados."""
    cliente = await crud_cliente.get_cliente(db=db, cliente_id=cliente_id)
    if not cliente:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cliente con ID '{cliente_id}' no encontrado",
        )

    try:
        await crud_cliente.delete_cliente(db=db, db_cliente=cliente)
        return {"message": f"Cliente '{cliente.nombres}' (ID: {cliente_id}) eliminado correctamente"}
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No es posible eliminar el cliente porque posee contratos de crédito asociados "
                "(Restricción de integridad referencial ON DELETE RESTRICT)"
            ),
        ) from exc
