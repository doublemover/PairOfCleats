import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createVsCodeRuntimeHarness, prepareVsCodeFixtureWorkspace } from '../../helpers/vscode/runtime-harness.js';

// Actual registered indexed commands/providers with inert host/process seams.
const fixture = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', { prefix: 'poc-native-picker-' });
const sourceFile = fixture.resolvePath('src', 'app.ts'), targetFile = fixture.resolvePath('src', 'defs.js');
const text = 'Widget\n'; fs.writeFileSync(sourceFile, text); fs.writeFileSync(targetFile, text);
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const harness = createVsCodeRuntimeHarness({ repoRoot: fixture.root, workspaceFolders: [{ path: fixture.root }], activeFile: sourceFile,
  globalConfigValues: { cliPath: fixture.resolvePath('bin', 'pairofcleats.js') } });
const document = { uri: harness.fakeVscode.Uri.file(sourceFile), version: 1, isDirty: false, isClosed: false,
  getWordRangeAtPosition: () => ({ start: { line: 0, character: 0 }, end: { line: 0, character: 6 } }), getText: range => range ? 'Widget' : text };
const position = { line: 0, character: 3 }, originalUri = document.uri;
const shown = [], editors = [], gates = [];
let selections = 0;
const reset = () => {
  Object.assign(document, { uri: originalUri, version: 1, isDirty: false, isClosed: false }); fs.writeFileSync(sourceFile, text);
  harness.fakeVscode.window.activeTextEditor = { document, selection: { active: { ...position } } };
  harness.queuedResults.length = 0; harness.quickPickQueue.length = 0;
};
const payload = () => ({ ok: true, sourceHash: digest(sourceFile), sourceVersion: '1', coordinateUnit: 'utf16',
  status: 'resolved', binding: { status: 'resolved' }, results: [{ file: 'src/defs.js', sourceHash: digest(targetFile),
    coordinateUnit: 'utf16', startLine: 1, startCol: 1, endLine: 1, endCol: 7 }] });
