import requests
import json

BASE_URL = "http://127.0.0.1:8000"

def test_creditos_cuotas():
    # 0. Autenticar
    login_data = {
        "username": "3000000000",
        "password": "masterpassword123"
    }
    res_login = requests.post(f"{BASE_URL}/auth/login", data=login_data)
    assert res_login.status_code == 200, f"Error en login: {res_login.text}"
    token = res_login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    print("Autenticación exitosa con token Bearer.")

    # 1. Obtener cliente y usuarios
    res_clientes = requests.get(f"{BASE_URL}/clientes", headers=headers)
    assert res_clientes.status_code == 200, f"Error obteniendo clientes: {res_clientes.text}"
    clientes = res_clientes.json()
    if len(clientes) == 0:
        res_nuevo = requests.post(
            f"{BASE_URL}/clientes",
            json={
                "cedula": "1045882119",
                "nombres": "Carlos Gómez Mejia",
                "telefono": "3124567890",
                "direccion": "Carrera 14 # 28 - 45",
                "barrio": "Centro",
                "ciudad": "Montería"
            },
            headers=headers
        )
        assert res_nuevo.status_code in (200, 201), f"Error creando cliente: {res_nuevo.text}"
        cliente = res_nuevo.json()
    else:
        cliente = clientes[0]

    res_users = requests.get(f"{BASE_URL}/usuarios", headers=headers)
    assert res_users.status_code == 200, f"Error obteniendo usuarios: {res_users.text}"
    usuarios = res_users.json()
    vendedor = next((u for u in usuarios if u["rol"] == "vendedor"), usuarios[0])
    cobrador = next((u for u in usuarios if u["rol"] == "cobrador"), usuarios[0])
    supervisor = next((u for u in usuarios if u["rol"] in ("supervisor", "master")), usuarios[0])

    res_prods = requests.get(f"{BASE_URL}/productos", headers=headers)
    assert res_prods.status_code == 200, f"Error obteniendo productos: {res_prods.text}"
    prods = res_prods.json()
    if len(prods) == 0:
        res_nuevo_p = requests.post(
            f"{BASE_URL}/productos",
            json={
                "sku": "MEC-001",
                "nombre": "Mecedora Tradicional Momposina",
                "descripcion": "Estructura en madera de teca",
                "categoria": "mecedora",
                "precio_base": 420000,
                "es_precio_variable": False,
                "stock_actual": 10,
                "stock_minimo": 2
            },
            headers=headers
        )
        assert res_nuevo_p.status_code in (200, 201), f"Error creando producto: {res_nuevo_p.text}"
        prod = res_nuevo_p.json()
    else:
        prod = prods[0]
    precio_unitario = float(prod.get("precio_base", 420000)) or 420000.0

    plazos_a_probar = [9, 6, 4, 2]
    
    print(f"\nProbando originación con cliente: {cliente['nombres']} | Producto: {prod['nombre']} (${precio_unitario:.0f})...")

    for n_cuotas in plazos_a_probar:
        # Prueba 1: Sin cuota inicial
        total_articulos = precio_unitario
        cuota_inicial = 0.0
        monto_financiado = total_articulos - cuota_inicial
        valor_cuota = round(monto_financiado / n_cuotas)

        payload = {
            "cliente_id": cliente["id"],
            "vendedor_id": vendedor["id"],
            "supervisor_id": supervisor["id"],
            "cobrador_id": cobrador["id"],
            "tipo_pago": "mensual",
            "cuota_inicial": cuota_inicial,
            "monto_financiado": monto_financiado,
            "numero_cuotas": n_cuotas,
            "valor_cuota": valor_cuota,
            "fecha_primera_cuota": "2026-04-01",
            "saldo_pendiente": monto_financiado,
            "detalles": [
                {
                    "producto_id": prod["id"],
                    "cantidad": 1,
                    "valor_unitario_acordado": precio_unitario,
                }
            ],
        }

        res = requests.post(f"{BASE_URL}/creditos/", json=payload, headers=headers)
        print(f"Plazo {n_cuotas} cuotas (Inicial $0) -> Status: {res.status_code}")
        if res.status_code not in (200, 201):
            print(f"Error: {res.text}")
            raise Exception(f"Fallo para {n_cuotas} cuotas: {res.text}")
        credito_creado = res.json()
        print(f"  OK! ID Contrato: {credito_creado.get('id_contrato')}, Cuotas: {credito_creado.get('numero_cuotas')}, Valor Cuota: {credito_creado.get('valor_cuota')}")

        # Prueba 2: Con cuota inicial (ej. $100.000)
        cuota_inicial_2 = 100000.0
        monto_financiado_2 = total_articulos - cuota_inicial_2
        valor_cuota_2 = round(monto_financiado_2 / n_cuotas)

        payload_2 = {
            "cliente_id": cliente["id"],
            "vendedor_id": vendedor["id"],
            "supervisor_id": supervisor["id"],
            "cobrador_id": cobrador["id"],
            "tipo_pago": "quincenal",
            "cuota_inicial": cuota_inicial_2,
            "monto_financiado": monto_financiado_2,
            "numero_cuotas": n_cuotas,
            "valor_cuota": valor_cuota_2,
            "fecha_primera_cuota": "2026-04-15",
            "saldo_pendiente": monto_financiado_2,
            "detalles": [
                {
                    "producto_id": prod["id"],
                    "cantidad": 1,
                    "valor_unitario_acordado": precio_unitario,
                }
            ],
        }

        res_2 = requests.post(f"{BASE_URL}/creditos/", json=payload_2, headers=headers)
        print(f"Plazo {n_cuotas} cuotas (Inicial $100.000) -> Status: {res_2.status_code}")
        if res_2.status_code not in (200, 201):
            print(f"Error: {res_2.text}")
            raise Exception(f"Fallo para {n_cuotas} cuotas con inicial: {res_2.text}")
        credito_creado_2 = res_2.json()
        print(f"  OK! ID Contrato: {credito_creado_2.get('id_contrato')}, Cuotas: {credito_creado_2.get('numero_cuotas')}, Valor Cuota: {credito_creado_2.get('valor_cuota')}")

    print("\nTODAS LAS PRUEBAS DE PLAZOS (9, 6, 4, 2) PASARON EXITOSAMENTE!")

if __name__ == "__main__":
    test_creditos_cuotas()
