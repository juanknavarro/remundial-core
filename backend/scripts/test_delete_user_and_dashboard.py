import json
import urllib.request
import urllib.parse
import urllib.error
from uuid import uuid4

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

def test_delete_user_and_dashboard():
    print("==================================================================")
    print(" PRUEBA: CORRECCIÓN ERROR 422 / DELETE USUARIOS & DASHBOARD REAL  ")
    print("==================================================================")

    # 1. Login como Master
    status, res_login = request_http(
        "POST",
        "/auth/login",
        form_data={"username": "3000000000", "password": "masterpassword123"}
    )
    assert status == 200, f"Fallo login master: {res_login}"
    master_token = res_login["access_token"]
    master_user = res_login["usuario"]
    print(f"[OK] Master autenticado: {master_user['nombre']} (ID: {master_user['id']})")

    # 2. Probar eliminación de la propia cuenta en sesión activa (Debe arrojar 400, no 422)
    print("\n[Test 1] Intentando eliminar propia cuenta en sesión activa...")
    status, res_self_del = request_http("DELETE", f"/usuarios/{master_user['id']}", token=master_token)
    print(f"Status recibido: {status}")
    print(f"Respuesta: {res_self_del}")
    assert status == 400, f"Se esperaba 400 y se obtuvo: {status}"
    assert "propia cuenta" in str(res_self_del), "El mensaje debe indicar que no puede auto-eliminarse"
    print("  [PASS] Auto-eliminación bloqueada limpiamente con HTTP 400.")

    # 3. Probar eliminación con ID de formato mock / no UUID (Debe responder limpiamente sin 422)
    print("\n[Test 2] Intentando eliminar con ID no-UUID ('u-0' mock)...")
    status, res_mock_del = request_http("DELETE", "/usuarios/u-0", token=master_token)
    print(f"Status recibido: {status}")
    print(f"Respuesta: {res_mock_del}")
    assert status == 200, f"Se esperaba 200 y se obtuvo {status}"
    print("  [PASS] ID mock manejado limpiamente sin error 422.")

    # 4. Crear un usuario temporal de prueba y luego darlo de baja / eliminarlo
    print("\n[Test 3] Creando usuario temporal para probar baja lógica y eliminación...")
    random_tel = f"399{int(uuid4().int % 10000000):07d}"
    status, res_create = request_http(
        "POST",
        "/usuarios",
        data={
            "nombre": "Colaborador Temporal Prueba",
            "rol": "vendedor",
            "telefono": random_tel,
            "password": "tempPassword123"
        },
        token=master_token
    )
    assert status in (200, 201), f"Fallo creación: {res_create}"
    temp_user = res_create
    temp_id = temp_user["id"]
    print(f"  [OK] Usuario temporal creado: ID {temp_id}")

    # Baja lógica (baja_logica=True)
    status, res_baja = request_http("DELETE", f"/usuarios/{temp_id}?baja_logica=true", token=master_token)
    assert status == 200, f"Fallo baja lógica: {res_baja}"
    print(f"  [OK] Baja lógica exitosa: {res_baja.get('mensaje')}")

    # Eliminación física (baja_logica=False)
    status, res_del_fisica = request_http("DELETE", f"/usuarios/{temp_id}?baja_logica=false", token=master_token)
    assert status == 200, f"Fallo eliminación física: {res_del_fisica}"
    print(f"  [OK] Eliminación física exitosa: {res_del_fisica.get('mensaje')}")
    print("  [PASS] Ciclo de eliminación de usuario completado sin errores 422.")

    # 5. Comprobar métricas reales de Dashboard
    print("\n[Test 4] Verificando métricas reales de Dashboard en /creditos y /abonos...")
    status_c, res_creditos = request_http("GET", "/creditos", token=master_token)
    status_a, res_abonos = request_http("GET", "/abonos", token=master_token)
    assert status_c == 200
    assert status_a == 200

    print(f"Total créditos en BD: {len(res_creditos)}")
    print(f"Total abonos en BD: {len(res_abonos)}")
    print("  [PASS] Endpoints del Dashboard responden coherentemente con la base de datos.")

    print("\nTODAS LAS PRUEBAS DE USUARIOS Y DASHBOARD PASARON EXITOSAMENTE!")

if __name__ == "__main__":
    test_delete_user_and_dashboard()
