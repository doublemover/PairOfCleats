import { log, logLine } from '../../../../../shared/progress.js';
import { throwIfAborted } from '../../../../../shared/abort.js';
import {
  enrichUnresolvedImportSamples,
  scanImports,
  summarizeUnresolvedImportTaxonomy
} from '../../../imports.js';
import {
  DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS,
  createFsExistsIndex,
  formatResolverPipelineStageSummary,
  prepareImportResolutionFsMeta,
  resolveImportLinks,
  resolveResolverPipelineStageHighlights,
  summarizeGateEligibleImportWarnings
} from '../../../import-resolution.js';
import {
  applyImportResolutionCacheFileSetDiffInvalidation,
  loadImportResolutionCache,
  saveImportResolutionCache,
  updateImportResolutionDiagnosticsCache
} from '../../../import-resolution-cache.js';
import { resolveHangProbeConfig, runWithHangProbe } from '../../hang-probe.js';

const MAX_UNRESOLVED_IMPORT_LOG_LINES = 50;
const sortStrings = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

const normalizeUnresolvedSamples = (samples) => enrichUnresolvedImportSamples(samples);

const formatUnresolvedCategoryCounts = (categories) => {
  const entries = Object.entries(categories || {})
    .filter(([category, count]) => category && Number.isFinite(Number(count)) && Number(count) > 0)
    .sort((a, b) => sortStrings(a[0], b[0]));
  if (entries.length === 0) return 'none';
  return entries.map(([category, count]) => `${category}=${Number(count)}`).join(', ');
};

const formatUnresolvedReasonCodeCounts = (reasonCodes) => {
  const entries = Object.entries(reasonCodes || {})
    .filter(([reasonCode, count]) => reasonCode && Number.isFinite(Number(count)) && Number(count) > 0)
    .sort((a, b) => sortStrings(a[0], b[0]));
  if (entries.length === 0) return 'none';
  return entries.map(([reasonCode, count]) => `${reasonCode}=${Number(count)}`).join(', ');
};

const formatUnresolvedResolverStageCounts = (resolverStages) => {
  const entries = Object.entries(resolverStages || {})
    .filter(([stage, count]) => stage && Number.isFinite(Number(count)) && Number(count) > 0)
    .sort((a, b) => sortStrings(a[0], b[0]));
  if (entries.length === 0) return 'none';
  return entries.map(([stage, count]) => `${stage}=${Number(count)}`).join(', ');
};

const formatBudgetExhaustedByType = (counts) => {
  const entries = Object.entries(counts || {})
    .filter(([kind, count]) => kind && Number.isFinite(Number(count)) && Number(count) > 0)
    .sort((a, b) => sortStrings(a[0], b[0]));
  if (entries.length === 0) return 'none';
  return entries.map(([kind, count]) => `${kind}=${Number(count)}`).join(', ');
};

const formatUnresolvedActionableHotspots = (hotspots, maxEntries = 3) => {
  const normalized = Array.isArray(hotspots)
    ? hotspots
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        importer: typeof entry.importer === 'string' ? entry.importer : '',
        count: Math.floor(Number(entry.count) || 0)
      }))
      .filter((entry) => entry.importer && entry.count > 0)
    : [];
  if (!normalized.length) return 'none';
  return normalized
    .slice(0, Math.max(0, Math.floor(Number(maxEntries) || 0)))
    .map((entry) => `${entry.importer}=${entry.count}`)
    .join(', ');
};

const formatUnresolvedActionableByLanguage = (counts, maxEntries = 5) => {
  const entries = Object.entries(counts || {})
    .filter(([language, count]) => language && Number.isFinite(Number(count)) && Number(count) > 0)
    .map(([language, count]) => ({
      language,
      count: Math.floor(Number(count))
    }))
    .sort((a, b) => (
      b.count !== a.count
        ? b.count - a.count
        : sortStrings(a.language, b.language)
    ))
    .slice(0, Math.max(0, Math.floor(Number(maxEntries) || 0)));
  if (entries.length === 0) return 'none';
  return entries.map((entry) => `${entry.language}=${entry.count}`).join(', ');
};

const formatRate = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return '0.00%';
  return `${(numeric * 100).toFixed(2)}%`;
};

