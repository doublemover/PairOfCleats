import assert from 'node:assert/strict';
import { buildGraphIndex } from '../../src/graph/store.js';
import { buildGraphContextPack } from '../../src/graph/context-pack.js';
import { attachGraphPathCapability } from '../../src/graph/path-capability.js';
import { validateGraphContextPack } from '../../src/contracts/validators/analysis.js';
import { graphRelationsFromEdges } from './helpers/graph-fixtures.js';

const relations = graphRelationsFromEdges({ callEdges: [['b', ['a']], ['a', ['d']]],
  importEdges: [['src/b.js', ['src/a.js']], ['src/a.js', ['src/b.js', 'src/d.js']], ['src/c.js', ['src/b.js']]] });
for (const row of relations.callGraph.nodes) row.file = `src/${row.id}.js`;
const signature = 'containing-file-projection-v1';
const chunk = chunkUid => ({ type: 'chunk', chunkUid });
const sourceImports = new Set(['src/b.js|src/a.js', 'src/a.js|src/b.js', 'src/a.js|src/d.js', 'src/c.js|src/b.js']);
const check = pack => {
  const validation = validateGraphContextPack(pack);
  assert.equal(validation.ok, true, validation.errors.join('; '));
  for (const edge of [...pack.edges, ...(pack.paths || []).flatMap(path => path.edges)]) {
    if (edge.edgeType !== 'import') { assert.equal(edge.importProjection, undefined); continue; }
    const p = edge.importProjection;
    if (p) {
      assert.equal(p.containingFile, `src/${p.chunkUid}.js`);
      assert.ok(sourceImports.has(`${p.fromFile}|${p.toFile}`), 'projection names a real canonical file-to-file import');
      assert.ok(edge.from.type === 'chunk' || edge.to.type === 'chunk');
    } else {
      assert.equal(edge.from.type, 'file'); assert.equal(edge.to.type, 'file');
      assert.ok(sourceImports.has(`${edge.from.path}|${edge.to.path}`));
    }
  }
};
for (const mode of ['raw', 'legacy', 'csr']) {
  const graphIndex = mode === 'raw' ? null : buildGraphIndex({ graphRelations: relations,
    includeCsr: mode === 'csr', indexSignature: signature });
  const source = graphIndex ? { graphIndex } : { graphRelations: relations };
  for (const direction of ['out', 'in', 'both']) for (const includePaths of [false, true]) for (const depth of [1, 2]) {
    const options = { ...source, seed: chunk('b'), direction, depth, includePaths, indexSignature: signature,
      edgeFilters: { graphs: ['callGraph', 'importGraph'] } };
    const ordinary = buildGraphContextPack(options);
    const pack = buildGraphContextPack({ ...options, pathSemantics: 'graph-witness' });
    assert.deepEqual(pack.nodes, ordinary.nodes); assert.deepEqual(pack.edges, ordinary.edges);
    assert.deepEqual(pack.paths, ordinary.paths);
    assert.ok(pack.edges.some(edge => edge.importProjection), 'qualification preserves supported chunk imports');
    check(pack);
    if (!includePaths) assert.equal(pack.paths, null);
    const corrupt = structuredClone(pack);
    corrupt.edges.find(edge => edge.importProjection).importProjection.containingFile = 'unrelated.js';
    assert.equal(validateGraphContextPack(corrupt).ok, false);
    const rebound = structuredClone(pack);
    const projected = rebound.edges.find(edge => edge.importProjection).importProjection;
    if (projected.fromFile === projected.containingFile) projected.fromFile = 'unrelated.js';
    if (projected.toFile === projected.containingFile) projected.toFile = 'unrelated.js';
    projected.containingFile = 'unrelated.js';
    assert.throws(() => attachGraphPathCapability(rebound, { ...options, operation: 'graph_context',
      pathSemantics: 'graph-witness', caps: {} }), { code: 'ERR_GRAPH_PATH_CONTRACT' },
    'a self-consistent alias cannot replace the selected generation chunk/file fact');
  }
  for (const options of [
    { seed: { type: 'file', path: 'src/b.js' }, edgeFilters: { graphs: ['importGraph'] } },
    { seed: chunk('b'), edgeFilters: { graphs: ['callGraph'] } }
  ]) {
    const pack = buildGraphContextPack({ ...source, ...options, direction: 'out', depth: 2,
      includePaths: true, indexSignature: signature, pathSemantics: 'graph-witness' });
    assert.ok(pack.edges.length); assert.ok(pack.edges.every(edge => edge.importProjection === undefined));
    check(pack);
  }
}
// A call can enter another chunk and then cross that chunk's containing file.
const mixed = structuredClone(relations);
mixed.importGraph.nodes.find(row => row.id === 'src/b.js').out = [];
mixed.importGraph.nodes.find(row => row.id === 'src/a.js').in = [];
const pack = buildGraphContextPack({ graphRelations: mixed, seed: chunk('b'), direction: 'out', depth: 2,
  includePaths: true, indexSignature: signature, pathSemantics: 'graph-witness' });
assert.ok(pack.paths.some(path => path.edges.length === 2 && path.edges[0].edgeType === 'call'
  && path.edges[1].edgeType === 'import' && path.edges[1].importProjection.chunkUid === 'a'));
check(pack);
const self = graphRelationsFromEdges({ callEdges: [['b', []]], importEdges: [['src/b.js', ['src/b.js']]] });
self.callGraph.nodes[0].file = 'src/b.js';
const recursion = buildGraphContextPack({ graphRelations: self, seed: chunk('b'), direction: 'both', depth: 2,
  edgeFilters: { graphs: ['importGraph'] }, includePaths: true, indexSignature: signature, pathSemantics: 'graph-witness' });
assert.equal(validateGraphContextPack(recursion).ok, true);
assert.equal(recursion.nodes.length, 1, 'self-import cannot manufacture a second file node with a disconnected witness');
assert.equal(recursion.edges.length, 1); assert.deepEqual(recursion.paths, []);
console.log('Typed containing-file import projection preserves source domains and connected witnesses.');
