#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';

import { countNonEmptyLines } from '../../helpers/lsp-signature-fixtures.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { cleanupLspTestRuntime, prependLspTestPath } from '../../helpers/lsp-runtime.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `dart-provider-process-reuse-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'lib'), { recursive: true });
await fs.mkdir(path.join(tempRoot, '.dart_tool'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'pubspec.yaml'), 'name: dart_fixture\n', 'utf8');
await fs.writeFile(
  path.join(tempRoot, '.dart_tool', 'package_config.json'),
  JSON.stringify({
    configVersion: 2,
    packages: []
  }, null, 2),
  'utf8'
);

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
  await cleanupLspTestRuntime({ reason: 'dart_provider_process_reuse_start', strict: true });
  await withTemporaryEnv({ POC_LSP_COUNTER: counterPath }, async () => {
    registerDefaultToolingProviders();
    const docOne = 'String greet(String name) { return name; }\n';
    const docTwo = 'String hello(String name) { return name; }\n';
    const runDartPass = async (suffix) => runToolingProviders({
      strict: true,
      repoRoot: tempRoot,
      buildRoot: tempRoot,
      toolingConfig: {
        enabledTools: ['dart'],
        dart: {
          enabled: true,
          cmd: fixtureDartCmd,
          sessionIdleTimeoutMs: 60_000
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
        docHash: `hash-dart-one-${suffix}`
      }, {
        virtualPath: 'lib/two.dart',
        text: docTwo,
        languageId: 'dart',
        effectiveExt: '.dart',
        docHash: `hash-dart-two-${suffix}`
      }],
      targets: [{
        chunkRef: {
          docId: 0,
          chunkUid: `ck64:v1:test:lib/one.dart:dart-reuse-one-${suffix}`,
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
          chunkUid: `ck64:v1:test:lib/two.dart:dart-reuse-two-${suffix}`,
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

    const runReuseScenario = async (attemptLabel) => {
      const firstPass = await runDartPass(`${attemptLabel}-first`);
      const secondPass = await runDartPass(`${attemptLabel}-second`);
      return {
        firstPass,
        secondPass,
        spawnCount: await countNonEmptyLines(counterPath)
      };
    };

    let scenario = await runReuseScenario('attempt-one');
    const reusedSecondPass = scenario.secondPass.diagnostics?.dart?.runtime?.pooling?.reused === true;
    if (scenario.spawnCount !== 1 || !reusedSecondPass) {
      await cleanupLspTestRuntime({ reason: 'dart_provider_process_reuse_retry', strict: true });
      await fs.writeFile(counterPath, '', 'utf8');
      scenario = await runReuseScenario('attempt-two');
    }

    const { firstPass, secondPass, spawnCount } = scenario;
    assert.equal(spawnCount, 1, 'expected one dart language-server process spawn across reused provider runs');
    assert.equal(firstPass.byChunkUid.size, 2, 'expected both Dart chunks enriched (first pass)');
    assert.equal(secondPass.byChunkUid.size, 2, 'expected both Dart chunks enriched (second pass)');
    assert.equal(firstPass.diagnostics?.dart?.runtime?.pooling?.reused, false, 'expected first pass to create the pooled dart session');
    assert.equal(secondPass.diagnostics?.dart?.runtime?.pooling?.reused, true, 'expected second pass to reuse the pooled dart session');
    assert.equal(
      Number(firstPass.diagnostics?.dart?.runtime?.requests?.byMethod?.initialize?.requests || 0),
      1,
      'expected one initialize request for the shared dart session (first pass)'
    );
    assert.equal(
      Number(secondPass.diagnostics?.dart?.runtime?.requests?.byMethod?.initialize?.requests || 0),
      1,
      'expected reused pooled session to avoid duplicate initialize requests (second pass)'
    );

    console.log('dart provider process reuse test passed');
  });
} finally {
  await restorePath();
}

