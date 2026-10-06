#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  collectCsrNeighborIds,
  createCsrNeighborIterator,
  createCsrNeighborResolver,
  iterateCsrNeighborIds
} from '../../src/graph/neighborhood/csr.js';
import { createGraphNeighborResolver } from '../../src/graph/neighborhood/walker.js';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { buildGraphIndex } from '../../src/graph/store.js';
import { chunkCallGraphRelations, cloneJson } from './helpers/graph-fixtures.js';

const fanout = 80;
const names = Array.from({ length: fanout + 1 }, (_, i) => `chunk-${String(i).padStart(3, '0')}`);
const relations = chunkCallGraphRelations({
  nodeCount: names.length,
  edgeCount: fanout * 4,
  nodes: names.map((id, i) => ({
    id,
    out: i ? [names[0], names[0]] : names.slice(1).flatMap((name) => [name, name]),
    in: i ? [names[0]] : names.slice(1)
  }))
});

for (const direction of ['out', 'in', 'both']) {
  for (const caps of [
    { maxFanoutPerNode: 3, maxNodes: 8, maxEdges: 7, maxPaths: 5, maxWorkUnits: 25 },
    { maxFanoutPerNode: 100, maxNodes: 100, maxEdges: 300, maxPaths: 100, maxWorkUnits: 1000 }
  ]) {
    const request = { seed: { type: 'chunk', chunkUid: names[0] }, direction, depth: 2, includePaths: true, caps };
    const legacy = buildGraphNeighborhood({ ...request, graphRelations: cloneJson(relations) });
    const graphIndex = buildGraphIndex({ graphRelations: cloneJson(relations), includeCsr: true });
    const actual = buildGraphNeighborhood({ ...request, graphIndex });
    for (const result of [actual, legacy]) {
      delete result.stats.timing;
      delete result.stats.memory;
      delete result.stats.cache;
    }
    assert.deepEqual(actual, legacy, `ordered output, paths, warnings, counts and truncation: ${direction}`);
  }
}

const graphIndex = buildGraphIndex({ graphRelations: cloneJson(relations), includeCsr: true });
const iterate = createCsrNeighborIterator({ graphIndex });
const resolve = createCsrNeighborResolver({ graphIndex });
for (const direction of ['out', 'in', 'both']) {
  assert.deepEqual(Array.from(iterate('callGraph', names[0], direction)), names.slice(1));
  assert.deepEqual(resolve('callGraph', names[0], direction), names.slice(1), 'array API remains materialized');
  const normalize = (name) => Number(name.slice(-3)) % 5 ? `group-${Number(name.slice(-3)) % 5}` : null;
  assert.deepEqual(Array.from(iterate('callGraph', names[0], direction, normalize)),
    ['group-1', 'group-2', 'group-3', 'group-4'], 'normalization still sorts, drops and deduplicates');
  assert.deepEqual(Array.from(iterate('callGraph', 'missing', direction)), []);
}
assert.equal(iterate('missingGraph', names[0], 'out'), null, 'absent CSR must retain fallback sentinel');

let idReads = 0;
const ids = graphIndex.graphRelationsCsr.callGraph.ids;
for (let i = 0; i < ids.length; i++) {
  const value = ids[i];
  Object.defineProperty(ids, i, { configurable: true, get() { idReads++; return value; } });
}
const graphResolver = createGraphNeighborResolver({ graphIndex });
for (const direction of ['out', 'in', 'both']) {
  idReads = 0;
  const row = graphResolver(graphIndex.callGraphIndex, names[0], direction, null, null, 'callGraph');
  assert.equal(Array.isArray(row), false, 'active walker must borrow CSR, not collect a neighbor array');
  assert.equal(idReads, 0, 'resolving a row must not materialize its IDs');
  assert.equal(row.next().value, names[1]);
  assert.ok(idReads <= 3, 'merged traversal needs at most bounded lookahead, independent of fanout');
  const readBeforeClose = idReads;
  row.return();
  assert.equal(idReads, readBeforeClose, 'closing early must not walk retired neighbors');
}

for (const input of [
  { ids: null, offsets: new Uint32Array(), edges: new Uint32Array(), nodeIndex: 0 },
  { ids: [], offsets: [], edges: [], nodeIndex: 0 },
  { ids: [], offsets: new Uint32Array([0, 0]), edges: new Uint32Array(), nodeIndex: -1 },
  { ids: ['a'], offsets: new Uint32Array([0, 0]), edges: new Uint32Array(), nodeIndex: 0 }
]) {
  assert.deepEqual(Array.from(iterateCsrNeighborIds(input)), []);
  assert.deepEqual(collectCsrNeighborIds(input), []);
}
console.log('CSR iterator laziness, bounded lookahead and high-fanout neighborhood parity passed');
