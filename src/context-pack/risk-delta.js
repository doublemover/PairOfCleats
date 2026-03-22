import { resolveIndexRef } from '../index/index-ref.js';
import {
  loadChunkMeta,
  loadJsonArrayArtifact,
  loadJsonObjectArtifact,
  loadPiecesManifest
} from '../shared/artifact-io.js';
import { createError, ERROR_CODES } from '../shared/error-codes.js';
import { sha1 } from '../shared/hash.js';
import { normalizeRiskSummary, summarizeRiskStats } from '../shared/risk-explain.js';
import {
  filterRiskFlows,
  filterRiskPartialFlows,
  materializeRiskFilters,
  normalizeRiskFilters,
  validateRiskFilters
} from '../shared/risk-filters.js';
import { parseSeedRef } from '../shared/seed-ref.js';
import { stableStringify } from '../shared/stable-json.js';
import { buildChunkIndex } from './assemble.js';

const RISK_DELTA_VERSION = '1.0.0';

const invalidRequest = (message, details = null) => createError(ERROR_CODES.INVALID_REQUEST, message, details);

const normalizeChunkSubject = (chunk) => {
  if (!chunk || typeof chunk !== 'object') return null;
  return {
    chunkUid: chunk.chunkUid || chunk.metaV2?.chunkUid || null,
    file: chunk.file || chunk.metaV2?.file || chunk.virtualPath || null,
    name: chunk.name || chunk.metaV2?.symbol?.name || chunk.metaV2?.name || null,
    kind: chunk.kind || chunk.metaV2?.symbol?.kind || null
  };
};

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const normalizeFlowEndpoint = (endpoint) => {
  if (!endpoint || typeof endpoint !== 'object') return null;
  return {
    chunkUid: endpoint.chunkUid || null,
    ruleId: endpoint.ruleId || null,
    ruleName: endpoint.ruleName || endpoint.name || null,
    ruleType: endpoint.ruleType || null,
    ruleRole: endpoint.ruleRole || null,
    category: endpoint.category || null,
    severity: endpoint.severity || null,
    confidence: Number.isFinite(endpoint.confidence) ? endpoint.confidence : null,
    tags: Array.isArray(endpoint.tags) ? endpoint.tags.filter(Boolean) : []
  };
};

const normalizeFlowPath = (pathValue) => ({
  chunkUids: Array.isArray(pathValue?.chunkUids) ? pathValue.chunkUids.filter(Boolean) : [],
  callSiteIdsByStep: Array.isArray(pathValue?.callSiteIdsByStep)
    ? pathValue.callSiteIdsByStep.map((step) => (Array.isArray(step) ? step.filter(Boolean) : []))
    : [],
  watchByStep: Array.isArray(pathValue?.watchByStep)
    ? pathValue.watchByStep.map((entry) => (entry && typeof entry === 'object' ? { ...entry } : null))
    : []
});

const normalizeFlowEntry = (flow) => ({
  flowId: flow?.flowId || null,
  confidence: Number.isFinite(flow?.confidence) ? flow.confidence : null,
  category: flow?.category || flow?.sink?.category || flow?.source?.category || null,
  source: normalizeFlowEndpoint(flow?.source),
  sink: normalizeFlowEndpoint(flow?.sink),
  path: normalizeFlowPath(flow?.path),
  notes: isPlainObject(flow?.notes) ? { ...flow.notes } : null
});

const normalizePartialFlowEntry = (flow) => ({
  partialFlowId: flow?.partialFlowId || null,
  confidence: Number.isFinite(flow?.confidence) ? flow.confidence : null,
  source: normalizeFlowEndpoint(flow?.source),
  frontier: flow?.frontier && typeof flow.frontier === 'object'
    ? {
      chunkUid: flow.frontier.chunkUid || null,
      terminalReason: flow.frontier.terminalReason || null,
      blockedExpansions: Array.isArray(flow.frontier.blockedExpansions)
        ? flow.frontier.blockedExpansions.map((entry) => (entry && typeof entry === 'object' ? { ...entry } : entry))
        : []
    }
    : null,
  path: normalizeFlowPath(flow?.path),
  notes: isPlainObject(flow?.notes) ? { ...flow.notes } : null
});

