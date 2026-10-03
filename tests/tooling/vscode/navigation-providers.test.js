#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  createVsCodeRuntimeHarness,
  prepareVsCodeFixtureWorkspace
} from '../../helpers/vscode/runtime-harness.js';

const workspace = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', {
  prefix: 'poc-vscode-navigation-'
});
const activeFile = workspace.resolvePath('src', 'app.ts');
const harness = createVsCodeRuntimeHarness({
  repoRoot: workspace.root,
  workspaceFolders: [{ name: 'repo', path: workspace.root }],
  activeFile,
  configValues: {
    cliArgs: ['--trace']
  }
});

harness.activate();

assert.equal(harness.definitionProviders.length, 1, 'expected definition provider registration');
assert.equal(harness.referenceProviders.length, 1, 'expected reference provider registration');
assert.equal(harness.documentSymbolProviders.length, 1, 'expected document symbol provider registration');

const symbol = 'WidgetBuilder';
const start = new harness.fakeVscode.Position(0, 0);
const end = new harness.fakeVscode.Position(0, symbol.length);
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
    return { start, end };
  },
  getText() {
    return symbol;
  }
};

harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    ok: true,
    results: [
      {
        file: 'src/defs.js',
        virtualPath: 'src/defs.js',
        startLine: 12,
        endLine: 12,
        startCol: 3,
        endCol: 16,
        kind: 'FunctionDeclaration',
        name: 'WidgetBuilder'
      }
    ]
  })
});

const definitions = await harness.definitionProviders[0].provider.provideDefinition(document, start, {});
assert.equal(definitions.length, 1);
assert.equal(definitions[0].uri.fsPath, harness.resolvePath('src', 'defs.js'));
assert.equal(definitions[0].range.start.line, 11);
assert.equal(definitions[0].range.start.character, 2);

harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    ok: true,
    results: [
      {
        file: 'src/app.ts',
        virtualPath: 'src/app.ts',
        startLine: 4,
        endLine: 4,
        startCol: 1,
        endCol: 14,
        kind: 'FunctionDeclaration',
        name: 'WidgetBuilder'
      },
      {
        file: 'src/consumer.ts',
        virtualPath: 'src/consumer.ts',
        startLine: 9,
        endLine: 9,
        startCol: 5,
        endCol: 18,
        kind: 'FunctionDeclaration',
        name: 'WidgetBuilder'
      }
    ]
  })
});

const references = await harness.referenceProviders[0].provider.provideReferences(document, start, {}, {});
assert.equal(references.length, 2);
assert.equal(references[1].uri.fsPath, harness.resolvePath('src', 'consumer.ts'));

harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    ok: true,
    results: [
      {
        file: 'src/app.ts',
        virtualPath: 'src/app.ts',
        startLine: 2,
        endLine: 6,
        startCol: 1,
        endCol: 1,
        kind: 'FunctionDeclaration',
        name: 'WidgetBuilder',
        qualifiedName: 'demo.WidgetBuilder'
      }
    ]
  })
});

const documentSymbols = await harness.documentSymbolProviders[0].provider.provideDocumentSymbols(document, {});
assert.equal(documentSymbols.length, 1);
assert.equal(documentSymbols[0].name, 'WidgetBuilder');
assert.equal(documentSymbols[0].range.start.line, 1);

const definitionArgs = harness.spawnCalls[0].args;
assert.deepEqual(
  definitionArgs,
  [
    workspace.resolvePath('bin', 'pairofcleats.js'),
    '--trace',
    'tooling',
    'navigate',
    '--json',
    '--repo',
    workspace.root,
    '--kind',
    'definitions',
    '--top',
    '25',
    '--file',
    activeFile,
    '--symbol',
    'WidgetBuilder'
  ]
);

assert.equal(harness.spawnCalls[1].args[4], '--json');
assert.equal(harness.spawnCalls[1].args[8], 'references');
assert.equal(harness.spawnCalls[2].args[8], 'document-symbols');

console.log('vscode navigation providers test passed');
