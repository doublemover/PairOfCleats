#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { handleContextPackRoute } from '../../../tools/api/router/analysis.js';
import {
  createContextPackRouteFixture,
  readCapturedJson
} from './context-pack-route-fixture.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-api-context-pack-default-repo-'));
const {
  capture,
  response,
  resolveRepoCalls,
  parseJsonBody,
  validateContextPackPayload
} = createContextPackRouteFixture();

const handled = await handleContextPackRoute({
  req: {},
  res: response,
  corsHeaders: {},
  observability: null,
  parseJsonBody,
  resolveRepo: async (repo) => {
    resolveRepoCalls.push(repo);
    return tempRoot;
  },
  validateContextPackPayload,
  ensureWorkspaceAllowlist: async () => null
});

assert.equal(handled, true, 'expected context-pack route to handle request');
assert.deepEqual(
  resolveRepoCalls,
  [''],
  'single-repo context-pack requests should resolve the default repo when no repoPath/workspacePath is provided'
);
assert.equal(capture.statusCode, 404, 'expected missing index at resolved default repo to surface as 404');

const body = readCapturedJson(capture);
assert.equal(body.ok, false, 'expected API error envelope');
assert.equal(body.code, 'NO_INDEX');
assert.match(String(body.message || ''), /Code index not found/i);

console.log('API context-pack default repo resolution test passed');
