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
  isActionableImportWarning,
  prepareImportResolutionFsMeta,
  resolveImportResolutionBudgetConfig,
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
const toSortedCountObject = (counts) => {
  const entries = Object.entries(
    counts && typeof counts === 'object' && !Array.isArray(counts) ? counts : {}
  )
    .filter(([key, value]) => key && Number.isFinite(Number(value)) && Number(value) > 0)
    .sort((a, b) => sortStrings(a[0], b[0]));
  return Object.fromEntries(entries.map(([key, value]) => [key, Math.floor(Number(value))]));
};

const normalizeUnresolvedSamples = (samples) => enrichUnresolvedImportSamples(samples);

const formatUnresolvedReasonCodeCounts = (reasonCodes) => {
  const entries = Object.entries(reasonCodes || {})
    .filter(([reasonCode, count]) => reasonCode && Number.isFinite(Number(count)) && Number(count) > 0)
    .sort((a, b) => sortStrings(a[0], b[0]));
  if (entries.length === 0) return 'none';
  return entries.map(([reasonCode, count]) => `${reasonCode}=${Number(count)}`).join(', ');
};

const formatUnresolvedFailureCauseCounts = (failureCauses) => {
  const entries = Object.entries(failureCauses || {})
    .filter(([failureCause, count]) => failureCause && Number.isFinite(Number(count)) && Number(count) > 0)
    .sort((a, b) => sortStrings(a[0], b[0]));
  if (entries.length === 0) return 'none';
  return entries.map(([failureCause, count]) => `${failureCause}=${Number(count)}`).join(', ');
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

const formatRateDelta = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'n/a';
  const prefix = numeric > 0 ? '+' : '';
  return `${prefix}${(numeric * 100).toFixed(2)}%`;
};

