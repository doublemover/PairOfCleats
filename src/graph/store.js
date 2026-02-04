import { MAX_JSON_BYTES } from '../shared/artifact-io/constants.js';
import { loadPiecesManifest, resolveArtifactPresence } from '../shared/artifact-io/manifest.js';
import { loadGraphRelations, loadJsonArrayArtifact } from '../shared/artifact-io/loaders.js';
import {
  buildCallSiteIndex,
  buildAdjacencyIndex,
  buildAdjacencyCsr,
  buildChunkInfo,
  buildIdTable,
  buildGraphNodeIndex,
  buildImportGraphIndex,
  buildSymbolEdgesIndex,
  buildPrefixTable,
  normalizeImportPath
} from './indexes.js';

const GRAPH_INDEX_CACHE_MAX = 3;
const graphIndexCache = new Map();
const GRAPH_ARTIFACT_CACHE_MAX = 2;
const graphArtifactCache = new Map();

const getCachedGraphIndex = (key) => {
  if (!key) return null;
  if (!graphIndexCache.has(key)) return null;
  const value = graphIndexCache.get(key);
  graphIndexCache.delete(key);
  graphIndexCache.set(key, value);
  return value;
};

const setCachedGraphIndex = (key, value) => {
  if (!key) return;
  if (graphIndexCache.has(key)) graphIndexCache.delete(key);
  graphIndexCache.set(key, value);
  while (graphIndexCache.size > GRAPH_INDEX_CACHE_MAX) {
    const oldest = graphIndexCache.keys().next().value;
    graphIndexCache.delete(oldest);
  }
};

const getCachedGraphArtifacts = (key) => {
  if (!key) return null;
  if (!graphArtifactCache.has(key)) return null;
  const value = graphArtifactCache.get(key);
  graphArtifactCache.delete(key);
  graphArtifactCache.set(key, value);
  return value;
};

const setCachedGraphArtifacts = (key, value) => {
  if (!key) return;
  if (graphArtifactCache.has(key)) graphArtifactCache.delete(key);
  graphArtifactCache.set(key, value);
  while (graphArtifactCache.size > GRAPH_ARTIFACT_CACHE_MAX) {
    const oldest = graphArtifactCache.keys().next().value;
    graphArtifactCache.delete(oldest);
  }
};

const normalizeGraphList = (graphs) => {
  if (!graphs) return null;
  if (graphs instanceof Set) return Array.from(graphs);
  if (Array.isArray(graphs)) return graphs;
  return [String(graphs)];
};

export const buildGraphIndexCacheKey = ({
  indexSignature,
  repoRoot = null,
  graphs = null,
  includeCsr = false
} = {}) => {
  if (!indexSignature) return null;
  const repoTag = repoRoot ? `|repo:${repoRoot}` : '';
  const graphList = normalizeGraphList(graphs);
  const graphTag = graphList?.length
    ? `|graphs:${graphList.map((entry) => String(entry)).sort().join(',')}`
    : '';
  const csrTag = includeCsr ? '|csr:1' : '';
  return `graph-index:${indexSignature}${repoTag}${graphTag}${csrTag}`;
};

export const buildGraphIndex = ({
  graphRelations,
  symbolEdges,
  callSites,
  repoRoot = null,
  includeCsr = false
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
  const callGraphAdjacency = buildAdjacencyIndex(graphRelations?.callGraph);
  const usageGraphAdjacency = buildAdjacencyIndex(graphRelations?.usageGraph);
  const importGraphAdjacency = buildAdjacencyIndex(graphRelations?.importGraph, {
    normalizeNeighborId: normalizeImportPathCached,
    normalizeNodeId: normalizeImportPathCached
  });
  const callGraphIds = buildIdTable(callGraphIndex);
  const usageGraphIds = buildIdTable(usageGraphIndex);
  const importGraphIds = buildIdTable(importGraphIndex);
  const importGraphPathTable = buildPrefixTable(importGraphIds.ids || []);
  importGraphIds.ids = null;
  const graphRelationsCsr = includeCsr
    ? {
      callGraph: buildAdjacencyCsr(callGraphAdjacency, callGraphIds),
      usageGraph: buildAdjacencyCsr(usageGraphAdjacency, usageGraphIds),
      importGraph: buildAdjacencyCsr(importGraphAdjacency, importGraphIds)
    }
    : null;
  if (includeCsr && graphRelations && typeof graphRelations === 'object') {
    for (const graphName of ['callGraph', 'usageGraph', 'importGraph']) {
      const graph = graphRelations[graphName];
      if (!graph || !Array.isArray(graph.nodes)) continue;
      graph.nodes = graph.nodes.map((node) => {
        if (!node || typeof node !== 'object') return node;
        return {
          id: node.id,
          file: node.file ?? null,
          kind: node.kind ?? null,
          name: node.name ?? null,
          signature: node.signature ?? null
        };
      });
    }
  }
  const chunkInfo = buildChunkInfo(callGraphIndex, usageGraphIndex);
  const symbolIndex = buildSymbolEdgesIndex(symbolEdges);
  const callSiteIndex = buildCallSiteIndex(callSites);
  return {
    repoRoot,
    normalizeImportPath: normalizeImportPathCached,
    graphRelations,
    graphRelationsCsr,
    callGraphIndex,
    usageGraphIndex,
    importGraphIndex,
    callGraphAdjacency,
    usageGraphAdjacency,
    importGraphAdjacency,
    callGraphIds,
    usageGraphIds,
    importGraphIds,
    importGraphPathTable,
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

  const loadGraphIndex = async ({
    repoRoot = null,
    cacheKey = null,
    graphs = null,
    includeCsr = false
  } = {}) => {
    const cached = getCachedGraphIndex(cacheKey);
    if (cached) return cached;
    const graphList = normalizeGraphList(graphs);
    const graphSet = graphList?.length ? new Set(graphList) : null;
    const wantsGraphRelations = !graphSet
      || graphSet.has('callGraph')
      || graphSet.has('usageGraph')
      || graphSet.has('importGraph');
    const wantsSymbolEdges = !graphSet || graphSet.has('symbolEdges');
    const wantsCallSites = !graphSet || graphSet.has('callGraph');
    let cachedArtifacts = getCachedGraphArtifacts(cacheKey);
    if (!cachedArtifacts) {
      const [graphRelations, symbolEdges, callSites] = await Promise.all([
        wantsGraphRelations && hasArtifact('graph_relations') ? loadGraph() : null,
        wantsSymbolEdges && hasArtifact('symbol_edges') ? loadSymbolEdges() : null,
        wantsCallSites && hasArtifact('call_sites') ? loadCallSites() : null
      ]);
      cachedArtifacts = { graphRelations, symbolEdges, callSites };
      setCachedGraphArtifacts(cacheKey, cachedArtifacts);
    }
    const index = buildGraphIndex({
      graphRelations: cachedArtifacts.graphRelations,
      symbolEdges: cachedArtifacts.symbolEdges,
      callSites: cachedArtifacts.callSites,
      repoRoot,
      includeCsr
    });
    setCachedGraphIndex(cacheKey, index);
    return index;
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

