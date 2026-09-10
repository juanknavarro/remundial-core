import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def migrate():
    async with AsyncSessionLocal() as session:
        print("[MIGRACIÓN] Verificando columnas stock y maneja_stock en tabla productos...")
        
        # 1. Agregar columnas si no existen
        await session.execute(text("""
            ALTER TABLE productos 
            ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 0 NOT NULL;
        """))
        await session.execute(text("""
            ALTER TABLE productos 
            ADD COLUMN IF NOT EXISTS maneja_stock BOOLEAN DEFAULT TRUE NOT NULL;
        """))
        await session.commit()
        print("[MIGRACIÓN] Columnas stock y maneja_stock verificadas/agregadas.")

        # 2. Configurar productos existentes:
        # Los cuadros (artículos hechos por encargo) -> maneja_stock = FALSE, stock = 0
        await session.execute(text("""
            UPDATE productos 
            SET maneja_stock = FALSE, stock = 0
            WHERE LOWER(nombre) LIKE '%cuadro%';
        """))

        # Los productos normales (muebles, mecedoras, etc.) -> maneja_stock = TRUE, stock inicial de prueba = 25
        await session.execute(text("""
            UPDATE productos 
            SET maneja_stock = TRUE, stock = 25, es_precio_variable = FALSE
            WHERE LOWER(nombre) NOT LIKE '%cuadro%';
        """))
        await session.commit()
        print("[MIGRACIÓN] Configuración de stock y maneja_stock aplicada a artículos existentes.")

        # 3. Vista previa de verificación
        res = await session.execute(text("SELECT id, sku, nombre, stock, maneja_stock, es_precio_variable FROM productos ORDER BY nombre ASC;"))
        rows = res.fetchall()
        print(f"\n[MIGRACIÓN] Estado actual del catálogo:")
        for r in rows:
            tipo = "Por Encargo (Sin stock)" if not r[4] else f"Stock: {r[3]}"
            print(f" - [{r[1]}] {r[2]} -> {tipo} (maneja_stock={r[4]})")

if __name__ == "__main__":
    asyncio.run(migrate())
