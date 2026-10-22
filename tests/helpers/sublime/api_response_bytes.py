import importlib
import io
import os
import sys
import urllib.error
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))
from runtime_harness import install_fake_modules

install_fake_modules()
api = importlib.import_module('PairOfCleats.lib.api_client')


class RecordingResponse(io.BytesIO):
    def __init__(self, body, status=200, headers=None, after_read=None):
        super(RecordingResponse, self).__init__(body)
        self.headers = headers or {}
        self.status = status
        self.reads = []
        self.after_read = after_read

    def getcode(self):
        return self.status

    def read(self, size=-1):
        if size < 0:
            raise AssertionError('Unbounded read is forbidden.')
        self.reads.append(size)
        value = super(RecordingResponse, self).read(size)
        if self.after_read:
            self.after_read()
        return value


class ApiResponseBytes(unittest.TestCase):
    def open_response(self, response, error=False):
        opener = unittest.mock.Mock()
        if error:
            opener.open.side_effect = urllib.error.HTTPError('http://fixture.invalid', response.status,
                'failure', response.headers, response)
        else:
            opener.open.return_value = response
        return patch.object(api.urllib.request, 'build_opener', return_value=opener)

    def test_exact_limit_and_multibyte(self):
        body = '{"value":"🙂é"}'.encode('utf-8')
        response = RecordingResponse(body)
        with self.open_response(response), patch.object(api, 'MAX_RESPONSE_BYTES', len(body)), \
                patch.object(api, '_RESPONSE_BLOCK_BYTES', 1):
            self.assertEqual(api.request_json('http://fixture.invalid')[0], {'value': '🙂é'})
        self.assertTrue(response.closed)
        self.assertEqual(response.reads, [1] * (len(body) + 1))

    def test_success_and_error_overflow_stop_and_close(self):
        for status in (200, 401, 403, 500):
            for headers in ({}, {'Content-Length': '1'}, {'Content-Length': '8'}):
                response = RecordingResponse(b'x' * 100, status, headers)
                with self.open_response(response, error=status != 200), patch.object(api, 'MAX_RESPONSE_BYTES', 8):
                    with self.assertRaises(api.ApiResponseTooLarge) as caught:
                        api.request_json('http://fixture.invalid')
                self.assertEqual(response.reads, [9])
                self.assertTrue(response.closed)
                self.assertEqual(caught.exception.code, 'api-response-too-large')
                self.assertLessEqual(len(caught.exception.preview), 9)

    def test_credible_header_refuses_before_read(self):
        for length in ('9', '0' * 10000 + '9', '9' * 10000):
            response = RecordingResponse(b'x' * 100, headers={'Content-Length': length})
            with self.open_response(response), patch.object(api, 'MAX_RESPONSE_BYTES', 8):
                with self.assertRaises(api.ApiResponseTooLarge):
                    api.request_json('http://fixture.invalid')
            self.assertEqual(response.reads, [])
            self.assertTrue(response.closed)

    def test_cancellation_during_read_closes_and_clears_owner(self):
        handle = api.ApiHandle(None)
        response = RecordingResponse(b'{}', after_read=handle.cancel)
        api._REQUEST_CONTEXT.handle = handle
        try:
            with self.open_response(response):
                with self.assertRaisesRegex(RuntimeError, 'cancelled'):
                    api.request_json('http://fixture.invalid')
            self.assertTrue(response.closed)
            self.assertIsNone(handle.response)
            self.assertEqual(len(response.reads), 1)
        finally:
            del api._REQUEST_CONTEXT.handle

    def test_error_and_malformed_contracts_remain_distinct(self):
        response = RecordingResponse(b'bad json')
        with self.open_response(response):
            with self.assertRaisesRegex(RuntimeError, 'invalid JSON'):
                api.request_json('http://fixture.invalid')
        response = RecordingResponse(b'forbidden', 403)
        with self.open_response(response, error=True):
            with self.assertRaisesRegex(RuntimeError, r'\(403\): forbidden'):
                api.request_json('http://fixture.invalid')
        self.assertTrue(response.closed)


if __name__ == '__main__':
    unittest.main()
