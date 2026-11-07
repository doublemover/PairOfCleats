import assert from 'node:assert/strict';
import { bootstrapAdjacencyView, applyAdjacencyDelta, readAdjacencyViewInput } from '../../../src/index/semantic/views/adjacency-delta.js';
import { bootstrapViewComposition, applyViewCompositionDelta, describeViewComposition, viewCompositionOutput,
  invalidateViewComposition, checkpointViewComposition, viewCompositionInput, viewCompositionWork, VIEW_COMPOSITION_PROFILE } from '../../../src/index/semantic/views/composition.js';
import { bootstrapSelectedAdjacency, applySelectedAdjacencyTransition, describeSelectedAdjacency } from '../../../src/index/semantic/views/selected-adjacency.js';
import { getOfflineEvaluationAdapter } from '../../../tools/eval/adapters.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/semantic/view-composition/')[1];
assert.ok(['registered-closed-dag', 'select-join-group-chain', 'shared-source-self-join', 'unchanged-role-followup',
  'replay-and-passive-capture', 'atomic-downstream-refusal', 'incomplete-negative-domain', 'independent-invalidation',
  'prepared-receipt-authority', 'independent-flat-oracle', 'coefficient-without-expansion', 'checkpoint-rebuild-parity'].includes(mode));
const world = { generation: { baseBuildId: 'composition-fixture', semanticRevision: 0 }, repositoryNamespace: 'composed-fixture', contextKey: 'context' };
const sourceDefinition = id => ({ viewId: id, producerId: 'fixture', producerEpoch: '1', ruleVersion: '1', configHash: 'a'.repeat(64), domainId: id, algebra: 'signed-occurrence-bag-v1' });
const row = (id, from = 'a', to = 'k', multiplicity = '1') => ({ occurrenceId: 'occurrence:' + id, supportId: id, from, to, multiplicity, sourceRef: 'source:' + id });
const select = (id, input, inputDomainId, domainId, whereEquals = null) => ({ id, kind: 'select', input, definition: {
  schemaVersion: 1, id, operator: 'select-project-adjacency', ruleVersion: '1', configHash: 'b'.repeat(64), domainId, inputDomainId,
  whereField: whereEquals === null ? null : 'to', whereEquals, projectFrom: 'from', projectTo: 'to' } });
const definition = () => ({ schemaVersion: 1, id: 'pipeline', ruleVersion: '1', configHash: 'c'.repeat(64),
  inputs: ['left', 'right', 'other'].map(id => ({ id, domainId: id })), stages: [select('selected', 'left', 'left', 'selected-domain'),
    { id: 'joined', kind: 'join', left: 'selected', right: 'right', definition: { schemaVersion: 1, id: 'joined', operator: 'inner-join',
      ruleVersion: '1', configHash: 'd'.repeat(64), domainId: 'joined-domain', leftDomainId: 'selected-domain', rightDomainId: 'right' } },
    { id: 'grouped', kind: 'group', input: 'joined', definition: { schemaVersion: 1, id: 'grouped', operator: 'grouped-adjacency', ruleVersion: '1',
      configHash: 'e'.repeat(64), domainId: 'grouped-domain', inputDomainId: 'joined-domain', groupBy: 'from' }, projectFrom: 'key', projectTo: 'weightedCount' },
    select('filtered', 'grouped', 'grouped-domain', 'filtered-domain', '6'), select('independent', 'other', 'other', 'other-domain')],
  outputs: ['joined', 'grouped', 'filtered', 'independent'] });
const bootstrap = ({ left = [row('l', 'a', 'k', '2')], right = [row('r', 'k', 'z', '3')], other = [row('o', 'independent', 'value')],
  rightComplete = true, limits, model = definition() } = {}) => {
  const originals = new Map(['left', 'right', 'other'].map(id => [id, bootstrapAdjacencyView({ definition: sourceDefinition(id), world,
    rows: { left, right, other }[id], complete: id !== 'right' || rightComplete })]));
  const view = bootstrapViewComposition({ definition: model, inputs: [...originals].map(([id, view]) => ({ id, view })), ...(limits ? { limits } : {}) });
  return { view, originals, model };
};
const inputBatch = (view, id, name, edits, complete = true) => ({ batchId: name + ':' + id, definition: sourceDefinition(id), fromWorld: world, toWorld: world,
  baseRoot: describeViewComposition(view).inputRoots.find(input => input.id === id).rootId, edits, capturedDomainComplete: complete });
