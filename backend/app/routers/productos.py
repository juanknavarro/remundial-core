from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    get_current_user,
    require_supervisor,
    require_supervisor_o_secretaria,
)
from app.crud import crud_producto
from app.models.usuario import Usuario
from app.schemas.producto import (
    ProductoCreate,
    ProductoResponse,
    ProductoUpdate,
    ReabastecerStockRequest,
    ReabastecerStockResponse,
)

router = APIRouter(
    prefix="/productos",
    tags=["Productos"],
)


@router.get(
    "",
    response_model=List[ProductoResponse],
    summary="Listar productos del catálogo",
    status_code=status.HTTP_200_OK,
)
async def listar_productos(
    skip: int = Query(0, ge=0, description="Registros a omitir para paginación"),
    limit: int = Query(50, ge=1, le=100, description="Límite de registros a retornar"),
    search: Optional[str] = Query(None, description="Búsqueda por nombre o SKU"),
    es_precio_variable: Optional[bool] = Query(
        None, description="Filtrar por artículos de precio negociable (ej. arte)"
    ),
    solo_activos: Optional[bool] = Query(
        None, description="Filtrar por artículos activos (true) o inactivos (false)"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Retorna la lista paginada de productos con filtros opcionales. Requiere autenticación."""
    return await crud_producto.get_productos(
        db=db,
        skip=skip,
        limit=limit,
        search=search,
        es_precio_variable=es_precio_variable,
        solo_activos=solo_activos,
    )


@router.get(
    "/{producto_id}",
    response_model=ProductoResponse,
    summary="Obtener producto por ID",
    status_code=status.HTTP_200_OK,
)
async def obtener_producto(
    producto_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Consulta los detalles de un producto específico por su UUID. Requiere autenticación."""
    producto = await crud_producto.get_producto(db=db, producto_id=producto_id)
    if not producto:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Producto con ID '{producto_id}' no encontrado",
        )
    return producto


@router.post(
    "",
    response_model=ProductoResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Crear un nuevo producto (Supervisor o Secretaria)",
)
async def crear_producto(
    producto_in: ProductoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor_o_secretaria),
):
    """Registra un nuevo producto en el catálogo verificando la unicidad del SKU."""
    producto_existente = await crud_producto.get_producto_by_sku(db=db, sku=producto_in.sku)
    if producto_existente:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un producto registrado con el SKU '{producto_in.sku}'",
        )

    try:
        return await crud_producto.create_producto(db=db, producto_in=producto_in)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Error de integridad al guardar el producto",
        ) from exc


@router.put(
    "/{producto_id}",
    response_model=ProductoResponse,
    summary="Actualizar un producto (Supervisor o Secretaria)",
    status_code=status.HTTP_200_OK,
)
async def actualizar_producto(
    producto_id: UUID,
    producto_in: ProductoUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor_o_secretaria),
):
    """Actualiza los datos de un producto existente."""
    producto = await crud_producto.get_producto(db=db, producto_id=producto_id)
    if not producto:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Producto con ID '{producto_id}' no encontrado",
        )

    if producto_in.sku and producto_in.sku.strip() != producto.sku:
        sku_existente = await crud_producto.get_producto_by_sku(db=db, sku=producto_in.sku)
        if sku_existente and sku_existente.id != producto_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"El SKU '{producto_in.sku}' ya está asignado a otro producto",
            )

    try:
        return await crud_producto.update_producto(
            db=db, db_producto=producto, producto_in=producto_in
        )
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Error de integridad al actualizar el producto",
        ) from exc


@router.post(
    "/{producto_id}/reabastecer",
    response_model=ReabastecerStockResponse,
    summary="Registrar entrada de almacén / reabastecer stock (Supervisor o Secretaria)",
    status_code=status.HTTP_200_OK,
)
async def reabastecer_producto(
    producto_id: UUID,
    reabastecer_in: ReabastecerStockRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor_o_secretaria),
):
    """Registra una entrada de inventario sumando existencias físicas a un producto."""
    producto = await crud_producto.get_producto(db=db, producto_id=producto_id)
    if not producto:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Producto con ID '{producto_id}' no encontrado",
        )

    stock_anterior = producto.stock
    producto_actualizado = await crud_producto.reabastecer_producto(
        db=db, db_producto=producto, cantidad=reabastecer_in.cantidad
    )

    return ReabastecerStockResponse(
        producto_id=producto_actualizado.id,
        sku=producto_actualizado.sku,
        nombre=producto_actualizado.nombre,
        stock_anterior=stock_anterior,
        cantidad_ingresada=reabastecer_in.cantidad,
        stock_actual=producto_actualizado.stock,
        maneja_stock=producto_actualizado.maneja_stock,
        mensaje=(
            f"Se han ingresado {reabastecer_in.cantidad} unidades a '{producto_actualizado.nombre}'. "
            f"Nuevo stock disponible: {producto_actualizado.stock}."
        ),
    )


@router.delete(
    "/{producto_id}",
    status_code=status.HTTP_200_OK,
    summary="Eliminar o desactivar un producto (Supervisor o Secretaria)",
)
async def eliminar_producto(
    producto_id: UUID,
    desactivar: bool = Query(
        False,
        description="Si es True, realiza una desactivación lógica (estado_activo = false) en lugar de eliminación física",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(require_supervisor_o_secretaria),
):
    """Elimina físicamente un producto si no tiene créditos asociados; si ya tiene créditos, rechaza la eliminación con HTTP 400 protegiendo el historial financiero o permite su baja lógica."""
    producto = await crud_producto.get_producto(db=db, producto_id=producto_id)
    if not producto:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Producto con ID '{producto_id}' no encontrado",
        )

    # Si se solicita explícitamente desactivación lógica
    if desactivar:
        await crud_producto.deactivate_producto(db=db, db_producto=producto)
        return {
            "message": f"Producto '{producto.nombre}' (SKU: {producto.sku}) desactivado correctamente del catálogo",
            "producto_id": str(producto_id),
            "estado_activo": False,
        }

    # Validar si el producto ya está asociado a créditos existentes (credito_detalle)
    creditos_asociados = await crud_producto.count_credito_detalles_by_producto(
        db=db, producto_id=producto_id
    )

    if creditos_asociados > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"No es posible eliminar el producto '{producto.nombre}' porque está asociado a "
                f"{creditos_asociados} registro(s) en contratos de crédito (credito_detalle). "
                f"Para preservar el historial contable y financiero, debe inactivarlo en lugar de borrarlo."
            ),
        )

    try:
        await crud_producto.delete_producto(db=db, db_producto=producto)
        return {
            "message": f"Producto '{producto.nombre}' (SKU: {producto.sku}) eliminado físicamente del inventario",
            "producto_id": str(producto_id),
        }
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No se puede eliminar el producto porque está asociado a registros vinculados "
                "(Restricción de integridad referencial)"
            ),
        ) from exc
