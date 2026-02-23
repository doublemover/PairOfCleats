import {
  buildCallSiteIndex,
  buildChunkInfo,
  buildGraphNodeIndex,
  buildImportGraphIndex,
  buildSymbolEdgesIndex,
  normalizeFileRef,
  normalizeImportPath
} from './indexes.js';
import { normalizeDepth } from '../shared/limits.js';
import { buildLocalCacheKey } from '../shared/cache-key.js';
import { compareStrings } from '../shared/sort.js';
import { createTruncationRecorder } from '../shared/truncation.js';
import {
  compareGraphEdges,
  compareGraphNodes,
  compareWitnessPaths,
  nodeKey
} from './ordering.js';
import { createWorkBudget } from './work-budget.js';
import { getCachedValue, setCachedValue } from './neighborhood/cache.js';
import { normalizeCaps, normalizeDirection, applyCandidateCap } from './neighborhood/caps.js';
import {
  GRAPH_EDGE_TYPES,
  GRAPH_NAMES,
  GRAPH_NODE_TYPES,
  createEdgeFilterPredicate,
  normalizeEdgeFilter
} from './neighborhood/filter.js';
import { dedupeSortedEdges, edgeKeyFromIndex, isEdgeBetter } from './neighborhood/edge-policy.js';
import { formatEvidence, resolveNodeMeta, resolveSeedNodeRef } from './neighborhood/seed-meta.js';
import { validateGraphCounts } from './neighborhood/validation.js';
import { createGraphNeighborResolver, resolveSymbolNeighbors } from './neighborhood/walker.js';

const TRAVERSAL_CACHE_MAX = 32;

const buildGraphIndex = buildGraphNodeIndex;

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
    const key = edgeKeyFromIndex(edge, graphIndexEffective, normalizeImport);
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
  const resolveGraphNeighbors = createGraphNeighborResolver({ graphIndex: graphIndexEffective });

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
      const symbolNeighbors = resolveSymbolNeighbors(
        hasSymbolEdges,
        symbolIndex,
        currentRef,
        normalizedDirection
      );
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