const fingerprintEntry = (value) => `sha1:${sha1(stableStringify(value))}`;

const resolveChunksFromSeed = (seedRef, chunkIndex) => {
  if (!seedRef || !chunkIndex) return [];
  if (seedRef.type === 'chunk') {
    const chunk = chunkIndex.byChunkUid.get(seedRef.chunkUid) || null;
    return chunk ? [chunk] : [];
  }
  if (seedRef.type === 'symbol') {
    const chunk = chunkIndex.bySymbol.get(seedRef.symbolId) || null;
    return chunk ? [chunk] : [];
  }
  if (seedRef.type === 'file') {
    const normalized = typeof chunkIndex.normalizePath === 'function'
      ? chunkIndex.normalizePath(seedRef.path)
      : seedRef.path;
    const matches = chunkIndex.byFile.get(normalized) || chunkIndex.byFile.get(seedRef.path) || [];
    return Array.isArray(matches) ? matches.filter(Boolean) : [];
  }
  return [];
};

const aggregateRiskSummary = (summaryRows, targetChunks, relevantFlows) => {
  const rows = Array.isArray(summaryRows) ? summaryRows.filter((row) => row && typeof row === 'object') : [];
  const chunks = Array.isArray(targetChunks) ? targetChunks.filter((chunk) => chunk && typeof chunk === 'object') : [];
  if (rows.length <= 0) return null;
  if (rows.length === 1) return normalizeRiskSummary(rows[0], relevantFlows);

  const file = chunks[0]?.file || chunks[0]?.metaV2?.file || rows[0]?.file || null;
  const languageId = rows.map((row) => row?.languageId).find((value) => typeof value === 'string' && value.trim()) || null;
  const totals = {
    sources: 0,
    sinks: 0,
    sanitizers: 0,
    localFlows: 0
  };
  const truncated = {
    sources: false,
    sinks: false,
    sanitizers: false,
    localFlows: false,
    evidence: false
  };
  const signals = {
    sources: [],
    sinks: [],
    sanitizers: [],
    localFlows: []
  };
  for (const row of rows) {
    for (const key of Object.keys(totals)) {
      totals[key] += Number.isFinite(row?.totals?.[key]) ? row.totals[key] : 0;
      truncated[key] = truncated[key] || row?.truncated?.[key] === true;
      if (Array.isArray(row?.signals?.[key])) {
        signals[key].push(...row.signals[key]);
      }
    }
    truncated.evidence = truncated.evidence || row?.truncated?.evidence === true;
  }
  return normalizeRiskSummary({
    chunkUid: chunks[0]?.chunkUid || chunks[0]?.metaV2?.chunkUid || null,
    file,
    languageId,
    symbol: null,
    totals,
    truncated,
    signals
  }, relevantFlows);
};

const collectChangedFields = (before, after, prefix = '') => {
  const beforeKey = stableStringify(before);
  const afterKey = stableStringify(after);
  if (beforeKey === afterKey) return [];
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort((left, right) => left.localeCompare(right));
    const changed = [];
    for (const key of keys) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      changed.push(...collectChangedFields(before[key], after[key], nextPrefix));
    }
    return changed.length > 0 ? changed : [prefix || '$'];
  }
  return [prefix || '$'];
};

const buildEntryDelta = ({ before, after, idField }) => ({
  [idField]: before?.[idField] || after?.[idField] || null,
  changedFields: Array.from(new Set(collectChangedFields(before, after))).sort((left, right) => left.localeCompare(right)),
  beforeFingerprint: fingerprintEntry(before),
  afterFingerprint: fingerprintEntry(after),
  before,
  after
});

const buildDeltaBucket = ({ beforeEntries, afterEntries, idField }) => {
  const beforeById = new Map((Array.isArray(beforeEntries) ? beforeEntries : [])
    .filter((entry) => entry?.[idField])
    .map((entry) => [entry[idField], entry]));
  const afterById = new Map((Array.isArray(afterEntries) ? afterEntries : [])
    .filter((entry) => entry?.[idField])
    .map((entry) => [entry[idField], entry]));
  const ids = Array.from(new Set([...beforeById.keys(), ...afterById.keys()])).sort((left, right) => left.localeCompare(right));
  const added = [];
  const removed = [];
  const changed = [];
  let unchangedCount = 0;

  for (const id of ids) {
    const before = beforeById.get(id) || null;
    const after = afterById.get(id) || null;
    if (!before && after) {
      added.push(after);
      continue;
    }
    if (before && !after) {
      removed.push(before);
      continue;
    }
    if (stableStringify(before) === stableStringify(after)) {
      unchangedCount += 1;
      continue;
    }
    changed.push(buildEntryDelta({ before, after, idField }));
  }

  return {
    added,
    removed,
    changed,
    unchangedCount
  };
};

