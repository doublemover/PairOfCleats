import { resolveProvenance } from '../shared/provenance.js';
import { buildGraphNeighborhood } from './neighborhood.js';

const resolveCapsUsed = (caps) => {
  if (caps && typeof caps === 'object') return { graph: { ...caps } };
  return { graph: {} };
};

export const buildGraphContextPack = ({
  seed,
  graphRelations,
  symbolEdges = null,
  callSites = null,
  graphIndex = null,
  direction = 'both',
  depth = 1,
  edgeFilters = null,
  caps = {},
  includePaths = false,
  provenance = null,
  indexSignature = null,
  indexCompatKey = null,
  repo = null,
  indexDir = null,
  now = () => new Date().toISOString()
} = {}) => {
  const capsUsed = resolveCapsUsed(caps);
  const resolvedProvenance = resolveProvenance({
    provenance,
    indexSignature,
    indexCompatKey,
    capsUsed,
    repo,
    indexDir,
    now,
    label: 'GraphContextPack'
  });
  const neighborhood = buildGraphNeighborhood({
    seed,
    graphRelations,
    symbolEdges,
    callSites,
    graphIndex,
    direction,
    depth,
    edgeFilters,
    caps,
    includePaths
  });
  return {
    version: '1.0.0',
    seed,
    provenance: resolvedProvenance,
    nodes: neighborhood.nodes,
    edges: neighborhood.edges,
    paths: neighborhood.paths || null,
    truncation: neighborhood.truncation || null,
    warnings: neighborhood.warnings || null,
    stats: neighborhood.stats || null
  };
};

