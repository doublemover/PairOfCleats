#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';


import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'configured-lsp-gopls-profile');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const restorePath = prependLspTestPath({ repoRoot: root });

try {
  const virtualPath = '.poc-vfs/src/sample.cpp#seg:stub.cpp';
  const docText = 'int add(int a, int b) { return a + b; }\n';
  const chunkUid = 'ck64:v1:test:src/sample.cpp:gopls-profile';
  const fixtureGoplsCmd = path.join(
    root,
    'tests',
    'fixtures',
    'lsp',
    'bin',
    process.platform === 'win32' ? 'gopls.cmd' : 'gopls'
  );
  const result = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      timeoutMs: 47000,
      maxRetries: 4,
      circuitBreakerThreshold: 6,
      lifecycle: {
        lifecycleRestartWindowMs: 65000
      },
      lsp: {
        enabled: true,
        lifecycle: {
          lifecycleMaxRestartsPerWindow: 7,
          lifecycleFdPressureBackoffMs: 900
        },
        servers: [{
          id: 'gopls',
          cmd: fixtureGoplsCmd,
          args: [],
          languages: ['cpp'],
          uriScheme: 'poc-vfs'
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
      languageId: 'cpp',
      effectiveExt: '.cpp',
      docHash: 'hash-stub'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid,
        chunkId: 'chunk_gopls_profile',
        file: 'src/sample.cpp',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath,
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'add', kind: 'function' },
      languageId: 'cpp'
    }],
    kinds: ['types']
  });

  assert.ok(result.byChunkUid instanceof Map, 'expected tooling map output');
  assert.equal(result.byChunkUid.has(chunkUid), true, 'expected configured gopls provider to enrich target');
  const providerDiag = result.diagnostics?.['lsp-gopls'] || null;
  assert.ok(providerDiag && providerDiag.runtime, 'expected runtime diagnostics for configured gopls provider');
  assert.equal(providerDiag.runtime?.guard?.breakerThreshold, 6, 'expected global breaker threshold');
  assert.equal(providerDiag.runtime?.lifecycle?.restartWindowMs, 65000, 'expected top-level lifecycle restart window');
  assert.equal(providerDiag.runtime?.lifecycle?.maxRestartsPerWindow, 7, 'expected lsp-scope lifecycle max restarts');
  assert.equal(providerDiag.runtime?.lifecycle?.fdPressureBackoffMs, 900, 'expected lsp-scope fd backoff');

  console.log('configured LSP gopls profile test passed');
} finally {
  await restorePath();
}

