import assert from 'node:assert/strict';
import { bootstrapAdjacencyView, applyAdjacencyDelta, lookupAdjacencyView } from '../../../src/index/semantic/views/adjacency-delta.js';
import { openOccurrenceCursor } from '../../../src/semantic/relations/factor.js';

const definition = { viewId: 'owned-adjacency', producerId: 'fixture', producerEpoch: 'one', ruleVersion: '1',
  configHash: 'a'.repeat(64), domainId: 'fixture-domain', algebra: 'signed-occurrence-bag-v1' };
const world = revision => ({ generation: { baseBuildId: `fixture-${revision}`, semanticRevision: 0 },
  repositoryNamespace: 'fixture', contextKey: 'fixture-policy' });
const row = (id, multiplicity = '2') => ({ occurrenceId: `occurrence:${id}`, supportId: id,
  from: 'a', to: id, multiplicity, sourceRef: `source:${id}` });
const bootstrap = (overrides = {}) => ({ definition, world: world(0), rows: [row('b'), row('c')], complete: true, ...overrides });
const base = bootstrapAdjacencyView(bootstrap());
const batch = id => ({ batchId: id, definition, fromWorld: base.world, toWorld: world(1), baseRoot: base.rootId,
  edits: [row('b', '-1'), row('c', '-1')], capturedDomainComplete: true });
const enumerate = view => {
  const cursor = openOccurrenceCursor({ relation: view.relation });
  try { return cursor.next({ limit: 32 }).items.map(item => `${item.tuple.from}:${item.tuple.to}`).sort(); }
  finally { cursor.close(); }
};
assert.deepEqual(enumerate(base), ['a:b', 'a:b', 'a:c', 'a:c']);

for (const targetPoll of [1, 2, 3, 4]) {
  const input = structuredClone(batch(`captured-${targetPoll}`)), original = structuredClone(input);
  let polls = 0;
  const signal = { get aborted() {
    if (++polls === targetPoll) {
      input.edits[0].multiplicity = '-2'; input.edits[1].multiplicity = '-2';
      input.edits[0].from = 'rewritten'; input.edits[1].sourceRef = 'rewritten';
      input.toWorld.generation.baseBuildId = 'rewritten'; input.capturedDomainComplete = false;
      input.batchId = 'rewritten'; input.definition.ruleVersion = 'rewritten';
    }
    return false;
  } };
  const result = applyAdjacencyDelta(base, input, { signal });
  assert.equal(result.status, 'materialized-private'); assert.equal(polls, 4);
  assert.equal(result.consumed, true); assert.equal(result.view.capturedDomainComplete, true);
  assert.deepEqual(result.view.world, world(1));
  assert.deepEqual(enumerate(result.view), ['a:b', 'a:c'], 'captured minus-one work cannot become caller-mutated minus-two work');
  assert.deepEqual(enumerate(base), ['a:b', 'a:b', 'a:c', 'a:c'], 'old handle remains independently usable');
  assert.deepEqual(result.membershipChanges, []);
  assert.ok(result.supportChanges.every(change => change.multiplicity === '-1' && change.from === 'a'));
  const rebuilt = bootstrapAdjacencyView(bootstrap({ world: world(1), rows: [row('b', '1'), row('c', '1')] }));
  assert.equal(result.view.relation.rootId, rebuilt.relation.rootId, 'independent clean bootstrap agrees on the physical occurrence bag');
  assert.equal(result.view.rootId, applyAdjacencyDelta(base, original).view.rootId, 'root and ledger identify exactly the captured transition');
  let replayPolls = 0;
  assert.equal(applyAdjacencyDelta(result.view, original, { signal: { get aborted() { replayPolls++; return true; } } }).status, 'replayed');
  assert.equal(replayPolls, 0, 'identical replay retains its established ordering before cancellation polls');
  assert.throws(() => applyAdjacencyDelta(result.view, { ...original, edits: [row('b', '-2')] }), /replay changed content/);
  assert.equal(lookupAdjacencyView(result.view, 'missing').observation, 'absent-in-captured-domain');
}

