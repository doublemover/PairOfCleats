import { callArgumentView } from '../../contracts/call-arguments.js';
import { runtimeParameterSlots, runtimeParameterFor } from '../../contracts/callable-parameters.js';
import { sha1 } from '../../shared/hash.js';
import { toArray } from '../../shared/iterables.js';
import { edgeKey, sampleCallSitesForEdge } from './edges.js';
import { containsIdentifier, matchRulePatterns, SEVERITY_RANK } from '../risk/shared.js';
import { compileRiskInterproceduralSemantics } from './semantics.js';
import { createRiskStateQueue } from './state-queue.js';
import { createRiskWitness, matchesRiskWitnessExtension, materializeRiskWitness } from './witness.js';
import { aggregateRiskInputCoverage } from './input-coverage.js';

const ROW_SCHEMA_VERSION = 1;
const MAX_FLOW_ROW_BYTES = 32 * 1024;
const MAX_WATCH_IDENTIFIERS_PER_STEP = 6;
const MAX_WATCH_BINDINGS_PER_STEP = 4;
const MAX_WATCH_SEMANTICS_PER_STEP = 4;

const sortByKey = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

const buildFlowId = ({ sourceChunkUid, sourceRuleId, sinkChunkUid, sinkRuleId, pathChunkUids }) => {
  const key = `${sourceChunkUid}|${sourceRuleId}|${sinkChunkUid}|${sinkRuleId}|${toArray(pathChunkUids).join('>')}`;
  return `sha1:${sha1(key)}`;
};

const buildPartialFlowId = ({ sourceChunkUid, sourceRuleId, frontierChunkUid, terminalReason, pathChunkUids }) => {
  const key = `${sourceChunkUid}|${sourceRuleId}|${frontierChunkUid}|${terminalReason}|${toArray(pathChunkUids).join('>')}`;
  return `sha1:${sha1(key)}`;
};

const sanitizeIdentifier = (value) => (value == null ? '' : String(value));
const uniqueSortedStrings = (values, limit = null) => {
  const items = Array.from(new Set(toArray(values).map((entry) => String(entry || '').trim()).filter(Boolean))).sort();
  return Number.isFinite(limit) ? items.slice(0, limit) : items;
};

const uniqueSortedIndices = (values, limit = null) => {
  const items = Array.from(new Set(toArray(values)
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry >= 0)
    .map((entry) => Math.floor(entry))))
    .sort((a, b) => a - b);
  return Number.isFinite(limit) ? items.slice(0, limit) : items;
};

const normalizeChunkLanguage = (chunk) => (
  chunk?.lang
  || chunk?.segment?.languageId
  || chunk?.containerLanguageId
  || null
);

const normalizeFrameworkIds = (chunk) => {
  const ids = [];
  const frameworkProfile = chunk?.docmeta?.frameworkProfile;
  if (typeof frameworkProfile?.id === 'string' && frameworkProfile.id.trim()) {
    ids.push(frameworkProfile.id.trim());
  }
  return uniqueSortedStrings(ids);
};

const buildSummaryMap = (summaries) => {
  if (summaries && typeof summaries.get === 'function') return summaries;
  const map = new Map();
  if (Array.isArray(summaries)) {
    for (const row of summaries) {
      if (!row || typeof row !== 'object') continue;
      if (!row.chunkUid) continue;
      map.set(row.chunkUid, row);
    }
  }
  return map;
};

const buildChunkMap = (chunks) => {
  const map = new Map();
  for (const chunk of toArray(chunks)) {
    const uid = chunk?.chunkUid || chunk?.metaV2?.chunkUid || null;
    if (uid) map.set(uid, chunk);
  }
  return map;
};

const buildParamNamesMap = (chunks) => {
  const map = new Map();
  for (const chunk of toArray(chunks)) {
    const callerUid = chunk?.chunkUid || chunk?.metaV2?.chunkUid || null;
    if (!callerUid) continue;
    const summaries = Array.isArray(chunk?.codeRelations?.callSummaries)
      ? chunk.codeRelations.callSummaries
      : [];
    for (const summary of summaries) {
      const calleeUid = summary?.resolvedCalleeChunkUid || summary?.targetChunkUid || null;
      if (!calleeUid) continue;
      const params = Array.isArray(summary.params) ? summary.params.filter(Boolean) : [];
      if (!params.length) continue;
      map.set(edgeKey(callerUid, calleeUid), params);
    }
  }
  return map;
};

const buildCallDetailsMap = (chunks) => {
  const detailsByCaller = new Map();
  const calleesByCaller = new Map();
  const edgeKeys = new Set();
  for (const chunk of toArray(chunks)) {
    const callerUid = chunk?.chunkUid || chunk?.metaV2?.chunkUid || null;
    if (!callerUid) continue;
    const details = Array.isArray(chunk?.codeRelations?.callDetails)
      ? chunk.codeRelations.callDetails
      : [];
    if (!details.length) continue;
    for (const detail of details) {
      const calleeUid = detail?.targetChunkUid || null;
      if (!calleeUid) continue;
      let byCallee = detailsByCaller.get(callerUid);
      if (!byCallee) {
        byCallee = new Map();
        detailsByCaller.set(callerUid, byCallee);
      }
      const list = byCallee.get(calleeUid) || [];
      list.push(detail);
      byCallee.set(calleeUid, list);

      const calleeSet = calleesByCaller.get(callerUid) || new Set();
      calleeSet.add(calleeUid);
      calleesByCaller.set(callerUid, calleeSet);
      edgeKeys.add(edgeKey(callerUid, calleeUid));
    }
  }
  return { detailsByCaller, calleesByCaller, edgeKeys };
};

