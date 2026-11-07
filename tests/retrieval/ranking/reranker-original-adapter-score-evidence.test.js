import assert from 'node:assert/strict';
import { rerankEvidence } from '../../../src/retrieval/pipeline/evidence-reranker.js';

// Actual consumer/admission/classification owners, inert callbacks and promises.
const hits = [{ file: 'original-a.js', start: 0, end: 2, score: 4, scoreType: 'bm25' },
  { file: 'original-b.js', start: 0, end: 2, score: 3, scoreType: 'bm25' }];
const rows = () => [{ index: 0, score: .2 }, { index: 1, score: .9 }];
const rejected = async invoke => { try { await invoke(); } catch (primary) { return primary; } assert.fail('expected original rejection'); };
let complete, calls = 0; const gate = new Promise(resolve => { complete = resolve; });
const reads = Object.create(null), counted = (name, value) => ({ configurable: true, get() { reads[name] = (reads[name] || 0) + 1; return value; } });
const range = Object.defineProperties({}, { min: counted('min', 0), max: counted('max', 1) });
let adapter;
adapter = Object.defineProperties({}, { id: counted('id', 'original-adapter'), identityKey: counted('identity', 'a'.repeat(64)),
  formattingIdentity: counted('formatting', 'original-formatting'), scoreRange: counted('range', range),
  rerank: counted('callback', function(request) { calls++; assert.equal(this, adapter); assert.equal(Object.isFrozen(request.hits), true); return gate; }) });
const operation = rerankEvidence({ adapter, hits });
for (const name of ['id', 'identityKey', 'formattingIdentity', 'scoreRange', 'rerank']) {
  Object.defineProperty(adapter, name, { value: () => assert.fail('later adapter fields are not original request authority') });
}
Object.defineProperty(range, 'min', { value: 100 }); Object.defineProperty(range, 'max', { value: 200 });
complete(rows()); const result = await operation;
assert.equal(calls, 1); assert.deepEqual(result.map(hit => hit.file), ['original-b.js', 'original-a.js']);
assert.equal(result[0].reranker, 'original-adapter'); assert.equal(result.rerankDiagnostic.adapterIdentity, 'a'.repeat(64));
assert.deepEqual({ ...reads }, { id: 1, callback: 1, identity: 1, formatting: 1, range: 1, min: 1, max: 1 });

const run = (output, options = {}) => rerankEvidence({ adapter: { id: 'passive-score-owner', scoreRange: { min: 0, max: 1 }, rerank: async () => output }, hits, ...options });
let iterated = 0; const ownRows = rows();
ownRows[Symbol.iterator] = () => { iterated++; throw new Error('score array iterator is not ranking evidence'); };
assert.equal((await run(ownRows))[0].file, 'original-b.js'); assert.equal(iterated, 0);
const getless = rows().map(row => new Proxy(row, { get() { assert.fail('row value getters are not ranking evidence'); } }));
assert.equal((await run(getless))[0].file, 'original-b.js');
let getterCalls = 0;
const accessor = Object.defineProperty({ index: 0 }, 'score', { enumerable: true, get() { getterCalls++; return .5; } });
const inherited = Object.create({ index: 0, score: .5 });
const sparse = new Array(2); sparse[1] = { index: 1, score: .5 };
const accessorSlot = rows(); Object.defineProperty(accessorSlot, 0, { get() { getterCalls++; return { index: 0, score: .5 }; } });
const nonenumerable = rows(); Object.defineProperty(nonenumerable[0], 'hit', { value: hits[1] });
const symbol = rows(); symbol[0][Symbol('injected')] = 1;
for (const invalid of [[accessor, rows()[1]], [inherited, rows()[1]], sparse, accessorSlot, nonenumerable, symbol,
  [{ index: 0, score: .5 }, { index: 0, score: .9 }]]) {
  const fallback = await run(invalid, { fallback: true }); assert.equal(fallback.rerankDiagnostic.status, 'fallback');
  assert.deepEqual(fallback.map(hit => hit.score), [4, 3]);
}
assert.equal(getterCalls, 0, 'opaque/accessor and inherited values cannot be admitted by executing them');

