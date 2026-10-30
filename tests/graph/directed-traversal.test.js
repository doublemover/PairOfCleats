import assert from 'node:assert/strict';
import { buildGraphIndex } from '../../src/graph/store.js';
import { buildGraphContextPack } from '../../src/graph/context-pack.js';
import { validateGraphContextPack } from '../../src/contracts/validators/analysis.js';
import { renderGraphContextPack } from '../../src/retrieval/output/graph-context-pack.js';
import { graphRelationsFromEdges } from './helpers/graph-fixtures.js';

const callEdges = [['a', ['b']], ['b', ['a']], ['c', ['b']]];
const usageEdges = [['c', ['b']]];
const importEdges = [['src/a.js', ['src/b.js']], ['src/b.js', ['src/a.js']], ['src/c.js', ['src/b.js']]];
const graphRelations = graphRelationsFromEdges({ callEdges, usageEdges, importEdges });
for (const name of ['callGraph', 'usageGraph']) for (const node of graphRelations[name].nodes) node.file = `src/${node.id}.js`;
const callSites = callEdges.map(([from, [to]]) => ({ callerChunkUid: from, targetChunkUid: to, callSiteId: `call-${from}-${to}` }));
const symbolEdges = [{ from: { chunkUid: 'b' }, type: 'symbol', confidence: 0.9,
  to: { v: 1, status: 'resolved', resolved: { symbolId: 'sym' }, candidates: [] } }];
const rawEdges = [
  ...callEdges.map(([from, [to]]) => ({ graph: 'callGraph', from, to })),
  ...usageEdges.map(([from, [to]]) => ({ graph: 'usageGraph', from, to })),
  ...importEdges.map(([from, [to]]) => ({ graph: 'importGraph', from, to }))
];
const key = edge => `${edge.graph}|${edge.from}|${edge.to}`;
const recorded = new Set(rawEdges.map(key));
const refId = (ref, graph) => graph === 'importGraph' ? ref.path || `src/${ref.chunkUid}.js` : ref.chunkUid;
const edgeKey = edge => key({ graph: edge.graph, from: refId(edge.from, edge.graph), to: refId(edge.to, edge.graph) });
const stable = pack => ({ nodes: pack.nodes, edges: pack.edges, paths: pack.paths, truncation: pack.truncation });
const results = new Map();
for (const includeCsr of [false, true]) {
  const graphIndex = buildGraphIndex({ graphRelations, callSites, symbolEdges, includeCsr, indexSignature: `directed-${includeCsr}` });
  for (const direction of ['out', 'in', 'both']) {
    const pack = buildGraphContextPack({ graphIndex, seed: { type: 'chunk', chunkUid: 'b' },
      direction, depth: 1, includePaths: true, indexSignature: graphIndex.indexSignature, pathSemantics: 'graph-witness',
      edgeFilters: { graphs: ['callGraph', 'usageGraph', 'importGraph'] } });
    const validation = validateGraphContextPack(pack);
    assert.equal(validation.ok, true, validation.errors.join('; '));
    const expected = rawEdges.filter(edge => {
      const seed = edge.graph === 'importGraph' ? 'src/b.js' : 'b';
      return direction === 'out' ? edge.from === seed : direction === 'in' ? edge.to === seed : edge.from === seed || edge.to === seed;
    }).map(key).sort();
    assert.deepEqual(pack.edges.map(edgeKey).sort(), expected, `${direction}, CSR=${includeCsr}: source-directed edges and reciprocals`);
    for (const edge of pack.edges) {
      assert.ok(recorded.has(edgeKey(edge)), 'walking an incoming edge cannot invent its inverse');
      if (edge.graph === 'callGraph') assert.deepEqual(edge.evidence?.callSiteIds, [`call-${edge.from.chunkUid}-${edge.to.chunkUid}`]);
    }
    for (const witness of pack.paths) {
      assert.equal(witness.nodes[0].chunkUid, 'b', 'witness node order describes the walk');
      for (const edge of witness.edges) {
        const graph = edge.edgeType === 'call' ? 'callGraph' : edge.edgeType === 'usage' ? 'usageGraph' : 'importGraph';
        assert.ok(recorded.has(edgeKey({ ...edge, graph })), 'witness edges retain source orientation');
      }
    }
    if (direction === 'in') {
      const markdown = renderGraphContextPack(pack);
      assert.ok(markdown.includes('chunk:c -> chunk:b (call, callGraph)'));
      assert.ok(!markdown.includes('chunk:b -> chunk:c (call, callGraph)'));
      assert.deepEqual(JSON.parse(JSON.stringify(pack)).edges, pack.edges);
    }
    if (includeCsr) assert.deepEqual(stable(pack), stable(results.get(direction)), 'CSR/legacy content and witness parity');
    else results.set(direction, pack);
  }
  const mixed = buildGraphContextPack({ graphIndex, seed: { type: 'symbol', symbolId: 'sym' },
    direction: 'in', depth: 2, includePaths: true, indexSignature: 'directed', edgeFilters: { graphs: ['symbolEdges', 'callGraph'] } });
  assert.ok(mixed.edges.some(edge => edge.graph === 'symbolEdges' && edge.from.chunkUid === 'b'));
  assert.ok(mixed.edges.some(edge => edge.graph === 'callGraph' && edge.from.chunkUid === 'c' && edge.to.chunkUid === 'b'));
  const witness = mixed.paths.find(entry => entry.to.chunkUid === 'c');
  assert.deepEqual(witness.nodes.map(ref => ref.symbolId || ref.chunkUid), ['sym', 'b', 'c']);
  assert.deepEqual(witness.edges.map(edge => [edge.from.chunkUid, edge.to.symbolId || edge.to.chunkUid]), [['b', 'sym'], ['c', 'b']]);
  const capped = buildGraphContextPack({ graphIndex, seed: { type: 'chunk', chunkUid: 'b' },
    direction: 'both', depth: 1, caps: { maxEdges: 1, maxNodes: 2, maxCandidates: 1 }, indexSignature: 'directed',
    edgeFilters: { graphs: ['callGraph'] } });
  assert.ok(capped.edges.length <= 1 && capped.nodes.length <= 2);
  assert.ok(capped.edges.every(edge => recorded.has(edgeKey(edge))));
  assert.ok(capped.truncation.length > 0);
  const selfLoop = graphRelationsFromEdges({ callEdges: [['a', ['b']], ['b', ['a', 'b']]] });
  const selfIndex = buildGraphIndex({ graphRelations: selfLoop, includeCsr });
  const selfPack = buildGraphContextPack({ graphIndex: selfIndex, seed: { type: 'chunk', chunkUid: 'b' },
    direction: 'both', depth: 1, caps: { maxCandidates: 3 }, indexSignature: 'self-loop', edgeFilters: { graphs: ['callGraph'] } });
  assert.equal(selfPack.edges.length, 3, 'reciprocals remain distinct and a self-loop counts once');
  assert.ok(!(selfPack.truncation || []).some(row => row.cap === 'maxCandidates'), 'one self-loop cannot consume two candidate slots');
}
console.log('Directed legacy/CSR traversal preserves reciprocal edges, real call-site evidence, witness walks and rendered orientation.');
