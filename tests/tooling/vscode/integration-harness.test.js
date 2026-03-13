#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  prepareVsCodeFixtureWorkspace,
  createVsCodeRuntimeHarness
} from '../../helpers/vscode/runtime-harness.js';

const workspace = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', {
  prefix: 'poc-vscode-integration-'
});
const nestedSourceFile = workspace.resolvePath('packages', 'nested', 'src', 'service.ts');
fs.mkdirSync(workspace.resolvePath('packages', 'nested', 'tools', 'config'), { recursive: true });
fs.mkdirSync(workspace.resolvePath('packages', 'nested', 'tools', 'index'), { recursive: true });
fs.writeFileSync(workspace.resolvePath('packages', 'nested', 'tools', 'config', 'dump.js'), 'console.log("ok");\n');
fs.writeFileSync(workspace.resolvePath('packages', 'nested', 'tools', 'index', 'report-artifacts.js'), 'console.log("ok");\n');
const harness = createVsCodeRuntimeHarness({
  repoRoot: workspace.root,
  workspaceFolders: [{ name: 'root', path: workspace.root }],
  activeFile: nestedSourceFile,
  configValues: {
    cliArgs: ['--trace'],
    searchMode: 'code',
    searchBackend: 'sqlite'
  }
});

harness.activate();

for (const commandId of [
  'pairofcleats.search',
  'pairofcleats.setup',
  'pairofcleats.bootstrap',
  'pairofcleats.doctor',
  'pairofcleats.configDump',
  'pairofcleats.indexHealth',
  'pairofcleats.codeMap',
  'pairofcleats.showSearchHistory'
]) {
  assert.ok(harness.registeredCommands.has(commandId), `missing registered command ${commandId}`);
}

harness.inputQueue.push('nested symbol');
harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    code: [{ file: 'src/service.ts', score: 1, startLine: 1 }]
  })
});
await harness.runCommand('pairofcleats.search');

assert.equal(harness.errorMessages.length, 0, `unexpected search errors: ${harness.errorMessages.join('; ')}`);
assert.equal(harness.spawnCalls.length, 1);
assert.equal(harness.spawnCalls[0].command, process.execPath);
const searchArgs = harness.spawnCalls[0].args;
assert.deepEqual(searchArgs, [
  workspace.resolvePath('packages', 'nested', 'bin', 'pairofcleats.js'),
  '--trace',
  'search',
  '--json',
  '--top',
  '25',
  '--mode',
  'code',
  '--backend',
  'sqlite',
  '--repo',
  workspace.resolvePath('packages', 'nested'),
  '--',
  'nested symbol'
]);

const searchHistory = harness.workspaceStateStore.get('pairofcleats.searchHistory');
assert.equal(searchHistory.length, 1);
assert.equal(searchHistory[0].repoRoot, workspace.resolvePath('packages', 'nested'));

harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    ok: true,
    format: 'html-iso',
    outPath: workspace.resolvePath('.pairofcleats', 'maps', 'vscode-map.iso.html'),
    summary: { counts: { files: 1, members: 2, edges: 1 } },
    warnings: []
  })
});
await harness.runCommand('pairofcleats.codeMap');

assert.equal(harness.errorMessages.length, 0, `unexpected workflow errors: ${harness.errorMessages.join('; ')}`);
assert.equal(harness.spawnCalls.length, 2);
assert.deepEqual(
  harness.spawnCalls[1].args,
  [
    workspace.resolvePath('packages', 'nested', 'bin', 'pairofcleats.js'),
    '--trace',
    'report',
    'map',
    '--json',
    '--repo',
    workspace.resolvePath('packages', 'nested'),
    '--format',
    'html-iso',
    '--out',
    workspace.resolvePath('packages', 'nested', '.pairofcleats', 'maps', 'vscode-map.iso.html')
  ]
);
assert.equal(harness.openExternalCalls.length, 1);
assert.ok(harness.infoMessages.some((message) => /Code Map completed/i.test(message)));

harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    root: workspace.resolvePath('packages', 'nested'),
    incremental: true,
    restoredArtifacts: false,
    steps: {
      tooling: { ok: true, installed: true },
      cache: { ok: true, restored: false }
    },
    errors: []
  })
});
await harness.runCommand('pairofcleats.setup');

harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    root: workspace.resolvePath('packages', 'nested'),
    incremental: true,
    restoredArtifacts: true,
    steps: {
      tooling: { ok: true, installed: true },
      artifacts: { ok: true, restored: true }
    },
    errors: []
  })
});
await harness.runCommand('pairofcleats.bootstrap');

harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    repoRoot: workspace.resolvePath('packages', 'nested'),
    summary: { status: 'ok' },
    identity: { chunkUid: { available: true } },
    xxhash: { backend: 'native' },
    providers: [{ id: 'gopls', status: 'ok', enabled: true }],
    scm: { provider: 'git', annotateEnabled: true }
  })
});
await harness.runCommand('pairofcleats.doctor');

harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    repoRoot: workspace.resolvePath('packages', 'nested'),
    policy: {
      quality: { value: 'max', source: 'config' }
    },
    derived: {
      mcp: {
        mode: 'auto',
        modeSource: 'default',
        sdkAvailable: true
      }
    }
  })
});
await harness.runCommand('pairofcleats.configDump');

harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    repo: {
      root: workspace.resolvePath('packages', 'nested'),
      cacheRoot: workspace.resolvePath('packages', 'nested', '.cache'),
      totalBytes: 2048,
      sqlite: {
        code: true,
        prose: false,
        extractedProse: false,
        records: false
      }
    },
    corruption: { ok: true },
    health: { issues: [], hints: ['run bootstrap if sqlite pieces are missing'] }
  })
});
await harness.runCommand('pairofcleats.indexHealth');

assert.ok(harness.infoMessages.some((message) => /Setup completed/i.test(message)));
assert.ok(harness.infoMessages.some((message) => /Bootstrap completed/i.test(message)));
assert.ok(harness.infoMessages.some((message) => /Tooling Doctor completed/i.test(message)));
assert.ok(harness.infoMessages.some((message) => /Config Dump completed/i.test(message)));
assert.ok(harness.infoMessages.some((message) => /Index Health completed/i.test(message)));
assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /next: PairOfCleats: Tooling Doctor/i.test(event.line)));
assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /next: PairOfCleats: Index Health/i.test(event.line)));
assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /mcp mode: auto/i.test(event.line)));
assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /sqlite code: present/i.test(event.line)));

console.log('vscode integration harness test passed');
