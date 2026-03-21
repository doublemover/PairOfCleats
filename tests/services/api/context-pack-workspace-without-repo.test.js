#!/usr/bin/env node
import assert from 'node:assert/strict';

import { handleContextPackRoute } from '../../../tools/api/router/analysis.js';
import { createContextPackValidator } from '../../../tools/api/validation.js';

const validateContextPackPayload = createContextPackValidator();

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

const { capture, response } = createResponseCapture();
const resolveRepoCalls = [];
const payload = {
  workspacePath: 'C:\\workspace\\.pairofcleats-workspace.jsonc',
  workspaceId: 'workspace-test',
  seed: 'chunk:ck64:v1:test:src/file.js:0000000000000001',
  hops: 0,
  includeGraph: false,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false
};

const handled = await handleContextPackRoute({
  req: {},
  res: response,
  corsHeaders: {},
  observability: null,
  parseJsonBody: async () => payload,
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

const body = JSON.parse(String(capture.body || '{}'));
assert.equal(body.ok, false, 'expected API error envelope');
assert.equal(body.code, 'INVALID_REQUEST');
assert.match(String(body.message || ''), /zero repositories/i);

console.log('API context-pack workspace-without-repo test passed');
