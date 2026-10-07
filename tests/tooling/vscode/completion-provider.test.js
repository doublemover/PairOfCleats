#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  createVsCodeRuntimeHarness,
  prepareVsCodeFixtureWorkspace
} from '../../helpers/vscode/runtime-harness.js';

const workspace = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', {
  prefix: 'poc-vscode-completion-'
});
const activeFile = workspace.resolvePath('src', 'app.ts');
const harness = createVsCodeRuntimeHarness({
  repoRoot: workspace.root,
  workspaceFolders: [{ name: 'repo', path: workspace.root }],
  activeFile
});

harness.activate();

assert.equal(harness.completionProviders.length, 1, 'expected completion provider registration');

const fullSymbol = 'WidgetBuilder';
const document = {
  uri: {
    scheme: 'file',
    fsPath: activeFile,
    path: activeFile.replace(/\\/g, '/'),
    toString() {
      return `file:${this.path}`;
    }
  },
  getWordRangeAtPosition() {
    return {
      start: new harness.fakeVscode.Position(0, 0),
      end: new harness.fakeVscode.Position(0, fullSymbol.length)
    };
  },
  getText() {
    return fullSymbol;
  }
};

const shortPrefixItems = await harness.completionProviders[0].provider.provideCompletionItems(
  document,
  new harness.fakeVscode.Position(0, 1),
  {},
  {}
);
assert.deepEqual(shortPrefixItems, [], 'expected short prefix completion lookup to fail quiet');
assert.equal(harness.spawnCalls.length, 0, 'short prefixes should not spawn CLI completion queries');

harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    ok: true,
    results: [
      {
        name: 'WidgetBuilder',
        qualifiedName: 'demo.WidgetBuilder',
        kind: 'FunctionDeclaration',
        file: 'src/defs.js',
        virtualPath: 'src/defs.js',
        score: 11
      },
      {
        name: 'WidgetRegistry',
        qualifiedName: 'demo.WidgetRegistry',
        kind: 'ClassDeclaration',
        file: 'src/registry.js',
        virtualPath: 'src/registry.js',
        score: 7
      }
    ]
  })
});

const completionItems = await harness.completionProviders[0].provider.provideCompletionItems(
  document,
  new harness.fakeVscode.Position(0, 4),
  {},
  {}
);
assert.equal(completionItems.length, 2);
assert.equal(completionItems[0].label, 'WidgetBuilder');
assert.equal(completionItems[0].detail, 'demo.WidgetBuilder');
assert.equal(completionItems[0].kind, harness.fakeVscode.CompletionItemKind.Function);
assert.equal(completionItems[1].kind, harness.fakeVscode.CompletionItemKind.Class);

assert.deepEqual(
  harness.spawnCalls[0].args,
  [
    workspace.resolvePath('bin', 'pairofcleats.js'),
    'tooling',
    'navigate',
    '--json',
    '--repo',
    workspace.root,
    '--kind',
    'completions',
    '--top',
    '40',
    '--file',
    activeFile,
    '--symbol',
    'Widg'
  ]
);

console.log('vscode completion provider test passed');
