from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.routers.abonos import router as abonos_router
from app.routers.auth import router as auth_router
from app.routers.clientes import router as clientes_router
from app.routers.configuracion import router as configuracion_router
from app.routers.creditos import router as creditos_router
from app.routers.health import router as health_router
from app.routers.productos import router as productos_router
from app.routers.reportes import router as reportes_router
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
    expose_headers=["Content-Disposition"],
)

# Router de alias para /config
from app.routers.configuracion import (
    _obtener_ciudades_venta,
    _guardar_ciudades_venta,
    CiudadesVentaRequest,
    AgregarCiudadRequest,
)
from app.core.deps import require_supervisor
from fastapi import APIRouter, Depends, HTTPException

config_alias_router = APIRouter(prefix="/config", tags=["Configuración Global"])


@config_alias_router.get("/ciudades", summary="Obtener lista dinámica de ciudades operativas autorizadas")
async def get_config_ciudades_alias():
    """Retorna la lista de ciudades autorizadas para radicación de ventas y créditos."""
    ciudades = _obtener_ciudades_venta()
    return {"success": True, "ciudades": ciudades, "total": len(ciudades)}


@config_alias_router.put("/ciudades", summary="Actualizar lista de ciudades operativas")
async def put_config_ciudades_alias(datos: CiudadesVentaRequest, current_user=Depends(require_supervisor)):
    ciudades = _guardar_ciudades_venta(datos.ciudades)
    return {"success": True, "ciudades": ciudades, "total": len(ciudades)}


@config_alias_router.post("/ciudades", summary="Agregar una nueva ciudad operativa")
async def post_config_ciudades_alias(datos: AgregarCiudadRequest, current_user=Depends(require_supervisor)):
    ciudad_nueva = datos.ciudad.strip()
    ciudades_actuales = _obtener_ciudades_venta()
    if any(c.lower() == ciudad_nueva.lower() for c in ciudades_actuales):
        raise HTTPException(
            status_code=400,
            detail=f"La ciudad '{ciudad_nueva}' ya se encuentra registrada en el sistema.",
        )
    ciudades_actuales.append(ciudad_nueva)
    resultado = _guardar_ciudades_venta(ciudades_actuales)
    return {"success": True, "ciudades": resultado, "total": len(resultado)}


# Registro de rutas principales
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(usuarios_router)
app.include_router(productos_router)
app.include_router(clientes_router)
app.include_router(creditos_router)
app.include_router(abonos_router)
app.include_router(reportes_router)
app.include_router(configuracion_router)
app.include_router(config_alias_router)

# Registro también bajo prefijo versionado /api/v1
app.include_router(health_router, prefix=settings.API_V1_STR)
app.include_router(auth_router, prefix=settings.API_V1_STR)
app.include_router(usuarios_router, prefix=settings.API_V1_STR)
app.include_router(productos_router, prefix=settings.API_V1_STR)
app.include_router(clientes_router, prefix=settings.API_V1_STR)
app.include_router(creditos_router, prefix=settings.API_V1_STR)
app.include_router(abonos_router, prefix=settings.API_V1_STR)
app.include_router(reportes_router, prefix=settings.API_V1_STR)
app.include_router(configuracion_router, prefix=settings.API_V1_STR)
app.include_router(config_alias_router, prefix=settings.API_V1_STR)



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
