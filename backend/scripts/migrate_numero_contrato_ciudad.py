import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def migrate():
    async with AsyncSessionLocal() as session:
        print("[MIGRACIÓN] Verificando columnas numero_contrato y ciudad_venta en tabla creditos...")
        
        # 1. Agregar columnas si no existen
        await session.execute(text("""
            ALTER TABLE creditos 
            ADD COLUMN IF NOT EXISTS numero_contrato VARCHAR(50);
        """))
        await session.execute(text("""
            ALTER TABLE creditos 
            ADD COLUMN IF NOT EXISTS ciudad_venta VARCHAR(100);
        """))
        
        # 2. Crear índice único parcial para numero_contrato (permite múltiples nulos o vacíos, pero exige unicidad si se provee)
        await session.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_creditos_numero_contrato 
            ON creditos (numero_contrato) 
            WHERE numero_contrato IS NOT NULL AND TRIM(numero_contrato) != '';
        """))
        
        # 3. Crear índice para búsquedas por ciudad_venta
        await session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_creditos_ciudad_venta 
            ON creditos (ciudad_venta);
        """))
        
        await session.commit()
        print("[MIGRACIÓN] Columnas e índices de numero_contrato y ciudad_venta aplicados exitosamente.")

        # 4. Verificación estructural
        res = await session.execute(text("""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'creditos' AND column_name IN ('numero_contrato', 'ciudad_venta');
        """))
        rows = res.fetchall()
        print("\n[MIGRACIÓN] Columnas detectadas en PostgreSQL:")
        for r in rows:
            print(f" - Columna: {r[0]}, Tipo: {r[1]}, Nullable: {r[2]}")

if __name__ == "__main__":
    asyncio.run(migrate())
