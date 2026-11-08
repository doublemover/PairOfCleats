import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
const require = createRequire(import.meta.url);
const { createEvidenceCollection, evidenceSeed, MAX_EXPORT_BYTES } = require('../../../extensions/vscode/evidence-collection.js');
const { createEditorOperations } = require('../../../extensions/vscode/editor-operations.js');

// Actual collector and operation owner; inert UI, canonical fetch and write
// boundaries. No extension host, child, clipboard or filesystem execution.
const fixtures = [], gates = [];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; });
  const gate = { promise, resolve }; gates.push(gate); return gate; };
const packet = () => ({ version: '1.0.0', seed: { type: 'file', path: 'a.js' },
  primary: { file: 'a.js', ref: null, excerpt: 'original canonical source' },
  provenance: { repo: 'C:/selected/repo', indexSignature: 'original-generation', generatedAt: '2026-10-22T10:00:00.000Z',
    capsUsed: {}, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION },
  evidence: { schemaVersion: 1, complete: false }, warnings: [{ code: 'partial_frontier', message: 'Original missing flow stays unknown' }], graph: null, risk: null });
const fixture = () => {
  const value = { results: { repoRoot: 'C:/selected/repo', repoUri: 'file:///C:/selected/repo',
    hits: [{ file: 'a.js', name: 'Original source' }] }, packet: packet(), fetched: [], documents: [], shown: [], copies: [], writes: [], errors: [],
  sourcePicks: 0, reviews: 0 };
  value.operations = createEditorOperations({ spawn() { assert.fail('collector does not spawn'); } });
  const api = { workspace: {
    async openTextDocument({ content }) { const document = { content, version: 1, isClosed: false, isDirty: false, getText() { return this.content; } };
      value.documents.push(document); await value.onOpen?.(document); return document; },
    fs: { async writeFile(target, bytes) { value.writes.push({ target, text: bytes.toString('utf8') }); } }
  }, window: {
    async showQuickPick(items, options) {
      if (options.title.startsWith('Select source')) { value.sourcePicks++; assert(Object.isFrozen(items));
        return value.chooseSource ? value.chooseSource(items) : [items[0]]; }
      if (options.title.startsWith('Review evidence')) { value.reviews++; assert(Object.isFrozen(items)); assert(Object.isFrozen(items[0].packet.primary));
        return value.chooseReview ? value.chooseReview(items) : [...items]; }
      return value.chooseAction ? value.chooseAction(items) : 'Copy JSON';
    },
    async showInputBox() { await value.onPurpose?.(); return Object.hasOwn(value, 'purpose') ? value.purpose : 'Investigate original flow'; },
    async showTextDocument(document) { value.shown.push(document); return value.onDisplay ? value.onDisplay(document) : { document }; },
    async showSaveDialog() { return value.onSave ? value.onSave() : { scheme: 'file', fsPath: 'C:/chosen/evidence.json' }; },
    showErrorMessage(message) { value.errors.push(message); return value.notify?.(message); }, showInformationMessage() { return value.inform?.(); }
  }, env: { clipboard: { async writeText(text) { value.copies.push(text); } } } };
  value.copy = createEvidenceCollection({ vscode: value.operations.wrapVscode(api), operations: value.operations,
    getResults: () => value.results, fetchContext: async (seed, authority) => { value.fetched.push({ seed, authority });
      assert(Object.isFrozen(authority)); return value.fetch ? value.fetch(seed, authority) : value.packet; } });
  fixtures.push(value); return value;
};
try {
  let seedReads = 0;
  assert.equal(evidenceSeed(Object.defineProperty({}, 'chunkUid', { get() { seedReads++; return seedReads === 1 ? 'original' : 'replacement'; } })), 'chunk:original');
  assert.equal(seedReads, 1); assert.equal(evidenceSeed({ chunkUid: 123, ref: { type: 'symbol', symbolId: false } }), null);
  for (const hits of [new Array(1), [undefined], ['unqualified']]) {
    const malformed = fixture(); malformed.results.hits = hits; await malformed.copy();
    assert.equal(malformed.fetched.length, 0); assert.equal(malformed.copies.length, 0); assert.equal(malformed.errors.length, 1);
  }
  const original = fixture(), expected = structuredClone(original.packet); let issuedChoices;
  original.chooseSource = items => { issuedChoices = [items[0]]; return issuedChoices; };
  original.onPurpose = () => {
    original.results.repoRoot = 'C:/foreign/repo'; original.results.repoUri = 'file:///C:/foreign/repo'; original.results.hits[0].file = 'foreign.js';
    issuedChoices[0] = { label: 'foreign after purpose await' };
  };
  original.chooseReview = items => { original.packet.primary.file = 'mutated.js'; original.packet.warnings[0].message = 'mutated warning'; return [...items]; };
  await original.copy(); assert.equal(original.fetched[0].seed, 'file:a.js'); assert.equal(original.fetched[0].authority.repoRoot, 'C:/selected/repo');
  assert.equal(original.fetched[0].authority.repoUri, 'file:///C:/selected/repo'); assert.deepEqual(JSON.parse(original.copies[0]), [expected]);

  for (const choose of [items => [{ ...items[0] }], items => [items[0], items[0]]]) {
    const source = fixture(); source.chooseSource = choose; await source.copy();
    assert.equal(source.fetched.length, 0); assert.equal(source.copies.length, 0); assert(source.errors.some(message => /distinct original/.test(message)));
    const review = fixture(); review.chooseReview = choose; await review.copy();
    assert.equal(review.fetched.length, 1); assert.equal(review.copies.length, 0); assert(review.errors.some(message => /distinct original/.test(message)));
  }
  const sparse = fixture(); sparse.chooseSource = () => new Array(1); await sparse.copy();
  assert.equal(sparse.fetched.length, 0); assert.equal(sparse.copies.length, 0); assert(sparse.errors.some(message => /dense original/.test(message)));
  const foreignAction = fixture(); foreignAction.chooseAction = () => 'Copy Injected JSON'; await foreignAction.copy();
  assert.equal(foreignAction.copies.length, 0); assert.equal(foreignAction.writes.length, 0);
  const wrongEditor = fixture(); wrongEditor.onDisplay = document => ({ document: { ...document } }); await wrongEditor.copy();
  assert.equal(wrongEditor.reviews, 0); assert.equal(wrongEditor.copies.length, 0); assert(wrongEditor.errors.some(message => /Displayed editor/.test(message)));

  for (const mutate of [document => { document.version++; }, document => { document.isDirty = true; },
    document => { document.isClosed = true; }, document => { document.content += '\nnot the canonical preview'; }]) {
    const edited = fixture(); edited.chooseAction = () => { mutate(edited.documents.at(-1)); return 'Copy JSON'; }; await edited.copy();
    assert.equal(edited.copies.length, 0); assert.equal(edited.writes.length, 0); assert.equal(edited.errors.length, 1);
  }
  const saved = fixture(); saved.chooseAction = () => 'Export JSON'; saved.onSave = () => {
    saved.documents.at(-1).version++; return { scheme: 'file', fsPath: 'C:/chosen/evidence.json' }; };
  await saved.copy(); assert.equal(saved.writes.length, 0);
  const exportNormal = fixture(); exportNormal.chooseAction = () => 'Export JSON'; await exportNormal.copy();
  assert.deepEqual(JSON.parse(exportNormal.writes[0].text), [exportNormal.packet]);

  const display = fixture(), displayEntered = deferred(), displayGate = deferred(); let firstDisplay = true;
  display.onDisplay = async document => { if (firstDisplay) { firstDisplay = false; displayEntered.resolve(); await displayGate.promise; } return { document }; };
  const oldDisplay = display.copy(); await displayEntered.promise; await display.copy(); displayGate.resolve(); await oldDisplay;
  assert.equal(display.copies.length, 1); assert.equal(display.reviews, 1, 'late old preview cannot reacquire a current review action');

  const fetching = fixture(), fetchEntered = deferred(), fetchGate = deferred(); let firstFetch = true;
  fetching.fetch = async () => { if (firstFetch) { firstFetch = false; fetchEntered.resolve(); await fetchGate.promise; } return fetching.packet; };
  const oldFetch = fetching.copy(); await fetchEntered.promise; await fetching.copy(); fetchGate.resolve(); await oldFetch;
  assert.equal(fetching.copies.length, 1); assert.equal(fetching.documents.length, 2, 'late old packet cannot create either preview');

  const saving = fixture(), saveEntered = deferred(), saveGate = deferred(); let firstAction = true;
  saving.chooseAction = () => { const action = firstAction ? 'Export JSON' : 'Copy JSON'; firstAction = false; return action; };
  saving.onSave = async () => { saveEntered.resolve(); await saveGate.promise; return { scheme: 'file', fsPath: 'C:/chosen/old.json' }; };
  const oldSave = saving.copy(); await saveEntered.promise; await saving.copy(); saveGate.resolve(); await oldSave;
  assert.equal(saving.copies.length, 1); assert.equal(saving.writes.length, 0, 'superseded save-dialog result cannot start a file write');

  const changedJson = fixture(); changedJson.packet.toJSON = () => ({ version: '', primary: {}, provenance: {}, evidence: {} });
  await changedJson.copy(); assert.equal(changedJson.documents.length, 0); assert.equal(changedJson.copies.length, 0);
  const oversized = fixture(); oversized.packet.primary.excerpt = 'x'.repeat(MAX_EXPORT_BYTES);
  await oversized.copy(); assert.equal(oversized.documents.length, 0); assert.equal(oversized.copies.length, 0);

  const malformedRender = fixture(); malformedRender.packet.graph = { warnings: [null] };
  const malformedResult = await malformedRender.copy(); assert.equal(malformedResult.ok, false);
  assert(malformedResult.primaryError instanceof TypeError); assert.equal(malformedRender.documents.length, 0); assert.equal(malformedRender.reviews, 0,
    'an original rendering failure is not an oversized-selection recovery notice');
  const reduced = fixture(); reduced.results.hits.push({ file: 'b.js', name: 'Second source' });
  reduced.packet.primary.excerpt = 'x'.repeat(70 * 1024); reduced.chooseSource = items => [...items]; reduced.chooseReview = items => [items[0]];
  const recovered = await reduced.copy(); assert.equal(recovered.kind, 'editor-failure-evidence'); assert.equal(recovered.failures.length, 1);
  assert.match(recovered.primaryError.message, /256 KiB/); assert.equal(reduced.copies.length, 1); assert.equal(JSON.parse(reduced.copies[0]).length, 1);
  assert.match(reduced.documents[0].content, /selection exceeds the export bound/); assert.equal(reduced.errors.length, 0);
  const invalidPurpose = fixture(); invalidPurpose.purpose = { toString() { assert.fail('native text input cannot authorize object coercion or replay a prior budget error'); } };
  const purposeFailure = await invalidPurpose.copy(); assert(purposeFailure.primaryError instanceof TypeError);
  assert.equal(invalidPurpose.fetched.length, 0); assert.equal(invalidPurpose.documents.length, 0);

  for (const primary of [undefined, null, false, 0, '']) {
    const failed = fixture(); failed.fetch = async () => { throw primary; };
    const result = await failed.copy(); assert.equal(result.ok, false); assert.equal(result.primaryError, primary);
    assert.deepEqual(result.inspectionErrors, []); assert.equal(failed.copies.length, 0);
  }
  let messageReads = 0;
  const originalInspection = Object.freeze(Object.defineProperty(new Error('original diagnostic work'), 'cacheOwnershipReleased', { value: () => false }));
  const primary = Object.freeze(Object.defineProperty({}, 'message', { get() { messageReads++; throw originalInspection; } }));
  const inspected = fixture(); inspected.fetch = async () => { throw primary; };
  const inspectedResult = await inspected.copy(); assert.equal(inspectedResult.primaryError, primary);
  assert.deepEqual(inspectedResult.inspectionErrors, [originalInspection]); assert.equal(messageReads, 1);
  assert.equal(inspectedResult.inspectionErrors[0].cacheOwnershipReleased(), false, 'independent original inspection owner remains available without a settled claim');
  const repeatedInspection = await inspected.copy(); assert.equal(repeatedInspection.primaryError, primary);
  assert.deepEqual(repeatedInspection.inspectionErrors, [originalInspection]); assert.equal(messageReads, 1,
    'a later report cannot reread original diagnostic getter evidence');

  for (const notification of [undefined, null, false, 0, '', Object.freeze(new Error('original notification failure'))]) {
    const failedNotification = fixture(), operationError = Object.freeze(new Error('original collection failure'));
    failedNotification.fetch = () => { throw operationError; }; failedNotification.notify = () => { throw notification; };
    const result = await failedNotification.copy(); assert.equal(result.primaryError, operationError);
    assert.deepEqual(result.inspectionErrors, [notification]); assert.equal(failedNotification.errors.length, 1);
  }
  const notified = fixture(), notificationEntered = deferred(), notificationGate = deferred();
  const operationError = Object.freeze(new Error('original asynchronous collection failure'));
  const notificationError = Object.freeze(new Error('original asynchronous notification failure'));
  notified.fetch = () => { throw operationError; }; notified.notify = async () => { notificationEntered.resolve(); await notificationGate.promise; throw notificationError; };
  const oldNotification = notified.copy(); await notificationEntered.promise;
  notified.fetch = null; await notified.copy(); notificationGate.resolve(); const reported = await oldNotification;
  assert.equal(reported.primaryError, operationError); assert.deepEqual(reported.inspectionErrors, [notificationError]); assert.equal(notified.errors.length, 1);
  assert.equal(notified.copies.length, 1, 'accepted old notification settlement cannot revoke or overwrite newer collection output');
  const information = fixture(), informationalFailure = Object.freeze(new Error('original no-results notification'));
  information.results.hits = []; information.inform = async () => { throw informationalFailure; };
  const informationResult = await information.copy(); assert.equal(informationResult.primaryError, informationalFailure);
  assert.equal(information.errors.length, 1); assert.equal(information.sourcePicks, 0);

  const deniedParent = fixture(); await deniedParent.copy(undefined, () => false);
  assert.equal(deniedParent.sourcePicks, 0); assert.equal(deniedParent.fetched.length, 0);
  for (const boundary of ['purpose', 'fetch', 'display', 'save']) {
    const revoked = fixture(); let current = true;
    if (boundary === 'purpose') revoked.onPurpose = () => { current = false; };
    if (boundary === 'fetch') revoked.fetch = () => { current = false; return revoked.packet; };
    if (boundary === 'display') revoked.onDisplay = document => { current = false; return { document }; };
    if (boundary === 'save') { revoked.chooseAction = () => 'Export JSON'; revoked.onSave = () => {
      current = false; return { scheme: 'file', fsPath: 'C:/chosen/revoked.json' }; }; }
    await revoked.copy(undefined, () => current);
    assert.equal(revoked.copies.length, 0); assert.equal(revoked.writes.length, 0, `${boundary} cannot reacquire parent publication authority`);
  }
  for (const failure of [undefined, null, false, 0, '']) {
    const failedParent = fixture(); let calls = 0;
    const result = await failedParent.copy(undefined, () => { calls++; throw failure; });
    assert.equal(result.primaryError, failure); assert.equal(calls, 1, 'original failing prerequisite is not retried for diagnostics');
    assert.equal(failedParent.sourcePicks, 0); assert.equal(failedParent.copies.length, 0);
  }
  const invalidParent = fixture(); const invalidResult = await invalidParent.copy(undefined, { isCurrent: () => true });
  assert.equal(invalidResult.ok, false); assert.equal(invalidParent.sourcePicks, 0, 'lookalike prerequisite cannot authorize collection');
} finally {
  for (const gate of gates) gate.resolve();
  for (const value of fixtures) await value.operations.dispose();
}
console.log('Actual editor collector immutable choices/repository/packet/preview lifetime controls authored; execution deferred.');