const response = value => harness.queuedResults.push({ code: 0, stdout: JSON.stringify(value || payload()) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); const gate = { promise, resolve }; gates.push(gate); return gate; };
const display = async target => {
  shown.push(target); const editor = { document: target, revealRange() {} };
  Object.defineProperty(editor, 'selection', { set(value) { selections++; this.selected = value; } }); editors.push(editor); return editor;
};
let originalOpen;
try {
  harness.activate(); originalOpen = harness.fakeVscode.workspace.openTextDocument;
  harness.fakeVscode.window.showTextDocument = display;
  const definitions = () => harness.registeredCommands.get('pairofcleats.navigateDefinitions')();
  const references = () => harness.registeredCommands.get('pairofcleats.navigateReferences')();
  for (const mutate of [
    () => { document.version++; }, () => { document.isDirty = true; }, () => { document.isClosed = true; },
    () => { document.uri = harness.fakeVscode.Uri.file(targetFile); },
    () => { harness.fakeVscode.window.activeTextEditor.selection.active.character = 0; },
    () => { fs.writeFileSync(sourceFile, text + 'saved replacement'); }
  ]) {
    reset(); response(); harness.quickPickQueue.push(items => { mutate(); return items[0]; });
    const priorShows = shown.length; await definitions(); assert.equal(shown.length, priorShows,
      'a stale original source/cursor cannot reveal the still-qualified target from its old picker');
  }
  reset(); response(); harness.quickPickQueue.push(items => ({ ...items[0] }));
  const beforeLookalike = shown.length; await definitions(); assert.equal(shown.length, beforeLookalike,
    'a copied picker item cannot adopt an original native location capability');

  reset(); response(); harness.quickPickQueue.push(items => items[0]);
  const beforeWrongEditor = selections;
  harness.fakeVscode.window.showTextDocument = async target => {
    shown.push(target); const editor = { document: { ...target }, revealRange() { assert.fail('wrong displayed editor cannot reveal native range'); } };
    Object.defineProperty(editor, 'selection', { set() { assert.fail('wrong displayed editor cannot receive native selection'); } }); return editor;
  };
  await definitions(); assert.equal(selections, beforeWrongEditor);
  assert(harness.errorMessages.some(message => /Displayed editor/.test(message)));

  for (const mutate of [() => { document.version++; }, () => { fs.writeFileSync(sourceFile, text + 'replacement during display'); }]) {
    reset(); response(); harness.quickPickQueue.push(items => items[0]);
    const entered = deferred(), gate = deferred(), priorSelections = selections;
    harness.fakeVscode.window.showTextDocument = async target => { entered.resolve(); await gate.promise; return display(target); };
    const pending = references(); await entered.promise; mutate(); gate.resolve(); await pending;
    assert.equal(selections, priorSelections, 'source changed during actual display await cannot publish a native selection');
  }

  // The second target opening belongs to deliberate picker selection. A source
  // change there must stop reveal before showTextDocument is reached.
  reset(); response(); let opens = 0;
  harness.fakeVscode.window.showTextDocument = display;
  harness.fakeVscode.workspace.openTextDocument = async function(uri) {
    const opened = await originalOpen.call(this, uri); if (++opens === 2) document.version++; return opened;
  };
  harness.quickPickQueue.push(items => items[0]); const beforeOpening = shown.length;
  await definitions(); assert.equal(shown.length, beforeOpening); harness.fakeVscode.workspace.openTextDocument = originalOpen;

  // A new explicit native picker revokes the prior one through the existing
  // operation owner; its late callback cannot reacquire display authority.
  reset(); response(); const pickerEntered = deferred(), oldChoice = deferred(); let oldItem;
  harness.quickPickQueue.push(items => { oldItem = items[0]; pickerEntered.resolve(); return oldChoice.promise; });
  const older = definitions(); await pickerEntered.promise;
  response(); harness.quickPickQueue.push(items => items[0]); const prior = selections;
  await references(); oldChoice.resolve(oldItem); await older; assert.equal(selections, prior + 1);

  // Failed new requests cannot borrow old global ambiguous evidence. Only this
  // exact request's actual response may supply its candidate picker.
  reset(); const ambiguous = { ...payload(), status: 'ambiguous', binding: { status: 'ambiguous', candidates: [{
    targetId: 'original-target', file: 'src/defs.js', sourceHash: digest(targetFile), coordinateUnit: 'utf16', span: [0, 6] }] }, results: [] };
  response(ambiguous); harness.quickPickQueue.push(() => null); await definitions();
  response({ ok: false, message: 'new request failed' }); let stalePicks = 0;
  harness.quickPickQueue.push(() => { stalePicks++; return null; }); await definitions(); assert.equal(stalePicks, 0);
  harness.quickPickQueue.length = 0;
  response(ambiguous); harness.quickPickQueue.push(items => { document.version++; return items[0]; });
  const beforeAmbiguous = shown.length; await definitions(); assert.equal(shown.length, beforeAmbiguous);

  reset(); response(ambiguous); harness.quickPickQueue.push(items => items[0]); const beforeCandidate = selections;
  await definitions(); assert.equal(selections, beforeCandidate + 1);
  assert(harness.infoMessages.some(message => /binding remains ambiguous/.test(message)));
  reset(); response(); harness.quickPickQueue.push(items => items[0]); const beforeCurrent = selections;
  await definitions(); assert.equal(selections, beforeCurrent + 1, 'later unchanged source and original chosen item still publish exact native ranges');
} finally {
  for (const gate of gates) gate.resolve();
  if (originalOpen) harness.fakeVscode.workspace.openTextDocument = originalOpen;
  reset(); await harness.extension.deactivate(); harness.restoreGlobals();
}
console.log('Actual indexed picker original request/item/display editor controls authored; execution deferred.');
