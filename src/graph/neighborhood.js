import {
  buildCallSiteIndex,
  buildChunkInfo,
  buildGraphNodeIndex,
  buildImportGraphIndex,
  buildReverseAdjacencyCsr,
  buildSymbolEdgesIndex,
  normalizeFileRef,
  normalizeImportPath
} from './indexes.js';
import { normalizeCap, normalizeDepth } from '../shared/limits.js';
import { buildLocalCacheKey } from '../shared/cache-key.js';
import { compareStrings } from '../shared/sort.js';
import { createTruncationRecorder } from '../shared/truncation.js';
import {
  compareGraphEdges,
  compareGraphNodes,
  compareWitnessPaths,
  edgeKey,
  nodeKey
} from './ordering.js';
import { createWorkBudget } from './work-budget.js';

const GRAPH_EDGE_TYPES = {
  callGraph: 'call',
  usageGraph: 'usage',
  importGraph: 'import'
};

const GRAPH_NODE_TYPES = {
  callGraph: 'chunk',
  usageGraph: 'chunk',
  importGraph: 'file'
};

const GRAPH_NAMES = new Set(['callGraph', 'usageGraph', 'importGraph', 'symbolEdges']);
const EDGE_TYPE_ALIASES = new Map([
  ['calls', 'call'],
  ['call', 'call'],
  ['imports', 'import'],
  ['import', 'import'],
  ['usages', 'usage'],
  ['usage', 'usage'],
  ['exports', 'export'],
  ['export', 'export'],
  ['dataflow', 'dataflow'],
  ['symbols', 'symbol'],
  ['symbol', 'symbol']
]);
const KNOWN_EDGE_TYPES = new Set(['call', 'usage', 'import', 'export', 'dataflow', 'symbol']);

const TRAVERSAL_CACHE_MAX = 32;

const getCachedValue = (cache, key) => {
  if (!cache || !key) return null;
  if (!cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
};

const setCachedValue = (cache, key, value, maxSize) => {
  if (!cache || !key) return;
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  let evictions = 0;
  while (cache.size > maxSize) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
    evictions += 1;
  }
  return evictions;
};

const normalizeCaps = (caps) => ({
  maxDepth: normalizeCap(caps?.maxDepth),
  maxFanoutPerNode: normalizeCap(caps?.maxFanoutPerNode),
  maxNodes: normalizeCap(caps?.maxNodes),
  maxEdges: normalizeCap(caps?.maxEdges),
  maxPaths: normalizeCap(caps?.maxPaths),
  maxCandidates: normalizeCap(caps?.maxCandidates),
  maxWorkUnits: normalizeCap(caps?.maxWorkUnits),
  maxWallClockMs: normalizeCap(caps?.maxWallClockMs)
});

const normalizeDirection = (value) => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'in' || raw === 'out' || raw === 'both') return raw;
  return 'both';
};

const normalizeFilterList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((entry) => String(entry)).filter(Boolean);
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const normalizeEdgeType = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  return EDGE_TYPE_ALIASES.get(raw) || raw;
};

const normalizeEdgeFilter = (edgeFilters) => {
  const graphs = normalizeFilterList(edgeFilters?.graphs);
  const edgeTypesRaw = normalizeFilterList(edgeFilters?.edgeTypes);
  const edgeTypes = [];
  const unknownGraphs = [];
  const unknownEdgeTypes = [];
  for (const entry of graphs) {
    if (!GRAPH_NAMES.has(entry)) unknownGraphs.push(entry);
  }
  for (const entry of edgeTypesRaw) {
    const normalized = normalizeEdgeType(entry);
    if (!normalized || !KNOWN_EDGE_TYPES.has(normalized)) {
      unknownEdgeTypes.push(entry);
      continue;
    }
    edgeTypes.push(normalized);
  }
  const minConfidenceRaw = Number(edgeFilters?.minConfidence);
  const minConfidence = Number.isFinite(minConfidenceRaw) ? minConfidenceRaw : null;
  return {
    graphs: graphs.length ? new Set(graphs) : null,
    edgeTypes: edgeTypes.length ? new Set(edgeTypes) : null,
    minConfidence,
    unknownGraphs,
    unknownEdgeTypes,
    normalizedEdgeTypes: edgeTypes
  };
};

const isEdgeBetter = (candidate, current) => {
  if (!current) return true;
  const candConf = Number.isFinite(candidate?.confidence) ? candidate.confidence : null;
  const currConf = Number.isFinite(current?.confidence) ? current.confidence : null;
  if (candConf != null && currConf != null && candConf !== currConf) {
    return candConf > currConf;
  }
  if (candConf != null && currConf == null) return true;
  if (candConf == null && currConf != null) return false;
  const candEvidence = candidate?.evidence && Object.keys(candidate.evidence).length > 0;
  const currEvidence = current?.evidence && Object.keys(current.evidence).length > 0;
  if (candEvidence !== currEvidence) return candEvidence;
  return false;
};

const dedupeSortedEdges = (sortedEdges) => {
  if (!Array.isArray(sortedEdges) || sortedEdges.length <= 1) return sortedEdges || [];
  const deduped = [];
  let lastKey = null;
  let best = null;
  for (const edge of sortedEdges) {
    const key = edgeKey(edge);
    if (key !== lastKey) {
      if (best) deduped.push(best);
      best = edge;
      lastKey = key;
      continue;
    }
    if (isEdgeBetter(edge, best)) best = edge;
  }
  if (best) deduped.push(best);
  return deduped;
};

