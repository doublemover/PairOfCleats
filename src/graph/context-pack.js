import { buildGraphNeighborhood } from './neighborhood.js';

const resolveCapsUsed = (caps) => {
  if (caps && typeof caps === 'object') return { graph: { ...caps } };
  return { graph: {} };
};

const resolveProvenance = ({
  provenance,
  indexSignature,
  indexCompatKey,
  capsUsed,
  repo,
  indexDir,
  now
}) => {
  const timestamp = typeof now === 'function' ? now() : new Date().toISOString();
  if (provenance && typeof provenance === 'object') {
    const merged = { ...provenance };
    if (!merged.generatedAt) merged.generatedAt = timestamp;
    if (!merged.capsUsed) merged.capsUsed = capsUsed || {};
    if (!merged.indexSignature && !merged.indexCompatKey) {
      throw new Error('Provenance must include indexSignature or indexCompatKey.');
    }
    return merged;
  }
  if (!indexSignature && !indexCompatKey) {
    throw new Error('GraphContextPack requires indexSignature or indexCompatKey.');
  }
  const base = {
    generatedAt: timestamp,
    capsUsed: capsUsed || {}
  };
  if (indexSignature) base.indexSignature = indexSignature;
  if (indexCompatKey) base.indexCompatKey = indexCompatKey;
  if (repo) base.repo = repo;
  if (indexDir) base.indexDir = indexDir;
  return base;
};

export const buildGraphContextPack = ({
  seed,
  graphRelations,
  symbolEdges = null,
  callSites = null,
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
    now
  });
  const neighborhood = buildGraphNeighborhood({
    seed,
    graphRelations,
    symbolEdges,
    callSites,
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

