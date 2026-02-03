import { compareGraphEdges } from '../graph/ordering.js';
import { createWorkBudget } from '../graph/work-budget.js';
import { normalizeLimit, normalizeOptionalLimit } from '../shared/limits.js';
import { compareStrings } from '../shared/sort.js';
import { createTruncationRecorder } from '../shared/truncation.js';

const DEFAULT_MAX_PER_HIT = 4;
const DEFAULT_MAX_TOTAL = 40;
const DEFAULT_MAX_REASONS = 3;

const REASON_PRIORITY_ORDER = ['call', 'usage', 'export', 'import', 'nameFallback'];
const REASON_PRIORITY = new Map(REASON_PRIORITY_ORDER.map((reason, index) => [reason, index]));

const resolvePriority = (reasonType) => (
  REASON_PRIORITY.has(reasonType) ? REASON_PRIORITY.get(reasonType) : REASON_PRIORITY_ORDER.length + 1
);

const compareDocIds = (left, right) => {
  const leftNum = Number(left);
  const rightNum = Number(right);
  if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
    if (leftNum < rightNum) return -1;
    if (leftNum > rightNum) return 1;
    return 0;
  }
  return compareStrings(String(left), String(right));
};

const dedupeSort = (list) => {
  const unique = Array.from(new Set(list.filter((entry) => entry != null)));
  unique.sort(compareDocIds);
  return unique;
};

const resolveContextCaps = ({ options, maxPerHit, maxTotal }) => {
  const fallbackSourceCap = Math.max(maxPerHit * 25, 100);
  return {
    maxWorkUnits: normalizeOptionalLimit(options.maxWorkUnits)
      ?? Math.max(maxTotal * 50, 500),
    maxWallClockMs: normalizeOptionalLimit(options.maxWallClockMs),
    maxCallEdges: normalizeOptionalLimit(options.maxCallEdges) ?? fallbackSourceCap,
    maxUsageEdges: normalizeOptionalLimit(options.maxUsageEdges) ?? fallbackSourceCap,
    maxImportEdges: normalizeOptionalLimit(options.maxImportEdges) ?? fallbackSourceCap,
    maxExportEdges: normalizeOptionalLimit(options.maxExportEdges) ?? fallbackSourceCap,
    maxNameCandidates: normalizeOptionalLimit(options.maxNameCandidates) ?? fallbackSourceCap,
    maxReasons: normalizeOptionalLimit(options.maxReasons) ?? DEFAULT_MAX_REASONS
  };
};

const formatReason = (reasonType, detail) => {
  if (!detail) return reasonType;
  return `${reasonType}:${detail}`;
};

const buildNameRef = (name) => ({
  status: 'unresolved',
  targetName: name,
  candidates: [],
  resolved: null
});

const buildGraphIndex = (graph) => {
  const map = new Map();
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !node.id) continue;
    map.set(node.id, node);
  }
  return map;
};

const collectEdges = ({
  fromRef,
  graph,
  edgeType,
  neighborIds,
  limit,
  recordTruncation,
  truncationCap,
  truncationNode,
  toRefBuilder
}) => {
  const edges = [];
  const total = Array.isArray(neighborIds) ? neighborIds.length : 0;
  let added = 0;
  if (total && limit != null && total > limit) {
    recordTruncation(truncationCap, {
      limit,
      observed: total,
      omitted: total - limit,
      at: truncationNode ? { node: truncationNode } : null
    });
  }
  if (!Array.isArray(neighborIds)) return edges;
  const buildToRef = typeof toRefBuilder === 'function' ? toRefBuilder : ((value) => value);
  for (let i = 0; i < neighborIds.length; i += 1) {
    const neighbor = neighborIds[i];
    if (!neighbor) continue;
    if (limit != null && added >= limit) break;
    edges.push({
      edgeType,
      graph,
      from: fromRef,
      to: buildToRef(neighbor)
    });
    added += 1;
  }
  edges.sort(compareGraphEdges);
  return edges;
};

const resolveChunkUid = (chunk) => chunk?.chunkUid || chunk?.metaV2?.chunkUid || null;