const batch = (view, name, changes) => ({ batchId: name, expectedRootId: view.rootId,
  inputs: Object.entries(changes).map(([id, edits]) => ({ id, batch: inputBatch(view, id, name, edits) })) });
const rows = (view, output) => readAdjacencyViewInput(viewCompositionOutput(view, output)).rows;
const aggregate = items => {
  const counts = new Map();
  for (const row of items) { const key = JSON.stringify([row.from, row.to]); counts.set(key, (counts.get(key) || 0n) + BigInt(row.multiplicity)); }
  return [...counts].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, count]) => [key, count.toString()]);
};
const flat = (left, right) => {
  const expanded = [];
  for (const a of left) for (let i = 0; i < Number(a.multiplicity); i++) for (const b of right)
    for (let j = 0; j < Number(b.multiplicity); j++) if (a.to === b.from) expanded.push({ from: a.from, to: b.to, multiplicity: '1' });
  return aggregate(expanded);
};

if (mode === 'registered-closed-dag') {
  const adapter = await getOfflineEvaluationAdapter(VIEW_COMPOSITION_PROFILE); assert.ok(adapter.capabilities.includes('invalidate'));
  const { originals } = bootstrap();
  for (const change of [model => { model.stages[0].input = 'grouped'; }, model => { model.stages[0].definition.inputDomainId = 'wrong'; },
    model => { model.stages[1].id = 'left'; }, model => { model.outputs = ['left']; }, model => { model.extra = true; }]) {
    const model = definition(); change(model);
    assert.throws(() => bootstrapViewComposition({ definition: model, inputs: [...originals].map(([id, view]) => ({ id, view })) }));
  }
  const aliasModel = definition(); aliasModel.inputs[1].domainId = 'left'; aliasModel.stages[1].definition.rightDomainId = 'left';
  assert.throws(() => bootstrapViewComposition({ definition: aliasModel,
    inputs: [...originals].map(([id, view]) => ({ id, view: id === 'right' ? originals.get('left') : view })) }));
  assert.throws(() => viewCompositionOutput({ ...bootstrap().view }, 'joined'));
} else if (mode === 'select-join-group-chain') {
  const { view } = bootstrap(); assert.equal(rows(view, 'joined')[0].multiplicity, '6');
  assert.deepEqual(rows(view, 'grouped').map(row => [row.from, row.to, row.multiplicity]), [['a', '6', '1']]);
  assert.equal(rows(view, 'filtered').length, 1); assert.ok(rows(view, 'joined').every(row => row.sourceRef === null));
  const next = applyViewCompositionDelta(view, batch(view, 'remove-one', { left: [row('l', 'a', 'k', '-1')] }));
  assert.equal(next.consumed, true); assert.equal(rows(next.view, 'joined')[0].multiplicity, '3');
  assert.equal(rows(next.view, 'grouped')[0].to, '3'); assert.equal(rows(next.view, 'filtered').length, 0);
  assert.equal(rows(view, 'filtered').length, 1, 'original reader retains its complete old cohort');
} else if (mode === 'shared-source-self-join') {
  const model = definition(); model.stages[0].definition.projectTo = 'from';
  model.stages[1].right = 'selected'; model.stages[1].definition.rightDomainId = 'selected-domain';
  const { view } = bootstrap({ model }); assert.equal(rows(view, 'joined')[0].multiplicity, '4');
  const next = applyViewCompositionDelta(view, batch(view, 'two-to-three', { left: [row('l', 'a', 'k', '1')] }));
  assert.equal(rows(next.view, 'joined')[0].multiplicity, '9');
  assert.equal(BigInt(rows(next.view, 'joined')[0].multiplicity) - BigInt(rows(view, 'joined')[0].multiplicity), 5n);
  assert.equal(rows(next.view, 'joined').length, 1, 'one shared source is advanced once and observed in both atom roles');
} else if (mode === 'unchanged-role-followup') {
  let { view } = bootstrap(); const originalOther = viewCompositionOutput(view, 'independent');
  for (let index = 0; index < 4; index++) {
    const next = applyViewCompositionDelta(view, batch(view, 'left-' + index, { left: [row('extra-' + index)] }));
    assert.equal(next.consumed, true); view = next.view;
    assert.equal(viewCompositionOutput(view, 'independent'), originalOther);
  }
  assert.equal(aggregate(rows(view, 'joined'))[0][1], '18');
  assert.equal(viewCompositionWork(view).stages.find(stage => stage.id === 'independent').strategy, 'reused-original-inputs');
} else if (mode === 'replay-and-passive-capture') {
  const base = bootstrap(), change = batch(base.view, 'once', { left: [row('extra')] }), next = applyViewCompositionDelta(base.view, change);
  assert.equal(applyViewCompositionDelta(next.view, change).status, 'replayed');
  const changed = structuredClone(change); changed.inputs[0].batch.edits = []; assert.throws(() => applyViewCompositionDelta(next.view, changed));
  assert.throws(() => applyViewCompositionDelta(next.view, { ...change, batchId: 'new-outer-id', expectedRootId: next.view.rootId }));
  let getters = 0; const accessor = Object.defineProperty({}, 'batchId', { enumerable: true, get() { getters++; return 'bad'; } });
  assert.throws(() => applyViewCompositionDelta(base.view, accessor)); assert.equal(getters, 0);
  const snapshot = describeViewComposition(next.view); snapshot.stages.length = 0;
  assert.equal(describeViewComposition(next.view).stages.length, 5);
} else if (mode === 'atomic-downstream-refusal') {
  const { view } = bootstrap({ left: [], right: [], limits: { work: 64 } });
  const change = batch(view, 'too-much-work', { left: Array.from({ length: 100 }, (_, index) => row('r' + index)) });
  const before = describeViewComposition(view), result = applyViewCompositionDelta(view, change);
  assert.equal(result.status, 'work-budget'); assert.equal(result.consumed, false); assert.equal(result.view, view);
  assert.deepEqual(describeViewComposition(view), before);
  const normal = bootstrap({ left: [], right: [] }).view;
  const larger = applyViewCompositionDelta(normal, batch(normal, 'too-many-source-supports', { left: Array.from({ length: 257 }, (_, index) => row('r' + index)) }));
  assert.equal(larger.status, 'retention-budget'); assert.equal(larger.view, normal); assert.equal(rows(normal, 'joined').length, 0);
  const mixed = batch(normal, 'mixed-worlds', { left: [] }); mixed.inputs[0].batch.toWorld = { ...world, contextKey: 'other-world' };
  assert.throws(() => applyViewCompositionDelta(normal, mixed)); assert.equal(rows(normal, 'joined').length, 0);
  const controller = new AbortController(); controller.abort();
  assert.equal(applyViewCompositionDelta(normal, batch(normal, 'cancelled', {}), { signal: controller.signal }).status, 'cancelled');
} else if (mode === 'incomplete-negative-domain') {
  const model = definition(); model.stages[1].definition.operator = 'left-anti-join';
  const { view } = bootstrap({ right: [], rightComplete: false, model });
  assert.equal(rows(view, 'joined').length, 0); assert.equal(viewCompositionOutput(view, 'joined').capturedDomainComplete, false);
  const next = applyViewCompositionDelta(view, batch(view, 'complete-right', { right: [] }));
  assert.equal(next.consumed, true); assert.equal(rows(next.view, 'joined').length, 1);
  assert.equal(viewCompositionOutput(next.view, 'grouped').capturedDomainComplete, true);
} else if (mode === 'independent-invalidation') {
  const { view } = bootstrap(), event = { invalidationId: 'scope-binding-changed', expectedRootId: view.rootId, targets: ['selected'], reason: 'Original semantic observation invalidated.' };
  const invalid = invalidateViewComposition(view, event).view;
  assert.throws(() => viewCompositionOutput(invalid, 'joined')); assert.equal(rows(view, 'joined')[0].multiplicity, '6');
  assert.equal(rows(invalid, 'independent').length, 1);
  assert.equal(checkpointViewComposition(invalid).status, 'rebootstrap-required');
  assert.equal(invalidateViewComposition(invalid, event).status, 'replayed');
  assert.throws(() => invalidateViewComposition(invalid, { ...event, reason: 'changed replay' }));
  const independent = applyViewCompositionDelta(invalid, batch(invalid, 'other-only', { other: [row('o2', 'independent', 'new')] }));
  assert.equal(independent.consumed, true); assert.equal(rows(independent.view, 'independent').length, 2);
  assert.throws(() => viewCompositionOutput(independent.view, 'joined'));
  assert.equal(applyViewCompositionDelta(invalid, batch(invalid, 'blocked', { left: [] })).status, 'rebootstrap-required');
} else if (mode === 'prepared-receipt-authority') {
  const input = bootstrapAdjacencyView({ definition: sourceDefinition('left'), world, rows: [], complete: true });
  const selected = definition().stages[0].definition, operator = bootstrapSelectedAdjacency({ definition: selected, input });
  const raw = { batchId: 'source', definition: sourceDefinition('left'), fromWorld: world, toWorld: world, baseRoot: input.rootId,
      edits: [row('l')], capturedDomainComplete: true }, next = applyAdjacencyDelta(input, raw);
  const request = { batchId: 'operator', expectedRootId: operator.rootId, input: raw };
  assert.throws(() => applySelectedAdjacencyTransition(operator, request, { ...next }));
  next.view = { rootId: 'forged' }; next.supportChanges = [];
  const result = applySelectedAdjacencyTransition(operator, request, next);
  assert.equal(result.consumed, true); assert.equal(describeSelectedAdjacency(result.view).rows.length, 1);
  assert.throws(() => applySelectedAdjacencyTransition(operator, { ...request, input: { ...raw, edits: [] } }, next));
} else if (mode === 'independent-flat-oracle') {
  let left = [], right = [], view = bootstrap({ left, right }).view;
  for (let revision = 0; revision < 12; revision++) {
    const leftAdd = row('l' + revision, 'd' + (revision % 3), 'k' + (revision % 2), String(1 + revision % 3));
    const rightAdd = row('r' + revision, 'k' + (revision % 2), 'v' + (revision % 4), String(1 + revision % 2));
    left = [...left, leftAdd]; right = [...right, rightAdd];
    const next = applyViewCompositionDelta(view, batch(view, 'revision-' + revision, { left: [leftAdd], right: [rightAdd] }));
    assert.equal(next.consumed, true); view = next.view;
    assert.deepEqual(aggregate(rows(view, 'joined')), flat(left, right));
    const clean = bootstrap({ left, right }).view;
    for (const id of ['joined', 'grouped', 'filtered']) {
      assert.deepEqual(aggregate(rows(view, id)), aggregate(rows(clean, id)));
      assert.equal(viewCompositionOutput(view, id).relation.rootId, viewCompositionOutput(clean, id).relation.rootId);
    }
  }
} else if (mode === 'checkpoint-rebuild-parity') {
  let { view } = bootstrap({ limits: { revisions: 2 } });
  const originalInput = viewCompositionInput(view, 'left');
  view = applyViewCompositionDelta(view, batch(view, 'one', {})).view;
  view = applyViewCompositionDelta(view, batch(view, 'two', {})).view;
  assert.equal(applyViewCompositionDelta(view, batch(view, 'three', {})).status, 'checkpoint-required');
  const checkpoint = checkpointViewComposition(view); assert.equal(checkpoint.consumed, true);
  assert.equal(viewCompositionInput(checkpoint.view, 'left'), originalInput, 'checkpoint keeps original source support-history ownership');
  for (const id of definition().outputs) assert.equal(viewCompositionOutput(view, id).relation.rootId, viewCompositionOutput(checkpoint.view, id).relation.rootId);
  assert.equal(applyViewCompositionDelta(checkpoint.view, batch(checkpoint.view, 'three', {})).consumed, true);
} else {
  const coefficient = '1' + '0'.repeat(40), { view } = bootstrap({ left: [row('l', 'a', 'k', coefficient)], right: [row('r', 'k', 'z', coefficient)] });
  assert.equal(rows(view, 'joined').length, 1); assert.equal(rows(view, 'joined')[0].multiplicity, (BigInt(coefficient) ** 2n).toString());
  assert.equal(rows(view, 'grouped').length, 1); assert.equal(rows(view, 'grouped')[0].to, (BigInt(coefficient) ** 2n).toString());
  assert.equal(viewCompositionOutput(view, 'grouped').relation.cardinality, '1');
}
console.log('Finite view composition ' + mode + ' passed');
