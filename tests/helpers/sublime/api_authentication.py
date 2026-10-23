import importlib
import json
import os
import sys
import threading
import unittest
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler
from socketserver import TCPServer
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))
from runtime_harness import FakeWindow, install_fake_modules

sublime, _ = install_fake_modules()
api = importlib.import_module('PairOfCleats.lib.api_client')
config = importlib.import_module('PairOfCleats.lib.config')


class Handler(BaseHTTPRequestHandler):
    def respond(self):
        authorization = self.headers.get('Authorization')
        self.server.received.append((self.path, authorization))
        if self.server.redirect:
            self.send_response(302)
            self.send_header('Location', self.server.redirect)
            self.end_headers()
            return
        expected = self.server.expected
        authorized = expected is None or authorization == 'Bearer ' + expected
        body = json.dumps({'ok': True, 'result': {'code': [{'file': 'expected.js'}]},
            'status': {'repo': {'root': '/repo'}}} if authorized else {'ok': False, 'code': 'UNAUTHORIZED'}).encode('utf-8')
        self.send_response(200 if authorized else 401)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.respond()

    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length') or '0'))
        self.respond()

    def log_message(self, *_args):
        pass


@contextmanager
def server(expected=None, redirect=None):
    instance = TCPServer(('127.0.0.1', 0), Handler)
    instance.expected = expected
    instance.redirect = redirect
    instance.received = []
    thread = threading.Thread(target=instance.serve_forever, kwargs={'poll_interval': 0.02})
    thread.daemon = True
    thread.start()
    try:
        yield 'http://127.0.0.1:{0}'.format(instance.server_address[1]), instance
    finally:
        instance.shutdown()
        instance.server_close()
        thread.join(1)


def user_settings(endpoint, token=None):
    settings = sublime.load_settings(config.SETTINGS_FILE)
    settings.set('api_server_url', endpoint)
    settings.set('api_execution_mode', 'require')
    settings.set('env', {'PAIROFCLEATS_API_TOKEN': token} if token is not None else {})
    return config.get_settings(None)


