import sys
import os
from pathlib import Path

# Add backend directory to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from decimal import Decimal
from datetime import date

from app.schemas.credito import generar_cronograma_con_arrastre, TipoPago

def test_abono_parcial_y_arrastre():
    print("=== TEST 1: Abono Parcial de $80.000 en cuota de $125.000 ===")
    # Crédito de 500.000 a 4 cuotas de 125.000
    monto_financiado = Decimal("500000.00")
    valor_cuota = Decimal("125000.00")
    num_cuotas = 4
    fecha_inicio = date(2026, 10, 31)

    # Cliente abona $80.000 -> saldo pendiente = 420.000
    saldo_pendiente = Decimal("420000.00")
    res = generar_cronograma_con_arrastre(
        fecha_primera_cuota=fecha_inicio,
        numero_cuotas=num_cuotas,
        monto_financiado=monto_financiado,
        saldo_pendiente=saldo_pendiente,
        valor_cuota_base=valor_cuota,
        tipo_pago=TipoPago.MENSUAL,
        hoy=date(2026, 10, 15),
    )

    cron = res["cronograma"]
    assert len(cron) == 4
    
    c1 = cron[0]
    print(f"C1: exigible={c1.valor_exigible}, pagado={c1.valor_pagado}, saldo={c1.saldo_cuota}, arrastre={c1.monto_arrastrado}, pagada={c1.pagada}, parcial={c1.es_parcial}, estado={c1.estado}")
    assert c1.valor_exigible == Decimal("125000.00")
    assert c1.valor_pagado == Decimal("80000.00")
    assert c1.saldo_cuota == Decimal("45000.00")
    assert c1.monto_arrastrado == Decimal("0.00")
    assert c1.pagada is False
    assert c1.es_parcial is True
    assert c1.estado == "parcial"

    c2 = cron[1]
    print(f"C2: base={c2.valor_base}, arrastre={c2.monto_arrastrado}, exigible={c2.valor_exigible}, pagado={c2.valor_pagado}, saldo={c2.saldo_cuota}")
    assert c2.valor_base == Decimal("125000.00")
    assert c2.monto_arrastrado == Decimal("45000.00")
    assert c2.valor_exigible == Decimal("170000.00")
    assert c2.valor_pagado == Decimal("0.00")
    assert c2.saldo_cuota == Decimal("170000.00")
    assert c2.pagada is False
    assert c2.es_parcial is False

    c3 = cron[2]
    print(f"C3: exigible={c3.valor_exigible}, arrastre={c3.monto_arrastrado}")
    assert c3.valor_exigible == Decimal("125000.00")
    assert c3.monto_arrastrado == Decimal("0.00")

    print("=== TEST 2: Abono subsiguiente de $45.000 salda Cuota 1 y limpia el arrastre de Cuota 2 ===")
    saldo_pendiente = Decimal("375000.00") # 500.000 - 125.000
    res2 = generar_cronograma_con_arrastre(
        fecha_primera_cuota=fecha_inicio,
        numero_cuotas=num_cuotas,
        monto_financiado=monto_financiado,
        saldo_pendiente=saldo_pendiente,
        valor_cuota_base=valor_cuota,
        tipo_pago=TipoPago.MENSUAL,
        hoy=date(2026, 10, 15),
    )
    cron2 = res2["cronograma"]
    c1_2 = cron2[0]
    c2_2 = cron2[1]
    print(f"C1: pagado={c1_2.valor_pagado}, pagada={c1_2.pagada}, parcial={c1_2.es_parcial}, estado={c1_2.estado}")
    assert c1_2.pagada is True
    assert c1_2.es_parcial is False
    assert c1_2.valor_pagado == Decimal("125000.00")
    assert c1_2.saldo_cuota == Decimal("0.00")
    print(f"C2: arrastre={c2_2.monto_arrastrado}, exigible={c2_2.valor_exigible}")
    assert c2_2.monto_arrastrado == Decimal("0.00")
    assert c2_2.valor_exigible == Decimal("125000.00")

    print("=== TEST 3: Pago en Cuota 2 con nuevo abono parcial ($100.000 en C2) ===")
    # Amortizado total = 125.000 (C1) + 100.000 (C2) = 225.000 -> saldo pendiente = 275.000
    saldo_pendiente = Decimal("275000.00")
    res3 = generar_cronograma_con_arrastre(
        fecha_primera_cuota=fecha_inicio,
        numero_cuotas=num_cuotas,
        monto_financiado=monto_financiado,
        saldo_pendiente=saldo_pendiente,
        valor_cuota_base=valor_cuota,
        tipo_pago=TipoPago.MENSUAL,
        hoy=date(2026, 10, 15),
    )
    cron3 = res3["cronograma"]
    assert cron3[0].pagada is True
    assert cron3[1].es_parcial is True
    assert cron3[1].valor_pagado == Decimal("100000.00")
    assert cron3[1].saldo_cuota == Decimal("25000.00")
    # Cuota 3 debe tener $25.000 de arrastre -> exigible = $150.000
    assert cron3[2].monto_arrastrado == Decimal("25000.00")
    assert cron3[2].valor_exigible == Decimal("150000.00")
    print(f"C2 parcial: pagado={cron3[1].valor_pagado}, saldo={cron3[1].saldo_cuota}")
    print(f"C3 exigible: base={cron3[2].valor_base}, arrastre={cron3[2].monto_arrastrado}, total={cron3[2].valor_exigible}")

    print("\nTODOS LOS TESTS UNITARIOS DE ABONOS PARCIALES Y ARRASTRE DE SALDO PASARON EXITOSAMENTE!")

