import { compareStrings } from '../shared/sort.js';
import { compareGraphEdges, compareGraphNodes, compareWitnessPaths, edgeKey, nodeKey } from './ordering.js';
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

const normalizeCap = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor(parsed));
};

const normalizeDepth = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
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

const buildGraphIndex = (graph) => {
  const map = new Map();
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !node.id) continue;
    map.set(node.id, node);
  }
  return map;
};

const buildChunkInfo = (callGraphIndex, usageGraphIndex) => {
  const map = new Map();
  const ingest = (node) => {
    if (!node || typeof node.id !== 'string') return;
    if (!node.file && !node.name && !node.kind && !node.signature) return;
    if (!map.has(node.id)) map.set(node.id, node);
  };
  for (const node of callGraphIndex.values()) ingest(node);
  for (const node of usageGraphIndex.values()) ingest(node);
  return map;
};

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

const normalizeSymbolRef = (ref, maxCandidates, recordTruncation) => {
  if (!ref || typeof ref !== 'object') return null;
  const candidatesRaw = Array.isArray(ref.candidates) ? ref.candidates.slice() : [];
  const resolved = ref.resolved && typeof ref.resolved === 'object' ? ref.resolved : null;
  let candidates = candidatesRaw;
  const resolvedKey = resolved ? `${resolved.symbolId || ''}:${resolved.chunkUid || ''}:${resolved.path || ''}` : '';
  const hasResolved = resolved
    ? candidates.some((candidate) => (
      `${candidate.symbolId || ''}:${candidate.chunkUid || ''}:${candidate.path || ''}` === resolvedKey
    ))
    : true;
  if (resolved && !hasResolved) {
    candidates = [resolved, ...candidates];
  }
  if (maxCandidates != null && candidates.length > maxCandidates) {
    recordTruncation('maxCandidates', {
      limit: maxCandidates,
      observed: candidates.length,
      omitted: candidates.length - maxCandidates
    });
    candidates = candidates.slice(0, maxCandidates);
  }
  return {
    v: Number.isFinite(ref.v) ? ref.v : 1,
    status: ref.status || 'unresolved',
    targetName: ref.targetName ?? null,
    kindHint: ref.kindHint ?? null,
    importHint: ref.importHint ?? null,
    candidates,
    resolved: resolved || null,
    reason: ref.reason ?? null,
    confidence: Number.isFinite(ref.confidence) ? ref.confidence : null
  };
};

const resolveSymbolId = (ref) => {
  if (!ref || typeof ref !== 'object') return null;
  if (ref.resolved && ref.resolved.symbolId) return ref.resolved.symbolId;
  const candidates = Array.isArray(ref.candidates) ? ref.candidates : [];
  for (const candidate of candidates) {
    if (candidate?.symbolId) return candidate.symbolId;
  }
  return null;
};

const buildSymbolEdgesIndex = (symbolEdges, { maxCandidates, recordTruncation }) => {
  const byChunk = new Map();
  const bySymbol = new Map();
  const edges = Array.isArray(symbolEdges) ? symbolEdges : [];
  for (const edge of edges) {
    if (!edge?.from?.chunkUid || !edge?.to) continue;
    const normalized = normalizeSymbolRef(edge.to, maxCandidates, recordTruncation);
    if (!normalized) continue;
    const symbolId = resolveSymbolId(normalized);
    const entry = {
      edge,
      toRef: normalized,
      symbolId
    };
    const list = byChunk.get(edge.from.chunkUid) || [];
    list.push(entry);
    byChunk.set(edge.from.chunkUid, list);
    if (symbolId) {
      const symList = bySymbol.get(symbolId) || [];
      symList.push(entry);
      bySymbol.set(symbolId, symList);
    }
  }
  return { byChunk, bySymbol };
};

const buildCallSiteIndex = (callSites) => {
  const map = new Map();
  const entries = Array.isArray(callSites) ? callSites : [];
  for (const site of entries) {
    if (!site?.callerChunkUid || !site?.targetChunkUid || !site?.callSiteId) continue;
    const key = `${site.callerChunkUid}|${site.targetChunkUid}`;
    const list = map.get(key) || [];
    list.push(site.callSiteId);
    map.set(key, list);
  }
  return map;
};

