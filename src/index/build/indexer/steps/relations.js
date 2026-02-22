import { log } from '../../../../shared/progress.js';
import { throwIfAborted } from '../../../../shared/abort.js';
import { applyCrossFileInference } from '../../../type-inference-crossfile.js';
import { buildRiskSummaries } from '../../../risk-interprocedural/summaries.js';
import {
  enrichUnresolvedImportSamples,
  scanImports,
  summarizeUnresolvedImportTaxonomy
} from '../../imports.js';
import { prepareImportResolutionFsMeta, resolveImportLinks } from '../../import-resolution.js';
import {
  applyImportResolutionCacheFileSetDiffInvalidation,
  loadImportResolutionCache,
  saveImportResolutionCache,
  updateImportResolutionDiagnosticsCache
} from '../../import-resolution-cache.js';
import {
  applyFileUsageInferenceBudget,
  applyRelationInferenceBudget,
  countRelationSignalEntries,
  normalizeRelationSignalToken
} from '../../file-processor/relations.js';

const MAX_UNRESOLVED_IMPORT_LOG_LINES = 50;

const normalizeUnresolvedSamples = (samples) => enrichUnresolvedImportSamples(samples);

const formatUnresolvedCategoryCounts = (categories) => {
  const entries = Object.entries(categories || {})
    .filter(([category, count]) => category && Number.isFinite(Number(count)) && Number(count) > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) return 'none';
  return entries.map(([category, count]) => `${category}=${Number(count)}`).join(', ');
};

const formatUnresolvedCategoryDelta = (categories) => {
  const entries = Object.entries(categories || {})
    .filter(([category, count]) => category && Number.isFinite(Number(count)) && Number(count) !== 0)
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) return 'none';
  return entries
    .map(([category, count]) => {
      const numeric = Number(count);
      const prefix = numeric > 0 ? '+' : '';
      return `${category}=${prefix}${numeric}`;
    })
    .join(', ');
};

const resolveImportResolverPlugins = (runtime) => {
  const importResolutionConfig = runtime?.indexingConfig?.importResolution;
  if (!importResolutionConfig || typeof importResolutionConfig !== 'object') return null;
  const plugins = importResolutionConfig.resolverPlugins || importResolutionConfig.plugins || null;
  return plugins && typeof plugins === 'object' ? plugins : null;
};

const logUnresolvedImportSamples = ({ samples, suppressed, unresolvedTotal, taxonomy }) => {
  const normalized = normalizeUnresolvedSamples(samples);
  const summary = taxonomy && typeof taxonomy === 'object'
    ? taxonomy
    : summarizeUnresolvedImportTaxonomy(normalized);
  if (normalized.length === 0) {
    if (Number.isFinite(unresolvedTotal) && unresolvedTotal > 0) {
      log(`[imports] unresolved imports=${unresolvedTotal}; no unresolved samples were captured.`);
    }
    return;
  }
  const actionable = normalized.filter((entry) => entry?.suppressLive !== true);
  const visible = actionable.slice(0, MAX_UNRESOLVED_IMPORT_LOG_LINES);
  const total = Number.isFinite(unresolvedTotal) ? unresolvedTotal : normalized.length;
  const actionableTotal = Number.isFinite(summary?.actionable) ? summary.actionable : actionable.length;
  const policySuppressed = Number.isFinite(summary?.liveSuppressed) ? summary.liveSuppressed : 0;
  log(
    `[imports] unresolved taxonomy: ${formatUnresolvedCategoryCounts(summary?.categories)} ` +
    `(actionable=${actionableTotal}, live-suppressed=${policySuppressed})`
  );
  log(`[imports] unresolved import samples (${visible.length} live of ${total}):`);
  for (const entry of visible) {
    const from = entry.importer || '<unknown-importer>';
    const specifier = entry.specifier || '<empty-specifier>';
    const category = entry.category || 'unknown';
    const confidence = Number.isFinite(entry.confidence) ? entry.confidence.toFixed(2) : 'n/a';
    log(`[imports] unresolved: ${from} -> ${specifier} [category=${category}, confidence=${confidence}]`);
  }
  if (visible.length === 0 && policySuppressed > 0) {
    log(`[imports] all captured unresolved samples were suppressed by live policy (${policySuppressed}).`);
  }
  const resolverSuppressed = Number.isFinite(suppressed) && suppressed > 0 ? suppressed : 0;
  const capSuppressed = Math.max(0, actionable.length - visible.length);
  const omittedTotal = policySuppressed + capSuppressed + resolverSuppressed;
  if (omittedTotal > 0) {
    log(
      `[imports] unresolved imports omitted from live log: ${omittedTotal} ` +
      `(policy=${policySuppressed}, cap=${capSuppressed}, resolver=${resolverSuppressed})`
    );
  }
};

