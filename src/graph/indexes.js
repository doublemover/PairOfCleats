import path from 'node:path';
import { toPosix, isAbsolutePathNative } from '../shared/files.js';
import { compareStrings } from '../shared/sort.js';
import { compareCandidates } from './ordering.js';

export const normalizeImportPath = (value, repoRoot) => {
  if (!value) return null;
  const raw = String(value);
  let normalized = raw;
  if (repoRoot && isAbsolutePathNative(raw)) {
    const rel = path.relative(repoRoot, raw) || '.';
    if (rel && !rel.startsWith('..') && !isAbsolutePathNative(rel)) {
      normalized = rel;
    }
  }
  normalized = toPosix(normalized);
  if (normalized.startsWith('./')) normalized = normalized.slice(2);
  return normalized;
};

export const normalizeFileRef = (ref, repoRoot) => {
  if (!ref || typeof ref !== 'object') return ref;
  if (ref.type !== 'file') return ref;
  const normalized = normalizeImportPath(ref.path, repoRoot);
  if (!normalized || normalized === ref.path) return ref;
  return { ...ref, path: normalized };
};

export const buildGraphNodeIndex = (graph, { normalizeId = null } = {}) => {
  const map = new Map();
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !node.id) continue;
    const normalizedId = normalizeId ? normalizeId(node.id) : node.id;
    if (!normalizedId) continue;
    map.set(normalizedId, node);
  }
  return map;
};

export const buildIdTable = (nodeIndex) => {
  const ids = Array.from(nodeIndex.keys());
  ids.sort(compareStrings);
  const idToIndex = new Map();
  for (let i = 0; i < ids.length; i += 1) {
    idToIndex.set(ids[i], i);
  }
  return { ids, idToIndex };
};

export const buildPrefixTable = (values = []) => {
  const prefixes = [];
  const suffixes = [];
  let previous = '';
  for (const value of values) {
    const text = String(value);
    let prefixLen = 0;
    const maxPrefix = Math.min(previous.length, text.length);
    while (prefixLen < maxPrefix && previous[prefixLen] === text[prefixLen]) {
      prefixLen += 1;
    }
    prefixes.push(prefixLen);
    suffixes.push(text.slice(prefixLen));
    previous = text;
  }
  return { prefixes, suffixes };
};

export const resolvePrefixEntry = (table, index) => {
  if (!table || !Array.isArray(table.prefixes) || !Array.isArray(table.suffixes)) return null;
  if (index < 0 || index >= table.prefixes.length) return null;
  let value = '';
  for (let i = 0; i <= index; i += 1) {
    const prefixLen = table.prefixes[i] || 0;
    const suffix = table.suffixes[i] || '';
    value = value.slice(0, prefixLen) + suffix;
  }
  return value;
};

/**
 * Build sorted, unique adjacency lists for graph traversal.
 */
export const buildAdjacencyIndex = (graph, { normalizeNeighborId = null, normalizeNodeId = null } = {}) => {
  const map = new Map();
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !node.id) continue;
    const nodeId = normalizeNodeId ? normalizeNodeId(node.id) : node.id;
    if (!nodeId) continue;
    const outRaw = Array.isArray(node.out) ? node.out : [];
    const inRaw = Array.isArray(node.in) ? node.in : [];
    const outSet = new Set();
    const inSet = new Set();
    for (const neighbor of outRaw) {
      if (!neighbor) continue;
      const normalized = normalizeNeighborId ? normalizeNeighborId(neighbor) : neighbor;
      if (normalized) outSet.add(normalized);
    }
    for (const neighbor of inRaw) {
      if (!neighbor) continue;
      const normalized = normalizeNeighborId ? normalizeNeighborId(neighbor) : neighbor;
      if (normalized) inSet.add(normalized);
    }
    const out = Array.from(outSet);
    const incoming = Array.from(inSet);
    out.sort(compareStrings);
    incoming.sort(compareStrings);
    const both = Array.from(new Set([...out, ...incoming]));
    both.sort(compareStrings);
    map.set(nodeId, { out, in: incoming, both });
  }
  return map;
};

/**
 * Build a compact CSR representation from adjacency lists.
 */
export const buildAdjacencyCsr = (adjacencyMap, idTable) => {
  if (!adjacencyMap || !idTable?.ids || !idTable.idToIndex) return null;
  const ids = idTable.ids;
  const offsets = new Uint32Array(ids.length + 1);
  const edges = [];
  offsets[0] = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const entry = adjacencyMap.get(ids[i]);
    const out = entry?.out || [];
    for (const neighbor of out) {
      const idx = idTable.idToIndex.get(neighbor);
      if (idx == null) continue;
      edges.push(idx);
    }
    offsets[i + 1] = edges.length;
  }
  return {
    ids,
    offsets,
    edges: Uint32Array.from(edges)
  };
};

export const buildImportGraphIndex = (graph, repoRoot) => buildGraphNodeIndex(graph, {
  normalizeId: (value) => normalizeImportPath(value, repoRoot)
});

export const buildChunkInfo = (callGraphIndex, usageGraphIndex) => {
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

const normalizeSymbolRef = (ref) => {
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
  const symbolCandidates = candidates.filter((candidate) => candidate?.symbolId);
  if (!symbolCandidates.length) return null;
  const ordered = symbolCandidates.slice();
  ordered.sort(compareCandidates);
  return ordered[0].symbolId;
};

export const buildSymbolEdgesIndex = (symbolEdges) => {
  const byChunk = new Map();
  const bySymbol = new Map();
  const edges = Array.isArray(symbolEdges) ? symbolEdges : [];
  for (const edge of edges) {
    if (!edge?.from?.chunkUid || !edge?.to) continue;
    const normalized = normalizeSymbolRef(edge.to);
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
  const compareEntries = (left, right) => {
    const typeCompare = compareStrings(left?.edge?.type || 'symbol', right?.edge?.type || 'symbol');
    if (typeCompare !== 0) return typeCompare;
    return compareCandidates(left?.toRef, right?.toRef);
  };
  for (const list of byChunk.values()) list.sort(compareEntries);
  for (const list of bySymbol.values()) list.sort(compareEntries);
  return { byChunk, bySymbol };
};

export const buildCallSiteIndex = (callSites) => {
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
