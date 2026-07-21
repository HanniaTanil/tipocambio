from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

HOST = "127.0.0.1"
PORT = 5500
API_HOST = "https://www.banxico.org.mx"


def load_token_from_env_or_dotenv():
    env_token = os.getenv("BANXICO_TOKEN") or os.getenv("token")
    if env_token and env_token.strip():
        return env_token.strip()

    dotenv_path = os.path.join(os.getcwd(), ".env")
    if not os.path.exists(dotenv_path):
        return ""

    with open(dotenv_path, "r", encoding="utf-8") as dotenv_file:
        for line in dotenv_file:
            cleaned = line.strip()
            if not cleaned or cleaned.startswith("#") or "=" not in cleaned:
                continue

            key, value = cleaned.split("=", 1)
            if key.strip() in ("BANXICO_TOKEN", "token") and value.strip():
                return value.strip()

    return ""


class BanxicoProxyHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/config":
            self.handle_runtime_config()
            return

        if parsed.path == "/api/banxico":
            self.handle_banxico_proxy(parsed.query)
            return

        super().do_GET()

    def handle_runtime_config(self):
        token = load_token_from_env_or_dotenv()
        has_token = "true" if bool(token) else "false"
        body = f'{{"hasToken": {has_token}}}'.encode("utf-8")
        self.respond_json(200, body)

    def handle_banxico_proxy(self, query_string):
        params = parse_qs(query_string)
        endpoint = (params.get("endpoint") or [""])[0]
        token = load_token_from_env_or_dotenv()

        if not endpoint or not token:
            self.respond_json(500, b'{"error":"token no configurado en entorno (.env o BANXICO_TOKEN)"}')
            return

        if not endpoint.startswith(API_HOST + "/SieAPIRest/"):
            self.respond_json(400, b'{"error":"endpoint invalido"}')
            return

        # El token se agrega por query param para replicar el curl solicitado.
        separator = "&" if "?" in endpoint else "?"
        target_url = f"{endpoint}{separator}token={quote(token, safe='')}"

        request = Request(target_url, method="GET", headers={"Accept": "application/json"})

        try:
            with urlopen(request, timeout=20) as response:
                body = response.read()
                status = response.getcode()
                self.respond_json(status, body)
        except HTTPError as http_error:
            body = http_error.read() if hasattr(http_error, "read") else b""
            if not body:
                body = b'{"error":"error http en banxico"}'
            self.respond_json(http_error.code, body)
        except URLError:
            self.respond_json(502, b'{"error":"no se pudo conectar con banxico"}')

    def respond_json(self, status_code, body):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def run():
    server = ThreadingHTTPServer((HOST, PORT), BanxicoProxyHandler)
    print(f"Servidor en http://{HOST}:{PORT}")
    print("Proxy Banxico disponible en /api/banxico")
    server.serve_forever()


if __name__ == "__main__":
    run()