export function buildContextIndex({ chunkMeta, repoMap }) {
  const byName = new Map();
  const byFile = new Map();
  const byDocId = new Map();
  const byChunkUid = new Map();

  if (Array.isArray(chunkMeta)) {
    for (let index = 0; index < chunkMeta.length; index += 1) {
      const chunk = chunkMeta[index];
      if (!chunk) continue;
      const docId = chunk.id != null ? chunk.id : index;
      byDocId.set(docId, chunk);
      const chunkUid = resolveChunkUid(chunk);
      if (chunkUid) byChunkUid.set(chunkUid, docId);
      if (chunk.name) {
        const list = byName.get(chunk.name) || [];
        list.push(docId);
        byName.set(chunk.name, list);
      }
      if (chunk.file) {
        const list = byFile.get(chunk.file) || [];
        list.push(docId);
        byFile.set(chunk.file, list);
      }
    }
  }

  for (const [key, list] of byName.entries()) {
    byName.set(key, dedupeSort(list));
  }
  for (const [key, list] of byFile.entries()) {
    byFile.set(key, dedupeSort(list));
  }

  const repoMapByName = new Map();
  if (Array.isArray(repoMap)) {
    for (const entry of repoMap) {
      if (!entry?.name || !entry?.file) continue;
      const list = repoMapByName.get(entry.name) || [];
      list.push(entry.file);
      repoMapByName.set(entry.name, list);
    }
  }
  for (const [key, list] of repoMapByName.entries()) {
    const sorted = Array.from(new Set(list.filter(Boolean))).sort(compareStrings);
    repoMapByName.set(key, sorted);
  }

  return { byName, byFile, byDocId, byChunkUid, repoMapByName, chunkMeta, repoMap };
}

const serializeMap = (map) => {
  if (!map || typeof map.entries !== 'function') return {};
  const out = {};
  for (const [key, value] of map.entries()) {
    out[key] = Array.isArray(value) ? value : Array.from(value || []);
  }
  return out;
};

const hydrateMap = (raw) => {
  const map = new Map();
  if (!raw || typeof raw !== 'object') return map;
  for (const [key, value] of Object.entries(raw)) {
    map.set(key, Array.isArray(value) ? value : []);
  }
  return map;
};

export function serializeContextIndex(contextIndex) {
  if (!contextIndex) return null;
  return {
    version: 1,
    byName: serializeMap(contextIndex.byName),
    byFile: serializeMap(contextIndex.byFile),
    repoMapByName: serializeMap(contextIndex.repoMapByName)
  };
}

export function hydrateContextIndex(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    byName: hydrateMap(raw.byName),
    byFile: hydrateMap(raw.byFile),
    repoMapByName: hydrateMap(raw.repoMapByName)
  };
}

const ensureChunkLookups = (contextIndex, chunkMeta) => {
  if (contextIndex.byDocId && contextIndex.byChunkUid) return contextIndex;
  const next = buildContextIndex({ chunkMeta, repoMap: contextIndex.repoMap || null });
  contextIndex.byDocId = next.byDocId;
  contextIndex.byChunkUid = next.byChunkUid;
  if (!contextIndex.byName) contextIndex.byName = next.byName;
  if (!contextIndex.byFile) contextIndex.byFile = next.byFile;
  if (!contextIndex.repoMapByName) contextIndex.repoMapByName = next.repoMapByName;
  return contextIndex;
};

