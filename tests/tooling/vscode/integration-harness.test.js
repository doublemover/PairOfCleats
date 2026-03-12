#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createVsCodeFixtureRepo, createVsCodeRuntimeHarness } from '../../helpers/vscode/runtime-harness.js';

const repoRoot = createVsCodeFixtureRepo('poc-vscode-integration-');
const nestedRepoRoot = path.join(repoRoot, 'packages', 'nested');
fs.mkdirSync(path.join(nestedRepoRoot, '.git'), { recursive: true });
fs.mkdirSync(path.join(nestedRepoRoot, 'bin'), { recursive: true });
fs.mkdirSync(path.join(nestedRepoRoot, 'src'), { recursive: true });
fs.writeFileSync(path.join(nestedRepoRoot, 'bin', 'pairofcleats.js'), 'console.log("nested");');
fs.writeFileSync(path.join(nestedRepoRoot, 'src', 'service.ts'), 'export const nested = true;\n');

const nestedSourceFile = path.join(nestedRepoRoot, 'src', 'service.ts');
const harness = createVsCodeRuntimeHarness({
  repoRoot,
  workspaceFolders: [{ name: 'root', path: repoRoot }],
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
assert.equal(searchArgs[0], path.join(nestedRepoRoot, 'bin', 'pairofcleats.js'));
assert.equal(searchArgs[1], '--trace');
assert.equal(searchArgs[2], 'search');
assert.ok(searchArgs.includes('--json'));
assert.ok(searchArgs.includes('--repo'));
assert.ok(searchArgs.includes(nestedRepoRoot));
assert.ok(searchArgs.includes('--mode'));
assert.ok(searchArgs.includes('code'));
assert.ok(searchArgs.includes('--backend'));
assert.ok(searchArgs.includes('sqlite'));
assert.ok(searchArgs.includes('--top'));
assert.ok(searchArgs.includes('25'));
assert.equal(searchArgs.at(-2), '--');
assert.equal(searchArgs.at(-1), 'nested symbol');

const searchHistory = harness.workspaceStateStore.get('pairofcleats.searchHistory');
assert.equal(searchHistory.length, 1);
assert.equal(searchHistory[0].repoRoot, nestedRepoRoot);

harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    ok: true,
    format: 'html-iso',
    outPath: path.join(nestedRepoRoot, '.pairofcleats', 'maps', 'vscode-map.iso.html'),
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
    path.join(nestedRepoRoot, 'bin', 'pairofcleats.js'),
    '--trace',
    'report',
    'map',
    '--json',
    '--repo',
    nestedRepoRoot,
    '--format',
    'html-iso',
    '--out',
    path.join(nestedRepoRoot, '.pairofcleats', 'maps', 'vscode-map.iso.html')
  ]
);
assert.equal(harness.openExternalCalls.length, 1);
assert.ok(harness.infoMessages.some((message) => /Code Map completed/i.test(message)));

console.log('vscode integration harness test passed');
