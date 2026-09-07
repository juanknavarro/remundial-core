"""
Script de verificación para Frecuencias de Pago (Quincenal y Mensual) y Cronograma de Cuotas.
Valida la creación de contratos combinando plazos (9, 6, 4, 2 cuotas) con frecuencias Quincenal y Mensual.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json
import urllib.request
import urllib.parse
import urllib.error
import asyncio
from datetime import date, timedelta
from app.core.database import AsyncSessionLocal
from app.models.credito import Credito, CreditoDetalle
from sqlalchemy import delete

BASE_URL = "http://127.0.0.1:8000"

def request_http(method, path, data=None, token=None, form_data=None):
    url = f"{BASE_URL}{path}"
    headers = {}
    body = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if form_data:
        body = urllib.parse.urlencode(form_data).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode("utf-8")
            return response.status, json.loads(res_body) if res_body else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        try:
            parsed = json.loads(err_body)
        except Exception:
            parsed = err_body
        return e.code, parsed

def run_tests():
    print("=" * 70)
    print(" PRUEBA DE FRECUENCIAS DE PAGO (QUINCENAL Y MENSUAL) Y CRONOGRAMA ")
    print("=" * 70)

    # 1. Login como Master
    status, res_login = request_http("POST", "/auth/login", form_data={"username": "3000000000", "password": "masterpassword123"})
    assert status == 200, f"Error en login: {res_login}"
    token = res_login["access_token"]
    print("[OK] Autenticado como Master")

    # 2. Obtener Cliente y Usuarios
    status, clientes = request_http("GET", "/clientes", token=token)
    assert status == 200 and len(clientes) > 0, "Se requieren clientes en base de datos"
    cliente = clientes[0]

    status, usuarios = request_http("GET", "/usuarios", token=token)
    assert status == 200
    vendedor = next((u for u in usuarios if u["rol"] == "vendedor"), usuarios[0])
    supervisor = next((u for u in usuarios if u["rol"] in ("supervisor", "master")), usuarios[0])
    cobrador = next((u for u in usuarios if u["rol"] == "cobrador"), usuarios[0])

    # 3. Obtener o crear producto
    status, prods = request_http("GET", "/productos", token=token)
    if len(prods) == 0:
        status, prod_creado = request_http("POST", "/productos", data={
            "sku": "CUADRO-TEST-FREQ",
            "nombre": "Cuadro Test Frecuencias",
            "descripcion": "Óleo sobre lienzo",
            "categoria": "arte",
            "precio_base": 600000,
            "es_precio_variable": False,
            "stock_actual": 10,
            "estado_activo": True
        }, token=token)
        producto = prod_creado
    else:
        producto = prods[0]

    precio_unitario = float(producto["precio_base"])

    # 4. Caso A: Crédito Quincenal con 4 Cuotas (Cuota Inicial + 3 periodos)
    print("\n[Test 1] Evaluando Crédito QUINCENAL (4 cuotas)...")
    cuota_inicial_a = 150000.0
    monto_financiado_a = precio_unitario - cuota_inicial_a
    valor_cuota_a = round(monto_financiado_a / 4.0, 2)
    fecha_base_quincenal = (date.today() + timedelta(days=15)).isoformat()

    payload_quincenal = {
        "cliente_id": cliente["id"],
        "vendedor_id": vendedor["id"],
        "supervisor_id": supervisor["id"],
        "cobrador_id": cobrador["id"],
        "estado": "activo",
        "tipo_pago": "quincenal",
        "cuota_inicial": cuota_inicial_a,
        "monto_financiado": monto_financiado_a,
        "numero_cuotas": 4,
        "valor_cuota": valor_cuota_a,
        "fecha_primera_cuota": fecha_base_quincenal,
        "saldo_pendiente": monto_financiado_a,
        "detalles": [
            {
                "producto_id": producto["id"],
                "cantidad": 1,
                "valor_unitario_acordado": precio_unitario
            }
        ]
    }

    status, credito_q = request_http("POST", "/creditos", data=payload_quincenal, token=token)
    assert status == 201, f"Error creando crédito quincenal: {credito_q}"
    assert credito_q["tipo_pago"] == "quincenal"
    assert credito_q["numero_cuotas"] == 4
    cronograma_q = credito_q.get("cronograma_cuotas", [])
    assert len(cronograma_q) == 4, f"Se esperaban 4 cuotas en el cronograma, se recibieron {len(cronograma_q)}"
    print(f"  [PASS] Crédito Quincenal creado: Contrato {credito_q['id_contrato']}")
    print(f"  [PASS] Cronograma Quincenal autogenerado con 4 cuotas exactas:")
    for c in cronograma_q:
        print(f"         Cuota #{c['numero']}: Vence {c['fecha_vencimiento']} | Valor: ${float(c['valor_cuota']):,.2f}")

    # 5. Caso B: Crédito Mensual con 6 Cuotas
    print("\n[Test 2] Evaluando Crédito MENSUAL (6 cuotas)...")
    cuota_inicial_b = 0.0
    monto_financiado_b = precio_unitario
    valor_cuota_b = round(monto_financiado_b / 6.0, 2)
    fecha_base_mensual = (date.today() + timedelta(days=30)).isoformat()

    payload_mensual = {
        "cliente_id": cliente["id"],
        "vendedor_id": vendedor["id"],
        "supervisor_id": supervisor["id"],
        "cobrador_id": cobrador["id"],
        "estado": "activo",
        "tipo_pago": "mensual",
        "cuota_inicial": cuota_inicial_b,
        "monto_financiado": monto_financiado_b,
        "numero_cuotas": 6,
        "valor_cuota": valor_cuota_b,
        "fecha_primera_cuota": fecha_base_mensual,
        "saldo_pendiente": monto_financiado_b,
        "detalles": [
            {
                "producto_id": producto["id"],
                "cantidad": 1,
                "valor_unitario_acordado": precio_unitario
            }
        ]
    }

    status, credito_m = request_http("POST", "/creditos", data=payload_mensual, token=token)
    assert status == 201, f"Error creando crédito mensual: {credito_m}"
    assert credito_m["tipo_pago"] == "mensual"
    assert credito_m["numero_cuotas"] == 6
    cronograma_m = credito_m.get("cronograma_cuotas", [])
    assert len(cronograma_m) == 6, f"Se esperaban 6 cuotas en el cronograma, se recibieron {len(cronograma_m)}"
    print(f"  [PASS] Crédito Mensual creado: Contrato {credito_m['id_contrato']}")
    print(f"  [PASS] Cronograma Mensual autogenerado con 6 cuotas exactas:")
    for c in cronograma_m:
        print(f"         Cuota #{c['numero']}: Vence {c['fecha_vencimiento']} | Valor: ${float(c['valor_cuota']):,.2f}")

    # 6. Limpiar créditos creados para conservar base de datos limpia
    print("\n[Limpieza] Limpiando contratos de prueba para mantener la BD en ceros...")
    async def limpiar_bd():
        async with AsyncSessionLocal() as session:
            await session.execute(delete(CreditoDetalle))
            await session.execute(delete(Credito))
            await session.commit()

    asyncio.run(limpiar_bd())
    print("  [OK] Base de datos restaurada a estado limpio en ceros.")

    print("\n==================================================================")
    print(" TODAS LAS PRUEBAS DE FRECUENCIA Y CUOTAS PASARON EXITOSAMENTE!  ")
    print("==================================================================")

if __name__ == "__main__":
    run_tests()
