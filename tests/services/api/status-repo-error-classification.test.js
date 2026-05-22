#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import { createApiRouter } from '../../../tools/api/router.js';
import { parseSseEvents } from '../../helpers/api-server.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'api-status-repo-error-classification');
const allowedRepo = path.join(tempRoot, 'allowed');
const forbiddenRepo = path.join(tempRoot, 'forbidden');
const missingRepo = path.join(allowedRepo, 'missing');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(allowedRepo, { recursive: true });
await fs.mkdir(forbiddenRepo, { recursive: true });

const router = createApiRouter({
  host: '127.0.0.1',
  defaultRepo: allowedRepo,
  defaultOutput: 'json',
  metricsRegistry: null
});
const server = http.createServer((req, res) => router.handleRequest(req, res));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

const requestJson = async (requestPath) => {
  const response = await fetch(`http://127.0.0.1:${port}${requestPath}`);
  return {
    status: response.status,
    body: await response.json()
  };
};

const requestSse = async (requestPath) => {
  const response = await fetch(`http://127.0.0.1:${port}${requestPath}`);
  return {
    status: response.status,
    events: parseSseEvents(await response.text())
  };
};

try {
  const missingStatus = await requestJson(`/status?repo=${encodeURIComponent(missingRepo)}`);
  assert.equal(missingStatus.status, 400, 'status should map missing allowed repo to 400');
  assert.equal(missingStatus.body?.code, ERROR_CODES.INVALID_REQUEST);

  const forbiddenStatus = await requestJson(`/status?repo=${encodeURIComponent(forbiddenRepo)}`);
  assert.equal(forbiddenStatus.status, 403, 'status should map forbidden repo to 403');
  assert.equal(forbiddenStatus.body?.code, ERROR_CODES.FORBIDDEN);

  const missingStream = await requestSse(`/status/stream?repo=${encodeURIComponent(missingRepo)}`);
  const missingStreamError = missingStream.events.find((entry) => entry.event === 'error');
  assert.equal(missingStream.status, 200, 'status stream should return SSE envelope status');
  assert.equal(missingStreamError?.data?.code, ERROR_CODES.INVALID_REQUEST);

  const forbiddenStream = await requestSse(`/status/stream?repo=${encodeURIComponent(forbiddenRepo)}`);
  const forbiddenStreamError = forbiddenStream.events.find((entry) => entry.event === 'error');
  assert.equal(forbiddenStream.status, 200, 'status stream should return SSE envelope status');
  assert.equal(forbiddenStreamError?.data?.code, ERROR_CODES.FORBIDDEN);
} finally {
  await new Promise((resolve) => server.close(resolve));
  if (typeof router.close === 'function') {
    router.close();
  }
}

console.log('API status repo error classification test passed');
