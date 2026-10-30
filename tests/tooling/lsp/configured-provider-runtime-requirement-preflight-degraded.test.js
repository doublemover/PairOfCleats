#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { resolveRuntimeRequirementsPreflight } from '../../../src/index/tooling/preflight/runtime-requirements-preflight.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-runtime-req-preflight-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const virtualPath = '.poc-vfs/src/sample.yaml#seg:runtime-req-preflight.txt';
const docText = 'name: runtime\n';
const chunkUid = 'ck64:v1:test:src/sample.yaml:runtime-req-preflight';

const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-runtime-req-preflight'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'runtime-req-preflight',
        cmd: process.execPath,
        args: [serverPath],
        languages: ['yaml'],
        preflightRuntimeRequirements: [{
          id: 'missing-runtime',
          cmd: 'definitely-missing-runtime-requirement-command',
          args: ['--version'],
          label: 'Missing Runtime'
        }]
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath,
    text: docText,
    languageId: 'yaml',
    effectiveExt: '.yaml',
    docHash: 'hash-runtime-req-preflight'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_runtime_req_preflight',
      file: 'src/sample.yaml',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath,
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'add', kind: 'function' },
    languageId: 'yaml'
  }],
  kinds: ['types']
});

const diagnostics = result.diagnostics?.['lsp-runtime-req-preflight'] || {};
assert.equal(
  diagnostics?.preflight?.state,
  'degraded',
  'expected runtime requirement preflight degraded state'
);
assert.equal(
  diagnostics?.preflight?.reasonCode,
  'preflight_runtime_requirement_missing',
  'expected preflight reasonCode for missing runtime requirement'
);
const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
assert.equal(
  checks.some((check) => String(check?.name || '').includes('_runtime_missing-runtime_missing')),
  true,
  'expected runtime requirement missing warning check'
);

// Absence is a degraded prerequisite, never a trust or executable-authority
// grant. Existing-but-untrusted and ineligible command paths must stay blocked.
const deniedCommand = path.join(tempRoot, process.platform === 'win32' ? 'untrusted-runtime.cmd' : 'untrusted-runtime');
await fs.writeFile(deniedCommand, process.platform === 'win32' ? '@echo unexpected execution\r\n' : '#!/bin/sh\necho unexpected execution\n', { mode: 0o755 });
const invalidCommand = path.join(tempRoot, 'directory-runtime');
await fs.mkdir(invalidCommand);
for (const command of [deniedCommand, invalidCommand]) {
  const classified = resolveRuntimeRequirementsPreflight({ ctx: { repoRoot: tempRoot, toolingConfig: {} },
    providerId: 'fixture-runtime', requirements: [{ id: 'fixture', cmd: command, args: ['--version'] }] });
  assert.equal(classified.state, 'blocked');
  assert.equal(classified.blockProvider, true);
  assert.equal(classified.reasonCode, 'preflight_runtime_requirement_denied');
}
console.log('configured LSP missing-runtime degradation preserves trust and executable admission negatives');
