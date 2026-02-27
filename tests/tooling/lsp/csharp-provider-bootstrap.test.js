#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `csharp-provider-bootstrap-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'App.csproj'), '<Project/>', 'utf8');
const fixtureCsharpCmd = path.join(
  root,
  'tests',
  'fixtures',
  'lsp',
  'bin',
  process.platform === 'win32' ? 'csharp-ls.cmd' : 'csharp-ls'
);

const restorePath = prependLspTestPath({ repoRoot: root });

try {
  registerDefaultToolingProviders();
  const docText = 'class App { string Greet(string name) => name; }\n';
  const chunkUid = 'ck64:v1:test:src/App.cs:csharp-bootstrap';
  const result = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      enabledTools: ['csharp-ls'],
      csharp: {
        enabled: true,
        cmd: fixtureCsharpCmd
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
      docHash: 'hash-csharp-bootstrap'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid,
        chunkId: 'chunk_csharp_bootstrap',
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

  assert.equal(result.byChunkUid.has(chunkUid), true, 'expected csharp provider to enrich C# symbol');
  const providerDiag = result.diagnostics?.['csharp-ls'] || null;
  assert.ok(providerDiag && providerDiag.runtime, 'expected runtime diagnostics for csharp provider');
  const checks = Array.isArray(providerDiag?.checks) ? providerDiag.checks : [];
  assert.equal(
    checks.some((check) => check?.name === 'csharp_workspace_model_missing'),
    false,
    'workspace marker guard should not trigger when csproj exists'
  );

  console.log('csharp provider bootstrap test passed');
} finally {
  restorePath();
}
