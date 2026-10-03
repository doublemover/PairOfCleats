#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createVsCodeRuntimeHarness } from '../../helpers/vscode/runtime-harness.js';
import { assertRegisteredCommands } from './runtime-test-helpers.js';

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-vscode-workflow-'));
const srcDir = path.join(repoRoot, 'src');
const testsDir = path.join(repoRoot, 'tests');
const rulesDir = path.join(repoRoot, 'rules');
fs.mkdirSync(path.join(repoRoot, 'bin'), { recursive: true });
fs.mkdirSync(srcDir, { recursive: true });
fs.mkdirSync(testsDir, { recursive: true });
fs.mkdirSync(rulesDir, { recursive: true });
fs.writeFileSync(path.join(repoRoot, 'bin', 'pairofcleats.js'), 'console.log("ok");');
fs.writeFileSync(path.join(srcDir, 'app.ts'), 'export const value = 1;\n');
fs.writeFileSync(path.join(testsDir, 'app.test.ts'), 'test("ok", () => {});\n');
fs.writeFileSync(path.join(rulesDir, 'architecture.rules.json'), '{"version":1,"rules":[]}\n');
const workspacePath = path.join(repoRoot, '.pairofcleats-workspace.jsonc');
fs.writeFileSync(workspacePath, '{"name":"Workspace","repos":[]}\n');

const harness = createVsCodeRuntimeHarness({
  repoRoot,
  activeFile: path.join(srcDir, 'app.ts'),
  configValues: {
    cliArgs: ['--trace'],
    searchMode: 'code'
  }
});

harness.activate();
assertRegisteredCommands(harness.registeredCommands, [
  'pairofcleats.codeMap',
  'pairofcleats.architectureCheck',
  'pairofcleats.impact',
  'pairofcleats.suggestTests',
  'pairofcleats.workspaceManifest',
  'pairofcleats.workspaceStatus',
  'pairofcleats.workspaceBuild',
  'pairofcleats.workspaceCatalog'
]);

const codeMapSpec = harness.extension._test.OPERATOR_COMMAND_SPECS.find((spec) => spec.id === 'pairofcleats.codeMap');
harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    ok: true,
    format: 'html-iso',
    outPath: path.join(repoRoot, '.pairofcleats', 'maps', 'vscode-map.iso.html'),
    summary: { counts: { files: 4, members: 10, edges: 12 } },
    warnings: []
  })
});
await harness.extension._test.runOperatorCommand(codeMapSpec);
assert.equal(harness.infoMessages.pop(), 'PairOfCleats: Code Map completed.');
assert.deepEqual(
  harness.spawnCalls[0].args,
  [
    path.join(repoRoot, 'bin', 'pairofcleats.js'),
    '--trace',
    'report',
    'map',
    '--json',
    '--repo',
    repoRoot,
    '--format',
    'html-iso',
    '--out',
    path.join(repoRoot, '.pairofcleats', 'maps', 'vscode-map.iso.html')
  ]
);
assert.equal(harness.openExternalCalls.length, 1, 'expected code map to open generated artifact');

const architectureSpec = harness.extension._test.OPERATOR_COMMAND_SPECS.find((spec) => spec.id === 'pairofcleats.architectureCheck');
harness.inputQueue.push(path.join('rules', 'architecture.rules.json'));
harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    rules: [{ id: 'forbidden-import' }],
    violations: [],
    warnings: []
  })
});
await harness.extension._test.runOperatorCommand(architectureSpec);
assert.equal(harness.infoMessages.pop(), 'PairOfCleats: Architecture Check completed.');
assert.deepEqual(
  harness.spawnCalls[1].args,
  [
    path.join(repoRoot, 'bin', 'pairofcleats.js'),
    '--trace',
    'architecture-check',
    '--json',
    '--repo',
    repoRoot,
    '--rules',
    path.join(repoRoot, 'rules', 'architecture.rules.json')
  ]
);

const impactSpec = harness.extension._test.OPERATOR_COMMAND_SPECS.find((spec) => spec.id === 'pairofcleats.impact');
harness.inputQueue.push('');
harness.inputQueue.push('src/app.ts');
harness.inputQueue.push('2');
harness.quickPickQueue.push((items) => items.find((item) => item.value === 'downstream'));
harness.quickPickQueue.push(null);
harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    direction: 'downstream',
    depth: 2,
    impacted: [{ ref: { type: 'file', path: 'src/app.ts' }, witnessPath: { nodes: [{ path: 'src/app.ts' }] } }],
    warnings: [],
    truncation: []
  })
});
await harness.extension._test.runOperatorCommand(impactSpec);
assert.equal(harness.infoMessages.pop(), 'PairOfCleats: Impact Analysis completed.');
assert.deepEqual(
  harness.spawnCalls[2].args,
  [
    path.join(repoRoot, 'bin', 'pairofcleats.js'),
    '--trace',
    'impact',
    '--json',
    '--repo',
    repoRoot,
    '--direction',
    'downstream',
    '--depth',
    '2',
    '--changed',
    'src/app.ts'
  ]
);

const suggestTestsSpec = harness.extension._test.OPERATOR_COMMAND_SPECS.find((spec) => spec.id === 'pairofcleats.suggestTests');
harness.inputQueue.push('src/app.ts');
harness.inputQueue.push('7');
harness.quickPickQueue.push(null);
harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    suggestions: [{ testPath: 'tests/app.test.ts', score: 0.9 }],
    warnings: []
  })
});
await harness.extension._test.runOperatorCommand(suggestTestsSpec);
assert.equal(harness.infoMessages.pop(), 'PairOfCleats: Suggest Tests completed.');
assert.deepEqual(
  harness.spawnCalls[3].args,
  [
    path.join(repoRoot, 'bin', 'pairofcleats.js'),
    '--trace',
    'suggest-tests',
    '--json',
    '--repo',
    repoRoot,
    '--max',
    '7',
    '--changed',
    'src/app.ts'
  ]
);

const workspaceStatusSpec = harness.extension._test.OPERATOR_COMMAND_SPECS.find((spec) => spec.id === 'pairofcleats.workspaceStatus');
harness.inputQueue.push(workspacePath);
harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    ok: true,
    workspacePath,
    manifestPath: path.join(repoRoot, '.cache', 'workspace_manifest.json'),
    repoSetId: 'workspace-alpha',
    repos: []
  })
});
await harness.extension._test.runOperatorCommand(workspaceStatusSpec);
assert.equal(harness.infoMessages.pop(), 'PairOfCleats: Workspace Status completed.');
assert.deepEqual(
  harness.spawnCalls[4].args,
  [
    path.join(repoRoot, 'bin', 'pairofcleats.js'),
    '--trace',
    'workspace',
    'status',
    '--json',
    '--workspace',
    workspacePath
  ]
);

assert.equal(harness.errorMessages.length, 0, `unexpected errors: ${harness.errorMessages.join('; ')}`);
assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /files: 4/i.test(event.line)));
assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /suggestions: 1/i.test(event.line)));
assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /repoSetId: workspace-alpha/i.test(event.line)));

harness.restoreGlobals();

console.log('vscode workflow runtime test passed');
