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

def run_tests():
    print("==================================================================")
    print("       SUITE DE PRUEBAS AUTOMATIZADAS: INVENTARIO & CONCILIACIÓN   ")
    print("==================================================================")

    # 1. Login Master
    print("\n[1/6] Autenticando Superusuario Master...")
    status, res_login = request_json("POST", "/auth/login", form_data={"username": "3000000000", "password": "masterpassword123"})
    assert status == 200, f"Error en login: {res_login}"
    token = res_login["access_token"]
    print(f" Token JWT obtenido con éxito.")

    # 2. Listar productos y verificar estado_activo
    print("\n[2/6] Verificando listado de productos y campo 'estado_activo'...")
    status, prods = request_json("GET", "/productos", token=token)
    assert status == 200
    assert len(prods) > 0
    print(f" {len(prods)} productos cargados. Verificando campos:")
    for p in prods[:3]:
        assert "estado_activo" in p, f"Falta 'estado_activo' en {p}"
        print(f"   - {p['sku']} | {p['nombre']} | Activo: {p['estado_activo']}")

    # 3. Validar eliminación física en producto limpio (sin uso)
    print("\n[3/6] Creando producto sin créditos para probar eliminación física...")
    nuevo = {
        "sku": "PROD-DEL-VALID",
        "nombre": "Mecedora Especial de Prueba de Borrado",
        "precio_base": 280000,
        "es_precio_variable": False,
        "estado_activo": True
    }
    status, prod_nuevo = request_json("POST", "/productos", data=nuevo, token=token)
    assert status == 201, f"Fallo al crear producto: {prod_nuevo}"
    id_nuevo = prod_nuevo["id"]
    print(f"   Producto de prueba creado: ID={id_nuevo}")

    print("   Eliminando producto sin uso...")
    status, del_resp = request_json("DELETE", f"/productos/{id_nuevo}", token=token)
    assert status == 200, f"Se esperaba HTTP 200 pero fue {status}: {del_resp}"
    print(f"   Eliminación física exitosa: {del_resp.get('message')}")

    # 4. Validar protección contable contra producto asociado a créditos
    print("\n[4/6] Probando eliminación en producto vinculado a créditos (credito_detalle)...")
    prod_credito = next((p for p in prods if p["sku"] in ["ART-101", "MEC-LUN-01", "ESC-202"]), None)
    assert prod_credito is not None, "No se encontró producto con crédito asociado"
    id_credito = prod_credito["id"]
    print(f"   Intentando borrar: {prod_credito['nombre']} (ID: {id_credito})...")

    status, del_err = request_json("DELETE", f"/productos/{id_credito}", token=token)
    print(f"   Status recibido: {status}")
    print(f"   Detalle de rechazo: {del_err.get('detail')}")
    assert status == 400, f"Se esperaba HTTP 400 pero se obtuvo {status}"
    print("   VALIDACIÓN FINANCIERA APROBADA: El servidor rechazó con HTTP 400 para blindar el historial.")

    # 5. Probar desactivación lógica (estado_activo = false)
    print("\n[5/6] Probando desactivación lógica (soft delete) en producto con crédito...")
    status, deact_resp = request_json("DELETE", f"/productos/{id_credito}?desactivar=true", token=token)
    assert status == 200
    assert deact_resp.get("estado_activo") is False
    print(f"   Desactivación lógica confirmada: {deact_resp.get('message')}")

    # Reactivar para no alterar demo
    status, _ = request_json("PUT", f"/productos/{id_credito}", data={"estado_activo": True}, token=token)
    assert status == 200
    print("   Producto reactivado a estado activo para el catálogo.")

    # 6. Probar módulo de abonos y conciliación de rutas
    print("\n[6/6] Verificando endpoints de conciliación de rutas y abonos...")
    status, abonos_list = request_json("GET", "/abonos", token=token)
    assert status == 200
    print(f"   GET /abonos retornó {len(abonos_list)} abonos en sistema.")

    # Obtener un cobrador para conciliar
    status, cobradores = request_json("GET", "/usuarios?rol=cobrador", token=token)
    assert status == 200
    if len(cobradores) > 0:
        cobr_id = cobradores[0]["id"]
        print(f"   Probando POST /abonos/conciliar-ruta para cobrador: {cobradores[0]['nombre']}...")
        status, concil_resp = request_json("POST", "/abonos/conciliar-ruta", data={
            "cobrador_id": cobr_id,
            "efectivo_entregado": 500000.0,
            "notas": "Cierre de prueba automatizado verificado"
        }, token=token)
        assert status == 200
        print(f"   Conciliación procesada: {concil_resp.get('mensaje')}")
        print(f"   Esperado: {concil_resp.get('total_esperado')} | Entregado: {concil_resp.get('efectivo_entregado')} | Cuadre: {concil_resp.get('cuadre_estado')}")

    print("\n==================================================================")
    print("   TODAS LAS PRUEBAS AUTOMATIZADAS PASARON CON ÉXITO (100%)       ")
    print("==================================================================")

if __name__ == "__main__":
    run_tests()
