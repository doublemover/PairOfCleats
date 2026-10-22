import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GRAPH_RELATION_EDGES_VERSION } from '../../../src/contracts/schemas/graph-relation-edges.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { enqueueGraphRelationsArtifacts } from '../../../src/index/build/artifacts/graph-relations.js';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { prepareGraphEvidencePage } from '../../../src/integrations/tooling/graph-helpers.js';
import { createGraphStore } from '../../../src/graph/store.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = resolveTestCachePath(process.cwd(), 'retained-adjacency-display-caps');
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });
const chunks = Array.from({ length: 41 }, (_, index) => ({
  id: index, chunkUid: 'chunk-' + String(index).padStart(3, '0'),
  file: 'src/file-' + index + '.js', name: 'function' + index, kind: 'FunctionDeclaration',
  codeRelations: { callLinks: [], callDetails: [], usageLinks: [] }
}));
for (const target of chunks) {
  chunks[0].codeRelations.callLinks.push({ to: { status: 'resolved', resolved: { chunkUid: target.chunkUid } } });
  chunks[0].codeRelations.callLinks.push({ to: { status: 'resolved', resolved: { chunkUid: target.chunkUid } } });
  chunks[0].codeRelations.callDetails.push({ targetChunkUid: target.chunkUid });
  target.codeRelations.usageLinks.push({ to: { status: 'resolved', resolved: { chunkUid: chunks.at(-1).chunkUid } } });
}
chunks[0].codeRelations.callDetails.push({ targetChunkUid: null, targetCandidates: ['may-a', 'may-b'] });
const fileRelations = new Map(chunks.map((chunk, index) => [chunk.file,
  { importLinks: [chunks[(index + 1) % chunks.length].file] }]));
const expected = [
  ...chunks.map(target => ({ schemaVersion: GRAPH_RELATION_EDGES_VERSION, graph: 'callGraph', from: chunks[0].chunkUid, to: target.chunkUid })),
  ...chunks.map(source => ({ schemaVersion: GRAPH_RELATION_EDGES_VERSION, graph: 'usageGraph', from: source.chunkUid, to: chunks.at(-1).chunkUid })),
  ...chunks.map((source, index) => ({ schemaVersion: GRAPH_RELATION_EDGES_VERSION, graph: 'importGraph', from: source.file, to: chunks[(index + 1) % chunks.length].file }))
].sort((a, b) => ['callGraph', 'usageGraph', 'importGraph'].indexOf(a.graph) - ['callGraph', 'usageGraph', 'importGraph'].indexOf(b.graph)
  || (a.from < b.from ? -1 : a.from > b.from ? 1 : 0) || (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
try {
  const pieces = [];
  await enqueueGraphRelationsArtifacts({ chunks, fileRelations, outDir: root, maxJsonBytes: 1024,
    caps: { maxNodes: 2, maxEdges: 1 }, byteBudget: { maxBytes: 4096, overflow: 'drop' },
    enqueueWrite: () => { throw new Error('Streaming production path must own its awaited write.'); },
    addPieceFile: (entry, file) => pieces.push({ ...entry, path: path.relative(root, file).replaceAll('\\', '/') }),
    formatArtifactLabel: value => value });
  await writePiecesManifest({ pieceEntries: pieces, outDir: root, mode: 'code',
    indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: 'retained-edges-generation' } });
  const store = createGraphStore({ indexDir: root });
  const rows = [];
  for await (const row of store.iterateGraphEdges({ limit: 3, scanRows: 4 })) rows.push(row);
  assert.deepEqual(rows, expected, 'all unique adjacency survives node, edge and display byte policies');
  assert.equal(rows.length, 123, 'observations do not spend distinct-edge slots or manufacture multiplicity');
  assert.ok(rows.some(row => row.graph === 'callGraph' && row.from === row.to), 'recursion remains a real retained edge');
  const bridge = await prepareGraphEvidencePage({ indexDir: root, family: 'graph_relation_edges', limit: 2,
    maxPageBytes: 4096, expectedBuildId: 'retained-edges-generation' });
  assert.deepEqual(bridge.rows, expected.slice(0, 2));
  assert.equal(bridge.generation.buildId, 'retained-edges-generation');
  assert.ok(Buffer.byteLength(JSON.stringify(bridge)) <= 4096);
  await assert.rejects(prepareGraphEvidencePage({ indexDir: root, family: 'graph_relation_edges',
    expectedBuildId: 'another-generation' }), { code: 'ERR_RETAINED_EVIDENCE_GENERATION' });
  const incoming = [];
  for await (const row of store.iterateGraphEdges({ filter: { graph: 'usageGraph', node: chunks.at(-1).chunkUid, direction: 'in' }, scanRows: 1 })) incoming.push(row);
  assert.deepEqual(incoming, expected.filter(row => row.graph === 'usageGraph'));
  const page = await store.readGraphEdgesPage({ filter: { graph: 'callGraph' }, limit: 1 });
  await assert.rejects(store.readGraphEdgesPage({ cursor: page.cursor, filter: { graph: 'usageGraph' } }),
    { code: 'ERR_GRAPH_EDGE_CURSOR_SCOPE' });
  const display = await store.loadGraph();
  assert.ok(display.callGraph.nodes.length <= 2);
  assert.ok(display.callGraph.edgeCount <= 1);
  const meta = JSON.parse(await fs.readFile(path.join(root, 'graph_relations.meta.json'), 'utf8'));
  assert.deepEqual((meta.fields || meta).extensions.retainedEdges.distinctEdges, [41, 41, 41]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(enqueueGraphRelationsArtifacts({ chunks, fileRelations, outDir: root,
    maxJsonBytes: 1024, abortSignal: controller.signal }), { name: 'AbortError' });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('retained adjacency survives display caps test passed');
