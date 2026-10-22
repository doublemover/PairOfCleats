import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createVsCodeRuntimeHarness, prepareVsCodeFixtureWorkspace } from '../../helpers/vscode/runtime-harness.js';

const require = createRequire(import.meta.url);
const { captureNavigationRequest } = require('../../../extensions/vscode/source-navigation.js');
// Authored actual registered-provider controls using inert host/process doubles.
const fixture = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', { prefix: 'poc-navigation-request-' });
const sourceFile = fixture.resolvePath('src', 'app.ts'), targetFile = fixture.resolvePath('src', 'defs.js');
const sourceText = 'Widget\n';
fs.writeFileSync(sourceFile, sourceText); fs.writeFileSync(targetFile, sourceText);
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const harness = createVsCodeRuntimeHarness({ repoRoot: fixture.root, workspaceFolders: [{ path: fixture.root }],
  activeFile: sourceFile, globalConfigValues: { cliPath: fixture.resolvePath('bin', 'pairofcleats.js') } });
const position = { line: 0, character: 3 };
const originalUri = harness.fakeVscode.Uri.file(sourceFile);
const document = { uri: originalUri, version: 1, isDirty: false, isClosed: false,
  getWordRangeAtPosition: () => ({ start: { line: 0, character: 0 }, end: { line: 0, character: 6 } }),
  getText: range => range ? 'Widget' : sourceText };
const reset = () => { Object.assign(document, { uri: originalUri, version: 1, isDirty: false, isClosed: false }); fs.writeFileSync(sourceFile, sourceText); };
const payload = () => ({ ok: true, status: 'resolved', binding: { status: 'resolved' }, sourceHash: hash(sourceFile),
  sourceVersion: '1', coordinateUnit: 'utf16', results: [{ file: 'src/defs.js', sourceHash: hash(targetFile),
    coordinateUnit: 'utf16', startLine: 1, startCol: 1, endLine: 1, endCol: 7 }] });
const response = () => harness.queuedResults.push({ code: 0, stdout: JSON.stringify(payload()) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const gates = [];
let originalOpen;
try {
  harness.activate(); originalOpen = harness.fakeVscode.workspace.openTextDocument;
  const cursor = { line: 0, character: 3 }, request = captureNavigationRequest(document, cursor, false);
  cursor.line = 5; cursor.character = 99;
  const args = request.args(fixture.root);
  assert.equal(args[args.indexOf('--line') + 1], '1'); assert.equal(args[args.indexOf('--column') + 1], '4');
  assert.equal(args[args.indexOf('--include-declaration') + 1], 'false');
  document.version = 2; assert.equal(request.isCurrent(), false); assert.throws(() => request.args(fixture.root), /changed/);
  reset(); const saved = captureNavigationRequest(document, position); saved.args(fixture.root);
  fs.writeFileSync(sourceFile, sourceText + 'changed while buffer stayed clean');
  assert.throws(() => saved.args(fixture.root), /differs|changed|disk/); reset();

  // The provider's first await is repository lookup. A request cannot silently
  // switch to a newly edited source before spawning its old spelling query.
  const initialSpawns = harness.spawnCalls.length;
  const changedDuringLookup = harness.definitionProviders[0].provider.provideDefinition(document, position, {});
  document.version++;
  assert.deepEqual(await changedDuringLookup, []); assert.equal(harness.spawnCalls.length, initialSpawns); reset();

  for (const [name, mutate] of [
    ['source version', () => { document.version++; }],
    ['dirty source', () => { document.isDirty = true; }],
    ['closed source', () => { document.isClosed = true; }],
    ['source URI', () => { document.uri = harness.fakeVscode.Uri.file(targetFile); }],
    ['saved source bytes', () => { fs.writeFileSync(sourceFile, sourceText + 'external replacement'); }]
  ]) {
    reset(); const entered = deferred(), gate = deferred(); gates.push(gate);
    harness.fakeVscode.workspace.openTextDocument = async function(uri) {
      const opened = await originalOpen.call(this, uri); entered.resolve(); await gate.promise; return opened;
    };
    response();
    const pending = harness.definitionProviders[0].provider.provideDefinition(document, position, {});
    await entered.promise; mutate(); gate.resolve();
    assert.deepEqual(await pending, [], `${name} changed during target-document opening cannot publish native locations`);
  }
  reset(); harness.fakeVscode.workspace.openTextDocument = originalOpen;
  response();
  assert.equal((await harness.referenceProviders[0].provider.provideReferences(document, position, { includeDeclaration: false }, {})).length, 1);
  const referenceArgs = harness.spawnCalls.at(-1).args;
  assert.equal(referenceArgs[referenceArgs.indexOf('--include-declaration') + 1], 'false');

  // Nonbinding completion/document-symbol requests retain their existing result
  // semantics but discard results for an obsolete requesting buffer version.
  for (const [provider, invoke] of [
    [harness.completionProviders[0].provider, value => value.provideCompletionItems(document, position, {}, {})],
    [harness.documentSymbolProviders[0].provider, value => value.provideDocumentSymbols(document, {})]
  ]) {
    reset(); harness.queuedResults.push({ persistent: true });
    const pending = invoke(provider); await new Promise(setImmediate);
    const child = harness.spawnCalls.at(-1).child; document.version++;
    child.stdout.emit('data', Buffer.from(JSON.stringify({ ok: true, results: [{ name: 'Widget', kind: 'FunctionDeclaration', startLine: 1 }] })));
    child.emit('close', 0); assert.deepEqual(await pending, []);
  }
  reset(); response();
  assert.equal((await harness.definitionProviders[0].provider.provideDefinition(document, position, {})).length, 1,
    'a discarded older request does not revoke a later unchanged request');
} finally {
  for (const gate of gates) gate.resolve();
  if (originalOpen) harness.fakeVscode.workspace.openTextDocument = originalOpen;
  reset(); await harness.extension.deactivate(); harness.restoreGlobals();
}
console.log('Original native request/target-opening lifetime controls authored; execution deferred.');