const sortSinks = (sinks) => {
  const list = Array.isArray(sinks) ? sinks.slice() : [];
  list.sort((a, b) => {
    const rankA = SEVERITY_RANK[a?.severity] || 0;
    const rankB = SEVERITY_RANK[b?.severity] || 0;
    if (rankA !== rankB) return rankB - rankA;
    return sortByKey(sanitizeIdentifier(a?.ruleId), sanitizeIdentifier(b?.ruleId));
  });
  return list;
};

const isArgTainted = (argText, taintedIdentifiers, sourceRules) => {
  const text = String(argText || '').trim();
  if (!text) return false;
  for (const name of toArray(taintedIdentifiers)) {
    if (containsIdentifier(text, name)) return true;
  }
  for (const rule of toArray(sourceRules)) {
    if (matchRulePatterns(text, rule)) return true;
  }
  return false;
};

const resolveParamNames = ({ edgeParamNames, calleeChunk }) => {
  if (calleeChunk?.docmeta?.callableParameters) {
    const slots = runtimeParameterSlots(calleeChunk.docmeta);
    const names = [];
    for (const slot of slots) names[slot.runtimeOrdinal] = slot.binding === 'identifier' ? slot.name : null;
    return Array.from(names, name => name || null);
  }
  if (Array.isArray(edgeParamNames) && edgeParamNames.length) return edgeParamNames;
  const docmetaParams = Array.isArray(calleeChunk?.docmeta?.paramNames)
    ? calleeChunk.docmeta.paramNames
    : (Array.isArray(calleeChunk?.docmeta?.params) ? calleeChunk.docmeta.params : []);
  return docmetaParams.filter(Boolean);
};

const buildTaintSetKey = (values) => {
  if (!values || !values.length) return null;
  const unique = Array.from(new Set(values.map((entry) => String(entry).trim()).filter(Boolean)));
  unique.sort();
  return unique.length ? JSON.stringify(unique) : null;
};

const flowConfidence = ({ source, sink, hopCount, sanitizerBarriersHit, sanitizerPolicy }) => {
  const sourceConf = Number.isFinite(source?.confidence) ? source.confidence : 0.5;
  const sinkConf = Number.isFinite(sink?.confidence) ? sink.confidence : 0.5;
  const base = Math.sqrt(Math.max(0, sourceConf) * Math.max(0, sinkConf));
  let score = base;
  score *= 0.85 ** Math.max(0, hopCount);
  if (sanitizerPolicy === 'weaken' && sanitizerBarriersHit > 0) {
    score *= 0.9 ** sanitizerBarriersHit;
  }
  return Math.max(0.05, Math.min(1, score));
};

const propagationConfidence = ({ sourceConfidence, hopCount, sanitizerBarriersHit, sanitizerPolicy }) => {
  const base = Number.isFinite(sourceConfidence) ? sourceConfidence : 0.5;
  let score = base;
  score *= 0.85 ** Math.max(0, hopCount);
  if (sanitizerPolicy === 'weaken' && sanitizerBarriersHit > 0) {
    score *= 0.9 ** sanitizerBarriersHit;
  }
  return Math.max(0.05, Math.min(1, score));
};

const roundConfidence = (value) => (Number.isFinite(value) ? Number(value.toFixed(4)) : null);

const compactWatchByStep = (watchByStep, identifierLimit = 2, bindingLimit = 2) => toArray(watchByStep).map((entry) => ({
  ...entry,
  taintIn: toArray(entry?.taintIn).slice(0, identifierLimit),
  taintOut: toArray(entry?.taintOut).slice(0, identifierLimit),
  propagatedArgIndices: toArray(entry?.propagatedArgIndices).slice(0, bindingLimit),
  boundParams: toArray(entry?.boundParams).slice(0, bindingLimit),
  semanticIds: toArray(entry?.semanticIds).slice(0, MAX_WATCH_SEMANTICS_PER_STEP),
  semanticKinds: toArray(entry?.semanticKinds).slice(0, MAX_WATCH_SEMANTICS_PER_STEP)
}));

const matchesCompiledPatterns = (text, patterns) => {
  const value = typeof text === 'string' ? text : null;
  if (!value) return false;
  for (const pattern of toArray(patterns)) {
    if (!pattern) continue;
    try {
      pattern.lastIndex = 0;
      if (pattern.test(value)) return true;
    } catch {
      continue;
    }
  }
  return false;
};

const resolveEdgeSemantics = ({ semantics, callerChunk, calleeChunk, details }) => {
  const callerLanguage = normalizeChunkLanguage(callerChunk);
  const calleeLanguage = normalizeChunkLanguage(calleeChunk);
  const languages = uniqueSortedStrings([callerLanguage, calleeLanguage]);
  const frameworks = uniqueSortedStrings([
    ...normalizeFrameworkIds(callerChunk),
    ...normalizeFrameworkIds(calleeChunk)
  ]);
  const calleeNames = uniqueSortedStrings([
    calleeChunk?.name,
    ...toArray(details).flatMap((detail) => [detail?.calleeNormalized, detail?.calleeRaw])
  ]);
  const matched = [];
  for (const entry of toArray(semantics)) {
    if (!entry) continue;
    if (Array.isArray(entry.languages) && entry.languages.length) {
      const entryLanguages = new Set(entry.languages.map((value) => String(value).toLowerCase()));
      if (!languages.some((value) => entryLanguages.has(String(value).toLowerCase()))) continue;
    }
    if (Array.isArray(entry.frameworks) && entry.frameworks.length) {
      const entryFrameworks = new Set(entry.frameworks.map((value) => String(value).toLowerCase()));
      if (!frameworks.some((value) => entryFrameworks.has(String(value).toLowerCase()))) continue;
    }
    if (!calleeNames.some((value) => matchesCompiledPatterns(value, entry.compiledPatterns || entry.patterns))) continue;
    matched.push(entry);
  }
  matched.sort((a, b) => sortByKey(a.id, b.id));
  return matched;
};

