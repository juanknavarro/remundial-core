from typing import List, Optional
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.credito import CreditoDetalle
from app.models.producto import Producto
from app.schemas.producto import ProductoCreate, ProductoUpdate


async def get_producto(db: AsyncSession, producto_id: UUID) -> Optional[Producto]:
    """Obtiene un producto por su identificador UUID."""
    query = select(Producto).where(Producto.id == producto_id)
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def get_producto_by_sku(db: AsyncSession, sku: str) -> Optional[Producto]:
    """Busca un producto por su código SKU único."""
    query = select(Producto).where(Producto.sku == sku.strip())
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def count_credito_detalles_by_producto(db: AsyncSession, producto_id: UUID) -> int:
    """Verifica si el producto está vinculado a alguna línea de crédito (historial contable)."""
    query = select(func.count(CreditoDetalle.id)).where(CreditoDetalle.producto_id == producto_id)
    result = await db.execute(query)
    return int(result.scalar() or 0)


async def get_productos(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 50,
    search: Optional[str] = None,
    es_precio_variable: Optional[bool] = None,
    solo_activos: Optional[bool] = None,
) -> List[Producto]:
    """Lista productos con soporte para búsqueda textual por nombre o SKU, filtro por precio variable y estado activo."""
    query = select(Producto).offset(skip).limit(limit).order_by(Producto.nombre.asc())

    if search:
        search_pattern = f"%{search.strip()}%"
        query = query.where(
            (Producto.nombre.ilike(search_pattern)) | (Producto.sku.ilike(search_pattern))
        )

    if es_precio_variable is not None:
        query = query.where(Producto.es_precio_variable == es_precio_variable)

    if solo_activos is not None:
        query = query.where(Producto.estado_activo == solo_activos)

    result = await db.execute(query)
    return list(result.scalars().all())


async def create_producto(db: AsyncSession, producto_in: ProductoCreate) -> Producto:
    """Crea y persiste un nuevo producto en la base de datos."""
    db_producto = Producto(
        sku=producto_in.sku.strip(),
        nombre=producto_in.nombre.strip(),
        precio_base=producto_in.precio_base,
        es_precio_variable=producto_in.es_precio_variable,
        stock=producto_in.stock,
        maneja_stock=producto_in.maneja_stock,
        estado_activo=producto_in.estado_activo,
    )
    db.add(db_producto)
    await db.commit()
    await db.refresh(db_producto)
    return db_producto


async def reabastecer_producto(
    db: AsyncSession,
    db_producto: Producto,
    cantidad: int,
) -> Producto:
    """Registra una entrada de almacén sumando unidades físicas al inventario."""
    db_producto.stock += cantidad
    await db.commit()
    await db.refresh(db_producto)
    return db_producto



async def update_producto(
    db: AsyncSession,
    db_producto: Producto,
    producto_in: ProductoUpdate,
) -> Producto:
    """Actualiza atributos de un producto existente de forma dinámica."""
    update_data = producto_in.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        if isinstance(value, str):
            value = value.strip()
        setattr(db_producto, field, value)

    await db.commit()
    await db.refresh(db_producto)
    return db_producto


async def deactivate_producto(db: AsyncSession, db_producto: Producto) -> Producto:
    """Desactiva lógicamente un producto para que no aparezca en nuevas ventas pero preserve historial."""
    db_producto.estado_activo = False
    await db.commit()
    await db.refresh(db_producto)
    return db_producto


async def delete_producto(db: AsyncSession, db_producto: Producto) -> None:
    """Elimina físicamente un producto de la base de datos."""
    await db.delete(db_producto)
    await db.commit()
