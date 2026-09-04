import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def check():
    async with AsyncSessionLocal() as s:
        res = await s.execute(text("SELECT id, sku, nombre FROM productos;"))
        print("PRODUCTOS:")
        for r in res.fetchall():
            print(f" - {r[0]} | {r[1]} | {r[2]}")

        res2 = await s.execute(text("SELECT cd.producto_id, p.nombre, count(*) FROM credito_detalle cd JOIN productos p ON p.id = cd.producto_id GROUP BY cd.producto_id, p.nombre;"))
        print("\nPRODUCTOS USADOS EN CREDITO_DETALLE:")
        for r in res2.fetchall():
            print(f" - {r[0]} | {r[1]} | Count: {r[2]}")

if __name__ == "__main__":
    asyncio.run(check())
