import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def migrate():
    async with AsyncSessionLocal() as session:
        print("[MIGRACIÓN] Verificando columna estado_activo en tabla productos...")
        await session.execute(text("""
            ALTER TABLE productos 
            ADD COLUMN IF NOT EXISTS estado_activo BOOLEAN DEFAULT TRUE NOT NULL;
        """))
        await session.commit()
        print("[MIGRACIÓN] Columna estado_activo verificada/agregada con éxito.")

        res = await session.execute(text("SELECT id, sku, nombre, estado_activo FROM productos LIMIT 5;"))
        rows = res.fetchall()
        print(f"[MIGRACIÓN] Vista previa de productos con estado_activo:")
        for r in rows:
            print(f" - {r[1]} ({r[2]}): activo={r[3]}")

if __name__ == "__main__":
    asyncio.run(migrate())
