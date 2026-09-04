"""Routers de la API."""

from app.routers.abonos import router as abonos_router
from app.routers.auth import router as auth_router
from app.routers.clientes import router as clientes_router
from app.routers.creditos import router as creditos_router
from app.routers.health import router as health_router
from app.routers.productos import router as productos_router
from app.routers.usuarios import router as usuarios_router

__all__ = [
    "abonos_router",
    "auth_router",
    "clientes_router",
    "creditos_router",
    "health_router",
    "productos_router",
    "usuarios_router",
]
