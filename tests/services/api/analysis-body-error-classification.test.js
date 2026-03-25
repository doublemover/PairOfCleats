#!/usr/bin/env node
import assert from 'node:assert/strict';

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
    name: 'risk explain malformed json returns 400',
    handler: handleRiskExplainRoute,
    expectedStatus: 400,
    errorCode: null,
    routeArgs: {
      validateRiskExplainPayload
    }
  },
  {
    name: 'context pack unsupported media type returns 415',
    handler: handleContextPackRoute,
    expectedStatus: 415,
    errorCode: 'ERR_UNSUPPORTED_MEDIA_TYPE',
    routeArgs: {
      validateContextPackPayload,
      ensureWorkspaceAllowlist: async () => null
    }
  },
  {
    name: 'risk delta oversized body returns 413',
    handler: handleRiskDeltaRoute,
    expectedStatus: 413,
    errorCode: 'ERR_BODY_TOO_LARGE',
    routeArgs: {
      validateRiskDeltaPayload
    }
  }
];

for (const testCase of cases) {
  const { capture, response } = createResponseCapture();
  let resolveRepoCalled = false;
  const err = new Error(`${testCase.name} parse failure`);
  if (testCase.errorCode) err.code = testCase.errorCode;

  const handled = await testCase.handler({
    req: {},
    res: response,
    corsHeaders: {},
    observability: null,
    parseJsonBody: async () => {
      throw err;
    },
    resolveRepo: async () => {
      resolveRepoCalled = true;
      return 'unused';
    },
    ...testCase.routeArgs
  });

  assert.equal(handled, true, `expected route to handle ${testCase.name}`);
  assert.equal(resolveRepoCalled, false, `expected parse failure to short-circuit repo resolution for ${testCase.name}`);
  assert.equal(capture.statusCode, testCase.expectedStatus, `unexpected status for ${testCase.name}`);

  const body = JSON.parse(String(capture.body || '{}'));
  assert.equal(body.ok, false, `expected API error envelope for ${testCase.name}`);
  assert.equal(body.code, 'INVALID_REQUEST', `expected INVALID_REQUEST code for ${testCase.name}`);
}

console.log('API analysis body error classification test passed');
