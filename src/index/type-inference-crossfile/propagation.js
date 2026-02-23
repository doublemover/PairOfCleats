import path from 'node:path';
import { uniqueTypes } from '../../integrations/tooling/providers/shared.js';
import { readTextFile } from '../../shared/encoding.js';
import { FLOW_CONFIDENCE, FLOW_SOURCE } from './constants.js';
import { addInferredParam, addInferredReturn } from './apply.js';
import { extractParamTypes, extractReturnCalls, extractReturnTypes, inferArgType } from './extract.js';
import { isTypeDeclaration } from './symbols.js';
import { runToolingPass } from './tooling.js';
import { buildSymbolIndex, resolveSymbolRef } from './resolver.js';
import {
  createBundleSizing,
  resolvePropagationParallelOptions,
  updateBundleSizing
} from './bundler.js';

const LARGE_REPO_CHUNK_THRESHOLD = 3000;
const LARGE_REPO_FILE_THRESHOLD = 500;
const LARGE_REPO_CALL_LINKS_PER_CHUNK = 96;
const LARGE_REPO_CALL_SUMMARIES_PER_CHUNK = 128;
const LARGE_REPO_USAGE_LINKS_PER_CHUNK = 128;
const LARGE_REPO_CALL_LINKS_TOTAL = 25000;
const LARGE_REPO_USAGE_LINKS_TOTAL = 25000;
const LARGE_REPO_CALL_SAMPLE_LIMIT = 10;
const LARGE_REPO_PARAM_TYPE_LIMIT = 3;
const SYMBOL_REF_CACHE_MAX_ENTRIES = 20000;
const SYMBOL_REF_CACHE_TTL_MS = 5 * 60 * 1000;

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
  const key = `${kind}:${name}:${resolved}:${status}`;
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

const buildLargeRepoBudget = ({ chunkCount, fileCount }) => (
  chunkCount >= LARGE_REPO_CHUNK_THRESHOLD || fileCount >= LARGE_REPO_FILE_THRESHOLD
    ? {
      maxCallLinksPerChunk: LARGE_REPO_CALL_LINKS_PER_CHUNK,
      maxCallSummariesPerChunk: LARGE_REPO_CALL_SUMMARIES_PER_CHUNK,
      maxUsageLinksPerChunk: LARGE_REPO_USAGE_LINKS_PER_CHUNK,
      maxTotalCallLinks: LARGE_REPO_CALL_LINKS_TOTAL,
      maxTotalUsageLinks: LARGE_REPO_USAGE_LINKS_TOTAL,
      callSampleLimit: LARGE_REPO_CALL_SAMPLE_LIMIT,
      paramTypeLimit: LARGE_REPO_PARAM_TYPE_LIMIT
    }
    : null
);

