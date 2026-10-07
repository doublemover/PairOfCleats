#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { buildGraphContextPack } from '../../src/graph/context-pack.js';
import { buildImpactAnalysis } from '../../src/graph/impact.js';
import { graphRelationsFromEdges } from './helpers/graph-fixtures.js';

// Count only predecessor records, not every graph Map operation. This synchronous
// fixture needs no production instrumentation and restores the prototype on errors.
const observeParents = (options) => {
  const original = Map.prototype.set;
  let parentRecords = 0;
  Map.prototype.set = function(key, value) {
    if (value && typeof value === 'object' && 'parentKey' in value && 'edge' in value) {
      parentRecords += 1;
    }
    return original.call(this, key, value);
  };
  try {
    return { output: buildGraphNeighborhood(options), parentRecords };
  } finally {
    Map.prototype.set = original;
  }
};
const id = (index) => `node-${String(index).padStart(3, '0')}`;
const chain = graphRelationsFromEdges({
  callEdges: Array.from({ length: 63 }, (_, index) => [id(index), id(index + 1)])
});
const base = { graphRelations: chain, seed: { type: 'chunk', chunkUid: id(0) }, direction: 'out', depth: 64 };
for (const [includePaths, maxPaths, expectedParents] of [
  [false, undefined, 0], [true, 0, 0], [true, 2, 2], [true, 63, 63], [true, undefined, 63]
]) {
  const { output, parentRecords } = observeParents({ ...base, includePaths, caps: { maxPaths } });
  assert.equal(parentRecords, expectedParents,
    `predecessor retention follows requested witnesses: paths=${includePaths}, cap=${maxPaths}`);
  assert.equal(output.nodes.length, 64, 'path budget must not change reached nodes');
  assert.equal(output.edges.length, 63, 'path budget must not change traversed edges');
  assert.equal(output.stats.counts.workUnitsUsed, 63);
  if (!includePaths) {
    assert.equal(output.paths, null);
    assert.equal(output.truncation, null);
    continue;
  }
  assert.equal(output.paths.length, expectedParents);
  for (const [index, witness] of output.paths.entries()) {
    assert.deepEqual(witness.nodes.map((node) => node.chunkUid),
      Array.from({ length: index + 2 }, (_, offset) => id(offset)));
    assert.equal(witness.edges.length, index + 1);
    assert.equal(witness.distance, index + 1);
  }
  const cap = output.truncation?.find((record) => record.cap === 'maxPaths');
  if (maxPaths != null && maxPaths < 63) {
    assert.equal(cap.limit, maxPaths);
    assert.equal(cap.observed, 63);
    assert.equal(cap.omitted, 63 - maxPaths);
  } else {
    assert.equal(cap, undefined);
  }
}

// Diamond + cycle + multiple seeds. First discovery, not final sorted node order,
// owns the witness and path admission. C is a seed, so D's parent must be C.
const graphRelations = graphRelationsFromEdges({ callEdges: [
  ['A', ['B', 'C']], ['B', ['D']], ['C', ['D', 'E']], ['D', ['A', 'F']], ['E', ['F']]
] });
const seeds = [{ type: 'chunk', chunkUid: 'C' }, { type: 'chunk', chunkUid: 'A' }];
const options = { graphRelations, seeds, direction: 'out', depth: 4, includePaths: true };
const expectedPaths = [['A', 'B'], ['C', 'D'], ['C', 'E'], ['C', 'D', 'F']];
for (const maxPaths of [0, 1, 2, 3, 4, 8, undefined]) {
  const { output, parentRecords } = observeParents({ ...options, caps: { maxPaths } });
  const selected = maxPaths == null ? expectedPaths : expectedPaths.slice(0, maxPaths);
  assert.deepEqual(output.paths.map((entry) => entry.nodes.map((node) => node.chunkUid)), selected);
  assert.equal(parentRecords, selected.length);
  assert.equal(output.nodes.length, 6);
}
const cappedNodes = observeParents({ ...options, caps: { maxNodes: 3, maxPaths: 2 } });
assert.equal(cappedNodes.parentRecords, 1);
assert.deepEqual(cappedNodes.output.paths.map((entry) => entry.nodes.map((node) => node.chunkUid)), [['A', 'B']]);
assert(cappedNodes.output.truncation.some((record) => record.cap === 'maxNodes'));

// Public wrappers still expose exact chosen witnesses and partial/cap metadata.
const now = () => '2026-10-07T00:00:00.000Z';
const context = buildGraphContextPack({ ...base, includePaths: true, caps: { maxPaths: 2 }, now, indexSignature: 'witness-chain-fixture-v1' });
assert.deepEqual(context.paths.map((entry) => entry.nodes.map((node) => node.chunkUid)),
  [[id(0), id(1)], [id(0), id(1), id(2)]]);
const impact = buildImpactAnalysis({ ...base, seed: base.seed, direction: 'downstream', caps: { maxPaths: 2 }, now, indexSignature: 'witness-chain-fixture-v1' });
assert.equal(impact.impacted.length, 63);
assert.equal(impact.impacted.filter((entry) => entry.witnessPath).length, 2);
assert.equal(impact.impacted.filter((entry) => entry.partial).length, 61);
console.log('graph witness retention, cap, cycle, diamond, multi-seed and wrapper contracts passed');
