import asyncio
import os
import sys
import urllib.request
import urllib.parse
import urllib.error
import json
from decimal import Decimal
from datetime import date

# Agregar backend al PYTHONPATH
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from app.core.database import AsyncSessionLocal
from app.core.security import create_access_token
from app.models.usuario import Usuario, RolUsuario
from app.models.cliente import Cliente, ReferenciaCliente, TipoReferenciaEnum
from app.models.producto import Producto
from app.models.credito import Credito, CreditoDetalle, EstadoCredito, TipoPago
from app.crud import crud_credito
from app.services.pdf_recibo import generar_pdf_recibo_venta
from sqlalchemy import select

BASE_URL = "http://127.0.0.1:8000"


def get_token(username="admin", password="password123"):
    data = urllib.parse.urlencode({'username': username, 'password': password}).encode('utf-8')
    req = urllib.request.Request(
        f"{BASE_URL}/auth/login",
        data=data,
        headers={'Content-Type': 'application/x-www-form-urlencoded'}
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))['access_token']


async def run_test():
    print("\n" + "=" * 70)
    print("  VERIFICACIÓN DEL RECIBO DIGITAL DE VENTA (PDF) - REMUNDIAL ARTE'S")
    print("=" * 70)

    # 1. Obtener usuario y crédito para prueba
    async with AsyncSessionLocal() as session:
        res_usr = await session.execute(select(Usuario).limit(1))
        usuario = res_usr.scalar_one()

        res_cred = await session.execute(
            select(Credito)
            .where(Credito.estado != EstadoCredito.TERMINADO)
            .limit(1)
        )
        credito_existente = res_cred.scalar_one_or_none()
        if not credito_existente:
            res_cred_any = await session.execute(select(Credito).limit(1))
            credito_existente = res_cred_any.scalar_one_or_none()

        target_id = None
        if credito_existente:
            target_id = credito_existente.id_contrato
            print(f"[OK] Usando contrato existente: CTR-{str(target_id)[:8].upper()} (ID: {target_id})")
        else:
            print("-> Creando venta de prueba con Cuadro por Encargo y Muebles...")
            cliente = Cliente(
                cedula="1067123999",
                nombres="María Camila Restrepo",
                telefono="3125559876",
                direccion="Calle 44 # 12-30",
                barrio="La Castellana",
                ciudad="Montería",
            )
            session.add(cliente)
            await session.flush()

            ref = ReferenciaCliente(
                cliente_id=cliente.id,
                tipo=TipoReferenciaEnum.CODEUDOR,
                nombre="Andrés Felipe Restrepo",
                cedula="1067890123",
                telefono="3009876543",
                direccion="Calle 44 # 12-30",
            )
            session.add(ref)

            prod_cuadro = Producto(
                sku="ART-ENC-TEST",
                nombre="Cuadro al Óleo Atardecer Sinú (Hecho por Encargo)",
                precio_base=Decimal("450000.00"),
                maneja_stock=False,
                es_precio_variable=True,
                stock=0,
            )
            prod_mueble = Producto(
                sku="MUE-MEC-TEST",
                nombre="Mecedora Tradicional Zenú en Roble",
                precio_base=Decimal("800000.00"),
                maneja_stock=True,
                stock=5,
            )
            session.add_all([prod_cuadro, prod_mueble])
            await session.flush()

            nuevo_cred = Credito(
                cliente_id=cliente.id,
                vendedor_id=usuario.id,
                estado=EstadoCredito.ACTIVO,
                tipo_pago=TipoPago.MENSUAL,
                cuota_inicial=Decimal("250000.00"),
                monto_financiado=Decimal("1000000.00"),
                numero_cuotas=4,
                valor_cuota=Decimal("250000.00"),
                fecha_primera_cuota=date(2026, 10, 31),
                saldo_pendiente=Decimal("1000000.00"),
            )
            session.add(nuevo_cred)
            await session.flush()

            det1 = CreditoDetalle(
                credito_id=nuevo_cred.id_contrato,
                producto_id=prod_cuadro.id,
                cantidad=1,
                valor_unitario_acordado=Decimal("450000.00"),
            )
            det2 = CreditoDetalle(
                credito_id=nuevo_cred.id_contrato,
                producto_id=prod_mueble.id,
                cantidad=1,
                valor_unitario_acordado=Decimal("800000.00"),
            )
            session.add_all([det1, det2])
            await session.commit()
            target_id = nuevo_cred.id_contrato
            print(f"✓ Contrato de prueba creado con éxito: CTR-{str(target_id)[:8].upper()}")

        # 2. Prueba directa del generador de PDF con los datos ORM
        credito_cargado = await crud_credito.get_credito(session, target_id)
        pdf_bytes_direct = generar_pdf_recibo_venta(credito_cargado)
        assert len(pdf_bytes_direct) > 0
        assert pdf_bytes_direct.startswith(b"%PDF-")
        print(f"✓ Generación directa exitosa: {len(pdf_bytes_direct)} bytes generados.")

        # Generar token JWT válido para la prueba HTTP
        token = create_access_token(data={"sub": str(usuario.id), "rol": usuario.rol.value})
        print(f"[OK] Token JWT generado para usuario: {usuario.nombre} ({usuario.rol.value})")

    # 3. Pruebas HTTP contra el servidor FastAPI en vivo (puerto 8000)

    # TEST A: Vía Header Authorization: Bearer
    print("\n[TEST A] Solicitando PDF vía Header Authorization: Bearer ...")
    req_a = urllib.request.Request(
        f"{BASE_URL}/creditos/{target_id}/recibo-pdf",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req_a) as resp_a:
        assert resp_a.status == 200, f"Error {resp_a.status}"
        c_type = resp_a.headers.get("content-type")
        assert "application/pdf" in c_type, f"Tipo incorrecto: {c_type}"
        data_a = resp_a.read()
        assert data_a.startswith(b"%PDF-"), "El archivo no inicia con la firma %PDF-"
        print(f"✓ TEST A exitoso! {len(data_a)} bytes recibidos (Content-Type: {c_type})")

    # TEST B: Vía Query Param ?token= (Enlace directo para apertura en pestaña de navegador)
    print("\n[TEST B] Solicitando PDF vía Query Param ?token= ...")
    req_b = urllib.request.Request(
        f"{BASE_URL}/creditos/{target_id}/recibo-pdf?token={token}"
    )
    with urllib.request.urlopen(req_b) as resp_b:
        assert resp_b.status == 200, f"Error {resp_b.status}"
        data_b = resp_b.read()
        assert data_b.startswith(b"%PDF-")
        print(f"✓ TEST B exitoso! {len(data_b)} bytes recibidos vía enlace directo.")

    # TEST C: Sin autenticación (debe retornar HTTP 401)
    print("\n[TEST C] Verificando protección de seguridad (Sin credenciales)...")
    req_c = urllib.request.Request(f"{BASE_URL}/creditos/{target_id}/recibo-pdf")
    try:
        urllib.request.urlopen(req_c)
        assert False, "Se esperaba HTTP 401 Unauthorized"
    except urllib.error.HTTPError as e:
        assert e.code == 401, f"Se esperaba 401 pero se obtuvo {e.code}"
        print("✓ TEST C exitoso! Rechazado con HTTP 401 Unauthorized.")

    # Guardar archivo generado en disco
    output_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "recibo_muestra_remundial.pdf"))
    with open(output_path, "wb") as f:
        f.write(data_a)
    print(f"\n✓ Recibo PDF de muestra guardado en disco: {output_path}")

    print("\n" + "=" * 70)
    print("  TODAS LAS VERIFICACIONES DEL RECIBO DIGITAL PDF FUERON EXITOSAS (3/3)")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    asyncio.run(run_test())
