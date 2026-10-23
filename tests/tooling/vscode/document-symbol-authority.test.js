import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { prepareTypeScriptSyntax } from '../../../src/lang/typescript/syntax-context.js';
import { createTypeScriptSemanticCollector } from '../../../src/index/semantic/typescript-collector.js';
import { queryQualifiedNavigation } from '../../../tools/tooling/navigation-qualified.js';
import { createVsCodeRuntimeHarness, prepareVsCodeFixtureWorkspace } from '../../helpers/vscode/runtime-harness.js';

// Canonical syntax/source producer and real ordinary files, then the actual
// registered provider with inert CLI/host doubles. Real-host UI acceptance is separate.
const fixture = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', { prefix: 'poc-outline-authority-' });
const file = fixture.resolvePath('src', 'app.ts');
const harness = createVsCodeRuntimeHarness({ repoRoot: fixture.root, workspaceFolders: [{ path: fixture.root }],
  activeFile: file, globalConfigValues: { cliPath: fixture.resolvePath('bin', 'pairofcleats.js') } });
const partitionId = 'sy1:' + 'a'.repeat(64);
const generation = { baseBuildId: 'document-symbol-fixture', semanticRevision: 0 };
let currentText = '', dirty = false, version = 7;
const document = { uri: harness.fakeVscode.Uri.file(file), get version() { return version; },
  get isDirty() { return dirty; }, isClosed: false, getText: () => currentText,
  positionAt(offset) {
    const lines = currentText.slice(0, offset).split('\n');
    return new harness.fakeVscode.Position(lines.length - 1, lines.at(-1).length);
  } };
const originalOpen = harness.fakeVscode.workspace.openTextDocument;
const text = 'function WidgetBuilder(\n  input: string\n) {\n  return "🙂" + input;\n}\n';
const request = source => ({ repoRoot: fixture.root, userConfig: {}, kind: 'document-symbols',
  query: '', filePath: file, sourceHash: source.byteHash, sourceVersion: String(version), coordinateUnit: 'utf16' });
