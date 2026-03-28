#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  prepareVsCodeFixtureWorkspace,
  createVsCodeRuntimeHarness
} from '../../helpers/vscode/runtime-harness.js';

const workspace = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', {
  prefix: 'poc-vscode-search-runtime-'
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

try {
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

  harness.queuedResults.push({ throw: new Error('sync search spawn failure') });
  await harness.extension._test.executeSearchCommand({ query: 'AuthToken' });
  assert.match(harness.errorMessages.shift(), /PairOfCleats search failed to start/i);
  assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /sync search spawn failure/i.test(event.line)));

  harness.queuedResults.push({ code: 0, stdout: '' });
  await harness.extension._test.executeSearchCommand({ query: 'AuthToken' });
  assert.equal(harness.errorMessages.shift(), 'PairOfCleats search returned no JSON output.');
  assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /\[search\] parse failure kind=empty-output/i.test(event.line)));

  harness.queuedResults.push({ code: 0, stdout: '{', stderr: 'stderr detail' });
  await harness.extension._test.executeSearchCommand({ query: 'AuthToken' });
  assert.match(harness.errorMessages.shift(), /returned invalid JSON/i);
  assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /stderr detail/i.test(event.line)));

  harness.queuedResults.push({ code: 7, stdout: '', stderr: 'fatal search failure' });
  await harness.extension._test.executeSearchCommand({ query: 'AuthToken' });
  assert.equal(harness.errorMessages.shift(), 'PairOfCleats search failed (exit 7).');
  assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /fatal search failure/i.test(event.line)));

  harness.quickPickQueue.push((items) => items[0]);
  harness.fakeVscode.workspace.openTextDocument = async () => {
    throw new Error('cannot open selected hit');
  };
  harness.queuedResults.push({
    code: 0,
    stdout: JSON.stringify({
      code: [{ file: 'src/app.ts', startLine: 1, score: 1 }]
    })
  });
  await harness.extension._test.executeSearchCommand({ query: 'AuthToken' });
  assert.match(harness.errorMessages.shift(), /could not open/i);
  assert.ok(harness.outputEvents.some((event) => event.kind === 'append' && /cannot open selected hit/i.test(event.line)));
} finally {
  harness.restoreGlobals();
}

console.log('vscode search runtime contract matrix test passed');
