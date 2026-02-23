import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const resolveJsonArray = (value) => (Array.isArray(value) ? value : []);

export const createImpactRepoFixture = ({
  prefix = 'impact-fixture-',
  compatibilityKey = 'compat-impact-test',
  graphRelations,
  symbolEdges = [],
  callSites = [],
  chunkMeta = []
} = {}) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const indexDir = path.join(repoRoot, 'index-code');
  const piecesDir = path.join(indexDir, 'pieces');
  fs.mkdirSync(piecesDir, { recursive: true });

  fs.writeFileSync(path.join(piecesDir, 'manifest.json'), JSON.stringify({
    compatibilityKey,
    pieces: [
      { name: 'graph_relations', path: 'pieces/graph_relations.json' },
      { name: 'symbol_edges', path: 'pieces/symbol_edges.json' },
      { name: 'call_sites', path: 'pieces/call_sites.json' }
    ]
  }, null, 2));
  fs.writeFileSync(path.join(piecesDir, 'graph_relations.json'), JSON.stringify(graphRelations || {
    version: 1,
    callGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
  }, null, 2));
  fs.writeFileSync(path.join(piecesDir, 'symbol_edges.json'), JSON.stringify(resolveJsonArray(symbolEdges), null, 2));
  fs.writeFileSync(path.join(piecesDir, 'call_sites.json'), JSON.stringify(resolveJsonArray(callSites), null, 2));
  fs.writeFileSync(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(resolveJsonArray(chunkMeta), null, 2));
  return { repoRoot, indexDir, piecesDir };
};

export const removeImpactRepoFixture = (repoRoot) => {
  if (!repoRoot || typeof repoRoot !== 'string') return;
  fs.rmSync(repoRoot, { recursive: true, force: true });
};
