import urllib.request
import urllib.parse
import json

def test():
    # Login as secretaria
    data = urllib.parse.urlencode({'username': '3104445566', 'password': 'password123'}).encode('utf-8')
    req = urllib.request.Request('http://127.0.0.1:8000/auth/login', data=data, headers={'Content-Type': 'application/x-www-form-urlencoded'})
    with urllib.request.urlopen(req) as resp:
        body = json.loads(resp.read().decode('utf-8'))
        token = body['access_token']
        print(f"Secretaria Logged in: {body['usuario']['nombre']} ({body['usuario']['rol']})")

    def make_req(method, path):
        r = urllib.request.Request(f'http://127.0.0.1:8000{path}', headers={'Authorization': f'Bearer {token}'}, method=method)
        try:
            with urllib.request.urlopen(r) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                print(f"{method} {path} => SUCCESS {resp.status} (records: {len(data) if isinstance(data, list) else 1})")
                return data
        except urllib.error.HTTPError as e:
            err_msg = e.read().decode('utf-8')
            print(f"{method} {path} => ERROR {e.code}: {err_msg}")
            return None

    print("\n--- Test Endpoints as Secretaria ---")
    make_req('GET', '/usuarios?rol=cobrador')
    make_req('GET', '/abonos')

if __name__ == '__main__':
    test()
