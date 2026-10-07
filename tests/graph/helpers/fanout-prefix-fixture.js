import { buildGraphIndex } from '../../../src/graph/store.js';

export const createFanoutPrefixFixture = ({ csr = true, cap = 3, direction = 'out' } = {}) => {
  const seed = 'chunk-000';
  const targets = Array.from({ length: 64 }, (_, index) => `chunk-${String(index + 1).padStart(3, '0')}`);
  const callNodes = [
    { id: seed, file: 'src/seed.js', out: targets, in: [targets[63]] },
    ...targets.map((id, index) => ({ id, file: `src/${index}.js`, out: index === 63 ? [seed] : [], in: [seed] }))
  ];
  const usageNodes = [
    { id: seed, file: 'src/seed.js', out: targets.slice(0, 8), in: targets.slice(0, 8) },
    ...targets.slice(0, 8).map((id) => ({ id, out: [seed], in: [seed] }))
  ];
  const imports = Array.from({ length: 4 }, (_, index) => `src/dep-${index}.js`);
  const graphRelations = {
    version: 1,
    callGraph: { nodeCount: callNodes.length, edgeCount: 65, nodes: callNodes },
    usageGraph: { nodeCount: usageNodes.length, edgeCount: 16, nodes: usageNodes },
    importGraph: { nodeCount: 5, edgeCount: 4, nodes: [
      { id: 'src/seed.js', file: 'src/seed.js', out: imports, in: [] },
      ...imports.map((id) => ({ id, file: id, out: [], in: ['src/seed.js'] }))
    ] }
  };
  const symbolEdges = [0, 1].map((index) => ({
    type: 'call', from: { chunkUid: seed }, to: { status: 'ambiguous', candidates: [0, 1, 2, 3].map((id) => ({ symbolId: `sym-${index}-${id}` })) }
  }));
  const graphIndex = buildGraphIndex({ graphRelations, symbolEdges, includeCsr: csr });
  let evidenceLookups = 0;
  graphIndex.callSiteIndex = { get(key) { evidenceLookups += 1; return [`site:${key}`]; } };
  return {
    request: { seed: { type: 'chunk', chunkUid: seed }, graphIndex, symbolEdges, direction,
      depth: 1, includePaths: true, caps: { maxFanoutPerNode: cap, maxCandidates: 2 } },
    getEvidenceLookups: () => evidenceLookups
  };
};

export const projectFanoutResult = (result) => {
  const { stats, ...semantic } = result;
  return { ...semantic, counts: stats.counts, capsTriggered: { ...stats.capsTriggered }, artifactsUsed: stats.artifactsUsed };
};