const CROSS_FILE_BUDGET_SCHEMA_VERSION = 1;
const CROSS_FILE_SCALE_PROFILES = Object.freeze([
  Object.freeze({
    id: 'tiny',
    maxChunks: 400,
    maxFiles: 80,
    callPerChunk: 96,
    callDetailsPerChunk: 128,
    usagePerChunk: 128,
    usagePerFile: 192
  }),
  Object.freeze({
    id: 'small',
    maxChunks: 1200,
    maxFiles: 220,
    callPerChunk: 72,
    callDetailsPerChunk: 96,
    usagePerChunk: 96,
    usagePerFile: 144
  }),
  Object.freeze({
    id: 'medium',
    maxChunks: 3000,
    maxFiles: 600,
    callPerChunk: 48,
    callDetailsPerChunk: 72,
    usagePerChunk: 64,
    usagePerFile: 96
  }),
  Object.freeze({
    id: 'large',
    maxChunks: 6000,
    maxFiles: 1500,
    callPerChunk: 32,
    callDetailsPerChunk: 48,
    usagePerChunk: 48,
    usagePerFile: 72
  }),
  Object.freeze({
    id: 'huge',
    maxChunks: Number.POSITIVE_INFINITY,
    maxFiles: Number.POSITIVE_INFINITY,
    callPerChunk: 24,
    callDetailsPerChunk: 36,
    usagePerChunk: 32,
    usagePerFile: 48
  })
]);
const CROSS_FILE_LANGUAGE_BUDGET_FACTORS = Object.freeze({
  typescript: 1.1,
  tsx: 1.1,
  java: 1.1,
  go: 1.1,
  csharp: 1.1,
  rust: 1.1,
  javascript: 1.05,
  jsx: 1.05,
  kotlin: 1.05,
  swift: 1.05,
  python: 1,
  ruby: 1,
  php: 1,
  perl: 1,
  shell: 0.95,
  lua: 0.9,
  sql: 0.9,
  html: 0.75,
  css: 0.75,
  graphql: 0.75,
  proto: 0.75,
  handlebars: 0.7,
  mustache: 0.7,
  jinja: 0.7,
  razor: 0.7,
  dart: 0.9,
  scala: 0.95,
  groovy: 0.95,
  r: 0.8,
  julia: 0.85,
  cmake: 0.6,
  starlark: 0.6,
  makefile: 0.6,
  dockerfile: 0.6,
  nix: 0.6,
  ini: 0.55,
  json: 0.5,
  toml: 0.5,
  xml: 0.5,
  yaml: 0.5
});
const CROSS_FILE_MARGINAL_WINDOW = 40;
const CROSS_FILE_MARGINAL_WARMUP_CHUNKS = 96;
const CROSS_FILE_MARGINAL_MIN_SIGNALS = 1200;
const CROSS_FILE_MARGINAL_THRESHOLD = 0.03;
const CROSS_FILE_MARGINAL_MIN_REPO_CHUNKS = 320;
const CROSS_FILE_FLATTEN_FACTOR = 0.55;
const CROSS_FILE_CALL_SAMPLE_LIMIT = 8;
const CROSS_FILE_USAGE_SAMPLE_LIMIT = 8;

const isMapLike = (value) => Boolean(
  value
  && typeof value.get === 'function'
  && typeof value.set === 'function'
  && typeof value.entries === 'function'
);

const iterateFileRelationEntries = (fileRelations) => {
  if (isMapLike(fileRelations)) {
    return Array.from(fileRelations.entries());
  }
  if (!fileRelations || typeof fileRelations !== 'object') {
    return [];
  }
  return Object.entries(fileRelations);
};

const getFileRelationEntry = (fileRelations, file) => {
  if (!file || !fileRelations) return null;
  if (isMapLike(fileRelations)) return fileRelations.get(file) || null;
  if (typeof fileRelations === 'object') return fileRelations[file] || null;
  return null;
};

const setFileRelationEntry = (fileRelations, file, value) => {
  if (!file || !fileRelations) return;
  if (isMapLike(fileRelations)) {
    fileRelations.set(file, value);
    return;
  }
  if (typeof fileRelations === 'object') {
    fileRelations[file] = value;
  }
};

const safeDivide = (numerator, denominator) => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
};

const resolveChunkLanguageId = (chunk) => {
  const candidates = [
    chunk?.lang,
    chunk?.languageId,
    chunk?.metaV2?.languageId,
    chunk?.segment?.languageId,
    chunk?.containerLanguageId
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.trim().toLowerCase();
    if (normalized) return normalized;
  }
  return 'unknown';
};

const resolveCrossFileScaleProfile = ({ chunkCount, fileCount }) => {
  for (const profile of CROSS_FILE_SCALE_PROFILES) {
    if (chunkCount <= profile.maxChunks && fileCount <= profile.maxFiles) {
      return profile;
    }
  }
  return CROSS_FILE_SCALE_PROFILES[CROSS_FILE_SCALE_PROFILES.length - 1];
};

const resolveLanguageBudgetFactor = (languageId) => {
  const key = typeof languageId === 'string' ? languageId.trim().toLowerCase() : '';
  if (!key) return 1;
  return Number(CROSS_FILE_LANGUAGE_BUDGET_FACTORS[key]) || 1;
};

const resolveBudgetLimit = (baseLimit, factor, floor = 1) => {
  const base = Number(baseLimit);
  if (!Number.isFinite(base) || base <= 0) return Math.max(0, Math.floor(floor));
  const multiplier = Number.isFinite(factor) && factor > 0 ? factor : 1;
  return Math.max(Math.floor(floor), Math.floor(base * multiplier));
};

