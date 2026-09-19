import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio
from decimal import Decimal
from datetime import date
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.credito import Credito, EstadoCredito, TipoPago
from app.models.cliente import Cliente
from app.models.usuario import Usuario, RolUsuario
from app.models.producto import Producto
from app.schemas.credito import CreditoCreate, CreditoResponse, CreditoDetalleCreate
from app.crud import crud_credito

async def run_test():
    async with AsyncSessionLocal() as session:
        print("[TEST] Iniciando verificación de numero_contrato y ciudad_venta...")

        # 1. Obtener cliente, vendedor y producto existentes
        res_cli = await session.execute(select(Cliente).limit(1))
        cliente = res_cli.scalar_one_or_none()
        if not cliente:
            cliente = Cliente(
                cedula="999888777",
                nombres="Cliente Prueba Contrato",
                telefono="3001234567",
                direccion="Calle 1 # 2-3",
                barrio="Centro",
                ciudad="Montería",
            )
            session.add(cliente)
            await session.flush()

        res_vend = await session.execute(select(Usuario).where(Usuario.rol == RolUsuario.VENDEDOR).limit(1))
        vendedor = res_vend.scalar_one_or_none()
        if not vendedor:
            res_vend = await session.execute(select(Usuario).limit(1))
            vendedor = res_vend.scalar_one_or_none()

        res_prod = await session.execute(select(Producto).where(Producto.maneja_stock == False).limit(1))
        producto = res_prod.scalar_one_or_none()
        if not producto:
            res_prod = await session.execute(select(Producto).limit(1))
            producto = res_prod.scalar_one_or_none()

        # 2. Test A: Crear crédito con numero_contrato manual y ciudad_venta
        test_num_contrato = f"MANUAL-{date.today().year}-8899"
        test_ciudad_venta = "Cereté"
        
        # Limpiar si existía previamente
        res_old = await session.execute(select(Credito).where(Credito.numero_contrato == test_num_contrato))
        for c_old in res_old.scalars().all():
            await session.delete(c_old)
        await session.commit()

        cred_in_manual = CreditoCreate(
            cliente_id=cliente.id,
            vendedor_id=vendedor.id,
            numero_contrato=test_num_contrato,
            ciudad_venta=test_ciudad_venta,
            cuota_inicial=Decimal("0.00"),
            monto_financiado=Decimal("200000.00"),
            numero_cuotas=2,
            valor_cuota=Decimal("100000.00"),
            tipo_pago=TipoPago.MENSUAL,
            detalles=[
                CreditoDetalleCreate(
                    producto_id=producto.id,
                    cantidad=1,
                    valor_unitario_acordado=Decimal("200000.00")
                )
            ]
        )

        cred_manual = await crud_credito.create_credito(session, cred_in_manual)
        print(f"[TEST A - PASS] Crédito creado con número manual: {cred_manual.numero_contrato}, Ciudad: {cred_manual.ciudad_venta}")
        assert cred_manual.numero_contrato == test_num_contrato, "numero_contrato no coincide"
        assert cred_manual.ciudad_venta == test_ciudad_venta, "ciudad_venta no coincide"

        # Validar serialización en CreditoResponse
        resp_manual = CreditoResponse.model_validate(cred_manual)
        assert resp_manual.numero_contrato == test_num_contrato
        assert resp_manual.codigo_contrato == test_num_contrato
        assert resp_manual.ciudad_venta == test_ciudad_venta
        print(f"[TEST A - PASS] CreditoResponse serializado con codigo_contrato = '{resp_manual.codigo_contrato}'")

        # 3. Test B: Crear crédito SIN numero_contrato ni ciudad_venta (autogeneración estándar)
        cred_in_auto = CreditoCreate(
            cliente_id=cliente.id,
            vendedor_id=vendedor.id,
            numero_contrato=None,
            ciudad_venta=None,
            cuota_inicial=Decimal("0.00"),
            monto_financiado=Decimal("200000.00"),
            numero_cuotas=2,
            valor_cuota=Decimal("100000.00"),
            tipo_pago=TipoPago.MENSUAL,
            detalles=[
                CreditoDetalleCreate(
                    producto_id=producto.id,
                    cantidad=1,
                    valor_unitario_acordado=Decimal("200000.00")
                )
            ]
        )

        cred_auto = await crud_credito.create_credito(session, cred_in_auto)
        print(f"[TEST B - PASS] Crédito creado autogenerado: ID {cred_auto.id_contrato}, numero_contrato: {cred_auto.numero_contrato}")
        assert cred_auto.numero_contrato is None, "numero_contrato debería ser None"

        resp_auto = CreditoResponse.model_validate(cred_auto)
        expected_code = f"CTR-{str(cred_auto.id_contrato)[:8].upper()}"
        assert resp_auto.codigo_contrato == expected_code, f"Esperado {expected_code}, obtenido {resp_auto.codigo_contrato}"
        print(f"[TEST B - PASS] CreditoResponse autogenerado tiene codigo_contrato = '{resp_auto.codigo_contrato}'")

        # 4. Test C: Búsqueda por número de contrato manual mediante get_credito_por_id_o_hash
        cred_encontrado = await crud_credito.get_credito_por_id_o_hash(session, test_num_contrato)
        assert cred_encontrado is not None, "No se encontró el crédito por su número manual"
        assert cred_encontrado.id_contrato == cred_manual.id_contrato, "El ID de contrato encontrado no coincide"
        print(f"[TEST C - PASS] Búsqueda por número de contrato '{test_num_contrato}' exitosa -> ID {cred_encontrado.id_contrato}")

        # Limpiar registros de prueba
        await session.delete(cred_manual)
        await session.delete(cred_auto)
        await session.commit()
        print("[TEST] Limpieza de registros de prueba finalizada.")
        print("\n¡TODAS LAS PRUEBAS ESTRUCTURALES PASARON EXITOSAMENTE (3/3)!")

if __name__ == "__main__":
    asyncio.run(run_test())
