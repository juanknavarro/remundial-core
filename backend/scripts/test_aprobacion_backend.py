import urllib.request
import urllib.parse
import json
import sys

BASE = "http://127.0.0.1:8000"

def login(phone, pwd):
    data = urllib.parse.urlencode({"username": phone, "password": pwd}).encode()
    req = urllib.request.Request(f"{BASE}/auth/login", data=data)
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read().decode())

def run_test():
    print("--- Probando flujo completo de aprobacion backend ---")
    sup_auth = login("3009990011", "password123")
    sup_tok = sup_auth["access_token"]
    sup_id = sup_auth["usuario"]["id"]

    vend_auth = login("3151234567", "password123")
    vend_tok = vend_auth["access_token"]
    vend_id = vend_auth["usuario"]["id"]

    # Clientes
    req = urllib.request.Request(f"{BASE}/clientes", headers={"Authorization": f"Bearer {sup_tok}"})
    with urllib.request.urlopen(req) as res:
        clientes = json.loads(res.read().decode())
    cliente_id = clientes[0]["id"]

    # Productos
    req = urllib.request.Request(f"{BASE}/productos", headers={"Authorization": f"Bearer {sup_tok}"})
    with urllib.request.urlopen(req) as res:
        prods = json.loads(res.read().decode())
    prod = prods[0]

    # Crear credito pendiente
    payload = {
        "cliente_id": cliente_id,
        "vendedor_id": vend_id,
        "supervisor_id": sup_id,
        "estado": "pendiente",
        "tipo_pago": "quincenal",
        "cuota_inicial": "100000.00",
        "monto_financiado": "500000.00",
        "numero_cuotas": 4,
        "valor_cuota": "125000.00",
        "fecha_primera_cuota": "2026-09-15",
        "saldo_pendiente": "500000.00",
        "detalles": [
            {
                "producto_id": prod["id"],
                "cantidad": 1,
                "valor_unitario_acordado": "600000.00"
            }
        ]
    }

    req = urllib.request.Request(
        f"{BASE}/creditos",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {vend_tok}", "Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as res:
        credito_creado = json.loads(res.read().decode())

    cid = credito_creado["id_contrato"]
    print(f"[OK] Credito creado con ID: {cid}, estado: {credito_creado['estado']}")
    assert credito_creado["estado"] == "pendiente", f"Esperado pendiente, obtenido {credito_creado['estado']}"

    # Listar pendientes
    req = urllib.request.Request(f"{BASE}/creditos?estado=pendiente", headers={"Authorization": f"Bearer {sup_tok}"})
    with urllib.request.urlopen(req) as res:
        pendientes = json.loads(res.read().decode())
    assert any(p["id_contrato"] == cid for p in pendientes), "El credito creado no aparece en pendientes"
    print(f"[OK] Credito verificado en GET /creditos?estado=pendiente")

    # Aprobar mediante POST /creditos/{cid}/aprobar
    req = urllib.request.Request(
        f"{BASE}/creditos/{cid}/aprobar",
        data=b"{}",
        headers={"Authorization": f"Bearer {sup_tok}", "Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as res:
        aprobado = json.loads(res.read().decode())
    print(f"[OK] Respuesta de aprobacion recibida, estado: {aprobado['estado']}")
    assert aprobado["estado"] == "activo", f"Esperado activo, obtenido {aprobado['estado']}"

    # Verificar que ya NO esta en pendientes
    req = urllib.request.Request(f"{BASE}/creditos?estado=pendiente", headers={"Authorization": f"Bearer {sup_tok}"})
    with urllib.request.urlopen(req) as res:
        pendientes_post = json.loads(res.read().decode())
    assert not any(p["id_contrato"] == cid for p in pendientes_post), "El credito aun aparece en pendientes despues de aprobar"
    print(f"[OK] Credito ya NO aparece en GET /creditos?estado=pendiente")

    # Verificar que aparece en activos y con todas las relaciones cargadas
    req = urllib.request.Request(f"{BASE}/creditos?estado=activo", headers={"Authorization": f"Bearer {sup_tok}"})
    with urllib.request.urlopen(req) as res:
        activos = json.loads(res.read().decode())
    credito_en_cartera = next((c for c in activos if c["id_contrato"] == cid), None)
    assert credito_en_cartera is not None, "El credito no aparece en la lista de activos"
    assert credito_en_cartera["estado"] == "activo", f"Estado esperado activo, recibido {credito_en_cartera['estado']}"
    assert credito_en_cartera["supervisor_id"] == sup_id, "El supervisor_id no coincide con el supervisor aprobador"
    assert credito_en_cartera["cliente"] is not None, "Relacion cliente no cargada en cartera"
    assert credito_en_cartera["vendedor"] is not None, "Relacion vendedor no cargada en cartera"
    assert len(credito_en_cartera["detalles"]) > 0, "Relacion detalles/articulos no cargada en cartera"
    print(f"[OK] Credito verificado como ACTIVO en cartera con todas sus relaciones (Cliente, Vendedor, Supervisor, Articulos)!")

    # Probar tambien PATCH /creditos/{cid} con {"estado": "aprobado"} para validar robustez
    req = urllib.request.Request(
        f"{BASE}/creditos/{cid}",
        data=json.dumps({"estado": "aprobado"}).encode(),
        headers={"Authorization": f"Bearer {sup_tok}", "Content-Type": "application/json"},
        method="PATCH"
    )
    with urllib.request.urlopen(req) as res:
        patch_res = json.loads(res.read().decode())
    assert patch_res["estado"] == "activo", f"PATCH con 'aprobado' no normalizo a activo: {patch_res['estado']}"
    print(f"[OK] PATCH con 'aprobado' normaliza y persiste correctamente como 'activo'")

    # Validar consistencia global de Cartera de Creditos (GET /creditos sin filtro)
    req = urllib.request.Request(f"{BASE}/creditos", headers={"Authorization": f"Bearer {sup_tok}"})
    with urllib.request.urlopen(req) as res:
        todos = json.loads(res.read().decode())
    assert any(c["id_contrato"] == cid for c in todos), "El credito aprobado no aparece en el listado general de Cartera"
    
    total_colocado = sum(float(c.get("monto_financiado", 0)) + float(c.get("cuota_inicial", 0)) for c in todos if c.get("estado") in ("activo", "terminado"))
    total_activos = sum(1 for c in todos if c.get("estado") == "activo")
    print(f"[OK] Consistencia en Cartera validada: {len(todos)} contratos totales, {total_activos} activos, Total colocado: ${total_colocado:,.2f}")

    print("=== TODOS LOS TESTS DEL BACKEND PASARON EXITOSAMENTE ===")

if __name__ == "__main__":
    run_test()
