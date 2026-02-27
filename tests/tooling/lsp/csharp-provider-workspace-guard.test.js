#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `csharp-provider-guard-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });

const restorePath = prependLspTestPath({ repoRoot: root });

try {
  registerDefaultToolingProviders();
  const docText = 'class App { string Greet(string name) => name; }\n';
  const chunkUid = 'ck64:v1:test:src/App.cs:csharp-guard';
  const result = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      enabledTools: ['csharp-ls'],
      csharp: {
        enabled: true
      }
    },
    cache: {
      enabled: false
    }
  }, {
    documents: [{
      virtualPath: 'src/App.cs',
      text: docText,
      languageId: 'csharp',
      effectiveExt: '.cs',
      docHash: 'hash-csharp-guard'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid,
        chunkId: 'chunk_csharp_guard',
        file: 'src/App.cs',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: 'src/App.cs',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'Greet', kind: 'function' },
      languageId: 'csharp'
    }],
    kinds: ['types']
  });

  assert.equal(result.byChunkUid.has(chunkUid), false, 'expected guard to skip csharp-ls without workspace model');
  const checks = Array.isArray(result.diagnostics?.['csharp-ls']?.checks) ? result.diagnostics['csharp-ls'].checks : [];
  assert.equal(
    checks.some((check) => check?.name === 'csharp_workspace_model_missing'),
    true,
    'expected csharp workspace model guard check'
  );

  console.log('csharp provider workspace guard test passed');
} finally {
  restorePath();
}
