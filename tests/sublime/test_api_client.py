import importlib
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler
from socketserver import TCPServer

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PACKAGE_ROOT = os.path.join(REPO_ROOT, 'sublime')
if PACKAGE_ROOT not in sys.path:
    sys.path.insert(0, PACKAGE_ROOT)

api_client = importlib.import_module('PairOfCleats.lib.api_client')


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?', 1)[0]
        query = {}
        if '?' in self.path:
            try:
                from urllib.parse import parse_qs
                query = {k: v[0] for k, v in parse_qs(self.path.split('?', 1)[1]).items()}
            except Exception:
                query = {}

        if path == '/map':
            fmt = query.get('format') or 'json'
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('X-PairofCleats-Map-CacheKey', 'test-cache-key')
            if fmt == 'json':
                payload = {
                    'root': {'path': query.get('repo') or '/repo', 'id': 'repo-id'},
                    'summary': {'counts': {'files': 1, 'members': 1, 'edges': 0}},
                    'warnings': []
                }
                body = json.dumps(payload).encode('utf-8')
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            if fmt == 'dot':
                body = b'digraph G {}\n'
                self.send_header('Content-Type', 'text/plain')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            body = b'<!doctype html><html></html>'
            self.send_header('Content-Type', 'text/html')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == '/map/nodes':
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            payload = {
                'generatedAt': 'now',
                'root': query.get('repo') or '/repo',
                'nodes': [{'id': 'n1', 'label': 'node 1', 'file': 'src/a.js'}]
            }
            body = json.dumps(payload).encode('utf-8')
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
    def test_generate_map_report_writes_artifacts(self):
        server = TCPServer(('127.0.0.1', 0), _Handler)
        port = server.server_address[1]

        thread = threading.Thread(target=server.serve_forever)
        thread.daemon = True
        thread.start()

        try:
            with tempfile.TemporaryDirectory() as tmp:
                output_path = os.path.join(tmp, 'out.dot')
                model_path = os.path.join(tmp, 'model.json')
                nodes_path = os.path.join(tmp, 'nodes.json')

                settings = {
                    'api_timeout_ms': 2000,
                    'map_index_mode': 'code',
                    'map_collapse_default': 'none'
                }

                report = api_client.generate_map_report(
                    'http://127.0.0.1:{0}'.format(port),
                    '/repo',
                    settings,
                    'repo',
                    '',
                    'imports',
                    'dot',
                    output_path,
                    model_path,
                    nodes_path
                )

                self.assertTrue(report.get('ok'))
                self.assertEqual(report.get('format'), 'dot')
                self.assertEqual(report.get('cacheKey'), 'test-cache-key')

                self.assertTrue(os.path.exists(output_path))
                self.assertTrue(os.path.exists(model_path))
                self.assertTrue(os.path.exists(nodes_path))

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
