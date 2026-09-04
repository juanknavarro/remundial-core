import urllib.request
import urllib.parse
import json
import time
import sys

BASE_URL = "http://127.0.0.1:8000"

def login(phone: str, password: str):
    data = urllib.parse.urlencode({"username": phone, "password": password}).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}/auth/login",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    with urllib.request.urlopen(req, timeout=5) as res:
        return json.loads(res.read().decode())

def api_request(method: str, path: str, token: str, payload: dict = None):
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=data,
        headers=headers,
        method=method
    )
    with urllib.request.urlopen(req, timeout=5) as res:
        content = res.read().decode()
        return json.loads(content) if content else {}

def main():
    print("=== INICIANDO VALIDACION DE SEGURIDAD Y CONTROL DE ACCESOS ===")

    # 1. Validar login de los 5 roles
    credenciales = [
        ("Superusuario Master", "3000000000", "masterpassword123", "master"),
        ("Supervisor", "3009990011", "password123", "supervisor"),
        ("Secretaria", "3104445566", "password123", "secretaria"),
        ("Vendedor", "3151234567", "password123", "vendedor"),
        ("Cobrador", "3189998877", "password123", "cobrador"),
    ]

    tokens = {}
    for nombre, phone, pwd, expected_role in credenciales:
        try:
            res = login(phone, pwd)
            token = res["access_token"]
            u = res["usuario"]
            assert u["rol"] == expected_role, f"Esperado {expected_role}, recibido {u['rol']}"
            tokens[expected_role] = token
            print(f"[OK] Login verificado: {nombre} ({u['rol']}) con tel {phone}")
        except Exception as e:
            print(f"[ERROR] Fallo en login {nombre}: {e}")
            sys.exit(1)

    master_token = tokens["master"]

    # 2. Validar que Master puede acceder a endpoints de administración
    print("\n--- Verificando Acceso Irrestricto del Rol Master ---")
    
    # /usuarios (restringido a supervisor)
    usuarios = api_request("GET", "/usuarios", master_token)
    print(f"[OK] Master consulto /usuarios: {len(usuarios)} usuarios registrados.")

    # /productos (restringido a get_current_user)
    productos = api_request("GET", "/productos", master_token)
    print(f"[OK] Master consulto /productos: {len(productos)} articulos en catalogo.")

    # /clientes (restringido a get_current_user)
    clientes = api_request("GET", "/clientes", master_token)
    print(f"[OK] Master consulto /clientes: {len(clientes)} clientes registrados.")

    # /creditos (restringido a get_current_user)
    creditos = api_request("GET", "/creditos", master_token)
    print(f"[OK] Master consulto /creditos: {len(creditos)} creditos registrados.")

    # 3. Validar creacion y gestion de usuario por parte de Master
    print("\n--- Verificando Operaciones CRUD de Personal ejecutadas por Master ---")
    nuevo_colaborador = {
        "nombre": "Prueba Auditoria Temporal",
        "rol": "vendedor",
        "telefono": f"399{int(time.time()) % 10000000:07d}",
        "estado_activo": True,
        "password": "temporalpassword123"
    }
    creado = api_request("POST", "/usuarios", master_token, nuevo_colaborador)
    creado_id = creado["id"]
    print(f"[OK] Master creo usuario ID: {creado_id} ({creado['nombre']})")

    # Actualizar usuario
    actualizado = api_request("PUT", f"/usuarios/{creado_id}", master_token, {"nombre": "Prueba Auditoria Modificado"})
    print(f"[OK] Master actualizo usuario: {actualizado['nombre']}")

    # Inactivar / eliminar usuario
    eliminado = api_request("DELETE", f"/usuarios/{creado_id}?baja_logica=true", master_token)
    print(f"[OK] Master dio de baja usuario: {eliminado}")

    print("\n=== TODAS LAS VALIDACIONES DE SEGURIDAD Y CONTROL DE ACCESO PASARON AL 100% ===")

if __name__ == "__main__":
    import time
    urllib.parse.time = time
    main()
