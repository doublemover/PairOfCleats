#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `dart-provider-bootstrap-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'lib'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'pubspec.yaml'), 'name: dart_fixture\n', 'utf8');
const fixtureDartCmd = path.join(
  root,
  'tests',
  'fixtures',
  'lsp',
  'bin',
  process.platform === 'win32' ? 'dart.cmd' : 'dart'
);

const restorePath = prependLspTestPath({ repoRoot: root });

try {
  registerDefaultToolingProviders();
  const docText = 'String greet(String name) { return name; }\n';
  const chunkUid = 'ck64:v1:test:lib/app.dart:dart-bootstrap';
  const result = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      enabledTools: ['dart'],
      dart: {
        enabled: true,
        cmd: fixtureDartCmd
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
      docHash: 'hash-dart-bootstrap'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid,
        chunkId: 'chunk_dart_bootstrap',
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

  assert.equal(result.byChunkUid.has(chunkUid), true, 'expected dart provider to enrich Dart symbol');
  const hit = result.byChunkUid.get(chunkUid);
  assert.equal(hit.payload?.returnType, 'String', 'expected parsed Dart return type');
  assert.equal(hit.payload?.paramTypes?.name?.[0]?.type, 'String', 'expected parsed Dart param type');
  const providerDiag = result.diagnostics?.dart || null;
  assert.ok(providerDiag && providerDiag.runtime, 'expected runtime diagnostics for dart provider');

  console.log('dart provider bootstrap test passed');
} finally {
  restorePath();
}