def test_api_abono_parcial_y_arrastre():
    import urllib.request
    import urllib.parse
    import json

    base_url = "http://127.0.0.1:8000"
    print("\n=== TEST E2E API: FLUJO COMPLETO DE ABONO PARCIAL Y ARRASTRE ===")
    
    def api_req(method, path, data=None, token=None):
        url = f"{base_url}{path}"
        headers = {}
        body = None
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if data is not None:
            if method == "POST" and path == "/auth/login":
                body = urllib.parse.urlencode(data).encode("utf-8")
                headers["Content-Type"] = "application/x-www-form-urlencoded"
            else:
                body = json.dumps(data).encode("utf-8")
                headers["Content-Type"] = "application/json"
        
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                resp_bytes = resp.read()
                return resp.status, json.loads(resp_bytes.decode("utf-8")) if resp_bytes else {}
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            print(f"HTTPError {e.code} on {method} {path}: {err_body}")
            raise

    # 1. Login
    code, login_data = api_req("POST", "/auth/login", data={"username": "3000000000", "password": "masterpassword123"})
    assert code == 200
    token = login_data["access_token"]
    print("1. Autenticación exitosa como Master/Supervisor.")

    # 2. Obtener datos base
    code, clientes = api_req("GET", "/clientes", token=token)
    assert code == 200
    if not clientes:
        code, cliente = api_req(
            "POST",
            "/clientes",
            data={
                "cedula": "1045882119",
                "nombres": "Cliente Test Abono Parcial",
                "telefono": "3124567890",
                "direccion": "Carrera 14 # 28 - 45",
                "barrio": "Centro",
                "ciudad": "Montería"
            },
            token=token
        )
    else:
        cliente = clientes[0]

    code, usuarios = api_req("GET", "/usuarios", token=token)
    vendedor = next((u for u in usuarios if u["rol"] == "vendedor"), usuarios[0])
    cobrador = next((u for u in usuarios if u["rol"] == "cobrador"), usuarios[0])
    supervisor = next((u for u in usuarios if u["rol"] in ("supervisor", "master")), usuarios[0])

    code, prods = api_req("GET", "/productos", token=token)
    if not prods:
        code, prod = api_req(
            "POST",
            "/productos",
            data={
                "sku": "TEST-PARC-01",
                "nombre": "Mecedora Test Parcial",
                "descripcion": "Estructura test",
                "categoria": "mecedora",
                "precio_base": 500000,
                "stock_actual": 50,
                "stock_minimo": 1,
            },
            token=token
        )
    else:
        prod = prods[0]

    # 3. Crear Crédito de 4 cuotas de $125.000 ($500.000 financiado)
    monto_fin = 500000.0
    n_cuotas = 4
    val_c = 125000.0
    credito_payload = {
        "cliente_id": cliente["id"],
        "vendedor_id": vendedor["id"],
        "supervisor_id": supervisor["id"],
        "cobrador_id": cobrador["id"],
        "tipo_pago": "mensual",
        "cuota_inicial": 0.0,
        "monto_financiado": monto_fin,
        "numero_cuotas": n_cuotas,
        "valor_cuota": val_c,
        "fecha_primera_cuota": "2026-10-31",
        "saldo_pendiente": monto_fin,
        "detalles": [
            {
                "producto_id": prod["id"],
                "cantidad": 1,
                "valor_unitario_acordado": monto_fin,
            }
        ],
    }
    code, credito = api_req("POST", "/creditos", data=credito_payload, token=token)
    assert code in (200, 201)
    credito_id = credito.get("id_contrato") or credito.get("id")
    print(f"2. Crédito de prueba creado ID: {credito_id}, Cuotas: 4 x ${val_c:,.0f}")

    # Si el crédito está pendiente, aprobarlo
    if credito.get("estado") == "pendiente":
        code, aprob = api_req(
            "POST",
            f"/creditos/{credito_id}/aprobar",
            data={"cobrador_id": cobrador["id"]},
            token=token
        )
        assert code in (200, 201)
        print("   Crédito aprobado formalmente.")

    # 4. Registrar Abono Parcial de $80.000 (menor a la cuota de $125.000)
    abono_payload = {
        "credito_id": credito_id,
        "cobrador_id": cobrador["id"],
        "valor_abonado": 80000.0,
        "numero_cuota": 1,
        "metodo_pago": "efectivo",
        "coordenadas_gps_cobro": {"latitud": 8.756412, "longitud": -75.884129},
        "notas": "Test automatizado: abono parcial de $80.000",
    }
    code, abono_data = api_req("POST", "/abonos", data=abono_payload, token=token)
    assert code in (200, 201)
    print("3. Respuesta del endpoint /abonos (Abono Parcial de $80.000):")
    print(f"   - es_abono_parcial: {abono_data.get('es_abono_parcial')}")
    print(f"   - diferencia_arrastrada: {abono_data.get('diferencia_arrastrada')}")
    print(f"   - cuota_afectada_numero: {abono_data.get('cuota_afectada_numero')}")
    print(f"   - valor_cuota_siguiente: {abono_data.get('valor_cuota_siguiente')}")
    print(f"   - saldo_restante_credito: {abono_data.get('saldo_restante_credito')}")

    assert abono_data.get("es_abono_parcial") is True, "Debe marcarse como abono parcial"
    assert float(abono_data.get("diferencia_arrastrada", 0)) == 45000.0, "La diferencia arrastrada debe ser $45.000"
    assert int(abono_data.get("cuota_afectada_numero", 0)) == 1, "La cuota afectada debe ser 1"
    assert float(abono_data.get("valor_cuota_siguiente", 0)) == 170000.0, "La cuota siguiente debe ser $170.000 ($125k + $45k)"
    assert float(abono_data.get("saldo_restante_credito", 0)) == 420000.0, "El saldo restante total debe ser $420.000"

    # 5. Consultar el crédito por GET /creditos/{id}
    code, cred_det = api_req("GET", f"/creditos/{credito_id}", token=token)
    assert code == 200
    cron = cred_det.get("cronograma_cuotas", [])
    print(f"4. Cronograma retornado por GET /creditos/{credito_id}:")
    c1 = cron[0]
    c2 = cron[1]
    print(f"   - C1: estado={c1.get('estado')}, pagado={c1.get('valor_pagado')}, saldo={c1.get('saldo_cuota')}, arrastrado={c1.get('monto_arrastrado')}")
    print(f"   - C2: exigible={c2.get('valor_exigible')}, base={c2.get('valor_base')}, arrastrado={c2.get('monto_arrastrado')}")
    assert c1.get("estado") == "parcial"
    assert float(c1.get("valor_pagado", 0)) == 80000.0
    assert float(c1.get("saldo_cuota", 0)) == 45000.0
    assert float(c2.get("monto_arrastrado", 0)) == 45000.0
    assert float(c2.get("valor_exigible", 0)) == 170000.0

    # 6. Consultar Reporte de Cartera /reportes/cartera
    code, rep_data = api_req("GET", "/reportes/cartera?periodo_preset=todos", token=token)
    assert code == 200
    item_rep = next((item for item in rep_data.get("creditos", []) if item.get("id_contrato") == str(credito_id)), None)
    assert item_rep is not None, "El contrato debe aparecer en el reporte de cartera"
    cron_rep = item_rep.get("cronograma", [])
    assert cron_rep[0].get("estado") == "parcial"
    assert float(cron_rep[1].get("monto_arrastrado", 0)) == 45000.0
    assert float(cron_rep[1].get("valor_exigible", 0)) == 170000.0
    print("5. Reporte de cartera verificado con cronograma y arrastre exactos.")

    # 7. Completar la cuota 1 abonando los $45.000 restantes
    abono2_payload = {
        "credito_id": credito_id,
        "cobrador_id": cobrador["id"],
        "valor_abonado": 45000.0,
        "numero_cuota": 1,
        "metodo_pago": "efectivo",
        "coordenadas_gps_cobro": {"latitud": 8.756412, "longitud": -75.884129},
        "notas": "Completando cuota 1 con saldo insoluto",
    }
    code, abono2_data = api_req("POST", "/abonos", data=abono2_payload, token=token)
    assert code in (200, 201)
    print("6. Respuesta al abonar los $45.000 restantes:")
    print(f"   - es_abono_parcial: {abono2_data.get('es_abono_parcial')}")
    print(f"   - diferencia_arrastrada: {abono2_data.get('diferencia_arrastrada')}")
    assert abono2_data.get("es_abono_parcial") is False
    assert float(abono2_data.get("diferencia_arrastrada", 0)) == 0.0

    # 8. Verificar que Cuota 1 quedó pagada y Cuota 2 volvió a $125.000 sin arrastre
    code, cred_det2 = api_req("GET", f"/creditos/{credito_id}", token=token)
    assert code == 200
    cron2 = cred_det2.get("cronograma_cuotas", [])
    c1_final = cron2[0]
    c2_final = cron2[1]
    print(f"7. Estado tras completar Cuota 1:")
    print(f"   - C1: pagada={c1_final.get('pagada')}, estado={c1_final.get('estado')}, valor_pagado={c1_final.get('valor_pagado')}")
    print(f"   - C2: arrastrado={c2_final.get('monto_arrastrado')}, exigible={c2_final.get('valor_exigible')}")
    assert c1_final.get("pagada") is True
    assert c1_final.get("estado") == "pagada"
    assert float(c1_final.get("valor_pagado", 0)) == 125000.0
    assert float(c2_final.get("monto_arrastrado", 0)) == 0.0
    assert float(c2_final.get("valor_exigible", 0)) == 125000.0

    print("\nTODAS LAS PRUEBAS DE LA API DE ABONOS PARCIALES Y ARRASTRE FUERON SUPERADAS CON ÉXITO!")

if __name__ == "__main__":
    test_abono_parcial_y_arrastre()
    test_api_abono_parcial_y_arrastre()

