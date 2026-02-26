#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `solargraph-provider-command-fallback-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'lib'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'Gemfile'), "source 'https://rubygems.org'\n", 'utf8');

registerDefaultToolingProviders();
const docText = 'def greet(name)\n  name\nend\n';
const chunkUid = 'ck64:v1:test:lib/app.rb:solargraph-command-fallback';
const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['solargraph'],
    solargraph: {
      enabled: true,
      cmd: 'solargraph-command-not-found'
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
    docHash: 'hash-solargraph-command-fallback'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_solargraph_command_fallback',
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

assert.equal(result.byChunkUid.has(chunkUid), false, 'expected fail-open fallback when solargraph command is unavailable');
const checks = result.diagnostics?.solargraph?.checks || [];
assert.equal(
  checks.some((check) => check?.name === 'solargraph_command_unavailable'),
  true,
  'expected command unavailable warning'
);

console.log('solargraph provider command fallback test passed');
