import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { admitExactPointLineage, mapExactLineagePoint } from '../../../src/index/semantic/lineage/exact-points.js';
import { inspectSuppliedObservationLineage } from '../../../src/semantic/supplied-lineage.js';

const world = { generation: { baseBuildId: 'build', semanticRevision: 0 }, contextKey: 'compiler-flags-A' };
const artifacts = ['source', 'generated', 'bundle', 'other-source'].map(id => ({ id,
  bytes: Buffer.from('a\r\n😀xyz'), coordinateProfile: 'utf16-offset-v1', buildId: 'build-A' }));
const point = (artifactId, offset = 5) => ({ artifactId,
  byteHash: createHash('sha256').update(artifacts.find(row => row.id === artifactId).bytes).digest('hex'),
  coordinateProfile: 'utf16-offset-v1', offset });
const atom = (id, from, to, kind = 'retained-anchor', inlineContext = []) => ({ id, from, to, kind, inlineContext, provenanceRef: 'supplied:' + id });
const transform = (id, inputArtifacts, outputArtifacts, atoms) => ({ id, world,
  producerProfile: 'normalized-exact-points-v1', orderedTransformId: 'pass:' + id,
  inputArtifacts, outputArtifacts, atoms, coverage: 'partial' });
const transformations = [
  transform('compile', ['source', 'other-source'], ['generated'], [
    atom('source-origin', point('generated'), point('source'), 'declared-operation', ['inline-A']),
    atom('alternative', point('generated'), point('other-source'), 'heuristic-attribution', ['inline-B'])]),
  transform('bundle', ['generated'], ['bundle'], [atom('bundle-origin', point('bundle'), point('generated'))])
];
const admitted = admitExactPointLineage({ world, artifacts, transformations });
const query = { point: point('bundle'), targetArtifacts: ['source', 'other-source'] };
const result = mapExactLineagePoint(admitted, query);
// Independent hand-enumerated relation: bundle:5 -> generated:5 -> {source:5, other-source:5}.
assert.deepEqual(result.endpoints.map(id => result.nodes[id].point.artifactId), ['source', 'other-source']);
assert.equal(result.nodes.length, 4);
assert.equal(result.edges.length, 3);
assert.equal(result.ambiguity, 'multiple-endpoints');
assert.deepEqual(result.edges.find(edge => edge.atomId === 'alternative').inlineContext, ['inline-B']);
assert.equal(result.operationEquivalence, 'not-established');
const observed = inspectSuppliedObservationLineage({ lineage: admitted, observationId: 'sample:1', mass: 7, ...query });
assert.equal(observed.mass, 7);
assert.equal(observed.allocatedMass, 0);
assert.equal(observed.unallocatedMass, 7);
assert.equal(mapExactLineagePoint(admitted, { ...query, point: point('bundle', 6) }).residuals[0].reason, 'no-exact-anchor');
assert.equal(mapExactLineagePoint(admitted, { ...query, maxWork: 1 }).status, 'partial');
assert.equal(mapExactLineagePoint(admitted, { ...query, maxNodes: 1 }).residuals[0].reason, 'node-budget');
const controller = new AbortController(); controller.abort();
assert.equal(mapExactLineagePoint(admitted, { ...query, signal: controller.signal }).residuals[0].reason, 'cancelled');
const reversed = mapExactLineagePoint(admitted, { point: point('source'), targetArtifacts: ['bundle'], direction: 'reverse' });
assert.equal(reversed.nodes[reversed.endpoints[0]].point.artifactId, 'bundle');
const fork = [...transformations, transform('fork', ['generated'], ['bundle'], [
  atom('second-path', point('bundle'), point('generated'), 'retained-anchor', ['inline-C'])])];
const forked = mapExactLineagePoint(admitExactPointLineage({ world, artifacts, transformations: fork }), query);
assert.equal(forked.residuals.some(row => row.reason === 'mapping-cycle'), false);
assert.equal(forked.edges.filter(row => row.to === 1).length, 2);
const cycle = [...transformations, transform('cycle', ['bundle'], ['generated'], [
  atom('cycle-edge', point('generated'), point('bundle'))])];
assert.equal(mapExactLineagePoint(admitExactPointLineage({ world, artifacts, transformations: cycle }), query)
  .residuals.some(row => row.reason === 'mapping-cycle'), true);
const unmapped = [transform('unmapped', ['source'], ['bundle'], [atom('gap', point('bundle'), null, 'explicit-unmapped')])];
assert.equal(mapExactLineagePoint(admitExactPointLineage({ world, artifacts, transformations: unmapped }), query)
  .residuals[0].reason, 'explicit-unmapped');
assert.throws(() => mapExactLineagePoint(admitted, { ...query, point: point('bundle', 4) }), /pinned point/);
const stale = structuredClone(transformations); stale[0].atoms[0].to.byteHash = '0'.repeat(64);
assert.throws(() => admitExactPointLineage({ world, artifacts, transformations: stale }), /mapping atom/);
assert.throws(() => admitExactPointLineage({ world: { ...world, contextKey: 'compiler-flags-B' }, artifacts, transformations }), /receipt/);
assert.throws(() => admitExactPointLineage({ world, artifacts, transformations, maxBytes: 1 }), /allowance/);
let getterCalled = false;
const getter = { ...transformations[0], get producerProfile() { getterCalled = true; return 'bad'; } };
assert.throws(() => admitExactPointLineage({ world, artifacts, transformations: [getter] }), /accessor/);
assert.equal(getterCalled, false);
artifacts[0].bytes.fill(0);
assert.equal(mapExactLineagePoint(admitted, query).endpoints.length, 2);
assert.throws(() => { result.edges[0].kind = 'declared-operation'; }, TypeError);
console.log('supplied exact-point lineage contract passed');
