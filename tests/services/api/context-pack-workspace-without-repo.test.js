#!/usr/bin/env node
import assert from 'node:assert/strict';

import { handleContextPackRoute } from '../../../tools/api/router/analysis.js';
import {
  createContextPackRouteFixture,
  createMinimalContextPackPayload,
  readCapturedJson
} from './context-pack-route-fixture.js';

const payload = createMinimalContextPackPayload({
  workspacePath: 'C:\\workspace\\.pairofcleats-workspace.jsonc',
  workspaceId: 'workspace-test'
});
const {
  capture,
  response,
  resolveRepoCalls,
  parseJsonBody,
  validateContextPackPayload
} = createContextPackRouteFixture(payload);

const handled = await handleContextPackRoute({
  req: {},
  res: response,
  corsHeaders: {},
  observability: null,
  parseJsonBody,
  resolveRepo: async (repo) => {
    resolveRepoCalls.push(repo);
    return `RESOLVED:${repo}`;
  },
  validateContextPackPayload,
  ensureWorkspaceAllowlist: async () => ({
    repoSetId: 'workspace-test',
    workspacePath: payload.workspacePath,
    repos: []
  })
});

assert.equal(handled, true, 'expected context-pack route to handle request');
assert.deepEqual(
  resolveRepoCalls,
  [],
  'workspace-only context-pack requests should not resolve an implicit repo'
);
assert.equal(capture.statusCode, 400, 'expected empty trusted workspace config to fail as invalid request');

const body = readCapturedJson(capture);
assert.equal(body.ok, false, 'expected API error envelope');
assert.equal(body.code, 'INVALID_REQUEST');
assert.match(String(body.message || ''), /zero repositories/i);

console.log('API context-pack workspace-without-repo test passed');