const buildChunkSortKey = ({ chunk, index, languageId }) => {
  const file = typeof chunk?.file === 'string' ? chunk.file : '';
  const chunkUid = typeof chunk?.chunkUid === 'string'
    ? chunk.chunkUid
    : (typeof chunk?.metaV2?.chunkUid === 'string' ? chunk.metaV2.chunkUid : '');
  const name = typeof chunk?.name === 'string' ? chunk.name : '';
  const start = Number.isFinite(chunk?.start) ? chunk.start : 0;
  const end = Number.isFinite(chunk?.end) ? chunk.end : 0;
  return [
    file,
    languageId || 'unknown',
    chunkUid,
    name,
    String(start).padStart(12, '0'),
    String(end).padStart(12, '0'),
    String(index).padStart(12, '0')
  ].join('|');
};

const appendSignalToken = (out, raw, maxTokens) => {
  if (!Array.isArray(out) || out.length >= maxTokens) return;
  const token = normalizeRelationSignalToken(raw);
  if (!token) return;
  out.push(token);
};

const collectCallSignalTokens = (relations, maxTokens) => {
  const out = [];
  if (!relations || maxTokens <= 0) return out;
  if (Array.isArray(relations.calls)) {
    for (const callEntry of relations.calls) {
      appendSignalToken(out, Array.isArray(callEntry) ? callEntry[1] : null, maxTokens);
      if (out.length >= maxTokens) break;
    }
  }
  if (out.length >= maxTokens) return out;
  if (Array.isArray(relations.callDetails)) {
    for (const detail of relations.callDetails) {
      appendSignalToken(out, detail?.callee, maxTokens);
      if (out.length >= maxTokens) break;
    }
  }
  return out;
};

const collectUsageSignalTokens = (usages, maxTokens) => {
  const out = [];
  if (!Array.isArray(usages) || maxTokens <= 0) return out;
  for (const usage of usages) {
    appendSignalToken(out, usage, maxTokens);
    if (out.length >= maxTokens) break;
  }
  return out;
};

