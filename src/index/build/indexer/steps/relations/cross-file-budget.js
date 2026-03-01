import {
  applyFileUsageInferenceBudget,
  applyRelationInferenceBudget,
  countRelationSignalEntries,
  normalizeRelationSignalToken
} from '../../../file-processor/relations.js';

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

/**
 * Build adaptive cross-file inference budget plan for current chunk/file set.
 *
 * @param {{chunks?:Array<object>,fileRelations?:object|Map<string,object>,inferenceLiteEnabled?:boolean}} [input]
 * @returns {object}
 */
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
  let keysAreSorted = true;
  let previousChunkKey = null;
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
    const key = buildChunkSortKey({ chunk, index, languageId });
    if (keysAreSorted && previousChunkKey != null && key.localeCompare(previousChunkKey) < 0) {
      keysAreSorted = false;
    }
    previousChunkKey = key;
    chunkDescriptors.push({
      index,
      chunk,
      file,
      relations,
      languageId,
      key
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
  if (!keysAreSorted) {
    chunkDescriptors.sort((a, b) => a.key.localeCompare(b.key));
  }

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

/**
 * Apply cross-file inference budgets to chunk relations and file usages.
 *
 * @param {{chunks?:Array<object>,fileRelations?:object|Map<string,object>,plan?:object}} [input]
 * @returns {{fileRelations:object|Map<string,object>,budgetStats:object|null}}
 */
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

/**
 * Build ROI/retention telemetry from cross-file inference and budget stats.
 *
 * @param {{crossFileStats?:object,budgetStats?:object,durationMs?:number}} [input]
 * @returns {object}
 */
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
  const toolingProvidersExecuted = Number(crossFileStats?.toolingProvidersExecuted) || 0;
  const toolingProvidersContributed = Number(crossFileStats?.toolingProvidersContributed) || 0;
  const toolingDegradedProviders = Number(crossFileStats?.toolingDegradedProviders) || 0;
  const toolingDegradedWarnings = Number(crossFileStats?.toolingDegradedWarnings) || 0;
  const toolingDegradedErrors = Number(crossFileStats?.toolingDegradedErrors) || 0;
  const toolingRequests = Number(crossFileStats?.toolingRequests) || 0;
  const toolingRequestFailures = Number(crossFileStats?.toolingRequestFailures) || 0;
  const toolingRequestTimeouts = Number(crossFileStats?.toolingRequestTimeouts) || 0;
  return {
    schemaVersion: CROSS_FILE_BUDGET_SCHEMA_VERSION,
    durationMs: Number.isFinite(Number(durationMs)) ? Math.max(0, Math.floor(Number(durationMs))) : 0,
    linkAdditions,
    retainedLinksAfterFiltering,
    contributionSignal,
    linkRetentionRate: safeDivide(linkAdditions, retainedLinksAfterFiltering),
    contributionPerAddedLink: safeDivide(contributionSignal, linkAdditions),
    contributionPerRetainedLink: safeDivide(contributionSignal, retainedLinksAfterFiltering),
    tooling: {
      providersExecuted: toolingProvidersExecuted,
      providersContributed: toolingProvidersContributed,
      degradedProviders: toolingDegradedProviders,
      degradedWarnings: toolingDegradedWarnings,
      degradedErrors: toolingDegradedErrors,
      requests: toolingRequests,
      requestFailures: toolingRequestFailures,
      requestTimeouts: toolingRequestTimeouts,
      requestFailureRate: safeDivide(toolingRequestFailures, toolingRequests),
      requestTimeoutRate: safeDivide(toolingRequestTimeouts, toolingRequests),
      degradedProviderRate: safeDivide(toolingDegradedProviders, toolingProvidersExecuted)
    }
  };
};
