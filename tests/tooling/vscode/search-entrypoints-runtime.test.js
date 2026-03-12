#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  prepareVsCodeFixtureWorkspace,
  createVsCodeRuntimeHarness
} from '../../helpers/vscode/runtime-harness.js';

const workspace = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', {
  prefix: 'poc-vscode-search-entrypoints-'
});

const emptySelection = {
  isEmpty: true,
  start: { line: 0, character: 4 },
  end: { line: 0, character: 4 },
  active: { line: 0, character: 4 }
};
const selectedRange = {
  isEmpty: false,
  start: { line: 0, character: 0 },
  end: { line: 0, character: 14 },
  active: { line: 0, character: 14 }
};
const symbolRange = { kind: 'word' };
const activeDocument = {
  uri: { scheme: 'file', fsPath: workspace.resolvePath('src', 'app.ts') },
  getText(range) {
    if (range === selectedRange) return 'selected token';
    if (range === symbolRange) return 'AuthToken';
    return '';
  },
  getWordRangeAtPosition() {
    return symbolRange;
  }
};
const activeEditor = {
  document: activeDocument,
  selection: emptySelection,
  selections: [emptySelection]
};

const harness = createVsCodeRuntimeHarness({
  repoRoot: workspace.root,
  activeEditor,
  configValues: {
    searchMode: 'both',
    searchBackend: 'sqlite'
  }
});
const { extension } = harness;
harness.activate();

harness.quickPickQueue.push(null);
harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({ code: [{ file: 'src/app.ts', score: 1, startLine: 1 }] })
});
activeEditor.selection = selectedRange;
activeEditor.selections = [selectedRange];
await harness.runCommand('pairofcleats.searchSelection');
assert.equal(harness.spawnCalls[0].args.at(-1), 'selected token');
assert.ok(!harness.spawnCalls[0].args.includes('--explain'));

harness.quickPickQueue.push(null);
harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({ code: [{ file: 'src/app.ts', score: 1, startLine: 1 }] })
});
activeEditor.selection = emptySelection;
activeEditor.selections = [emptySelection];
await harness.runCommand('pairofcleats.searchSymbolUnderCursor');
assert.equal(harness.spawnCalls[1].args.at(-1), 'AuthToken');
assert.ok(!harness.spawnCalls[1].args.includes('--explain'));

harness.inputQueue.push('why auth matters');
harness.quickPickQueue.push(null);
harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({ code: [{ file: 'src/app.ts', score: 1, startLine: 1 }] })
});
await extension._test.runExplainSearch();
assert.equal(harness.spawnCalls[2].args.at(-1), 'why auth matters');
assert.ok(harness.spawnCalls[2].args.includes('--explain'));

console.log('vscode search entrypoints runtime test passed');
