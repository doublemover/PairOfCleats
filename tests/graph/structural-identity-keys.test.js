import assert from 'node:assert/strict';
import { edgeKey, compareGraphEdges, compareWitnessPaths } from '../../src/graph/ordering.js';
import { edgeKeyFromIndex, dedupeSortedEdges } from '../../src/graph/neighborhood/edge-policy.js';
const edge = (from, type, to) => ({ graph: 'callGraph', edgeType: type,
  from: { type: 'chunk', chunkUid: from }, to: { type: 'chunk', chunkUid: to } });
const a = edge('a|b', 'call', 'c'), b = edge('a', 'b|call', 'c');
assert.notEqual(edgeKey(a), edgeKey(b));
assert.equal(dedupeSortedEdges([b, a].sort(compareGraphEdges)).length, 2);
const index = { callGraphIds: { idToIndex: new Map([['a', 1], ['b', 2], ['c', 3]]) } };
assert.notEqual(edgeKeyFromIndex(edge('a', 'call|3', 'b'), index), edgeKeyFromIndex(edge('a', 'call', 'c'), index));
assert.notEqual(compareWitnessPaths({ nodes: [{ type: 'chunk', chunkUid: 'a>b' }, { type: 'chunk', chunkUid: 'c' }] },
  { nodes: [{ type: 'chunk', chunkUid: 'a' }, { type: 'chunk', chunkUid: 'b>c' }] }), 0);
console.log('Graph tuple and witness identities preserve delimiter-containing endpoint data.');
