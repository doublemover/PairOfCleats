#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `haskell-provider-command-fallback-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'stack.yaml'), 'resolver: lts-22.0\n', 'utf8');

registerDefaultToolingProviders();
const docText = 'greet :: Text -> Text\ngreet name = name\n';
const chunkUid = 'ck64:v1:test:src/Main.hs:haskell-command-fallback';
const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['haskell-language-server'],
    haskell: {
      enabled: true,
      cmd: 'haskell-language-server-not-found'
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
    docHash: 'hash-haskell-command-fallback'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_haskell_command_fallback',
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

assert.equal(result.byChunkUid.has(chunkUid), false, 'expected fail-open fallback when haskell command is unavailable');
const checks = result.diagnostics?.['haskell-language-server']?.checks || [];
assert.equal(
  checks.some((check) => check?.name === 'haskell_command_unavailable'),
  true,
  'expected command unavailable warning'
);

console.log('haskell provider command fallback test passed');
