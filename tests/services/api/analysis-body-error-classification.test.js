#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  analysisErrorRoutes,
  createAnalysisErrorResponseCapture
} from './analysis-error-classification-fixture.js';

const cases = [
  {
    name: 'risk explain malformed json returns 400',
    ...analysisErrorRoutes.riskExplain,
    expectedStatus: 400,
    errorCode: null
  },
  {
    name: 'context pack unsupported media type returns 415',
    ...analysisErrorRoutes.contextPack,
    expectedStatus: 415,
    errorCode: 'ERR_UNSUPPORTED_MEDIA_TYPE'
  },
  {
    name: 'risk delta oversized body returns 413',
    ...analysisErrorRoutes.riskDelta,
    expectedStatus: 413,
    errorCode: 'ERR_BODY_TOO_LARGE'
  }
];

for (const testCase of cases) {
  const { capture, response } = createAnalysisErrorResponseCapture();
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