const applyEdgeSemantics = ({ semantics, taintedArgIndices, paramNames, nextTaint }) => {
  const taintedSet = new Set(uniqueSortedIndices(taintedArgIndices));
  const augmentedTaint = new Set(toArray(nextTaint).filter(Boolean));
  const applied = [];
  for (const entry of toArray(semantics)) {
    const fromArgs = Array.isArray(entry?.fromArgs) && entry.fromArgs.length
      ? entry.fromArgs
      : Array.from(taintedSet.values());
    const triggered = fromArgs.some((value) => taintedSet.has(value));
    if (!triggered) continue;
    applied.push(entry);
    for (const paramIndex of toArray(entry?.toParams)) {
      const name = Array.isArray(paramNames) ? paramNames[paramIndex] : null;
      if (name) augmentedTaint.add(name);
    }
    for (const hint of toArray(entry?.taintHints)) {
      if (hint) augmentedTaint.add(hint);
    }
  }
  return {
    applied,
    nextTaint: uniqueSortedStrings(Array.from(augmentedTaint.values()))
  };
};

const buildWatchStep = ({
  state,
  nextTaint,
  taintedArgIndices,
  paramNames,
  details,
  hasSanitizers,
  sanitizerPolicy,
  semantics = []
}) => {
  const normalizedArgIndices = uniqueSortedIndices(taintedArgIndices, MAX_WATCH_BINDINGS_PER_STEP);
  const boundParams = uniqueSortedStrings(
    normalizedArgIndices
      .map((index) => (Array.isArray(paramNames) ? paramNames[index] : null))
      .filter(Boolean),
    MAX_WATCH_BINDINGS_PER_STEP
  );
  const taintIn = uniqueSortedStrings(state?.taintList, MAX_WATCH_IDENTIFIERS_PER_STEP);
  const taintOut = uniqueSortedStrings(nextTaint, MAX_WATCH_IDENTIFIERS_PER_STEP);
  const barrierApplied = sanitizerPolicy === 'weaken' && hasSanitizers;
  const barriersBefore = Number.isFinite(state?.sanitizerBarriersHit) ? state.sanitizerBarriersHit : 0;
  const barriersAfter = barriersBefore + (barrierApplied ? 1 : 0);
  const sourceConfidence = state?.rootSource?.source?.confidence;
  const confidenceBefore = propagationConfidence({
    sourceConfidence,
    hopCount: Math.max(0, state.depth),
    sanitizerBarriersHit: barriersBefore,
    sanitizerPolicy
  });
  const confidenceAfter = propagationConfidence({
    sourceConfidence,
    hopCount: Math.max(0, state.depth + 1),
    sanitizerBarriersHit: barriersAfter,
    sanitizerPolicy
  });
  const calleeNormalized = uniqueSortedStrings(
    toArray(details).map((detail) => detail?.calleeNormalized || detail?.calleeRaw || null),
    1
  )[0] || null;
  return {
    taintIn,
    taintOut,
    propagatedArgIndices: normalizedArgIndices,
    boundParams,
    calleeNormalized,
    semanticIds: uniqueSortedStrings(toArray(semantics).map((entry) => entry?.id), MAX_WATCH_SEMANTICS_PER_STEP),
    semanticKinds: uniqueSortedStrings(toArray(semantics).map((entry) => entry?.kind), MAX_WATCH_SEMANTICS_PER_STEP),
    sanitizerPolicy: sanitizerPolicy || null,
    sanitizerBarrierApplied: barrierApplied,
    sanitizerBarriersBefore: barriersBefore,
    sanitizerBarriersAfter: barriersAfter,
    confidenceBefore: roundConfidence(confidenceBefore),
    confidenceAfter: roundConfidence(confidenceAfter),
    confidenceDelta: roundConfidence(confidenceAfter - confidenceBefore)
  };
};

const serializeSemanticsForConfig = (semantics) => toArray(semantics).map((entry) => ({
  id: typeof entry?.id === 'string' ? entry.id : null,
  kind: typeof entry?.kind === 'string' ? entry.kind : null,
  name: typeof entry?.name === 'string' ? entry.name : null,
  languages: uniqueSortedStrings(entry?.languages || []),
  frameworks: uniqueSortedStrings(entry?.frameworks || []),
  patterns: uniqueSortedStrings(entry?.patterns || []),
  fromArgs: uniqueSortedIndices(entry?.fromArgs || []),
  toParams: uniqueSortedIndices(entry?.toParams || []),
  taintHints: uniqueSortedStrings(entry?.taintHints || [])
}));

const measureRowBytes = (row) => Buffer.byteLength(JSON.stringify(row), 'utf8');

const keepFirstCallSiteIdByStep = (callSiteIdsByStep) => toArray(callSiteIdsByStep).map((list) => {
  if (!Array.isArray(list) || !list.length) return [];
  return [list[0]];
});

const clearCallSiteIdsByStep = (callSiteIdsByStep) => toArray(callSiteIdsByStep).map(() => []);

const trimFlowRow = (row) => {
  if (measureRowBytes(row) <= MAX_FLOW_ROW_BYTES) return row;
  const trimmed = { ...row, path: { ...row.path } };
  trimmed.path.watchByStep = compactWatchByStep(trimmed.path.watchByStep);
  if (measureRowBytes(trimmed) <= MAX_FLOW_ROW_BYTES) return trimmed;
  trimmed.path.callSiteIdsByStep = keepFirstCallSiteIdByStep(trimmed.path.callSiteIdsByStep);
  if (measureRowBytes(trimmed) <= MAX_FLOW_ROW_BYTES) return trimmed;
  trimmed.path.callSiteIdsByStep = clearCallSiteIdsByStep(trimmed.path.callSiteIdsByStep);
  if (measureRowBytes(trimmed) <= MAX_FLOW_ROW_BYTES) return trimmed;
  trimmed.path.watchByStep = [];
  if (measureRowBytes(trimmed) <= MAX_FLOW_ROW_BYTES) return trimmed;
  return null;
};