export const buildCrossFileInferenceBudgetPlan = ({
  chunks,
  fileRelations,
  inferenceLiteEnabled = false
} = {}) => {
  const chunkList = Array.isArray(chunks) ? chunks : [];
  const chunkFiles = new Set();
  const fileLanguageByFile = new Map();
  const languageCounts = new Map();
  const chunkDescriptors = [];
  let inputCallSignals = 0;
  let inputCallDetailSignals = 0;
  let inputChunkUsageSignals = 0;

  for (let index = 0; index < chunkList.length; index += 1) {
    const chunk = chunkList[index];
    const relations = chunk?.codeRelations && typeof chunk.codeRelations === 'object'
      ? chunk.codeRelations
      : null;
    const counts = countRelationSignalEntries(relations);
    inputCallSignals += counts.calls;
    inputCallDetailSignals += counts.callDetails;
    inputChunkUsageSignals += counts.usages;
    const file = typeof chunk?.file === 'string' ? chunk.file : null;
    if (file) chunkFiles.add(file);
    const languageId = resolveChunkLanguageId(chunk);
    languageCounts.set(languageId, (languageCounts.get(languageId) || 0) + 1);
    if (file && !fileLanguageByFile.has(file)) fileLanguageByFile.set(file, languageId);
    chunkDescriptors.push({
      index,
      chunk,
      file,
      relations,
      languageId,
      key: buildChunkSortKey({ chunk, index, languageId })
    });
  }

  const fileEntries = iterateFileRelationEntries(fileRelations);
  let inputFileUsageSignals = 0;
  for (const [file, relation] of fileEntries) {
    if (typeof file === 'string' && file && !fileLanguageByFile.has(file)) {
      fileLanguageByFile.set(file, 'unknown');
    }
    if (Array.isArray(relation?.usages)) {
      inputFileUsageSignals += relation.usages.length;
    }
  }

  const fileCount = Math.max(chunkFiles.size, fileEntries.length);
  const scaleProfile = resolveCrossFileScaleProfile({
    chunkCount: chunkList.length,
    fileCount
  });
  const chunkBudgetsByIndex = new Map();
  const fileUsageBudgets = new Map();
  chunkDescriptors.sort((a, b) => a.key.localeCompare(b.key));

  const seenCallTokens = new Set();
  const seenUsageTokens = new Set();
  const sampledFallbackUsageFiles = new Set();
  const marginalWindow = [];
  let marginalSignalsObserved = 0;
  let marginalNovelSignals = 0;
  let flattenTriggeredAt = null;
  let flattenWindowGain = null;

  for (let order = 0; order < chunkDescriptors.length; order += 1) {
    const descriptor = chunkDescriptors[order];
    const flattened = flattenTriggeredAt != null;
    const languageFactor = resolveLanguageBudgetFactor(descriptor.languageId);
    const liteFactor = inferenceLiteEnabled ? 0.85 : 1;
    const flattenFactor = flattened ? CROSS_FILE_FLATTEN_FACTOR : 1;
    const factor = languageFactor * liteFactor * flattenFactor;
    chunkBudgetsByIndex.set(descriptor.index, {
      maxCalls: resolveBudgetLimit(scaleProfile.callPerChunk, factor, 4),
      maxCallDetails: resolveBudgetLimit(scaleProfile.callDetailsPerChunk, factor, 6),
      maxUsages: resolveBudgetLimit(scaleProfile.usagePerChunk, factor, 6),
      languageId: descriptor.languageId
    });
    if (descriptor.file && !fileUsageBudgets.has(descriptor.file)) {
      fileUsageBudgets.set(
        descriptor.file,
        resolveBudgetLimit(scaleProfile.usagePerFile, factor, 8)
      );
    }

    const callTokens = collectCallSignalTokens(descriptor.relations, CROSS_FILE_CALL_SAMPLE_LIMIT);
    let usageTokens = collectUsageSignalTokens(
      descriptor.relations?.usages,
      CROSS_FILE_USAGE_SAMPLE_LIMIT
    );
    if (!usageTokens.length && descriptor.file && !sampledFallbackUsageFiles.has(descriptor.file)) {
      const fileRelation = getFileRelationEntry(fileRelations, descriptor.file);
      usageTokens = collectUsageSignalTokens(fileRelation?.usages, CROSS_FILE_USAGE_SAMPLE_LIMIT);
      if (usageTokens.length) sampledFallbackUsageFiles.add(descriptor.file);
    }
    const considered = callTokens.length + usageTokens.length;
    if (considered > 0) {
      let novel = 0;
      for (const token of callTokens) {
        if (seenCallTokens.has(token)) continue;
        seenCallTokens.add(token);
        novel += 1;
      }
      for (const token of usageTokens) {
        if (seenUsageTokens.has(token)) continue;
        seenUsageTokens.add(token);
        novel += 1;
      }
      marginalSignalsObserved += considered;
      marginalNovelSignals += novel;
      marginalWindow.push(safeDivide(novel, considered));
      while (marginalWindow.length > CROSS_FILE_MARGINAL_WINDOW) marginalWindow.shift();
      if (
        flattenTriggeredAt == null
        && chunkList.length >= CROSS_FILE_MARGINAL_MIN_REPO_CHUNKS
        && (order + 1) >= CROSS_FILE_MARGINAL_WARMUP_CHUNKS
        && marginalSignalsObserved >= CROSS_FILE_MARGINAL_MIN_SIGNALS
        && marginalWindow.length >= CROSS_FILE_MARGINAL_WINDOW
      ) {
        const windowGain = safeDivide(
          marginalWindow.reduce((sum, value) => sum + value, 0),
          marginalWindow.length
        );
        if (windowGain <= CROSS_FILE_MARGINAL_THRESHOLD) {
          flattenTriggeredAt = order + 1;
          flattenWindowGain = windowGain;
        }
      }
    }
  }

  const defaultFactor = (inferenceLiteEnabled ? 0.85 : 1) * (flattenTriggeredAt != null ? CROSS_FILE_FLATTEN_FACTOR : 1);
  for (const [file] of fileEntries) {
    if (!file || fileUsageBudgets.has(file)) continue;
    const languageId = fileLanguageByFile.get(file) || 'unknown';
    const languageFactor = resolveLanguageBudgetFactor(languageId);
    fileUsageBudgets.set(
      file,
      resolveBudgetLimit(scaleProfile.usagePerFile, languageFactor * defaultFactor, 8)
    );
  }

  const languageMix = Array.from(languageCounts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([languageId, chunkCount]) => ({ languageId, chunkCount }));

  return {
    schemaVersion: CROSS_FILE_BUDGET_SCHEMA_VERSION,
    scaleProfile,
    repo: {
      chunks: chunkList.length,
      files: fileCount
    },
    inferenceLiteEnabled: inferenceLiteEnabled === true,
    languageMix,
    chunkBudgetsByIndex,
    fileUsageBudgets,
    input: {
      callSignals: inputCallSignals,
      callDetailSignals: inputCallDetailSignals,
      chunkUsageSignals: inputChunkUsageSignals,
      fileUsageSignals: inputFileUsageSignals
    },
    earlyStop: {
      triggered: flattenTriggeredAt != null,
      triggerChunkOrdinal: flattenTriggeredAt,
      windowGain: flattenWindowGain,
      threshold: CROSS_FILE_MARGINAL_THRESHOLD,
      warmupChunks: CROSS_FILE_MARGINAL_WARMUP_CHUNKS,
      windowSize: CROSS_FILE_MARGINAL_WINDOW
    },
    marginal: {
      observedSignals: marginalSignalsObserved,
      novelSignals: marginalNovelSignals,
      gain: safeDivide(marginalNovelSignals, marginalSignalsObserved)
    }
  };
};

