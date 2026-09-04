import json
import urllib.request
import urllib.parse
import urllib.error

BASE_URL = "http://127.0.0.1:8000"

def request_json(method, path, data=None, token=None, form_data=None):
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
        with urllib.request.urlopen(req) as resp:
            status = resp.status
            content = resp.read().decode("utf-8")
            return status, json.loads(content) if content else {}
    except urllib.error.HTTPError as e:
        content = e.read().decode("utf-8")
        try:
            parsed = json.loads(content)
        except Exception:
            parsed = {"raw": content}
        return e.code, parsed

def run():
    print("1. Login Master...")
    code, res_login = request_json("POST", "/auth/login", form_data={"username": "3000000000", "password": "masterpassword123"})
    assert code == 200, f"Login failed: {res_login}"
    token = res_login["access_token"]
    print(" Login exitoso.")

    print("2. Listar productos...")
    code, prods = request_json("GET", "/productos", token=token)
    assert code == 200
    print(f" Total productos en catálogo: {len(prods)}")

    print("3. Crear producto de prueba sin uso...")
    new_prod_data = {
        "sku": "HTTP-TEST-01",
        "nombre": "Mecedora de Prueba HTTP",
        "precio_base": 320000,
        "es_precio_variable": False,
        "estado_activo": True
    }
    code, created_prod = request_json("POST", "/productos", data=new_prod_data, token=token)
    assert code == 201, f"Creación falló: {created_prod}"
    prod_clean_id = created_prod["id"]
    print(f" Producto creado: {prod_clean_id}")

    print("4. Eliminar físicamente producto sin uso...")
    code, del_res = request_json("DELETE", f"/productos/{prod_clean_id}", token=token)
    print(f" Status: {code}, Respuesta: {del_res}")
    assert code == 200, f"Se esperaba 200 pero fue {code}"

    print("5. Intentar eliminar producto vinculado a créditos...")
    prod_with_credit = next((p for p in prods if p["sku"] in ["ART-101", "MEC-LUN-01", "ESC-202"]), None)
    assert prod_with_credit is not None
    prod_credit_id = prod_with_credit["id"]
    print(f" Probando eliminación de: {prod_with_credit['nombre']} ({prod_credit_id})")

    code, del_credit_res = request_json("DELETE", f"/productos/{prod_credit_id}", token=token)
    print(f" Status: {code}, Detalle: {del_credit_res.get('detail')}")
    assert code == 400, f"Se esperaba rechazo HTTP 400 pero se obtuvo {code}"
    print(" RECHAZO HTTP 400 VALIDADO: La integridad financiera está protegida.")

    print("6. Desactivar lógicamente producto en uso...")
    code, deact_res = request_json("DELETE", f"/productos/{prod_credit_id}?desactivar=true", token=token)
    print(f" Status: {code}, Mensaje: {deact_res.get('message')}")
    assert code == 200

    # Reactivar
    code, _ = request_json("PUT", f"/productos/{prod_credit_id}", data={"estado_activo": True}, token=token)
    assert code == 200

    print("7. Consultar endpoint de abonos y conciliación...")
    code, abonos_res = request_json("GET", "/abonos", token=token)
    print(f" GET /abonos status: {code}, total abonos: {len(abonos_res)}")
    assert code == 200

    print("\n TODOS LOS TESTS HTTP PASARON 100% CON ÉXITO.")

if __name__ == "__main__":
    run()