const formatUnresolvedCategoryDelta = (categories) => {
  const entries = Object.entries(categories || {})
    .filter(([category, count]) => category && Number.isFinite(Number(count)) && Number(count) !== 0)
    .sort((a, b) => sortStrings(a[0], b[0]));
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

const resolveImportBudgetRuntimeSignals = (runtime) => {
  const schedulerStats = typeof runtime?.scheduler?.stats === 'function'
    ? runtime.scheduler.stats()
    : null;
  const scheduler = schedulerStats && typeof schedulerStats === 'object'
    ? {
      utilizationOverall: Number(schedulerStats?.utilization?.overall),
      pending: Number(schedulerStats?.activity?.pending),
      running: Number(schedulerStats?.activity?.running),
      memoryPressure: Number(schedulerStats?.adaptive?.signals?.memory?.pressureScore),
      fdPressure: Number(schedulerStats?.adaptive?.signals?.fd?.pressureScore)
    }
    : null;
  const envelope = runtime?.envelope?.concurrency && typeof runtime.envelope.concurrency === 'object'
    ? {
      cpuConcurrency: Number(runtime.envelope.concurrency?.cpuConcurrency?.value),
      ioConcurrency: Number(runtime.envelope.concurrency?.ioConcurrency?.value)
    }
    : null;
  if (!scheduler && !envelope) return null;
  return {
    scheduler,
    envelope
  };
};

const logUnresolvedImportSamples = ({
  samples,
  suppressed,
  unresolvedTotal,
  taxonomy,
  alreadyNormalized = false
}) => {
  const normalized = alreadyNormalized
    ? (Array.isArray(samples) ? samples : [])
    : normalizeUnresolvedSamples(samples);
  const summary = taxonomy && typeof taxonomy === 'object'
    ? taxonomy
    : summarizeUnresolvedImportTaxonomy(normalized);
  if (normalized.length === 0) {
    if (Number.isFinite(unresolvedTotal) && unresolvedTotal > 0) {
      log(`[imports] unresolved imports=${unresolvedTotal}; no unresolved samples were captured.`);
    }
    return;
  }
  const actionable = normalized.filter((entry) => entry?.disposition === 'actionable');
  const visible = actionable.slice(0, MAX_UNRESOLVED_IMPORT_LOG_LINES);
  const total = Number.isFinite(unresolvedTotal) ? unresolvedTotal : normalized.length;
  const actionableTotal = Number.isFinite(summary?.actionable) ? summary.actionable : actionable.length;
  const policySuppressed = Number.isFinite(summary?.liveSuppressed) ? summary.liveSuppressed : 0;
  const actionableRate = Number.isFinite(summary?.actionableUnresolvedRate)
    ? summary.actionableUnresolvedRate
    : summary?.actionableRate;
  const parserArtifactRate = Number.isFinite(summary?.parserArtifactRate) ? summary.parserArtifactRate : 0;
  const resolverGapRate = Number.isFinite(summary?.resolverGapRate) ? summary.resolverGapRate : 0;
  log(
    `[imports] unresolved taxonomy: ${formatUnresolvedCategoryCounts(summary?.categories)} ` +
    `(actionable=${actionableTotal}, live-suppressed=${policySuppressed})`
  );
  log(
    `[imports] unresolved rates: actionable=${formatRate(actionableRate)}, ` +
    `parser_artifact=${formatRate(parserArtifactRate)}, resolver_gap=${formatRate(resolverGapRate)}`
  );
  log(`[imports] unresolved reason codes: ${formatUnresolvedReasonCodeCounts(summary?.reasonCodes)}`);
  log(`[imports] unresolved resolver stages: ${formatUnresolvedResolverStageCounts(summary?.resolverStages)}`);
  const budgetExhausted = Number(summary?.resolverBudgetExhausted || 0);
  if (budgetExhausted > 0) {
    log(
      `[imports] unresolved resolver budgets exhausted: ${budgetExhausted} ` +
      `(byType=${formatBudgetExhaustedByType(summary?.resolverBudgetExhaustedByType)})`
    );
  }
  log(`[imports] unresolved actionable hotspots: ${formatUnresolvedActionableHotspots(summary?.actionableHotspots)}`);
  log(`[imports] unresolved actionable languages: ${formatUnresolvedActionableByLanguage(summary?.actionableByLanguage)}`);
  log(`[imports] unresolved import samples (${visible.length} live of ${total}):`);
  for (const entry of visible) {
    const from = entry.importer || '<unknown-importer>';
    const specifier = entry.specifier || '<empty-specifier>';
    const category = entry.category || 'unknown';
    const reasonCode = entry.reasonCode || 'IMP_U_UNKNOWN';
    const confidence = Number.isFinite(entry.confidence) ? entry.confidence.toFixed(2) : 'n/a';
    log(
      `[imports] unresolved: ${from} -> ${specifier} ` +
      `[category=${category}, reasonCode=${reasonCode}, confidence=${confidence}]`
    );
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

/**
 * Perform optional pre-scan import discovery before chunk processing.
 *
 * @param {object} input
 * @returns {Promise<{importResult:{importsByFile:object,durationMs:number,stats:object|null},scanPlan:object}>}
 */
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
  fileTextByFile,
  hangProbeConfig = null,
  abortSignal = null
}) => {
  throwIfAborted(abortSignal);
  if (!scanPlan?.shouldScan) return null;
  if (!mode || mode !== 'code' || !relationsEnabled || !scanPlan.enableImportLinks) return null;
  const probeConfig = resolveHangProbeConfig(hangProbeConfig);
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
  const resolverPlugins = resolveImportResolverPlugins(runtime);
  const budgetRuntimeSignals = resolveImportBudgetRuntimeSignals(runtime);
  const fsMeta = await runWithHangProbe({
    ...probeConfig,
    label: 'imports.prepare-fs-meta',
    mode,
    stage: 'imports',
    step: 'fs-meta',
    log: logLine,
    meta: {
      entryCount: Array.isArray(entries) ? entries.length : 0,
      importerFiles: Object.keys(importsByFile).length
    },
    run: () => {
      throwIfAborted(abortSignal);
      return prepareImportResolutionFsMeta({
        root: runtime.root,
        entries,
        importsByFile
      });
    }
  });
  throwIfAborted(abortSignal);
  const fsExistsIndex = await runWithHangProbe({
    ...probeConfig,
    label: 'imports.prepare-fs-exists-index',
    mode,
    stage: 'imports',
    step: 'fs-exists-index',
    log: logLine,
    meta: {
      entryCount: Array.isArray(entries) ? entries.length : 0
    },
    run: () => {
      throwIfAborted(abortSignal);
      return createFsExistsIndex({
        root: runtime.root,
        entries,
        resolverPlugins
      });
    }
  });
  throwIfAborted(abortSignal);
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
  const resolution = await runWithHangProbe({
    ...probeConfig,
    label: 'imports.resolve-links',
    mode,
    stage: 'imports',
    step: 'resolve-links',
    log: logLine,
    meta: {
      importerFiles: Object.keys(importsByFile).length,
      cacheEnabled
    },
    run: () => {
      throwIfAborted(abortSignal);
      return resolveImportLinks({
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
        fsExistsIndex,
        resolverPlugins,
        budgetRuntimeSignals
      });
    }
  });
  throwIfAborted(abortSignal);
  const unresolvedSamples = normalizeUnresolvedSamples(resolution?.unresolvedSamples);
  const unresolvedTaxonomyBase = summarizeUnresolvedImportTaxonomy(unresolvedSamples);
  const unresolvedGateEligible = summarizeGateEligibleImportWarnings(unresolvedSamples, {
    excludedImporterSegments: DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS
  });
  const resolverBudgetExhausted = Number(resolution?.stats?.unresolvedBudgetExhausted) || 0;
  const resolverBudgetExhaustedByType = resolution?.stats?.unresolvedBudgetExhaustedByType || {};
  const unresolvedTaxonomy = {
    ...unresolvedTaxonomyBase,
    resolverBudgetExhausted,
    resolverBudgetExhaustedByType
  };
  if (resolution?.graph && Array.isArray(resolution.graph.warnings)) {
    resolution.graph.warnings = unresolvedSamples.map((sample) => ({ ...sample }));
    if (resolution.graph.stats && typeof resolution.graph.stats === 'object') {
      const unresolvedObserved = Number(resolution.graph.stats.unresolved) || 0;
      const resolverSuppressed = Number(resolution.graph.stats.unresolvedSuppressed) || 0;
      resolution.graph.stats.unresolvedObserved = unresolvedObserved;
      resolution.graph.stats.unresolved = unresolvedTaxonomy.total;
      resolution.graph.stats.unresolvedByCategory = unresolvedTaxonomy.categories;
      resolution.graph.stats.unresolvedActionable = unresolvedTaxonomy.actionable;
      resolution.graph.stats.unresolvedLiveSuppressed = unresolvedTaxonomy.liveSuppressed;
      resolution.graph.stats.unresolvedGateSuppressed = unresolvedTaxonomy.gateSuppressed || 0;
      resolution.graph.stats.unresolvedByReasonCode = unresolvedTaxonomy.reasonCodes;
      resolution.graph.stats.unresolvedByFailureCause = unresolvedTaxonomy.failureCauses;
      resolution.graph.stats.unresolvedByDisposition = unresolvedTaxonomy.dispositions;
      resolution.graph.stats.unresolvedByResolverStage = unresolvedTaxonomy.resolverStages;
      resolution.graph.stats.unresolvedActionableHotspots = unresolvedTaxonomy.actionableHotspots;
      resolution.graph.stats.unresolvedActionableByLanguage = unresolvedTaxonomy.actionableByLanguage;
      resolution.graph.stats.unresolvedGateEligible = unresolvedGateEligible.unresolved;
      resolution.graph.stats.unresolvedActionableGateEligible = unresolvedGateEligible.actionable;
      resolution.graph.stats.unresolvedGateEligibleActionableRate = unresolvedGateEligible.unresolved > 0
        ? unresolvedGateEligible.actionable / unresolvedGateEligible.unresolved
        : 0;
      resolution.graph.stats.unresolvedLiveSuppressedCategories = unresolvedTaxonomy.liveSuppressedCategories;
      resolution.graph.stats.unresolvedActionableRate = unresolvedTaxonomy.actionableUnresolvedRate;
      resolution.graph.stats.unresolvedParserArtifactRate = unresolvedTaxonomy.parserArtifactRate;
      resolution.graph.stats.unresolvedResolverGapRate = unresolvedTaxonomy.resolverGapRate;
      resolution.graph.stats.unresolvedBudgetExhausted = resolverBudgetExhausted;
      resolution.graph.stats.unresolvedBudgetExhaustedByType = resolverBudgetExhaustedByType;
      resolution.graph.stats.unresolvedResolverSuppressed = resolverSuppressed;
    }
  }
  const cacheDiagnostics = cacheEnabled
    ? updateImportResolutionDiagnosticsCache({
      cache,
      unresolvedTaxonomy,
      unresolvedTotal: unresolvedTaxonomy.total
    })
    : null;
  if (resolution?.graph) {
    state.importResolutionGraph = resolution.graph;
  }
  if (cacheEnabled && cache && cachePath) {
    await saveImportResolutionCache({ cache, cachePath });
  }
  const resolvedStats = resolution?.stats && typeof resolution.stats === 'object'
    ? { ...resolution.stats }
    : null;
  if (resolvedStats) {
    resolvedStats.unresolved = unresolvedTaxonomy.total;
    resolvedStats.unresolvedActionable = unresolvedTaxonomy.actionable;
    resolvedStats.unresolvedLiveSuppressed = unresolvedTaxonomy.liveSuppressed;
    resolvedStats.unresolvedGateSuppressed = unresolvedTaxonomy.gateSuppressed || 0;
    resolvedStats.unresolvedByCategory = unresolvedTaxonomy.categories;
    resolvedStats.unresolvedActionableRate = unresolvedTaxonomy.actionableUnresolvedRate;
    resolvedStats.unresolvedByFailureCause = unresolvedTaxonomy.failureCauses;
    resolvedStats.unresolvedByDisposition = unresolvedTaxonomy.dispositions;
    resolvedStats.unresolvedByResolverStage = unresolvedTaxonomy.resolverStages;
    resolvedStats.unresolvedActionableHotspots = unresolvedTaxonomy.actionableHotspots;
    resolvedStats.unresolvedActionableByLanguage = unresolvedTaxonomy.actionableByLanguage;
    resolvedStats.unresolvedGateEligible = unresolvedGateEligible.unresolved;
    resolvedStats.unresolvedActionableGateEligible = unresolvedGateEligible.actionable;
    resolvedStats.unresolvedGateEligibleActionableRate = unresolvedGateEligible.unresolved > 0
      ? unresolvedGateEligible.actionable / unresolvedGateEligible.unresolved
      : 0;
    resolvedStats.unresolvedLiveSuppressedCategories = unresolvedTaxonomy.liveSuppressedCategories;
    resolvedStats.unresolvedParserArtifactRate = unresolvedTaxonomy.parserArtifactRate;
    resolvedStats.unresolvedResolverGapRate = unresolvedTaxonomy.resolverGapRate;
    resolvedStats.unresolvedBudgetExhausted = resolverBudgetExhausted;
    resolvedStats.unresolvedBudgetExhaustedByType = resolverBudgetExhaustedByType;
  }
  const resolvedResult = {
    importsByFile,
    stats: resolvedStats,
    unresolvedSamples,
    unresolvedSuppressed: resolution?.unresolvedSuppressed || 0,
    unresolvedTaxonomy,
    resolverBudgetExhausted,
    resolverBudgetExhaustedByType,
    cacheDiagnostics: cacheDiagnostics || null,
    cacheStats: resolution?.cacheStats || cacheStats || null,
    durationMs: Date.now() - importStart
  };
  timing.importsMs = resolvedResult.durationMs;
  if (resolvedResult?.stats) {
    const { resolved, external, unresolved } = resolvedResult.stats;
    log(`→ Imports: resolved=${resolved}, external=${external}, unresolved=${unresolved}`);
    const resolverBudgetPolicy = resolvedResult.stats?.resolverBudgetPolicy;
    if (resolverBudgetPolicy && typeof resolverBudgetPolicy === 'object') {
      log(
        `[imports] resolver budgets: fsProbe<=${resolverBudgetPolicy.maxFilesystemProbesPerSpecifier}, ` +
        `fallbackCandidates<=${resolverBudgetPolicy.maxFallbackCandidatesPerSpecifier}, ` +
        `fallbackDepth<=${resolverBudgetPolicy.maxFallbackDepth}, ` +
        `adaptive=${resolverBudgetPolicy.adaptiveEnabled === true ? 'on' : 'off'} ` +
        `(profile=${resolverBudgetPolicy.adaptiveProfile || 'normal'}, ` +
        `scale=${Number(resolverBudgetPolicy.adaptiveScale || 1).toFixed(3)}).`
      );
    }
    const resolverFsExistsIndex = resolvedResult.stats?.resolverFsExistsIndex;
    if (resolverFsExistsIndex && typeof resolverFsExistsIndex === 'object') {
      log(
        `[imports] fs-exists-index: enabled=${resolverFsExistsIndex.enabled === true ? 'yes' : 'no'}, ` +
        `complete=${resolverFsExistsIndex.complete === true ? 'yes' : 'no'}, ` +
        `indexed=${Number(resolverFsExistsIndex.indexedCount || 0)}, ` +
        `exactHits=${Number(resolverFsExistsIndex.exactHits || 0)}, ` +
        `negativeSkips=${Number(resolverFsExistsIndex.negativeSkips || 0)}, ` +
        `unknownFallbacks=${Number(resolverFsExistsIndex.unknownFallbacks || 0)}`
      );
    }
    const resolverPipelineStages = resolvedResult.stats?.resolverPipelineStages;
    if (resolverPipelineStages && typeof resolverPipelineStages === 'object') {
      log(`[imports] resolver pipeline: ${formatResolverPipelineStageSummary(resolverPipelineStages)}`);
      const stageHighlights = resolveResolverPipelineStageHighlights(resolverPipelineStages);
      log(
        `[imports] resolver pipeline highlights: ` +
        `elapsed=${stageHighlights.topByElapsed ? `${stageHighlights.topByElapsed.stage}=${stageHighlights.topByElapsed.elapsedMs.toFixed(3)}ms` : 'none'}, ` +
        `budget=${stageHighlights.topByBudgetExhausted ? `${stageHighlights.topByBudgetExhausted.stage}=${stageHighlights.topByBudgetExhausted.budgetExhausted}` : 'none'}, ` +
        `degraded=${stageHighlights.topByDegraded ? `${stageHighlights.topByDegraded.stage}=${stageHighlights.topByDegraded.degraded}` : 'none'}`
      );
    }
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
        taxonomy: resolvedResult.unresolvedTaxonomy,
        alreadyNormalized: true
      });
    }
  }
  return resolvedResult;
};
