import urllib.request
import json
from app.core.security import create_access_token

token = create_access_token({'sub': '66b28f2f-7c15-47e0-9751-965fb51ed314', 'role': 'supervisor', 'nombre': 'Supervisor Test'})
headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

try:
    req = urllib.request.Request('http://localhost:8000/configuracion/parametros', headers=headers)
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        print('GET /parametros status:', resp.status)
        print('identidad_visual:', data.get('identidad_visual'))

    # Test PUT
    put_payload = {
        'razon_social': "REMUNDIAL ARTE'S S.A.S.",
        'nit': '901.888.777-1',
        'ciudad_principal': 'Monteria, Cordoba',
        'telefono_soporte': '310 999 8888',
        'identidad_visual': {
            'eslogan_login': 'Plataforma Central de Credito y Cobranza',
            'eslogan_mobile': 'Operaciones de Campo y Cobranza',
            'pie_login': 'Acceso seguro Remundial',
            'pie_mobile': 'v1.2.0 - Remundial Movil'
        }
    }
    put_data = json.dumps(put_payload).encode('utf-8')
    req_put = urllib.request.Request('http://localhost:8000/configuracion/parametros', data=put_data, headers=headers, method='PUT')
    with urllib.request.urlopen(req_put) as resp_put:
        put_resp = json.loads(resp_put.read().decode())
        print('PUT /parametros response status:', resp_put.status)
        print('PUT /parametros data:', put_resp)

    # Check that logo endpoint responds (or 404 if no logo yet)
    try:
        req_logo = urllib.request.Request('http://localhost:8000/configuracion/logo')
        with urllib.request.urlopen(req_logo) as resp_logo:
            print('GET /configuracion/logo status:', resp_logo.status)
    except urllib.error.HTTPError as e:
        print('GET /configuracion/logo (expected if no file yet):', e.code)

    print('ALL ENDPOINTS TESTED SUCCESSFULLY!')
except Exception as ex:
    print('ERROR:', ex)
