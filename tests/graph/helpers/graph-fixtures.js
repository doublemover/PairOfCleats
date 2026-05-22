import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const emptyGraphRelations = ({
  version = 1,
  generatedAt,
  callGraph,
  usageGraph,
  importGraph
} = {}) => ({
  version,
  ...(generatedAt ? { generatedAt } : {}),
  callGraph: callGraph || { nodeCount: 0, edgeCount: 0, nodes: [] },
  usageGraph: usageGraph || { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: importGraph || { nodeCount: 0, edgeCount: 0, nodes: [] }
});

export const graphFromEdges = (edges = []) => {
  const outgoing = new Map();
  const incoming = new Map();
  let edgeCount = 0;
  for (const [source, targets] of edges) {
    const targetList = Array.isArray(targets) ? targets : [targets];
    if (!outgoing.has(source)) outgoing.set(source, []);
    for (const target of targetList) {
      outgoing.get(source).push(target);
      if (!incoming.has(target)) incoming.set(target, []);
      incoming.get(target).push(source);
      if (!outgoing.has(target)) outgoing.set(target, []);
      edgeCount += 1;
    }
  }

  const nodeIds = Array.from(new Set([...outgoing.keys(), ...incoming.keys()]));
  return {
    nodeCount: nodeIds.length,
    edgeCount,
    nodes: nodeIds.map((id) => ({
      id,
      out: outgoing.get(id) || [],
      in: incoming.get(id) || []
    }))
  };
};

export const graphRelationsFromEdges = ({
  version = 1,
  generatedAt,
  callEdges = [],
  usageEdges = [],
  importEdges = []
} = {}) => emptyGraphRelations({
  version,
  generatedAt,
  callGraph: graphFromEdges(callEdges),
  usageGraph: graphFromEdges(usageEdges),
  importGraph: graphFromEdges(importEdges)
});

export const chunkCallGraphRelations = ({
  version = 1,
  generatedAt,
  nodeCount = 2,
  edgeCount = 1,
  nodes = [
    { id: 'chunk-a', out: ['chunk-b'], in: [] },
    { id: 'chunk-b', out: [], in: ['chunk-a'] }
  ],
  usageGraph,
  importGraph
} = {}) => ({
  version,
  ...(generatedAt ? { generatedAt } : {}),
  callGraph: { nodeCount, edgeCount, nodes },
  usageGraph: usageGraph || { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: importGraph || { nodeCount: 0, edgeCount: 0, nodes: [] }
});

export const cloneJson = (value) => JSON.parse(JSON.stringify(value));

export const graphEdgeKey = (edge) => (
  `${edge.graph}|${edge.from?.chunkUid || ''}|${edge.edgeType || ''}|${edge.to?.chunkUid || ''}`
);

export const createGraphStoreFixture = ({
  prefix = 'graph-store-',
  compatibilityKey,
  graphRelations,
  symbolEdges = [],
  callSites = [],
  extraPieces = [],
  writeExtraPieces
} = {}) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const piecesDir = path.join(tmpDir, 'pieces');
  fs.mkdirSync(piecesDir, { recursive: true });

  const manifest = {
    ...(compatibilityKey ? { compatibilityKey } : {}),
    pieces: [
      { name: 'graph_relations', path: 'pieces/graph_relations.json' },
      { name: 'symbol_edges', path: 'pieces/symbol_edges.json' },
      { name: 'call_sites', path: 'pieces/call_sites.json' },
      ...extraPieces
    ]
  };

  fs.writeFileSync(path.join(piecesDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(
    path.join(piecesDir, 'graph_relations.json'),
    JSON.stringify(graphRelations || emptyGraphRelations(), null, 2)
  );
  fs.writeFileSync(path.join(piecesDir, 'symbol_edges.json'), JSON.stringify(symbolEdges, null, 2));
  fs.writeFileSync(path.join(piecesDir, 'call_sites.json'), JSON.stringify(callSites, null, 2));
  writeExtraPieces?.({ tmpDir, piecesDir });

  return { tmpDir, piecesDir };
};