const resolveNodeMeta = (ref, chunkInfo, importGraphIndex) => {
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
    const meta = importGraphIndex.get(ref.path);
    return meta ? { file: meta.file ?? ref.path } : { file: ref.path };
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
  graphRelations,
  symbolEdges,
  callSites,
  direction = 'both',
  depth = 1,
  edgeFilters = null,
  caps = null,
  includePaths = false,
  workBudget = null
} = {}) => {
  const warnings = [];
  const truncation = [];
  const truncationSeen = new Set();
  const recordTruncation = (cap, detail) => {
    if (truncationSeen.has(cap)) return;
    truncationSeen.add(cap);
    truncation.push({
      scope: 'graph',
      cap,
      ...detail
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

  const callGraphIndex = buildGraphIndex(graphRelations?.callGraph);
  const usageGraphIndex = buildGraphIndex(graphRelations?.usageGraph);
  const importGraphIndex = buildGraphIndex(graphRelations?.importGraph);
  const chunkInfo = buildChunkInfo(callGraphIndex, usageGraphIndex);
  const symbolIndex = buildSymbolEdgesIndex(symbolEdges, {
    maxCandidates: normalizedCaps.maxCandidates,
    recordTruncation
  });
  const callSiteIndex = buildCallSiteIndex(callSites);

  const hasGraphRelations = Boolean(graphRelations);
  const hasSymbolEdges = Array.isArray(symbolEdges) && symbolEdges.length > 0;
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

  const resolvedSeed = resolveSeedNodeRef(seed);
  if (!resolvedSeed) {
    warnings.push({
      code: 'UNRESOLVED_SEED',
      message: 'Seed could not be resolved to a graph node.'
    });
    return {
      nodes: [],
      edges: [],
      paths: includePaths ? [] : null,
      truncation: truncation.length ? truncation : null,
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
  const parentMap = new Map();
  const queue = [];

  const addNode = (ref, distance) => {
    const key = nodeKey(ref);
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
    const meta = resolveNodeMeta(ref, chunkInfo, importGraphIndex);
    nodeMap.set(key, {
      ref,
      distance,
      label: meta.name || meta.file || null,
      file: meta.file ?? null,
      kind: meta.kind ?? null,
      name: meta.name ?? null,
      signature: meta.signature ?? null,
      confidence: null
    });
    if (distance < effectiveDepth) {
      queue.push({ ref, distance });
    }
    return true;
  };

  const addEdge = (edge) => {
    const key = edgeKey(edge);
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

  addNode(resolvedSeed, 0);

  const includeGraph = (graphName) => {
    if (!graphFilter) return true;
    return graphFilter.has(graphName);
  };

  const includeEdgeType = (edgeType) => {
    if (!edgeTypeFilter) return true;
    return edgeTypeFilter.has(edgeType.toLowerCase());
  };

  const resolveGraphNeighbors = (graphIndex, nodeId, dir) => {
    const node = graphIndex.get(nodeId);
    if (!node) return [];
    const out = Array.isArray(node.out) ? node.out : [];
    const incoming = Array.isArray(node.in) ? node.in : [];
    let neighbors = [];
    if (dir === 'out') neighbors = out;
    else if (dir === 'in') neighbors = incoming;
    else neighbors = out.concat(incoming);
    const set = new Set(neighbors.filter(Boolean));
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
    if (ref.type === 'file') return ref.path;
    if (ref.type === 'chunk') {
      const meta = chunkInfo.get(ref.chunkUid);
      return meta?.file || null;
    }
    return null;
  };

  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    if (current.distance >= effectiveDepth) continue;
    const currentRef = current.ref;
    const edgeCandidates = [];

    if (includeGraph('callGraph') && currentRef.type === GRAPH_NODE_TYPES.callGraph && callGraphIndex.size) {
      const neighbors = resolveGraphNeighbors(callGraphIndex, currentRef.chunkUid, normalizedDirection);
      for (const neighborId of neighbors) {
        const edgeType = GRAPH_EDGE_TYPES.callGraph;
        if (!includeEdgeType(edgeType)) continue;
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
      const neighbors = resolveGraphNeighbors(usageGraphIndex, currentRef.chunkUid, normalizedDirection);
      for (const neighborId of neighbors) {
        const edgeType = GRAPH_EDGE_TYPES.usageGraph;
        if (!includeEdgeType(edgeType)) continue;
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
        const neighbors = resolveGraphNeighbors(importGraphIndex, sourceId, normalizedDirection);
        for (const neighborId of neighbors) {
          const edgeType = GRAPH_EDGE_TYPES.importGraph;
          if (!includeEdgeType(edgeType)) continue;
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
        if (!includeEdgeType(edgeType)) continue;
        const confidence = Number.isFinite(entry.edge.confidence)
          ? entry.edge.confidence
          : null;
        if (minConfidence != null) {
          const effectiveConfidence = confidence == null ? 1 : confidence;
          if (effectiveConfidence < minConfidence) continue;
        }
        const fromRef = { type: 'chunk', chunkUid: entry.edge.from.chunkUid };
        const symbolId = entry.symbolId;
        const nextRef = symbolId ? { type: 'symbol', symbolId } : null;
        edgeCandidates.push({
          edge: {
            edgeType,
            graph: 'symbolEdges',
            from: fromRef,
            to: entry.toRef,
            confidence,
            evidence: entry.edge.reason ? { note: entry.edge.reason } : null
          },
          nextRef
        });
      }
    }
    edgeCandidates.sort((a, b) => compareGraphEdges(a.edge, b.edge));
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
        queue.length = 0;
        break;
      }
      if (minConfidence != null && edge.confidence != null && edge.confidence < minConfidence) {
        continue;
      }
      const added = addEdge(edge);
      if (!added && normalizedCaps.maxEdges != null && edges.length >= normalizedCaps.maxEdges) {
        queue.length = 0;
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
          if (includePaths && (normalizedCaps.maxPaths == null || paths.length < normalizedCaps.maxPaths)) {
            const path = buildPathForNode(nextKey);
            if (path?.to) paths.push(path);
          } else if (includePaths && normalizedCaps.maxPaths != null && paths.length >= normalizedCaps.maxPaths) {
            recordTruncation('maxPaths', {
              limit: normalizedCaps.maxPaths,
              observed: paths.length
            });
          }
        }
      }
    }
  }

  const nodes = Array.from(nodeMap.values()).sort(compareGraphNodes);
  edges.sort(compareGraphEdges);
  if (includePaths) paths.sort(compareWitnessPaths);

  return {
    nodes,
    edges,
    paths: includePaths ? paths : null,
    truncation: truncation.length ? truncation : null,
    warnings: warnings.length ? warnings : null,
    stats: {
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