const safeLoadArray = async (indexDir, manifest, name) => {
  try {
    return await loadJsonArrayArtifact(indexDir, name, { manifest, strict: true });
  } catch {
    return [];
  }
};

const safeLoadObject = async (indexDir, manifest, name) => {
  try {
    return await loadJsonObjectArtifact(indexDir, name, { manifest, strict: true });
  } catch {
    return null;
  }
};

const loadRiskSliceForRef = async ({
  repoRoot,
  userConfig,
  requestedRef,
  parsedSeed,
  filters,
  includePartialFlows
}) => {
  const resolved = resolveIndexRef({
    ref: requestedRef,
    repoRoot,
    userConfig,
    requestedModes: ['code'],
    preferFrozen: true,
    allowMissingModes: false
  });
  const indexDir = resolved.indexDirByMode?.code;
  const manifest = loadPiecesManifest(indexDir, { strict: true });
  const chunkMeta = await loadChunkMeta(indexDir, { manifest, strict: true });
  const chunkIndex = buildChunkIndex(chunkMeta, { repoRoot });
  const targetChunks = resolveChunksFromSeed(parsedSeed, chunkIndex);
  const targetChunk = targetChunks[0] || null;
  const riskSummaries = await safeLoadArray(indexDir, manifest, 'risk_summaries');
  const riskFlows = await safeLoadArray(indexDir, manifest, 'risk_flows');
  const riskPartialFlows = includePartialFlows
    ? await safeLoadArray(indexDir, manifest, 'risk_partial_flows')
    : [];
  const stats = await safeLoadObject(indexDir, manifest, 'risk_interprocedural_stats');
  const targetChunkUids = new Set(targetChunks
    .map((chunk) => chunk?.chunkUid || chunk?.metaV2?.chunkUid || null)
    .filter(Boolean));
  const relevantFlows = targetChunkUids.size > 0
    ? filterRiskFlows((Array.isArray(riskFlows) ? riskFlows : []).filter((flow) => {
      const pathChunkUids = Array.isArray(flow?.path?.chunkUids) ? flow.path.chunkUids : [];
      return targetChunkUids.has(flow?.source?.chunkUid || null)
        || targetChunkUids.has(flow?.sink?.chunkUid || null)
        || pathChunkUids.some((chunkUid) => targetChunkUids.has(chunkUid));
    }), filters)
    : [];
  const relevantPartialFlows = includePartialFlows && targetChunkUids.size > 0
    ? filterRiskPartialFlows((Array.isArray(riskPartialFlows) ? riskPartialFlows : []).filter((flow) => {
      const pathChunkUids = Array.isArray(flow?.path?.chunkUids) ? flow.path.chunkUids : [];
      return targetChunkUids.has(flow?.source?.chunkUid || null)
        || targetChunkUids.has(flow?.frontier?.chunkUid || null)
        || pathChunkUids.some((chunkUid) => targetChunkUids.has(chunkUid));
    }), filters)
    : [];
  relevantFlows.sort((left, right) => String(left?.flowId || '').localeCompare(String(right?.flowId || '')));
  relevantPartialFlows.sort((left, right) => String(left?.partialFlowId || '').localeCompare(String(right?.partialFlowId || '')));
  const summaryRows = targetChunkUids.size > 0 && Array.isArray(riskSummaries)
    ? riskSummaries.filter((row) => targetChunkUids.has(row?.chunkUid || null))
    : [];
  const summaryFromChunk = targetChunk?.docmeta?.risk?.summary || targetChunk?.metaV2?.risk?.summary || null;
  const normalizedFlows = relevantFlows.map(normalizeFlowEntry);
  const normalizedPartialFlows = relevantPartialFlows.map(normalizePartialFlowEntry);
  return {
    requestedRef,
    canonical: resolved.canonical,
    identity: resolved.identity || null,
    snapshot: resolved.snapshot || null,
    warnings: Array.isArray(resolved.warnings) ? resolved.warnings.slice() : [],
    seedStatus: targetChunk ? 'resolved' : 'missing',
    target: normalizeChunkSubject(targetChunk),
    summary: summaryFromChunk
      ? normalizeRiskSummary(summaryFromChunk, relevantFlows)
      : aggregateRiskSummary(summaryRows, targetChunks, relevantFlows),
    stats: summarizeRiskStats(stats),
    provenance: {
      manifestVersion: Number.isFinite(manifest?.version) ? manifest.version : null,
      artifactSurfaceVersion: manifest?.artifactSurfaceVersion || null,
      indexIdentity: resolved.identity || null,
      ruleBundle: stats?.provenance?.ruleBundle || null,
      artifacts: stats?.artifacts || null
    },
    flows: normalizedFlows,
    partialFlows: normalizedPartialFlows
  };
};