export function expandContext({
  hits,
  chunkMeta,
  fileRelations,
  repoMap,
  graphRelations,
  options = {},
  allowedIds = null,
  contextIndex = null
}) {
  if (!Array.isArray(hits) || !hits.length || !Array.isArray(chunkMeta)) {
    return { contextHits: [], stats: { added: 0, workUnitsUsed: 0, truncation: null } };
  }
  const maxPerHit = normalizeLimit(options.maxPerHit, DEFAULT_MAX_PER_HIT);
  const maxTotal = normalizeLimit(options.maxTotal, DEFAULT_MAX_TOTAL);
  const includeCalls = options.includeCalls !== false;
  const includeImports = options.includeImports !== false;
  const includeExports = options.includeExports === true;
  const includeUsages = options.includeUsages === true;
  const includeReasons = options.explain === true || options.includeReasons === true;

  const caps = resolveContextCaps({ options, maxPerHit, maxTotal });

  const resolvedIndex = ensureChunkLookups(
    contextIndex || buildContextIndex({ chunkMeta, repoMap }),
    chunkMeta
  );
  const { byName, byFile, byDocId, byChunkUid, repoMapByName } = resolvedIndex;

  const primaryIds = new Set(hits.map((hit) => hit?.id).filter((id) => id != null));
  const contextHits = [];
  const candidateMap = new Map();
  const truncation = createTruncationRecorder({ scope: 'graph' });
  const recordTruncation = (cap, detail) => truncation.record(cap, detail);

  const workBudget = createWorkBudget({
    maxWorkUnits: caps.maxWorkUnits,
    maxWallClockMs: caps.maxWallClockMs
  });

  const stopForBudget = (state) => {
    if (!state?.stop || !state.reason) return false;
    recordTruncation(state.reason, {
      limit: state.limit,
      observed: state.reason === 'maxWallClockMs' ? state.elapsedMs : state.used
    });
    return true;
  };

  const addReason = (entry, reason, priority, sourceId) => {
    if (!includeReasons) return;
    const list = entry.reasons;
    if (list.some((item) => item.reason === reason)) return;
    list.push({ reason, priority, sourceId });
    list.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return compareStrings(a.reason, b.reason);
    });
    if (list.length > caps.maxReasons) list.length = caps.maxReasons;
    entry.hit.context.reasons = list.map((item) => ({
      reason: item.reason,
      sourceId: item.sourceId,
      priority: item.priority
    }));
  };

  const registerCandidate = (docId, reasonType, reason, sourceId, perHitState) => {
    if (docId == null) return false;
    if (primaryIds.has(docId)) return false;
    if (allowedIds && !allowedIds.has(docId)) return false;

    const chunk = byDocId.get(docId);
    if (!chunk) return false;

    const priority = resolvePriority(reasonType);
    const existing = candidateMap.get(docId);
    if (existing) {
      addReason(existing, reason, priority, sourceId);
      if (priority < existing.priority) {
        existing.priority = priority;
        existing.hit.context.reason = reason;
        existing.hit.context.sourceId = sourceId;
      }
      return false;
    }

    if (contextHits.length >= maxTotal) {
      recordTruncation('maxTotal', {
        limit: maxTotal,
        observed: contextHits.length
      });
      return false;
    }
    if (perHitState.added >= maxPerHit) {
      recordTruncation('maxPerHit', {
        limit: maxPerHit,
        observed: perHitState.added,
        at: { node: String(sourceId) }
      });
      return false;
    }

    const context = { sourceId, reason };
    const entry = {
      hit: {
        ...chunk,
        score: 0,
        scoreType: 'context',
        context
      },
      priority,
      reasons: includeReasons ? [] : null
    };
    if (includeReasons) {
      entry.reasons.push({ reason, priority, sourceId });
      entry.hit.context.reasons = [{ reason, sourceId, priority }];
    }

    candidateMap.set(docId, entry);
    contextHits.push(entry.hit);
    perHitState.added += 1;
    return true;
  };

  const resolveDocIdsByFile = (file) => {
    const ids = byFile.get(file);
    return Array.isArray(ids) ? ids : [];
  };

  const resolveGraphEdges = ({
    graphIndex,
    edgeType,
    graph,
    fromId,
    limit,
    truncationCap,
    toRefBuilder
  }) => {
    if (!graphIndex) return [];
    const node = graphIndex.get(fromId);
    if (!node || !Array.isArray(node.out)) return [];
    const fromRef = graph === 'importGraph'
      ? { type: 'file', path: fromId }
      : { type: 'chunk', chunkUid: fromId };
    return collectEdges({
      fromRef,
      graph,
      edgeType,
      neighborIds: node.out,
      limit,
      recordTruncation,
      truncationCap,
      truncationNode: fromId,
      toRefBuilder
    });
  };

  const graphIndexes = graphRelations
    ? {
      callGraph: buildGraphIndex(graphRelations.callGraph),
      usageGraph: buildGraphIndex(graphRelations.usageGraph),
      importGraph: buildGraphIndex(graphRelations.importGraph)
    }
    : null;

  let halted = false;

  for (const hit of hits) {
    if (halted) break;
    if (contextHits.length >= maxTotal) {
      recordTruncation('maxTotal', { limit: maxTotal, observed: contextHits.length });
      break;
    }
    const sourceId = hit?.id;
    const sourceChunk = byDocId.get(sourceId);
    if (!sourceChunk) continue;
    const perHitState = { added: 0 };
    const sourceChunkUid = resolveChunkUid(sourceChunk);
    const sourceFile = sourceChunk.file || null;

    const consumeWork = () => {
      const state = workBudget.consume(1);
      if (stopForBudget(state)) {
        halted = true;
        return true;
      }
      return false;
    };

    const handleEdges = (edges, reasonType, detailResolver, resolveTargets) => {
      for (const edge of edges) {
        if (halted) break;
        if (contextHits.length >= maxTotal) break;
        if (perHitState.added >= maxPerHit) break;
        if (consumeWork()) break;
        const detail = detailResolver(edge);
        const reason = formatReason(reasonType, detail);
        const targets = resolveTargets(edge);
        for (const docId of targets) {
          if (halted) break;
          if (perHitState.added >= maxPerHit || contextHits.length >= maxTotal) break;
          registerCandidate(docId, reasonType, reason, sourceId, perHitState);
        }
      }
    };

    const callGraphNode = sourceChunkUid && graphIndexes?.callGraph?.get(sourceChunkUid);
    if (includeCalls && callGraphNode) {
      const edges = resolveGraphEdges({
        graphIndex: graphIndexes.callGraph,
        edgeType: 'call',
        graph: 'callGraph',
        fromId: sourceChunkUid,
        limit: caps.maxCallEdges,
        truncationCap: 'maxCallEdges',
        toRefBuilder: (neighbor) => ({ type: 'chunk', chunkUid: neighbor })
      });
      handleEdges(
        edges,
        'call',
        (edge) => edge?.to?.chunkUid || null,
        (edge) => {
          const docId = byChunkUid.get(edge?.to?.chunkUid);
          return docId == null ? [] : [docId];
        }
      );
    }

    const usageGraphNode = sourceChunkUid && graphIndexes?.usageGraph?.get(sourceChunkUid);
    if (includeUsages && usageGraphNode && !halted) {
      const edges = resolveGraphEdges({
        graphIndex: graphIndexes.usageGraph,
        edgeType: 'usage',
        graph: 'usageGraph',
        fromId: sourceChunkUid,
        limit: caps.maxUsageEdges,
        truncationCap: 'maxUsageEdges',
        toRefBuilder: (neighbor) => ({ type: 'chunk', chunkUid: neighbor })
      });
      handleEdges(
        edges,
        'usage',
        (edge) => edge?.to?.chunkUid || null,
        (edge) => {
          const docId = byChunkUid.get(edge?.to?.chunkUid);
          return docId == null ? [] : [docId];
        }
      );
    }

    if (includeExports && sourceFile && fileRelations && !halted) {
      const relations = typeof fileRelations.get === 'function'
        ? fileRelations.get(sourceFile)
        : fileRelations[sourceFile];
      const exportsList = Array.isArray(relations?.exports) ? relations.exports : [];
      const edges = collectEdges({
        fromRef: { type: 'file', path: sourceFile },
        graph: 'importGraph',
        edgeType: 'export',
        neighborIds: exportsList,
        limit: caps.maxExportEdges,
        recordTruncation,
        truncationCap: 'maxExportEdges',
        truncationNode: sourceFile,
        toRefBuilder: (name) => buildNameRef(name)
      });
      handleEdges(
        edges,
        'export',
        (edge) => edge?.to?.targetName || null,
        (edge) => {
          const ids = byName.get(edge?.to?.targetName) || [];
          return Array.isArray(ids) ? ids : [];
        }
      );
    }

    const importGraphNode = sourceFile && graphIndexes?.importGraph?.get(sourceFile);
    if (includeImports && importGraphNode && !halted) {
      const edges = resolveGraphEdges({
        graphIndex: graphIndexes.importGraph,
        edgeType: 'import',
        graph: 'importGraph',
        fromId: sourceFile,
        limit: caps.maxImportEdges,
        truncationCap: 'maxImportEdges',
        toRefBuilder: (neighbor) => ({ type: 'file', path: neighbor })
      });
      handleEdges(
        edges,
        'import',
        (edge) => edge?.to?.path || null,
        (edge) => resolveDocIdsByFile(edge?.to?.path)
      );
    }

    if (!callGraphNode && includeCalls && sourceChunk && !halted) {
      const calls = sourceChunk.codeRelations?.calls || [];
      const callList = Array.isArray(calls) ? calls : [];
      const edges = collectEdges({
        fromRef: { type: 'chunk', chunkUid: sourceChunkUid || String(sourceId) },
        graph: 'callGraph',
        edgeType: 'call',
        neighborIds: callList.map((entry) => Array.isArray(entry) ? entry[1] : null).filter(Boolean),
        limit: caps.maxCallEdges,
        recordTruncation,
        truncationCap: 'maxCallEdges',
        truncationNode: String(sourceId),
        toRefBuilder: (name) => buildNameRef(name)
      });
      for (const edge of edges) {
        if (halted) break;
        if (contextHits.length >= maxTotal) break;
        if (perHitState.added >= maxPerHit) break;
        if (consumeWork()) break;
        const name = edge?.to?.targetName;
        if (!name) continue;
        const ids = byName.get(name) || [];
        if (ids.length) {
          const reason = formatReason('call', name);
          for (const id of ids) {
            if (halted) break;
            if (perHitState.added >= maxPerHit || contextHits.length >= maxTotal) break;
            registerCandidate(id, 'call', reason, sourceId, perHitState);
          }
          continue;
        }
        const files = repoMapByName.get(name) || [];
        if (!files.length) continue;
        const reason = formatReason('nameFallback', name);
        let seen = 0;
        for (const file of files) {
          const fileIds = resolveDocIdsByFile(file);
          for (const id of fileIds) {
            if (halted) break;
            if (perHitState.added >= maxPerHit || contextHits.length >= maxTotal) break;
            registerCandidate(id, 'nameFallback', reason, sourceId, perHitState);
            seen += 1;
            if (caps.maxNameCandidates != null && seen >= caps.maxNameCandidates) break;
          }
          if (caps.maxNameCandidates != null && seen >= caps.maxNameCandidates) break;
        }
        if (caps.maxNameCandidates != null && seen >= caps.maxNameCandidates) {
          recordTruncation('maxNameCandidates', {
            limit: caps.maxNameCandidates,
            observed: seen
          });
        }
      }
    }

    if (!importGraphNode && includeImports && sourceFile && fileRelations && !halted) {
      const relations = typeof fileRelations.get === 'function'
        ? fileRelations.get(sourceFile)
        : fileRelations[sourceFile];
      const importsList = Array.isArray(relations?.importLinks) ? relations.importLinks : [];
      const edges = collectEdges({
        fromRef: { type: 'file', path: sourceFile },
        graph: 'importGraph',
        edgeType: 'import',
        neighborIds: importsList,
        limit: caps.maxImportEdges,
        recordTruncation,
        truncationCap: 'maxImportEdges',
        truncationNode: sourceFile,
        toRefBuilder: (file) => ({ type: 'file', path: file })
      });
      handleEdges(
        edges,
        'import',
        (edge) => edge?.to?.path || null,
        (edge) => resolveDocIdsByFile(edge?.to?.path)
      );
    }

    if (!usageGraphNode && includeUsages && sourceFile && fileRelations && !halted) {
      const relations = typeof fileRelations.get === 'function'
        ? fileRelations.get(sourceFile)
        : fileRelations[sourceFile];
      const usageList = Array.isArray(relations?.usages) ? relations.usages : [];
      const edges = collectEdges({
        fromRef: { type: 'file', path: sourceFile },
        graph: 'usageGraph',
        edgeType: 'usage',
        neighborIds: usageList,
        limit: caps.maxUsageEdges,
        recordTruncation,
        truncationCap: 'maxUsageEdges',
        truncationNode: sourceFile,
        toRefBuilder: (name) => buildNameRef(name)
      });
      handleEdges(
        edges,
        'usage',
        (edge) => edge?.to?.targetName || null,
        (edge) => {
          const ids = byName.get(edge?.to?.targetName) || [];
          return Array.isArray(ids) ? ids : [];
        }
      );
    }
  }

  return {
    contextHits,
    stats: {
      added: contextHits.length,
      workUnitsUsed: workBudget.getUsed(),
      truncation: truncation.list.length ? truncation.list : null
    }
  };
}
