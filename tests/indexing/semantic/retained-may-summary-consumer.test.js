import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { createAnalysisPartitionId, canonicalSemanticJson } from '../../../src/index/semantic/identity.js';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';
import { finiteMayPayloadIdentity, finiteMaySystemIdentity } from '../../../src/index/semantic/capsules/finite-may-check.js';
import { projectRetainedMaySummarySystem, readCheckedRetainedMaySummary, materializeCheckedRetainedMaySummaryLens } from '../../../src/semantic/retained-may-summary.js';

// Authored only: canonical writer/index/store -> authoritative relation -> independent capsule checker.
const f = await createRecoveryFixture('a b c 😀');
try {
  const expression = (id, span) => ({ ...semanticNode(id, f.source.textLength), row: { ...semanticNode(id, f.source.textLength).row, span } });
  const syntax = await f.write([expression(0, [0, 1]), expression(1, [2, 3]), expression(2, [4, 5]), expression(3, [6, 8]), expression(4, null)]);
  const ref = localId => ({ partitionId: syntax.partitionId, localId }), key = canonicalSemanticJson;
  const contextKey = 'retained-flow-fixture';
  const partitionId = createAnalysisPartitionId({ pass: { name: 'fixture-may-relation', version: '1' },
    inputPartitionHashes: [syntax.canonicalHash], compilerContext: contextKey, dependencySummaryHashes: [], analysisPolicy: {} });
  const edge = (id, from, to, kind, certainty, context = contextKey, condition = null) => ({ family: 'edge', row: {
    id, kind, from: ref(from), to: ref(to), callSite: null, operandOrdinal: null, contextKey: context, condition, evidence: null, certainty } });
  const analysis = await f.write([edge(0, 0, 1, 'flowsTo', 'modeled', contextKey, ref(0)),
    edge(1, 1, 2, 'copies', 'exact-static'), edge(2, 2, 1, 'flowsTo', 'heuristic'),
    edge(3, 2, 3, 'flowsTo', 'modeled', 'other-context'), edge(4, 3, 0, 'callTarget', 'exact-static')],
  { partitionId, contextHash: 'c'.repeat(64) });
  const partitions = [syntax, analysis];
  const queryIndex = await writeSemanticQueryIndex({ root: f.stagingRoot, generation: f.generation,
    partitions, store: f.store(partitions), diskAccount: f.account });
  const store = f.store(partitions, { queryIndex });
  const world = { generation: f.generation, repositoryNamespace: f.root, contextKey };
  const args = { store, world, nodes: [ref(0), ref(1), ref(2)], seeds: [ref(0), ref(2)], kinds: ['flowsTo', 'copies'] };
  const projection = await projectRetainedMaySummarySystem(args);
  assert.equal(projection.evidence.length, 3);
  assert.equal(projection.otherContextEdges, 1);
  assert.equal(projection.boundaryEdges, 0);
  assert.equal(projection.sourceReadBytes, f.bytes.length, 'one selected partition reuses its one checked source capture');
  assert.equal(projection.truncated, false);
  assert.deepEqual(projection.inputCertainties, { 'exact-static': 1, modeled: 1, heuristic: 1 });
  assert.ok(projection.evidence.some(entry => entry.edge.condition !== null));
  const capsuleFor = (view, states) => ({ schemaVersion: 1, profile: view.system.profile,
    checker: 'finite-may-postfixpoint-v1', systemId: finiteMaySystemIdentity(view.system), payloadId: finiteMayPayloadIdentity(states), states });
  const states = projection.system.nodes.map(node => ({ node,
    facts: node === key(ref(0)) ? [key(ref(0))] : [...projection.system.universe] }));
  const capsule = capsuleFor(projection, states);
  const answer = readCheckedRetainedMaySummary({ projection, capsule, node: ref(2) });
  assert.equal(answer.check.status, 'checked-in-model');
  assert.deepEqual(new Set(answer.seedRefs.map(key)), new Set([key(ref(0)), key(ref(2))]));
  assert.equal(answer.producerCertainty, 'not-upgraded');
  assert.equal(answer.pathFeasibility, 'not-implied');
  const projectedLens = materializeCheckedRetainedMaySummaryLens({ projection, capsule, node: ref(2), taskId: 'inspect-upper-model' });
  assert.equal(projectedLens.status, 'projected');
  assert.equal(projectedLens.lens.totalCandidates, 2, 'one seed/query record keeps both roles without independent duplicate corroboration');
  assert.deepEqual(new Set(projectedLens.lens.facets.map(facet => facet.text)), new Set(['a', 'c']));
  assert.ok(projectedLens.lens.facets.every(facet => facet.qualification.candidateMembership === 'in-checked-upper-model-not-proven-reachable'
    && facet.qualification.pathFeasibility === 'not-implied' && facet.editAuthority === 'not-granted'));
  assert.equal(projectedLens.lens.renderedBytes, Buffer.byteLength(JSON.stringify(projectedLens.lens) + '\n'));
  const overflow = materializeCheckedRetainedMaySummaryLens({ projection, capsule, node: ref(2), taskId: 'bounded', maxFacets: 1 });
  assert.equal(overflow.status, 'mandatoryOverflow'); assert.equal(overflow.lens.facets.length, 0);
  const mutableCapsule = structuredClone(capsule), mutableNode = ref(2);
  let signalReads = 0;
  const mutatingSignal = { get aborted() {
    if (++signalReads === 2) {
      mutableCapsule.states.find(state => state.node === key(ref(2))).facts = [];
      mutableNode.localId = 99;
    }
    return false;
  } };
  const pinnedState = readCheckedRetainedMaySummary({ projection, capsule: mutableCapsule, node: mutableNode, signal: mutatingSignal });
  assert.equal(pinnedState.check.status, 'checked-in-model');
  assert.ok(signalReads >= 2);
  assert.deepEqual(mutableCapsule.states.find(state => state.node === key(ref(2))).facts, []);
  assert.deepEqual(pinnedState.node, ref(2));
  assert.deepEqual(new Set(pinnedState.seedRefs.map(key)), new Set([key(ref(0)), key(ref(2))]),
    'accepted facts come from the exact copied certificate checked before signal callbacks can mutate caller state');
  const top = capsuleFor(projection, projection.system.nodes.map(node => ({ node, facts: [...projection.system.universe] })));
  assert.equal(readCheckedRetainedMaySummary({ projection, capsule: top, node: ref(0) }).seedRefs.length, 2,
    'a checked upper invariant can retain an imprecise seed at a node it cannot reach in the least relation closure');
  const imprecise = materializeCheckedRetainedMaySummaryLens({ projection, capsule: top, node: ref(0), taskId: 'inspect-imprecision' });
  assert.ok(imprecise.lens.facets.find(facet => facet.text === 'c').qualification.candidateMembership.includes('not-proven-reachable'),
    'presentation cannot turn a top invariant member into a concrete reachability witness');
  const badStates = structuredClone(states); badStates.find(state => state.node === key(ref(1))).facts = [key(ref(2))];
  const bad = readCheckedRetainedMaySummary({ projection, capsule: capsuleFor(projection, badStates), node: ref(2) });
  assert.equal(bad.check.status, 'rejected'); assert.equal(bad.seedRefs, null);
  assert.equal(bad.check.failures.length, 1);
  const rejectedLens = materializeCheckedRetainedMaySummaryLens({ projection, capsule: capsuleFor(projection, badStates), node: ref(2), taskId: 'rejected' });
  assert.equal(rejectedLens.status, 'checkerUnaccepted');
  assert.ok(rejectedLens.lens.facets.every(facet => facet.roles.length === 1 && facet.roles[0] === 'summaryQuery'));
  assert.throws(() => readCheckedRetainedMaySummary({ projection: { ...projection }, capsule, node: ref(2) }), /owned projection/);
  const boundary = await projectRetainedMaySummarySystem({ ...args, nodes: [ref(0), ref(1)], seeds: [ref(0)] });
  assert.equal(boundary.boundaryEdges, 1);
  const boundaryCapsule = capsuleFor(boundary, boundary.system.nodes.map(node => ({ node, facts: [...boundary.system.universe] })));
  assert.equal(readCheckedRetainedMaySummary({ projection: boundary, capsule: boundaryCapsule, node: ref(1) }).seedRefs, null,
    'omitted boundary targets cannot become checked negative or global reachability evidence');
  const prefix = await projectRetainedMaySummarySystem({ ...args, maxIncidentRows: 1 });
  assert.equal(prefix.truncated, true);
  const prefixCapsule = capsuleFor(prefix, prefix.system.nodes.map(node => ({ node, facts: [...prefix.system.universe] })));
  assert.equal(readCheckedRetainedMaySummary({ projection: prefix, capsule: prefixCapsule, node: ref(2) }).check.status, 'unknown');
  assert.equal(readCheckedRetainedMaySummary({ projection, capsule, node: ref(2), maxObligations: 0 }).seedRefs, null);
  assert.equal(readCheckedRetainedMaySummary({ projection, capsule, node: ref(2), maxBytes: 1 }).seedRefs, null);
  const unavailable = await projectRetainedMaySummarySystem({ ...args, nodes: [ref(4)], seeds: [ref(4)] });
  const unavailableCapsule = capsuleFor(unavailable, unavailable.system.nodes.map(node => ({ node, facts: [...unavailable.system.universe] })));
  const unavailableLens = materializeCheckedRetainedMaySummaryLens({ projection: unavailable, capsule: unavailableCapsule, node: ref(4), taskId: 'no-source-span' });
  assert.equal(unavailableLens.answer.check.status, 'checked-in-model');
  assert.equal(unavailableLens.status, 'sourceUnavailable'); assert.equal(unavailableLens.lens, null);
  assert.equal(unavailableLens.sourceFrontier[0].reason, 'retained-source-span-unavailable', 'derived nodes cannot invent a whole-file source fallback');
  const changed = await projectRetainedMaySummarySystem({ ...args, world: { ...world, contextKey: 'other-context' } });
  assert.equal(readCheckedRetainedMaySummary({ projection: changed, capsule, node: ref(2) }).check.status, 'stale-identity');
  const wrongSpanStore = { ...store, async getRecords(...request) {
    const records = await store.getRecords(...request);
    return records.map(record => ({ ...record, span: [7, 8] }));
  } };
  await assert.rejects(projectRetainedMaySummarySystem({ ...args, store: wrongSpanStore, nodes: [ref(3)], seeds: [ref(3)] }), /coordinates/);
  const controller = new AbortController(); controller.abort();
  assert.equal(readCheckedRetainedMaySummary({ projection, capsule, node: ref(2), signal: controller.signal }).seedRefs, null);
  await assert.rejects(projectRetainedMaySummarySystem({ ...args, signal: controller.signal }), { name: 'AbortError' });
  assert.throws(() => materializeCheckedRetainedMaySummaryLens({ projection, capsule, node: ref(2), taskId: 'cancelled', signal: controller.signal }), { name: 'AbortError' });
  await fs.writeFile(f.original, 'changed worktree');
  assert.deepEqual(new Set(materializeCheckedRetainedMaySummaryLens({ projection, capsule, node: ref(2), taskId: 'retained-source' }).lens.facets.map(facet => facet.text)),
    new Set(['a', 'c']), 'the owned projection reuses its original checked source capture');
  assert.equal((await projectRetainedMaySummarySystem(args)).projectionId, projection.projectionId);
  await fs.writeFile(path.join(f.stagingRoot, 'semantic-sources', f.source.byteHash + '.utf8'), Buffer.from('z'.repeat(f.bytes.length)));
  await assert.rejects(projectRetainedMaySummarySystem(args), { code: 'ERR_FILE_INTEGRITY' });
} finally { await f.cleanup(); }
console.log('retained canonical relation and independently checked upper-summary consumer controls passed');
