import { MAX_JSON_BYTES } from '../shared/artifact-io/constants.js';
import { loadPiecesManifest, resolveArtifactPresence } from '../shared/artifact-io/manifest.js';
import { loadGraphRelations, loadGraphRelationsCsr, loadJsonArrayArtifactRows } from '../shared/artifact-io/loaders.js';
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
import { buildLocalCacheKey } from '../shared/cache-key.js';
import { compareStrings } from '../shared/sort.js';

const GRAPH_INDEX_CACHE_MAX = 3;
const graphIndexCache = new Map();
const GRAPH_ARTIFACT_CACHE_MAX = 2;
const graphArtifactCache = new Map();

const bumpTelemetry = (bucket, key, amount = 1) => {
  if (!bucket || typeof bucket !== 'object' || !key) return;
  const current = Number.isFinite(bucket[key]) ? bucket[key] : 0;
  bucket[key] = current + amount;
};

const getCachedGraphIndex = (key, telemetry = null) => {
  if (!key) return null;
  if (!graphIndexCache.has(key)) {
    bumpTelemetry(telemetry?.indexCache, 'misses', 1);
    return null;
  }
  const value = graphIndexCache.get(key);
  graphIndexCache.delete(key);
  graphIndexCache.set(key, value);
  bumpTelemetry(telemetry?.indexCache, 'hits', 1);
  return value;
};

const setCachedGraphIndex = (key, value, telemetry = null) => {
  if (!key) return;
  if (graphIndexCache.has(key)) graphIndexCache.delete(key);
  graphIndexCache.set(key, value);
  while (graphIndexCache.size > GRAPH_INDEX_CACHE_MAX) {
    const oldest = graphIndexCache.keys().next().value;
    graphIndexCache.delete(oldest);
    bumpTelemetry(telemetry?.indexCache, 'evictions', 1);
  }
};

const getCachedGraphArtifacts = (key, telemetry = null) => {
  if (!key) return null;
  if (!graphArtifactCache.has(key)) {
    bumpTelemetry(telemetry?.artifactCache, 'misses', 1);
    return null;
  }
  const value = graphArtifactCache.get(key);
  graphArtifactCache.delete(key);
  graphArtifactCache.set(key, value);
  bumpTelemetry(telemetry?.artifactCache, 'hits', 1);
  return value;
};

const setCachedGraphArtifacts = (key, value, telemetry = null) => {
  if (!key) return;
  if (graphArtifactCache.has(key)) graphArtifactCache.delete(key);
  graphArtifactCache.set(key, value);
  while (graphArtifactCache.size > GRAPH_ARTIFACT_CACHE_MAX) {
    const oldest = graphArtifactCache.keys().next().value;
    graphArtifactCache.delete(oldest);
    bumpTelemetry(telemetry?.artifactCache, 'evictions', 1);
  }
};

const normalizeGraphList = (graphs) => {
  if (!graphs) return null;
  if (graphs instanceof Set) return Array.from(graphs);
  if (Array.isArray(graphs)) return graphs;
  return [String(graphs)];
};

/**
 * Build a stable cache key for graph index reuse.
 * Includes index signature, repo root, graph selection, and CSR flag.
 */
export const buildGraphIndexCacheKey = ({
  indexSignature,
  repoRoot = null,
  graphs = null,
  includeCsr = false
} = {}) => {
  if (!indexSignature) return null;
  const graphList = normalizeGraphList(graphs);
  const normalizedGraphs = graphList?.length
    ? graphList.map((entry) => String(entry)).sort()
    : null;
  return buildLocalCacheKey({
    namespace: 'graph-index',
    payload: {
      indexSignature,
      repoRoot: repoRoot || null,
      graphs: normalizedGraphs,
      includeCsr: Boolean(includeCsr)
    }
  }).key;
};

/**
 * Build the in-memory GraphIndex with precomputed adjacency, IDs, and indexes.
 * This structure is intended to be cached and shared across graph requests.
 */
