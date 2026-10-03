#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import {
  analysisErrorRoutes,
  createAnalysisErrorResponseCapture
} from './analysis-error-classification-fixture.js';

const cases = [
  {
    name: 'risk explain invalid repo returns 400',
    ...analysisErrorRoutes.riskExplain,
    payload: { repoPath: 'bad-repo', chunk: 'chunk:test' },
    errorCode: ERROR_CODES.INVALID_REQUEST,
    expectedStatus: 400,
    expectedBodyCode: ERROR_CODES.INVALID_REQUEST
  },
  {
    name: 'risk explain forbidden repo returns 403',
    ...analysisErrorRoutes.riskExplain,
    payload: { repoPath: 'forbidden-repo', chunk: 'chunk:test' },
    errorCode: ERROR_CODES.FORBIDDEN,
    expectedStatus: 403,
    expectedBodyCode: ERROR_CODES.FORBIDDEN
  },
  {
    name: 'context pack invalid repo returns 400',
    ...analysisErrorRoutes.contextPack,
    payload: { repoPath: 'bad-repo', seed: 'chunk:test', hops: 0 },
    errorCode: ERROR_CODES.INVALID_REQUEST,
    expectedStatus: 400,
    expectedBodyCode: ERROR_CODES.INVALID_REQUEST
  },
  {
    name: 'context pack forbidden repo returns 403',
    ...analysisErrorRoutes.contextPack,
    payload: { repoPath: 'forbidden-repo', seed: 'chunk:test', hops: 0 },
    errorCode: ERROR_CODES.FORBIDDEN,
    expectedStatus: 403,
    expectedBodyCode: ERROR_CODES.FORBIDDEN
  },
  {
    name: 'risk delta invalid repo returns 400',
    ...analysisErrorRoutes.riskDelta,
    payload: { repoPath: 'bad-repo', seed: 'chunk:test', from: 'a', to: 'b' },
    errorCode: ERROR_CODES.INVALID_REQUEST,
    expectedStatus: 400,
    expectedBodyCode: ERROR_CODES.INVALID_REQUEST
  },
  {
    name: 'risk delta forbidden repo returns 403',
    ...analysisErrorRoutes.riskDelta,
    payload: { repoPath: 'forbidden-repo', seed: 'chunk:test', from: 'a', to: 'b' },
    errorCode: ERROR_CODES.FORBIDDEN,
    expectedStatus: 403,
    expectedBodyCode: ERROR_CODES.FORBIDDEN
  }
];

for (const testCase of cases) {
  const { capture, response } = createAnalysisErrorResponseCapture();
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
