import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def migrate():
    async with AsyncSessionLocal() as session:
        print("[MIGRACIÓN] Verificando columnas metodo_pago_inicial y referencia_pago_inicial en tabla creditos...")
        
        await session.execute(text("""
            ALTER TABLE creditos 
            ADD COLUMN IF NOT EXISTS metodo_pago_inicial VARCHAR(50);
        """))
        await session.execute(text("""
            ALTER TABLE creditos 
            ADD COLUMN IF NOT EXISTS referencia_pago_inicial VARCHAR(100);
        """))
        
        await session.commit()
        print("[MIGRACIÓN] Columnas metodo_pago_inicial y referencia_pago_inicial aplicadas exitosamente.")

        res = await session.execute(text("""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'creditos' AND column_name IN ('metodo_pago_inicial', 'referencia_pago_inicial');
        """))
        rows = res.fetchall()
        print("\n[MIGRACIÓN] Columnas detectadas en PostgreSQL:")
        for r in rows:
            print(f" - Columna: {r[0]}, Tipo: {r[1]}, Nullable: {r[2]}")

if __name__ == "__main__":
    asyncio.run(migrate())
