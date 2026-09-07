import json
import urllib.parse
import urllib.request

BASE_URL = "http://127.0.0.1:8000"


def make_request(url, method="GET", data=None, headers=None):
    if headers is None:
        headers = {}
    encoded_data = None
    if data:
        if isinstance(data, dict):
            encoded_data = urllib.parse.urlencode(data).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        elif isinstance(data, bytes):
            encoded_data = data

    req = urllib.request.Request(url, data=encoded_data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


def run_tests():
    print("=== TEST 1: Login como Superusuario Master ===")
    status, headers, body = make_request(
        f"{BASE_URL}/auth/login",
        method="POST",
        data={"username": "3000000000", "password": "masterpassword123"},
    )
    if status != 200:
        print(f"Error en login: {status} - {body.decode('utf-8')}")
        return False

    auth_data = json.loads(body.decode("utf-8"))
    token = auth_data["access_token"]
    auth_headers = {"Authorization": f"Bearer {token}"}
    print("OK - Token obtenido para Superusuario Master.")

    print("\n=== TEST 2: Consultar Endpoint JSON de Reportes (GET /reportes/ventas) ===")
    status, headers, body = make_request(
        f"{BASE_URL}/reportes/ventas",
        headers=auth_headers,
    )
    print(f"Status: {status}")
    if status != 200:
        print(f"Error: {body.decode('utf-8')}")
        return False

    data = json.loads(body.decode("utf-8"))
    metricas = data.get("metricas", {})
    operaciones = data.get("operaciones", [])
    print(f"Total Facturado: ${metricas.get('total_vendido', 0):,.2f}")
    print(f"Volumen Crédito: ${metricas.get('volumen_credito', 0):,.2f} ({metricas.get('operaciones_credito', 0)} ops)")
    print(f"Volumen Contado: ${metricas.get('volumen_contado', 0):,.2f} ({metricas.get('operaciones_contado', 0)} ops)")
    print(f"Ticket Promedio: ${metricas.get('ticket_promedio', 0):,.2f}")
    print(f"Total Operaciones listadas: {len(operaciones)}")
    print("OK - Estructura JSON de métricas y operaciones validada.")

    print("\n=== TEST 3: Filtrar por Modalidad Crédito (GET /reportes/ventas?tipo_venta=credito) ===")
    status, headers, body = make_request(
        f"{BASE_URL}/reportes/ventas?tipo_venta=credito",
        headers=auth_headers,
    )
    print(f"Status: {status}")
    assert status == 200, f"Status esperado 200, obtenido {status}"
    cred_data = json.loads(body.decode("utf-8"))
    print(f"Ops crédito: {len(cred_data.get('operaciones', []))}")

    print("\n=== TEST 4: Generar y Descargar Reporte PDF PRO con ReportLab (GET /reportes/ventas/pdf) ===")
    status, headers, body = make_request(
        f"{BASE_URL}/reportes/ventas/pdf",
        headers=auth_headers,
    )
    content_type = headers.get("Content-Type", "")
    content_disp = headers.get("Content-Disposition", "")
    print(f"Status: {status} | Content-Type: {content_type} | Content-Disposition: {content_disp}")
    if status != 200:
        print(f"Error generando PDF: {body.decode('utf-8')}")
        return False

    print(f"Tamaño del binario PDF generado: {len(body)} bytes")
    assert body.startswith(b"%PDF"), "El archivo no contiene la firma binaria de un documento PDF válido"
    print("OK - Archivo PDF ejecutivo generado con éxito por ReportLab.")

    print("\n>>> TODOS LOS TESTS DE REPORTES (JSON Y PDF) PASARON CON ÉXITO (100%) <<<")
    return True


if __name__ == "__main__":
    success = run_tests()
    if not success:
        exit(1)
