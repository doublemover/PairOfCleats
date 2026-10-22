#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

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
  globalConfigValues: {
    cliPath: workspace.resolvePath('bin', 'pairofcleats.js'),
    cliArgs: ['--trace']
  }
});

harness.activate();

assert.equal(harness.definitionProviders.length, 1, 'expected definition provider registration');
assert.equal(harness.referenceProviders.length, 1, 'expected reference provider registration');
assert.equal(harness.documentSymbolProviders.length, 1, 'expected document symbol provider registration');

const symbol = 'WidgetBuilder';
const sourceText = symbol + '\n'.repeat(6);
fs.writeFileSync(activeFile, sourceText);
fs.writeFileSync(workspace.resolvePath('src', 'defs.js'), '\n'.repeat(11) + '  WidgetBuilder\n');
fs.writeFileSync(workspace.resolvePath('src', 'consumer.ts'), '\n'.repeat(8) + '    WidgetBuilder();\n');
const hashFile = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const start = new harness.fakeVscode.Position(0, 0);
const end = new harness.fakeVscode.Position(0, symbol.length);
const document = {
  version: 1, isDirty: false,
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
  getText(range) {
    return range ? symbol : sourceText;
  }
};

harness.queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    ok: true, status: 'resolved', binding: { status: 'resolved' }, sourceHash: hashFile(activeFile),
    sourceVersion: '1', coordinateUnit: 'utf16',
    results: [
      {
        file: 'src/defs.js', coordinateUnit: 'utf16', sourceHash: hashFile(workspace.resolvePath('src', 'defs.js')),
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
    ok: true, status: 'resolved', binding: { status: 'resolved' }, sourceHash: hashFile(activeFile),
    sourceVersion: '1', coordinateUnit: 'utf16',
    results: [
      {
        file: 'src/app.ts', coordinateUnit: 'utf16', sourceHash: hashFile(activeFile),
        virtualPath: 'src/app.ts',
        startLine: 1,
        endLine: 1,
        startCol: 1,
        endCol: 14,
        kind: 'FunctionDeclaration',
        name: 'WidgetBuilder'
      },
      {
        file: 'src/consumer.ts', coordinateUnit: 'utf16', sourceHash: hashFile(workspace.resolvePath('src', 'consumer.ts')),
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

const references = await harness.referenceProviders[0].provider.provideReferences(document, start, { includeDeclaration: false }, {});
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
    'WidgetBuilder',
    '--source-hash', hashFile(activeFile),
    '--source-version', '1',
    '--coordinate-unit', 'utf16',
    '--line', '1', '--column', '1',
    '--include-declaration', 'true'
  ]
);

assert.equal(harness.spawnCalls[1].args[4], '--json');
assert.equal(harness.spawnCalls[1].args[8], 'references');
assert.equal(harness.spawnCalls[1].args[harness.spawnCalls[1].args.indexOf('--include-declaration') + 1], 'false');
assert.equal(harness.spawnCalls[2].args[8], 'document-symbols');

const boundResult = { ok: true, status: 'resolved', binding: { status: 'resolved' },
  sourceHash: hashFile(activeFile), sourceVersion: '1', coordinateUnit: 'utf16', results: [{
    file: 'src/defs.js', sourceHash: hashFile(workspace.resolvePath('src', 'defs.js')),
    coordinateUnit: 'utf16', startLine: 12, endLine: 12, startCol: 3, endCol: 16 }] };
harness.queuedResults.push({ code: 0, stdout: JSON.stringify({ ...boundResult, sourceVersion: 'older-document' }) });
assert.deepEqual(await harness.definitionProviders[0].provider.provideDefinition(document, start, {}), [],
  'a response for another document version cannot publish native locations');
harness.fakeVscode.workspace.textDocuments = [{ uri: { fsPath: workspace.resolvePath('src', 'defs.js') },
  isDirty: true, getText: () => 'unsaved target buffer' }];
harness.queuedResults.push({ code: 0, stdout: JSON.stringify(boundResult) });
assert.deepEqual(await harness.definitionProviders[0].provider.provideDefinition(document, start, {}), [],
  'a matching disk hash cannot qualify a dirty target buffer');
const bomTarget = workspace.resolvePath('src', 'defs.js');
fs.writeFileSync(bomTarget, '\ufeff  WidgetBuilder\r\nnext\r\n');
harness.fakeVscode.workspace.textDocuments = [];
harness.queuedResults.push({ code: 0, stdout: JSON.stringify({ ...boundResult,
  results: [{ file: 'src/defs.js', sourceHash: hashFile(bomTarget), coordinateUnit: 'utf16',
    startLine: 1, startCol: 4, endLine: 1, endCol: 17 }] }) });
const normalized = await harness.definitionProviders[0].provider.provideDefinition(document, start, {});
assert.equal(normalized.length, 1);
assert.equal(normalized[0].range.start.character, 2);
assert.equal(normalized[0].range.end.character, 15,
  'native provider uses the actual opened BOM-stripped target buffer rather than retained raw columns');

console.log('vscode navigation providers test passed');