export async function buildRiskDeltaPayload({
  repoRoot,
  userConfig = null,
  from,
  to,
  seed,
  filters = null,
  includePartialFlows = false
} = {}) {
  const resolvedRepoRoot = typeof repoRoot === 'string' && repoRoot.trim() ? repoRoot : null;
  if (!resolvedRepoRoot) {
    throw invalidRequest('repoRoot is required.');
  }
  const fromRef = typeof from === 'string' && from.trim() ? from.trim() : '';
  const toRef = typeof to === 'string' && to.trim() ? to.trim() : '';
  if (!fromRef || !toRef) {
    throw invalidRequest('Both from and to refs are required.');
  }
  const parsedSeed = parseSeedRef(seed, resolvedRepoRoot);
  const normalizedFilters = normalizeRiskFilters(filters);
  const validation = validateRiskFilters(normalizedFilters);
  if (!validation.ok) {
    throw invalidRequest(`Invalid risk filters: ${validation.errors.join('; ')}`, {
      reason: 'invalid_risk_filters'
    });
  }

  const [fromSlice, toSlice] = await Promise.all([
    loadRiskSliceForRef({
      repoRoot: resolvedRepoRoot,
      userConfig,
      requestedRef: fromRef,
      parsedSeed,
      filters: normalizedFilters,
      includePartialFlows
    }),
    loadRiskSliceForRef({
      repoRoot: resolvedRepoRoot,
      userConfig,
      requestedRef: toRef,
      parsedSeed,
      filters: normalizedFilters,
      includePartialFlows
    })
  ]);

  if (fromSlice.seedStatus !== 'resolved' && toSlice.seedStatus !== 'resolved') {
    throw invalidRequest(`Seed could not be resolved in either ref: ${seed}`);
  }

  const flowDelta = buildDeltaBucket({
    beforeEntries: fromSlice.flows,
    afterEntries: toSlice.flows,
    idField: 'flowId'
  });
  const partialFlowDelta = buildDeltaBucket({
    beforeEntries: fromSlice.partialFlows,
    afterEntries: toSlice.partialFlows,
    idField: 'partialFlowId'
  });

  return {
    version: RISK_DELTA_VERSION,
    seed: parsedSeed,
    filters: materializeRiskFilters(normalizedFilters),
    includePartialFlows: includePartialFlows === true,
    from: fromSlice,
    to: toSlice,
    summary: {
      flowCounts: {
        from: fromSlice.flows.length,
        to: toSlice.flows.length,
        added: flowDelta.added.length,
        removed: flowDelta.removed.length,
        changed: flowDelta.changed.length,
        unchanged: flowDelta.unchangedCount
      },
      partialFlowCounts: {
        from: fromSlice.partialFlows.length,
        to: toSlice.partialFlows.length,
        added: partialFlowDelta.added.length,
        removed: partialFlowDelta.removed.length,
        changed: partialFlowDelta.changed.length,
        unchanged: partialFlowDelta.unchangedCount
      }
    },
    deltas: {
      flows: flowDelta,
      partialFlows: partialFlowDelta
    }
  };
}
