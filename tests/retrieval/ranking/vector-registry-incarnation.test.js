import assert from 'node:assert/strict';
import { createLiveVectorRegistry, resolveVectorPlacement, nextVectorIncarnation, verifyVectorLayoutRewrite,
  eligibleRegistryRows } from '../../../src/retrieval/vector-generation/live-registry.js';
import { openRegistryFilteredVectorSession } from '../../../src/retrieval/sessions/registry-filtered.js';

const descriptor = { repositoryId: 'repo', generationId: 'g1', storageEpoch: 'storage1', rowMapId: 'map1',
  representationId: 'q1', modelId: 'model1', codecEpoch: 'codec1', originalVectorRoot: 'a'.repeat(64),
  dimension: 1, metric: 'dot', normalization: 'none' };
const rows = [0, 1, 2].map(rowId => ({ logicalId: 'logical' + rowId, sourceSupports: ['source' + rowId],
  tokenSpanId: 'token' + rowId, vectorRoot: String(rowId).repeat(64), state: rowId === 2 ? 'tombstone' : 'live',
  rowId, slot: rowId + 10, incarnation: '7' }));
const registry = createLiveVectorRegistry({ descriptor, rows });
const placement = (row, desc = descriptor) => ({ generationId: desc.generationId, storageEpoch: desc.storageEpoch,
  slot: row.slot, incarnation: row.incarnation, codecEpoch: desc.codecEpoch });
assert.equal(resolveVectorPlacement(registry, placement(rows[0])).logicalId, 'logical0');
assert.equal(resolveVectorPlacement(registry, { ...placement(rows[0]), incarnation: '6' }).reason, 'stale-slot-incarnation');
assert.equal(resolveVectorPlacement(registry, { ...placement(rows[0]), storageEpoch: 'other' }).reason, 'stale-generation-or-codec');
assert.equal(resolveVectorPlacement(registry, placement(rows[2])).reason, 'logically-deleted');
assert.equal(resolveVectorPlacement(registry, { slot: 10 }).reason, 'unqualified-placement');
assert.deepEqual(nextVectorIncarnation('18446744073709551614'), { status: 'increment', next: '18446744073709551615' });
assert.deepEqual(nextVectorIncarnation('18446744073709551615'), { status: 'retire-slot', next: null });
assert.throws(() => nextVectorIncarnation('18446744073709551616'), /incarnation/);
assert.throws(() => createLiveVectorRegistry({ descriptor, rows: [rows[0], { ...rows[1], slot: rows[0].slot }] }), /aliased/);
assert.throws(() => eligibleRegistryRows(registry, new Set(['logical2'])), /deleted/);

const newDescriptor = { ...descriptor, generationId: 'g2', storageEpoch: 'storage2', rowMapId: 'map2' };
const permuted = rows.map(row => ({ ...row, slot: 12 - row.rowId, rowId: 2 - row.rowId }));
const rewritten = createLiveVectorRegistry({ descriptor: newDescriptor, rows: permuted });
const beforeEdges = [{ from: placement(rows[0]), to: placement(rows[1]) }];
const afterEdges = [{ from: placement(permuted[0], newDescriptor), to: placement(permuted[1], newDescriptor) }];
assert.equal(verifyVectorLayoutRewrite({ before: registry, after: rewritten, beforeEdges, afterEdges }).status,
  'same-logical-content-and-directed-edge-bag');
assert.equal(verifyVectorLayoutRewrite({ before: registry, after: rewritten, beforeEdges, afterEdges: [] }).reason, 'topology-changed');
assert.equal(verifyVectorLayoutRewrite({ before: registry, after: registry, beforeEdges, afterEdges: beforeEdges }).reason, 'isolated-new-generation-required');
assert.throws(() => verifyVectorLayoutRewrite({ before: registry, after: rewritten, beforeEdges,
  afterEdges: [{ from: placement(rows[0]), to: placement(rows[1]) }] }), /stale/);
assert.equal(resolveVectorPlacement(registry, placement(rows[0])).status, 'live', 'old pinned metadata remains usable');
assert.equal(resolveVectorPlacement(rewritten, placement(rows[0])).status, 'rejected');

const target = { scoreTarget: 'stored-dot-scalar-v1', eligibility: 'complete-confirmed', repositoryId: 'repo', generationId: 'g1',
  rowMapId: 'map1', representationId: 'q1', queryId: 'query', eligibleDomainId: 'eligible' };
const idx = { denseVec: { dims: 1, minVal: 0, maxVal: 255, scale: 1, levels: 256, vectors: [[1], [200], [255]] } };
let releases = 0;
const snapshotLease = { assertActive: expected => assert.deepEqual(expected, target), release: () => releases++ };
const session = openRegistryFilteredVectorSession({ registry, eligibleIds: new Set(['logical0', 'logical1']),
  target, idx, embedding: [1], snapshotLease, probe: async () => ({ actualWork: 1,
    placements: [placement(rows[0]), { ...placement(rows[1]), incarnation: '6' }, placement(rows[2])] }) });
const result = await session.advance({ workBudget: 10 });
assert.equal(result.state, 'exhausted');
assert.deepEqual(result.hits.map(hit => hit.id), ['logical1', 'logical0']);
assert.deepEqual(session.placementRejections(), { stale: 1, deleted: 1, malformed: 0 });
session.close(); assert.equal(releases, 1);
rows[0].sourceSupports.push('caller-mutation');
assert.equal(resolveVectorPlacement(registry, placement(rows[0])).logicalId, 'logical0');
console.log('vector registry incarnation contract passed');