export const applyCrossFileInferenceBudgetPlan = ({
  chunks,
  fileRelations,
  plan
} = {}) => {
  if (!plan || typeof plan !== 'object') {
    return { fileRelations, budgetStats: null };
  }
  const chunkList = Array.isArray(chunks) ? chunks : [];
  let droppedCallSignals = 0;
  let droppedCallDetailSignals = 0;
  let droppedChunkUsageSignals = 0;
  for (let index = 0; index < chunkList.length; index += 1) {
    const limits = plan.chunkBudgetsByIndex?.get
      ? plan.chunkBudgetsByIndex.get(index)
      : null;
    if (!limits) continue;
    const relations = chunkList[index]?.codeRelations;
    if (!relations || typeof relations !== 'object') continue;
    const trimmed = applyRelationInferenceBudget({
      relations,
      maxCalls: limits.maxCalls,
      maxCallDetails: limits.maxCallDetails,
      maxUsages: limits.maxUsages
    });
    droppedCallSignals += trimmed.calls.dropped;
    droppedCallDetailSignals += trimmed.callDetails.dropped;
    droppedChunkUsageSignals += trimmed.usages.dropped;
  }

  let droppedFileUsageSignals = 0;
  let tunedFileRelations = fileRelations;
  let mutableFileRelations = null;
  if (plan.fileUsageBudgets?.entries) {
    const budgets = Array.from(plan.fileUsageBudgets.entries())
      .filter(([file]) => typeof file === 'string' && file)
      .sort((a, b) => a[0].localeCompare(b[0]));
    for (const [file, maxUsages] of budgets) {
      const original = getFileRelationEntry(fileRelations, file);
      if (!original || typeof original !== 'object') continue;
      const relationCopy = { ...original };
      const usageTrim = applyFileUsageInferenceBudget({
        fileRelations: relationCopy,
        maxUsages
      });
      droppedFileUsageSignals += usageTrim.dropped;
      if (usageTrim.dropped <= 0) continue;
      if (!mutableFileRelations) {
        mutableFileRelations = isMapLike(fileRelations)
          ? new Map(fileRelations)
          : (fileRelations && typeof fileRelations === 'object' ? { ...fileRelations } : fileRelations);
      }
      setFileRelationEntry(mutableFileRelations, file, relationCopy);
    }
  }
  if (mutableFileRelations) tunedFileRelations = mutableFileRelations;

  const input = plan.input && typeof plan.input === 'object'
    ? plan.input
    : {
      callSignals: 0,
      callDetailSignals: 0,
      chunkUsageSignals: 0,
      fileUsageSignals: 0
    };
  const retained = {
    callSignals: Math.max(0, input.callSignals - droppedCallSignals),
    callDetailSignals: Math.max(0, input.callDetailSignals - droppedCallDetailSignals),
    chunkUsageSignals: Math.max(0, input.chunkUsageSignals - droppedChunkUsageSignals),
    fileUsageSignals: Math.max(0, input.fileUsageSignals - droppedFileUsageSignals)
  };
  const dropped = {
    callSignals: droppedCallSignals,
    callDetailSignals: droppedCallDetailSignals,
    chunkUsageSignals: droppedChunkUsageSignals,
    fileUsageSignals: droppedFileUsageSignals
  };
  return {
    fileRelations: tunedFileRelations,
    budgetStats: {
      schemaVersion: plan.schemaVersion || CROSS_FILE_BUDGET_SCHEMA_VERSION,
      scaleProfile: plan.scaleProfile || null,
      repo: plan.repo || { chunks: 0, files: 0 },
      inferenceLiteEnabled: plan.inferenceLiteEnabled === true,
      languageMix: Array.isArray(plan.languageMix) ? plan.languageMix : [],
      earlyStop: plan.earlyStop || null,
      marginal: plan.marginal || null,
      input,
      retained,
      dropped
    }
  };
};

export const buildCrossFileInferenceRoiMetrics = ({
  crossFileStats,
  budgetStats,
  durationMs
} = {}) => {
  const linkedCalls = Number(crossFileStats?.linkedCalls) || 0;
  const linkedUsages = Number(crossFileStats?.linkedUsages) || 0;
  const inferredReturns = Number(crossFileStats?.inferredReturns) || 0;
  const riskFlows = Number(crossFileStats?.riskFlows) || 0;
  const linkAdditions = linkedCalls + linkedUsages;
  const retainedLinksAfterFiltering = (
    (Number(budgetStats?.retained?.callSignals) || 0)
    + (Number(budgetStats?.retained?.chunkUsageSignals) || 0)
    + (Number(budgetStats?.retained?.fileUsageSignals) || 0)
  );
  const contributionSignal = inferredReturns + riskFlows;
  return {
    schemaVersion: CROSS_FILE_BUDGET_SCHEMA_VERSION,
    durationMs: Number.isFinite(Number(durationMs)) ? Math.max(0, Math.floor(Number(durationMs))) : 0,
    linkAdditions,
    retainedLinksAfterFiltering,
    contributionSignal,
    linkRetentionRate: safeDivide(linkAdditions, retainedLinksAfterFiltering),
    contributionPerAddedLink: safeDivide(contributionSignal, linkAdditions),
    contributionPerRetainedLink: safeDivide(contributionSignal, retainedLinksAfterFiltering)
  };
};

/**
 * Resolve import-scan strategy for the current mode/runtime policy.
 * @param {{runtime:object,mode:string,relationsEnabled:boolean}} input
 * @returns {{importScanMode:string,enableImportLinks:boolean,usePreScan:boolean,shouldScan:boolean,importGraphEnabled:boolean}}
 */
export const resolveImportScanPlan = ({ runtime, mode, relationsEnabled }) => {
  const importScanRaw = runtime.indexingConfig?.importScan;
  const importScanMode = typeof importScanRaw === 'string'
    ? importScanRaw.trim().toLowerCase()
    : (importScanRaw === false ? 'off' : 'pre');
  const enableImportLinks = importScanMode !== 'off';
  const usePreScan = importScanMode === 'pre' || importScanMode === 'prescan';
  const shouldScan = mode === 'code' && relationsEnabled && enableImportLinks;
  const importGraphEnabled = runtime.importGraphEnabled !== false;
  return { importScanMode, enableImportLinks, usePreScan, shouldScan, importGraphEnabled };
};

