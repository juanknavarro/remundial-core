from typing import List, Optional
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cliente import Cliente
from app.schemas.cliente import ClienteCreate, ClienteUpdate


async def get_cliente(db: AsyncSession, cliente_id: UUID) -> Optional[Cliente]:
    """Obtiene un cliente por su identificador UUID."""
    query = select(Cliente).where(Cliente.id == cliente_id)
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def get_cliente_by_cedula(db: AsyncSession, cedula: str) -> Optional[Cliente]:
    """Busca un cliente por su documento de identidad único."""
    query = select(Cliente).where(Cliente.cedula == cedula.strip())
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def get_clientes(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 50,
    search: Optional[str] = None,
    ciudad: Optional[str] = None,
    barrio: Optional[str] = None,
) -> List[Cliente]:
    """Lista clientes con soporte para búsqueda textual por nombres o cédula, y filtros geográficos."""
    query = select(Cliente).offset(skip).limit(limit).order_by(Cliente.nombres.asc())

    if search:
        search_pattern = f"%{search.strip()}%"
        query = query.where(
            or_(
                Cliente.nombres.ilike(search_pattern),
                Cliente.cedula.ilike(search_pattern),
                Cliente.telefono.ilike(search_pattern),
            )
        )

    if ciudad:
        query = query.where(Cliente.ciudad.ilike(f"%{ciudad.strip()}%"))

    if barrio:
        query = query.where(Cliente.barrio.ilike(f"%{barrio.strip()}%"))

    result = await db.execute(query)
    return list(result.scalars().all())


async def create_cliente(db: AsyncSession, cliente_in: ClienteCreate) -> Cliente:
    """Crea y persiste un nuevo cliente en la base de datos."""
    gps_data = cliente_in.coordenadas_gps.model_dump() if cliente_in.coordenadas_gps else None

    db_cliente = Cliente(
        cedula=cliente_in.cedula.strip(),
        nombres=cliente_in.nombres.strip(),
        telefono=cliente_in.telefono.strip() if cliente_in.telefono else None,
        direccion=cliente_in.direccion.strip(),
        barrio=cliente_in.barrio.strip() if cliente_in.barrio else None,
        ciudad=cliente_in.ciudad.strip(),
        coordenadas_gps=gps_data,
    )
    db.add(db_cliente)
    await db.commit()
    await db.refresh(db_cliente)
    return db_cliente


async def update_cliente(
    db: AsyncSession,
    db_cliente: Cliente,
    cliente_in: ClienteUpdate,
) -> Cliente:
    """Actualiza atributos de un cliente de forma dinámica."""
    update_data = cliente_in.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        if field == "coordenadas_gps" and value is not None:
            # Diccionario con {"longitud": float, "latitud": float}
            setattr(db_cliente, field, value)
        elif isinstance(value, str):
            setattr(db_cliente, field, value.strip())
        else:
            setattr(db_cliente, field, value)

    await db.commit()
    await db.refresh(db_cliente)
    return db_cliente


async def delete_cliente(db: AsyncSession, db_cliente: Cliente) -> None:
    """Elimina físicamente un cliente de la base de datos."""
    await db.delete(db_cliente)
    await db.commit()
