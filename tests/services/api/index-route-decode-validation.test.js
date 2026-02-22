#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import { handleIndexDiffsRoute } from '../../../tools/api/router/index-diffs.js';
import { handleIndexSnapshotsRoute } from '../../../tools/api/router/index-snapshots.js';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';

applyTestEnv();

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

const repoPath = process.cwd();

const diffResponse = createMockResponse();
const diffHandled = await handleIndexDiffsRoute({
  req: { method: 'GET' },
  res: diffResponse.res,
  requestUrl: new URL(`http://127.0.0.1/index/diffs/%E0%A4%A/events?repo=${encodeURIComponent(repoPath)}`),
  pathname: '/index/diffs/%E0%A4%A/events',
  corsHeaders: {},
  resolveRepo: async () => repoPath
});
assert.equal(diffHandled, true, 'diff route should claim malformed diff-id requests');
assert.equal(diffResponse.statusCode, 400, 'diff route should map malformed URI escapes to 400');
assert.equal(diffResponse.json?.code, ERROR_CODES.INVALID_REQUEST, 'diff route should return INVALID_REQUEST');

const snapshotResponse = createMockResponse();
const snapshotHandled = await handleIndexSnapshotsRoute({
  req: { method: 'GET' },
  res: snapshotResponse.res,
  requestUrl: new URL(`http://127.0.0.1/index/snapshots/%E0%A4%A?repo=${encodeURIComponent(repoPath)}`),
  pathname: '/index/snapshots/%E0%A4%A',
  corsHeaders: {},
  resolveRepo: async () => repoPath,
  parseJsonBody: async () => null
});
assert.equal(snapshotHandled, true, 'snapshot route should claim malformed snapshot-id requests');
assert.equal(snapshotResponse.statusCode, 400, 'snapshot route should map malformed URI escapes to 400');
assert.equal(
  snapshotResponse.json?.code,
  ERROR_CODES.INVALID_REQUEST,
  'snapshot route should return INVALID_REQUEST'
);

console.log('Index route decode validation test passed');
