import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.routers.abonos import router as abonos_router
from app.routers.auditoria import router as auditoria_router
from app.routers.auth import router as auth_router
from app.routers.bancos import router as bancos_router
from app.routers.clientes import router as clientes_router
from app.routers.configuracion import router as configuracion_router
from app.routers.creditos import router as creditos_router
from app.routers.health import router as health_router
from app.routers.productos import router as productos_router
from app.routers.reportes import router as reportes_router
from app.routers.respaldos import router as respaldos_router
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


async def ensure_db_schema() -> None:
    """Asegura la presencia de columnas, tabla de entidades bancarias e índices únicos compuestos en PostgreSQL."""
    from sqlalchemy import text
    from app.core.database import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("ALTER TABLE creditos ADD COLUMN IF NOT EXISTS modalidad_proyeccion VARCHAR(20) DEFAULT 'fija';"))
            await session.execute(text("ALTER TABLE creditos ADD COLUMN IF NOT EXISTS fecha_siguiente_visita DATE;"))
            await session.execute(text("ALTER TABLE abonos ADD COLUMN IF NOT EXISTS fecha_siguiente_visita DATE;"))
            await session.execute(text("ALTER TABLE creditos ADD COLUMN IF NOT EXISTS banco_transferencia VARCHAR(100);"))
            await session.execute(text("ALTER TABLE abonos ADD COLUMN IF NOT EXISTS banco_transferencia VARCHAR(100);"))

            # Tabla de Entidades Bancarias y Pasarelas de Pago
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS entidades_bancarias (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    nombre VARCHAR(100) UNIQUE NOT NULL,
                    activa BOOLEAN NOT NULL DEFAULT true,
                    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            """))

            # Poblar entidades bancarias predeterminadas de Colombia si no existen
            bancos_default = [
                "Bancolombia",
                "Nequi",
                "Daviplata",
                "Davivienda",
                "BBVA",
                "Banco de Bogotá",
                "Banco Agrario",
                "Scotiabank Colpatria",
                "Banco Popular",
                "Banco de Occidente",
                "Transfiya / Otras",
            ]
            for b_nombre in bancos_default:
                await session.execute(
                    text("""
                        INSERT INTO entidades_bancarias (nombre, activa)
                        VALUES (:nombre, true)
                        ON CONFLICT (nombre) DO NOTHING;
                    """),
                    {"nombre": b_nombre},
                )

            # Eliminar índices parciales simples anteriores
            await session.execute(text("DROP INDEX IF EXISTS uq_abonos_referencia_pago_normalizada;"))
            await session.execute(text("DROP INDEX IF EXISTS uq_creditos_referencia_inicial_normalizada;"))

            # Crear índices únicos compuestos (Banco + Referencia Normalizada)
            await session.execute(text("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_abonos_banco_referencia_normalizada
                ON abonos (UPPER(TRIM(banco_transferencia)), UPPER(TRIM(referencia_pago)))
                WHERE referencia_pago IS NOT NULL AND TRIM(referencia_pago) <> ''
                  AND banco_transferencia IS NOT NULL AND TRIM(banco_transferencia) <> '';
            """))
            await session.execute(text("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_creditos_banco_referencia_normalizada
                ON creditos (UPPER(TRIM(banco_transferencia)), UPPER(TRIM(referencia_pago_inicial)))
                WHERE referencia_pago_inicial IS NOT NULL AND TRIM(referencia_pago_inicial) <> ''
                  AND banco_transferencia IS NOT NULL AND TRIM(banco_transferencia) <> '';
            """))

            # Tabla de Ventas Anuladas y Solicitudes de Devolución/Reembolso
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS ventas_anuladas (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    vendedor_id UUID NOT NULL REFERENCES usuarios(id),
                    monto_total NUMERIC(12, 2) NOT NULL,
                    metodo_pago_original VARCHAR(50) NOT NULL,
                    referencia_original VARCHAR(100),
                    articulos_json JSONB NOT NULL DEFAULT '[]'::jsonb,
                    estado_devolucion VARCHAR(50) NOT NULL,
                    banco_destino_cliente VARCHAR(100),
                    cuenta_destino_cliente VARCHAR(100),
                    notas_vendedor TEXT,
                    referencia_reembolso_oficina VARCHAR(100),
                    banco_origen_reembolso VARCHAR(100),
                    fecha_reembolso TIMESTAMP WITH TIME ZONE,
                    firma_vendedor TEXT,
                    firma_cliente TEXT,
                    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            """))
            await session.execute(text("ALTER TABLE ventas_anuladas ADD COLUMN IF NOT EXISTS firma_vendedor TEXT;"))
            await session.execute(text("ALTER TABLE ventas_anuladas ADD COLUMN IF NOT EXISTS firma_cliente TEXT;"))
            await session.execute(text("CREATE INDEX IF NOT EXISTS idx_ventas_anuladas_vendedor ON ventas_anuladas(vendedor_id)"))
            await session.execute(text("CREATE INDEX IF NOT EXISTS idx_ventas_anuladas_estado ON ventas_anuladas(estado_devolucion)"))

            # Tabla de Detalles de Transferencias Múltiples (Hito 3)
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS detalles_transferencia (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    venta_id UUID REFERENCES creditos(id_contrato) ON DELETE CASCADE,
                    abono_id UUID REFERENCES abonos(id_recibo) ON DELETE CASCADE,
                    entidad_bancaria VARCHAR(100) NOT NULL,
                    referencia_pago VARCHAR(100) NOT NULL,
                    monto NUMERIC(12, 2) NOT NULL,
                    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            """))
            await session.execute(text("CREATE INDEX IF NOT EXISTS idx_detalles_transf_venta ON detalles_transferencia(venta_id);"))
            await session.execute(text("CREATE INDEX IF NOT EXISTS idx_detalles_transf_abono ON detalles_transferencia(abono_id);"))
            # Candado estricto a nivel de motor: UNIQUE (entidad_bancaria, UPPER(TRIM(referencia_pago)))
            await session.execute(text("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_detalles_transferencia_banco_ref
                ON detalles_transferencia (entidad_bancaria, UPPER(TRIM(referencia_pago)));
            """))

            await session.commit()
            print("[SCHEMA] Tabla de entidades bancarias, ventas anuladas, columnas e índices únicos asegurados en PostgreSQL.")
    except Exception as exc:
        print(f"[SCHEMA] Advertencia al verificar esquema en arranque: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Ciclo de vida de la aplicación: gestión de inicio y detención de recursos."""
    print(f"Iniciando {settings.PROJECT_NAME} v{settings.VERSION} con Autenticación JWT y RBAC...")
    await ensure_master_user()
    await ensure_db_schema()
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

# Servir archivos estáticos públicos (imágenes de productos, firmas, etc.)
STORAGE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "storage"))
PRODUCTOS_STORAGE_DIR = os.path.join(STORAGE_DIR, "productos")
os.makedirs(PRODUCTOS_STORAGE_DIR, exist_ok=True)