class ApiAuthenticationTests(unittest.TestCase):
    def setUp(self):
        sublime.reset()
        self.environment = patch.dict(os.environ, {'PAIROFCLEATS_API_TOKEN': 'fixture-process-token'})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_authenticated_workflows_use_user_token(self):
        with server(expected='fixture-user-token') as (endpoint, instance):
            settings = user_settings(endpoint, 'fixture-user-token')
            result, _ = api.search_json(endpoint, '/repo', settings, 'needle', 'code')
            self.assertEqual(result['code'][0]['file'], 'expected.js')
            self.assertTrue(api.health_json(endpoint, settings)[0]['ok'])
            self.assertEqual(api.status_json(endpoint, '/repo', settings)[0]['repo']['root'], '/repo')
            self.assertEqual(len(instance.received), 3)
            self.assertTrue(all(auth == 'Bearer fixture-user-token' for _, auth in instance.received))

    def test_environment_token_and_project_override_authority(self):
        with server(expected='fixture-process-token') as (endpoint, instance):
            user_settings(endpoint)
            window = FakeWindow()
            window.set_project_data({'settings': {'pairofcleats': {
                'api_server_url': 'http://untrusted.invalid',
                'env': {'PAIROFCLEATS_API_TOKEN': 'project-secret'}}}})
            settings = config.get_settings(window)
            self.assertEqual(settings['api_server_url'], endpoint)
            self.assertNotIn('PAIROFCLEATS_API_TOKEN', settings['env'])
            self.assertTrue(api.health_json(endpoint, settings)[0]['ok'])
            self.assertEqual(instance.received[0][1], 'Bearer fixture-process-token')

    def test_other_destinations_and_missing_user_endpoint_receive_no_token(self):
        with server() as (endpoint, instance):
            settings = user_settings('http://127.0.0.1:1', 'fixture-user-token')
            # Even a caller-provided settings object cannot approve a new origin.
            settings['api_server_url'] = endpoint
            settings['env'] = {'PAIROFCLEATS_API_TOKEN': 'project-secret'}
            self.assertTrue(api.health_json(endpoint, settings)[0]['ok'])
            user_settings('')
            self.assertTrue(api.health_json(endpoint, settings)[0]['ok'])
            self.assertEqual([auth for _, auth in instance.received], [None, None])

    def test_origin_normalization_and_invalid_tokens(self):
        user_settings('https://EXAMPLE.com:443/api/', 'fixture-user-token')
        self.assertEqual(config.build_destination_bound_api_headers('https://example.com/health'),
            {'Authorization': 'Bearer fixture-user-token'})
        for destination in ('http://example.com/health', 'https://example.com:444/health',
                'https://other.example/health', 'https://user:password@example.com/',
                'ftp://example.com/', 'https://example.com:invalid/'):
            self.assertEqual(config.build_destination_bound_api_headers(destination), {})
        user_settings('https://user:password@example.com/', 'fixture-user-token')
        self.assertEqual(config.build_destination_bound_api_headers('https://example.com/'), {})
        user_settings('https://example.com/', 'fixture\r\ninvalid')
        with self.assertRaises(RuntimeError):
            config.build_destination_bound_api_headers('https://example.com/health')

    def test_delayed_original_destination_cannot_borrow_replacement_endpoint_credentials(self):
        with server() as (original_endpoint, original):
            with server(expected='replacement-user-token') as (replacement_endpoint, replacement):
                captured = user_settings(original_endpoint, 'original-user-token')
                user_settings(replacement_endpoint, 'replacement-user-token')
                self.assertTrue(api.health_json(original_endpoint, captured)[0]['ok'])
                self.assertEqual(original.received, [('/health', None)])
                self.assertTrue(api.health_json(replacement_endpoint, captured)[0]['ok'])
                self.assertEqual(replacement.received, [('/health', 'Bearer replacement-user-token')])
                user_settings('')
                self.assertTrue(api.health_json(original_endpoint, captured)[0]['ok'])
                self.assertEqual(original.received[-1], ('/health', None))

    def test_credential_redirects_never_reach_same_or_other_origin(self):
        with server() as (destination, sink):
            with server(redirect=destination + '/stolen') as (endpoint, redirector):
                refused = False
                try:
                    api.request_json(endpoint + '/health', headers={'Authorization': 'Bearer fixture-user-token'})
                except RuntimeError:
                    refused = True
                self.assertEqual(len(redirector.received), 1)
                self.assertEqual(sink.received, [], 'no redirected request or credentials leave the approved origin')
                self.assertTrue(refused, 'credential-bearing redirects must fail the request')
                redirector.redirect = endpoint + '/again'
                with self.assertRaises(RuntimeError):
                    api.request_json(endpoint + '/health', headers={'authorization': 'Bearer fixture-user-token'})
                self.assertEqual(len(redirector.received), 2, 'same-origin credential redirects are refused too')
            # Requests without credentials retain ordinary redirect behavior.
            with server(redirect=destination + '/public') as (endpoint, _):
                self.assertTrue(api.request_json(endpoint + '/health')[0]['ok'])
                self.assertEqual(sink.received, [('/public', None)])


def real_api(endpoint, repo, token):
    sublime.reset()
    settings = user_settings(endpoint, token)
    with patch.dict(os.environ, {'PAIROFCLEATS_API_TOKEN': 'fixture-wrong-environment-token'}):
        result, _ = api.search_json(endpoint, repo, settings, 'return', 'code', backend='memory', ann=False)
        assert result.get('code'), 'authenticated real API search must return indexed source'
        assert api.health_json(endpoint, settings)[0]['ok']
        assert api.status_json(endpoint, repo, settings)[0]['repo']['root']
        user_settings(endpoint, 'fixture-wrong-user-token')
        try:
            api.search_json(endpoint, repo, settings, 'return', 'code', backend='memory', ann=False)
        except RuntimeError as error:
            assert '(401)' in str(error), str(error)
        else:
            raise AssertionError('wrong user token must remain unauthorized; no CLI fallback')
    print('Real authenticated API search, health, status and wrong-token rejection passed.')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--real-api':
        real_api(*sys.argv[2:])
    else:
        unittest.main()