const optionsInput = structuredClone(batch('options-getter')), optionsOriginal = structuredClone(optionsInput);
const optionsResult = applyAdjacencyDelta(base, optionsInput, { get signal() {
  optionsInput.toWorld = world(9); optionsInput.edits[0].multiplicity = '-2'; return null;
} });
assert.equal(optionsResult.view.rootId, applyAdjacencyDelta(base, optionsOriginal).view.rootId);
for (const cancelAt of [1, 2, 3, 4]) {
  let polls = 0;
  const input = batch(`cancel-${cancelAt}`);
  const result = applyAdjacencyDelta(base, input, { signal: { get aborted() { return ++polls === cancelAt; } } });
  assert.equal(result.status, 'cancelled'); assert.equal(result.consumed, false); assert.equal(result.view, base);
  assert.equal(applyAdjacencyDelta(base, input).status, 'materialized-private', 'cancelled capture did not consume a ledger entry');
}
const controller = new AbortController(); controller.abort();
assert.equal(applyAdjacencyDelta(base, batch('native-cancel'), { signal: controller.signal }).view, base);
assert.equal(applyAdjacencyDelta(base, batch('work-budget'), { maxWork: 0 }).status, 'work-budget');

let getters = 0, cancellationPolls = 0;
const invalidInputs = [
  value => { Object.defineProperty(value, 'edits', { enumerable: true, get() { getters++; return []; } }); },
  value => { Object.defineProperty(value.edits, '0', { enumerable: true, get() { getters++; return row('b'); } }); },
  value => { value.edits.extra = 1; },
  value => { delete value.edits[0]; },
  value => { Object.defineProperty(value.edits, 'hidden', { get() { getters++; return 1; } }); },
  value => { Object.defineProperty(value.edits[0], 'hidden', { get() { getters++; return 1; } }); },
  value => { value.edits[0].unexpected = true; },
  value => { Object.defineProperty(value, 'hidden', { value: 1 }); }
];
for (const decorate of invalidInputs) {
  const input = structuredClone(batch('invalid-passive')); decorate(input);
  assert.throws(() => applyAdjacencyDelta(base, input, { signal: { get aborted() { cancellationPolls++; return false; } } }), TypeError);
}
const bootGetter = bootstrap(); Object.defineProperty(bootGetter, 'rows', { enumerable: true, get() { getters++; return []; } });
assert.throws(() => bootstrapAdjacencyView(bootGetter), TypeError);
const bootLimit = bootstrap(); Object.defineProperty(bootLimit, 'maxBytes', { enumerable: true, get() { getters++; return 4096; } });
assert.throws(() => bootstrapAdjacencyView(bootLimit), TypeError);
const bootDecorated = bootstrap(); Object.defineProperty(bootDecorated.rows, 'hidden', { get() { getters++; return 1; } });
assert.throws(() => bootstrapAdjacencyView(bootDecorated), TypeError);
assert.equal(getters, 0); assert.equal(cancellationPolls, 0, 'passive admission precedes cancellation effects');

const tiny = bootstrapAdjacencyView(bootstrap({ rows: [], maxBytes: 1024 }));
const oversized = { ...batch('x'.repeat(1024)), baseRoot: tiny.rootId, edits: [] };
const parse = JSON.parse;
let parsed = 0;
try {
  JSON.parse = (...args) => { parsed++; return parse(...args); };
  assert.throws(() => applyAdjacencyDelta(tiny, oversized), { code: 'ERR_SEMANTIC_JSON_BUDGET' });
  assert.throws(() => bootstrapAdjacencyView(bootstrap({ rows: [{ ...row('b'), sourceRef: 'x'.repeat(4096) }], maxBytes: 1024 })),
    { code: 'ERR_SEMANTIC_JSON_BUDGET' });
} finally { JSON.parse = parse; }
assert.equal(parsed, 0, 'aggregate byte rejection occurs before parsing/cloning the captured value');
assert.deepEqual(enumerate(tiny), []); assert.equal(tiny.capturedDomainComplete, true);
console.log('adjacency bootstrap and delta own one bounded passive input before cancellation and replay effects');
