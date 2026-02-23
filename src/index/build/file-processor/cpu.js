import { assignSegmentUids, discoverSegments } from '../../segments.js';
import { toRepoPosixPath } from '../../scm/paths.js';
import { buildLineAuthors } from '../../scm/annotate.js';
import { buildCallIndex, buildFileRelations } from './relations.js';
import {
  filterRawRelationsWithLexicon,
  getLexiconRelationFilterStats
} from './lexicon-relations-filter.js';
import {
  sanitizeChunkBounds,
  validateChunkBounds
} from './cpu/chunking.js';
import { buildLanguageAnalysisContext } from './cpu/analyze.js';
import { buildCommentMeta } from './cpu/meta.js';
import { resolveFileParsePolicy } from './cpu/parse-policy.js';
import { chunkWithScheduler } from './cpu/scheduler-chunking.js';
import {
  SCM_ANNOTATE_DEFAULT_TIMEOUT_CAP_MS,
  SCM_ANNOTATE_FAST_TIMEOUT_EXTS,
  SCM_ANNOTATE_FAST_TIMEOUT_MS,
  SCM_ANNOTATE_HEAVY_PATH_TIMEOUT_MS,
  SCM_ANNOTATE_PYTHON_HEAVY_LINE_CUTOFF,
  SCM_ANNOTATE_PYTHON_MAX_BYTES,
  SCM_CHURN_MAX_BYTES,
  SCM_META_FAST_TIMEOUT_EXTS,
  SCM_PYTHON_EXTS,
  isHeavyRelationsPath,
  isPythonGeneratedDataPath,
  isScmFastPath,
  isScmTaskTimeoutError,
  resolveScmTaskDeadlineMs,
  shouldForceScmTimeoutCaps,
  shouldSkipHeavyRelations
} from './cpu/guardrails.js';
import { mergePlannedSegmentsWithExtras } from './cpu/segment-planning.js';
import { resolveFileCaps } from './read.js';
import { shouldPreferDocsProse } from '../mode-routing.js';
import { buildLineIndex } from '../../../shared/lines.js';
import { formatError } from './meta.js';
import { processChunks } from './process-chunks.js';
import { resolveChunkingFileRole } from '../../chunking/limits.js';
import { createTimeoutError, runWithTimeout } from '../../../shared/promise-timeout.js';

/**
 * Execute CPU-phase analysis for a file, including parse policy resolution,
 * chunk production, relations/lint/complexity passes, and enrichment payload assembly.
 *
 * The function is stateful by design: it updates crash-stage breadcrumbs, timing
 * collectors, cache-backed analysis artifacts, and SCM/Tree-sitter fallback paths.
 *
 * @param {object} context
 * @returns {Promise<object|null>}
 */
