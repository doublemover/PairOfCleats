#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `phpactor-provider-command-fallback-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'composer.json'), '{"name":"fixture/php"}\n', 'utf8');

registerDefaultToolingProviders();
const docText = '<?php\nfunction greet(string $name): string { return $name; }\n';
const chunkUid = 'ck64:v1:test:src/app.php:phpactor-command-fallback';
const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['phpactor'],
    phpactor: {
      enabled: true,
      cmd: 'phpactor-not-found'
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: 'src/app.php',
    text: docText,
    languageId: 'php',
    effectiveExt: '.php',
    docHash: 'hash-phpactor-command-fallback'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_phpactor_command_fallback',
      file: 'src/app.php',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: 'src/app.php',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'greet', kind: 'function' },
    languageId: 'php'
  }],
  kinds: ['types']
});

assert.equal(result.byChunkUid.has(chunkUid), false, 'expected fail-open fallback when phpactor command is unavailable');
const checks = result.diagnostics?.phpactor?.checks || [];
assert.equal(
  checks.some((check) => check?.name === 'phpactor_command_unavailable'),
  true,
  'expected command unavailable warning'
);

console.log('phpactor provider command fallback test passed');
