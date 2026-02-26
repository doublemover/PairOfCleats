#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `solargraph-provider-guard-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'lib'), { recursive: true });

const fixturesBin = path.join(root, 'tests', 'fixtures', 'lsp', 'bin');
const originalPath = process.env.PATH || '';
process.env.PATH = `${fixturesBin}${path.delimiter}${originalPath}`;

try {
  registerDefaultToolingProviders();
  const docText = 'def greet(name)\n  name\nend\n';
  const chunkUid = 'ck64:v1:test:lib/app.rb:solargraph-guard';
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
      docHash: 'hash-solargraph-guard'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid,
        chunkId: 'chunk_solargraph_guard',
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

  assert.equal(result.byChunkUid.has(chunkUid), false, 'expected guard to skip solargraph without Gemfile');
  const checks = result.diagnostics?.solargraph?.checks || [];
  assert.equal(
    checks.some((check) => check?.name === 'solargraph_workspace_model_missing'),
    true,
    'expected workspace model missing warning'
  );

  console.log('solargraph provider workspace guard test passed');
} finally {
  process.env.PATH = originalPath;
}
