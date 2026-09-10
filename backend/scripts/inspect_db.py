import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def check():
    async with AsyncSessionLocal() as s:
        res = await s.execute(text("SELECT id, sku, nombre, es_precio_variable, maneja_stock, stock FROM productos;"))
        print("PRODUCTOS:")
        for r in res.fetchall():
            print(f" - {r[0]} | {r[1]} | {r[2]} | var={r[3]} | maneja_stock={r[4]} | stock={r[5]}")

if __name__ == "__main__":
    asyncio.run(check())