const validateGraphCounts = (graphRelations, warnings) => {
  if (!graphRelations || typeof graphRelations !== 'object') return;
  for (const graphName of ['callGraph', 'usageGraph', 'importGraph']) {
    const graph = graphRelations[graphName];
    if (!graph || typeof graph !== 'object') continue;
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const invalidNodes = [];
    if (Number.isFinite(graph.nodeCount) && graph.nodeCount !== nodes.length) {
      warnings.push({
        code: 'GRAPH_COUNT_MISMATCH',
        message: `${graphName} nodeCount does not match node list length.`,
        data: { graph: graphName, expected: graph.nodeCount, actual: nodes.length }
      });
    }
    if (Number.isFinite(graph.edgeCount)) {
      let actualEdges = 0;
      for (const node of nodes) {
        if (!node || typeof node.id !== 'string' || !Array.isArray(node.out) || !Array.isArray(node.in)) {
          if (invalidNodes.length < 3) {
            invalidNodes.push({ id: node?.id ?? null });
          }
        }
        const out = Array.isArray(node?.out) ? node.out.length : 0;
        actualEdges += out;
      }
      if (graph.edgeCount !== actualEdges) {
        warnings.push({
          code: 'GRAPH_COUNT_MISMATCH',
          message: `${graphName} edgeCount does not match out-edge totals.`,
          data: { graph: graphName, expected: graph.edgeCount, actual: actualEdges }
        });
      }
    }
    if (invalidNodes.length) {
      warnings.push({
        code: 'GRAPH_NODE_INVALID',
        message: `${graphName} nodes missing required id/out/in fields.`,
        data: { graph: graphName, samples: invalidNodes }
      });
    }
  }
};


const createEdgeFilterPredicate = ({ graphFilter, edgeTypeFilter, minConfidence }) => (
  ({ graph, edgeType, confidence }) => {
    if (graphFilter && !graphFilter.has(graph)) return false;
    if (edgeTypeFilter && !edgeTypeFilter.has(String(edgeType || '').toLowerCase())) return false;
    if (minConfidence != null && confidence != null && confidence < minConfidence) return false;
    return true;
  }
);

const buildGraphIndex = buildGraphNodeIndex;

const resolveSeedNodeRef = (seed) => {
  if (!seed || typeof seed !== 'object') return null;
  if (seed.type && typeof seed.type === 'string') return seed;
  const status = seed.status;
  if (status && seed.resolved && typeof seed.resolved === 'object') {
    const resolved = seed.resolved;
    if (resolved.chunkUid) return { type: 'chunk', chunkUid: resolved.chunkUid };
    if (resolved.symbolId) return { type: 'symbol', symbolId: resolved.symbolId };
    if (resolved.path) return { type: 'file', path: resolved.path };
  }
  const candidates = Array.isArray(seed.candidates) ? seed.candidates : [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    if (candidate.chunkUid) return { type: 'chunk', chunkUid: candidate.chunkUid };
    if (candidate.symbolId) return { type: 'symbol', symbolId: candidate.symbolId };
    if (candidate.path) return { type: 'file', path: candidate.path };
  }
  return null;
};

const applyCandidateCap = (ref, maxCandidates, recordTruncation) => {
  if (!ref || typeof ref !== 'object') return ref;
  if (!Number.isFinite(maxCandidates) || maxCandidates == null) return ref;
  if (!Array.isArray(ref.candidates) || ref.candidates.length <= maxCandidates) return ref;
  recordTruncation('maxCandidates', {
    limit: maxCandidates,
    observed: ref.candidates.length,
    omitted: ref.candidates.length - maxCandidates
  });
  return {
    ...ref,
    candidates: ref.candidates.slice(0, maxCandidates)
  };
};

const resolveNodeMeta = (ref, chunkInfo, importGraphIndex, normalizeImport) => {
  if (!ref || typeof ref !== 'object') return {};
  if (ref.type === 'chunk') {
    const meta = chunkInfo.get(ref.chunkUid);
    return meta ? {
      file: meta.file ?? null,
      kind: meta.kind ?? null,
      name: meta.name ?? null,
      signature: meta.signature ?? null
    } : {};
  }
  if (ref.type === 'file') {
    const normalizedPath = normalizeImport(ref.path);
    const meta = normalizedPath ? importGraphIndex.get(normalizedPath) : null;
    const file = normalizeImport(meta?.file || ref.path) || ref.path;
    return { file };
  }
  if (ref.type === 'symbol') {
    return {
      name: ref.symbolId
    };
  }
  return {};
};

const formatEvidence = (edgeType, fromRef, toRef, callSiteIndex) => {
  if (edgeType !== 'call') return null;
  if (!fromRef || !toRef) return null;
  if (fromRef.type !== 'chunk' || toRef.type !== 'chunk') return null;
  const key = `${fromRef.chunkUid}|${toRef.chunkUid}`;
  const list = callSiteIndex.get(key);
  if (!list || !list.length) return null;
  const ids = list.slice(0, 25);
  return { callSiteIds: ids };
};

