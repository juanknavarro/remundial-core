from collections.abc import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

# Motor de base de datos asíncrono optimizado
engine = create_async_engine(
    settings.async_database_url,
    echo=False,
    future=True,
    pool_pre_ping=True,  # Verifica conexiones activas antes de usarlas
    pool_size=10,
    max_overflow=20,
)

# Creador de sesiones asíncronas
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    """Clase base declarativa para todos los modelos de SQLAlchemy."""
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Generador asíncrono para inyección de dependencia de sesión de base de datos en FastAPI."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