export const preScanImports = async ({
  runtime,
  mode,
  relationsEnabled,
  entries,
  crashLogger,
  timing,
  incrementalState,
  fileTextByFile,
  abortSignal = null
}) => {
  throwIfAborted(abortSignal);
  const scanPlan = resolveImportScanPlan({ runtime, mode, relationsEnabled });
  let importResult = { importsByFile: {}, durationMs: 0, stats: null };
  if (scanPlan.shouldScan && scanPlan.usePreScan) {
    log('Scanning for imports...');
    crashLogger.updatePhase('imports');
    importResult = await scanImports({
      files: entries,
      root: runtime.root,
      mode,
      languageOptions: runtime.languageOptions,
      importConcurrency: runtime.importConcurrency,
      queue: runtime.queues.io,
      incrementalState,
      fileTextByFile,
      abortSignal
    });
    timing.importsMs = importResult.durationMs;
    if (importResult?.stats) {
      const { modules, edges, files } = importResult.stats;
      log(`→ Imports: modules=${modules}, edges=${edges}, files=${files}`);
    }
  } else if (scanPlan.shouldScan) {
    log('Skipping import pre-scan; will enrich import links from relations.');
  } else if (mode === 'code' && relationsEnabled) {
    log('Import link enrichment disabled via indexing.importScan.');
  } else if (mode === 'code') {
    log('Skipping import scan for sparse stage.');
  }
  return { importResult, scanPlan };
};

/**
 * Resolve import links post-processing (including cache reuse and unresolved
 * sample logging) and attach optional import graph metadata.
 *
 * @param {object} input
 * @returns {Promise<object|null>}
 */
export const postScanImports = async ({
  mode,
  relationsEnabled,
  scanPlan,
  state,
  timing,
  runtime,
  entries,
  importResult,
  incrementalState,
  fileTextByFile
}) => {
  if (!scanPlan?.shouldScan) return null;
  if (!mode || mode !== 'code' || !relationsEnabled || !scanPlan.enableImportLinks) return null;
  const importStart = Date.now();
  let importsByFile = importResult?.importsByFile;
  if (!importsByFile || Object.keys(importsByFile).length === 0) {
    importsByFile = Object.create(null);
    for (const [file, relations] of state.fileRelations.entries()) {
      const imports = Array.isArray(relations?.imports) ? relations.imports : null;
      if (imports && imports.length) importsByFile[file] = imports;
    }
  }
  const cacheEnabled = incrementalState?.enabled === true;
  let cache = null;
  let cachePath = null;
  let fileHashes = null;
  let cacheStats = null;
  const fsMeta = await prepareImportResolutionFsMeta({
    root: runtime.root,
    entries,
    importsByFile
  });
  if (cacheEnabled) {
    ({ cache, cachePath } = await loadImportResolutionCache({ incrementalState, log }));
    cacheStats = {
      files: 0,
      filesHashed: 0,
      filesReused: 0,
      filesInvalidated: 0,
      specs: 0,
      specsReused: 0,
      specsComputed: 0,
      packageInvalidated: false,
      fileSetInvalidated: false,
      lookupReused: false,
      lookupInvalidated: false,
      invalidationReasons: Object.create(null),
      fileSetDelta: { added: 0, removed: 0 },
      filesNeighborhoodInvalidated: 0,
      staleEdgeInvalidated: 0
    };
    applyImportResolutionCacheFileSetDiffInvalidation({
      cache,
      entries,
      cacheStats,
      log
    });
    fileHashes = new Map();
    const manifestFiles = incrementalState?.manifest?.files || {};
    for (const [file, entry] of Object.entries(manifestFiles)) {
      if (entry?.hash) fileHashes.set(file, entry.hash);
    }
    if (fileTextByFile?.get) {
      for (const file of Object.keys(importsByFile)) {
        if (fileHashes.has(file)) continue;
        const cached = fileTextByFile.get(file);
        if (cached && typeof cached === 'object' && cached.hash) {
          fileHashes.set(file, cached.hash);
        }
      }
    }
  }
  const resolverPlugins = resolveImportResolverPlugins(runtime);
  const resolution = resolveImportLinks({
    root: runtime.root,
    entries,
    importsByFile,
    fileRelations: state.fileRelations,
    log,
    mode,
    enableGraph: scanPlan.importGraphEnabled,
    graphMeta: {
      toolVersion: runtime.toolInfo?.version || null,
      importScanMode: scanPlan.importScanMode || null
    },
    cache,
    fileHashes,
    cacheStats,
    fsMeta,
    resolverPlugins
  });
  const unresolvedSamples = normalizeUnresolvedSamples(resolution?.unresolvedSamples);
  const unresolvedTaxonomy = summarizeUnresolvedImportTaxonomy(unresolvedSamples);
  if (resolution?.graph && Array.isArray(resolution.graph.warnings)) {
    resolution.graph.warnings = unresolvedSamples.map((sample) => ({ ...sample }));
    if (resolution.graph.stats && typeof resolution.graph.stats === 'object') {
      resolution.graph.stats.unresolvedByCategory = unresolvedTaxonomy.categories;
      resolution.graph.stats.unresolvedActionable = unresolvedTaxonomy.actionable;
      resolution.graph.stats.unresolvedLiveSuppressed = unresolvedTaxonomy.liveSuppressed;
      resolution.graph.stats.unresolvedLiveSuppressedCategories = unresolvedTaxonomy.liveSuppressedCategories;
    }
  }
  const cacheDiagnostics = cacheEnabled
    ? updateImportResolutionDiagnosticsCache({
      cache,
      unresolvedTaxonomy,
      unresolvedTotal: resolution?.stats?.unresolved
    })
    : null;
  if (resolution?.graph) {
    state.importResolutionGraph = resolution.graph;
  }
  if (cacheEnabled && cache && cachePath) {
    await saveImportResolutionCache({ cache, cachePath });
  }
  const resolvedResult = {
    importsByFile,
    stats: resolution?.stats || null,
    unresolvedSamples,
    unresolvedSuppressed: resolution?.unresolvedSuppressed || 0,
    unresolvedTaxonomy,
    cacheDiagnostics: cacheDiagnostics || null,
    cacheStats: resolution?.cacheStats || cacheStats || null,
    durationMs: Date.now() - importStart
  };
  timing.importsMs = resolvedResult.durationMs;
  if (resolvedResult?.stats) {
    const { resolved, external, unresolved } = resolvedResult.stats;
    log(`→ Imports: resolved=${resolved}, external=${external}, unresolved=${unresolved}`);
    const deltaTotal = Number(resolvedResult?.cacheDiagnostics?.unresolvedTrend?.deltaTotal);
    if (Number.isFinite(deltaTotal)) {
      const sign = deltaTotal > 0 ? '+' : '';
      const deltaByCategory = formatUnresolvedCategoryDelta(
        resolvedResult?.cacheDiagnostics?.unresolvedTrend?.deltaByCategory
      );
      log(`[imports] unresolved delta vs previous run: ${sign}${deltaTotal} (byCategory: ${deltaByCategory})`);
    }
    if (unresolved > 0) {
      logUnresolvedImportSamples({
        samples: resolvedResult.unresolvedSamples,
        suppressed: resolvedResult.unresolvedSuppressed,
        unresolvedTotal: unresolved,
        taxonomy: resolvedResult.unresolvedTaxonomy
      });
    }
  }
  return resolvedResult;
};

