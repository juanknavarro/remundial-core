from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.routers.abonos import router as abonos_router
from app.routers.auth import router as auth_router
from app.routers.clientes import router as clientes_router
from app.routers.creditos import router as creditos_router
from app.routers.health import router as health_router
from app.routers.productos import router as productos_router
from app.routers.usuarios import router as usuarios_router


async def ensure_master_user() -> None:
    """Verifica y garantiza la existencia del Superusuario Master con control total."""
    from sqlalchemy import select
    from app.core.database import AsyncSessionLocal
    from app.core.security import get_password_hash
    from app.models.usuario import RolUsuario, Usuario

    try:
        async with AsyncSessionLocal() as session:
            stmt = select(Usuario).where(Usuario.rol == RolUsuario.MASTER)
            res = await session.execute(stmt)
            master = res.scalar_one_or_none()
            if not master:
                nuevo_master = Usuario(
                    nombre="Superusuario Master",
                    rol=RolUsuario.MASTER,
                    telefono="3000000000",
                    password_hash=get_password_hash("masterpassword123"),
                    estado_activo=True,
                )
                session.add(nuevo_master)
                await session.commit()
                print("[SEGURIDAD] Superusuario Master inicializado automáticamente.")
            else:
                print(f"[SEGURIDAD] Superusuario Master activo ({master.nombre}).")
    except Exception as exc:
        print(f"[SEGURIDAD] Advertencia al verificar Master en arranque: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Ciclo de vida de la aplicación: gestión de inicio y detención de recursos."""
    print(f"Iniciando {settings.PROJECT_NAME} v{settings.VERSION} con Autenticación JWT y RBAC...")
    await ensure_master_user()
    yield
    print(f"Cerrando {settings.PROJECT_NAME}...")


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="API de Backend para la gestión de créditos, recaudo y cobranza en terreno.",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# Configuración de CORS para clientes Web y Móviles
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registro de rutas principales
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(usuarios_router)
app.include_router(productos_router)
app.include_router(clientes_router)
app.include_router(creditos_router)
app.include_router(abonos_router)

# Registro también bajo prefijo versionado /api/v1
app.include_router(health_router, prefix=settings.API_V1_STR)
app.include_router(auth_router, prefix=settings.API_V1_STR)
app.include_router(usuarios_router, prefix=settings.API_V1_STR)
app.include_router(productos_router, prefix=settings.API_V1_STR)
app.include_router(clientes_router, prefix=settings.API_V1_STR)
app.include_router(creditos_router, prefix=settings.API_V1_STR)
app.include_router(abonos_router, prefix=settings.API_V1_STR)


@app.get("/", include_in_schema=False)
async def root():
    """Redirección informativa inicial."""
    return {
        "message": f"Bienvenido a {settings.PROJECT_NAME}",
        "version": settings.VERSION,
        "docs": "/docs",
        "health": "/health",
        "endpoints": {
            "auth": "/auth/login",
            "usuarios": "/usuarios",
            "productos": "/productos",
            "clientes": "/clientes",
            "creditos": "/creditos",
            "abonos": "/abonos",
        },
    }
