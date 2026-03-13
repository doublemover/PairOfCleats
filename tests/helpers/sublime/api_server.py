import importlib
import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler
from socketserver import TCPServer

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
PACKAGE_ROOT = os.path.join(REPO_ROOT, 'sublime')
if PACKAGE_ROOT not in sys.path:
    sys.path.insert(0, PACKAGE_ROOT)

api_client = importlib.import_module('PairOfCleats.lib.api_client')


class _Handler(BaseHTTPRequestHandler):
    def _read_json_body(self):
        length = int(self.headers.get('Content-Length') or '0')
        if length <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode('utf-8'))
        except Exception:
            return {}

    def do_GET(self):
        path = self.path.split('?', 1)[0]

        if path == '/search':
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            payload = {
                'ok': True,
                'result': {
                    'code': [{
                        'file': 'src/index.js',
                        'name': 'index',
                        'startLine': 3,
                    }]
                }
            }
            body = json.dumps(payload).encode('utf-8')
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if self.path == '/search':
            payload = self._read_json_body()
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            body = json.dumps({
                'ok': True,
                'result': {
                    'code': [{
                        'file': 'src/index.js',
                        'name': payload.get('query') or 'index',
                        'startLine': 3,
                    }]
                }
            }).encode('utf-8')
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        self.send_response(404)
        self.end_headers()

    def log_message(self, _format, *_args):
        return


class ApiClientTests(unittest.TestCase):
    def test_search_json_unwraps_compact_results(self):
        server = TCPServer(('127.0.0.1', 0), _Handler)
        port = server.server_address[1]

        thread = threading.Thread(target=server.serve_forever)
        thread.daemon = True
        thread.start()

        try:
            payload, _headers = api_client.search_json(
                'http://127.0.0.1:{0}'.format(port),
                '/repo',
                {'api_timeout_ms': 2000},
                'return',
                'code',
                limit=3,
            )
            self.assertTrue(payload.get('ok'))
            self.assertEqual(payload['code'][0]['file'], 'src/index.js')
        finally:
            try:
                server.shutdown()
            except Exception:
                pass
            try:
                server.server_close()
            except Exception:
                pass


if __name__ == '__main__':
    unittest.main()
