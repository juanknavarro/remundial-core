import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def migrate():
    async with AsyncSessionLocal() as session:
        print("[MIGRACIÓN] Verificando columnas de pago mixto en tabla abonos...")
        
        await session.execute(text("""
            ALTER TABLE abonos 
            ADD COLUMN IF NOT EXISTS monto_efectivo NUMERIC(12, 2) DEFAULT 0.00;
        """))
        await session.execute(text("""
            ALTER TABLE abonos 
            ADD COLUMN IF NOT EXISTS monto_transferencia NUMERIC(12, 2) DEFAULT 0.00;
        """))
        await session.execute(text("""
            ALTER TABLE abonos 
            ADD COLUMN IF NOT EXISTS referencia_pago VARCHAR(255);
        """))
        
        await session.commit()
        print("[MIGRACIÓN] Columnas agregadas exitosamente a tabla abonos.")

        res = await session.execute(text("""
            SELECT column_name, data_type, column_default, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'abonos' AND column_name IN ('monto_efectivo', 'monto_transferencia', 'referencia_pago', 'metodo_pago');
        """))
        rows = res.fetchall()
        print("\n[MIGRACIÓN] Columnas detectadas en PostgreSQL:")
        for r in rows:
            print(f" - Columna: {r[0]}, Tipo: {r[1]}, Default: {r[2]}, Nullable: {r[3]}")

if __name__ == "__main__":
    asyncio.run(migrate())