export const processFileCpu = async (context) => {
  const {
    abs,
    root,
    mode,
    fileEntry,
    fileIndex,
    ext,
    rel,
    relKey,
    text,
    documentExtraction,
    fileStat,
    fileHash,
    fileHashAlgo,
    fileCaps,
    fileStructural,
    scmProvider,
    scmProviderImpl,
    scmRepoRoot,
    scmConfig,
    scmFileMetaByPath,
    languageOptions,
    astDataflowEnabled,
    controlFlowEnabled,
    normalizedSegmentsConfig,
    normalizedCommentsConfig,
    tokenDictWords,
    dictConfig,
    tokenContext,
    postingsConfig,
    contextWin,
    relationsEnabled,
    lintEnabled,
    complexityEnabled,
    typeInferenceEnabled,
    riskAnalysisEnabled,
    riskConfig,
    gitBlameEnabled,
    analysisPolicy,
    workerPool,
    workerDictOverride,
    workerState,
    tokenizationStats,
    tokenizeEnabled,
    embeddingEnabled,
    embeddingNormalize,
    embeddingBatchSize,
    getChunkEmbedding,
    getChunkEmbeddings,
    runEmbedding,
    runProc,
    runTreeSitterSerial,
    runIo,
    log,
    logLine,
    showLineProgress,
    toolInfo,
    treeSitterScheduler,
    perfEventLogger,
    timing,
    languageHint,
    crashLogger,
    vfsManifestConcurrency,
    complexityCache,
    lintCache,
    buildStage,
    scmMetaCache = null,
    extractedProseExtrasCache = null,
    primeExtractedProseExtrasCache = false,
    onScmProcQueueWait = null
  } = context;

  const {
    metricsCollector,
    addSettingMetric,
    addLineSpan,
    addParseDuration,
    addTokenizeDuration,
    addEnrichDuration,
    addEmbeddingDuration,
    addLintDuration,
    addComplexityDuration,
    setGitDuration,
    setPythonAstDuration
  } = timing;

  /**
   * Record per-file CPU pipeline stage updates in crash telemetry.
   *
   * @param {string} substage
   * @param {object} [extra]
   * @returns {void}
   */
  const updateCrashStage = (substage, extra = {}) => {
    if (!crashLogger?.enabled) return;
    const entry = {
      phase: 'processing',
      mode,
      stage: buildStage || null,
      fileIndex: Number.isFinite(fileIndex) ? fileIndex : null,
      file: relKey,
      substage,
      ...extra
    };
    crashLogger.updateFile(entry);
    if (typeof crashLogger.traceFileStage === 'function') {
      crashLogger.traceFileStage(entry);
    }
  };

  /**
   * Build a normalized "skip this file" result payload for recoverable CPU
   * stage failures.
   *
   * @param {string} reason
   * @param {string} stage
   * @param {unknown} err
   * @param {object} [extra]
   * @returns {{chunks:Array, fileRelations:null, skip:{reason:string,stage:string,message:string}}}
   */
  const failFile = (reason, stage, err, extra = {}) => ({
    chunks: [],
    fileRelations: null,
    skip: {
      reason,
      stage,
      message: formatError(err),
      ...extra
    }
  });

  let fileLanguageId = languageHint?.id || null;
  let fileLineCount = 0;
  updateCrashStage('start', { size: fileStat?.size || null, ext });

  const {
    extractedDocumentFile,
    resolvedSegmentsConfig,
    treeSitterEnabled,
    treeSitterLanguagePasses,
    treeSitterConfigForMode,
    schedulerPlannedSegments,
    hasSchedulerPlannedSegments,
    shouldSerializeLanguageContext,
    languageContextOptions,
    primaryLanguageId
  } = resolveFileParsePolicy({
    fileEntry,
    languageOptions,
    mode,
    fileHash,
    treeSitterScheduler,
    relKey,
    languageHint,
    normalizedSegmentsConfig,
    documentExtraction,
    relationsEnabled,
    metricsCollector,
    abs,
    fileStat
  });
  const runTreeSitter = shouldSerializeLanguageContext ? runTreeSitterSerial : (fn) => fn();
  let lang = null;
  let languageContext = {};
  updateCrashStage('tree-sitter:start');
  try {
    ({ lang, context: languageContext } = await buildLanguageAnalysisContext({
      ext,
      relKey,
      mode,
      text,
      languageContextOptions,
      treeSitterEnabled,
      treeSitterLanguagePasses,
      treeSitterConfigForMode,
      primaryLanguageId,
      runTreeSitter
    }));
    updateCrashStage('tree-sitter:done', {
      languageId: lang?.id || null,
      hasLanguageContext: Boolean(languageContext && typeof languageContext === 'object')
    });
  } catch (err) {
    updateCrashStage('tree-sitter:error', {
      errorName: err?.name || null,
      errorCode: err?.code || null
    });
    if (languageOptions?.skipOnParseError) {
      return {
        chunks: [],
        fileRelations: null,
        skip: {
          reason: 'parse-error',
          stage: 'prepare',
          message: err?.message || String(err)
        }
      };
    }
    throw err;
  }
  fileLanguageId = lang?.id || null;
  const allowUnknownLanguage = mode === 'prose'
    || mode === 'extracted-prose'
    || extractedDocumentFile;
  if (!lang && languageOptions?.skipUnknownLanguages && !allowUnknownLanguage) {
    return {
      chunks: [],
      fileRelations: null,
      skip: {
        reason: 'unsupported-language',
        diagnostics: [
          {
            code: 'USR-E-CAPABILITY-LOST',
            reasonCode: 'USR-R-PARSER-UNAVAILABLE',
            detail: ext || null
          }
        ]
      }
    };
  }
  if (languageContext?.pythonAstMetrics?.durationMs) {
    setPythonAstDuration(languageContext.pythonAstMetrics.durationMs);
  }
  const tokenMode = mode === 'extracted-prose' ? 'prose' : mode;
  const lineIndex = buildLineIndex(text);
  const totalLines = lineIndex.length || 1;
  const fileBytes = fileStat?.size ?? 0;
  fileLineCount = totalLines;
  const capsByLanguage = resolveFileCaps(fileCaps, ext, lang?.id, mode);
  if (capsByLanguage.maxLines && totalLines > capsByLanguage.maxLines) {
    return {
      chunks: [],
      fileRelations: null,
      skip: {
        reason: 'oversize',
        stage: 'cpu',
        capSource: 'maxLines',
        lines: totalLines,
        maxLines: capsByLanguage.maxLines
      }
    };
  }
  const skipHeavyRelations = shouldSkipHeavyRelations({
    mode,
    relationsEnabled,
    relPath: relKey,
    fileBytes,
    fileLines: totalLines
  });
  const effectiveRelationsEnabled = relationsEnabled && !skipHeavyRelations;
  let rawRelations = null;
  if (mode === 'code' && effectiveRelationsEnabled && lang && typeof lang.buildRelations === 'function') {
    try {
      rawRelations = lang.buildRelations({
        text,
        relPath: relKey,
        context: languageContext,
        options: languageOptions
      });
    } catch (err) {
      return failFile('relation-error', 'relations', err);
    }
  }
  let filteredRelations = rawRelations;
  let lexiconFilterStats = null;
  if (mode === 'code' && effectiveRelationsEnabled && rawRelations) {
    const lexiconRelationConfig = languageOptions?.lexicon?.relations;
    const logPerFileLexiconFilter = lexiconRelationConfig && typeof lexiconRelationConfig === 'object'
      ? lexiconRelationConfig.logPerFile === true
      : false;
    filteredRelations = filterRawRelationsWithLexicon(rawRelations, {
      languageId: lang?.id || null,
      config: languageOptions?.lexicon || null,
      log: logPerFileLexiconFilter ? log : null,
      relKey
    });
    lexiconFilterStats = getLexiconRelationFilterStats(filteredRelations);
  }
  const fileRelations = effectiveRelationsEnabled ? buildFileRelations(filteredRelations, relKey) : null;
  const callIndex = effectiveRelationsEnabled ? buildCallIndex(filteredRelations) : null;
  const resolvedGitBlameEnabled = typeof analysisPolicy?.git?.blame === 'boolean'
    ? analysisPolicy.git.blame
    : gitBlameEnabled;
  const resolvedGitChurnEnabled = typeof analysisPolicy?.git?.churn === 'boolean'
    ? analysisPolicy.git.churn
    : true;
  updateCrashStage('scm-meta', { blame: resolvedGitBlameEnabled });
  const scmStart = Date.now();
  let lineAuthors = null;
  let fileGitMeta = {};
  let fileGitCommitId = null;
  const scmActive = scmProviderImpl && scmProvider && scmProvider !== 'none';
  const filePosix = scmActive && scmRepoRoot
    ? toRepoPosixPath(abs, scmRepoRoot)
    : null;
  const normalizedExt = typeof ext === 'string' ? ext.toLowerCase() : '';
  const proseRoutePreferred = shouldPreferDocsProse({ ext: normalizedExt, relPath: relKey });
  // Keep SCM metadata for prose mode so retrieval filters can use author/date
  // constraints, but still skip docs-prose routes in code/extracted-prose lanes.
  const skipScmForProseRoute = proseRoutePreferred && mode !== 'prose';
  // Prose-route docs payloads (large HTML/search JSON) are watchdog-prone when
  // line-level annotate runs for every file; keep lightweight file metadata but
  // skip annotate for this route.
  const skipScmAnnotateForProseRoute = proseRoutePreferred && mode === 'prose';
  const scmFastPath = isScmFastPath({ relPath: relKey, ext: normalizedExt, lines: fileLineCount });
  const isPythonScmPath = SCM_PYTHON_EXTS.has(normalizedExt);
  const skipScmAnnotateForGeneratedPython = isPythonScmPath
    && (
      fileLineCount >= SCM_ANNOTATE_PYTHON_HEAVY_LINE_CUTOFF
      || isPythonGeneratedDataPath(relKey)
    );
  const annotateConfig = scmConfig?.annotate || {};
  const skipScmAnnotateForProseMode = mode === 'prose' && annotateConfig?.prose !== true;
  const skipScmAnnotateForExtractedProseMode = mode === 'extracted-prose'
    && annotateConfig?.extractedProse !== true;
  const forceScmTimeoutCaps = shouldForceScmTimeoutCaps(relKey);
  const enforceScmTimeoutCaps = forceScmTimeoutCaps || (
    scmConfig?.allowSlowTimeouts !== true
    && annotateConfig?.allowSlowTimeouts !== true
  );
  const metaTimeoutRaw = Number(scmConfig?.timeoutMs);
  const hasExplicitMetaTimeout = Number.isFinite(metaTimeoutRaw) && metaTimeoutRaw > 0;
  let metaTimeoutMs = hasExplicitMetaTimeout
    ? metaTimeoutRaw
    : 2000;
  if (enforceScmTimeoutCaps) {
    const metaCapMs = scmFastPath || SCM_META_FAST_TIMEOUT_EXTS.has(normalizedExt) ? 250 : 750;
    metaTimeoutMs = Math.min(metaTimeoutMs, metaCapMs);
  }
  const runScmTask = typeof runProc === 'function' ? runProc : (fn) => fn();
  /**
   * Run an SCM metadata task under a hard deadline and route it through the
   * process queue when available.
   *
   * @param {{label?:string,timeoutMs?:number,task:(signal:AbortSignal|null)=>Promise<unknown>}} input
   * @returns {Promise<unknown>}
   */
  const runScmTaskWithDeadline = async ({ label, timeoutMs, task }) => {
    const deadlineMs = resolveScmTaskDeadlineMs(timeoutMs);
    if (!(Number.isFinite(deadlineMs) && deadlineMs > 0)) {
      return runScmTask(() => task(null));
    }
    return runWithTimeout(
      (taskSignal) => runScmTask(() => task(taskSignal)),
      {
        timeoutMs: deadlineMs,
        errorFactory: () => createTimeoutError({
          message: `SCM ${label || 'task'} timed out after ${deadlineMs}ms (${relKey})`,
          code: 'SCM_TASK_TIMEOUT',
          retryable: true,
          meta: {
            relKey,
            deadlineMs,
            timeoutMs: Number.isFinite(Number(timeoutMs)) ? Math.floor(Number(timeoutMs)) : null
          }
        })
      }
    );
  };
  let scmMetaUnavailableReason = null;
  if (!skipScmForProseRoute && scmActive && filePosix) {
    const includeChurn = resolvedGitChurnEnabled
      && !scmFastPath
      && fileBytes <= SCM_CHURN_MAX_BYTES;
    const snapshotMeta = (() => {
      if (!scmFileMetaByPath) return null;
      if (typeof scmFileMetaByPath.get === 'function') {
        return scmFileMetaByPath.get(filePosix) || null;
      }
      return scmFileMetaByPath[filePosix] || null;
    })();
    const snapshotHasIdentity = Boolean(snapshotMeta && (snapshotMeta.lastModifiedAt || snapshotMeta.lastAuthor));
    const snapshotMissingRequestedChurn = Boolean(
      snapshotHasIdentity
      && includeChurn
      && !Number.isFinite(snapshotMeta.churn)
      && !Number.isFinite(snapshotMeta.churnAdded)
      && !Number.isFinite(snapshotMeta.churnDeleted)
    );
    if (snapshotHasIdentity && !snapshotMissingRequestedChurn) {
      fileGitCommitId = typeof snapshotMeta.lastCommitId === 'string'
        ? snapshotMeta.lastCommitId
        : null;
      fileGitMeta = {
        last_modified: snapshotMeta.lastModifiedAt ?? null,
        last_author: snapshotMeta.lastAuthor ?? null,
        churn: Number.isFinite(snapshotMeta.churn) ? snapshotMeta.churn : null,
        churn_added: Number.isFinite(snapshotMeta.churnAdded) ? snapshotMeta.churnAdded : null,
        churn_deleted: Number.isFinite(snapshotMeta.churnDeleted) ? snapshotMeta.churnDeleted : null,
        churn_commits: Number.isFinite(snapshotMeta.churnCommits) ? snapshotMeta.churnCommits : null
      };
    } else if (snapshotMeta && !snapshotHasIdentity) {
      scmMetaUnavailableReason = 'unavailable';
    } else if (!snapshotMeta || snapshotMissingRequestedChurn) {
      applyScmMetaResult(await readCachedOrProviderScmMeta());
    }
    if (
      resolvedGitBlameEnabled
      && !skipScmAnnotateForProseRoute
      && !skipScmAnnotateForProseMode
      && !skipScmAnnotateForExtractedProseMode
      && !skipScmAnnotateForGeneratedPython
      && scmMetaUnavailableReason == null
      && typeof scmProviderImpl.annotate === 'function'
    ) {
      const maxAnnotateBytesRaw = Number(annotateConfig.maxFileSizeBytes);
      const defaultAnnotateBytes = scmFastPath ? 128 * 1024 : 256 * 1024;
      const annotateDefaultBytes = isPythonScmPath
        ? Math.min(defaultAnnotateBytes, SCM_ANNOTATE_PYTHON_MAX_BYTES)
        : defaultAnnotateBytes;
      const maxAnnotateBytes = Number.isFinite(maxAnnotateBytesRaw)
        ? Math.max(0, maxAnnotateBytesRaw)
        : annotateDefaultBytes;
      const annotateTimeoutRaw = Number(annotateConfig.timeoutMs);
      const defaultTimeoutRaw = Number(scmConfig?.timeoutMs);
      const hasExplicitAnnotateTimeout = Number.isFinite(annotateTimeoutRaw) && annotateTimeoutRaw > 0;
      let annotateTimeoutMs = hasExplicitAnnotateTimeout
        ? annotateTimeoutRaw
        : (Number.isFinite(defaultTimeoutRaw) && defaultTimeoutRaw > 0 ? defaultTimeoutRaw : 10000);
      if (enforceScmTimeoutCaps) {
        const annotateCapMs = isHeavyRelationsPath(relKey)
          ? SCM_ANNOTATE_HEAVY_PATH_TIMEOUT_MS
          : (scmFastPath || SCM_ANNOTATE_FAST_TIMEOUT_EXTS.has(normalizedExt)
            ? SCM_ANNOTATE_FAST_TIMEOUT_MS
            : SCM_ANNOTATE_DEFAULT_TIMEOUT_CAP_MS);
        annotateTimeoutMs = Math.min(annotateTimeoutMs, annotateCapMs);
      }
      const withinAnnotateCap = maxAnnotateBytes == null
        || fileBytes <= maxAnnotateBytes;
      if (withinAnnotateCap) {
        const timeoutMs = Math.max(0, annotateTimeoutMs);
        try {
          await runScmTaskWithDeadline({
            label: 'annotate',
            timeoutMs,
            task: async (taskSignal) => {
              if (taskSignal?.aborted) return;
              const controller = new AbortController();
              let timeoutId = null;
              let detachTaskAbort = null;
              if (timeoutMs > 0) {
                timeoutId = setTimeout(() => controller.abort(), timeoutMs);
              }
              if (taskSignal && typeof taskSignal.addEventListener === 'function') {
                const forwardAbort = () => {
                  if (controller.signal.aborted) return;
                  try {
                    controller.abort(taskSignal.reason);
                  } catch {
                    controller.abort();
                  }
                };
                taskSignal.addEventListener('abort', forwardAbort, { once: true });
                detachTaskAbort = () => taskSignal.removeEventListener('abort', forwardAbort);
                if (taskSignal.aborted) forwardAbort();
              }
              try {
                if (taskSignal?.aborted) return;
                const annotateResult = await Promise.resolve(scmProviderImpl.annotate({
                  repoRoot: scmRepoRoot,
                  filePosix,
                  timeoutMs,
                  signal: controller.signal,
                  commitId: fileGitCommitId
                })).catch((err) => {
                  if (controller.signal.aborted) return { ok: false, reason: 'timeout' };
                  if (err?.code === 'ABORT_ERR' || err?.name === 'AbortError') {
                    return { ok: false, reason: 'timeout' };
                  }
                  return { ok: false, reason: 'unavailable' };
                });
                if (taskSignal?.aborted) return;
                lineAuthors = buildLineAuthors(
                  controller.signal.aborted ? { ok: false, reason: 'timeout' } : annotateResult
                );
              } finally {
                if (detachTaskAbort) detachTaskAbort();
                if (timeoutId) clearTimeout(timeoutId);
              }
            }
          });
        } catch (error) {
          if (isScmTaskTimeoutError(error)) {
            lineAuthors = buildLineAuthors({ ok: false, reason: 'timeout' });
          } else {
            throw error;
          }
        }
      }
    }
  }
  setGitDuration(Date.now() - scmStart);
  const parseStart = Date.now();
  let commentEntries = [];
  let commentRanges = [];
  let extraSegments = [];
  const shouldPrimeExtractedProseExtras = mode === 'prose' && primeExtractedProseExtrasCache === true;
  const shouldUseExtractedProseCommentMeta = mode === 'extracted-prose' || shouldPrimeExtractedProseExtras;
  const supportsExtractedProseExtrasCache = Boolean(
    extractedProseExtrasCache
    && typeof extractedProseExtrasCache.get === 'function'
    && typeof extractedProseExtrasCache.set === 'function'
  );
  const extractedProseExtrasCacheKey = shouldUseExtractedProseCommentMeta
    ? buildExtractedProseExtrasCacheKey({
      fileHash,
      fileHashAlgo,
      ext,
      languageId: lang?.id || null
    })
    : null;
  const loadCachedExtractedProseCommentMeta = () => {
    if (!supportsExtractedProseExtrasCache || !extractedProseExtrasCacheKey) return null;
    const cached = extractedProseExtrasCache.get(extractedProseExtrasCacheKey);
    if (!cached || typeof cached !== 'object') return null;
    return cloneCachedExtrasEntry(cached);
  };
  const storeCachedExtractedProseCommentMeta = (entry) => {
    if (!supportsExtractedProseExtrasCache || !extractedProseExtrasCacheKey || !entry) return;
    extractedProseExtrasCache.set(extractedProseExtrasCacheKey, cloneCachedExtrasEntry(entry));
  };
  const buildExtractedProseCommentMeta = () => buildCommentMeta({
    text,
    ext,
    mode: 'extracted-prose',
    languageId: lang?.id || null,
    lineIndex,
    normalizedCommentsConfig,
    tokenDictWords,
    dictConfig
  });
  updateCrashStage('comments');
  try {
    if (mode === 'extracted-prose') {
      let extractedCommentMeta = loadCachedExtractedProseCommentMeta();
      if (!extractedCommentMeta) {
        extractedCommentMeta = buildExtractedProseCommentMeta();
        storeCachedExtractedProseCommentMeta(extractedCommentMeta);
      }
      commentEntries = extractedCommentMeta.commentEntries;
      commentRanges = extractedCommentMeta.commentRanges;
      extraSegments = extractedCommentMeta.extraSegments;
    } else if (shouldPrimeExtractedProseExtras) {
      let extractedCommentMeta = loadCachedExtractedProseCommentMeta();
      if (!extractedCommentMeta) {
        extractedCommentMeta = buildExtractedProseCommentMeta();
        storeCachedExtractedProseCommentMeta(extractedCommentMeta);
      }
      // Prose mode does not consume comment-derived segments directly, but we
      // precompute extracted-prose comment metadata to avoid re-scanning text
      // in the paired extracted-prose pass.
      commentEntries = [];
      commentRanges = [];
      extraSegments = [];
    } else {
      const commentMeta = buildCommentMeta({
        text,
        ext,
        mode,
        languageId: lang?.id || null,
        lineIndex,
        normalizedCommentsConfig,
        tokenDictWords,
        dictConfig
      });
      commentEntries = commentMeta.commentEntries;
      commentRanges = commentMeta.commentRanges;
      extraSegments = commentMeta.extraSegments;
    }
  } catch (err) {
    return failFile('parse-error', 'comments', err);
  }
  const mustUseTreeSitterScheduler = treeSitterEnabled
    && treeSitterScheduler
    && typeof treeSitterScheduler.loadChunks === 'function';
  const treeSitterStrict = treeSitterConfigForMode?.strict === true;
  let segments;
  let segmentsFromSchedulerPlan = false;
  updateCrashStage('segments');
  try {
    const plannedSegments = hasSchedulerPlannedSegments
      ? schedulerPlannedSegments
      : ((mustUseTreeSitterScheduler
        && typeof treeSitterScheduler?.loadPlannedSegments === 'function')
        ? treeSitterScheduler.loadPlannedSegments(relKey)
        : null);
    if (Array.isArray(plannedSegments) && plannedSegments.length) {
      // Keep runtime segmentation aligned with the scheduler plan, while preserving
      // comment-derived/extracted-prose extra segments for fallback chunking paths.
      segments = mergePlannedSegmentsWithExtras({
        plannedSegments,
        extraSegments,
        relKey
      });
      segmentsFromSchedulerPlan = true;
    } else {
      segments = discoverSegments({
        text,
        ext,
        relPath: relKey,
        mode,
        languageId: lang?.id || null,
        context: languageContext,
        segmentsConfig: resolvedSegmentsConfig,
        extraSegments
      });
    }
  } catch (err) {
    return failFile('parse-error', 'segments', err);
  }
  updateCrashStage('segment-uid');
  try {
    const needsSegmentUids = !segmentsFromSchedulerPlan
      || (segments || []).some((segment) => {
        if (!segment) return false;
        if (segment.segmentUid) return false;
        return !(segment.start === 0 && segment.end === text.length);
      });
    if (needsSegmentUids) {
      await assignSegmentUids({ text, segments, ext, mode });
    }
  } catch (err) {
    return failFile('parse-error', 'segment-uid', err);
  }
  const segmentContext = {
    ...languageContext,
    relPath: relKey,
    ext,
    mode,
    languageId: fileLanguageId || null,
    fileRole: resolveChunkingFileRole({
      relPath: relKey,
      ext,
      mode,
      explicitRole: languageContext?.fileRole || null
    }),
    yamlChunking: languageOptions?.yamlChunking,
    chunking: languageOptions?.chunking,
    documentExtraction: extractedDocumentFile
      ? documentExtraction
      : null,
    javascript: languageOptions?.javascript,
    typescript: languageOptions?.typescript,
    // Tree-sitter chunking is handled by the global scheduler. Prevent per-file
    // parsing from bypassing scheduler artifacts.
    treeSitter: { ...(treeSitterConfigForMode || {}), enabled: false },
    log: languageOptions?.log
  };
  if (treeSitterEnabled && !mustUseTreeSitterScheduler) {
    logLine?.(
      '[tree-sitter:schedule] scheduler missing while tree-sitter is enabled',
      {
        kind: 'error',
        mode,
        stage: 'processing',
        file: relKey,
        substage: 'chunking',
        fileOnlyLine: `[tree-sitter:schedule] scheduler missing for ${relKey} with tree-sitter enabled`
      }
    );
    throw new Error(`[tree-sitter:schedule] Tree-sitter enabled but scheduler is missing for ${relKey}.`);
  }
  let sc = [];
  let chunkingDiagnostics = {
    treeSitterEnabled,
    schedulerRequired: mustUseTreeSitterScheduler,
    scheduledSegmentCount: 0,
    fallbackSegmentCount: 0,
    codeFallbackSegmentCount: 0,
    schedulerMissingCount: 0,
    schedulerDegradedCount: 0,
    usedHeuristicChunking: false,
    usedHeuristicCodeChunking: false
  };
  updateCrashStage('chunking');
  try {
    const chunkingResult = await chunkWithScheduler({
      segments,
      tokenMode,
      mustUseTreeSitterScheduler,
      treeSitterEnabled,
      treeSitterScheduler,
      treeSitterConfigForMode,
      treeSitterStrict,
      text,
      ext,
      relKey,
      mode,
      lang,
      segmentContext,
      lineIndex,
      logLine,
      updateCrashStage
    });
    sc = chunkingResult.chunks;
    chunkingDiagnostics = chunkingResult.chunkingDiagnostics;
  } catch (err) {
    if (languageOptions?.skipOnParseError) {
      return {
        chunks: [],
        fileRelations: null,
        skip: {
          reason: 'parse-error',
          stage: 'chunking',
          message: err?.message || String(err)
        }
      };
    }
    throw err;
  }
  sanitizeChunkBounds(sc, text.length);
  const chunkIssue = validateChunkBounds(sc, text.length);
  if (chunkIssue) {
    const error = new Error(chunkIssue);
    if (languageOptions?.skipOnParseError) {
      return {
        chunks: [],
        fileRelations: null,
        skip: {
          reason: 'parse-error',
          stage: 'chunk-bounds',
          message: error.message
        }
      };
    }
    throw error;
  }
  addParseDuration(Date.now() - parseStart);
  updateCrashStage('chunking:profile', {
    totalChunks: sc.length,
    treeSitterEnabled: chunkingDiagnostics.treeSitterEnabled,
    schedulerRequired: chunkingDiagnostics.schedulerRequired,
    scheduledSegmentCount: chunkingDiagnostics.scheduledSegmentCount,
    fallbackSegmentCount: chunkingDiagnostics.fallbackSegmentCount,
    codeFallbackSegmentCount: chunkingDiagnostics.codeFallbackSegmentCount,
    schedulerMissingCount: chunkingDiagnostics.schedulerMissingCount,
    schedulerDegradedCount: chunkingDiagnostics.schedulerDegradedCount,
    usedHeuristicChunking: chunkingDiagnostics.usedHeuristicChunking,
    usedHeuristicCodeChunking: chunkingDiagnostics.usedHeuristicCodeChunking
  });

  updateCrashStage('process-chunks');
  const chunkResult = await processChunks({
    sc,
    text,
    ext,
    rel,
    relKey,
    fileStat,
    fileHash,
    fileHashAlgo,
    fileLineCount,
    fileLanguageId,
    lang,
    languageContext,
    languageOptions,
    mode,
    relationsEnabled: effectiveRelationsEnabled,
    fileRelations,
    callIndex,
    fileStructural,
    commentEntries,
    commentRanges,
    normalizedCommentsConfig,
    tokenDictWords,
    dictConfig,
    tokenContext,
    postingsConfig,
    contextWin,
    tokenMode,
    embeddingEnabled,
    embeddingNormalize,
    embeddingBatchSize,
    getChunkEmbedding,
    getChunkEmbeddings,
    runEmbedding,
    runProc,
    workerPool,
    workerDictOverride,
    workerState,
    tokenizationStats,
    tokenizeEnabled,
    complexityEnabled,
    lintEnabled,
    complexityCache,
    lintCache,
    log,
    logLine,
    perfEventLogger,
    crashLogger,
    riskAnalysisEnabled,
    riskConfig,
    typeInferenceEnabled,
    analysisPolicy,
    astDataflowEnabled,
    controlFlowEnabled,
    toolInfo,
    lineIndex,
    lineAuthors,
    fileGitMeta,
    vfsManifestConcurrency,
    addLineSpan,
    addSettingMetric,
    addEnrichDuration,
    addTokenizeDuration,
    addComplexityDuration,
    addLintDuration,
    addEmbeddingDuration,
    showLineProgress,
    totalLines,
    chunkingDiagnostics,
    failFile,
    buildStage,
    fileIndex
  });

  if (chunkResult?.skip) {
    return chunkResult;
  }

  return {
    chunks: chunkResult.chunks,
    fileRelations,
    lexiconFilterStats,
    vfsManifestRows: chunkResult.vfsManifestRows || null,
    skip: null,
    fileLanguageId,
    fileLineCount
  };
};
