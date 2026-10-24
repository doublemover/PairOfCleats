import { callArgumentView } from '../../contracts/call-arguments.js';
import { runtimeParameterSlots, runtimeParameterFor } from '../../contracts/callable-parameters.js';
import { literalEvidenceType } from '../../contracts/literal-evidence.js';
import { setImmediate as yieldPropagation } from 'node:timers/promises';
import { resolveCrossFileFidelity, resolveCrossFilePropagationBudget, orderCrossFileChunks } from '../cross-file-fidelity.js';
import { createSymbolRefCacheMaintenance } from './symbol-ref-cache-maintenance.js';
import { isShadowedImportCall, collectShadowedImportCallees, unresolvedShadowedImport } from './lexical-call-binding.js';
import { uniqueTypes } from '../../integrations/tooling/providers/shared.js';
import { mergeSymbolicTypeGraphs } from '../../shared/symbolic-types.js';
import { createCrossFileSourceReader } from './source-inputs.js';
import { FLOW_CONFIDENCE, FLOW_SOURCE } from './constants.js';
import { addInferredParam, addInferredReturn } from './apply.js';
import { propagateReturnTypeFact } from './return-evidence.js';
import {
  ensureParamTypeMap,
  extractParamTypes,
  extractReturnCalls,
  extractReturnTypes,
  extractReturnTypeFacts,
  getParamTypeList,
  inferArgType
} from './extract.js';
import { isTypeDeclaration } from './symbols.js';
import { runToolingPass } from './tooling.js';
import { buildSymbolIndex, resolveSymbolRef } from './resolver.js';
import {
  createBundleSizing,
  resolvePropagationParallelOptions,
  updateBundleSizing
} from './bundler.js';
import { throwIfAborted } from '../../shared/abort.js';
import { runWithConcurrency } from '../../shared/concurrency/run-with-queue.js';

const SYMBOL_REF_CACHE_MAX_ENTRIES = 20000;
const SYMBOL_REF_CACHE_TTL_MS = 5 * 60 * 1000;
const TOOLING_PRELOAD_CONCURRENCY_DEFAULT = 8;
const TOOLING_PRELOAD_PROGRESS_HEARTBEAT_MS = 10_000;

const resolveLinkRef = (link) => link?.to || link?.calleeRef || link?.ref || link?.symbolRef || null;

const linkKeys = new WeakMap();
const riskSeverityRank = { low: 1, medium: 2, high: 3 };

const getLinkKeys = (list) => {
  if (!list) return null;
  let keys = linkKeys.get(list);
  if (!keys) {
    keys = new Set();
    linkKeys.set(list, keys);
  }
  return keys;
};

const addLink = (list, link) => {
  if (!link) return;
  const ref = resolveLinkRef(link);
  const resolved = ref?.resolved?.chunkUid || link?.resolvedCalleeChunkUid || link?.targetChunkUid || '';
  const status = ref?.status || '';
  const name = ref?.targetName || link?.name || '';
  const kind = link?.edgeKind || link?.role || '';
  const occurrence = link.callSiteRef ? JSON.stringify(link.callSiteRef) : Number.isSafeInteger(link.start) ? `${link.start}:${link.end}` : '';
  const key = `${kind}:${name}:${resolved}:${status}:${occurrence}`;
  const keys = getLinkKeys(list);
  if (!keys || keys.has(key)) return;
  keys.add(key);
  list.push(link);
};

const formatCandidateId = (candidate) => {
  if (!candidate) return null;
  return candidate.chunkUid || candidate.symbolId || candidate.symbolKey || null;
};

const buildCandidateIds = (symbolRef) => {
  if (!symbolRef || !Array.isArray(symbolRef.candidates)) return [];
  const ids = symbolRef.candidates.map(formatCandidateId).filter(Boolean);
  return ids.length ? ids : [];
};

const syncCallDetailResolution = (detail, symbolRef) => {
  if (!detail || typeof detail !== 'object') return;
  const resolvedChunkUid = symbolRef?.resolved?.chunkUid || null;
  const candidateIds = buildCandidateIds(symbolRef);
  detail.calleeRef = symbolRef || null;
  detail.resolvedCalleeChunkUid = resolvedChunkUid;
  detail.targetChunkUid = resolvedChunkUid;
  detail.targetCandidates = candidateIds;
};

const buildEdgeLink = ({ edgeKind, fromChunkUid, symbolRef, resolvedEntry }) => {
  if (!symbolRef) return null;
  const link = {
    v: 1,
    edgeKind,
    fromChunkUid: fromChunkUid || null,
    to: symbolRef,
    confidence: symbolRef.status === 'resolved' ? 0.7 : 0.4,
    evidence: {
      importNarrowed: !!symbolRef.importHint?.resolvedFile,
      matchedExport: false,
      matchedSignature: false
    }
  };
  if (resolvedEntry) {
    link.legacy = {
      legacy: true,
      target: resolvedEntry.name,
      file: resolvedEntry.file,
      kind: resolvedEntry.kind || null
    };
  }
  return link;
};

const confidenceForHop = (hops) => Math.max(0.2, FLOW_CONFIDENCE * (0.85 ** hops));

const toTypeNameList = (value) => {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === 'string') return [value];
  if (value && typeof value[Symbol.iterator] === 'function') return Array.from(value);
  return [];
};

