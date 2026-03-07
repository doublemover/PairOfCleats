#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = resolveTestCachePath(root, 'clangd-preflight-no-compile-commands-inference-disabled');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'src', 'one.c'), 'int alpha(void) { return 1; }\n', 'utf8');

const fixtureCmd = path.join(
  root,
  'tests',
  'fixtures',
  'lsp',
  'bin',
  process.platform === 'win32' ? 'clangd.cmd' : 'clangd'
);
await fs.access(fixtureCmd);

registerDefaultToolingProviders();

const chunkUid = 'ck:test:clangd-preflight-no-compile-commands:1';
const docText = 'int alpha(void) { return 1; }\n';
const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['clangd'],
    clangd: {
      cmd: fixtureCmd,
      autoInferIncludeRoots: false
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: 'src/one.c',
    text: docText,
    languageId: 'c',
    effectiveExt: '.c',
    docHash: 'hash-clangd-preflight-no-compile-commands'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_clangd_preflight_no_compile_commands',
      file: 'src/one.c',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: 'src/one.c',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'alpha', kind: 'function' },
    languageId: 'c'
  }],
  kinds: ['types']
});

assert.equal(result.byChunkUid.has(chunkUid), true, 'expected clangd output even with degraded preflight');
const diagnostics = result.diagnostics?.clangd || {};
assert.equal(diagnostics?.preflight?.state, 'degraded', 'expected clangd preflight degraded state');
assert.equal(
  diagnostics?.preflight?.reasonCode,
  'clangd_compile_commands_missing_inference_disabled',
  'expected compile_commands/inference-disabled reason code'
);
const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
assert.equal(
  checks.some((check) => check?.name === 'clangd_compile_commands_missing_inference_disabled'),
  true,
  'expected compile_commands/inference-disabled warning check'
);

console.log('clangd preflight compile_commands missing with inference disabled test passed');
