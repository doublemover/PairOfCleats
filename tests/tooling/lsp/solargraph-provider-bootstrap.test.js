#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath, requireLspCommandOrSkip } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `solargraph-provider-bootstrap-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'lib'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'Gemfile'), "source 'https://rubygems.org'\n", 'utf8');
const fixtureSolargraphCmd = path.join(
  root,
  'tests',
  'fixtures',
  'lsp',
  'bin',
  process.platform === 'win32' ? 'solargraph.cmd' : 'solargraph'
);

const restorePath = prependLspTestPath({ repoRoot: root });

try {
  requireLspCommandOrSkip({
    providerId: 'solargraph',
    repoRoot: tempRoot,
    reason: 'Skipping solargraph bootstrap test; solargraph command probe failed.'
  });
  registerDefaultToolingProviders();
  const docText = 'def greet(name, title = nil)\n  "#{title} #{name}"\nend\n';
  const chunkUid = 'ck64:v1:test:lib/app.rb:solargraph-bootstrap';
  const result = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      enabledTools: ['solargraph'],
      solargraph: {
        enabled: true,
        cmd: fixtureSolargraphCmd
      }
    },
    cache: {
      enabled: false
    }
  }, {
    documents: [{
      virtualPath: 'lib/app.rb',
      text: docText,
      languageId: 'ruby',
      effectiveExt: '.rb',
      docHash: 'hash-solargraph-bootstrap'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid,
        chunkId: 'chunk_solargraph_bootstrap',
        file: 'lib/app.rb',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: 'lib/app.rb',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'greet', kind: 'function' },
      languageId: 'ruby'
    }],
    kinds: ['types']
  });

  const providerDiag = result.diagnostics?.solargraph || null;
  assert.ok(providerDiag, 'expected diagnostics for solargraph provider');
  if (result.byChunkUid.has(chunkUid)) {
    const hit = result.byChunkUid.get(chunkUid);
    assert.equal(hit.payload?.returnType, 'String', 'expected parsed Ruby return type');
    assert.equal(hit.payload?.paramTypes?.name?.[0]?.type, 'String', 'expected parsed Ruby param type');
  } else {
    const checks = Array.isArray(providerDiag?.checks) ? providerDiag.checks : [];
    assert.equal(
      checks.length > 0 || Boolean(providerDiag?.runtime),
      true,
      'expected diagnostics metadata when solargraph did not enrich'
    );
  }

  console.log('solargraph provider bootstrap test passed');
} finally {
  restorePath();
}