const confidenceForHop = (hops) => Math.max(0.2, FLOW_CONFIDENCE * (0.85 ** hops));

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
  inferenceLiteHighSignalOnly = true,
  toolingConfig = null,
  toolingTimeoutMs = 15000,
  toolingRetries = 2,
  toolingBreaker = 3,
  toolingLogDir = null
}) {
  const symbolEntries = [];
  const entryByKey = new Map();
  const entryByUid = new Map();
  const chunkByUid = new Map();
  const fileSet = new Set();
  const symbolRefCache = new Map();
  const callSampleCounts = new Map();

  const pruneSymbolRefCache = (nowMs) => {
    if (!symbolRefCache.size) return;
    if (symbolRefCache.size > SYMBOL_REF_CACHE_MAX_ENTRIES) {
      const toEvict = symbolRefCache.size - SYMBOL_REF_CACHE_MAX_ENTRIES;
      const iter = symbolRefCache.keys();
      for (let index = 0; index < toEvict; index += 1) {
        const next = iter.next();
        if (next.done) break;
        symbolRefCache.delete(next.value);
      }
    }
    const cutoff = nowMs - SYMBOL_REF_CACHE_TTL_MS;
    for (const [key, entry] of symbolRefCache.entries()) {
      if (!entry || Number(entry.ts) < cutoff) {
        symbolRefCache.delete(key);
      }
    }
  };

  for (const chunk of chunks) {
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
      returnTypes: extractReturnTypes(chunk),
      typeDeclaration: isTypeDeclaration(chunk.kind),
      paramNames,
      paramTypes
    };
    symbolEntries.push(entry);
    entryByKey.set(`${chunk.file}::${chunk.name}`, entry);
    if (chunkUid) {
      entryByUid.set(chunkUid, entry);
    }
  }

  const symbolResolver = buildSymbolIndex(symbolEntries);
  const resolveSymbolRefCached = ({
    targetName,
    kindHint = null,
    fromFile = null
  }) => {
    const name = typeof targetName === 'string' ? targetName : null;
    if (!name) return null;
    const now = Date.now();
    const cacheKey = `${fromFile || ''}\u0001${kindHint || ''}\u0001${name}`;
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
      fileSet
    });
    symbolRefCache.set(cacheKey, { value: resolved || null, ts: now });
    if (symbolRefCache.size > SYMBOL_REF_CACHE_MAX_ENTRIES) {
      pruneSymbolRefCache(now);
    }
    return resolved || null;
  };

  const largeRepoBudget = buildLargeRepoBudget({
    chunkCount: chunks.length,
    fileCount: fileSet.size
  });
  const inferenceLiteEnabled = inferenceLite === true;
  const inferenceLiteHighSignalOnlyMode = inferenceLiteEnabled
    && inferenceLiteHighSignalOnly !== false;
  const callSampleLimit = largeRepoBudget?.callSampleLimit ?? 25;
  const paramTypeLimit = largeRepoBudget?.paramTypeLimit ?? 5;
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
  let linkedUsages = 0;
  let inferredReturns = 0;
  let riskFlows = 0;
  let droppedCallLinks = 0;
  let droppedCallSummaries = 0;
  let droppedUsageLinks = 0;
  const maxTotalCallLinks = Number.isFinite(largeRepoBudget?.maxTotalCallLinks)
    ? Math.max(0, Math.floor(largeRepoBudget.maxTotalCallLinks))
    : null;
  const maxTotalUsageLinks = Number.isFinite(largeRepoBudget?.maxTotalUsageLinks)
    ? Math.max(0, Math.floor(largeRepoBudget.maxTotalUsageLinks))
    : null;
  const isCallBudgetExhausted = () => maxTotalCallLinks != null && linkedCalls >= maxTotalCallLinks;
  const isUsageBudgetExhausted = () => maxTotalUsageLinks != null && linkedUsages >= maxTotalUsageLinks;
  const fileUsageFallbackApplied = new Set();

  const fileTextByRel = new Map();
  const fileTextByAbs = new Map();
  const getFileText = async (relPath) => {
    if (!relPath) return '';
    const absPath = path.join(rootDir, relPath);
    if (fileTextByAbs.has(absPath)) return fileTextByAbs.get(absPath) || '';
    let text = '';
    try {
      const result = await readTextFile(absPath);
      text = result?.text || '';
    } catch {}
    fileTextByAbs.set(absPath, text);
    fileTextByRel.set(relPath, text);
    return text;
  };

  const toolingEnabled = useTooling && enableTypeInference && toolingConfig?.autoEnableOnDetect !== false;
  if (toolingEnabled) {
    const filesToLoad = new Set();
    for (const chunk of chunks) {
      if (chunk?.file) filesToLoad.add(chunk.file);
    }
    for (const file of filesToLoad) {
      await getFileText(file);
    }
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
      fileTextByFile: fileTextByRel
    });
    inferredReturns += toolingResult.inferredReturns || 0;
  }

  const getChunkText = async (chunk) => {
    if (!chunk?.file) return '';
    const text = await getFileText(chunk.file);
    return text.slice(chunk.start, chunk.end);
  };

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
    if (!chunkText || !chunkText.includes('return')) {
      const empty = { calls: new Set(), news: new Set() };
      returnCallsByChunk.set(chunk, empty);
      return empty;
    }
    const parsed = extractReturnCalls(chunkText, { knownCallees: collectKnownCallees(chunk) });
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
          entry.returnTypes = uniqueTypes([...(entry.returnTypes || []), typeName]);
        }
      }
    }
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
      if (!chunk) continue;
      const relations = chunk.codeRelations || {};
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
            const remaining = Math.max(0, maxTotalCallLinks - (linkedCalls + callLinks.length));
            if (remaining <= 0) {
              droppedCallLinks += maxCallLinkSource - callIndex;
              break;
            }
          }
          const callEntry = relations.calls[callIndex];
          if (!Array.isArray(callEntry) || callEntry.length < 2) continue;
          const callee = callEntry[1];
          const symbolRef = resolveSymbolRefCached({
            targetName: callee,
            kindHint: null,
            fromFile: chunk.file
          });
          if (!symbolRef) continue;
          if (symbolRef.resolved?.chunkUid && symbolRef.resolved.chunkUid === fromChunkUid) continue;
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
            const remaining = Math.max(0, maxTotalCallLinks - (linkedCalls + callLinks.length));
            if (remaining <= 0) {
              droppedCallSummaries += maxCallSummarySource - detailIndex;
              break;
            }
          }
          const detail = relations.callDetails[detailIndex];
          const callee = detail?.callee;
          if (!callee) continue;
          const symbolRef = resolveSymbolRefCached({
            targetName: callee,
            kindHint: null,
            fromFile: chunk.file
          });
          const candidateIds = buildCandidateIds(symbolRef);
          if (symbolRef?.resolved?.chunkUid && !detail.targetChunkUid) {
            detail.targetChunkUid = symbolRef.resolved.chunkUid;
          } else if (!detail.targetChunkUid && (!detail.targetCandidates || !detail.targetCandidates.length) && candidateIds.length) {
            detail.targetCandidates = candidateIds;
          }
          detail.calleeRef = symbolRef || null;
          detail.resolvedCalleeChunkUid = symbolRef?.resolved?.chunkUid || null;
          const resolvedEntry = symbolRef?.resolved?.chunkUid
            ? entryByUid.get(symbolRef.resolved.chunkUid)
            : null;
          const args = Array.isArray(detail.args) ? detail.args : [];
          const summary = {
            v: 1,
            name: callee,
            args,
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
            if (resolvedEntry.paramNames?.length) summary.params = resolvedEntry.paramNames;
            if (resolvedEntry.paramTypes && Object.keys(resolvedEntry.paramTypes).length) {
              summary.paramTypes = resolvedEntry.paramTypes;
            }
          }
          const paramNames = Array.isArray(summary.params) ? summary.params : [];
          if (args.length && paramNames.length) {
            const argMap = {};
            for (let i = 0; i < paramNames.length && i < args.length; i += 1) {
              const paramName = paramNames[i];
              const argValue = args[i];
              if (paramName && argValue) argMap[paramName] = argValue;
            }
            if (Object.keys(argMap).length) summary.argMap = argMap;
          }
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
          const usage = usageSource[usageIndex];
          const symbolRef = resolveSymbolRefCached({
            targetName: usage,
            kindHint: null,
            fromFile: chunk.file
          });
          if (!symbolRef) continue;
          if (symbolRef.resolved?.chunkUid && symbolRef.resolved.chunkUid === fromChunkUid) continue;
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

      if (callLinks.length) {
        relations.callLinks = callLinks;
        linkedCalls += callLinks.length;
      }
      if (callSummaries.length) {
        relations.callSummaries = callSummaries;
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
            if (currentSamples >= callSampleLimit) continue;
            callSampleCounts.set(sampleKey, currentSamples + 1);
            const args = Array.isArray(summary.args) ? summary.args : [];
            const paramNames = Array.isArray(calleeChunk.docmeta?.paramNames)
              ? calleeChunk.docmeta.paramNames
              : (Array.isArray(calleeChunk.docmeta?.params) ? calleeChunk.docmeta.params : []);
            const argMap = summary.argMap || {};
            if (!paramNames.length && !args.length && !Object.keys(argMap).length) continue;
            if (!calleeChunk.docmeta || typeof calleeChunk.docmeta !== 'object') calleeChunk.docmeta = {};
            const hopCount = calleeChunk.file !== chunk.file ? 1 : 0;
            const confidence = confidenceForHop(hopCount);
            for (let i = 0; i < paramNames.length && i < Math.max(args.length, paramNames.length); i += 1) {
              const name = paramNames[i];
              const argValue = argMap[name] || args[i];
              if (!name || !argValue) continue;
              const type = inferArgType(argValue);
              if (!type) continue;
              if (addInferredParam(calleeChunk.docmeta, name, type, FLOW_SOURCE, confidence, paramTypeLimit)) {
                const entry = resolvedUid ? entryByUid.get(resolvedUid) : null;
                if (entry) {
                  const existing = entry.paramTypes?.[name] || [];
                  entry.paramTypes = entry.paramTypes || {};
                  entry.paramTypes[name] = uniqueTypes([...(existing || []), type]);
                }
              }
            }
          }
        }

        if (inferenceLiteEnabled && inferenceLiteHighSignalOnlyMode) {
          return;
        }

        const { calls: returnCalls } = await getReturnCalls(chunk);
        if (!returnCalls.size) return;
        if (!chunk.docmeta || typeof chunk.docmeta !== 'object') chunk.docmeta = {};
        const resolvedViaSummaries = new Set();
        if (callSummaries.length) {
          for (const summary of callSummaries) {
            const callName = typeof summary?.name === 'string' ? summary.name : null;
            if (!callName || !returnCalls.has(callName)) continue;
            const resolvedUid = summary?.resolvedCalleeChunkUid || summary?.targetChunkUid || null;
            const resolvedChunk = resolvedUid ? chunkByUid.get(resolvedUid) : null;
            const returnTypes = Array.isArray(summary?.returnTypes) && summary.returnTypes.length
              ? summary.returnTypes
              : (Array.isArray(entryByUid.get(resolvedUid)?.returnTypes)
                ? entryByUid.get(resolvedUid).returnTypes
                : []);
            if (!returnTypes.length) continue;
            resolvedViaSummaries.add(callName);
            const hopCount = resolvedChunk?.file && resolvedChunk.file !== chunk.file ? 1 : 0;
            const confidence = confidenceForHop(hopCount);
            for (const type of returnTypes) {
              if (addInferredReturn(chunk.docmeta, type, FLOW_SOURCE, confidence)) {
                inferredReturns += 1;
              }
            }
          }
        }
        for (const callName of returnCalls) {
          if (resolvedViaSummaries.has(callName)) continue;
          const symbolRef = resolveSymbolRefCached({
            targetName: callName,
            kindHint: null,
            fromFile: chunk.file
          });
          if (!symbolRef?.resolved?.chunkUid) continue;
          const entry = entryByUid.get(symbolRef.resolved.chunkUid);
          const returnTypes = entry?.returnTypes || [];
          if (!returnTypes.length) continue;
          const hopCount = entry?.file !== chunk.file ? 1 : 0;
          const confidence = confidenceForHop(hopCount);
          for (const type of returnTypes) {
            if (addInferredReturn(chunk.docmeta, type, FLOW_SOURCE, confidence)) {
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

  return {
    linkedCalls,
    linkedUsages,
    inferredReturns,
    riskFlows,
    droppedCallLinks,
    droppedCallSummaries,
    droppedUsageLinks,
    bundleSizing,
    inferenceLiteEnabled
  };
}