let ready = false;
const original = Object.freeze(Object.defineProperty(new Error('original descriptor inspection work'), 'cacheOwnershipReleased', { value() { assert.equal(this, original); return ready; } }));
const trapped = new Proxy({ index: 0, score: .5 }, { getOwnPropertyDescriptor() { throw original; } });
assert.equal(await rejected(() => run([trapped, rows()[1]], { fallback: true })), original,
  'actual inspection ownership cannot be swallowed by fallback'); ready = true;
assert.equal((await run([trapped, rows()[1]], { fallback: true })).rerankDiagnostic.status, 'fallback');

// Each original passive index/score is captured once. A descriptor trap cannot
// cause a later reread to change the validated source member or retained score.
const target = { index: 0, score: .9 };
const changing = new Proxy(target, { getOwnPropertyDescriptor(value, name) {
  const descriptor = Object.getOwnPropertyDescriptor(value, name); if (name === 'score') value.index = 1; return descriptor;
} });
const captured = await run([changing, { index: 1, score: .2 }]); assert.equal(captured[0].file, 'original-a.js');

for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('original diagnostic callback'))]) {
  let modelCalls = 0, diagnosticCalls = 0, observed;
  const rejectedDiagnostic = await rejected(() => rerankEvidence({ adapter: { id: 'diagnostic-independent', rerank: async () => { modelCalls++; return rows(); } },
    hits, fallback: true, onDiagnostic: diagnostic => { diagnosticCalls++; observed = diagnostic; throw primary; } }));
  assert.equal(rejectedDiagnostic, primary); assert.equal(observed.status, 'scored'); assert.equal(modelCalls, 1); assert.equal(diagnosticCalls, 1,
    'diagnostic failure cannot retry notification or relabel actual scoring as fallback');
}
let rejectDiagnostic, callbackStarted;
const started = new Promise(resolve => { callbackStarted = resolve; }), diagnosticGate = new Promise((_, reject) => { rejectDiagnostic = reject; });
const diagnosticOriginal = Object.freeze(new Error('original asynchronous diagnostic failure'));
const asynchronous = rerankEvidence({ adapter: { id: 'async-diagnostic', rerank: async () => rows() }, hits,
  onDiagnostic: () => { callbackStarted(); return diagnosticGate; } });
await started; rejectDiagnostic(diagnosticOriginal); assert.equal(await rejected(() => asynchronous), diagnosticOriginal);

let settleLate, lateReady = false, diagnosticReady = false;
const lateGate = new Promise((_, reject) => { settleLate = reject; });
const lateNative = Object.freeze(Object.defineProperty(new Error('independent actual late adapter owner'), 'cacheOwnershipReleased', { value: () => lateReady }));
const diagnosticWork = Object.freeze(Object.defineProperty(new Error('independent actual diagnostic owner'), 'cacheOwnershipReleased', { value: () => diagnosticReady }));
const pendingAdapter = { id: 'pending-original-diagnostic', rerank: () => lateGate };
const pendingFailure = await rejected(() => rerankEvidence({ adapter: pendingAdapter, hits, maxMs: 5, fallback: true,
  onDiagnostic: diagnostic => { assert.equal(diagnostic.status, 'fallback'); assert.equal(diagnostic.pending, true); throw diagnosticWork; } }));
assert.equal(pendingFailure.cause, diagnosticWork); assert.equal(pendingFailure.rerankerOwner, pendingAdapter);
assert.equal(pendingFailure.cacheOwnershipReleased(), false); diagnosticReady = true; assert.equal(pendingFailure.cacheOwnershipReleased(), false);
settleLate(lateNative); const lateReceipt = await pendingFailure.rerankerSettlement;
assert.equal(lateReceipt.primaryError, lateNative); assert.equal(pendingFailure.cacheOwnershipReleased(), false);
lateReady = true; assert.equal(pendingFailure.cacheOwnershipReleased(), true); diagnosticReady = false;
assert.equal(pendingFailure.cacheOwnershipReleased(), false, 'diagnostic and original adapter owners remain independent observations'); diagnosticReady = true;
let notifications = 0;
const previousOutput = await run(rows()); const unchanged = await rerankEvidence({ adapter: null, hits: previousOutput, onDiagnostic: () => { notifications++; } });
assert.equal(unchanged, previousOutput); assert.equal(notifications, 0, 'no-adapter passthrough cannot adopt a prior output diagnostic');
assert.deepEqual(hits.map(hit => hit.score), [4, 3]);
console.log('Actual reranker original adapter/passive score/independent diagnostic controls authored; execution deferred.');
