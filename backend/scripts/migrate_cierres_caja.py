import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS cierres_caja (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cobrador_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE CASCADE,
        responsable_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE CASCADE,
        fecha_cierre TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        total_esperado NUMERIC(12, 2) NOT NULL,
        efectivo_entregado NUMERIC(12, 2) NOT NULL,
        diferencia NUMERIC(12, 2) NOT NULL,
        cuadre_estado VARCHAR(20) NOT NULL,
        abonos_conciliados_count INTEGER NOT NULL DEFAULT 0,
        notas TEXT,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_cierres_caja_cobrador_id ON cierres_caja (cobrador_id)",
    "CREATE INDEX IF NOT EXISTS idx_cierres_caja_responsable_id ON cierres_caja (responsable_id)",
    "CREATE INDEX IF NOT EXISTS idx_cierres_caja_fecha_cierre ON cierres_caja (fecha_cierre)",
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'abonos' AND column_name = 'cierre_caja_id'
        ) THEN
            ALTER TABLE abonos ADD COLUMN cierre_caja_id UUID REFERENCES cierres_caja(id) ON DELETE SET NULL;
            CREATE INDEX idx_abonos_cierre_caja_id ON abonos (cierre_caja_id);
        END IF;
    END$$;
    """,
]

async def run_migration():
    async with AsyncSessionLocal() as s:
        print("Ejecutando migración DDL para cierres_caja y auditoría...")
        for stmt in STATEMENTS:
            await s.execute(text(stmt.strip()))
        await s.commit()
        print("Migración completada exitosamente.")

if __name__ == "__main__":
    asyncio.run(run_migration())
