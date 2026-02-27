#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `jdtls-provider-bootstrap-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'pom.xml'), '<project/>', 'utf8');

const restorePath = prependLspTestPath({ repoRoot: root });

try {
  registerDefaultToolingProviders();
  const docText = 'class App { int add(int a, int b) { return a + b; } }\n';
  const chunkUid = 'ck64:v1:test:src/App.java:jdtls-bootstrap';
  const result = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      enabledTools: ['jdtls'],
      lifecycle: {
        lifecycleRestartWindowMs: 60000
      },
      jdtls: {
        enabled: true,
        lifecycle: {
          restartWindowMs: 2100,
          maxRestartsPerWindow: 5,
          fdPressureBackoffMs: 250
        }
      }
    },
    cache: {
      enabled: false
    }
  }, {
    documents: [{
      virtualPath: 'src/App.java',
      text: docText,
      languageId: 'java',
      effectiveExt: '.java',
      docHash: 'hash-jdtls-bootstrap'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid,
        chunkId: 'chunk_jdtls_bootstrap',
        file: 'src/App.java',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: 'src/App.java',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'add', kind: 'function' },
      languageId: 'java'
    }],
    kinds: ['types']
  });

  assert.equal(result.byChunkUid.has(chunkUid), true, 'expected jdtls provider to enrich Java symbol');
  const providerDiag = result.diagnostics?.jdtls || null;
  assert.ok(providerDiag && providerDiag.runtime, 'expected runtime diagnostics for jdtls provider');
  assert.equal(providerDiag.runtime?.lifecycle?.restartWindowMs, 2100, 'expected provider lifecycle override');
  assert.equal(providerDiag.runtime?.lifecycle?.maxRestartsPerWindow, 5, 'expected provider max restarts');
  assert.equal(providerDiag.runtime?.lifecycle?.fdPressureBackoffMs, 250, 'expected provider fd backoff');
  const checks = Array.isArray(providerDiag?.checks) ? providerDiag.checks : [];
  assert.equal(
    checks.some((check) => check?.name === 'jdtls_workspace_model_missing'),
    false,
    'workspace marker guard should not trigger when pom.xml exists'
  );

  console.log('jdtls provider bootstrap test passed');
} finally {
  restorePath();
}
