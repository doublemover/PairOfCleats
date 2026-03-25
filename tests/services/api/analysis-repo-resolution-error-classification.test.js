#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import {
  handleContextPackRoute,
  handleRiskDeltaRoute,
  handleRiskExplainRoute
} from '../../../tools/api/router/analysis.js';
import {
  createContextPackValidator,
  createRiskDeltaValidator,
  createRiskExplainValidator
} from '../../../tools/api/validation.js';

const validateContextPackPayload = createContextPackValidator();
const validateRiskDeltaPayload = createRiskDeltaValidator();
const validateRiskExplainPayload = createRiskExplainValidator();

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

const cases = [
  {
    name: 'risk explain invalid repo returns 400',
    handler: handleRiskExplainRoute,
    payload: { repoPath: 'bad-repo', chunk: 'chunk:test' },
    errorCode: ERROR_CODES.INVALID_REQUEST,
    expectedStatus: 400,
    expectedBodyCode: ERROR_CODES.INVALID_REQUEST,
    routeArgs: {
      validateRiskExplainPayload
    }
  },
  {
    name: 'risk explain forbidden repo returns 403',
    handler: handleRiskExplainRoute,
    payload: { repoPath: 'forbidden-repo', chunk: 'chunk:test' },
    errorCode: ERROR_CODES.FORBIDDEN,
    expectedStatus: 403,
    expectedBodyCode: ERROR_CODES.FORBIDDEN,
    routeArgs: {
      validateRiskExplainPayload
    }
  },
  {
    name: 'context pack invalid repo returns 400',
    handler: handleContextPackRoute,
    payload: { repoPath: 'bad-repo', seed: 'chunk:test', hops: 0 },
    errorCode: ERROR_CODES.INVALID_REQUEST,
    expectedStatus: 400,
    expectedBodyCode: ERROR_CODES.INVALID_REQUEST,
    routeArgs: {
      validateContextPackPayload,
      ensureWorkspaceAllowlist: async () => null
    }
  },
  {
    name: 'context pack forbidden repo returns 403',
    handler: handleContextPackRoute,
    payload: { repoPath: 'forbidden-repo', seed: 'chunk:test', hops: 0 },
    errorCode: ERROR_CODES.FORBIDDEN,
    expectedStatus: 403,
    expectedBodyCode: ERROR_CODES.FORBIDDEN,
    routeArgs: {
      validateContextPackPayload,
      ensureWorkspaceAllowlist: async () => null
    }
  },
  {
    name: 'risk delta invalid repo returns 400',
    handler: handleRiskDeltaRoute,
    payload: { repoPath: 'bad-repo', seed: 'chunk:test', from: 'a', to: 'b' },
    errorCode: ERROR_CODES.INVALID_REQUEST,
    expectedStatus: 400,
    expectedBodyCode: ERROR_CODES.INVALID_REQUEST,
    routeArgs: {
      validateRiskDeltaPayload
    }
  },
  {
    name: 'risk delta forbidden repo returns 403',
    handler: handleRiskDeltaRoute,
    payload: { repoPath: 'forbidden-repo', seed: 'chunk:test', from: 'a', to: 'b' },
    errorCode: ERROR_CODES.FORBIDDEN,
    expectedStatus: 403,
    expectedBodyCode: ERROR_CODES.FORBIDDEN,
    routeArgs: {
      validateRiskDeltaPayload
    }
  }
];

for (const testCase of cases) {
  const { capture, response } = createResponseCapture();
  const repoErr = new Error(`${testCase.name} repo failure`);
  repoErr.code = testCase.errorCode;

  const handled = await testCase.handler({
    req: {},
    res: response,
    corsHeaders: {},
    observability: null,
    parseJsonBody: async () => testCase.payload,
    resolveRepo: async () => {
      throw repoErr;
    },
    ...testCase.routeArgs
  });

  assert.equal(handled, true, `expected route to handle ${testCase.name}`);
  assert.equal(capture.statusCode, testCase.expectedStatus, `unexpected status for ${testCase.name}`);

  const body = JSON.parse(String(capture.body || '{}'));
  assert.equal(body.ok, false, `expected API error envelope for ${testCase.name}`);
  assert.equal(body.code, testCase.expectedBodyCode, `unexpected API code for ${testCase.name}`);
}

console.log('API analysis repo resolution error classification test passed');
