import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio
from decimal import Decimal
from sqlalchemy import select, text
from app.core.database import AsyncSessionLocal
from app.models.producto import Producto
from app.models.credito import CreditoDetalle
from app.crud import crud_producto

async def run_tests():
    async with AsyncSessionLocal() as session:
        print("\n--- TEST 1: Verificar Producto con Créditos Asociados ---")
        # Encontrar un producto con créditos
        res = await session.execute(
            select(CreditoDetalle.producto_id).limit(1)
        )
        prod_id_con_credito = res.scalar_one_or_none()
        print(f"Producto ID con crédito: {prod_id_con_credito}")
        if prod_id_con_credito:
            count = await crud_producto.count_credito_detalles_by_producto(session, prod_id_con_credito)
            print(f"Créditos asociados contados: {count} (debe ser > 0)")
            assert count > 0, "Debería tener al menos 1 crédito asociado"

        print("\n--- TEST 2: Crear y Eliminar Producto sin Créditos ---")
        nuevo_prod = Producto(
            sku="TEST-BORRAR-99",
            nombre="Producto Temporal de Prueba Borrado",
            precio_base=Decimal("150000.00"),
            es_precio_variable=False,
            estado_activo=True,
        )
        session.add(nuevo_prod)
        await session.commit()
        await session.refresh(nuevo_prod)
        print(f"Producto de prueba creado: ID={nuevo_prod.id}, SKU={nuevo_prod.sku}")

        count_nuevo = await crud_producto.count_credito_detalles_by_producto(session, nuevo_prod.id)
        print(f"Créditos asociados para producto nuevo: {count_nuevo} (debe ser 0)")
        assert count_nuevo == 0, "No debe tener créditos asociados"

        # Eliminar físicamente
        await crud_producto.delete_producto(session, nuevo_prod)
        print("Producto nuevo eliminado con éxito.")

        check_eliminado = await crud_producto.get_producto(session, nuevo_prod.id)
        assert check_eliminado is None, "El producto debería haber sido eliminado físicamente"
        print("Verificación de borrado exitosa.")

        print("\n--- TEST 3: Desactivación Lógica de Producto ---")
        prod_inactivar = Producto(
            sku="TEST-INACT-88",
            nombre="Producto para Prueba Inactivación",
            precio_base=Decimal("200000.00"),
            es_precio_variable=False,
            estado_activo=True,
        )
        session.add(prod_inactivar)
        await session.commit()
        await session.refresh(prod_inactivar)
        print(f"Producto creado para inactivar: {prod_inactivar.id}, activo={prod_inactivar.estado_activo}")

        await crud_producto.deactivate_producto(session, prod_inactivar)
        print(f"Producto tras desactivación lógica: activo={prod_inactivar.estado_activo}")
        assert prod_inactivar.estado_activo is False, "El producto debe quedar en estado_activo=False"

        # Limpiar
        await crud_producto.delete_producto(session, prod_inactivar)
        print("Limpieza completada.")

        print("\n TODOS LOS TESTS DE INVENTARIO PASARON EXITOSAMENTE.")

if __name__ == "__main__":
    asyncio.run(run_tests())