export async function runCrossFilePropagation({
  rootDir,
  buildRoot,
  chunks,
  log = () => {},
  useTooling = false,
  enableTypeInference = true,
  enableRiskCorrelation = false,
  fileRelations = null,
  inferenceLite = false,
  fidelity = resolveCrossFileFidelity(),
  inferenceLiteHighSignalOnly = true,
  toolingConfig = null,
  toolingTimeoutMs = 60000,
  toolingRetries = 2,
  toolingBreaker = 3,
  toolingLogDir = null,
  symbolicTypeGraphs: inputSymbolicTypeGraphs = [],
  abortSignal = null,
  onProgress = null
}) {
  throwIfAborted(abortSignal);
  chunks = orderCrossFileChunks(chunks);
  const symbolEntries = [];
  const entryChunks = new WeakMap();
  const entryByKey = new Map();
  const entryByUid = new Map();
  const chunkByUid = new Map();
  const fileSet = new Set();
  const symbolRefCache = new Map();
  const callSampleCounts = new Map();
  const symbolRefMaintenance = createSymbolRefCacheMaintenance(symbolRefCache, {
    maxEntries: SYMBOL_REF_CACHE_MAX_ENTRIES, ttlMs: SYMBOL_REF_CACHE_TTL_MS
  });

  for (const chunk of chunks) {
    throwIfAborted(abortSignal);
    if (!chunk?.name) continue;
    if (chunk?.file) fileSet.add(chunk.file);
    const chunkUid = chunk.chunkUid || chunk.metaV2?.chunkUid || null;
    if (chunkUid) chunkByUid.set(chunkUid, chunk);
    const { paramNames, paramTypes } = extractParamTypes(chunk);
    const entry = {
      name: chunk.name,
      file: chunk.file,
      kind: chunk.kind || null,
      chunkUid,
      qualifiedName: chunk.metaV2?.symbol?.qualifiedName || chunk.name,
      symbol: chunk.metaV2?.symbol || null,
      ...(['javascript', 'typescript', 'jsx', 'tsx'].includes(chunk.lang)
        && (Object.hasOwn(chunk.docmeta || {}, 'exported') || Object.hasOwn(chunk.docmeta || {}, 'exportNames'))
        ? { moduleExports: { exported: chunk.docmeta?.exported, exportNames: chunk.docmeta?.exportNames,
          typeOnlyExportNames: chunk.docmeta?.typeOnlyExportNames },
        start: chunk.start, end: chunk.end } : {}),
      returnTypes: extractReturnTypes(chunk),
      typeDeclaration: isTypeDeclaration(chunk.kind),
      paramNames,
      paramTypes: ensureParamTypeMap(paramTypes)
    };
    symbolEntries.push(entry);
    entryChunks.set(entry, chunk);
    entryByKey.set(`${chunk.file}::${chunk.name}`, entry);
    if (chunkUid) {
      entryByUid.set(chunkUid, entry);
    }
  }

  const symbolResolver = buildSymbolIndex(symbolEntries);
  const resolveSymbolRefCached = ({
    targetName,
    kindHint = null,
    fromFile = null,
    runtimeOnly = true
  }) => {
    const name = typeof targetName === 'string' ? targetName : null;
    if (!name) return null;
    const now = Date.now();
    const cacheKey = `${fromFile || ''}\u0001${kindHint || ''}\u0001${name}\u0001${runtimeOnly ? 'runtime' : 'usage'}`;
    const cached = symbolRefCache.get(cacheKey);
    if (cached && Number(cached.ts) >= (now - SYMBOL_REF_CACHE_TTL_MS)) {
      symbolRefCache.delete(cacheKey);
      symbolRefCache.set(cacheKey, cached);
      return cached.value;
    }
    if (cached) {
      symbolRefCache.delete(cacheKey);
    }
    const resolved = resolveSymbolRef({
      targetName: name,
      kindHint,
      fromFile,
      fileRelations,
      symbolIndex: symbolResolver,
      fileSet,
      runtimeOnly
    });
    symbolRefCache.set(cacheKey, { value: resolved || null, ts: now });
    symbolRefMaintenance.inserted(now);
    if (symbolRefCache.size > SYMBOL_REF_CACHE_MAX_ENTRIES) {
      symbolRefMaintenance.prune(now);
    }
    return resolved || null;
  };

  const largeRepoBudget = resolveCrossFilePropagationBudget({
    fidelity,
    chunkCount: chunks.length,
    fileCount: fileSet.size
  });
  const inferenceLiteEnabled = fidelity.mode !== 'comprehensive' && inferenceLite === true;
  const inferenceLiteHighSignalOnlyMode = inferenceLiteEnabled
    && inferenceLiteHighSignalOnly !== false;
  const callSampleLimit = fidelity.mode === 'comprehensive' ? Infinity : largeRepoBudget?.callSampleLimit ?? 25;
  const paramTypeLimit = fidelity.mode === 'comprehensive' ? null : largeRepoBudget?.paramTypeLimit ?? 5;
  if (largeRepoBudget && typeof log === 'function') {
    log(
      `[perf] cross-file budget enabled `
      + `(chunks=${chunks.length}, files=${fileSet.size}, `
      + `callPerChunk=${largeRepoBudget.maxCallLinksPerChunk}, `
      + `usagePerChunk=${largeRepoBudget.maxUsageLinksPerChunk}).`
    );
  }
  if (inferenceLiteEnabled && typeof log === 'function') {
    log(
      `[perf] huge repo inference lite enabled `
      + `(highSignalOnly=${inferenceLiteHighSignalOnlyMode ? 'true' : 'false'}).`
    );
  }

  let linkedCalls = 0;
  let linkedCallSummaries = 0;
  let linkedUsages = 0;
  let inferredReturns = 0;
  let riskFlows = 0;
  let toolingDegradedProviders = 0;
  let toolingDegradedWarnings = 0;
  let toolingDegradedErrors = 0;
  let toolingProvidersExecuted = 0;
  let toolingProvidersContributed = 0;
  let toolingRequests = 0;
  let toolingRequestFailures = 0;
  let toolingRequestTimeouts = 0;
  let droppedCallLinks = 0;
  let droppedCallSummaries = 0;
  let droppedUsageLinks = 0;
  const category = () => ({ visited: 0, unsupported: 0, unresolved: 0, ambiguous: 0, dynamic: 0, self: 0, dropped: 0 });
  const admission = { policy: fidelity, calls: category(), callDetails: category(), usages: category(), affectedChunks: [],
    parameterSamplesDropped: 0, parameterTypesDropped: 0, inferenceLiteEnabled };
  let candidateWork = 0;
  const admitCandidate = async category => {
    category.visited += 1;
    if (++candidateWork % 256 === 0) await yieldPropagation();
    throwIfAborted(abortSignal);
  };
  const maxTotalCallLinks = Number.isFinite(largeRepoBudget?.maxTotalCallLinks)
    ? Math.max(0, Math.floor(largeRepoBudget.maxTotalCallLinks))
    : null;
  const maxTotalUsageLinks = Number.isFinite(largeRepoBudget?.maxTotalUsageLinks)
    ? Math.max(0, Math.floor(largeRepoBudget.maxTotalUsageLinks))
    : null;
  const isCallBudgetExhausted = () => maxTotalCallLinks != null && linkedCalls + linkedCallSummaries >= maxTotalCallLinks;
  const isUsageBudgetExhausted = () => maxTotalUsageLinks != null && linkedUsages >= maxTotalUsageLinks;
  const fileUsageFallbackApplied = new Set();

  const sourceReader = createCrossFileSourceReader({ rootDir, chunks, signal: abortSignal });
  const fileTextByRel = sourceReader.fileTextByFile;
  const getFileText = sourceReader.getText;

  let symbolicTypeGraphs = mergeSymbolicTypeGraphs([], inputSymbolicTypeGraphs);
  const toolingEnabled = useTooling && enableTypeInference && toolingConfig?.autoEnableOnDetect !== false;
  if (toolingEnabled) {
    const filesToLoad = new Set();
    for (const chunk of chunks) {
      if (chunk?.file) filesToLoad.add(chunk.file);
    }
    const preloadFiles = Array.from(filesToLoad);
    const preloadTotal = preloadFiles.length;
    const preloadConcurrency = Math.max(
      1,
      Math.floor(Number(toolingConfig?.preloadFileConcurrency) || TOOLING_PRELOAD_CONCURRENCY_DEFAULT)
    );
    let preloadLoaded = 0;
    const preloadStartMs = Date.now();
    log(
      `[tooling] preload:start files=${preloadTotal} concurrency=${preloadConcurrency}.`
    );
    const preloadHeartbeatTimer = setInterval(() => {
      const elapsedMs = Math.max(0, Date.now() - preloadStartMs);
      log(
        `[tooling] preload:heartbeat loaded=${preloadLoaded}/${preloadTotal} elapsedMs=${elapsedMs}.`
      );
    }, TOOLING_PRELOAD_PROGRESS_HEARTBEAT_MS);
    preloadHeartbeatTimer.unref?.();
    try {
      await runWithConcurrency(preloadFiles, preloadConcurrency, async (file) => {
        throwIfAborted(abortSignal);
        await getFileText(file);
        preloadLoaded += 1;
      }, { signal: abortSignal });
    } finally {
      clearInterval(preloadHeartbeatTimer);
    }
    const preloadElapsedMs = Math.max(0, Date.now() - preloadStartMs);
    log(
      `[tooling] preload:done loaded=${preloadLoaded}/${preloadTotal} elapsedMs=${preloadElapsedMs}.`
    );
    const toolingPassStartMs = Date.now();
    log('[tooling] pass:start stage=cross-file.');
    const toolingResult = await runToolingPass({
      rootDir,
      buildRoot: buildRoot || rootDir,
      chunks,
      entryByUid,
      log,
      toolingConfig,
      toolingTimeoutMs,
      toolingRetries,
      toolingBreaker,
      toolingLogDir,
      fileTextByFile: fileTextByRel,
      abortSignal
    });
    const toolingPassElapsedMs = Math.max(0, Date.now() - toolingPassStartMs);
    log(`[tooling] pass:done stage=cross-file elapsedMs=${toolingPassElapsedMs}.`);
    inferredReturns += toolingResult.inferredReturns || 0;
    toolingDegradedProviders += toolingResult.toolingDegradedProviders || 0;
    toolingDegradedWarnings += toolingResult.toolingDegradedWarnings || 0;
    toolingDegradedErrors += toolingResult.toolingDegradedErrors || 0;
    toolingProvidersExecuted += toolingResult.toolingProvidersExecuted || 0;
    toolingProvidersContributed += toolingResult.toolingProvidersContributed || 0;
    toolingRequests += toolingResult.toolingRequests || 0;
    toolingRequestFailures += toolingResult.toolingRequestFailures || 0;
    toolingRequestTimeouts += toolingResult.toolingRequestTimeouts || 0;
    symbolicTypeGraphs = mergeSymbolicTypeGraphs(symbolicTypeGraphs, toolingResult.symbolicTypeGraphs || []);
  }

  const getChunkText = sourceReader.getChunkText;

  const collectKnownCallees = (chunk) => {
    const known = new Set();
    const relations = chunk?.codeRelations || {};
    if (Array.isArray(relations.calls)) {
      for (const entry of relations.calls) {
        if (!Array.isArray(entry) || entry.length < 2) continue;
        const callee = entry[1];
        if (typeof callee === 'string' && callee) known.add(callee);
      }
    }
    if (Array.isArray(relations.callDetails)) {
      for (const detail of relations.callDetails) {
        const callee = detail?.callee;
        if (typeof callee === 'string' && callee) known.add(callee);
      }
    }
    return known;
  };

  const returnCallsByChunk = new WeakMap();
  const getReturnCalls = async (chunk) => {
    if (!chunk) return { calls: new Set(), news: new Set() };
    const cached = returnCallsByChunk.get(chunk);
    if (cached) return cached;
    const chunkText = await getChunkText(chunk);
    if (!chunkText) {
      const empty = { calls: new Set(), news: new Set() };
      returnCallsByChunk.set(chunk, empty);
      return empty;
    }
    const fileRelation = fileRelations
      ? (typeof fileRelations.get === 'function' ? fileRelations.get(chunk.file) : fileRelations[chunk.file]) : null;
    const parsed = extractReturnCalls(chunkText, { knownCallees: collectKnownCallees(chunk), chunk,
      importBindings: fileRelation?.importBindings,
      admitConstructor: targetName => resolveSymbolRefCached({ targetName, fromFile: chunk.file })?.reason !== 'module-export-unavailable' });
    returnCallsByChunk.set(chunk, parsed);
    return parsed;
  };

  if (enableTypeInference) {
    for (const chunk of chunks) {
      if (!chunk) continue;
      const { news: returnNews } = await getReturnCalls(chunk);
      if (!returnNews.size) continue;
      if (!chunk.docmeta || typeof chunk.docmeta !== 'object') chunk.docmeta = {};
      for (const typeName of returnNews) {
        if (addInferredReturn(chunk.docmeta, typeName, FLOW_SOURCE, FLOW_CONFIDENCE)) {
          inferredReturns += 1;
        }
        const entry = chunk.chunkUid
          ? entryByUid.get(chunk.chunkUid)
          : entryByKey.get(`${chunk.file}::${chunk.name}`);
        if (entry) {
          entry.returnTypes = uniqueTypes([...toTypeNameList(entry.returnTypes), typeName]);
        }
      }
    }
  }

  // Own one seed snapshot after tooling and constructor inference. Do not feed
  // later mutations back into this pass or make results depend on bundle order.
  for (const entry of symbolEntries) {
    const chunk = entryChunks.get(entry);
    entry.returnTypeFacts = extractReturnTypeFacts(chunk);
    entry.returnTypes = uniqueTypes(entry.returnTypeFacts.map(fact => fact.type));
  }

  const normalizeRisk = (chunk) => {
    if (!chunk) return null;
    if (!chunk.docmeta || typeof chunk.docmeta !== 'object') chunk.docmeta = {};
    const base = chunk.docmeta.risk && typeof chunk.docmeta.risk === 'object'
      ? chunk.docmeta.risk
      : {};
    const risk = {
      ...base,
      tags: Array.isArray(base.tags) ? base.tags.slice() : [],
      categories: Array.isArray(base.categories) ? base.categories.slice() : [],
      sources: Array.isArray(base.sources) ? base.sources.slice() : [],
      sinks: Array.isArray(base.sinks) ? base.sinks.slice() : [],
      flows: Array.isArray(base.flows) ? base.flows.slice() : []
    };
    chunk.docmeta.risk = risk;
    return risk;
  };

  const addUnique = (list, value) => {
    if (!value) return;
    if (!list.includes(value)) list.push(value);
  };

  const riskFlowKeys = new WeakMap();
  const flowKey = (flow) => `${flow.source}::${flow.sink}::${flow.scope || 'local'}::${flow.via || ''}`;
  const getFlowKeys = (chunk, risk) => {
    if (!chunk || !risk) return null;
    let keys = riskFlowKeys.get(chunk);
    if (!keys) {
      keys = new Set();
      if (Array.isArray(risk.flows)) {
        for (const existing of risk.flows) {
          if (!existing) continue;
          keys.add(flowKey(existing));
        }
      }
      riskFlowKeys.set(chunk, keys);
    }
    return keys;
  };

  const addRiskFlow = (chunk, risk, flow) => {
    if (!risk || !flow) return false;
    const keys = getFlowKeys(chunk, risk);
    if (!keys) return false;
    const key = flowKey(flow);
    if (keys.has(key)) return false;
    keys.add(key);
    risk.flows.push(flow);
    return true;
  };

  const bundleSizing = createBundleSizing({
    chunkCount: chunks.length,
    largeRepoBudget
  });
  let currentBundleSize = bundleSizing.initialBundleSize;
  const {
    propagationParallelEnabled,
    propagationParallelMinBundle
  } = resolvePropagationParallelOptions();

  let propagationParallelLogged = false;
  let chunkCursor = 0;
  while (chunkCursor < chunks.length) {
    throwIfAborted(abortSignal);
    const bundleStart = chunkCursor;
    const bundleEnd = Math.min(chunks.length, bundleStart + currentBundleSize);
    const bundle = chunks.slice(bundleStart, bundleEnd);
    const bundleStartedAt = Date.now();
    const heapBeforeBundle = Number(process.memoryUsage?.().heapUsed) || 0;

    const useParallelPropagation = propagationParallelEnabled
      && enableTypeInference
      && enableRiskCorrelation
      && bundle.length >= propagationParallelMinBundle;
    if (useParallelPropagation && !propagationParallelLogged && typeof log === 'function') {
      propagationParallelLogged = true;
      log(
        `[perf] cross-file propagation parallel mode enabled `
        + `(bundleMin=${propagationParallelMinBundle}).`
      );
    }

    for (const chunk of bundle) {
      throwIfAborted(abortSignal);
      if (!chunk) continue;
      const relations = chunk.codeRelations || {};
      const shadowedImports = collectShadowedImportCallees(relations.callDetails);
      const droppedBefore = [droppedCallLinks, droppedCallSummaries, droppedUsageLinks];
      const fromChunkUid = chunk.chunkUid || chunk.metaV2?.chunkUid || null;
      const fileRelation = fileRelations
        ? (typeof fileRelations.get === 'function'
          ? fileRelations.get(chunk.file)
          : fileRelations[chunk.file])
        : null;
      const callLinks = [];
      const callSummaries = [];
      const usageLinks = [];
      const hasCallSignals = (Array.isArray(relations.calls) && relations.calls.length > 0)
        || (Array.isArray(relations.callDetails) && relations.callDetails.length > 0);
      const hasUsageSignals = Array.isArray(relations.usages) && relations.usages.length > 0;
      const hasFileUsageSignals = !hasUsageSignals
        && !inferenceLiteEnabled
        && Array.isArray(fileRelation?.usages)
        && fileRelation.usages.length > 0
        && typeof chunk?.file === 'string'
        && !fileUsageFallbackApplied.has(chunk.file);
      if (!hasCallSignals && !hasUsageSignals && !hasFileUsageSignals) {
        continue;
      }

      if (Array.isArray(relations.calls)) {
        const maxCallLinksPerChunk = Number.isFinite(largeRepoBudget?.maxCallLinksPerChunk)
          ? Math.max(0, Math.floor(largeRepoBudget.maxCallLinksPerChunk))
          : null;
        const maxCallLinkSource = maxCallLinksPerChunk == null
          ? relations.calls.length
          : Math.min(relations.calls.length, maxCallLinksPerChunk);
        if (maxCallLinkSource < relations.calls.length) {
          droppedCallLinks += relations.calls.length - maxCallLinkSource;
        }
        if (isCallBudgetExhausted()) {
          droppedCallLinks += maxCallLinkSource;
        }
        for (let callIndex = 0; callIndex < maxCallLinkSource && !isCallBudgetExhausted(); callIndex += 1) {
          if (maxTotalCallLinks != null) {
            const remaining = Math.max(0, maxTotalCallLinks - (linkedCalls + linkedCallSummaries + callLinks.length));
            if (remaining <= 0) {
              droppedCallLinks += maxCallLinkSource - callIndex;
              break;
            }
          }
          await admitCandidate(admission.calls);
          const callEntry = relations.calls[callIndex];
          if (!Array.isArray(callEntry) || callEntry.length < 2) { admission.calls.unsupported += 1; continue; }
          const callee = callEntry[1];
          const symbolRef = shadowedImports.only.has(callee) ? unresolvedShadowedImport(callee) : resolveSymbolRefCached({
            targetName: callee,
            kindHint: null,
            fromFile: chunk.file
          });
          if (!symbolRef || symbolRef.status === 'unresolved') admission.calls.unresolved += 1;
          if (!symbolRef) continue;
          if (symbolRef.status === 'ambiguous') admission.calls.ambiguous += 1;
          if (symbolRef.resolved?.chunkUid && symbolRef.resolved.chunkUid === fromChunkUid) admission.calls.self += 1;
          const resolvedEntry = symbolRef.resolved?.chunkUid
            ? entryByUid.get(symbolRef.resolved.chunkUid)
            : null;
          const link = buildEdgeLink({
            edgeKind: 'call',
            fromChunkUid,
            symbolRef,
            resolvedEntry
          });
          addLink(callLinks, link);
        }
      }

      if (Array.isArray(relations.callDetails)) {
        const maxCallSummariesPerChunk = Number.isFinite(largeRepoBudget?.maxCallSummariesPerChunk)
          ? Math.max(0, Math.floor(largeRepoBudget.maxCallSummariesPerChunk))
          : null;
        const maxCallSummarySource = maxCallSummariesPerChunk == null
          ? relations.callDetails.length
          : Math.min(relations.callDetails.length, maxCallSummariesPerChunk);
        if (maxCallSummarySource < relations.callDetails.length) {
          droppedCallSummaries += relations.callDetails.length - maxCallSummarySource;
        }
        if (isCallBudgetExhausted()) {
          droppedCallSummaries += maxCallSummarySource;
        }
        for (let detailIndex = 0; detailIndex < maxCallSummarySource && !isCallBudgetExhausted(); detailIndex += 1) {
          if (maxTotalCallLinks != null) {
            const remaining = Math.max(0, maxTotalCallLinks - (linkedCalls + linkedCallSummaries + callLinks.length + callSummaries.length));
            if (remaining <= 0) {
              droppedCallSummaries += maxCallSummarySource - detailIndex;
              break;
            }
          }
          await admitCandidate(admission.callDetails);
          const detail = relations.callDetails[detailIndex];
          const callee = detail?.callee;
          const dynamicSyntax = !callee && detail?.source === 'tree-sitter'
            && detail.coordinateSystem === 'utf16' && typeof detail.calleeRaw === 'string' && detail.calleeRaw.length > 0;
          if (!callee && !dynamicSyntax) { admission.callDetails.unsupported += 1; continue; }
          // Supported dynamic syntax is unresolved evidence, not unsupported
          // extraction. A display spelling must never become a static target.
          const symbolRef = detail.compilerBinding?.symbolRef || (isShadowedImportCall(detail) ? unresolvedShadowedImport(callee) : callee ? resolveSymbolRefCached({
            targetName: callee,
            kindHint: null,
            fromFile: chunk.file
          }) : null);
          if (!symbolRef || symbolRef.status === 'unresolved') admission.callDetails.unresolved += 1;
          if (symbolRef?.status === 'ambiguous') admission.callDetails.ambiguous += 1;
          if (dynamicSyntax) admission.callDetails.dynamic += 1;
          if (symbolRef?.resolved?.chunkUid === fromChunkUid) admission.callDetails.self += 1;
          syncCallDetailResolution(detail, symbolRef);
          const resolvedEntry = symbolRef?.resolved?.chunkUid
            ? entryByUid.get(symbolRef.resolved.chunkUid)
            : null;
          const args = Array.isArray(detail.args) ? detail.args : [];
          const summary = {
            v: 1,
            name: callee || detail.calleeRaw,
            role: detail.role || 'call',
            resolution: symbolRef?.status || 'unresolved',
            reason: symbolRef?.reason || detail.reason || (dynamicSyntax ? 'dynamic-call-target' : 'syntax-target-unresolved'),
            start: detail.start ?? null, end: detail.end ?? null, callSiteRef: detail.semanticRecordRef || null,
            args,
            ...(Array.isArray(detail.argLiterals) ? { argLiterals: detail.argLiterals } : {}),
            ...(detail.arguments ? { arguments: detail.arguments } : {}),
            calleeRef: symbolRef || null,
            resolvedCalleeChunkUid: symbolRef?.resolved?.chunkUid || null
          };
          if (symbolRef?.resolved?.chunkUid) summary.targetChunkUid = symbolRef.resolved.chunkUid;
          if (resolvedEntry) {
            summary.target = resolvedEntry.name;
            summary.file = resolvedEntry.file;
            summary.kind = resolvedEntry.kind || null;
            summary.legacy = true;
            if (resolvedEntry.returnTypes?.length) summary.returnTypes = resolvedEntry.returnTypes;
            if (resolvedEntry.returnTypeFacts?.length) summary.returnTypeFacts = resolvedEntry.returnTypeFacts;
            if (resolvedEntry.paramNames?.length) summary.params = resolvedEntry.paramNames;
            if (resolvedEntry.paramTypes && Object.keys(resolvedEntry.paramTypes).length) {
              summary.paramTypes = resolvedEntry.paramTypes;
            }
          }
          const parameterSlots = runtimeParameterSlots(resolvedEntry ? chunkByUid.get(resolvedEntry.chunkUid)?.docmeta : null);
          const argMap = Object.create(null);
          for (const slot of callArgumentView(detail).slots) {
            if (slot.runtimeOrdinal === null || slot.previewTruncated) continue;
            const parameter = runtimeParameterFor(parameterSlots, slot.runtimeOrdinal);
            if (parameter?.name && parameter.binding === 'identifier' && !parameter.rest && slot.preview) {
              argMap[parameter.name] = slot.preview;
            }
          }
          if (Object.keys(argMap).length) summary.argMap = argMap;
          addLink(callSummaries, summary);
        }
      }

      const hasChunkUsageSource = Array.isArray(relations.usages);
      const useFileUsageFallback = !hasChunkUsageSource
        && !inferenceLiteEnabled
        && Array.isArray(fileRelation?.usages)
        && typeof chunk?.file === 'string'
        && !fileUsageFallbackApplied.has(chunk.file);
      const usageSource = hasChunkUsageSource
        ? relations.usages
        : (useFileUsageFallback ? fileRelation.usages : null);
      if (useFileUsageFallback) {
        fileUsageFallbackApplied.add(chunk.file);
      }
      if (Array.isArray(usageSource)) {
        const maxUsageLinksPerChunk = Number.isFinite(largeRepoBudget?.maxUsageLinksPerChunk)
          ? Math.max(0, Math.floor(largeRepoBudget.maxUsageLinksPerChunk))
          : null;
        const maxUsageSource = maxUsageLinksPerChunk == null
          ? usageSource.length
          : Math.min(usageSource.length, maxUsageLinksPerChunk);
        if (maxUsageSource < usageSource.length) {
          droppedUsageLinks += usageSource.length - maxUsageSource;
        }
        if (isUsageBudgetExhausted()) {
          droppedUsageLinks += maxUsageSource;
        }
        for (let usageIndex = 0; usageIndex < maxUsageSource && !isUsageBudgetExhausted(); usageIndex += 1) {
          if (maxTotalUsageLinks != null) {
            const remaining = Math.max(0, maxTotalUsageLinks - (linkedUsages + usageLinks.length));
            if (remaining <= 0) {
              droppedUsageLinks += maxUsageSource - usageIndex;
              break;
            }
          }
          await admitCandidate(admission.usages);
          const usage = usageSource[usageIndex];
          const symbolRef = resolveSymbolRefCached({
            targetName: usage,
            kindHint: null,
            fromFile: chunk.file,
            runtimeOnly: false
          });
          if (!symbolRef || symbolRef.status === 'unresolved') admission.usages.unresolved += 1;
          if (!symbolRef) continue;
          if (symbolRef.status === 'ambiguous') admission.usages.ambiguous += 1;
          if (symbolRef.resolved?.chunkUid && symbolRef.resolved.chunkUid === fromChunkUid) admission.usages.self += 1;
          const resolvedEntry = symbolRef.resolved?.chunkUid
            ? entryByUid.get(symbolRef.resolved.chunkUid)
            : null;
          const link = buildEdgeLink({
            edgeKind: 'usage',
            fromChunkUid,
            symbolRef,
            resolvedEntry
          });
          addLink(usageLinks, link);
        }
      }


      const omitted = [droppedCallLinks - droppedBefore[0], droppedCallSummaries - droppedBefore[1], droppedUsageLinks - droppedBefore[2]];
      if (admission.affectedChunks.length < 32 && omitted.some(count => count > 0)) {
        admission.affectedChunks.push({ file: chunk.file || null, chunkUid: fromChunkUid,
          calls: omitted[0], callDetails: omitted[1], usages: omitted[2] });
      }
      if (callLinks.length) {
        relations.callLinks = callLinks;
        linkedCalls += callLinks.length;
      }
      if (callSummaries.length) {
        relations.callSummaries = callSummaries;
        linkedCallSummaries += callSummaries.length;
      }
      if (usageLinks.length) {
        relations.usageLinks = usageLinks;
        linkedUsages += usageLinks.length;
      }
      chunk.codeRelations = relations;

      const runTypePropagation = async () => {
        if (callSummaries.length) {
          for (const summary of callSummaries) {
            const resolvedUid = summary.resolvedCalleeChunkUid || summary.targetChunkUid || null;
            const calleeChunk = resolvedUid ? chunkByUid.get(resolvedUid) : null;
            if (!calleeChunk) continue;
            const sampleKey = resolvedUid || summary.name;
            const currentSamples = callSampleCounts.get(sampleKey) || 0;
            if (currentSamples >= callSampleLimit) { admission.parameterSamplesDropped += 1; continue; }
            callSampleCounts.set(sampleKey, currentSamples + 1);
            const parameterSlots = runtimeParameterSlots(calleeChunk.docmeta);
            const argumentSlots = callArgumentView(summary).slots;
            if (!parameterSlots.length || !argumentSlots.length) continue;
            if (!calleeChunk.docmeta || typeof calleeChunk.docmeta !== 'object') calleeChunk.docmeta = {};
            const hopCount = calleeChunk.file !== chunk.file ? 1 : 0;
            const confidence = confidenceForHop(hopCount);
            for (const slot of argumentSlots) {
              if (slot.runtimeOrdinal === null || slot.previewTruncated) continue;
              const parameter = runtimeParameterFor(parameterSlots, slot.runtimeOrdinal), name = parameter?.name;
              if (!name || parameter.binding !== 'identifier') continue;
              const literal = slot.expansionOrdinal === null ? summary.argLiterals?.[slot.operandOrdinal] : null;
              const type = parameter.rest ? 'array' : slot.literalType
                ? (['string', 'number', 'boolean', 'null', 'bigint', 'undefined'].includes(slot.literalType) ? slot.literalType : null)
                : literal ? literalEvidenceType(literal) : inferArgType(slot.preview);
              if (!type) continue;
              if (addInferredParam(calleeChunk.docmeta, name, type, FLOW_SOURCE, confidence, paramTypeLimit)) {
                const entry = resolvedUid ? entryByUid.get(resolvedUid) : null;
                if (entry) {
                  entry.paramTypes = ensureParamTypeMap(entry.paramTypes);
                  const existing = getParamTypeList(entry.paramTypes, name);
                  entry.paramTypes[name] = uniqueTypes([...existing, type]);
                }
              } else { admission.parameterTypesDropped += 1; }
            }
          }
        }

        if (inferenceLiteEnabled && inferenceLiteHighSignalOnlyMode) {
          return;
        }

        const { calls: returnCalls, callSites: returnCallSites = null } = await getReturnCalls(chunk);
        if (!returnCalls.size) return;
        if (!chunk.docmeta || typeof chunk.docmeta !== 'object') chunk.docmeta = {};
        const resolvedViaSummaries = new Set();
        if (callSummaries.length) {
          for (const summary of callSummaries) {
            const callName = typeof summary?.name === 'string' ? summary.name : null;
            if (!callName || !returnCalls.has(callName)) continue;
            if (!returnCallSites && shadowedImports.all.has(callName)) continue;
            if (returnCallSites && !returnCallSites.has(`${summary.start}:${summary.end}`)) continue;
            const resolvedUid = summary?.resolvedCalleeChunkUid || summary?.targetChunkUid || null;
            const resolvedChunk = resolvedUid ? chunkByUid.get(resolvedUid) : null;
            const returnFacts = Array.isArray(summary?.returnTypeFacts) && summary.returnTypeFacts.length
              ? summary.returnTypeFacts
              : (Array.isArray(entryByUid.get(resolvedUid)?.returnTypeFacts)
                ? entryByUid.get(resolvedUid).returnTypeFacts
                : []);
            if (!returnFacts.length) continue;
            resolvedViaSummaries.add(callName);
            const hopCount = resolvedChunk?.file && resolvedChunk.file !== chunk.file ? 1 : 0;
            const confidence = confidenceForHop(hopCount);
            for (const fact of returnFacts) {
              const propagated = propagateReturnTypeFact(fact, resolvedChunk, confidence);
              if (addInferredReturn(chunk.docmeta, propagated.type, FLOW_SOURCE, propagated.confidence, propagated.evidence)) {
                inferredReturns += 1;
              }
            }
          }
        }
        // Parser-owned return facts authorize only their admitted occurrence.
        // Name fallback would recreate omitted summaries and could borrow a
        // different same-spelling call's binding or declared return type.
        if (returnCallSites) return;
        for (const callName of returnCalls) {
          if (shadowedImports.all.has(callName)) continue;
          if (resolvedViaSummaries.has(callName)) continue;
          const symbolRef = resolveSymbolRefCached({
            targetName: callName,
            kindHint: null,
            fromFile: chunk.file
          });
          if (!symbolRef?.resolved?.chunkUid) continue;
          const entry = entryByUid.get(symbolRef.resolved.chunkUid);
          const returnFacts = entry?.returnTypeFacts || [];
          if (!returnFacts.length) continue;
          const hopCount = entry?.file !== chunk.file ? 1 : 0;
          const confidence = confidenceForHop(hopCount);
          for (const fact of returnFacts) {
            const propagated = propagateReturnTypeFact(fact, entryChunks.get(entry), confidence);
            if (addInferredReturn(chunk.docmeta, propagated.type, FLOW_SOURCE, propagated.confidence, propagated.evidence)) {
              inferredReturns += 1;
            }
          }
        }
      };

      const runRiskPropagation = () => {
        if (inferenceLiteEnabled && inferenceLiteHighSignalOnlyMode) return;
        if (!callLinks.length) return;
        const callerRisk = chunk.docmeta?.risk;
        const callerSources = Array.isArray(callerRisk?.sources) ? callerRisk.sources : [];
        if (!callerSources.length) return;
        for (const link of callLinks) {
          const targetUid = link?.to?.resolved?.chunkUid || null;
          const calleeChunk = targetUid ? chunkByUid.get(targetUid) : null;
          const calleeRisk = calleeChunk?.docmeta?.risk;
          const calleeSinks = Array.isArray(calleeRisk?.sinks) ? calleeRisk.sinks : [];
          if (!calleeSinks.length) continue;
          const risk = normalizeRisk(chunk);
          for (const sink of calleeSinks) {
            if (sink.category) addUnique(risk.categories, sink.category);
            const sinkTags = Array.isArray(sink.tags) && sink.tags.length
              ? sink.tags
              : (Array.isArray(calleeRisk?.tags) ? calleeRisk.tags : []);
            sinkTags.forEach((tag) => addUnique(risk.tags, tag));
            if (sink.severity) {
              const currentRank = riskSeverityRank[risk.severity] || 0;
              const sinkRank = riskSeverityRank[sink.severity] || 0;
              if (sinkRank > currentRank) risk.severity = sink.severity;
            }
          }
          for (const source of callerSources) {
            for (const sink of calleeSinks) {
              const scope = calleeChunk?.file === chunk.file ? 'file' : 'cross-file';
              const flow = {
                source: source.name,
                sink: sink.name,
                category: sink.category || null,
                severity: sink.severity || null,
                scope,
                via: `${chunk.name}->${link.to?.targetName || ''}`,
                confidence: Math.max(0.2, (source.confidence || 0.5) * 0.85),
                ruleIds: [source.ruleId, sink.ruleId].filter(Boolean)
              };
              if (addRiskFlow(chunk, risk, flow)) riskFlows += 1;
            }
          }
        }
      };

      if (enableTypeInference) {
        if (
          useParallelPropagation
          && enableRiskCorrelation
          && callLinks.length
          && !(inferenceLiteEnabled && inferenceLiteHighSignalOnlyMode)
        ) {
          await Promise.all([
            runTypePropagation(),
            Promise.resolve().then(() => runRiskPropagation())
          ]);
        } else {
          await runTypePropagation();
          if (enableRiskCorrelation && !(inferenceLiteEnabled && inferenceLiteHighSignalOnlyMode)) {
            runRiskPropagation();
          }
        }
      } else if (enableRiskCorrelation && !(inferenceLiteEnabled && inferenceLiteHighSignalOnlyMode)) {
        runRiskPropagation();
      }
    }

    const heapAfterBundle = Number(process.memoryUsage?.().heapUsed) || heapBeforeBundle;
    const heapDelta = Math.max(0, heapAfterBundle - heapBeforeBundle);
    const bundleDurationMs = Math.max(0, Date.now() - bundleStartedAt);
    currentBundleSize = updateBundleSizing({
      bundleSizing,
      bundleLength: bundle.length,
      bundleDurationMs,
      heapDelta,
      currentBundleSize,
      log
    });
    chunkCursor = bundleEnd;
    if (onProgress) await onProgress({ observedCompletedChunks: chunkCursor,
      totalChunks: chunks.length, linkedCalls, linkedCallSummaries, linkedUsages, inferredReturns, riskFlows });
    throwIfAborted(abortSignal);
  }

  if (largeRepoBudget && typeof log === 'function') {
    if (droppedCallLinks > 0 || droppedCallSummaries > 0 || droppedUsageLinks > 0) {
      log(
        `[perf] cross-file budget dropped `
        + `callLinks=${droppedCallLinks}, `
        + `callSummaries=${droppedCallSummaries}, `
        + `usageLinks=${droppedUsageLinks}.`
      );
    }
  }

  admission.calls.dropped = droppedCallLinks;
  admission.callDetails.dropped = droppedCallSummaries;
  admission.usages.dropped = droppedUsageLinks;
  return {
    admission,
    sourceReadCoverage: sourceReader.coverage(),
    linkedCalls,
    linkedCallSummaries,
    linkedUsages,
    inferredReturns,
    riskFlows,
    toolingDegradedProviders,
    toolingDegradedWarnings,
    toolingDegradedErrors,
    toolingProvidersExecuted,
    toolingProvidersContributed,
    toolingRequests,
    toolingRequestFailures,
    toolingRequestTimeouts,
    symbolicTypeGraphs,
    droppedCallLinks,
    droppedCallSummaries,
    droppedUsageLinks,
    bundleSizing,
    inferenceLiteEnabled
  };
}
