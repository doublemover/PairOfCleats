#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `jdtls-provider-guard-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });

const restorePath = prependLspTestPath({ repoRoot: root });

try {
  registerDefaultToolingProviders();
  const docText = 'class App { int add(int a, int b) { return a + b; } }\n';
  const chunkUid = 'ck64:v1:test:src/App.java:jdtls-guard';
  const result = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      enabledTools: ['jdtls'],
      jdtls: {
        enabled: true
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
      docHash: 'hash-jdtls-guard'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid,
        chunkId: 'chunk_jdtls_guard',
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

  assert.equal(result.byChunkUid.has(chunkUid), false, 'expected guard to skip jdtls without workspace model');
  const checks = Array.isArray(result.diagnostics?.jdtls?.checks) ? result.diagnostics.jdtls.checks : [];
  assert.equal(
    checks.some((check) => check?.name === 'jdtls_workspace_model_missing'),
    true,
    'expected jdtls workspace model guard check'
  );

  console.log('jdtls provider workspace guard test passed');
} finally {
  restorePath();
}
