#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import { handleIndexDiffsRoute } from '../../../tools/api/router/index-diffs.js';
import { handleIndexSnapshotsRoute } from '../../../tools/api/router/index-snapshots.js';

const createMockResponse = () => {
  const state = {
    statusCode: 0,
    headers: {},
    body: ''
  };
  return {
    res: {
      writeHead(statusCode, headers) {
        state.statusCode = Number(statusCode) || 0;
        state.headers = headers || {};
      },
      end(chunk = '') {
        state.body += String(chunk || '');
      }
    },
    get statusCode() {
      return state.statusCode;
    },
    get json() {
      return state.body ? JSON.parse(state.body) : null;
    }
  };
};

const invalidRepoError = new Error('bad repo');
invalidRepoError.code = ERROR_CODES.INVALID_REQUEST;
const forbiddenRepoError = new Error('forbidden repo');
forbiddenRepoError.code = ERROR_CODES.FORBIDDEN;
const oversizedBodyError = new Error('body too large');
oversizedBodyError.code = 'ERR_BODY_TOO_LARGE';

{
  const response = createMockResponse();
  const handled = await handleIndexDiffsRoute({
    req: { method: 'GET' },
    res: response.res,
    requestUrl: new URL('http://127.0.0.1/index/diffs?repo=bad'),
    pathname: '/index/diffs',
    corsHeaders: {},
    resolveRepo: async () => {
      throw invalidRepoError;
    }
  });
  assert.equal(handled, true, 'diff route should claim invalid repo requests');
  assert.equal(response.statusCode, 400, 'diff route should map invalid repo to 400');
  assert.equal(response.json?.code, ERROR_CODES.INVALID_REQUEST);
}

{
  const response = createMockResponse();
  const handled = await handleIndexSnapshotsRoute({
    req: { method: 'GET' },
    res: response.res,
    requestUrl: new URL('http://127.0.0.1/index/snapshots?repo=forbidden'),
    pathname: '/index/snapshots',
    corsHeaders: {},
    resolveRepo: async () => {
      throw forbiddenRepoError;
    },
    parseJsonBody: async () => null
  });
  assert.equal(handled, true, 'snapshot route should claim forbidden repo requests');
  assert.equal(response.statusCode, 403, 'snapshot route should map forbidden repo to 403');
  assert.equal(response.json?.code, ERROR_CODES.FORBIDDEN);
}

{
  const response = createMockResponse();
  const handled = await handleIndexSnapshotsRoute({
    req: { method: 'POST' },
    res: response.res,
    requestUrl: new URL('http://127.0.0.1/index/snapshots'),
    pathname: '/index/snapshots',
    corsHeaders: {},
    resolveRepo: async () => process.cwd(),
    parseJsonBody: async () => {
      throw oversizedBodyError;
    }
  });
  assert.equal(handled, true, 'snapshot route should claim oversized body requests');
  assert.equal(response.statusCode, 413, 'snapshot route should map oversized body to 413');
  assert.equal(response.json?.code, ERROR_CODES.INVALID_REQUEST);
}

console.log('Index route client error classification test passed');