/**
 * Run cross-file type/risk inference and build optional interprocedural
 * summaries for emitted artifacts.
 *
 * @param {object} input
 * @returns {Promise<object|null>}
 */
export const runCrossFileInference = async ({
  runtime,
  mode,
  state,
  crashLogger,
  featureMetrics,
  relationsEnabled,
  abortSignal = null
}) => {
  throwIfAborted(abortSignal);
  const policy = runtime.analysisPolicy || {};
  const typeInferenceEnabled = typeof policy?.typeInference?.local?.enabled === 'boolean'
    ? policy.typeInference.local.enabled
    : runtime.typeInferenceEnabled;
  const typeInferenceCrossFileEnabled = typeof policy?.typeInference?.crossFile?.enabled === 'boolean'
    ? policy.typeInference.crossFile.enabled
    : runtime.typeInferenceCrossFileEnabled;
  const riskAnalysisEnabled = typeof policy?.risk?.enabled === 'boolean'
    ? policy.risk.enabled
    : runtime.riskAnalysisEnabled;
  const riskAnalysisCrossFileEnabled = typeof policy?.risk?.crossFile === 'boolean'
    ? policy.risk.crossFile
    : runtime.riskAnalysisCrossFileEnabled;
  const riskInterproceduralEnabled = typeof policy?.risk?.interprocedural === 'boolean'
    ? policy.risk.interprocedural
    : runtime.riskInterproceduralEnabled;
  const riskInterproceduralEmitArtifacts = runtime.riskInterproceduralConfig?.emitArtifacts || null;
  const shouldBuildRiskSummaries = mode === 'code'
    && (riskInterproceduralEnabled || riskInterproceduralEmitArtifacts === 'jsonl');
  const useTooling = typeof policy?.typeInference?.tooling?.enabled === 'boolean'
    ? policy.typeInference.tooling.enabled
    : (typeInferenceEnabled && typeInferenceCrossFileEnabled && runtime.toolingEnabled);
  const hugeRepoInferenceLiteConfig = runtime.indexingConfig?.hugeRepoInferenceLite
    && typeof runtime.indexingConfig.hugeRepoInferenceLite === 'object'
    ? runtime.indexingConfig.hugeRepoInferenceLite
    : {};
  const inferenceLiteEnabled = mode === 'code' && (
    hugeRepoInferenceLiteConfig.enabled === true
    || (
      runtime.hugeRepoProfileEnabled === true
      && hugeRepoInferenceLiteConfig.enabled !== false
    )
  );
  const inferenceLiteHighSignalOnly = hugeRepoInferenceLiteConfig.highSignalOnly !== false;
  const enableCrossFileTypeInference = typeInferenceEnabled && typeInferenceCrossFileEnabled;
  const crossFileEnabled = typeInferenceCrossFileEnabled
    || riskAnalysisCrossFileEnabled
    || riskInterproceduralEnabled;
  if (mode === 'code' && crossFileEnabled) {
    crashLogger.updatePhase('cross-file');
    const budgetPlan = buildCrossFileInferenceBudgetPlan({
      chunks: state.chunks,
      fileRelations: state.fileRelations,
      inferenceLiteEnabled
    });
    const {
      fileRelations: inferenceFileRelations,
      budgetStats
    } = applyCrossFileInferenceBudgetPlan({
      chunks: state.chunks,
      fileRelations: state.fileRelations,
      plan: budgetPlan
    });
    state.fileRelations = inferenceFileRelations;
    state.crossFileInferenceBudgetStats = budgetStats;
    const formatCount = (value) => Number.isFinite(value) ? value.toLocaleString() : '0';
    const formatRatio = (value) => `${(safeDivide(Number(value) || 0, 1) * 100).toFixed(2)}%`;
    if (budgetStats) {
      const earlyStopTriggered = budgetStats.earlyStop?.triggered === true;
      const earlyStopGain = Number.isFinite(budgetStats.earlyStop?.windowGain)
        ? budgetStats.earlyStop.windowGain
        : null;
      log(
        `[perf] cross-file budget tune scale=${budgetStats.scaleProfile?.id || 'unknown'} ` +
        `calls=${formatCount(budgetStats.retained.callSignals)}/${formatCount(budgetStats.input.callSignals)}, ` +
        `usages=${formatCount(budgetStats.retained.chunkUsageSignals + budgetStats.retained.fileUsageSignals)}/` +
        `${formatCount(budgetStats.input.chunkUsageSignals + budgetStats.input.fileUsageSignals)}, ` +
        `earlyStop=${earlyStopTriggered ? 'triggered' : 'not-triggered'}` +
        (earlyStopTriggered && earlyStopGain != null
          ? ` (windowGain=${formatRatio(earlyStopGain)})`
          : '')
      );
    }
    const crossFileStart = Date.now();
    const crossFileStats = await applyCrossFileInference({
      rootDir: runtime.root,
      buildRoot: runtime.buildRoot,
      cacheRoot: runtime.repoCacheRoot,
      chunks: state.chunks,
      enabled: true,
      log,
      useTooling,
      enableTypeInference: enableCrossFileTypeInference,
      enableRiskCorrelation: riskAnalysisEnabled && riskAnalysisCrossFileEnabled,
      fileRelations: inferenceFileRelations,
      inferenceLite: inferenceLiteEnabled,
      inferenceLiteHighSignalOnly
    });
    const crossFileDurationMs = Date.now() - crossFileStart;
    const roiMetrics = buildCrossFileInferenceRoiMetrics({
      crossFileStats,
      budgetStats,
      durationMs: crossFileDurationMs
    });
    state.crossFileInferenceRoi = roiMetrics;
    if (featureMetrics?.recordSettingByLanguageShare) {
      const crossFileTargets = [];
      if (typeInferenceCrossFileEnabled) crossFileTargets.push('typeInferenceCrossFile');
      if (riskAnalysisCrossFileEnabled) crossFileTargets.push('riskAnalysisCrossFile');
      const shareMs = crossFileTargets.length ? crossFileDurationMs / crossFileTargets.length : 0;
      for (const target of crossFileTargets) {
        featureMetrics.recordSettingByLanguageShare({
          mode,
          setting: target,
          enabled: true,
          durationMs: shareMs
        });
      }
    }
    if (crossFileStats) {
      const callLinks = Number.isFinite(crossFileStats.linkedCalls) ? crossFileStats.linkedCalls : 0;
      const usageLinks = Number.isFinite(crossFileStats.linkedUsages) ? crossFileStats.linkedUsages : 0;
      const returns = Number.isFinite(crossFileStats.inferredReturns) ? crossFileStats.inferredReturns : 0;
      const riskFlows = Number.isFinite(crossFileStats.riskFlows) ? crossFileStats.riskFlows : 0;
      log(
        `Cross-File Inference: ${formatCount(callLinks)} Call Links, ` +
        `${formatCount(usageLinks)} Usage Links, ${formatCount(returns)} Returns, ` +
        `${formatCount(riskFlows)} Risk Flows`
      );
      if (crossFileStats.cacheHit) {
        log('[perf] cross-file output cache reused.');
      }
      if (crossFileStats.inferenceLiteEnabled === true) {
        log('[perf] cross-file inference lite profile active (high-signal links only).');
      }
    }
    if (roiMetrics) {
      log(
        `[perf] cross-file roi linkAdditions=${formatCount(roiMetrics.linkAdditions)}, ` +
        `retainedAfterFiltering=${formatCount(roiMetrics.retainedLinksAfterFiltering)}, ` +
        `contributionSignal=${formatCount(roiMetrics.contributionSignal)}, ` +
        `retentionRate=${formatRatio(roiMetrics.linkRetentionRate)}, ` +
        `contributionPerLink=${(roiMetrics.contributionPerAddedLink || 0).toFixed(4)}`
      );
    }
  }
  if (shouldBuildRiskSummaries) {
    crashLogger.updatePhase('risk-summaries');
    const summaryStart = Date.now();
    const { rows, stats } = buildRiskSummaries({
      chunks: state.chunks,
      runtime,
      mode,
      log
    });
    state.riskSummaryTimingMs = Date.now() - summaryStart;
    state.riskSummaries = rows;
    state.riskSummaryStats = stats;
    if (stats?.emitted && Number.isFinite(stats.emitted)) {
      log(`Risk summaries: ${stats.emitted.toLocaleString()} rows`);
    }
  }
  // graph_relations is written during the artifact phase from streamed edges to avoid
  // materializing Graphology graphs in memory.
  return { crossFileEnabled, graphRelations: null };
};