async function produce(input, mapping = null) {
  const snapshot = createSemanticSourceSnapshot({ bytes: Buffer.from(input), repositoryNamespace: 'outline-fixture',
    path: 'src/app.ts', language: 'typescript', mapping });
  const syntax = prepareTypeScriptSyntax(input, { ext: '.ts' });
  const collector = createTypeScriptSemanticCollector({ ast: syntax.sourceFile, ts: syntax.ts, source: snapshot.manifest, partitionId });
  const entries = [...collector.batches].flatMap(batch => batch.rows);
  const store = { generation, withReadScope: run => run(), verifySource: async () => {},
    async *iterateRows(_partition, member) {
      if (member === 'semantic_sources') yield snapshot.manifest;
      else {
        const family = { semantic_records: 'node', semantic_lookup: 'lookup', semantic_operands: 'operand' }[member];
        for (const entry of entries) if (entry.family === family) yield entry.row;
      }
    }, async getCoverage() { return entries.filter(entry => entry.family === 'coverage').map(entry => entry.row); } };
  const options = { clock: () => 0, openStore: async () => ({ store,
    manifest: { partitions: [{ partitionId, sourceUnitId: snapshot.manifest.sourceUnitId }] }, close() {} }) };
  return { payload: await queryQualifiedNavigation(request(snapshot.manifest), options), snapshot, options };
}
const queue = payload => harness.queuedResults.push({ code: 0, stdout: JSON.stringify(payload) });
const reset = input => { fs.writeFileSync(file, input); currentText = input.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n'); dirty = false; version = 7; };
try {
  harness.activate();
  const provider = harness.documentSymbolProviders[0].provider;
  reset(text);
  const { payload, snapshot, options } = await produce(text);
  assert.equal(payload.status, 'resolved');
  assert.deepEqual(payload.generation, generation);
  const widget = payload.results.find(row => row.name === 'WidgetBuilder');
  assert(widget, 'canonical parser declaration is projected into native symbol evidence');
  assert.equal(widget.startLine, 1); assert.equal(widget.endLine, 5);
  assert.equal(widget.selectionRange.startCol, 10); assert.equal(widget.selectionRange.endCol, 23);
  queue(payload);
  const symbols = await provider.provideDocumentSymbols(document, {});
  const symbol = symbols.find(row => row.name === 'WidgetBuilder');
  assert(symbol); assert.equal(symbol.range.end.line, 4);
  assert.equal(symbol.selectionRange.start.character, 9);
  assert.equal(symbol.selectionRange.end.character, 22);
  assert.equal(harness.openedDocuments.length, 0, 'Outline qualifies the already requested document without reopening a different buffer');
  const args = harness.spawnCalls.at(-1).args;
  assert.equal(args[args.indexOf('--source-hash') + 1], snapshot.manifest.byteHash);
  assert(!args.includes('--line'), 'document symbols carry source identity without an invented cursor');

  // The original regression: edits made before the provider is invoked.
  reset('// header one\n// header two\n' + text);
  queue(payload);
  assert.deepEqual(await provider.provideDocumentSymbols(document, {}), [], 'saved drift cannot publish old indexed positions');
  const stale = await queryQualifiedNavigation(request(snapshot.manifest), options);
  assert.equal(stale.status, 'stale-source');
  reset(text); currentText = '// header one\n// header two\n' + text; dirty = true;
  const beforeDirty = harness.spawnCalls.length;
  assert.deepEqual(await provider.provideDocumentSymbols(document, {}), []);
  assert.equal(harness.spawnCalls.length, beforeDirty, 'already-dirty source never dispatches native coordinates');

  for (const [label, mutate] of [
    ['missing source witness', value => { delete value.results[0].sourceHash; }],
    ['missing range', value => { delete value.results[0].startLine; }],
    ['out of bounds', value => { value.results[0].sourceSpan.end = text.length + 1; }],
    ['selection outside container', value => { value.results[0].selectionRange.sourceSpan.end = text.length; }],
    ['zero-width unlocated range', value => { Object.assign(value.results[0], { endLine: 1, endCol: 1, sourceSpan: null, selectionRange: null }); }],
    ['unsupported span unit', value => { value.results[0].sourceSpan.unit = 'utf8-byte'; }],
    ['missing generation', value => { delete value.generation; }],
    ['unsupported coordinates', value => { value.results[0].coordinateUnit = 'utf8-byte'; }],
    ['wrong file authority', value => { value.results[0].file = 'README.md'; }]
  ]) {
    reset(text); const invalid = structuredClone(payload); mutate(invalid); queue(invalid);
    assert.deepEqual(await provider.provideDocumentSymbols(document, {}), [], label);
  }

  reset(text);
  const spawns = harness.spawnCalls.length;
  const duringLookup = provider.provideDocumentSymbols(document, {}); version++;
  assert.deepEqual(await duringLookup, []); assert.equal(harness.spawnCalls.length, spawns);
  for (const [label, mutate] of [
    ['version', () => { version++; }], ['dirty', () => { dirty = true; }],
    ['disk bytes without version change', () => fs.writeFileSync(file, '// replaced\n' + text)]
  ]) {
    reset(text); harness.queuedResults.push({ persistent: true });
    const pending = provider.provideDocumentSymbols(document, {}); await new Promise(setImmediate);
    const child = harness.spawnCalls.at(-1).child; mutate();
    child.stdout.emit('data', Buffer.from(JSON.stringify(payload))); child.emit('close', 0);
    assert.deepEqual(await pending, [], label);
  }

  for (const ending of ['\n', '\r\n', '\r']) {
    const normalized = '\ufeff//🙂' + ending + text.replace(/\n/g, ending);
    reset(normalized); const produced = await produce(normalized); queue(produced.payload);
    const symbols = await provider.provideDocumentSymbols(document, {});
    const symbol = symbols.find(row => row.name === 'WidgetBuilder');
    assert(symbol, `BOM/astral/multiline ${JSON.stringify(ending)} normalization remains supported`);
    assert.equal(symbol.range.start.line, 1); assert.equal(symbol.range.end.line, 5);
    assert.equal(symbol.selectionRange.start.character, 9);
  }

  reset('// separator\u2028' + text);
  const separated = await produce('// separator\u2028' + text); queue(separated.payload);
  const separatedSymbol = (await provider.provideDocumentSymbols(document, {})).find(row => row.name === 'WidgetBuilder');
  assert(separatedSymbol); assert.equal(separatedSymbol.range.start.line, 0);
  assert.equal(separatedSymbol.range.start.character, '// separator\u2028'.length,
    'canonical absolute UTF-16 spans use the actual requested host positionAt policy even for Unicode source separators');

  reset(text);
  const mapped = await produce(text, { quality: 'exact', parentSourceUnitId: 'su1:' + 'b'.repeat(64) });
  assert.equal(mapped.payload.results.length, 0, 'generated source with no supported original-source adapter stays unlocated');
  queue(mapped.payload); assert.deepEqual(await provider.provideDocumentSymbols(document, {}), []);

  reset(text); dirty = true; currentText = '// unsaved\n' + text;
  harness.fakeVscode.window.activeTextEditor.document = document;
  queue({ ok: true, results: [{ name: 'WidgetBuilder', kind: 'function', startLine: 1, endLine: 5 }] });
  await harness.runCommand('pairofcleats.inspectDocumentSymbols');
  const evidence = harness.openedDocuments.at(-1).getText();
  assert.match(evidence, /retained evidence/); assert.match(evidence, /may be stale or unlocated/);
  assert.match(evidence, /WidgetBuilder/); assert.match(evidence, /save before requesting exact native symbols/);
  assert(!harness.spawnCalls.at(-1).args.includes('--source-hash'), 'evidence browsing does not pretend dirty source is exact');
} finally {
  harness.fakeVscode.workspace.openTextDocument = originalOpen;
  await harness.extension.deactivate(); harness.restoreGlobals();
}
console.log('Source-qualified canonical document-symbol producer and registered-provider regressions authored; real host acceptance separate.');
