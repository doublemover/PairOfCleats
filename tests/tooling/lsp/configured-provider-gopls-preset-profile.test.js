#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';

applyTestEnv({ extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'configured-lsp-gopls-preset-profile');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'go.mod'), 'module example.com/poc-gopls-preset\n\ngo 1.22\n');
const goProbe = path.join(tempRoot, 'go-probe.js');
await fs.writeFile(goProbe, "process.stdout.write('example.com/poc-gopls-preset\\n');\n");

const restorePath = prependLspTestPath({ repoRoot: root });

try {
  const virtualPath = '.poc-vfs/src/sample.go#seg:stub.go';
  const docText = 'package sample\nfunc Add(a int, b int) int { return a + b }\n';
  await fs.writeFile(path.join(tempRoot, 'src', 'sample.go'), docText);
  const chunkUid = 'ck64:v1:test:src/sample.cpp:gopls-preset-profile';
  const fixtureServer = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
  const result = await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([tempRoot]),
    PAIROFCLEATS_TRUSTED_CONFIG: null }, () => runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      lsp: {
        enabled: true,
        servers: [{
          preset: 'gopls',
          cmd: process.execPath,
          args: [fixtureServer, '--mode', 'go'],
          languages: ['go'],
          goWorkspaceWarmup: false,
          goWorkspaceModuleCmd: process.execPath,
          goWorkspaceModuleArgs: [goProbe],
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
      languageId: 'go',
      effectiveExt: '.go',
      docHash: 'hash-stub'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid,
        chunkId: 'chunk_gopls_preset_profile',
        file: 'src/sample.go',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath,
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'Add', kind: 'function' },
      languageId: 'go'
    }],
    kinds: ['types']
  }));

  assert.ok(result.byChunkUid instanceof Map, 'expected tooling map output');
  assert.equal(result.byChunkUid.has(chunkUid), true, 'expected configured gopls preset provider to enrich target');
  const providerDiag = result.diagnostics?.['lsp-gopls'] || null;
  assert.ok(providerDiag && providerDiag.runtime, 'expected runtime diagnostics for configured gopls preset provider');

  console.log('configured LSP gopls preset profile test passed');
} finally {
  await restorePath();
}

