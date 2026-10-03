#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createResultsExplorerRuntimeHarness } from './runtime-test-helpers.js';

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-vscode-results-'));
fs.mkdirSync(path.join(repoRoot, 'bin'), { recursive: true });
fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, 'bin', 'pairofcleats.js'), 'console.log("ok");');
fs.writeFileSync(path.join(repoRoot, 'src', 'app.ts'), 'export const value = 1;\n');
fs.writeFileSync(path.join(repoRoot, 'README.md'), '# readme\n');
fs.writeFileSync(path.join(repoRoot, 'records.json'), '{}\n');

const harness = createResultsExplorerRuntimeHarness({
  repoRoot,
  activeFile: path.join(repoRoot, 'src', 'app.ts'),
  configValues: {
    searchMode: 'both',
    searchBackend: 'sqlite'
  }
});

harness.activate();
assert.equal(harness.treeViews[0].id, 'pairofcleats.resultsExplorer');
const provider = harness.treeProviders[0];

harness.inputQueue.push('auth token');
harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    code: [{ file: 'src/app.ts', score: 1, startLine: 1 }],
    prose: [{ file: 'README.md', score: 2, startLine: 1 }],
    records: [{ file: 'records.json', score: 3, startLine: 1 }]
  })
});
harness.quickPickQueue.push((items) => items[0]);
await harness.runCommand('pairofcleats.search');

const history = harness.workspaceStateStore.get('pairofcleats.searchHistory');
assert.equal(history.length, 1);
assert.equal(history[0].query, 'auth token');
assert.equal(history[0].totalHits, 3);
assert.equal(history[0].mode, 'both');
assert.equal(history[0].backend, 'sqlite');
assert.deepEqual(history[0].invocation.args, harness.spawnCalls[0].args);

let roots = provider.getChildren();
assert.deepEqual(roots.map((node) => node.treeItem.label).sort(), ['code', 'prose', 'records']);

await harness.runCommand('pairofcleats.groupResultsByFile');
roots = provider.getChildren();
assert.deepEqual(roots.map((node) => node.treeItem.label).sort(), ['README.md', 'records.json', 'src/app.ts']);

await harness.runCommand('pairofcleats.groupResultsByQuery');
roots = provider.getChildren();
assert.equal(roots[0].treeItem.label, 'auth token');
const resultNode = roots[0].children[0];
await harness.runCommand('pairofcleats.copyResultPath', resultNode);
assert.ok(harness.clipboardWrites[0].endsWith(path.join('src', 'app.ts')));
await harness.runCommand('pairofcleats.revealResultHit', resultNode);
assert.equal(harness.executeCommandCalls[0].id, 'revealInExplorer');
await harness.runCommand('pairofcleats.openResultHit', resultNode);
assert.ok(harness.openedPaths[0].endsWith(path.join('src', 'app.ts')));
const openedEditor = harness.shownEditors.find((entry) => entry?.selection);
assert.equal(openedEditor.selection.start.line, 0);

const traversalNode = {
  ...resultNode,
  hit: { ...resultNode.hit, file: '../outside.ts' }
};
const errorCountBeforeTraversal = harness.errorMessages.length;
await harness.runCommand('pairofcleats.copyResultPath', traversalNode);
await harness.runCommand('pairofcleats.revealResultHit', traversalNode);
assert.ok(harness.errorMessages.slice(errorCountBeforeTraversal).some((message) => /outside the repo/i.test(message)));

harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    code: [{ file: 'src/app.ts', score: 1, startLine: 1 }]
  })
});
harness.quickPickQueue.push((items) => items[0]);
await harness.runCommand('pairofcleats.showSearchHistory');
assert.deepEqual(harness.spawnCalls[1].args, harness.spawnCalls[0].args);

await harness.runCommand('pairofcleats.reopenLastResults');
assert.ok(harness.infoMessages.some((message) => /reopened results/i.test(message)));

harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    code: [{ file: 'src/app.ts', score: 1, startLine: 1 }]
  })
});
await harness.runCommand('pairofcleats.rerunResultSet', history[0]);
assert.deepEqual(harness.spawnCalls[2].args, harness.spawnCalls[0].args);
assert.equal(harness.errorMessages.length, errorCountBeforeTraversal + 2, `unexpected errors: ${harness.errorMessages.join('; ')}`);

harness.restoreGlobals();

console.log('vscode results explorer runtime test passed');
