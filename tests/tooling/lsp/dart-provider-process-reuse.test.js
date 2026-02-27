#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';

import { countNonEmptyLines } from '../../helpers/lsp-signature-fixtures.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `dart-provider-process-reuse-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'lib'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'pubspec.yaml'), 'name: dart_fixture\n', 'utf8');

const counterPath = path.join(tempRoot, 'dart-lsp.counter');
const restorePath = prependLspTestPath({ repoRoot: root });
const fixtureDartCmd = path.join(
  root,
  'tests',
  'fixtures',
  'lsp',
  'bin',
  process.platform === 'win32' ? 'dart.cmd' : 'dart'
);

try {
  await withTemporaryEnv({ POC_LSP_COUNTER: counterPath }, async () => {
    registerDefaultToolingProviders();
    const docOne = 'String greet(String name) { return name; }\n';
    const docTwo = 'String hello(String name) { return name; }\n';
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
        virtualPath: 'lib/one.dart',
        text: docOne,
        languageId: 'dart',
        effectiveExt: '.dart',
        docHash: 'hash-dart-one'
      }, {
        virtualPath: 'lib/two.dart',
        text: docTwo,
        languageId: 'dart',
        effectiveExt: '.dart',
        docHash: 'hash-dart-two'
      }],
      targets: [{
        chunkRef: {
          docId: 0,
          chunkUid: 'ck64:v1:test:lib/one.dart:dart-reuse-one',
          chunkId: 'chunk_dart_reuse_one',
          file: 'lib/one.dart',
          segmentUid: null,
          segmentId: null,
          range: { start: 0, end: docOne.length }
        },
        virtualPath: 'lib/one.dart',
        virtualRange: { start: 0, end: docOne.length },
        symbolHint: { name: 'greet', kind: 'function' },
        languageId: 'dart'
      }, {
        chunkRef: {
          docId: 1,
          chunkUid: 'ck64:v1:test:lib/two.dart:dart-reuse-two',
          chunkId: 'chunk_dart_reuse_two',
          file: 'lib/two.dart',
          segmentUid: null,
          segmentId: null,
          range: { start: 0, end: docTwo.length }
        },
        virtualPath: 'lib/two.dart',
        virtualRange: { start: 0, end: docTwo.length },
        symbolHint: { name: 'hello', kind: 'function' },
        languageId: 'dart'
      }],
      kinds: ['types']
    });

    const spawnCount = await countNonEmptyLines(counterPath);
    assert.equal(spawnCount, 1, 'expected one dart language-server process spawn per provider run');
    assert.equal(result.byChunkUid.size, 2, 'expected both Dart chunks enriched');
    assert.equal(
      Number(result.diagnostics?.dart?.runtime?.requests?.byMethod?.initialize?.requests || 0),
      1,
      'expected one initialize request for the shared dart session'
    );

    console.log('dart provider process reuse test passed');
  });
} finally {
  restorePath();
}
