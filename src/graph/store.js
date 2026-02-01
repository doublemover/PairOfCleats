import { MAX_JSON_BYTES } from '../shared/artifact-io/constants.js';
import { loadPiecesManifest, resolveArtifactPresence } from '../shared/artifact-io/manifest.js';
import { loadGraphRelations, loadJsonArrayArtifact } from '../shared/artifact-io/loaders.js';

export const createGraphStore = ({
  indexDir,
  strict = true,
  maxBytes = MAX_JSON_BYTES,
  manifest = null
} = {}) => {
  if (!indexDir) {
    throw new Error('GraphStore requires indexDir');
  }
  const resolvedManifest = manifest || loadPiecesManifest(indexDir, { maxBytes, strict });
  const presenceCache = new Map();
  const artifactCache = new Map();
  const artifactsUsed = new Set();

  const resolvePresence = (name) => {
    if (presenceCache.has(name)) return presenceCache.get(name);
    const presence = resolveArtifactPresence(indexDir, name, {
      manifest: resolvedManifest,
      maxBytes,
      strict
    });
    presenceCache.set(name, presence);
    return presence;
  };

  const hasArtifact = (name) => {
    const presence = resolvePresence(name);
    return presence && presence.format !== 'missing' && !presence.error;
  };

  const loadOnce = async (name, loader) => {
    if (artifactCache.has(name)) return artifactCache.get(name);
    const promise = loader();
    artifactCache.set(name, promise);
    artifactsUsed.add(name);
    return promise;
  };

  const loadGraph = () => loadOnce('graph_relations', () => loadGraphRelations(indexDir, {
    manifest: resolvedManifest,
    maxBytes,
    strict
  }));

  const loadSymbolEdges = () => loadOnce('symbol_edges', () => loadJsonArrayArtifact(indexDir, 'symbol_edges', {
    manifest: resolvedManifest,
    maxBytes,
    strict
  }));

  const loadCallSites = () => loadOnce('call_sites', () => loadJsonArrayArtifact(indexDir, 'call_sites', {
    manifest: resolvedManifest,
    maxBytes,
    strict
  }));

  return {
    dir: indexDir,
    manifest: resolvedManifest,
    strict,
    resolvePresence,
    hasArtifact,
    loadGraph,
    loadSymbolEdges,
    loadCallSites,
    getArtifactsUsed: () => Array.from(artifactsUsed)
  };
};