app.mount("/storage", StaticFiles(directory=STORAGE_DIR), name="storage")

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


@config_alias_router.get("/ciudades", summary="Obtener catálogo estructurado de departamentos y municipios")
async def get_config_ciudades_alias():
    """Retorna la lista de ciudades autorizadas para radicación de ventas y créditos."""
    ciudades = _obtener_ciudades_venta()
    lista_plana = []
    for munis in ciudades.values():
        for m in munis:
            if m not in lista_plana:
                lista_plana.append(m)
    total = sum(len(m) for m in ciudades.values())
    return {
        "success": True,
        "departamentos": ciudades,
        "ciudades": ciudades,
        "ciudades_plano": lista_plana,
        "total": total,
    }


@config_alias_router.put("/ciudades", summary="Actualizar lista de ciudades operativas")
async def put_config_ciudades_alias(datos: CiudadesVentaRequest, current_user=Depends(require_supervisor)):
    payload = datos.departamentos if datos.departamentos is not None else datos.ciudades
    ciudades = _guardar_ciudades_venta(payload)
    lista_plana = []
    for munis in ciudades.values():
        for m in munis:
            if m not in lista_plana:
                lista_plana.append(m)
    total = sum(len(m) for m in ciudades.values())
    return {
        "success": True,
        "mensaje": "Catálogo de ciudades operativas actualizado exitosamente.",
        "departamentos": ciudades,
        "ciudades": ciudades,
        "ciudades_plano": lista_plana,
        "total": total,
    }


@config_alias_router.post("/ciudades", summary="Agregar una nueva ciudad operativa")
async def post_config_ciudades_alias(datos: AgregarCiudadRequest, current_user=Depends(require_supervisor)):
    ciudad_nueva = datos.ciudad.strip().title()
    dep = (datos.departamento or "Córdoba").strip().title()
    if "Sucre" in dep:
        dep = "Sucre"
    elif "Cordoba" in dep or "Córdoba" in dep:
        dep = "Córdoba"

    ciudades_actuales = _obtener_ciudades_venta()
    if dep not in ciudades_actuales:
        ciudades_actuales[dep] = []

    if any(c.lower() == ciudad_nueva.lower() for c in ciudades_actuales[dep]):
        raise HTTPException(
            status_code=400,
            detail=f"El municipio '{ciudad_nueva}' ya se encuentra registrado en {dep}.",
        )
    ciudades_actuales[dep].append(ciudad_nueva)
    resultado = _guardar_ciudades_venta(ciudades_actuales)
    lista_plana = []
    for munis in resultado.values():
        for m in munis:
            if m not in lista_plana:
                lista_plana.append(m)
    return {
        "success": True,
        "mensaje": f"Municipio '{ciudad_nueva}' agregado exitosamente a {dep}.",
        "departamentos": resultado,
        "ciudades": resultado,
        "ciudades_plano": lista_plana,
        "total": sum(len(m) for m in resultado.values()),
    }


# Registro de rutas principales
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(usuarios_router)
app.include_router(productos_router)
app.include_router(clientes_router)
app.include_router(creditos_router)
app.include_router(abonos_router)
app.include_router(auditoria_router)
app.include_router(bancos_router)
app.include_router(reportes_router)
app.include_router(configuracion_router)
app.include_router(config_alias_router)
app.include_router(respaldos_router)

# Registro también bajo prefijo versionado /api/v1
app.include_router(health_router, prefix=settings.API_V1_STR)
app.include_router(auth_router, prefix=settings.API_V1_STR)
app.include_router(usuarios_router, prefix=settings.API_V1_STR)
app.include_router(productos_router, prefix=settings.API_V1_STR)
app.include_router(clientes_router, prefix=settings.API_V1_STR)
app.include_router(creditos_router, prefix=settings.API_V1_STR)
app.include_router(abonos_router, prefix=settings.API_V1_STR)
app.include_router(auditoria_router, prefix=settings.API_V1_STR)
app.include_router(bancos_router, prefix=settings.API_V1_STR)
app.include_router(reportes_router, prefix=settings.API_V1_STR)
app.include_router(configuracion_router, prefix=settings.API_V1_STR)
app.include_router(config_alias_router, prefix=settings.API_V1_STR)
app.include_router(respaldos_router, prefix=settings.API_V1_STR)



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
