#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import {
  classifyBodyParseError,
  classifyRepoResolveError,
  classifyWorkspaceRequestError,
  parseJsonBodyOrSendError,
  resolveRepoOrSendError
} from '../../../tools/api/router/request-helpers.js';

const createResponseCapture = () => {
  const capture = {
    statusCode: null,
    headers: null,
    body: null
  };
  return {
    capture,
    response: {
      writeHead(statusCode, headers) {
        capture.statusCode = statusCode;
        capture.headers = headers;
      },
      end(body) {
        capture.body = body;
      }
    }
  };
};

const oversized = new Error('too large');
oversized.code = 'ERR_BODY_TOO_LARGE';
assert.deepEqual(
  classifyBodyParseError(oversized),
  { status: 413, code: ERROR_CODES.INVALID_REQUEST, message: 'too large' },
  'expected body-too-large to map to 413 INVALID_REQUEST'
);

const unsupported = new Error('bad type');
unsupported.code = 'ERR_UNSUPPORTED_MEDIA_TYPE';
assert.deepEqual(
  classifyBodyParseError(unsupported),
  { status: 415, code: ERROR_CODES.INVALID_REQUEST, message: 'bad type' },
  'expected unsupported media type to map to 415 INVALID_REQUEST'
);

const forbiddenRepo = new Error('repo forbidden');
forbiddenRepo.code = ERROR_CODES.FORBIDDEN;
assert.deepEqual(
  classifyRepoResolveError(forbiddenRepo),
  { status: 403, code: ERROR_CODES.FORBIDDEN, message: 'repo forbidden' },
  'expected forbidden repo resolution to map to 403 FORBIDDEN'
);

const invalidWorkspace = new Error('Workspace path not permitted by server configuration.');
assert.deepEqual(
  classifyWorkspaceRequestError(invalidWorkspace),
  {
    status: 403,
    code: ERROR_CODES.FORBIDDEN,
    message: 'Workspace path not permitted by server configuration.'
  },
  'expected workspace allowlist violations to map to 403 FORBIDDEN'
);

{
  const { capture, response } = createResponseCapture();
  const result = await parseJsonBodyOrSendError(
    {},
    response,
    async () => {
      throw unsupported;
    },
    {}
  );
  assert.equal(result.ok, false, 'expected parse helper to stop on parse error');
  assert.equal(capture.statusCode, 415, 'expected parse helper to emit 415');
  assert.equal(JSON.parse(String(capture.body || '{}')).code, ERROR_CODES.INVALID_REQUEST);
}

{
  const { capture, response } = createResponseCapture();
  const result = await resolveRepoOrSendError(
    response,
    async () => {
      throw forbiddenRepo;
    },
    'repo',
    {}
  );
  assert.equal(result.ok, false, 'expected repo helper to stop on repo resolution error');
  assert.equal(capture.statusCode, 403, 'expected repo helper to emit 403');
  assert.equal(JSON.parse(String(capture.body || '{}')).code, ERROR_CODES.FORBIDDEN);
}

console.log('API request helpers test passed');
