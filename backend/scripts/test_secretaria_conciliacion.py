import sys
from pathlib import Path
import urllib.request
import urllib.parse
import json

BASE_URL = "http://127.0.0.1:8000"

def get_token(username, password="password123"):
    data = urllib.parse.urlencode({'username': username, 'password': password}).encode('utf-8')
    req = urllib.request.Request(f"{BASE_URL}/auth/login", data=data, headers={'Content-Type': 'application/x-www-form-urlencoded'})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))['access_token']

def api_request(method, path, data=None, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    req_data = json.dumps(data).encode('utf-8') if data else None
    req = urllib.request.Request(f"{BASE_URL}{path}", data=req_data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            content = resp.read().decode('utf-8')
            return resp.status, json.loads(content) if content else {}
    except urllib.error.HTTPError as e:
        err = e.read().decode('utf-8')
        return e.code, json.loads(err) if err else {"detail": str(e)}

def test_secretaria_flow():
    print("=== TEST 1: Login como Secretaria ===")
    token_sec = get_token("3104445566")
    assert token_sec, "Fallo al obtener token de secretaria"
    print("OK - Token obtenido.")

    print("\n=== TEST 2: Consultar Cobradores como Secretaria (GET /usuarios?rol=cobrador) ===")
    status, cobradores = api_request("GET", "/usuarios?rol=cobrador", token=token_sec)
    print(f"Status: {status} | Cobradores: {len(cobradores)}")
    assert status == 200
    assert len(cobradores) > 0, "Debe haber al menos un cobrador registrado"
    cobrador_test = cobradores[0]
    print(f"Cobrador de prueba: {cobrador_test['nombre']} (ID: {cobrador_test['id']})")

    print("\n=== TEST 3: Consultar Abonos como Secretaria (GET /abonos) ===")
    status, abonos_iniciales = api_request("GET", "/abonos", token=token_sec)
    print(f"Status: {status} | Abonos en sistema: {len(abonos_iniciales)}")
    assert status == 200

    print("\n=== TEST 4: Consultar Actas de Cierre como Secretaria (GET /abonos/cierres-caja) ===")
    status, cierres = api_request("GET", "/abonos/cierres-caja", token=token_sec)
    print(f"Status: {status} | Cierres registrados: {len(cierres)}")
    assert status == 200

    print("\n=== TEST 5: Conciliación de Ruta (POST /abonos/conciliar-ruta) ===")
    status, concil_res = api_request("POST", "/abonos/conciliar-ruta", data={
        "cobrador_id": cobrador_test["id"],
        "efectivo_entregado": 0.0,
        "notas": "Auditoría automatizada de cierre de caja - Prueba Secretaria"
    }, token=token_sec)
    print(f"Status: {status}")
    print(f"Resultado: {concil_res}")
    assert status == 200
    assert "cuadre_estado" in concil_res
    assert concil_res["responsable_nombre"] == "Mar\u00eda Secretaria" or "Secretaria" in concil_res["responsable_nombre"]

    print("\n=== TEST 6: Verificar que el cierre quedó registrado en auditoría ===")
    status, cierres_actualizados = api_request("GET", "/abonos/cierres-caja", token=token_sec)
    assert status == 200
    assert len(cierres_actualizados) > len(cierres), "El nuevo cierre debe aparecer en el listado de auditoría"
    ultimo = cierres_actualizados[0]
    print(f"Último cierre auditado: Cobrador {ultimo['cobrador_nombre']} | Responsable: {ultimo['responsable_nombre']} | Estado: {ultimo['cuadre_estado']} | Diferencia: {ultimo['diferencia']}")

    print("\n>>> TODOS LOS TESTS DE SECRETARÍA Y AUDITORÍA PASARON EXITOSAMENTE (100%) <<<")

if __name__ == "__main__":
    test_secretaria_flow()