const formatUnresolvedFailureCauseDelta = (failureCauses) => {
  const entries = Object.entries(failureCauses || {})
    .filter(([failureCause, count]) => failureCause && Number.isFinite(Number(count)) && Number(count) !== 0)
    .sort((a, b) => sortStrings(a[0], b[0]));
  if (entries.length === 0) return 'none';
  return entries
    .map(([failureCause, count]) => {
      const numeric = Number(count);
      const prefix = numeric > 0 ? '+' : '';
      return `${failureCause}=${prefix}${numeric}`;
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

const resolveImportCacheStaleEdgeBudget = (resolverPlugins) => {
  const budgetConfig = resolveImportResolutionBudgetConfig(resolverPlugins);
  const budgetRaw = budgetConfig.maxStaleEdgeChecks ?? budgetConfig.maxCacheStaleEdgeChecks;
  const budget = Number(budgetRaw);
  if (!Number.isFinite(budget)) return null;
  if (budget <= 0) return 0;
  return Math.floor(budget);
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
  const actionable = normalized.filter((entry) => isActionableImportWarning(entry));
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
    `[imports] unresolved taxonomy: ${formatUnresolvedFailureCauseCounts(summary?.failureCauses)} ` +
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
    const reasonCode = entry.reasonCode || 'IMP_U_UNKNOWN';
    const failureCause = entry.failureCause || 'unknown';
    const confidence = Number.isFinite(entry.confidence) ? entry.confidence.toFixed(2) : 'n/a';
    log(
      `[imports] unresolved: ${from} -> ${specifier} ` +
      `[reasonCode=${reasonCode}, failureCause=${failureCause}, confidence=${confidence}]`
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
  const importHintsByFile = importResult?.importHintsByFile
    && typeof importResult.importHintsByFile === 'object'
    ? importResult.importHintsByFile
    : null;
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
  const maxStaleEdgeChecks = resolveImportCacheStaleEdgeBudget(resolverPlugins);
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
        resolverPlugins,
        abortSignal
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
      staleEdgeInvalidated: 0,
      staleEdgeChecks: 0,
      staleEdgeBudgetExhausted: false
    };
    applyImportResolutionCacheFileSetDiffInvalidation({
      cache,
      entries,
      maxStaleEdgeChecks,
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
        importHintsByFile,
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
  const unresolvedTaxonomySample = summarizeUnresolvedImportTaxonomy(unresolvedSamples);
  const unresolvedGateEligible = summarizeGateEligibleImportWarnings(unresolvedSamples, {
    excludedImporterSegments: DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS
  });
  const resolutionStatsSource = resolution?.stats && typeof resolution.stats === 'object'
    ? resolution.stats
    : {};
  const graphStatsSource = resolution?.graph?.stats && typeof resolution.graph.stats === 'object'
    ? resolution.graph.stats
    : {};
  const canonicalStatsSource = Object.keys(graphStatsSource).length > 0
    ? graphStatsSource
    : resolutionStatsSource;
  const unresolvedTotal = Number(canonicalStatsSource.unresolved);
  const unresolvedActionable = Number(canonicalStatsSource.unresolvedActionable);
  const unresolvedLiveSuppressed = Number(canonicalStatsSource.unresolvedLiveSuppressed);
  const unresolvedGateSuppressed = Number(canonicalStatsSource.unresolvedGateSuppressed);
  const unresolvedResolverSuppressed = Number(
    canonicalStatsSource.unresolvedResolverSuppressed ?? canonicalStatsSource.unresolvedSuppressed
  );
  const unresolvedReasonCodes = toSortedCountObject(
    canonicalStatsSource.unresolvedByReasonCode || unresolvedTaxonomySample.reasonCodes
  );
  const unresolvedFailureCauses = toSortedCountObject(
    canonicalStatsSource.unresolvedByFailureCause || unresolvedTaxonomySample.failureCauses
  );
  const unresolvedDispositions = toSortedCountObject(
    canonicalStatsSource.unresolvedByDisposition || unresolvedTaxonomySample.dispositions
  );
  const unresolvedResolverStages = toSortedCountObject(
    canonicalStatsSource.unresolvedByResolverStage || unresolvedTaxonomySample.resolverStages
  );
  const unresolvedActionableByLanguage = toSortedCountObject(
    canonicalStatsSource.unresolvedActionableByLanguage || unresolvedTaxonomySample.actionableByLanguage
  );
  const unresolvedActionableHotspots = Array.isArray(canonicalStatsSource.unresolvedActionableHotspots)
    ? canonicalStatsSource.unresolvedActionableHotspots
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        importer: typeof entry.importer === 'string' ? entry.importer : '',
        count: Math.floor(Number(entry.count) || 0)
      }))
      .filter((entry) => entry.importer && entry.count > 0)
      .sort((left, right) => (
        right.count !== left.count
          ? right.count - left.count
          : sortStrings(left.importer, right.importer)
      ))
      .slice(0, 20)
    : unresolvedTaxonomySample.actionableHotspots;
  const resolvedUnresolvedTotal = Number.isFinite(unresolvedTotal) && unresolvedTotal >= 0
    ? Math.floor(unresolvedTotal)
    : unresolvedTaxonomySample.total;
  const resolvedUnresolvedActionable = Number.isFinite(unresolvedActionable) && unresolvedActionable >= 0
    ? Math.floor(Math.min(unresolvedActionable, resolvedUnresolvedTotal))
    : unresolvedTaxonomySample.actionable;
  const resolvedUnresolvedLiveSuppressed = Number.isFinite(unresolvedLiveSuppressed) && unresolvedLiveSuppressed >= 0
    ? Math.floor(Math.min(unresolvedLiveSuppressed, resolvedUnresolvedTotal))
    : unresolvedTaxonomySample.liveSuppressed;
  const resolvedUnresolvedGateSuppressed = Number.isFinite(unresolvedGateSuppressed) && unresolvedGateSuppressed >= 0
    ? Math.floor(Math.min(unresolvedGateSuppressed, resolvedUnresolvedTotal))
    : (unresolvedTaxonomySample.gateSuppressed || 0);
  const resolvedUnresolvedResolverSuppressed = Number.isFinite(unresolvedResolverSuppressed)
    && unresolvedResolverSuppressed >= 0
    ? Math.floor(unresolvedResolverSuppressed)
    : (Number(resolution?.unresolvedSuppressed) || 0);
  const unresolvedObserved = Number(canonicalStatsSource.unresolvedObserved);
  const resolvedUnresolvedObserved = Number.isFinite(unresolvedObserved) && unresolvedObserved >= 0
    ? Math.floor(unresolvedObserved)
    : resolvedUnresolvedTotal;
  const parserArtifactCount = Number(unresolvedFailureCauses.parser_artifact) || 0;
  const resolverGapCount = Number(unresolvedFailureCauses.resolver_gap) || 0;
  const unresolvedActionableRate = resolvedUnresolvedTotal > 0
    ? resolvedUnresolvedActionable / resolvedUnresolvedTotal
    : 0;
  const unresolvedParserArtifactRate = resolvedUnresolvedTotal > 0
    ? parserArtifactCount / resolvedUnresolvedTotal
    : 0;
  const unresolvedResolverGapRate = resolvedUnresolvedTotal > 0
    ? resolverGapCount / resolvedUnresolvedTotal
    : 0;
  const resolverBudgetExhausted = Number(
    canonicalStatsSource.unresolvedBudgetExhausted ?? resolution?.stats?.unresolvedBudgetExhausted
  );
  const resolvedResolverBudgetExhausted = Number.isFinite(resolverBudgetExhausted) && resolverBudgetExhausted >= 0
    ? Math.floor(resolverBudgetExhausted)
    : 0;
  const resolverBudgetExhaustedByType = toSortedCountObject(
    canonicalStatsSource.unresolvedBudgetExhaustedByType || resolution?.stats?.unresolvedBudgetExhaustedByType || {}
  );
  const unresolvedTaxonomy = {
    total: resolvedUnresolvedTotal,
    actionable: resolvedUnresolvedActionable,
    liveSuppressed: resolvedUnresolvedLiveSuppressed,
    gateSuppressed: resolvedUnresolvedGateSuppressed,
    reasonCodes: unresolvedReasonCodes,
    failureCauses: unresolvedFailureCauses,
    dispositions: unresolvedDispositions,
    resolverStages: unresolvedResolverStages,
    actionableHotspots: unresolvedActionableHotspots,
    actionableByLanguage: unresolvedActionableByLanguage,
    actionableRate: unresolvedActionableRate,
    actionableUnresolvedRate: unresolvedActionableRate,
    parserArtifactRate: unresolvedParserArtifactRate,
    resolverGapRate: unresolvedResolverGapRate,
    resolverBudgetExhausted: resolvedResolverBudgetExhausted,
    resolverBudgetExhaustedByType
  };
  if (resolution?.graph && Array.isArray(resolution.graph.warnings)) {
    resolution.graph.warnings = unresolvedSamples.map((sample) => ({ ...sample }));
    if (resolution.graph.stats && typeof resolution.graph.stats === 'object') {
      resolution.graph.stats.unresolvedObserved = resolvedUnresolvedObserved;
      resolution.graph.stats.unresolved = resolvedUnresolvedTotal;
      resolution.graph.stats.unresolvedActionable = resolvedUnresolvedActionable;
      resolution.graph.stats.unresolvedLiveSuppressed = resolvedUnresolvedLiveSuppressed;
      resolution.graph.stats.unresolvedGateSuppressed = resolvedUnresolvedGateSuppressed;
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
      resolution.graph.stats.unresolvedActionableRate = unresolvedTaxonomy.actionableRate;
      resolution.graph.stats.unresolvedParserArtifactRate = unresolvedTaxonomy.parserArtifactRate;
      resolution.graph.stats.unresolvedResolverGapRate = unresolvedTaxonomy.resolverGapRate;
      resolution.graph.stats.unresolvedBudgetExhausted = resolvedResolverBudgetExhausted;
      resolution.graph.stats.unresolvedBudgetExhaustedByType = resolverBudgetExhaustedByType;
      resolution.graph.stats.unresolvedResolverSuppressed = resolvedUnresolvedResolverSuppressed;
    }
  }
  const cacheDiagnostics = cacheEnabled
    ? updateImportResolutionDiagnosticsCache({
      cache,
      unresolvedTaxonomy,
      unresolvedTotal: resolvedUnresolvedTotal
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
    resolvedStats.unresolvedObserved = resolvedUnresolvedObserved;
    resolvedStats.unresolved = resolvedUnresolvedTotal;
    resolvedStats.unresolvedActionable = resolvedUnresolvedActionable;
    resolvedStats.unresolvedLiveSuppressed = resolvedUnresolvedLiveSuppressed;
    resolvedStats.unresolvedGateSuppressed = resolvedUnresolvedGateSuppressed;
    resolvedStats.unresolvedActionableRate = unresolvedTaxonomy.actionableRate;
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
    resolvedStats.unresolvedParserArtifactRate = unresolvedTaxonomy.parserArtifactRate;
    resolvedStats.unresolvedResolverGapRate = unresolvedTaxonomy.resolverGapRate;
    resolvedStats.unresolvedBudgetExhausted = resolvedResolverBudgetExhausted;
    resolvedStats.unresolvedBudgetExhaustedByType = resolverBudgetExhaustedByType;
  }
  const resolvedResult = {
    importsByFile,
    stats: resolvedStats,
    unresolvedSamples,
    unresolvedSuppressed: resolution?.unresolvedSuppressed || 0,
    unresolvedTaxonomy,
    resolverBudgetExhausted: resolvedResolverBudgetExhausted,
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
      const deltaByFailureCause = formatUnresolvedFailureCauseDelta(
        resolvedResult?.cacheDiagnostics?.unresolvedTrend?.deltaByFailureCause
      );
      log(`[imports] unresolved delta vs previous run: ${sign}${deltaTotal} (byFailureCause: ${deltaByFailureCause})`);
      const deltaActionableRate = resolvedResult?.cacheDiagnostics?.unresolvedTrend?.deltaActionableRate;
      const deltaParserArtifactRate = resolvedResult?.cacheDiagnostics?.unresolvedTrend?.deltaParserArtifactRate;
      const deltaResolverGapRate = resolvedResult?.cacheDiagnostics?.unresolvedTrend?.deltaResolverGapRate;
      log(
        `[imports] unresolved rate drift vs previous run: ` +
        `actionable=${formatRateDelta(deltaActionableRate)}, ` +
        `parser_artifact=${formatRateDelta(deltaParserArtifactRate)}, ` +
        `resolver_gap=${formatRateDelta(deltaResolverGapRate)}`
      );
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
