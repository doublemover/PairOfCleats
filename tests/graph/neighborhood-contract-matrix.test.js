#!/usr/bin/env node
import assert from 'node:assert';

import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { buildGraphIndex, buildGraphIndexCacheKey, createGraphStore } from '../../src/graph/store.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

{
  const buildGraph = (neighbors) => ({
    version: 1,
    callGraph: {
      nodeCount: 1,
      edgeCount: neighbors.length,
      nodes: [{ id: 'chunk-a', out: neighbors, in: [] }]
    },
    usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
  });

  const graphA = buildGraph(['chunk-c', 'chunk-b', 'chunk-d']);
  const graphB = buildGraph(['chunk-d', 'chunk-b', 'chunk-c']);
  const caps = { maxFanoutPerNode: 2 };
  const first = buildGraphNeighborhood({
    seed: { type: 'chunk', chunkUid: 'chunk-a' },
    graphRelations: graphA,
    depth: 1,
    caps
  });
  const second = buildGraphNeighborhood({
    seed: { type: 'chunk', chunkUid: 'chunk-a' },
    graphRelations: graphB,
    depth: 1,
    caps
  });
  assert.deepStrictEqual(second.truncation, first.truncation);
}

{
  const graphRelations = {
    version: 1,
    callGraph: {
      nodeCount: 1,
      edgeCount: 2,
      nodes: [{ id: 'chunk-a', out: ['chunk-c', 'chunk-b'], in: [] }]
    },
    usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
  };
  const result = buildGraphNeighborhood({
    seed: { type: 'chunk', chunkUid: 'chunk-a' },
    graphRelations,
    depth: 1,
    caps: { maxEdges: 1 }
  });
  assert.strictEqual(result.edges.length, 1);
  assert.strictEqual(result.edges[0]?.to?.chunkUid, 'chunk-b');
}

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-index-cache-'));
  const piecesDir = path.join(tmpDir, 'pieces');
  fs.mkdirSync(piecesDir, { recursive: true });
  const manifest = {
    compatibilityKey: 'compat-graph-index-cache',
    pieces: [
      { name: 'graph_relations', path: 'pieces/graph_relations.json' },
      { name: 'symbol_edges', path: 'pieces/symbol_edges.json' },
      { name: 'call_sites', path: 'pieces/call_sites.json' }
    ]
  };
  fs.writeFileSync(path.join(piecesDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(
    path.join(piecesDir, 'graph_relations.json'),
    JSON.stringify({
      version: 1,
      callGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
      usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
      importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
    }, null, 2)
  );
  fs.writeFileSync(path.join(piecesDir, 'symbol_edges.json'), JSON.stringify([], null, 2));
  fs.writeFileSync(path.join(piecesDir, 'call_sites.json'), JSON.stringify([], null, 2));

  const store = createGraphStore({ indexDir: tmpDir, strict: true });
  const cacheKey = buildGraphIndexCacheKey({
    indexSignature: 'graph-index-cache',
    graphs: ['symbolEdges']
  });
  const first = await store.loadGraphIndex({ cacheKey, graphs: ['symbolEdges'], repoRoot: tmpDir });
  const second = await store.loadGraphIndex({ cacheKey, graphs: ['symbolEdges'], repoRoot: tmpDir });
  assert.strictEqual(first, second);
}

{
  const baseGraph = {
    version: 1,
    callGraph: {
      nodeCount: 2,
      edgeCount: 1,
      nodes: [
        { id: 'chunk-a', out: ['chunk-b'], in: [] },
        { id: 'chunk-b', out: [], in: ['chunk-a'] }
      ]
    },
    usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
  };
  const graphForIndex = JSON.parse(JSON.stringify(baseGraph));
  const graphForCall = JSON.parse(JSON.stringify(baseGraph));
  graphForCall.callGraph.nodes.push({ id: 'chunk-c', out: [], in: [] });
  graphForCall.callGraph.nodeCount = 3;
  const graphIndex = buildGraphIndex({ graphRelations: graphForIndex });

  const neighborhood = buildGraphNeighborhood({
    seed: { type: 'chunk', chunkUid: 'chunk-a' },
    graphRelations: graphForCall,
    graphIndex,
    depth: 1
  });

  const ids = neighborhood.nodes.map((node) => node?.ref?.chunkUid).filter(Boolean).sort();
  assert.deepStrictEqual(ids, ['chunk-a', 'chunk-b']);
}

{
  const graphRelations = {
    version: 1,
    callGraph: {
      nodeCount: 1,
      edgeCount: 0,
      nodes: [{ id: 'chunk-a', out: [], in: [] }]
    },
    usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
  };
  const graphIndex = buildGraphIndex({ graphRelations, repoRoot: 'C:/repo-a' });
  const result = buildGraphNeighborhood({
    seed: { type: 'chunk', chunkUid: 'chunk-a' },
    graphRelations,
    graphIndex,
    repoRoot: 'C:/repo-b',
    depth: 0
  });
  const codes = result.warnings?.map((warning) => warning.code) || [];
  assert(codes.includes('GRAPH_INDEX_REPOROOT_MISMATCH'));
}

{
  const graphRelations = {
    version: 1,
    callGraph: {
      nodeCount: 1,
      edgeCount: 0,
      nodes: [{ id: 'chunk-a', out: [], in: [] }]
    },
    usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    importGraph: {
      nodeCount: 1,
      edgeCount: 0,
      nodes: [{ id: 'src/a.js', out: [], in: [] }]
    }
  };
  const result = buildGraphNeighborhood({
    seed: { type: 'chunk', chunkUid: 'chunk-a' },
    graphRelations,
    includeImports: true,
    depth: 1
  });
  const codes = result.warnings?.map((warning) => warning.code) || [];
  assert(codes.includes('IMPORT_GRAPH_MISSING_FILE'));
}

console.log('graph neighborhood contract matrix test passed');
