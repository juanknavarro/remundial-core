"""Script de Limpieza Controlada de Base de Datos para Remundial Core.

Elimina todos los registros transaccionales de prueba:
- abonos (recortes / recaudos de prueba)
- credito_detalle (detalles de venta)
- creditos (contratos de financiamiento)
- productos (productos semilla de prueba)
- usuarios de prueba temporales generados en auditorías

Conserva estrictamente:
- usuarios del sistema (Master, Supervisor, Secretaría, Vendedor, Cobrador)
- clientes (directorio completo de clientes)
- referencias_cliente
"""

import asyncio
import sys
from pathlib import Path

# Configurar encoding UTF-8 para consola Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

# Agregar raíz de backend al PYTHONPATH
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text
from app.core.database import AsyncSessionLocal


async def ejecutar_limpieza():
    print("==========================================================")
    print("   REMUNDIAL CORE - LIMPIEZA CONTROLADA DE BASE DE DATOS   ")
    print("==========================================================")

    async with AsyncSessionLocal() as session:
        # 1. Diagnóstico de estado previo
        print("\n[1/4] Consultando estado previo de registros...")
        tables_to_check = [
            ("usuarios", "SELECT count(*) FROM usuarios;"),
            ("clientes", "SELECT count(*) FROM clientes;"),
            ("productos", "SELECT count(*) FROM productos;"),
            ("creditos", "SELECT count(*) FROM creditos;"),
            ("credito_detalle", "SELECT count(*) FROM credito_detalle;"),
            ("abonos", "SELECT count(*) FROM abonos;"),
        ]

        for tbl, sql in tables_to_check:
            res = await session.execute(text(sql))
            count = res.scalar()
            print(f"  * {tbl:18}: {count:4} registros")

        # 2. Ejecutar Truncado Controlado de Tablas Transaccionales y Productos Semilla
        print("\n[2/4] Ejecutando truncado selectivo con reinicio de identidades...")
        sql_truncate = """
        TRUNCATE TABLE abonos, credito_detalle, creditos, productos RESTART IDENTITY CASCADE;
        """
        await session.execute(text(sql_truncate))

        # 3. Limpiar usuarios temporales de prueba dejando únicamente los 5 roles del sistema
        print("\n[3/4] Depurando usuarios de prueba temporales en 'usuarios'...")
        sql_clean_test_users = """
        DELETE FROM usuarios 
        WHERE nombre LIKE 'Prueba Auditoria%' 
           OR telefono LIKE '399%';
        """
        await session.execute(text(sql_clean_test_users))
        await session.commit()
        print("  [OK] Tablas transaccionales y productos semilla vaciados.")
        print("  [OK] Usuarios temporales eliminados.")

        # 4. Verificación de Integridad Posterior
        print("\n[4/4] Verificando integridad de la base de datos post-limpieza...")
        print("----------------------------------------------------------")
        
        # Conteo post-limpieza
        res_usuarios = await session.execute(
            text("SELECT id, nombre, rol, telefono, estado_activo FROM usuarios ORDER BY rol;")
        )
        usuarios = res_usuarios.fetchall()
        print(f"  [OK] Usuarios activos del sistema ({len(usuarios)} conservados):")
        for u in usuarios:
            print(f"     - [{u[2].upper():10}] {u[1]} (Tel: {u[3]}) | Activo: {u[4]}")

        res_clientes = await session.execute(
            text("SELECT id, cedula, nombres, telefono, barrio, ciudad FROM clientes ORDER BY nombres;")
        )
        clientes = res_clientes.fetchall()
        print(f"\n  [OK] Directorio de Clientes ({len(clientes)} conservados):")
        for c in clientes:
            print(f"     - {c[1]} | {c[2]} ({c[3]}) - {c[4]}, {c[5]}")

        # Comprobar ceros en transaccionales
        tablas_vacias = ["productos", "creditos", "credito_detalle", "abonos"]
        print("\n  [OK] Comprobacion de tablas en CEROS:")
        todas_en_cero = True
        for tbl in tablas_vacias:
            res = await session.execute(text(f"SELECT count(*) FROM {tbl};"))
            c = res.scalar()
            print(f"     - {tbl:16}: {c} registros")
            if c != 0:
                todas_en_cero = False

        print("----------------------------------------------------------")
        if todas_en_cero and len(usuarios) >= 5 and len(clientes) >= 4:
            print(">>> ESTADO: LIMPIEZA EXITOSA. BASE DE DATOS LISTA PARA ENTORNO REAL <<<")
        else:
            print(">>> ALERTA: Verifique los conteos anteriores <<<")


if __name__ == "__main__":
    asyncio.run(ejecutar_limpieza())
