#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createApiRouter } from '../../../tools/api/router.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'api-router');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const router = createApiRouter({
  host: '127.0.0.1',
  defaultRepo: tempRoot,
  defaultOutput: 'json',
  metricsRegistry: null
});

const server = http.createServer((req, res) => router.handleRequest(req, res));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

const response = await fetch(`http://127.0.0.1:${port}/missing`);
const payload = await response.json();

assert.equal(payload.ok, false, 'expected error payload');
assert.ok(payload.code, 'expected error code in payload');
assert.ok(payload.namespaceCode, 'expected namespaced error code in payload');
assert.ok(typeof payload.hint === 'string' && payload.hint.length > 0, 'expected error hint in payload');

server.close();
if (typeof router.close === 'function') router.close();

console.log('api router smoke test passed');
