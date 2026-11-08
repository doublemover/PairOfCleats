import assert from 'node:assert/strict';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { buildSymbolEdgesIndex } from '../../src/graph/indexes.js';

const candidate = symbolId => ({ symbolId, name: symbolId === 'sym-a' ? 'z-name' : 'a-name' });
const makeEdge = candidates => ({ from: { chunkUid: 'caller' }, type: 'call', confidence: 0.8,
  to: { v: 1, status: 'ambiguous', resolved: null, candidates } });
for (const candidates of [[candidate('sym-a'), candidate('sym-b')],
  [candidate('sym-b'), candidate('sym-a'), candidate('sym-b')]]) {
  const symbolEdges = [makeEdge(candidates)];
  const symbolIndex = buildSymbolEdgesIndex(symbolEdges);
  assert.deepEqual([...symbolIndex.bySymbol.keys()], ['sym-a', 'sym-b']);
  for (const maxCandidates of [0, 1, 2]) {
    const output = buildGraphNeighborhood({ seed: { type: 'chunk', chunkUid: 'caller' },
      symbolEdges, direction: 'out', includePaths: true, depth: 1,
      edgeFilters: { graphs: ['symbolEdges'] }, caps: { maxCandidates } });
    assert.deepEqual(output.nodes.filter(node => node.ref.type === 'symbol').map(node => node.ref.symbolId),
      ['sym-a', 'sym-b'].slice(0, maxCandidates));
    assert.equal(output.edges.length, 1, 'source envelope remains visible even with no admitted candidate');
    assert.equal(output.edges[0].to.candidates.length, maxCandidates);
    assert.equal(output.paths.length, maxCandidates);
    for (const path of output.paths) assert.equal(path.edges[0].evidence.uncertain, true);
    for (const symbolId of ['sym-a', 'sym-b']) {
      for (const direction of ['in', 'both']) {
        const incoming = buildGraphNeighborhood({ seed: { type: 'symbol', symbolId }, symbolEdges,
          direction, depth: 1, includePaths: true, caps: { maxCandidates }, edgeFilters: { graphs: ['symbolEdges'] } });
        const retained = ['sym-a', 'sym-b'].slice(0, maxCandidates).includes(symbolId);
        assert.equal(incoming.nodes.some(node => node.ref.chunkUid === 'caller'), retained);
        if (retained) assert.equal(incoming.paths[0].edges[0].evidence.resolution, 'candidate');
      }
    }
  }
}
const resolved = makeEdge([candidate('sym-a')]);
resolved.to.resolved = candidate('sym-b'); resolved.to.status = 'resolved';
const result = buildGraphNeighborhood({ seed: { type: 'chunk', chunkUid: 'caller' }, symbolEdges: [resolved],
  direction: 'out', includePaths: true, caps: { maxCandidates: 0 } });
assert.deepEqual(result.paths[0].to, { type: 'symbol', symbolId: 'sym-b' });
assert.equal(result.paths[0].edges[0].evidence, undefined, 'recorded resolved witness stays authoritative');
console.log('ambiguous symbol traversal applies one bounded uncertain candidate projection');
