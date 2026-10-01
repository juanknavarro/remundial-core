import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def migrate():
    async with AsyncSessionLocal() as session:
        print("[MIGRACIÓN] Verificando columnas monto_inicial_efectivo y monto_inicial_transferencia en tabla creditos...")
        
        await session.execute(text("""
            ALTER TABLE creditos 
            ADD COLUMN IF NOT EXISTS monto_inicial_efectivo NUMERIC(12, 2) DEFAULT 0.00;
        """))
        await session.execute(text("""
            ALTER TABLE creditos 
            ADD COLUMN IF NOT EXISTS monto_inicial_transferencia NUMERIC(12, 2) DEFAULT 0.00;
        """))
        
        await session.commit()
        print("[MIGRACIÓN] Columnas de pago mixto aplicadas exitosamente a tabla creditos.")

        res = await session.execute(text("""
            SELECT column_name, data_type, column_default, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'creditos' AND column_name IN ('monto_inicial_efectivo', 'monto_inicial_transferencia');
        """))
        rows = res.fetchall()
        print("\n[MIGRACIÓN] Columnas detectadas en PostgreSQL:")
        for r in rows:
            print(f" - Columna: {r[0]}, Tipo: {r[1]}, Default: {r[2]}, Nullable: {r[3]}")

if __name__ == "__main__":
    asyncio.run(migrate())
