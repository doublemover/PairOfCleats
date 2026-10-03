#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createVsCodeRuntimeHarness } from '../../helpers/vscode/runtime-harness.js';
import { assertRegisteredCommands } from './runtime-test-helpers.js';

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-vscode-operator-'));
fs.mkdirSync(path.join(repoRoot, 'bin'), { recursive: true });
fs.mkdirSync(path.join(repoRoot, 'tools', 'config'), { recursive: true });
fs.mkdirSync(path.join(repoRoot, 'tools', 'index'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, 'bin', 'pairofcleats.js'), 'console.log("ok");');
fs.writeFileSync(path.join(repoRoot, 'tools', 'config', 'dump.js'), 'console.log("ok");');
fs.writeFileSync(path.join(repoRoot, 'tools', 'index', 'report-artifacts.js'), 'console.log("ok");');

const harness = createVsCodeRuntimeHarness({
  repoRoot,
  configValues: {
    cliArgs: ['--trace'],
    searchMode: 'code'
  }
});

harness.activate();
assertRegisteredCommands(harness.registeredCommands, [
  'pairofcleats.search',
  'pairofcleats.setup',
  'pairofcleats.bootstrap',
  'pairofcleats.doctor',
  'pairofcleats.configDump',
  'pairofcleats.indexHealth'
]);

const configDumpSpec = harness.extension._test.OPERATOR_COMMAND_SPECS.find((spec) => spec.id === 'pairofcleats.configDump');
harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    repoRoot,
    policy: {
      quality: { value: 'max', source: 'config' }
    },
    derived: {
      cacheRoot: path.join(repoRoot, '.cache'),
      repoCacheRoot: path.join(repoRoot, '.cache', 'repo'),
      mcp: {
        mode: 'auto',
        modeSource: 'default',
        sdkAvailable: true
      }
    }
  })
});
await harness.extension._test.runOperatorCommand(configDumpSpec);
assert.equal(harness.infoMessages.pop(), 'PairOfCleats: Config Dump completed.');
assert.deepEqual(
  harness.spawnCalls[0].args,
  [
    path.join(repoRoot, 'tools', 'config', 'dump.js'),
    '--json',
    '--repo',
    repoRoot
  ]
);
assert.equal(harness.spawnCalls[0].command, process.execPath);
assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /quality: max \(config\)/i.test(event.line)));

const doctorSpec = harness.extension._test.OPERATOR_COMMAND_SPECS.find((spec) => spec.id === 'pairofcleats.doctor');
harness.queuedResults.push({
  code: 1,
  stdout: JSON.stringify({
    repoRoot,
    summary: { status: 'error' },
    identity: { chunkUid: { available: false } },
    xxhash: { backend: 'js' },
    providers: [{ id: 'gopls', status: 'error', enabled: true }],
    scm: { provider: 'git', annotateEnabled: false }
  })
});
await harness.extension._test.runOperatorCommand(doctorSpec);
assert.equal(
  harness.errorMessages.pop(),
  'PairOfCleats: Tooling Doctor reported issues. See PairOfCleats output for details.'
);
assert.deepEqual(
  harness.spawnCalls[1].args,
  [
    path.join(repoRoot, 'bin', 'pairofcleats.js'),
    '--trace',
    'tooling',
    'doctor',
    '--json',
    '--repo',
    repoRoot
  ]
);
assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /providers: 1 total, 0 warn, 1 error/i.test(event.line)));
assert.ok(harness.outputEvents.some((event) => event.kind === 'show'));

harness.queuedResults.push({
  throw: new Error('sync spawn failure')
});
await harness.extension._test.runOperatorCommand(configDumpSpec);
assert.match(harness.errorMessages.pop(), /Config Dump failed to start/i);
assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /sync spawn failure/i.test(event.line)));

harness.restoreGlobals();

console.log('vscode operator runtime test passed');