export const buildGraphIndex = ({
  graphRelations,
  graphRelationsCsr,
  symbolEdges,
  callSites,
  repoRoot = null,
  indexSignature = null,
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
  const toMetaGraph = (graph) => {
    if (!graph || typeof graph !== 'object') return graph;
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    return {
      ...graph,
      nodes: nodes.map((node) => {
        if (!node || typeof node !== 'object') return node;
        return {
          id: node.id,
          file: node.file ?? null,
          kind: node.kind ?? null,
          name: node.name ?? null,
          signature: node.signature ?? null
        };
      })
    };
  };

  const graphRelationsMeta = includeCsr && graphRelations && typeof graphRelations === 'object'
    ? {
      ...graphRelations,
      callGraph: toMetaGraph(graphRelations.callGraph),
      usageGraph: toMetaGraph(graphRelations.usageGraph),
      importGraph: toMetaGraph(graphRelations.importGraph)
    }
    : graphRelations;

  const callGraphIndex = buildGraphNodeIndex(graphRelationsMeta?.callGraph);
  const usageGraphIndex = buildGraphNodeIndex(graphRelationsMeta?.usageGraph);
  const importGraphIndex = buildImportGraphIndex(graphRelationsMeta?.importGraph, repoRoot);
  const callGraphAdjacency = buildAdjacencyIndex(graphRelations?.callGraph, { includeBoth: !includeCsr, includeIn: !includeCsr });
  const usageGraphAdjacency = buildAdjacencyIndex(graphRelations?.usageGraph, { includeBoth: !includeCsr, includeIn: !includeCsr });
  const importGraphAdjacency = buildAdjacencyIndex(graphRelations?.importGraph, {
    normalizeNeighborId: normalizeImportPathCached,
    normalizeNodeId: normalizeImportPathCached,
    includeBoth: !includeCsr,
    includeIn: !includeCsr
  });
  const callGraphIds = buildIdTable(callGraphIndex);
  const usageGraphIds = buildIdTable(usageGraphIndex);
  const importGraphIds = buildIdTable(importGraphIndex);
  const importGraphPathTable = buildPrefixTable(importGraphIds.ids || []);
  const resolvedCsr = includeCsr
    ? (graphRelationsCsr && typeof graphRelationsCsr === 'object'
      ? graphRelationsCsr
      : {
        version: Number.isFinite(graphRelations?.version) ? graphRelations.version : 1,
        generatedAt: typeof graphRelations?.generatedAt === 'string' ? graphRelations.generatedAt : null,
        callGraph: buildAdjacencyCsr(callGraphAdjacency, callGraphIds),
        usageGraph: buildAdjacencyCsr(usageGraphAdjacency, usageGraphIds),
        importGraph: buildAdjacencyCsr(importGraphAdjacency, importGraphIds)
      })
    : null;
  if (!includeCsr) {
    importGraphIds.ids = null;
  }
  const chunkInfo = buildChunkInfo(callGraphIndex, usageGraphIndex);
  const symbolIndex = buildSymbolEdgesIndex(symbolEdges);
  const callSiteIndex = buildCallSiteIndex(callSites);
  return {
    repoRoot,
    indexSignature: indexSignature || null,
    normalizeImportPath: normalizeImportPathCached,
    graphRelations: graphRelationsMeta,
    graphRelationsCsr: resolvedCsr,
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
  const telemetry = {
    indexCache: { hits: 0, misses: 0, evictions: 0, builds: 0 },
    artifactCache: { hits: 0, misses: 0, evictions: 0 },
    lastBuild: null
  };

  const estimateCsrBytes = (csr) => {
    if (!csr || typeof csr !== 'object') return 0;
    let total = 0;
    for (const graphName of ['callGraph', 'usageGraph', 'importGraph']) {
      const graph = csr[graphName];
      if (!graph || typeof graph !== 'object') continue;
      const offsets = graph.offsets;
      const edges = graph.edges;
      if (offsets && typeof offsets.byteLength === 'number') total += offsets.byteLength;
      if (edges && typeof edges.byteLength === 'number') total += edges.byteLength;
    }
    return total;
  };

  const resolveGraphIds = (graph) => {
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    const ids = [];
    for (const node of nodes) {
      if (!node || typeof node.id !== 'string' || !node.id) continue;
      ids.push(node.id);
    }
    return ids;
  };

  const sortedUnique = (ids) => {
    const ordered = ids.slice().sort(compareStrings);
    const out = [];
    let last = null;
    for (const id of ordered) {
      if (last === id) continue;
      out.push(id);
      last = id;
    }
    return out;
  };

  const validateCsrNodeOrdering = (csr, graphRelations) => {
    if (!csr || typeof csr !== 'object') return { ok: true };
    if (!graphRelations || typeof graphRelations !== 'object') return { ok: true };
    const csrGraphs = csr.graphs && typeof csr.graphs === 'object' ? csr.graphs : null;
    if (!csrGraphs) return { ok: false, reason: 'missing graphs' };
    for (const graphName of ['callGraph', 'usageGraph', 'importGraph']) {
      const csrGraph = csrGraphs[graphName];
      const nodes = Array.isArray(csrGraph?.nodes) ? csrGraph.nodes : [];
      const expectedRaw = resolveGraphIds(graphRelations?.[graphName]);
      const expected = sortedUnique(expectedRaw);
      if (nodes.length !== expected.length) return { ok: false, reason: `${graphName} nodeCount mismatch` };
      for (let i = 0; i < nodes.length; i += 1) {
        if (nodes[i] !== expected[i]) return { ok: false, reason: `${graphName} node ordering mismatch` };
      }
    }
    return { ok: true };
  };

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

  const loadGraphCsr = () => loadOnce('graph_relations_csr', () => loadGraphRelationsCsr(indexDir, {
    manifest: resolvedManifest,
    maxBytes,
    strict
  }));

  const loadSymbolEdges = () => loadOnce('symbol_edges', async () => {
    const rows = [];
    for await (const entry of loadJsonArrayArtifactRows(indexDir, 'symbol_edges', {
      manifest: resolvedManifest,
      maxBytes,
      strict,
      materialize: true
    })) {
      rows.push(entry);
    }
    return rows;
  });

  const loadCallSites = () => loadOnce('call_sites', async () => {
    const rows = [];
    for await (const entry of loadJsonArrayArtifactRows(indexDir, 'call_sites', {
      manifest: resolvedManifest,
      maxBytes,
      strict,
      materialize: true
    })) {
      rows.push(entry);
    }
    return rows;
  });

  const loadGraphIndex = async ({
    repoRoot = null,
    cacheKey = null,
    indexSignature = null,
    graphs = null,
    includeCsr = false
  } = {}) => {
    const cached = getCachedGraphIndex(cacheKey, telemetry);
    if (cached) return cached;
    const graphList = normalizeGraphList(graphs);
    const graphSet = graphList?.length ? new Set(graphList) : null;
    const wantsGraphRelations = !graphSet
      || graphSet.has('callGraph')
      || graphSet.has('usageGraph')
      || graphSet.has('importGraph');
    const wantsGraphCsr = includeCsr && wantsGraphRelations && hasArtifact('graph_relations_csr');
    const wantsSymbolEdges = !graphSet || graphSet.has('symbolEdges');
    const wantsCallSites = !graphSet || graphSet.has('callGraph');
    let cachedArtifacts = getCachedGraphArtifacts(cacheKey, telemetry);
    if (!cachedArtifacts) {
      const loadStartedAt = Date.now();
      const [graphRelations, csrPayload, symbolEdges, callSites] = await Promise.all([
        wantsGraphRelations && hasArtifact('graph_relations') ? loadGraph() : null,
        wantsGraphCsr ? loadGraphCsr().catch(() => null) : null,
        wantsSymbolEdges && hasArtifact('symbol_edges') ? loadSymbolEdges() : null,
        wantsCallSites && hasArtifact('call_sites') ? loadCallSites() : null
      ]);

      let graphRelationsCsr = csrPayload;
      let csrSource = graphRelationsCsr ? 'artifact' : null;
      if (includeCsr && graphRelationsCsr) {
        const validation = validateCsrNodeOrdering(graphRelationsCsr, graphRelations);
        if (!validation.ok) {
          graphRelationsCsr = null;
          csrSource = null;
        }
      }

      const normalizeGraphCsrForIndex = (csr) => {
        if (!csr || typeof csr !== 'object') return null;
        const graphsObj = csr.graphs && typeof csr.graphs === 'object' ? csr.graphs : null;
        if (!graphsObj) return null;
        const callGraph = graphsObj.callGraph;
        const usageGraph = graphsObj.usageGraph;
        const importGraph = graphsObj.importGraph;
        if (!callGraph || !usageGraph || !importGraph) return null;
        return {
          version: Number.isFinite(csr.version) ? csr.version : 1,
          generatedAt: typeof csr.generatedAt === 'string' ? csr.generatedAt : null,
          callGraph: { ids: callGraph.nodes || [], offsets: callGraph.offsets, edges: callGraph.edges },
          usageGraph: { ids: usageGraph.nodes || [], offsets: usageGraph.offsets, edges: usageGraph.edges },
          importGraph: { ids: importGraph.nodes || [], offsets: importGraph.offsets, edges: importGraph.edges }
        };
      };

      cachedArtifacts = {
        graphRelations,
        graphRelationsCsr: normalizeGraphCsrForIndex(graphRelationsCsr),
        csrSource,
        artifactLoadMs: Math.max(0, Date.now() - loadStartedAt),
        symbolEdges,
        callSites
      };
      setCachedGraphArtifacts(cacheKey, cachedArtifacts, telemetry);
    }
    bumpTelemetry(telemetry?.indexCache, 'builds', 1);
    const buildStartedAt = Date.now();
    const index = buildGraphIndex({
      graphRelations: cachedArtifacts.graphRelations,
      graphRelationsCsr: cachedArtifacts.graphRelationsCsr,
      symbolEdges: cachedArtifacts.symbolEdges,
      callSites: cachedArtifacts.callSites,
      repoRoot,
      indexSignature,
      includeCsr
    });
    const buildMs = Math.max(0, Date.now() - buildStartedAt);
    telemetry.lastBuild = {
      at: new Date().toISOString(),
      cacheKey: cacheKey || null,
      includeCsr: Boolean(includeCsr),
      csrSource: cachedArtifacts.csrSource || (index.graphRelationsCsr ? 'derived' : null),
      artifactLoadMs: cachedArtifacts.artifactLoadMs || 0,
      buildMs,
      csrBytes: estimateCsrBytes(index.graphRelationsCsr),
      graph: {
        callGraph: {
          nodeCount: cachedArtifacts.graphRelations?.callGraph?.nodeCount
            ?? cachedArtifacts.graphRelations?.callGraph?.nodes?.length
            ?? 0,
          edgeCount: cachedArtifacts.graphRelations?.callGraph?.edgeCount
            ?? null
        },
        usageGraph: {
          nodeCount: cachedArtifacts.graphRelations?.usageGraph?.nodeCount
            ?? cachedArtifacts.graphRelations?.usageGraph?.nodes?.length
            ?? 0,
          edgeCount: cachedArtifacts.graphRelations?.usageGraph?.edgeCount
            ?? null
        },
        importGraph: {
          nodeCount: cachedArtifacts.graphRelations?.importGraph?.nodeCount
            ?? cachedArtifacts.graphRelations?.importGraph?.nodes?.length
            ?? 0,
          edgeCount: cachedArtifacts.graphRelations?.importGraph?.edgeCount
            ?? null
        }
      },
      cache: {
        indexSize: graphIndexCache.size,
        artifactSize: graphArtifactCache.size
      }
    };
    setCachedGraphIndex(cacheKey, index, telemetry);
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
    getArtifactsUsed: () => Array.from(artifactsUsed),
    stats: () => ({
      cache: {
        index: { ...telemetry.indexCache, size: graphIndexCache.size, max: GRAPH_INDEX_CACHE_MAX },
        artifacts: { ...telemetry.artifactCache, size: graphArtifactCache.size, max: GRAPH_ARTIFACT_CACHE_MAX }
      },
      lastBuild: telemetry.lastBuild || null
    })
  };
};

