import {
  buildCallSiteIndex,
  buildChunkInfo,
  buildGraphNodeIndex,
  buildImportGraphIndex,
  buildSymbolEdgesIndex,
  normalizeFileRef,
  normalizeImportPath
} from './indexes.js';
import { normalizeCap, normalizeDepth } from '../shared/limits.js';
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

const normalizeEdgeFilter = (edgeFilters) => {
  const graphs = normalizeFilterList(edgeFilters?.graphs);
  const edgeTypes = normalizeFilterList(edgeFilters?.edgeTypes);
  const minConfidenceRaw = Number(edgeFilters?.minConfidence);
  const minConfidence = Number.isFinite(minConfidenceRaw) ? minConfidenceRaw : null;
  return {
    graphs: graphs.length ? new Set(graphs) : null,
    edgeTypes: edgeTypes.length ? new Set(edgeTypes.map((entry) => entry.toLowerCase())) : null,
    minConfidence
  };
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
  const truncation = createTruncationRecorder({ scope: 'graph' });
  const recordTruncation = (cap, detail) => truncation.record(cap, detail);
  const missingImportGraphRefs = new Set();
  let importGraphMisses = 0;
  const recordImportGraphMiss = (sourceId) => {
    if (!sourceId) return;
    if (missingImportGraphRefs.has(sourceId)) return;
    if (importGraphMisses >= 3) return;
    missingImportGraphRefs.add(sourceId);
    importGraphMisses += 1;
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

  const effectiveRepoRoot = graphIndex?.repoRoot ?? repoRoot;
  const callGraphIndex = graphIndex?.callGraphIndex ?? buildGraphIndex(graphRelations?.callGraph);
  const usageGraphIndex = graphIndex?.usageGraphIndex ?? buildGraphIndex(graphRelations?.usageGraph);
  const importGraphIndex = graphIndex?.importGraphIndex ?? buildImportGraphIndex(graphRelations?.importGraph, effectiveRepoRoot);
  const callGraphAdjacency = graphIndex?.callGraphAdjacency ?? null;
  const usageGraphAdjacency = graphIndex?.usageGraphAdjacency ?? null;
  const importGraphAdjacency = graphIndex?.importGraphAdjacency ?? null;
  const chunkInfo = graphIndex?.chunkInfo ?? buildChunkInfo(callGraphIndex, usageGraphIndex);
  const symbolIndex = graphIndex?.symbolIndex ?? buildSymbolEdgesIndex(symbolEdges);
  const callSiteIndex = graphIndex?.callSiteIndex ?? buildCallSiteIndex(callSites);
  const normalizeImport = graphIndex?.normalizeImportPath
    ? (value) => graphIndex.normalizeImportPath(value)
    : (value) => normalizeImportPath(value, effectiveRepoRoot);
  const normalizeImportId = (value) => normalizeImport(value);

  const hasGraphRelations = Boolean(graphIndex?.graphRelations ?? graphRelations ?? graphIndex?.graphRelationsCsr);
  const hasSymbolEdges = graphIndex?.symbolIndex
    ? graphIndex.symbolIndex.byChunk.size > 0
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

  const nodeMap = new Map();
  const edgeSet = new Set();
  const edges = [];
  const paths = [];
  const pathTargets = [];
  const pathTargetSet = new Set();
  const parentMap = new Map();
  const queue = [];
  const edgeCandidates = [];

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
    const key = graphIndex
      ? edgeKeyFromIndex(edge, graphIndex)
      : edgeKey(edge);
    if (!key) return false;
    if (edgeSet.has(key)) return false;
    if (normalizedCaps.maxEdges != null && edges.length >= normalizedCaps.maxEdges) {
      recordTruncation('maxEdges', {
        limit: normalizedCaps.maxEdges,
        observed: edges.length,
        omitted: 1
      });
      return false;
    }
    edgeSet.add(key);
    edges.push(edge);
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

  const includeGraph = (graphName) => allowEdge({ graph: graphName, edgeType: null, confidence: null });

  const resolveGraphNeighbors = (
    graphNodes,
    nodeId,
    dir,
    normalizeNeighborId = null,
    adjacencyIndex = null
  ) => {
    if (adjacencyIndex && adjacencyIndex.has(nodeId)) {
      const entry = adjacencyIndex.get(nodeId);
      if (!entry) return [];
      if (dir === 'out') return entry.out || [];
      if (dir === 'in') return entry.in || [];
      return entry.both || [];
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

  const resolveImportSourceId = (ref) => {
    if (ref.type === 'file') return normalizeImport(ref.path);
    if (ref.type === 'chunk') {
      const meta = chunkInfo.get(ref.chunkUid);
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

    if (includeGraph('callGraph') && currentRef.type === GRAPH_NODE_TYPES.callGraph && callGraphIndex.size) {
      const neighbors = resolveGraphNeighbors(
        callGraphIndex,
        currentRef.chunkUid,
        normalizedDirection,
        null,
        callGraphAdjacency
      );
      for (const neighborId of neighbors) {
        const edgeType = GRAPH_EDGE_TYPES.callGraph;
        if (!allowEdge({ graph: 'callGraph', edgeType, confidence: null })) continue;
        const toRef = { type: 'chunk', chunkUid: neighborId };
        const fromRef = { type: 'chunk', chunkUid: currentRef.chunkUid };
        const evidence = formatEvidence(edgeType, fromRef, toRef, callSiteIndex);
        edgeCandidates.push({
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
        usageGraphAdjacency
      );
      for (const neighborId of neighbors) {
        const edgeType = GRAPH_EDGE_TYPES.usageGraph;
        if (!allowEdge({ graph: 'usageGraph', edgeType, confidence: null })) continue;
        const toRef = { type: 'chunk', chunkUid: neighborId };
        edgeCandidates.push({
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
          importGraphAdjacency
        );
        for (const neighborId of neighbors) {
          const edgeType = GRAPH_EDGE_TYPES.importGraph;
          if (!allowEdge({ graph: 'importGraph', edgeType, confidence: null })) continue;
          const toRef = { type: 'file', path: neighborId };
          edgeCandidates.push({
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
        edgeCandidates.push({
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
  edges.sort(compareGraphEdges);
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

  return {
    nodes,
    edges,
    paths: includePaths ? paths : null,
    truncation: truncationList.length ? truncationList : null,
    warnings: warningList.length ? warningList : null,
    stats: {
      sorted: true,
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
      counts: {
        nodesReturned: nodes.length,
        edgesReturned: edges.length,
        pathsReturned: includePaths ? paths.length : 0,
        workUnitsUsed: budget.getUsed()
      }
    }
  };
};