export const buildGraphNeighborhood = ({
  seed,
  seeds = null,
  graphRelations,
  symbolEdges,
  callSites,
  graphIndex = null,
  direction = 'both',
  depth = 1,
  edgeFilters = null,
  caps = null,
  includePaths = false,
  workBudget = null,
  repoRoot = null
} = {}) => {
  const timingStart = process.hrtime.bigint();
  const memoryStart = process.memoryUsage();
  const warnings = [];
  if (graphRelations) validateGraphCounts(graphRelations, warnings);
  const truncation = createTruncationRecorder({ scope: 'graph' });
  const capTriggerCounts = Object.create(null);
  const recordTruncation = (cap, detail) => {
    capTriggerCounts[cap] = (capTriggerCounts[cap] || 0) + 1;
    truncation.record(cap, detail);
  };
  const missingImportGraphRefs = new Set();
  let importGraphLookupMissesTotal = 0;
  let importGraphLookupMissesLogged = 0;
  const recordImportGraphMiss = (sourceId) => {
    if (!sourceId) return;
    importGraphLookupMissesTotal += 1;
    if (missingImportGraphRefs.has(sourceId)) return;
    missingImportGraphRefs.add(sourceId);
    if (importGraphLookupMissesLogged >= 3) return;
    importGraphLookupMissesLogged += 1;
    warnings.push({
      code: 'IMPORT_GRAPH_LOOKUP_MISS',
      message: 'Import graph lookup missed for a normalized path; import expansion may be incomplete.',
      data: { path: sourceId }
    });
  };

  const normalizedCaps = normalizeCaps(caps);
  const requestedDepth = normalizeDepth(depth, 1);
  const maxDepthCap = normalizedCaps.maxDepth;
  const effectiveDepth = maxDepthCap == null
    ? requestedDepth
    : Math.min(requestedDepth, maxDepthCap);
  if (maxDepthCap != null && requestedDepth > maxDepthCap) {
    recordTruncation('maxDepth', {
      limit: maxDepthCap,
      observed: requestedDepth
    });
  }

  const filter = normalizeEdgeFilter(edgeFilters);
  const graphFilter = filter.graphs;
  const edgeTypeFilter = filter.edgeTypes;
  const minConfidence = filter.minConfidence;
  const allowEdge = createEdgeFilterPredicate({ graphFilter, edgeTypeFilter, minConfidence });

  if (filter.unknownGraphs.length) {
    warnings.push({
      code: 'UNKNOWN_GRAPH_FILTER',
      message: 'Unknown graph filters supplied; they will be ignored.',
      data: { graphs: filter.unknownGraphs }
    });
  }
  if (filter.unknownEdgeTypes.length) {
    warnings.push({
      code: 'UNKNOWN_EDGE_TYPE_FILTER',
      message: 'Unknown edge type filters supplied; they will be ignored.',
      data: { edgeTypes: filter.unknownEdgeTypes }
    });
  }

  const graphIndexMismatch = Boolean(
    graphIndex && graphRelations && graphIndex.graphRelations && graphIndex.graphRelations !== graphRelations
  );
  if (graphIndexMismatch) {
    warnings.push({
      code: 'GRAPH_INDEX_MISMATCH',
      message: 'Graph index does not match provided graph relations; rebuilding indexes from relations.'
    });
  }
  const graphIndexEffective = graphIndexMismatch ? null : graphIndex;
  if (graphIndexEffective?.repoRoot && repoRoot && graphIndexEffective.repoRoot !== repoRoot) {
    warnings.push({
      code: 'GRAPH_INDEX_REPOROOT_MISMATCH',
      message: 'Graph index repoRoot differs from request repoRoot; using graph index repoRoot for normalization.',
      data: { graphIndexRepoRoot: graphIndexEffective.repoRoot, repoRoot }
    });
  }

  const effectiveRepoRoot = graphIndexEffective?.repoRoot ?? repoRoot;
  const callGraphIndex = graphIndexEffective?.callGraphIndex ?? buildGraphIndex(graphRelations?.callGraph);
  const usageGraphIndex = graphIndexEffective?.usageGraphIndex ?? buildGraphIndex(graphRelations?.usageGraph);
  const importGraphIndex = graphIndexEffective?.importGraphIndex
    ?? buildImportGraphIndex(graphRelations?.importGraph, effectiveRepoRoot);
  const callGraphAdjacency = graphIndexEffective?.callGraphAdjacency ?? null;
  const usageGraphAdjacency = graphIndexEffective?.usageGraphAdjacency ?? null;
  const importGraphAdjacency = graphIndexEffective?.importGraphAdjacency ?? null;
  const chunkInfo = graphIndexEffective?.chunkInfo ?? buildChunkInfo(callGraphIndex, usageGraphIndex);
  const symbolIndex = graphIndexEffective?.symbolIndex ?? buildSymbolEdgesIndex(symbolEdges);
  const callSiteIndex = graphIndexEffective?.callSiteIndex ?? buildCallSiteIndex(callSites);
  const normalizeImport = graphIndexEffective?.normalizeImportPath
    ? (value) => graphIndexEffective.normalizeImportPath(value)
    : (value) => normalizeImportPath(value, effectiveRepoRoot);
  const normalizeImportId = (value) => normalizeImport(value);

  const hasGraphRelations = Boolean(
    graphIndexEffective?.graphRelations ?? graphRelations ?? graphIndexEffective?.graphRelationsCsr
  );
  const hasSymbolEdges = graphIndexEffective?.symbolIndex
    ? graphIndexEffective.symbolIndex.byChunk.size > 0
    : (Array.isArray(symbolEdges) && symbolEdges.length > 0);
  if (!hasGraphRelations && (!graphFilter || graphFilter.has('callGraph')
    || graphFilter.has('usageGraph') || graphFilter.has('importGraph'))) {
    warnings.push({
      code: 'MISSING_GRAPH_RELATIONS',
      message: 'graph_relations artifact missing; graph expansion limited.'
    });
  }
  if (!hasSymbolEdges && graphFilter && graphFilter.has('symbolEdges')) {
    warnings.push({
      code: 'MISSING_SYMBOL_EDGES',
      message: 'symbol_edges artifact missing; symbol graph expansion disabled.'
    });
  }

  const resolvedSeeds = [];
  const seedCandidates = Array.isArray(seeds) && seeds.length ? seeds : [seed];
  for (const entry of seedCandidates) {
    const resolved = resolveSeedNodeRef(entry);
    if (resolved) resolvedSeeds.push(resolved);
  }
  resolvedSeeds.sort((a, b) => compareStrings(nodeKey(a), nodeKey(b)));
  if (!resolvedSeeds.length) {
    warnings.push({
      code: 'UNRESOLVED_SEED',
      message: 'Seed could not be resolved to a graph node.'
    });
    return {
      nodes: [],
      edges: [],
      paths: includePaths ? [] : null,
      truncation: truncation.list.length ? truncation.list : null,
      warnings,
      stats: {
        artifactsUsed: {
          graphRelations: hasGraphRelations,
          symbolEdges: hasSymbolEdges,
          callSites: Array.isArray(callSites) && callSites.length > 0
        },
        counts: {
          nodesReturned: 0,
          edgesReturned: 0,
          pathsReturned: 0,
          workUnitsUsed: 0
        }
      }
    };
  }

  const normalizedDirection = normalizeDirection(direction);
  const budget = workBudget || createWorkBudget({
    maxWorkUnits: normalizedCaps.maxWorkUnits,
    maxWallClockMs: normalizedCaps.maxWallClockMs
  });

  const traversalCacheEnabled = Boolean(graphIndexEffective && workBudget == null);
  const cacheKeyInfo = traversalCacheEnabled
    ? buildLocalCacheKey({
      namespace: 'graph-neighborhood',
      payload: {
        indexSignature: graphIndexEffective.indexSignature || null,
        repoRoot: effectiveRepoRoot || null,
        seeds: resolvedSeeds.map((entry) => nodeKey(entry)).filter(Boolean),
        direction: normalizedDirection,
        depth: requestedDepth,
        effectiveDepth,
        includePaths: Boolean(includePaths),
        edgeFilters: {
          graphs: graphFilter ? Array.from(graphFilter).sort(compareStrings) : null,
          edgeTypes: edgeTypeFilter ? Array.from(edgeTypeFilter).sort(compareStrings) : null,
          minConfidence,
          unknownGraphs: filter.unknownGraphs,
          unknownEdgeTypes: filter.unknownEdgeTypes
        },
        caps: normalizedCaps
      }
    })
    : null;
  const traversalCache = traversalCacheEnabled
    ? (graphIndexEffective._traversalCache || (graphIndexEffective._traversalCache = new Map()))
    : null;
  const traversalTelemetry = traversalCacheEnabled
    ? (graphIndexEffective._traversalTelemetry || (graphIndexEffective._traversalTelemetry = { hits: 0, misses: 0, evictions: 0 }))
    : null;
  const cacheState = traversalCacheEnabled
    ? { enabled: true, hit: false, key: cacheKeyInfo.key }
    : { enabled: false, hit: false, key: null };
  if (traversalCacheEnabled) {
    const cached = getCachedValue(traversalCache, cacheKeyInfo.key);
    if (cached) {
      traversalTelemetry.hits += 1;
      const elapsedMs = Number((process.hrtime.bigint() - timingStart) / 1000000n);
      const cachedStats = cached?.stats && typeof cached.stats === 'object' ? cached.stats : {};
      const cachedCounts = cachedStats.counts && typeof cachedStats.counts === 'object'
        ? cachedStats.counts
        : {};
      return {
        ...cached,
        stats: {
          ...cachedStats,
          cache: { ...cachedStats.cache, ...cacheState, hit: true },
          timing: { elapsedMs },
          counts: {
            ...cachedCounts,
            workUnitsUsed: 0
          }
        }
      };
    }
    traversalTelemetry.misses += 1;
  }

  const nodeMap = new Map();
  const edgeByKey = new Map();
  const edges = [];
  // Windowed spill/merge keeps large edge sets deterministic without holding all edges in one buffer.
  const edgeWindows = [];
  const paths = [];
  const pathTargets = [];
  const pathTargetSet = new Set();
  const parentMap = new Map();
  const queue = [];
  const edgeCandidates = [];
  const edgeBatches = {
    callGraph: [],
    usageGraph: [],
    importGraph: [],
    symbolEdges: []
  };
  const EDGE_WINDOW_SIZE = 20000;

  const addNode = (ref, distance) => {
    const normalizedRef = normalizeFileRef(ref, effectiveRepoRoot);
    const key = nodeKey(normalizedRef);
    if (!key) return false;
    if (nodeMap.has(key)) return false;
    if (normalizedCaps.maxNodes != null && nodeMap.size >= normalizedCaps.maxNodes) {
      recordTruncation('maxNodes', {
        limit: normalizedCaps.maxNodes,
        observed: nodeMap.size,
        omitted: 1,
        at: { node: key }
      });
      return false;
    }
    const meta = resolveNodeMeta(normalizedRef, chunkInfo, importGraphIndex, normalizeImport);
    nodeMap.set(key, {
      ref: normalizedRef,
      distance,
      label: meta.name || meta.file || null,
      file: meta.file ?? null,
      kind: meta.kind ?? null,
      name: meta.name ?? null,
      signature: meta.signature ?? null,
      confidence: null
    });
    if (distance < effectiveDepth) {
      queue.push({ ref: normalizedRef, distance });
    }
    return true;
  };

  const addEdge = (edge) => {
    const key = graphIndexEffective
      ? edgeKeyFromIndex(edge, graphIndexEffective)
      : edgeKey(edge);
    if (!key) return false;
    if (!edgeByKey.has(key) && normalizedCaps.maxEdges != null && edgeByKey.size >= normalizedCaps.maxEdges) {
      recordTruncation('maxEdges', {
        limit: normalizedCaps.maxEdges,
        observed: edgeByKey.size,
        omitted: 1
      });
      return false;
    }
    const existing = edgeByKey.get(key);
    if (!existing || isEdgeBetter(edge, existing)) {
      edgeByKey.set(key, edge);
    }
    edges.push(edge);
    if (normalizedCaps.maxEdges == null && edges.length >= EDGE_WINDOW_SIZE) {
      edges.sort(compareGraphEdges);
      edgeWindows.push(edges.splice(0, edges.length));
    }
    return true;
  };

  const buildPathForNode = (key) => {
    const nodes = [];
    const edgesOut = [];
    let cursor = key;
    let safety = 0;
    while (cursor && safety < 5000) {
      const node = nodeMap.get(cursor);
      if (node?.ref) nodes.push(node.ref);
      const parent = parentMap.get(cursor);
      if (parent?.edge) edgesOut.push(parent.edge);
      cursor = parent?.parentKey;
      safety += 1;
    }
    nodes.reverse();
    edgesOut.reverse();
    return {
      to: nodeMap.get(key)?.ref,
      distance: Math.max(0, nodes.length - 1),
      nodes,
      edges: edgesOut.length ? edgesOut : null
    };
  };

  for (const resolvedSeed of resolvedSeeds) {
    addNode(resolvedSeed, 0);
  }

  const includeGraph = (graphName) => {
    if (graphFilter && !graphFilter.has(graphName)) return false;
    return true;
  };
  const enabledGraphs = Array.from(GRAPH_NAMES).filter((entry) => includeGraph(entry));
  if (graphFilter && enabledGraphs.length === 0) {
    warnings.push({
      code: 'GRAPH_EXCLUDED_BY_FILTERS',
      message: 'Requested graphs were excluded by filters.'
    });
  }

  const ensureReverseCsr = (graphName) => {
    if (!graphIndexEffective?.graphRelationsCsr || !graphName) return null;
    const forward = graphIndexEffective.graphRelationsCsr[graphName];
    if (!forward || !(forward.offsets instanceof Uint32Array) || !(forward.edges instanceof Uint32Array)) return null;
    const cache = graphIndexEffective._csrReverse || (graphIndexEffective._csrReverse = {});
    if (cache[graphName]) return cache[graphName];
    const reverse = buildReverseAdjacencyCsr({ offsets: forward.offsets, edges: forward.edges });
    if (!reverse) return null;
    cache[graphName] = reverse;
    return reverse;
  };

  const mergeSortedUniqueStrings = (left, right) => {
    const out = [];
    let i = 0;
    let j = 0;
    let last = null;
    while (i < left.length || j < right.length) {
      const pickLeft = j >= right.length
        || (i < left.length && compareStrings(left[i], right[j]) <= 0);
      const value = pickLeft ? left[i++] : right[j++];
      if (!value || value === last) continue;
      out.push(value);
      last = value;
    }
    return out;
  };

  const collectCsrNeighborIds = ({ ids, offsets, edges, nodeIndex }) => {
    if (!Array.isArray(ids)) return [];
    if (!(offsets instanceof Uint32Array) || !(edges instanceof Uint32Array)) return [];
    if (!Number.isFinite(nodeIndex) || nodeIndex < 0 || nodeIndex + 1 >= offsets.length) return [];
    const start = offsets[nodeIndex];
    const end = offsets[nodeIndex + 1];
    if (end <= start) return [];
    const neighbors = [];
    let prev = null;
    for (let idx = start; idx < end; idx += 1) {
      const neighborIndex = edges[idx];
      if (prev != null && neighborIndex === prev) continue;
      prev = neighborIndex;
      const neighborId = ids[neighborIndex];
      if (neighborId) neighbors.push(neighborId);
    }
    return neighbors;
  };

  const resolveCsrNeighbors = (graphName, nodeId, dir, normalizeNeighborId = null) => {
    const csr = graphIndexEffective?.graphRelationsCsr;
    if (!csr || !graphName) return null;
    const graph = csr[graphName];
    if (!graph || !Array.isArray(graph.ids)) return null;
    const idTable = graphName === 'callGraph'
      ? graphIndexEffective.callGraphIds
      : graphName === 'usageGraph'
        ? graphIndexEffective.usageGraphIds
        : graphIndexEffective.importGraphIds;
    const nodeIndex = idTable?.idToIndex?.get(nodeId);
    if (nodeIndex == null) return [];
    if (dir === 'out') {
      const out = collectCsrNeighborIds({ ...graph, nodeIndex });
      if (!normalizeNeighborId) return out;
      const set = new Set();
      for (const entry of out) {
        const normalized = normalizeNeighborId(entry);
        if (normalized) set.add(normalized);
      }
      const list = Array.from(set);
      list.sort(compareStrings);
      return list;
    }
    if (dir === 'in') {
      const reverse = ensureReverseCsr(graphName);
      if (!reverse) return [];
      const incoming = collectCsrNeighborIds({
        ids: graph.ids,
        offsets: reverse.offsets,
        edges: reverse.edges,
        nodeIndex
      });
      if (!normalizeNeighborId) return incoming;
      const set = new Set();
      for (const entry of incoming) {
        const normalized = normalizeNeighborId(entry);
        if (normalized) set.add(normalized);
      }
      const list = Array.from(set);
      list.sort(compareStrings);
      return list;
    }
    const out = resolveCsrNeighbors(graphName, nodeId, 'out', normalizeNeighborId) || [];
    const incoming = resolveCsrNeighbors(graphName, nodeId, 'in', normalizeNeighborId) || [];
    if (!out.length) return incoming;
    if (!incoming.length) return out;
    return mergeSortedUniqueStrings(out, incoming);
  };

  const resolveGraphNeighbors = (
    graphNodes,
    nodeId,
    dir,
    normalizeNeighborId = null,
    adjacencyIndex = null,
    graphName = null
  ) => {
    const csrNeighbors = resolveCsrNeighbors(graphName, nodeId, dir, normalizeNeighborId);
    if (csrNeighbors) return csrNeighbors;
    if (adjacencyIndex && adjacencyIndex.has(nodeId)) {
      const entry = adjacencyIndex.get(nodeId);
      if (!entry) return [];
      if (dir === 'out') return entry.out || [];
      if (dir === 'in') return entry.in || [];
      if (entry.both) return entry.both;
      const out = Array.isArray(entry.out) ? entry.out : [];
      const incoming = Array.isArray(entry.in) ? entry.in : [];
      if (!out.length && !incoming.length) return [];
      const set = new Set();
      for (const neighbor of out) set.add(neighbor);
      for (const neighbor of incoming) set.add(neighbor);
      const list = Array.from(set);
      list.sort(compareStrings);
      return list;
    }
    const node = graphNodes.get(nodeId);
    if (!node) return [];
    const out = Array.isArray(node.out) ? node.out : [];
    const incoming = Array.isArray(node.in) ? node.in : [];
    let neighbors = [];
    if (dir === 'out') neighbors = out;
    else if (dir === 'in') neighbors = incoming;
    else neighbors = out.concat(incoming);
    const set = new Set();
    for (const neighbor of neighbors) {
      if (!neighbor) continue;
      const normalized = normalizeNeighborId ? normalizeNeighborId(neighbor) : neighbor;
      if (!normalized) continue;
      set.add(normalized);
    }
    const list = Array.from(set);
    list.sort(compareStrings);
    return list;
  };

  const resolveSymbolNeighbors = (ref, dir) => {
    if (!hasSymbolEdges) return [];
    if (ref.type === 'chunk') {
      if (dir === 'in') return [];
      return symbolIndex.byChunk.get(ref.chunkUid) || [];
    }
    if (ref.type === 'symbol') {
      if (dir === 'out') return [];
      return symbolIndex.bySymbol.get(ref.symbolId) || [];
    }
    return [];
  };

  const missingImportFiles = new Set();
  const resolveImportSourceId = (ref) => {
    if (ref.type === 'file') return normalizeImport(ref.path);
    if (ref.type === 'chunk') {
      const meta = chunkInfo.get(ref.chunkUid);
      if (!meta?.file) {
        if (!missingImportFiles.has(ref.chunkUid)) {
          missingImportFiles.add(ref.chunkUid);
          warnings.push({
            code: 'IMPORT_GRAPH_MISSING_FILE',
            message: 'Import graph expansion missing file mapping for chunk seed.',
            data: { chunkUid: ref.chunkUid }
          });
        }
      }
      return normalizeImport(meta?.file || null);
    }
    return null;
  };

  const edgeKeyFromIndex = (edge, index) => {
    if (!edge || typeof edge !== 'object' || !edge.graph) return edgeKey(edge);
    const graphName = edge.graph;
    if (graphName === 'callGraph') {
      const fromId = index.callGraphIds?.idToIndex?.get(edge.from?.chunkUid || '');
      const toId = index.callGraphIds?.idToIndex?.get(edge.to?.chunkUid || '');
      if (fromId != null && toId != null) {
        return `callGraph|${fromId}|${edge.edgeType || ''}|${toId}`;
      }
      return edgeKey(edge);
    }
    if (graphName === 'usageGraph') {
      const fromId = index.usageGraphIds?.idToIndex?.get(edge.from?.chunkUid || '');
      const toId = index.usageGraphIds?.idToIndex?.get(edge.to?.chunkUid || '');
      if (fromId != null && toId != null) {
        return `usageGraph|${fromId}|${edge.edgeType || ''}|${toId}`;
      }
      return edgeKey(edge);
    }
    if (graphName === 'importGraph') {
      const fromPath = normalizeImport(edge.from?.path) || edge.from?.path || '';
      const toPath = normalizeImport(edge.to?.path) || edge.to?.path || '';
      const fromId = index.importGraphIds?.idToIndex?.get(fromPath);
      const toId = index.importGraphIds?.idToIndex?.get(toPath);
      if (fromId != null && toId != null) {
        return `importGraph|${fromId}|${edge.edgeType || ''}|${toId}`;
      }
      return edgeKey(edge);
    }
    return edgeKey(edge);
  };

  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const current = queue[queueIndex];
    queueIndex += 1;
    if (!current) continue;
    if (current.distance >= effectiveDepth) continue;
    const currentRef = current.ref;
    edgeCandidates.length = 0;
    edgeBatches.callGraph.length = 0;
    edgeBatches.usageGraph.length = 0;
    edgeBatches.importGraph.length = 0;
    edgeBatches.symbolEdges.length = 0;

    if (includeGraph('callGraph') && currentRef.type === GRAPH_NODE_TYPES.callGraph && callGraphIndex.size) {
      const neighbors = resolveGraphNeighbors(
        callGraphIndex,
        currentRef.chunkUid,
        normalizedDirection,
        null,
        callGraphAdjacency,
        'callGraph'
      );
      for (const neighborId of neighbors) {
        const edgeType = GRAPH_EDGE_TYPES.callGraph;
        if (!allowEdge({ graph: 'callGraph', edgeType, confidence: null })) continue;
        const toRef = { type: 'chunk', chunkUid: neighborId };
        const fromRef = { type: 'chunk', chunkUid: currentRef.chunkUid };
        const evidence = formatEvidence(edgeType, fromRef, toRef, callSiteIndex);
        edgeBatches.callGraph.push({
          edge: {
            edgeType,
            graph: 'callGraph',
            from: fromRef,
            to: toRef,
            confidence: null,
            evidence
          },
          nextRef: toRef
        });
      }
    }

    if (includeGraph('usageGraph') && currentRef.type === GRAPH_NODE_TYPES.usageGraph && usageGraphIndex.size) {
      const neighbors = resolveGraphNeighbors(
        usageGraphIndex,
        currentRef.chunkUid,
        normalizedDirection,
        null,
        usageGraphAdjacency,
        'usageGraph'
      );
      for (const neighborId of neighbors) {
        const edgeType = GRAPH_EDGE_TYPES.usageGraph;
        if (!allowEdge({ graph: 'usageGraph', edgeType, confidence: null })) continue;
        const toRef = { type: 'chunk', chunkUid: neighborId };
        edgeBatches.usageGraph.push({
          edge: {
            edgeType,
            graph: 'usageGraph',
            from: { type: 'chunk', chunkUid: currentRef.chunkUid },
            to: toRef,
            confidence: null,
            evidence: null
          },
          nextRef: toRef
        });
      }
    }

    if (includeGraph('importGraph') && importGraphIndex.size) {
      const sourceId = resolveImportSourceId(currentRef);
      if (sourceId) {
        if (!importGraphIndex.has(sourceId)) {
          recordImportGraphMiss(sourceId);
        }
        const neighbors = resolveGraphNeighbors(
          importGraphIndex,
          sourceId,
          normalizedDirection,
          normalizeImportId,
          importGraphAdjacency,
          'importGraph'
        );
        for (const neighborId of neighbors) {
          const edgeType = GRAPH_EDGE_TYPES.importGraph;
          if (!allowEdge({ graph: 'importGraph', edgeType, confidence: null })) continue;
          const toRef = { type: 'file', path: neighborId };
          edgeBatches.importGraph.push({
            edge: {
              edgeType,
              graph: 'importGraph',
              from: currentRef.type === 'file'
                ? { type: 'file', path: sourceId }
                : { type: 'chunk', chunkUid: currentRef.chunkUid },
              to: toRef,
              confidence: null,
              evidence: null
            },
            nextRef: toRef
          });
        }
      }
    }

    if (includeGraph('symbolEdges') && hasSymbolEdges) {
      const symbolNeighbors = resolveSymbolNeighbors(currentRef, normalizedDirection);
      for (const entry of symbolNeighbors) {
        if (!entry?.edge || !entry?.toRef) continue;
        const edgeType = entry.edge.type || 'symbol';
        const confidence = Number.isFinite(entry.edge.confidence)
          ? entry.edge.confidence
          : null;
        if (!allowEdge({ graph: 'symbolEdges', edgeType, confidence })) continue;
        const fromRef = { type: 'chunk', chunkUid: entry.edge.from.chunkUid };
        const symbolId = entry.symbolId;
        const nextRef = symbolId ? { type: 'symbol', symbolId } : null;
        const cappedToRef = applyCandidateCap(
          entry.toRef,
          normalizedCaps.maxCandidates,
          recordTruncation
        );
        edgeBatches.symbolEdges.push({
          edge: {
            edgeType,
            graph: 'symbolEdges',
            from: fromRef,
            to: cappedToRef,
            confidence,
            evidence: entry.edge.reason ? { note: entry.edge.reason } : null
          },
          nextRef
        });
      }
    }
    for (const batch of [
      edgeBatches.callGraph,
      edgeBatches.usageGraph,
      edgeBatches.importGraph,
      edgeBatches.symbolEdges
    ]) {
      for (const candidate of batch) {
        edgeCandidates.push(candidate);
      }
    }

    if (normalizedCaps.maxFanoutPerNode != null && edgeCandidates.length > normalizedCaps.maxFanoutPerNode) {
      recordTruncation('maxFanoutPerNode', {
        limit: normalizedCaps.maxFanoutPerNode,
        observed: edgeCandidates.length,
        omitted: edgeCandidates.length - normalizedCaps.maxFanoutPerNode,
        at: { node: nodeKey(currentRef) }
      });
      edgeCandidates.splice(normalizedCaps.maxFanoutPerNode);
    }

    for (const candidate of edgeCandidates) {
      const edge = candidate.edge;
      const budgetState = budget.consume(1);
      if (budgetState.stop) {
        recordTruncation(budgetState.reason, {
          limit: budgetState.limit,
          observed: budgetState.reason === 'maxWallClockMs' ? budgetState.elapsedMs : budgetState.used
        });
        queue.length = queueIndex;
        break;
      }
      if (minConfidence != null && edge.confidence != null && edge.confidence < minConfidence) {
        continue;
      }
      const added = addEdge(edge);
      if (!added && normalizedCaps.maxEdges != null && edges.length >= normalizedCaps.maxEdges) {
        queue.length = queueIndex;
        break;
      }
      const nextRef = candidate.nextRef
        ? candidate.nextRef
        : (edge.to?.type ? edge.to : edge.to?.resolved || null);
      if (!nextRef || typeof nextRef !== 'object' || !nextRef.type) continue;
      const nextKey = nodeKey(nextRef);
      if (!nextKey) continue;
      if (!nodeMap.has(nextKey)) {
        const addedNode = addNode(nextRef, current.distance + 1);
        if (addedNode) {
          parentMap.set(nextKey, {
            parentKey: nodeKey(currentRef),
            edge: {
              from: edge.from?.type ? edge.from : edge.from?.resolved,
              to: edge.to?.type ? edge.to : edge.to?.resolved,
              edgeType: edge.edgeType
            }
          });
          if (includePaths && !pathTargetSet.has(nextKey)) {
            pathTargetSet.add(nextKey);
            pathTargets.push(nextKey);
          }
        }
      }
    }
  }

  const nodes = Array.from(nodeMap.values()).sort(compareGraphNodes);
  let mergedEdges = edges;
  if (edgeWindows.length) {
    edges.sort(compareGraphEdges);
    edgeWindows.push(edges.slice());
    const indices = new Array(edgeWindows.length).fill(0);
    const merged = [];
    while (true) {
      let bestEdge = null;
      let bestIndex = -1;
      for (let i = 0; i < edgeWindows.length; i += 1) {
        const idx = indices[i];
        const window = edgeWindows[i];
        if (!window || idx >= window.length) continue;
        const candidate = window[idx];
        if (!bestEdge || compareGraphEdges(candidate, bestEdge) < 0) {
          bestEdge = candidate;
          bestIndex = i;
        }
      }
      if (bestIndex === -1) break;
      merged.push(bestEdge);
      indices[bestIndex] += 1;
    }
    mergedEdges = merged;
  } else {
    mergedEdges.sort(compareGraphEdges);
  }
  mergedEdges = dedupeSortedEdges(mergedEdges);
  if (edgeTypeFilter && mergedEdges.length === 0 && enabledGraphs.length) {
    warnings.push({
      code: 'EDGE_TYPE_FILTER_NO_MATCH',
      message: 'Edge type filter excluded all edges.',
      data: { edgeTypes: Array.from(edgeTypeFilter) }
    });
  }
  if (includePaths) {
    let targets = pathTargets;
    if (normalizedCaps.maxPaths != null && targets.length > normalizedCaps.maxPaths) {
      recordTruncation('maxPaths', {
        limit: normalizedCaps.maxPaths,
        observed: targets.length,
        omitted: targets.length - normalizedCaps.maxPaths
      });
      targets = targets.slice(0, normalizedCaps.maxPaths);
    }
    for (const key of targets) {
      const path = buildPathForNode(key);
      if (path?.to) paths.push(path);
    }
    paths.sort(compareWitnessPaths);
  }

  const memoryEnd = process.memoryUsage();
  const snapshotMemory = (value) => ({
    heapUsed: value.heapUsed,
    rss: value.rss,
    external: value.external,
    arrayBuffers: value.arrayBuffers
  });
  const peakMemory = {
    heapUsed: Math.max(memoryStart.heapUsed, memoryEnd.heapUsed),
    rss: Math.max(memoryStart.rss, memoryEnd.rss),
    external: Math.max(memoryStart.external, memoryEnd.external),
    arrayBuffers: Math.max(memoryStart.arrayBuffers, memoryEnd.arrayBuffers)
  };
  const elapsedMs = Number((process.hrtime.bigint() - timingStart) / 1000000n);

  const truncationList = truncation.list.slice();
  truncationList.sort((a, b) => compareStrings(
    `${a?.scope || ''}:${a?.cap || ''}`,
    `${b?.scope || ''}:${b?.cap || ''}`
  ));
  const warningList = warnings.slice();
  warningList.sort((a, b) => compareStrings(
    `${a?.code || ''}:${a?.message || ''}`,
    `${b?.code || ''}:${b?.message || ''}`
  ));

  const output = {
    nodes,
    edges: mergedEdges,
    paths: includePaths ? paths : null,
    truncation: truncationList.length ? truncationList : null,
    warnings: warningList.length ? warningList : null,
    stats: {
      sorted: true,
      cache: cacheState,
      timing: { elapsedMs },
      memory: {
        start: snapshotMemory(memoryStart),
        end: snapshotMemory(memoryEnd),
        peak: peakMemory
      },
      artifactsUsed: {
        graphRelations: hasGraphRelations,
        symbolEdges: hasSymbolEdges,
        callSites: Array.isArray(callSites) && callSites.length > 0
      },
      capsTriggered: capTriggerCounts,
      importGraphLookupMisses: {
        total: importGraphLookupMissesTotal,
        unique: missingImportGraphRefs.size,
        logged: importGraphLookupMissesLogged
      },
      counts: {
        nodesReturned: nodes.length,
        edgesReturned: mergedEdges.length,
        pathsReturned: includePaths ? paths.length : 0,
        workUnitsUsed: budget.getUsed()
      }
    }
  };

  if (traversalCacheEnabled) {
    const evictions = setCachedValue(traversalCache, cacheKeyInfo.key, output, TRAVERSAL_CACHE_MAX) || 0;
    traversalTelemetry.evictions += evictions;
  }

  return output;
};
