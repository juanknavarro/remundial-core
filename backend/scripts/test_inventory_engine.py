import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.producto import Producto
from app.models.cliente import Cliente
from app.models.usuario import Usuario, RolUsuario
from app.models.credito import Credito, CreditoDetalle, EstadoCredito, TipoPago
from app.schemas.credito import CreditoCreate, CreditoDetalleCreate
from app.schemas.producto import ProductoCreate, ReabastecerStockRequest
from app.crud import crud_credito, crud_producto

async def run_inventory_tests():
    async with AsyncSessionLocal() as session:
        print("\n=======================================================")
        print("  INICIANDO TEST DEL MOTOR DE INVENTARIO Y EXCEPCIONES  ")
        print("=======================================================\n")

        # 1. Obtener o crear un cliente y vendedor de prueba
        res_vendedor = await session.execute(select(Usuario).where(Usuario.rol == RolUsuario.VENDEDOR).limit(1))
        vendedor = res_vendedor.scalar_one_or_none()
        if not vendedor:
            res_user = await session.execute(select(Usuario).limit(1))
            vendedor = res_user.scalar_one_or_none()
        
        res_cliente = await session.execute(select(Cliente).limit(1))
        cliente = res_cliente.scalar_one_or_none()

        assert vendedor is not None, "Debe existir al menos un usuario para las pruebas"
        assert cliente is not None, "Debe existir al menos un cliente para las pruebas"

        # 2. Crear un producto con control de stock (Mecedora)
        sku_mecedora = f"TEST-MEC-{uuid4().hex[:6]}"
        prod_mecedora = await crud_producto.create_producto(
            db=session,
            producto_in=ProductoCreate(
                sku=sku_mecedora,
                nombre="Mecedora Artesanal Roble Test",
                precio_base=Decimal("200000.00"),
                es_precio_variable=False,
                stock=5,
                maneja_stock=True,
                estado_activo=True,
            )
        )
        print(f"[TEST 1] Producto regular creado: {prod_mecedora.nombre}, Stock={prod_mecedora.stock}, maneja_stock={prod_mecedora.maneja_stock}")
        assert prod_mecedora.stock == 5
        assert prod_mecedora.maneja_stock is True

        # 3. Probar reabastecimiento
        prod_reabastecido = await crud_producto.reabastecer_producto(
            db=session,
            db_producto=prod_mecedora,
            cantidad=10,
        )
        print(f"[TEST 2] Reabastecimiento exitoso (+10 unid): Stock={prod_reabastecido.stock}")
        assert prod_reabastecido.stock == 15

        # 4. Crear un Cuadro (hecho por encargo, maneja_stock = False)
        sku_cuadro = f"TEST-CUADRO-{uuid4().hex[:6]}"
        prod_cuadro = await crud_producto.create_producto(
            db=session,
            producto_in=ProductoCreate(
                sku=sku_cuadro,
                nombre="Cuadro al Óleo Atardecer Test",
                precio_base=Decimal("350000.00"),
                es_precio_variable=True,
                stock=0,
                maneja_stock=False,
                estado_activo=True,
            )
        )
        print(f"[TEST 3] Cuadro por encargo creado: {prod_cuadro.nombre}, Stock={prod_cuadro.stock}, maneja_stock={prod_cuadro.maneja_stock}")
        assert prod_cuadro.stock == 0
        assert prod_cuadro.maneja_stock is False

        # 5. Vender producto regular con stock suficiente (vender 3 unidades)
        # Total venta = 3 * 200,000 = 600,000. Cuota inicial: 100,000. Monto financiado: 500,000. 5 cuotas de 100,000.
        credito_in_ok = CreditoCreate(
            cliente_id=cliente.id,
            vendedor_id=vendedor.id,
            estado=EstadoCredito.PENDIENTE,
            tipo_pago=TipoPago.MENSUAL,
            cuota_inicial=Decimal("100000.00"),
            monto_financiado=Decimal("500000.00"),
            numero_cuotas=5,
            valor_cuota=Decimal("100000.00"),
            fecha_primera_cuota="2026-10-01",
            detalles=[
                CreditoDetalleCreate(
                    producto_id=prod_mecedora.id,
                    cantidad=3,
                    valor_unitario_acordado=Decimal("200000.00"),
                )
            ]
        )
        credito_res = await crud_credito.create_credito(db=session, credito_in=credito_in_ok)
        await session.refresh(prod_mecedora)
        print(f"[TEST 4] Venta regular procesada. Stock anterior=15, Vendidas=3, Stock actual={prod_mecedora.stock}")
        assert prod_mecedora.stock == 12, f"El stock debió bajar a 12, pero es {prod_mecedora.stock}"

        # 6. Intentar vender más de las existencias disponibles (ej: pedir 20 unidades cuando quedan 12)
        credito_in_insuficiente = CreditoCreate(
            cliente_id=cliente.id,
            vendedor_id=vendedor.id,
            estado=EstadoCredito.PENDIENTE,
            tipo_pago=TipoPago.MENSUAL,
            cuota_inicial=Decimal("0.00"),
            monto_financiado=Decimal("4000000.00"),
            numero_cuotas=4,
            valor_cuota=Decimal("1000000.00"),
            fecha_primera_cuota="2026-10-01",
            detalles=[
                CreditoDetalleCreate(
                    producto_id=prod_mecedora.id,
                    cantidad=20,
                    valor_unitario_acordado=Decimal("200000.00"),
                )
            ]
        )
        error_capturado = False
        try:
            await crud_credito.create_credito(db=session, credito_in=credito_in_insuficiente)
        except HTTPException as exc:
            error_capturado = True
            print(f"[TEST 5] Bloqueo correcto por stock insuficiente: HTTP {exc.status_code} - {exc.detail}")
            assert exc.status_code == 400
            assert "Stock insuficiente" in exc.detail
        assert error_capturado, "Debió rechazar la venta por stock insuficiente"

        # 7. Vender Cuadro (maneja_stock = False) con stock = 0
        # Total venta = 1 * 350,000 = 350,000. Cuota inicial: 50,000. Monto financiado: 300,000. 3 cuotas de 100,000.
        credito_cuadro = CreditoCreate(
            cliente_id=cliente.id,
            vendedor_id=vendedor.id,
            estado=EstadoCredito.PENDIENTE,
            tipo_pago=TipoPago.MENSUAL,
            cuota_inicial=Decimal("50000.00"),
            monto_financiado=Decimal("300000.00"),
            numero_cuotas=3,
            valor_cuota=Decimal("100000.00"),
            fecha_primera_cuota="2026-10-01",
            detalles=[
                CreditoDetalleCreate(
                    producto_id=prod_cuadro.id,
                    cantidad=2,
                    valor_unitario_acordado=Decimal("175000.00"),
                )
            ]
        )
        cred_cuadro_res = await crud_credito.create_credito(db=session, credito_in=credito_cuadro)
        await session.refresh(prod_cuadro)
        print(f"[TEST 6] Venta de cuadro por encargo procesada con éxito sin importar stock: Stock={prod_cuadro.stock}")
        assert prod_cuadro.stock == 0, "El stock de cuadro debe mantenerse inalterado en 0"

        # 8. Rechazar el crédito regular y verificar restitución de stock (de 12 debe volver a 15)
        credito_rechazado = await crud_credito.rechazar_credito(
            db=session,
            id_contrato=credito_res.id_contrato,
            supervisor_id=vendedor.id,
        )
        await session.refresh(prod_mecedora)
        print(f"[TEST 7] Rechazo de crédito pendiente: Stock repuesto a={prod_mecedora.stock}")
        assert prod_mecedora.stock == 15, f"El stock debió restaurarse a 15, pero es {prod_mecedora.stock}"

        # 9. Limpieza de datos de prueba
        await session.delete(credito_rechazado)
        await session.delete(cred_cuadro_res)
        await crud_producto.delete_producto(session, prod_mecedora)
        await crud_producto.delete_producto(session, prod_cuadro)
        await session.commit()
        print("[TEST 8] Limpieza de registros de prueba completada exitosamente.")

        print("\n=======================================================")
        print("  TODOS LOS TESTS DEL MOTOR DE INVENTARIO PASARON (8/8) ")
        print("=======================================================\n")

if __name__ == "__main__":
    asyncio.run(run_inventory_tests())
