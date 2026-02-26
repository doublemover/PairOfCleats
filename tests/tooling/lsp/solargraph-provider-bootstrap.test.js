#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `solargraph-provider-bootstrap-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'lib'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'Gemfile'), "source 'https://rubygems.org'\n", 'utf8');

const fixturesBin = path.join(root, 'tests', 'fixtures', 'lsp', 'bin');
const originalPath = process.env.PATH || '';
process.env.PATH = `${fixturesBin}${path.delimiter}${originalPath}`;

try {
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
        enabled: true
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

  assert.equal(result.byChunkUid.has(chunkUid), true, 'expected solargraph provider to enrich Ruby symbol');
  const hit = result.byChunkUid.get(chunkUid);
  assert.equal(hit.payload?.returnType, 'String', 'expected parsed Ruby return type');
  assert.equal(hit.payload?.paramTypes?.name?.[0]?.type, 'String', 'expected parsed Ruby param type');
  const providerDiag = result.diagnostics?.solargraph || null;
  assert.ok(providerDiag && providerDiag.runtime, 'expected runtime diagnostics for solargraph provider');

  console.log('solargraph provider bootstrap test passed');
} finally {
  process.env.PATH = originalPath;
}