const trimPartialFlowRow = (row) => {
  if (measureRowBytes(row) <= MAX_FLOW_ROW_BYTES) return row;
  const trimmed = {
    ...row,
    path: { ...row.path },
    frontier: {
      ...row.frontier,
      blockedExpansions: Array.isArray(row?.frontier?.blockedExpansions)
        ? row.frontier.blockedExpansions.map((entry) => ({
          ...entry,
          callSiteIds: Array.isArray(entry?.callSiteIds) && entry.callSiteIds.length ? [entry.callSiteIds[0]] : []
        }))
        : []
    }
  };
  trimmed.path.watchByStep = compactWatchByStep(trimmed.path.watchByStep);
  if (measureRowBytes(trimmed) <= MAX_FLOW_ROW_BYTES) return trimmed;
  trimmed.path.callSiteIdsByStep = keepFirstCallSiteIdByStep(trimmed.path.callSiteIdsByStep);
  if (measureRowBytes(trimmed) <= MAX_FLOW_ROW_BYTES) return trimmed;
  trimmed.frontier.blockedExpansions = [];
  if (measureRowBytes(trimmed) <= MAX_FLOW_ROW_BYTES) return trimmed;
  trimmed.path.callSiteIdsByStep = clearCallSiteIdsByStep(trimmed.path.callSiteIdsByStep);
  if (measureRowBytes(trimmed) <= MAX_FLOW_ROW_BYTES) return trimmed;
  trimmed.path.watchByStep = [];
  if (measureRowBytes(trimmed) <= MAX_FLOW_ROW_BYTES) return trimmed;
  return null;
};

const buildArtifactRef = ({ name, format = 'jsonl', sharded, entrypoint, totalEntries }) => ({
  name,
  format,
  sharded: !!sharded,
  entrypoint,
  totalEntries
});

const buildFlowSourceEndpoint = (rootSource) => ({
  chunkUid: rootSource.chunkUid,
  ruleId: rootSource.source.ruleId,
  ruleName: rootSource.source.ruleName || rootSource.source.ruleId,
  ruleType: 'source',
  category: rootSource.source.category || null,
  severity: null,
  confidence: Number.isFinite(rootSource.source.confidence)
    ? rootSource.source.confidence
    : null,
  tags: Array.isArray(rootSource.source.tags) ? rootSource.source.tags.filter(Boolean) : []
});

