import { MAX_JSON_BYTES } from '../shared/artifact-io/constants.js';
import { loadPiecesManifest, resolveArtifactPresence } from '../shared/artifact-io/manifest.js';
import { loadGraphRelations, loadJsonArrayArtifact } from '../shared/artifact-io/loaders.js';
import {
  buildCallSiteIndex,
  buildChunkInfo,
  buildIdTable,
  buildGraphNodeIndex,
  buildImportGraphIndex,
  buildSymbolEdgesIndex,
  normalizeImportPath
} from './indexes.js';

export const buildGraphIndex = ({
  graphRelations,
  symbolEdges,
  callSites,
  repoRoot = null
} = {}) => {
  const importPathCache = new Map();
  const normalizeImportPathCached = (value) => {
    if (!value) return null;
    const key = String(value);
    if (importPathCache.has(key)) return importPathCache.get(key);
    const normalized = normalizeImportPath(value, repoRoot);
    importPathCache.set(key, normalized);
    return normalized;
  };
  const callGraphIndex = buildGraphNodeIndex(graphRelations?.callGraph);
  const usageGraphIndex = buildGraphNodeIndex(graphRelations?.usageGraph);
  const importGraphIndex = buildImportGraphIndex(graphRelations?.importGraph, repoRoot);
  const callGraphIds = buildIdTable(callGraphIndex);
  const usageGraphIds = buildIdTable(usageGraphIndex);
  const importGraphIds = buildIdTable(importGraphIndex);
  const chunkInfo = buildChunkInfo(callGraphIndex, usageGraphIndex);
  const symbolIndex = buildSymbolEdgesIndex(symbolEdges);
  const callSiteIndex = buildCallSiteIndex(callSites);
  return {
    repoRoot,
    normalizeImportPath: normalizeImportPathCached,
    graphRelations,
    callGraphIndex,
    usageGraphIndex,
    importGraphIndex,
    callGraphIds,
    usageGraphIds,
    importGraphIds,
    chunkInfo,
    symbolIndex,
    callSiteIndex
  };
};

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
    const promise = Promise.resolve()
      .then(loader)
      .catch((err) => {
        artifactCache.delete(name);
        throw err;
      });
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

  const loadGraphIndex = async ({ repoRoot = null } = {}) => {
    const [graphRelations, symbolEdges, callSites] = await Promise.all([
      loadGraph(),
      loadSymbolEdges(),
      loadCallSites()
    ]);
    return buildGraphIndex({
      graphRelations,
      symbolEdges,
      callSites,
      repoRoot
    });
  };

  return {
    dir: indexDir,
    manifest: resolvedManifest,
    strict,
    resolvePresence,
    hasArtifact,
    loadGraph,
    loadSymbolEdges,
    loadCallSites,
    loadGraphIndex,
    getArtifactsUsed: () => Array.from(artifactsUsed)
  };
};

