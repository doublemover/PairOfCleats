import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createSemanticEvidenceWorkflow } = require('../../../extensions/vscode/semantic-evidence.js');
const { createEditorOperations } = require('../../../extensions/vscode/editor-operations.js');
const generation = { baseBuildId: 'original-semantic-failure', semanticRevision: 0 };
const ref = { partitionId: 'sy1:' + 'a'.repeat(64), localId: 1 };
const fixtures = [], gates = [];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); const gate = { promise, resolve }; gates.push(gate); return gate; };
const record = items => items.find(item => item.record);
const make = ({ discover = false, api = false } = {}) => {
  const value = { queue: [], inputs: [], requests: [], reports: [], errors: [], copies: [], pickers: [],
    payload: { generation: { ...generation }, status: 'partial', records: [{ kind: 'operation', ref, span: [0, 1] }], edges: [],
      frontier: [{ reason: 'original-incomplete-evidence' }] } };
  value.operations = createEditorOperations({ spawn() { assert.fail('direct semantic failure fixture does not spawn'); } });
  const ui = { window: {
    async showQuickPick(items, options) { value.pickers.push(options); const next = value.queue.shift(); return typeof next === 'function' ? next(items)
      : items.find(item => item.action === next || item.value === next || item === next); },
    async showInputBox() { return value.inputs.shift(); }, async showTextDocument(document) { return { document }; },
    async showErrorMessage(message) { value.errors.push(message); return value.notify?.(); }
  }, workspace: { async openTextDocument(input) { value.reports.push(input.content); return input; } },
  env: { clipboard: { async writeText(text) { value.copies.push(text); } } } };
  value.run = createSemanticEvidenceWorkflow({ vscode: value.operations.wrapVscode(ui), operations: value.operations,
    resolveRepo: async () => ({ repoRoot: '/original-repo' }), chooseTransport: async () => ({ transport: api ? 'api' : 'cli',
      ...(api ? { execution: { capabilities: { 'semantic-find': true, 'semantic-detail': true } } } : {}) }),
    getCursorSeed: () => discover || api ? null : ({ generation, selector: { target: ref } }),
    ...(discover ? { discoverGeneration: async () => value.discover() } : {}),
    execute: async (operation, request) => { value.requests.push({ operation, request }); return value.execute ? value.execute(operation, request) : value.payload; } });
  fixtures.push(value); return value;
};
try {
  const normal = make(); normal.queue.push('cursor', 'back'); assert.equal(await normal.run(), undefined); assert.equal(normal.errors.length, 0);
  for (const primary of [undefined, null, false, 0, '']) {
    const failed = make(); failed.queue.push('cursor'); failed.execute = () => { throw primary; };
    const evidence = await failed.run(); assert.equal(evidence.kind, 'editor-failure-evidence'); assert.equal(evidence.primaryError, primary);
    assert.deepEqual(evidence.inspectionErrors, []); assert.equal(failed.errors.length, 1); assert.equal(failed.reports.length, 0);
    const absent = make(); absent.queue.push('cursor'); absent.execute = () => primary;
    const response = await absent.run(); assert.equal(response.failures[0].primaryError.cause, primary); assert.equal(absent.errors.length, 1,
      'a current falsey response is unavailable evidence rather than silent cancellation');
    const discovering = make({ discover: true }); discovering.discover = () => { throw primary; };
    discovering.queue.push('discover', 'manual', 'Structural operation', 'back'); discovering.inputs.push(generation.baseBuildId, 'invoke');
    const recovered = await discovering.run(); assert.equal(recovered.primaryError, primary); assert.equal(discovering.requests.length, 1);
    assert.equal(discovering.errors.length, 0, 'discovery recovery remains in its original correction picker');
    assert.equal(discovering.pickers.find(picker => picker.title === 'Semantic generation discovery unavailable').placeHolder, 'Operation failed.');
  }
  let messageReads = 0;
  const inspection = Object.freeze({ cacheOwnershipReleased: () => false });
  const original = Object.freeze(Object.defineProperties({}, {
    message: { get() { messageReads++; throw inspection; } }, stack: { get() { assert.fail('lazy diagnostic stack is never prepared or projected'); } }
  }));
  const notified = Object.freeze({ sceneOwnershipReleased: () => false });
  const recovered = make(); recovered.queue.push('cursor', record, 'detail', record, 'detail', 'copy', 'back');
  recovered.execute = operation => { if (operation === 'detail') throw original; return recovered.payload; };
  recovered.notify = () => { throw notified; };
  const result = await recovered.run(); assert.equal(result.primaryError, original); assert.equal(result.failures.length, 2); assert.equal(messageReads, 1);
  assert.deepEqual(result.failures[0].inspectionErrors, [inspection, notified]); assert.deepEqual(result.failures[1].inspectionErrors, [inspection, notified]);
  assert.equal(result.failures[0].inspectionErrors[0].cacheOwnershipReleased(), false); assert.equal(result.failures[0].inspectionErrors[1].sceneOwnershipReleased(), false);
  assert(Object.isFrozen(result)); assert(Object.isFrozen(result.failures)); assert(Object.isFrozen(result.inspectionErrors));
  assert.deepEqual(JSON.parse(recovered.copies[0]), recovered.payload); assert.deepEqual(recovered.requests.map(row => row.operation), ['find', 'detail', 'detail'],
    'manual recovery does not retry a failed consumer or replace captured previous frontier');
  assert.equal(Object.hasOwn(result, 'ok'), false, 'diagnostic evidence does not reclassify later successful copy as a workflow failure');

  const page = make({ api: true }); page.payload.cursor = 'original-cursor'; page.inputs.push(generation.baseBuildId, 'invoke');
  page.queue.push('Structural operation', 'more', 'copy', 'back'); page.execute = (_operation, request) => request.cursor ? null : page.payload;
  const pageResult = await page.run(); assert.equal(pageResult.primaryError.cause, null); assert.deepEqual(JSON.parse(page.copies[0]), page.payload);
  assert.equal(page.requests.length, 2); assert.equal(page.requests[1].request.cursor, 'original-cursor');

  const stale = make(), entered = deferred(), gate = deferred(); const primary = Object.freeze(new Error('original detail notification'));
  stale.queue.push('cursor', record, 'detail'); stale.execute = operation => { if (operation === 'detail') throw primary; return stale.payload; };
  stale.notify = async () => { entered.resolve(); await gate.promise; throw notified; };
  const older = stale.run(); await entered.promise; stale.queue.length = 0; stale.queue.push('cursor', 'back');
  await stale.run(); gate.resolve(); const oldEvidence = await older;
  assert.equal(oldEvidence.primaryError, primary); assert.deepEqual(oldEvidence.inspectionErrors, [notified]); assert.equal(stale.reports.length, 2,
    'late old notification cannot restore an old report over a newer semantic workflow');
} finally { for (const gate of gates) gate.resolve(); for (const value of fixtures) await value.operations.dispose(); }
console.log('Actual semantic original failure/discovery/recovery/notification evidence controls authored; execution deferred.');
