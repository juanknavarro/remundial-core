from typing import List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.banco import EntidadBancaria
from app.schemas.banco import EntidadBancariaCreate, EntidadBancariaUpdate


async def get_bancos(
    db: AsyncSession,
    solo_activas: bool = False,
    skip: int = 0,
    limit: int = 100,
) -> List[EntidadBancaria]:
    """Lista las entidades bancarias configuradas en el sistema."""
    query = select(EntidadBancaria).order_by(EntidadBancaria.nombre.asc())
    if solo_activas:
        query = query.where(EntidadBancaria.activa.is_(True))
    result = await db.execute(query.offset(skip).limit(limit))
    return list(result.scalars().all())


async def get_banco(db: AsyncSession, banco_id: UUID) -> Optional[EntidadBancaria]:
    """Obtiene una entidad bancaria por su ID."""
    return await db.get(EntidadBancaria, banco_id)


async def get_banco_por_nombre(db: AsyncSession, nombre: str) -> Optional[EntidadBancaria]:
    """Busca una entidad bancaria por nombre insensible a mayúsculas/minúsculas."""
    query = select(EntidadBancaria).where(
        func.upper(func.trim(EntidadBancaria.nombre)) == nombre.strip().upper()
    )
    result = await db.execute(query.limit(1))
    return result.scalar_one_or_none()


async def create_banco(
    db: AsyncSession,
    banco_in: EntidadBancariaCreate,
) -> EntidadBancaria:
    """Crea una nueva entidad bancaria con verificación de unicidad de nombre."""
    nombre_limpio = banco_in.nombre.strip()
    existente = await get_banco_por_nombre(db, nombre_limpio)
    if existente:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe una entidad bancaria con el nombre '{nombre_limpio}'.",
        )

    db_banco = EntidadBancaria(
        nombre=nombre_limpio,
        activa=banco_in.activa,
    )
    db.add(db_banco)
    try:
        await db.commit()
        await db.refresh(db_banco)
        return db_banco
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe una entidad bancaria con el nombre '{nombre_limpio}'.",
        )


async def update_banco(
    db: AsyncSession,
    db_banco: EntidadBancaria,
    banco_in: EntidadBancariaUpdate,
) -> EntidadBancaria:
    """Actualiza los datos o estado activo de una entidad bancaria."""
    if banco_in.nombre is not None:
        nuevo_nombre = banco_in.nombre.strip()
        if nuevo_nombre.upper() != db_banco.nombre.upper():
            existente = await get_banco_por_nombre(db, nuevo_nombre)
            if existente and existente.id != db_banco.id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Ya existe otra entidad bancaria registrada con el nombre '{nuevo_nombre}'.",
                )
        db_banco.nombre = nuevo_nombre

    if banco_in.activa is not None:
        db_banco.activa = banco_in.activa

    try:
        await db.commit()
        await db.refresh(db_banco)
        return db_banco
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Error de integridad al actualizar la entidad bancaria.",
        )


async def delete_banco(
    db: AsyncSession,
    db_banco: EntidadBancaria,
) -> None:
    """Elimina una entidad bancaria de la base de datos."""
    await db.delete(db_banco)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No es posible eliminar la entidad bancaria seleccionada.",
        )
