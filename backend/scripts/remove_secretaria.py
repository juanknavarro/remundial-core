import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def run_removal():
    print("=== PROCESO DE ELIMINACIÓN DE USUARIOS CON ROL 'SECRETARIA' ===")
    
    # 1. Identificar usuarios con rol secretaria
    async with AsyncSessionLocal() as session:
        res = await session.execute(text("SELECT id, nombre, rol::text, telefono FROM usuarios WHERE rol::text = 'secretaria'"))
        secretarias = res.fetchall()
        print(f"Usuarios con rol 'secretaria' encontrados: {len(secretarias)}")
        for sec in secretarias:
            print(f" - ID: {sec[0]} | Nombre: {sec[1]} | Teléfono: {sec[3]}")

        if not secretarias:
            print("[INFO] No hay usuarios con rol 'secretaria' en la base de datos.")
            return

        sec_ids = [s[0] for s in secretarias]

        # 2. Buscar un usuario supervisor o master
        res_sup = await session.execute(text("SELECT id FROM usuarios WHERE rol::text IN ('supervisor', 'master') ORDER BY creado_en ASC LIMIT 1"))
        fallback_sup = res_sup.scalar()
        print(f"Supervisor fallback para reasignar referencias: {fallback_sup}")

    # Reasignar en transacciones individuales limpias
    for s_id in sec_ids:
        # Check cierres_caja
        async with AsyncSessionLocal() as session:
            try:
                res_cc = await session.execute(text("SELECT count(*) FROM cierres_caja WHERE responsable_id = :sec_id"), {"sec_id": s_id})
                cc_count = res_cc.scalar()
                if cc_count > 0 and fallback_sup:
                    print(f"Reasignando {cc_count} cierres_caja de {s_id} a supervisor {fallback_sup}")
                    await session.execute(text("UPDATE cierres_caja SET responsable_id = :sup_id WHERE responsable_id = :sec_id"), {"sup_id": fallback_sup, "sec_id": s_id})
                    await session.commit()
            except Exception as e:
                print(f"Nota cierres_caja: {e}")
                await session.rollback()

        # Check abonos
        async with AsyncSessionLocal() as session:
            try:
                res_ab = await session.execute(text("SELECT count(*) FROM abonos WHERE cobrador_id = :sec_id"), {"sec_id": s_id})
                ab_count = res_ab.scalar()
                if ab_count > 0:
                    print(f"Abonos con cobrador_id={s_id}: {ab_count}")
            except Exception as e:
                await session.rollback()

    # 3. Eliminar usuarios
    async with AsyncSessionLocal() as session:
        del_res = await session.execute(text("DELETE FROM usuarios WHERE rol::text = 'secretaria'"))
        await session.commit()
        print(f"[OK] Eliminados físicamente {del_res.rowcount} usuario(s) con rol 'secretaria'.")

    # 4. Verificar
    async with AsyncSessionLocal() as session:
        check_res = await session.execute(text("SELECT count(*) FROM usuarios WHERE rol::text = 'secretaria'"))
        count = check_res.scalar()
        print(f"[VERIFICACIÓN] Total usuarios con rol 'secretaria' en BD: {count}")
        assert count == 0

if __name__ == "__main__":
    asyncio.run(run_removal())
