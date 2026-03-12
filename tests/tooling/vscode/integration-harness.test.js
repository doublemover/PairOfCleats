#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  prepareVsCodeFixtureWorkspace,
  createVsCodeRuntimeHarness
} from '../../helpers/vscode/runtime-harness.js';

const workspace = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', {
  prefix: 'poc-vscode-integration-'
});
const nestedSourceFile = workspace.resolvePath('packages', 'nested', 'src', 'service.ts');
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

for (const commandId of ['pairofcleats.search', 'pairofcleats.codeMap', 'pairofcleats.showSearchHistory']) {
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

console.log('vscode integration harness test passed');
