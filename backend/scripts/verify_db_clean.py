"""Verificación de integridad HTTP y estado en ceros de la base de datos tras la limpieza.
Usa urllib de la librería estándar para no requerir dependencias externas.
"""

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

BASE_URL = "http://localhost:8000"


def http_request(method: str, path: str, data: dict = None, token: str = None):
    url = f"{BASE_URL}{path}"
    headers = {}
    encoded_data = None

    if token:
        headers["Authorization"] = f"Bearer {token}"

    if data is not None:
        if path == "/auth/login":
            encoded_data = urllib.parse.urlencode(data).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            encoded_data = json.dumps(data).encode("utf-8")
            headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=encoded_data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            status = response.status
            body = response.read().decode("utf-8")
            return status, json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        return e.code, json.loads(body) if body else None


def main():
    print("==========================================================")
    print("   VERIFICACIÓN HTTP DE BASE DE DATOS TRAS LIMPIEZA      ")
    print("==========================================================")

    # 1. Login con Supervisor
    print("\n[1] Autenticando con Supervisor (3009990011)...")
    status, res_login = http_request(
        "POST",
        "/auth/login",
        data={"username": "3009990011", "password": "password123"},
    )
    if status != 200:
        print(f"Error en login: {status} - {res_login}")
        sys.exit(1)

    token = res_login["access_token"]
    print("  [OK] Token JWT obtenido correctamente.")

    # 2. Consultar Usuarios
    print("\n[2] Consultando GET /usuarios...")
    status, usuarios = http_request("GET", "/usuarios", token=token)
    assert status == 200, f"Error en GET /usuarios: {status}"
    print(f"  [OK] Total usuarios del sistema: {len(usuarios)}")
    roles_esperados = {"master", "supervisor", "secretaria", "vendedor", "cobrador"}
    roles_presentes = {u["rol"] for u in usuarios}
    print(f"  [OK] Roles verificados presentes: {roles_presentes}")
    assert roles_esperados.issubset(roles_presentes), "Faltan roles clave del sistema"

    # 3. Consultar Directorio de Clientes
    print("\n[3] Consultando GET /clientes...")
    status, clientes = http_request("GET", "/clientes", token=token)
    assert status == 200, f"Error en GET /clientes: {status}"
    print(f"  [OK] Total clientes conservados en directorio: {len(clientes)}")
    for c in clientes:
        print(f"     - {c['cedula']} | {c['nombres']} ({c.get('telefono')}) - {c.get('ciudad')}")
    assert len(clientes) >= 4, "Los clientes no deben ser eliminados"

    # 4. Consultar Productos (Debe estar en CEROS)
    print("\n[4] Consultando GET /productos (Inventario)...")
    status, productos = http_request("GET", "/productos", token=token)
    assert status == 200, f"Error en GET /productos: {status}"
    print(f"  [OK] Total productos en catálogo: {len(productos)} (esperado: 0)")
    assert len(productos) == 0, f"Se esperaban 0 productos pero hay {len(productos)}"

    # 5. Consultar Créditos (Debe estar en CEROS)
    print("\n[5] Consultando GET /creditos (Cartera)...")
    status, creditos = http_request("GET", "/creditos", token=token)
    assert status == 200, f"Error en GET /creditos: {status}"
    print(f"  [OK] Total créditos en cartera: {len(creditos)} (esperado: 0)")
    assert len(creditos) == 0, f"Se esperaban 0 créditos pero hay {len(creditos)}"

    # 6. Consultar Abonos / Recaudos (Debe estar en CEROS)
    print("\n[6] Consultando GET /abonos...")
    status, abonos_list = http_request("GET", "/abonos", token=token)
    assert status == 200, f"Error en GET /abonos: {status}"
    print(f"  [OK] Total abonos registrados: {len(abonos_list)} (esperado: 0)")
    assert len(abonos_list) == 0, f"Se esperaban 0 abonos pero hay {len(abonos_list)}"

    print("\n==========================================================")
    print("   ¡TODAS LAS VERIFICACIONES HTTP PASARON CON ÉXITO!      ")
    print("==========================================================")


if __name__ == "__main__":
    main()
