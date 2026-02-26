#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `dart-provider-command-fallback-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'lib'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'pubspec.yaml'), 'name: dart_fixture\n', 'utf8');

registerDefaultToolingProviders();
const docText = 'String greet(String name) { return name; }\n';
const chunkUid = 'ck64:v1:test:lib/app.dart:dart-command-fallback';
const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['dart'],
    dart: {
      enabled: true,
      cmd: 'dart-not-found'
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: 'lib/app.dart',
    text: docText,
    languageId: 'dart',
    effectiveExt: '.dart',
    docHash: 'hash-dart-command-fallback'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_dart_command_fallback',
      file: 'lib/app.dart',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: 'lib/app.dart',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'greet', kind: 'function' },
    languageId: 'dart'
  }],
  kinds: ['types']
});

assert.equal(result.byChunkUid.has(chunkUid), false, 'expected fail-open fallback when dart command is unavailable');
const checks = result.diagnostics?.dart?.checks || [];
assert.equal(
  checks.some((check) => check?.name === 'dart_command_unavailable'),
  true,
  'expected command unavailable warning'
);

console.log('dart provider command fallback test passed');
