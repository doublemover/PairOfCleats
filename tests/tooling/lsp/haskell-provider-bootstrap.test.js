#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `haskell-provider-bootstrap-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'stack.yaml'), 'resolver: lts-22.0\n', 'utf8');
const fixtureHaskellCmd = path.join(
  root,
  'tests',
  'fixtures',
  'lsp',
  'bin',
  process.platform === 'win32' ? 'haskell-language-server.cmd' : 'haskell-language-server'
);

const restorePath = prependLspTestPath({ repoRoot: root });

try {
  registerDefaultToolingProviders();
  const docText = 'greet :: Text -> Text\ngreet name = name\n';
  const chunkUid = 'ck64:v1:test:src/Main.hs:haskell-bootstrap';
  const result = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      enabledTools: ['haskell-language-server'],
      haskell: {
        enabled: true,
        cmd: fixtureHaskellCmd
      }
    },
    cache: {
      enabled: false
    }
  }, {
    documents: [{
      virtualPath: 'src/Main.hs',
      text: docText,
      languageId: 'haskell',
      effectiveExt: '.hs',
      docHash: 'hash-haskell-bootstrap'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid,
        chunkId: 'chunk_haskell_bootstrap',
        file: 'src/Main.hs',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: 'src/Main.hs',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'greet', kind: 'function' },
      languageId: 'haskell'
    }],
    kinds: ['types']
  });

  assert.equal(result.byChunkUid.has(chunkUid), true, 'expected haskell provider to enrich symbol');
  const hit = result.byChunkUid.get(chunkUid);
  assert.equal(hit.payload?.returnType, 'Text', 'expected parsed Haskell return type');
  assert.equal(hit.payload?.paramTypes?.arg1?.[0]?.type, 'Text', 'expected parsed Haskell param type');
  const providerDiag = result.diagnostics?.['haskell-language-server'] || null;
  assert.ok(providerDiag && providerDiag.runtime, 'expected runtime diagnostics for haskell provider');

  console.log('haskell provider bootstrap test passed');
} finally {
  restorePath();
}
