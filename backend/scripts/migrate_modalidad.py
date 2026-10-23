import asyncio
from sqlalchemy import text
from app.core.database import engine

async def migrate():
    async with engine.begin() as conn:
        await conn.execute(text("ALTER TABLE creditos ADD COLUMN IF NOT EXISTS modalidad_proyeccion VARCHAR(20) DEFAULT 'fija';"))
        await conn.execute(text("ALTER TABLE creditos ADD COLUMN IF NOT EXISTS fecha_siguiente_visita DATE;"))
        await conn.execute(text("ALTER TABLE abonos ADD COLUMN IF NOT EXISTS fecha_siguiente_visita DATE;"))
        print("Migración completada exitosamente!")

if __name__ == "__main__":
    asyncio.run(migrate())
