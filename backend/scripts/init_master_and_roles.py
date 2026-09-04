import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, text
from app.core.database import AsyncSessionLocal, engine
from app.core.security import get_password_hash
from app.models.usuario import RolUsuario, Usuario

USERS_CONFIG = [
    {
        "nombre": "Superusuario Master",
        "rol": RolUsuario.MASTER,
        "telefono": "3000000000",
        "password": "masterpassword123",
    },
    {
        "nombre": "Ana Supervisora",
        "rol": RolUsuario.SUPERVISOR,
        "telefono": "3009990011",
        "password": "password123",
    },
    {
        "nombre": "María Secretaria",
        "rol": RolUsuario.SECRETARIA,
        "telefono": "3104445566",
        "password": "password123",
    },
    {
        "nombre": "Juan Vendedor",
        "rol": RolUsuario.VENDEDOR,
        "telefono": "3151234567",
        "password": "password123",
    },
    {
        "nombre": "Pedro Cobrador",
        "rol": RolUsuario.COBRADOR,
        "telefono": "3189998877",
        "password": "password123",
    },
]

async def update_db_enum():
    """Actualiza la enumeración en PostgreSQL para incluir 'master' si no existe."""
    async with engine.connect() as conn:
        await conn.execution_options(isolation_level="AUTOCOMMIT")
        try:
            await conn.execute(
                text("ALTER TYPE rol_usuario_enum ADD VALUE IF NOT EXISTS 'master' BEFORE 'supervisor'")
            )
            print("[OK] Tipo enumerado rol_usuario_enum actualizado con 'master'.")
        except Exception as exc:
            print(f"Nota sobre enum (puede que ya exista): {exc}")

async def seed_users():
    """Crea o actualiza los 5 perfiles estándar con contraseñas limpias y activas."""
    async with AsyncSessionLocal() as session:
        for cfg in USERS_CONFIG:
            # Buscar por teléfono
            stmt = select(Usuario).where(Usuario.telefono == cfg["telefono"])
            res = await session.execute(stmt)
            user = res.scalar_one_or_none()

            hashed = get_password_hash(cfg["password"])

            if user:
                user.nombre = cfg["nombre"]
                user.rol = cfg["rol"]
                user.password_hash = hashed
                user.estado_activo = True
                print(f"[OK] Actualizado perfil: {cfg['nombre']} ({cfg['rol'].value}) - Tel: {cfg['telefono']}")
            else:
                new_user = Usuario(
                    nombre=cfg["nombre"],
                    rol=cfg["rol"],
                    telefono=cfg["telefono"],
                    password_hash=hashed,
                    estado_activo=True,
                )
                session.add(new_user)
                print(f"[OK] Creado nuevo perfil: {cfg['nombre']} ({cfg['rol'].value}) - Tel: {cfg['telefono']}")

        await session.commit()
        print("\n[OK] Todos los perfiles limpios han sido inicializados exitosamente.")

async def main():
    await update_db_enum()
    await seed_users()

if __name__ == "__main__":
    asyncio.run(main())
