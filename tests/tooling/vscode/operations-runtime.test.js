#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  createVsCodeRuntimeTempRepo,
  createVsCodeRuntimeHarness
} from '../../helpers/vscode/runtime-harness.js';
import {
  assertNoRuntimeErrors,
  assertRegisteredCommands,
  assertSpawnArgs
} from '../../helpers/vscode/runtime-assertions.js';

const repoRoot = createVsCodeRuntimeTempRepo({
  prefix: 'poc-vscode-ops-',
  toolScripts: ['tools/index/validate.js']
});
const harness = createVsCodeRuntimeHarness({
  repoRoot,
  activeFile: path.join(repoRoot, 'src', 'app.ts'),
  globalConfigValues: {
    cliPath: path.join(repoRoot, 'bin', 'pairofcleats.js'),
    cliArgs: ['--trace']
  }
});

harness.activate();

try {
  assertRegisteredCommands(harness.registeredCommands, [
    'pairofcleats.indexBuild',
    'pairofcleats.indexWatchStart',
    'pairofcleats.indexWatchStop',
    'pairofcleats.indexValidate',
    'pairofcleats.serviceApiStart',
    'pairofcleats.serviceApiStop',
    'pairofcleats.serviceIndexerStart',
    'pairofcleats.serviceIndexerStop'
  ]);

  harness.queuedResults.push({
    code: 0,
    stdout: JSON.stringify({
      ok: true,
      root: repoRoot,
      strict: true,
      modes: {
        code: { ok: true, path: path.join(repoRoot, 'index-code'), missing: [], warnings: [] }
      },
      sqlite: { enabled: false, ok: true, mode: 'code', issues: [] },
      lmdb: { enabled: false, ok: true, issues: [], warnings: [] },
      warnings: [],
      issues: [],
      hints: []
    })
  });
  await harness.runCommand('pairofcleats.indexValidate');
  assert.equal(harness.infoMessages.shift(), 'PairOfCleats: Index Validate completed.');
  assertSpawnArgs(
    harness.spawnCalls,
    0,
    [
      path.join(repoRoot, 'bin', 'pairofcleats.js'),
      '--trace',
      'index',
      'validate',
      '--json',
      '--repo',
      repoRoot
    ]
  );

  harness.queuedResults.push({
    code: 0,
    stdout: '[build] done\n'
  });
  await harness.runCommand('pairofcleats.indexBuild');
  assert.equal(harness.infoMessages.shift(), 'PairOfCleats: Index Build completed.');
  assertSpawnArgs(
    harness.spawnCalls,
    1,
    [
      path.join(repoRoot, 'bin', 'pairofcleats.js'),
      '--trace',
      'index',
      'build',
      '--repo',
      repoRoot,
      '--progress',
      'jsonl'
    ]
  );
  assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /\[stdout\] \[build\] done/i.test(event.line)));

  harness.queuedResults.push({ persistent: true, stdout: '[watch] started\n', killCode: 0 });
  await harness.runCommand('pairofcleats.indexWatchStart');
  assert.match(harness.infoMessages.shift(), /Index Watch is starting.*Readiness has not been observed/);
  assertSpawnArgs(
    harness.spawnCalls,
    2,
    [
      path.join(repoRoot, 'bin', 'pairofcleats.js'),
      '--trace',
      'index',
      'watch',
      '--repo',
      repoRoot,
      '--progress',
      'jsonl'
    ]
  );
  await harness.runCommand('pairofcleats.indexWatchStop');
  assert.equal(harness.infoMessages.shift(), 'PairOfCleats: Index Watch stopped.');

  harness.queuedResults.push({ persistent: true, stdout: '[api] listening\n', killCode: 0 });
  await harness.runCommand('pairofcleats.serviceApiStart');
  assert.match(harness.infoMessages.shift(), /Service API is starting.*Readiness has not been observed/);
  assert.equal(harness.infoMessages.some(message => /ready at/.test(message)), false, 'plain listening prose is not authoritative readiness');
  await harness.runCommand('pairofcleats.serviceApiStop');
  assert.equal(harness.infoMessages.shift(), 'PairOfCleats: Service API stopped.');

  harness.queuedResults.push({ persistent: true, stdout: '[indexer] watching\n', killCode: 0 });
  await harness.runCommand('pairofcleats.serviceIndexerStart');
  assert.match(harness.infoMessages.shift(), /Service Indexer is starting.*Readiness has not been observed/);
  await harness.runCommand('pairofcleats.serviceIndexerStop');
  assert.equal(harness.infoMessages.shift(), 'PairOfCleats: Service Indexer stopped.');

  harness.queuedResults.push({ throw: new Error('managed spawn exploded') });
  await harness.runCommand('pairofcleats.indexWatchStart');
  assert.match(harness.errorMessages.shift(), /Index Watch failed to start/i);
  assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /managed spawn exploded/i.test(event.line)));

  assertNoRuntimeErrors(harness.errorMessages);
  assert.equal(harness.killCalls.length, 3, 'expected stop commands to terminate all three persistent children');
} finally {
  harness.restoreGlobals();
}

console.log('vscode operations runtime test passed');
