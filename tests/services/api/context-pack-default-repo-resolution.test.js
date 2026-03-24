#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-api-context-pack-default-repo-'));
const { capture, response } = createResponseCapture();
const resolveRepoCalls = [];

const handled = await handleContextPackRoute({
  req: {},
  res: response,
  corsHeaders: {},
  observability: null,
  parseJsonBody: async () => ({
    seed: 'chunk:ck64:v1:test:src/file.js:0000000000000001',
    hops: 0,
    includeGraph: false,
    includeImports: false,
    includeUsages: false,
    includeCallersCallees: false
  }),
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

const body = JSON.parse(String(capture.body || '{}'));
assert.equal(body.ok, false, 'expected API error envelope');
assert.equal(body.code, 'NO_INDEX');
assert.match(String(body.message || ''), /Code index not found/i);

console.log('API context-pack default repo resolution test passed');