export const computeInterproceduralRisk = ({
  chunks,
  summaries,
  runtime,
  mode = 'code',
  log = null,
  summaryTimingMs = 0,
  summaryStats = null,
  crossFileCoverage = null
} = {}) => {
  const start = Date.now();
  const config = runtime?.riskInterproceduralConfig || {};
  const caps = config.caps || {};
  const strictness = config.strictness || 'conservative';
  const sanitizerPolicy = config.sanitizerPolicy || 'terminate';
  const enabled = config.enabled === true && runtime?.riskInterproceduralEnabled === true;
  const summaryOnly = config.summaryOnly === true;

  const summaryMap = buildSummaryMap(summaries);
  const summaryRows = Array.from(summaryMap.values());
  const summaryByUid = summaryMap;
  const chunkByUid = buildChunkMap(chunks);
  const paramNamesByEdge = buildParamNamesMap(chunks);
  const { detailsByCaller, calleesByCaller, edgeKeys } = buildCallDetailsMap(chunks);

  const resolvedMode = mode || 'code';
  const maxCallSitesPerEdge = Number.isFinite(caps.maxCallSitesPerEdge)
    ? Math.max(1, Math.floor(caps.maxCallSitesPerEdge))
    : null;
  const stats = {
    schemaVersion: ROW_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: resolvedMode,
    status: 'disabled',
    reason: null,
    effectiveConfig: {
      enabled,
      summaryOnly: summaryOnly,
      strictness,
      emitArtifacts: config.emitArtifacts || 'jsonl',
      sanitizerPolicy,
      semantics: serializeSemanticsForConfig(config.semantics),
      caps: {
        maxDepth: caps.maxDepth ?? null,
        maxPathsPerPair: caps.maxPathsPerPair ?? null,
        maxTotalFlows: caps.maxTotalFlows ?? null,
        maxPartialFlows: caps.maxPartialFlows ?? null,
        maxCallSitesPerEdge: caps.maxCallSitesPerEdge ?? null,
        maxBlockedExpansionsPerPartial: caps.maxBlockedExpansionsPerPartial ?? null,
        maxEdgeExpansions: caps.maxEdgeExpansions ?? null,
        maxMs: caps.maxMs ?? null
      }
    },
    counts: {
      chunksConsidered: summaryRows.length,
      summariesEmitted: summaryRows.length,
      sourceRoots: 0,
      resolvedEdges: edgeKeys.size,
      flowsEmitted: 0,
      partialFlowsEmitted: 0,
      risksWithFlows: 0,
      uniqueCallSitesReferenced: 0
    },
    callSiteSampling: {
      strategy: 'firstN',
      maxCallSitesPerEdge,
      order: 'file,startLine,startCol,endLine,endCol,calleeNormalized,calleeRaw,callSiteId'
    },
    capsHit: [],
    timingMs: {
      summaries: Number.isFinite(summaryTimingMs) ? summaryTimingMs : 0,
      propagation: 0,
      io: 0,
      total: 0
    },
    artifacts: {}
  };
  stats.inputCoverage = aggregateRiskInputCoverage(summaryRows, summaryStats, crossFileCoverage);
  stats.executionStatus = 'completed';

  if (!enabled || summaryOnly) {
    stats.status = summaryOnly ? (stats.inputCoverage.status === 'complete' ? 'ok' : 'partial') : 'disabled';
    stats.reason = !enabled ? 'disabled' : null;
    stats.timingMs.total = stats.timingMs.summaries + stats.timingMs.io;
    return {
      status: stats.status,
      summaryRows,
      flowRows: [],
      partialFlowRows: [],
      stats,
      callSiteIdsReferenced: new Set()
    };
  }

  const flowRows = [];
  const partialFlowRows = [];
  const partialFlowIds = new Set();
  const callSiteIdsReferenced = new Set();
  const capsHit = new Set(stats.inputCoverage.reasons.map(reason => `upstream:${reason}`));
  const sampledEdges = new Map();
  const preparedSinks = new Map(), preparedCallees = new Map(), preparedEdgeMetadata = new Map();
  let preparedEdgeBytes = 0;
  const MAX_PREPARED_EDGE_BYTES = 8 * 1024 * 1024;
  const maxDepth = Number.isFinite(caps.maxDepth) ? Math.max(1, caps.maxDepth) : 1;
  const maxPathsPerPair = Number.isFinite(caps.maxPathsPerPair) ? Math.max(1, caps.maxPathsPerPair) : 1;
  const maxTotalFlows = Number.isFinite(caps.maxTotalFlows) ? Math.max(0, caps.maxTotalFlows) : null;
  const maxPartialFlows = Number.isFinite(caps.maxPartialFlows) ? Math.max(0, caps.maxPartialFlows) : 0;
  const maxEdgeExpansions = Number.isFinite(caps.maxEdgeExpansions) ? Math.max(1, caps.maxEdgeExpansions) : 0;
  const maxBlockedExpansionsPerPartial = Number.isFinite(caps.maxBlockedExpansionsPerPartial)
    ? Math.max(0, caps.maxBlockedExpansionsPerPartial)
    : 0;
  const maxMs = caps.maxMs === null ? null : (Number.isFinite(caps.maxMs) ? Math.max(1, caps.maxMs) : null);

  const sourceRules = Array.isArray(runtime?.riskConfig?.rules?.sources)
    ? runtime.riskConfig.rules.sources
    : [];
  const semantics = compileRiskInterproceduralSemantics(runtime?.riskInterproceduralConfig?.semantics);

  const roots = [];
  for (const [chunkUid, summary] of summaryByUid.entries()) {
    const sources = Array.isArray(summary?.signals?.sources) ? summary.signals.sources : [];
    for (const source of sources) {
      if (!source?.ruleId) continue;
      roots.push({
        chunkUid,
        source
      });
    }
  }
  roots.sort((a, b) => {
    const uidCmp = sortByKey(a.chunkUid, b.chunkUid);
    if (uidCmp) return uidCmp;
    return sortByKey(sanitizeIdentifier(a.source?.ruleId), sanitizeIdentifier(b.source?.ruleId));
  });
  stats.counts.sourceRoots = roots.length;

  if (maxTotalFlows === 0) {
    capsHit.add('maxTotalFlows');
    stats.status = 'ok';
    stats.counts.flowsEmitted = 0;
    stats.counts.partialFlowsEmitted = 0;
    stats.counts.risksWithFlows = 0;
    stats.counts.uniqueCallSitesReferenced = 0;
    stats.capsHit = Array.from(capsHit);
    stats.timingMs.propagation = 0;
    stats.timingMs.total = stats.timingMs.summaries + stats.timingMs.io;
    return {
      status: stats.status,
      summaryRows,
      flowRows: [],
      partialFlowRows: [],
      stats,
      callSiteIdsReferenced: new Set()
    };
  }

  const buildBlockedExpansion = ({ targetChunkUid = null, reason, callSiteIds = [] } = {}) => ({
    targetChunkUid: targetChunkUid || null,
    reason,
    callSiteIds: toArray(callSiteIds).filter(Boolean).slice(0, maxCallSitesPerEdge || undefined)
  });

  const appendPartialFlow = ({ state, terminalReason, blockedExpansions = [], terminalCaps = [] }) => {
    if (!state || maxPartialFlows <= 0) return;
    if (partialFlowRows.length >= maxPartialFlows) {
      capsHit.add('maxPartialFlows');
      return;
    }
    const path = materializeRiskWitness(state.witness);
    const partialFlowId = buildPartialFlowId({
      sourceChunkUid: state.rootSource.chunkUid,
      sourceRuleId: state.rootSource.source.ruleId,
      frontierChunkUid: state.chunkUid,
      terminalReason,
      pathChunkUids: path.chunkUids
    });
    if (partialFlowIds.has(partialFlowId)) return;
    partialFlowIds.add(partialFlowId);
    const frontierCaps = Array.from(new Set([
      ...toArray(capsHit),
      ...toArray(terminalCaps)
    ]));
    const partialFlow = {
      schemaVersion: ROW_SCHEMA_VERSION,
      partialFlowId,
      source: buildFlowSourceEndpoint(state.rootSource),
      frontier: {
        chunkUid: state.chunkUid,
        terminalReason,
        blockedExpansions: toArray(blockedExpansions).slice(0, maxBlockedExpansionsPerPartial)
      },
      path,
      confidence: Math.max(
        0.05,
        flowConfidence({
          source: state.rootSource.source,
          sink: state.rootSource.source,
          hopCount: Math.max(0, state.depth),
          sanitizerBarriersHit: state.sanitizerBarriersHit,
          sanitizerPolicy
        }) * 0.75
      ),
      notes: {
        strictness,
        sanitizerPolicy,
        hopCount: Math.max(0, state.depth),
        sanitizerBarriersHit: state.sanitizerBarriersHit,
        capsHit: frontierCaps,
        terminalReason
      }
    };
    const trimmed = trimPartialFlowRow(partialFlow);
    if (!trimmed) return;
    partialFlowRows.push(trimmed);
  };

  const queue = createRiskStateQueue();
  const visited = new Set();
  const witnessesByState = new Map();
  const pathCounts = new Map();
  const rootTaint = (summary) => {
    if (strictness !== 'argAware') return [];
    const tainted = Array.isArray(summary?.taintHints?.taintedIdentifiers)
      ? summary.taintHints.taintedIdentifiers
      : [];
    return tainted.map((entry) => String(entry).trim()).filter(Boolean);
  };

  for (const root of roots) {
    const summary = summaryByUid.get(root.chunkUid) || null;
    const taintList = rootTaint(summary);
    const taintKey = buildTaintSetKey(taintList);
    const visitKey = JSON.stringify([root.chunkUid,root.source.ruleId,root.chunkUid,taintKey,0]);
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);
    queue.push({
      chunkUid: root.chunkUid,
      rootSource: root,
      witness: createRiskWitness({ chunkUid: root.chunkUid }),
      depth: 0,
      sanitizerBarriersHit: 0,
      taintList,
      taintKey
    });
  }

  let edgeExpansions = 0;
  let timedOut = false;

  while (queue.length) {
    if (maxMs && Date.now() - start > maxMs) {
      timedOut = true;
      capsHit.add('maxMs');
      break;
    }
    const state = queue.pop();
    const summary = summaryByUid.get(state.chunkUid);
    let sinkSignals = preparedSinks.get(state.chunkUid);
    if (!sinkSignals) {
      sinkSignals = sortSinks(summary?.signals?.sinks || []);
      preparedSinks.set(state.chunkUid, sinkSignals);
    }
    if (sinkSignals.length && state.chunkUid !== state.rootSource.chunkUid) {
      for (const sink of sinkSignals) {
        if (!sink?.ruleId) continue;
        const key = `${state.rootSource.chunkUid}|${state.rootSource.source.ruleId}|${state.chunkUid}|${sink.ruleId}`;
        const used = pathCounts.get(key) || 0;
        if (used >= maxPathsPerPair) {
          capsHit.add('maxPathsPerPair');
          continue;
        }
        if (maxTotalFlows !== null && flowRows.length >= maxTotalFlows) {
          capsHit.add('maxTotalFlows');
          break;
        }
        pathCounts.set(key, used + 1);
        const hopCount = state.depth;
        const path = materializeRiskWitness(state.witness);
        const flow = {
          schemaVersion: ROW_SCHEMA_VERSION,
          flowId: buildFlowId({
            sourceChunkUid: state.rootSource.chunkUid,
            sourceRuleId: state.rootSource.source.ruleId,
            sinkChunkUid: state.chunkUid,
            sinkRuleId: sink.ruleId,
            pathChunkUids: path.chunkUids
          }),
          source: buildFlowSourceEndpoint(state.rootSource),
          sink: {
            chunkUid: state.chunkUid,
            ruleId: sink.ruleId,
            ruleName: sink.ruleName || sink.ruleId,
            ruleType: 'sink',
            category: sink.category || null,
            severity: sink.severity || null,
            confidence: Number.isFinite(sink.confidence) ? sink.confidence : null,
            tags: Array.isArray(sink.tags) ? sink.tags.filter(Boolean) : []
          },
          path,
          confidence: flowConfidence({
            source: state.rootSource.source,
            sink,
            hopCount,
            sanitizerBarriersHit: state.sanitizerBarriersHit,
            sanitizerPolicy
          }),
          notes: {
            strictness,
            sanitizerPolicy,
            hopCount,
            sanitizerBarriersHit: state.sanitizerBarriersHit,
            capsHit: Array.from(capsHit)
          }
        };
        const trimmed = trimFlowRow(flow);
        if (!trimmed) {
          stats.droppedRecords = stats.droppedRecords || [];
          const existing = stats.droppedRecords.find((entry) => entry.artifact === 'risk_flows');
          if (existing) {
            existing.count += 1;
          } else {
            stats.droppedRecords.push({ artifact: 'risk_flows', count: 1, reasons: [{ reason: 'rowTooLarge', count: 1 }] });
          }
          continue;
        }
        flowRows.push(trimmed);
        for (const step of toArray(trimmed.path.callSiteIdsByStep)) {
          for (const callSiteId of toArray(step)) {
            if (callSiteId) callSiteIdsReferenced.add(callSiteId);
          }
        }
      }
    }

    if (maxTotalFlows !== null && flowRows.length >= maxTotalFlows) {
      capsHit.add('maxTotalFlows');
      appendPartialFlow({
        state,
        terminalReason: 'maxTotalFlows',
        terminalCaps: ['maxTotalFlows']
      });
      break;
    }

    if (state.depth >= maxDepth) {
      capsHit.add('maxDepth');
      appendPartialFlow({
        state,
        terminalReason: 'maxDepth',
        terminalCaps: ['maxDepth']
      });
      continue;
    }

    const hasSanitizers = Array.isArray(summary?.signals?.sanitizers)
      ? summary.signals.sanitizers.length > 0
      : false;
    if (sanitizerPolicy === 'terminate' && hasSanitizers) {
      appendPartialFlow({
        state,
        terminalReason: 'sanitizerTerminated'
      });
      continue;
    }

    const callees = calleesByCaller.get(state.chunkUid);
    if (!callees || !callees.size) {
      appendPartialFlow({
        state,
        terminalReason: 'noCallees'
      });
      continue;
    }
    let calleeList = preparedCallees.get(state.chunkUid);
    if (!calleeList) {
      calleeList = Array.from(callees).sort(sortByKey);
      preparedCallees.set(state.chunkUid, calleeList);
    }
    let expandedAny = false;
    const blockedExpansions = [];
    let hitExpansionCap = false;
    for (const calleeUid of calleeList) {
      if (maxEdgeExpansions && edgeExpansions >= maxEdgeExpansions) {
        capsHit.add('maxEdgeExpansions');
        blockedExpansions.push(buildBlockedExpansion({
          targetChunkUid: calleeUid,
          reason: 'maxEdgeExpansions'
        }));
        hitExpansionCap = true;
        break;
      }
      edgeExpansions += 1;
      const detailMap = detailsByCaller.get(state.chunkUid);
      const details = detailMap ? detailMap.get(calleeUid) || [] : [];
      if (!details.length) {
        blockedExpansions.push(buildBlockedExpansion({
          targetChunkUid: calleeUid,
          reason: 'noResolvedCallDetails'
        }));
        continue;
      }

      let taintedArgIndices = [];
      if (strictness === 'argAware') {
        const argSet = new Set();
        let incompleteArguments = false;
        for (const detail of details) {
          const view = callArgumentView(detail);
          incompleteArguments ||= !view.complete;
          for (const slot of view.slots) {
            if (slot.runtimeOrdinal !== null && !slot.previewTruncated && !slot.literalType
              && isArgTainted(slot.preview, state.taintList, sourceRules)) argSet.add(slot.runtimeOrdinal);
          }
        }
        if (incompleteArguments) blockedExpansions.push(buildBlockedExpansion({
          targetChunkUid: calleeUid, reason: 'incompleteArgumentEvidence',
          callSiteIds: details.map(detail => detail?.callSiteId).filter(Boolean)
        }));
        taintedArgIndices = Array.from(argSet.values()).sort((a, b) => a - b);
        if (!taintedArgIndices.length) {
          if (incompleteArguments) continue;
          blockedExpansions.push(buildBlockedExpansion({
            targetChunkUid: calleeUid,
            reason: 'untaintedArgs',
            callSiteIds: details.map((detail) => detail?.callSiteId).filter(Boolean)
          }));
          continue;
        }
      }

      const metadataKey = JSON.stringify([state.chunkUid, calleeUid]);
      let preparedEdge = preparedEdgeMetadata.get(metadataKey);
      if (!preparedEdge) {
        const calleeChunk = chunkByUid.get(calleeUid);
        const edgeParams = paramNamesByEdge.get(edgeKey(state.chunkUid, calleeUid)) || null;
        const paramNames = resolveParamNames({ edgeParamNames: edgeParams, calleeChunk });
        const matchedSemantics = resolveEdgeSemantics({ semantics,
          callerChunk: chunkByUid.get(state.chunkUid), calleeChunk, details });
        preparedEdge = { paramNames, matchedSemantics };
        const bytes = metadataKey.length * 2 + paramNames.reduce((sum, name) => sum + String(name).length * 2, 0)
          + matchedSemantics.length * 32 + 96;
        if (preparedEdgeBytes + bytes <= MAX_PREPARED_EDGE_BYTES) {
          preparedEdgeMetadata.set(metadataKey, preparedEdge); preparedEdgeBytes += bytes;
        }
      }
      const { paramNames, matchedSemantics } = preparedEdge;
      const nextTaint = [];
      let appliedSemantics = [];
      if (strictness === 'argAware') {
        if (paramNames.length) {
          for (const idx of taintedArgIndices) {
            const formal = runtimeParameterFor(runtimeParameterSlots(chunkByUid.get(calleeUid)?.docmeta), idx);
            const name = formal?.binding === 'identifier' ? formal.name : paramNames[idx];
            if (name) nextTaint.push(name);
            else blockedExpansions.push(buildBlockedExpansion({ targetChunkUid: calleeUid,
              reason: 'incompleteParameterEvidence', callSiteIds: details.map(detail => detail?.callSiteId).filter(Boolean) }));
          }
        }
        const calleeSummary = summaryByUid.get(calleeUid);
        const calleeHints = Array.isArray(calleeSummary?.taintHints?.taintedIdentifiers)
          ? calleeSummary.taintHints.taintedIdentifiers
          : [];
        for (const name of calleeHints) {
          if (name) nextTaint.push(name);
        }
        const semanticResult = applyEdgeSemantics({
          semantics: matchedSemantics,
          taintedArgIndices,
          paramNames,
          nextTaint
        });
        appliedSemantics = semanticResult.applied;
        nextTaint.length = 0;
        nextTaint.push(...semanticResult.nextTaint);
      } else {
        appliedSemantics = matchedSemantics;
      }
      const taintKey = strictness === 'argAware' ? buildTaintSetKey(nextTaint) : null;
      const nextDepth = state.depth + 1;

      const callerFile = chunkByUid.get(state.chunkUid)?.file || null;
      const samplingKey = JSON.stringify([state.chunkUid, calleeUid, callerFile, caps.maxCallSitesPerEdge ?? null]);
      let sampling = sampledEdges.get(samplingKey);
      if (!sampling) {
        const sampled = sampleCallSitesForEdge(details, { calleeUid, callerFile, maxCallSitesPerEdge: caps.maxCallSitesPerEdge });
        const callSiteIds = Object.freeze(sampled.map(entry => entry.callSiteId).filter(Boolean));
        sampling = { sampled, callSiteIds, callSiteKey: JSON.stringify(callSiteIds) };
        sampledEdges.set(samplingKey, sampling);
      }
      const { sampled, callSiteIds } = sampling;
      const nextBarriers = state.sanitizerBarriersHit + (sanitizerPolicy === 'weaken' && hasSanitizers ? 1 : 0);
      const stateKey = JSON.stringify([state.rootSource.chunkUid,state.rootSource.source.ruleId,
        calleeUid,taintKey,nextDepth,nextBarriers]);
      const witnesses = witnessesByState.get(stateKey) || [];
      if (witnesses.some(witness => matchesRiskWitnessExtension(witness, state.witness, sampling.callSiteKey))) continue;
      if (witnesses.length >= maxPathsPerPair) {
        capsHit.add('maxPathsPerPair');
        blockedExpansions.push(buildBlockedExpansion({ targetChunkUid: calleeUid,
          reason: 'maxPathsPerPair', callSiteIds }));
        continue;
      }
      const watchStep = buildWatchStep({
        state,
        nextTaint,
        taintedArgIndices,
        paramNames,
        details: sampled,
        hasSanitizers,
        sanitizerPolicy,
        semantics: appliedSemantics
      });
      const witness = createRiskWitness({ parent: state.witness, chunkUid: calleeUid, callSiteIds, watch: watchStep });
      witnesses.push(witness);
      witnessesByState.set(stateKey,witnesses);

      queue.push({
        chunkUid: calleeUid,
        rootSource: state.rootSource,
        witness,
        depth: nextDepth,
        sanitizerBarriersHit: nextBarriers,
        taintList: nextTaint,
        taintKey
      });
      expandedAny = true;
    }
    if (hitExpansionCap) {
      appendPartialFlow({
        state,
        terminalReason: 'maxEdgeExpansions',
        blockedExpansions,
        terminalCaps: ['maxEdgeExpansions']
      });
      break;
    }
    const incompleteExpansions = blockedExpansions.filter(value => ['incompleteArgumentEvidence', 'incompleteParameterEvidence'].includes(value.reason));
    if (!expandedAny && blockedExpansions.length || incompleteExpansions.length) {
      appendPartialFlow({
        state,
        terminalReason: (expandedAny ? incompleteExpansions[0] : blockedExpansions[0])?.reason || 'blocked',
        blockedExpansions: expandedAny ? incompleteExpansions : blockedExpansions
      });
    }
  }

  const propagationMs = Date.now() - start;
  stats.timingMs.propagation = propagationMs;
  stats.timingMs.total = stats.timingMs.summaries + propagationMs + stats.timingMs.io;

  if (timedOut) {
    stats.executionStatus = 'timed_out';
    for (const pendingState of queue.pending()) {
      appendPartialFlow({
        state: pendingState,
        terminalReason: 'maxMs',
        terminalCaps: ['maxMs']
      });
    }
    stats.status = 'timed_out';
    stats.reason = 'maxMs';
    stats.counts.flowsEmitted = 0;
    stats.counts.partialFlowsEmitted = partialFlowRows.length;
    stats.counts.risksWithFlows = 0;
    stats.counts.uniqueCallSitesReferenced = 0;
    stats.capsHit = Array.from(capsHit);
    return {
      status: stats.status,
      summaryRows,
      flowRows: [],
      partialFlowRows,
      stats,
      callSiteIdsReferenced: new Set()
    };
  }

  flowRows.sort((a, b) => {
    const sourceCmp = sortByKey(a.source.chunkUid, b.source.chunkUid);
    if (sourceCmp) return sourceCmp;
    const sourceRuleCmp = sortByKey(a.source.ruleId, b.source.ruleId);
    if (sourceRuleCmp) return sourceRuleCmp;
    const sinkCmp = sortByKey(a.sink.chunkUid, b.sink.chunkUid);
    if (sinkCmp) return sinkCmp;
    const sinkRuleCmp = sortByKey(a.sink.ruleId, b.sink.ruleId);
    if (sinkRuleCmp) return sinkRuleCmp;
    const pathCmp = sortByKey(a.path.chunkUids.join('\u0000'), b.path.chunkUids.join('\u0000'));
    if (pathCmp) return pathCmp;
    return sortByKey(a.flowId, b.flowId);
  });

  const riskIdSet = new Set();
  for (const flow of flowRows) {
    if (flow?.sink?.ruleId) riskIdSet.add(flow.sink.ruleId);
  }

  stats.status = stats.inputCoverage.status === 'complete' ? 'ok' : 'partial';
  if (stats.status === 'partial') stats.reason = 'upstream-input-incomplete';
  stats.counts.flowsEmitted = flowRows.length;
  partialFlowRows.sort((a, b) => {
    const sourceCmp = sortByKey(a.source.chunkUid, b.source.chunkUid);
    if (sourceCmp) return sourceCmp;
    const frontierCmp = sortByKey(a.frontier.chunkUid, b.frontier.chunkUid);
    if (frontierCmp) return frontierCmp;
    const reasonCmp = sortByKey(a.frontier.terminalReason, b.frontier.terminalReason);
    if (reasonCmp) return reasonCmp;
    const pathCmp = sortByKey(a.path.chunkUids.join('\u0000'), b.path.chunkUids.join('\u0000'));
    if (pathCmp) return pathCmp;
    return sortByKey(a.partialFlowId, b.partialFlowId);
  });
  stats.counts.partialFlowsEmitted = partialFlowRows.length;
  stats.counts.risksWithFlows = riskIdSet.size;
  stats.counts.uniqueCallSitesReferenced = callSiteIdsReferenced.size;
  stats.capsHit = Array.from(capsHit);

  return {
    status: stats.status,
    summaryRows,
    flowRows,
    partialFlowRows,
    stats,
    callSiteIdsReferenced
  };
};

export const attachArtifactRefs = ({ stats, statsRef, summariesRef, flowsRef, partialFlowsRef, callSitesRef }) => {
  if (!stats || typeof stats !== 'object') return stats;
  const artifacts = stats.artifacts || {};
  if (statsRef) artifacts.stats = statsRef;
  if (summariesRef) artifacts.riskSummaries = summariesRef;
  if (flowsRef) artifacts.riskFlows = flowsRef;
  if (partialFlowsRef) artifacts.riskPartialFlows = partialFlowsRef;
  if (callSitesRef) artifacts.callSites = callSitesRef;
  stats.artifacts = artifacts;
  return stats;
};

export const buildRiskInterproceduralStats = ({ stats, statsRef, summariesRef, flowsRef, partialFlowsRef, callSitesRef }) => (
  attachArtifactRefs({ stats, statsRef, summariesRef, flowsRef, partialFlowsRef, callSitesRef })
);

export const buildRiskInterproceduralArtifactRef = ({ name, format = 'jsonl', sharded, entrypoint, totalEntries }) => (
  buildArtifactRef({ name, format, sharded, entrypoint, totalEntries })
);
