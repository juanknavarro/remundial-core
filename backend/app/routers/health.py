from typing import Any, Dict
from fastapi import APIRouter, Depends, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db

router = APIRouter(tags=["Health Check"])


@router.get(
    "/health",
    summary="Verificar estado de salud del servicio",
    status_code=status.HTTP_200_OK,
)
async def health_check(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Comprueba el estado de la aplicación y la conectividad a la base de datos PostgreSQL."""
    db_status = "connected"
    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:
        db_status = f"unhealthy: {str(exc)}"

    return {
        "status": "healthy" if db_status == "connected" else "degraded",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "database": db_status,
    }
