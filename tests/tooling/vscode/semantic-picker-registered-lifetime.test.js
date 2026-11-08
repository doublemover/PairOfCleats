import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createVsCodeRuntimeHarness, prepareVsCodeFixtureWorkspace } from '../../helpers/vscode/runtime-harness.js';

// Actual registered command/adapter with inert CLI and editor host boundaries.
const fixture = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', { prefix: 'poc-semantic-picker-' });
const file = fixture.resolvePath('src', 'app.ts'), text = 'Widget\n'; fs.writeFileSync(file, text);
const generation = { baseBuildId: 'semantic-picker-fixture', semanticRevision: 0 };
const ref = { partitionId: 'sy1:' + 'a'.repeat(64), localId: 1 };
const payload = (localId = 1) => ({ generation, status: 'partial', records: [{ kind: 'operation', ref: { ...ref, localId }, span: [0, 6] }],
  edges: [], frontier: [{ reason: 'analysis_incomplete' }], sourceRefs: [{ ref: { ...ref, localId },
    sourceUnitId: 'su1:' + 'b'.repeat(64), path: 'src/app.ts', sourceHash: createHash('sha256').update(text).digest('hex'), coordinateUnit: 'utf16' }] });
const harness = createVsCodeRuntimeHarness({ repoRoot: fixture.root, workspaceFolders: [{ path: fixture.root }], activeFile: file,
  globalConfigValues: { cliPath: fixture.resolvePath('bin', 'pairofcleats.js'), apiExecutionMode: 'cli' } });
const gates = [], shownTargets = []; let selections = 0;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); const gate = { promise, resolve }; gates.push(gate); return gate; };
const chooseRecord = items => { assert(Object.isFrozen(items)); const item = items.find(row => row.record); assert(Object.isFrozen(item.record)); return item; };
const choose = value => items => items.find(item => item.value === value || item.action === value || item === value);
const display = async document => {
  const editor = { document, revealRange() {} };
  if (document.uri?.scheme === 'file') shownTargets.push(document);
  Object.defineProperty(editor, 'selection', { set() { selections++; } }); return editor;
};
let originalDisplay;
try {
  harness.activate(); originalDisplay = harness.fakeVscode.window.showTextDocument;
  const node = { resultSet: { repoRoot: fixture.root }, hit: { chunkUid: 'selected-original-chunk' } };
  const run = () => harness.registeredCommands.get('pairofcleats.semanticEvidence')(node);
  const reset = () => {
    fs.writeFileSync(file, text); harness.fakeVscode.workspace.textDocuments.length = 0;
    harness.queuedResults.length = 0; harness.quickPickQueue.length = 0; harness.inputQueue.length = 0;
    harness.fakeVscode.window.showTextDocument = display;
  };
  const start = (data, steps) => {
    harness.queuedResults.push({ code: 0, stdout: JSON.stringify(data) }); harness.inputQueue.push(generation.baseBuildId);
    harness.quickPickQueue.push(choose('manual'), choose('Selected chunk ownership'), ...steps);
  };

  reset(); start(payload(), [chooseRecord, choose('open'), choose('back')]);
  let before = selections; await run(); assert.equal(selections, before + 1, 'current original source/editor still receives exact range');
  for (const steps of [
    [items => ({ ...chooseRecord(items) })],
    [chooseRecord, items => ({ ...items.find(item => item.value === 'open') }), choose('back')]
  ]) {
    reset(); start(payload(), steps); const opened = shownTargets.length; before = selections; await run();
    assert.equal(shownTargets.length, opened); assert.equal(selections, before);
    assert(harness.errorMessages.some(message => /original item/.test(message)));
  }
  reset(); start(payload(), [chooseRecord, choose('open'), choose('back')]); before = selections;
  harness.fakeVscode.window.showTextDocument = async document => {
    if (document.uri?.scheme !== 'file') return display(document);
    shownTargets.push(document); return { document: { ...document }, revealRange() { assert.fail('foreign editor cannot reveal a qualified range'); },
      set selection(_value) { assert.fail('matching text cannot authorize a foreign editor selection'); } };
  };
  await run(); assert.equal(selections, before); assert(harness.errorMessages.some(message => /Displayed editor/.test(message)));

  for (const mutate of [document => { document.version++; }, document => { document.isDirty = true; },
    document => { document.isClosed = true; }, document => { document.uri = { scheme: 'untitled', fsPath: file }; },
    () => { fs.writeFileSync(file, text + 'replacement'); }]) {
    reset(); start(payload(), [chooseRecord, choose('open'), choose('back')]); before = selections;
    harness.fakeVscode.window.showTextDocument = async document => {
      const editor = await display(document); if (document.uri?.scheme === 'file') mutate(document); return editor;
    };
    await run(); assert.equal(selections, before, 'target URI/bytes/buffer/version authority remains required after display');
  }
  for (const mutate of [data => { data.sourceRefs[0].path = '../outside.ts'; }, data => { delete data.sourceRefs[0].sourceHash; },
    data => { data.sourceRefs[0].coordinateUnit = 'utf8-byte'; }, data => { data.generation = { ...generation, baseBuildId: 'foreign-generation' }; }]) {
    reset(); const data = payload(); mutate(data); start(data, [chooseRecord, choose('open'), choose('back')]);
    before = selections; const opened = shownTargets.length; await run(); assert.equal(selections, before); assert.equal(shownTargets.length, opened);
  }

  // Detail publication must keep its actual new payload rather than allowing
  // the prior state.payload spread to overwrite the newly displayed response.
  reset(); const detail = payload(2); detail.frontier = [{ reason: 'detail-original-frontier' }];
  start(payload(), [chooseRecord, choose('detail'), choose('copy'), choose('back'), choose('back')]);
  harness.queuedResults.push({ code: 0, stdout: JSON.stringify(detail) }); const copied = harness.clipboardWrites.length;
  await run(); assert.equal(harness.clipboardWrites.length, copied + 1); assert.deepEqual(JSON.parse(harness.clipboardWrites.at(-1)), detail);

  reset(); const entered = deferred(), gate = deferred(); let first = true;
  start(payload(), [chooseRecord, choose('open'), choose('back')]);
  harness.fakeVscode.window.showTextDocument = async document => {
    if (document.uri?.scheme === 'file' && first) { first = false; entered.resolve(); await gate.promise; } return display(document);
  };
  const older = run(); await entered.promise; harness.quickPickQueue.length = 0;
  start(payload(), [chooseRecord, choose('open'), choose('back')]); before = selections;
  await run(); gate.resolve(); await older; assert.equal(selections, before + 1, 'late original source display cannot publish after a newer registered workflow');
} finally {
  for (const gate of gates) gate.resolve();
  if (originalDisplay) harness.fakeVscode.window.showTextDocument = originalDisplay;
  await harness.extension.deactivate(); harness.restoreGlobals();
}
console.log('Registered semantic picker original item/editor/source/detail lifetime controls authored; execution deferred.');
