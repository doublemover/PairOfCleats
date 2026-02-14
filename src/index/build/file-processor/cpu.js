import { assignSegmentUids, chunkSegments, discoverSegments } from '../../segments.js';
import { finalizeSegments } from '../../segments/finalize.js';
import { getLanguageForFile } from '../../language-registry.js';
import { toRepoPosixPath } from '../../scm/paths.js';
import { buildLineAuthors } from '../../scm/annotate.js';
import { buildCallIndex, buildFileRelations } from './relations.js';
import { filterRawRelationsWithLexicon } from './lexicon-relations-filter.js';
import {
  isTreeSitterSchedulerLanguage,
  resolveTreeSitterLanguageForSegment
} from './tree-sitter.js';
import { TREE_SITTER_LANGUAGE_IDS } from '../../../lang/tree-sitter/config.js';
import { isTreeSitterEnabled } from '../../../lang/tree-sitter/options.js';
import {
  sanitizeChunkBounds,
  validateChunkBounds
} from './cpu/chunking.js';
import { buildLanguageAnalysisContext } from './cpu/analyze.js';
import { buildCommentMeta } from './cpu/meta.js';
import { resolveFileCaps } from './read.js';
import { buildLineIndex } from '../../../shared/lines.js';
import { formatError } from './meta.js';
import { processChunks } from './process-chunks.js';
import { buildVfsVirtualPath } from '../../tooling/vfs.js';
import {
  resolveSegmentExt,
  resolveSegmentTokenMode,
  shouldIndexSegment
} from '../../segments/config.js';

const TREE_SITTER_LANG_IDS = new Set(TREE_SITTER_LANGUAGE_IDS);

/**
 * Merge scheduler-planned segments with comment/frontmatter extras while keeping
 * the scheduler segment shape stable for VFS lookup and avoiding duplicate slices.
 *
 * @param {{
 *   plannedSegments?: Array<object>|null,
 *   extraSegments?: Array<object>|null,
 *   relKey?: string|null
 * }} input
 * @returns {Array<object>}
 */
const mergePlannedSegmentsWithExtras = ({ plannedSegments, extraSegments, relKey }) => {
  const planned = Array.isArray(plannedSegments) ? plannedSegments : [];
  const extras = Array.isArray(extraSegments) ? extraSegments : [];
  if (!extras.length) return planned;
  const merged = finalizeSegments([...planned, ...extras], relKey);
  const deduped = [];
  const seen = new Set();
  for (const segment of merged) {
    if (!segment) continue;
    const key = [
      segment.segmentId || '',
      segment.start,
      segment.end,
      segment.type || '',
      segment.languageId || '',
      segment.parentSegmentId || '',
      segment.embeddingContext || segment.meta?.embeddingContext || ''
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(segment);
  }
  return deduped;
};

const countLines = (text) => {
  if (!text) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
};

const exceedsTreeSitterLimits = ({ text, languageId, treeSitterConfig }) => {
  const config = treeSitterConfig && typeof treeSitterConfig === 'object' ? treeSitterConfig : {};
  const perLanguage = (config.byLanguage && languageId && config.byLanguage[languageId]) || {};
  const maxBytes = perLanguage.maxBytes ?? config.maxBytes;
  const maxLines = perLanguage.maxLines ?? config.maxLines;
  if (typeof maxBytes === 'number' && maxBytes > 0) {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) return true;
  }
  if (typeof maxLines === 'number' && maxLines > 0) {
    const lines = countLines(text);
    if (lines > maxLines) return true;
  }
  return false;
};

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
    timing,
    languageHint,
    crashLogger,
    vfsManifestConcurrency,
    complexityCache,
    lintCache,
    buildStage
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

  const updateCrashStage = (substage, extra = {}) => {
    if (!crashLogger?.enabled) return;
    crashLogger.updateFile({
      phase: 'processing',
      mode,
      stage: buildStage || null,
      fileIndex: Number.isFinite(fileIndex) ? fileIndex : null,
      file: relKey,
      substage,
      ...extra
    });
  };

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

  const baseTreeSitterConfig = fileEntry?.treeSitterDisabled
    ? { ...(languageOptions?.treeSitter || {}), enabled: false }
    : languageOptions?.treeSitter;
  const allowedLanguages = Array.isArray(fileEntry?.treeSitterAllowedLanguages)
    ? fileEntry.treeSitterAllowedLanguages
    : null;
  const treeSitterConfig = allowedLanguages && allowedLanguages.length
    && baseTreeSitterConfig?.languagePasses === false
    ? { ...(baseTreeSitterConfig || {}), allowedLanguages }
    : baseTreeSitterConfig;
  const extractedDocumentFile = documentExtraction && typeof documentExtraction === 'object';
  const resolvedSegmentsConfig = mode === 'extracted-prose' && !extractedDocumentFile
    ? { ...normalizedSegmentsConfig, onlyExtras: true }
    : normalizedSegmentsConfig;
  const treeSitterEnabled = treeSitterConfig?.enabled !== false && mode === 'code';
  const treeSitterLanguagePasses = treeSitterEnabled && treeSitterConfig?.languagePasses !== false;
  const treeSitterCacheKey = treeSitterConfig?.cacheKey ?? fileHash ?? null;
  const treeSitterConfigForMode = treeSitterEnabled
    ? { ...(treeSitterConfig || {}), cacheKey: treeSitterCacheKey }
    : { ...(treeSitterConfig || {}), enabled: false, cacheKey: treeSitterCacheKey };
  const contextTreeSitterConfig = treeSitterLanguagePasses
    ? { ...(treeSitterConfigForMode || {}), enabled: false }
    : treeSitterConfigForMode;
  const languageContextOptions = languageOptions && typeof languageOptions === 'object'
    ? {
      ...languageOptions,
      relationsEnabled,
      metricsCollector,
      filePath: abs,
      treeSitter: contextTreeSitterConfig
    }
    : { relationsEnabled, metricsCollector, filePath: abs, treeSitter: contextTreeSitterConfig };
  const runTreeSitter = treeSitterEnabled ? runTreeSitterSerial : (fn) => fn();
  const primaryLanguageId = languageHint?.id || null;
  let lang = null;
  let languageContext = {};
  updateCrashStage('tree-sitter');
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
  } catch (err) {
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
      skip: { reason: 'unsupported-language' }
    };
  }
  if (languageContext?.pythonAstMetrics?.durationMs) {
    setPythonAstDuration(languageContext.pythonAstMetrics.durationMs);
  }
  const tokenMode = mode === 'extracted-prose' ? 'prose' : mode;
  const lineIndex = buildLineIndex(text);
  const totalLines = lineIndex.length || 1;
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
  let rawRelations = null;
  if (mode === 'code' && relationsEnabled && lang && typeof lang.buildRelations === 'function') {
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
  if (mode === 'code' && relationsEnabled && rawRelations) {
    filteredRelations = filterRawRelationsWithLexicon(rawRelations, {
      languageId: lang?.id || null,
      config: languageOptions?.lexicon || null,
      log,
      relKey
    });
  }
  const fileRelations = relationsEnabled ? buildFileRelations(filteredRelations, relKey) : null;
  const callIndex = relationsEnabled ? buildCallIndex(filteredRelations) : null;
  const resolvedGitBlameEnabled = typeof analysisPolicy?.git?.blame === 'boolean'
    ? analysisPolicy.git.blame
    : gitBlameEnabled;
  updateCrashStage('scm-meta', { blame: resolvedGitBlameEnabled });
  const scmStart = Date.now();
  let lineAuthors = null;
  let fileGitMeta = {};
  const scmActive = scmProviderImpl && scmProvider && scmProvider !== 'none';
  const filePosix = scmActive && scmRepoRoot
    ? toRepoPosixPath(abs, scmRepoRoot)
    : null;
  if (scmActive && filePosix && typeof scmProviderImpl.getFileMeta === 'function') {
    const fileMeta = await runIo(() => scmProviderImpl.getFileMeta({
      repoRoot: scmRepoRoot,
      filePosix
    }));
    if (fileMeta && fileMeta.ok !== false) {
      fileGitMeta = {
        last_modified: fileMeta.lastModifiedAt ?? null,
        last_author: fileMeta.lastAuthor ?? null,
        churn: Number.isFinite(fileMeta.churn) ? fileMeta.churn : null,
        churn_added: Number.isFinite(fileMeta.churnAdded) ? fileMeta.churnAdded : null,
        churn_deleted: Number.isFinite(fileMeta.churnDeleted) ? fileMeta.churnDeleted : null,
        churn_commits: Number.isFinite(fileMeta.churnCommits) ? fileMeta.churnCommits : null
      };
    }
  }
  if (scmActive && filePosix && resolvedGitBlameEnabled && typeof scmProviderImpl.annotate === 'function') {
    const annotateConfig = scmConfig?.annotate || {};
    const maxAnnotateBytesRaw = Number(annotateConfig.maxFileSizeBytes);
    const maxAnnotateBytes = Number.isFinite(maxAnnotateBytesRaw)
      ? Math.max(0, maxAnnotateBytesRaw)
      : null;
    const annotateTimeoutRaw = Number(annotateConfig.timeoutMs);
    const defaultTimeoutRaw = Number(scmConfig?.timeoutMs);
    const annotateTimeoutMs = Number.isFinite(annotateTimeoutRaw) && annotateTimeoutRaw > 0
      ? annotateTimeoutRaw
      : (Number.isFinite(defaultTimeoutRaw) && defaultTimeoutRaw > 0 ? defaultTimeoutRaw : 10000);
    const withinAnnotateCap = maxAnnotateBytes == null
      || (fileStat?.size ?? 0) <= maxAnnotateBytes;
    if (withinAnnotateCap) {
      const annotateWithTimeout = async () => {
        const timeoutMs = Math.max(0, annotateTimeoutMs);
        const controller = new AbortController();
        let timeoutId = null;
        if (timeoutMs > 0) {
          timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        }
        try {
          const result = await Promise.resolve(scmProviderImpl.annotate({
            repoRoot: scmRepoRoot,
            filePosix,
            timeoutMs,
            signal: controller.signal
          })).catch((err) => {
            if (controller.signal.aborted) return { ok: false, reason: 'timeout' };
            if (err?.code === 'ABORT_ERR' || err?.name === 'AbortError') {
              return { ok: false, reason: 'timeout' };
            }
            return { ok: false, reason: 'unavailable' };
          });
          if (controller.signal.aborted) {
            return { ok: false, reason: 'timeout' };
          }
          return result;
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      };
      const annotateResult = await runIo(() => annotateWithTimeout());
      lineAuthors = buildLineAuthors(annotateResult);
    }
  }
  setGitDuration(Date.now() - scmStart);
  const parseStart = Date.now();
  let commentEntries = [];
  let commentRanges = [];
  let extraSegments = [];
  updateCrashStage('comments');
  try {
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
    const plannedSegments = (mustUseTreeSitterScheduler
      && typeof treeSitterScheduler?.loadPlannedSegments === 'function')
      ? treeSitterScheduler.loadPlannedSegments(relKey)
      : null;
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
      `[tree-sitter:schedule] scheduler missing for ${relKey} with tree-sitter enabled`,
      { kind: 'error', mode, stage: 'processing', file: relKey, substage: 'chunking' }
    );
    throw new Error(`[tree-sitter:schedule] Tree-sitter enabled but scheduler is missing for ${relKey}.`);
  }
  let sc = [];
  updateCrashStage('chunking');
  try {
    const fallbackSegments = [];
    const scheduled = [];
    const treeSitterOptions = { treeSitter: treeSitterConfigForMode || {} };
    for (const segment of segments || []) {
      if (!segment) continue;
      const segmentTokenMode = resolveSegmentTokenMode(segment);
      if (!shouldIndexSegment(segment, segmentTokenMode, tokenMode)) continue;

      if (!mustUseTreeSitterScheduler || segmentTokenMode !== 'code') {
        fallbackSegments.push(segment);
        continue;
      }

      const segmentExt = resolveSegmentExt(ext, segment);
      const rawLanguageId = segment.languageId || lang?.id || null;
      const resolvedLang = resolveTreeSitterLanguageForSegment(rawLanguageId, segmentExt);
      const canUseTreeSitter = resolvedLang
        && TREE_SITTER_LANG_IDS.has(resolvedLang)
        && isTreeSitterSchedulerLanguage(resolvedLang)
        && isTreeSitterEnabled(treeSitterOptions, resolvedLang);
      if (!canUseTreeSitter) {
        fallbackSegments.push(segment);
        continue;
      }

      const segmentText = text.slice(segment.start, segment.end);
      if (exceedsTreeSitterLimits({ text: segmentText, languageId: resolvedLang, treeSitterConfig: treeSitterConfigForMode })) {
        fallbackSegments.push(segment);
        continue;
      }

      const segmentUid = segment.segmentUid || null;
      const isFullFile = segment.start === 0 && segment.end === text.length;
      if (!isFullFile && !segmentUid) {
        logLine?.(
          `[tree-sitter:schedule] missing segmentUid for ${relKey} (${segment.start}-${segment.end})`,
          { kind: 'error', mode, stage: 'processing', file: relKey, substage: 'chunking' }
        );
        throw new Error(`[tree-sitter:schedule] Missing segmentUid for ${relKey} (${segment.start}-${segment.end}).`);
      }
      const virtualPath = buildVfsVirtualPath({
        containerPath: relKey,
        segmentUid,
        effectiveExt: segmentExt
      });
      scheduled.push({
        virtualPath,
        label: `${resolvedLang}:${segment.start}-${segment.end}`,
        segment
      });
    }

    for (const item of scheduled) {
      const chunks = await treeSitterScheduler.loadChunks(item.virtualPath);
      if (!Array.isArray(chunks) || !chunks.length) {
        const hasScheduledEntry = treeSitterScheduler?.index instanceof Map
          ? treeSitterScheduler.index.has(item.virtualPath)
          : null;
        if (!treeSitterStrict && hasScheduledEntry === false) {
          fallbackSegments.push(item.segment);
          logLine?.(
            `[tree-sitter:schedule] scheduler missing ${item.label}; using fallback chunking for ${relKey}`,
            { kind: 'warn', mode, stage: 'processing', file: relKey, substage: 'chunking' }
          );
          continue;
        }
        logLine?.(
          `[tree-sitter:schedule] missing scheduled chunks for ${relKey}: ${item.label}`,
          { kind: 'error', mode, stage: 'processing', file: relKey, substage: 'chunking' }
        );
        throw new Error(`[tree-sitter:schedule] Missing scheduled chunks for ${relKey}: ${item.label}`);
      }
      sc.push(...chunks);
    }

    if (fallbackSegments.length) {
      const fallbackChunks = chunkSegments({
        text,
        ext,
        relPath: relKey,
        mode,
        segments: fallbackSegments,
        lineIndex,
        context: segmentContext
      });
      if (Array.isArray(fallbackChunks) && fallbackChunks.length) sc.push(...fallbackChunks);
    }

    if (sc.length > 1) {
      sc.sort((a, b) => (a.start - b.start) || (a.end - b.end));
    }
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
    relationsEnabled,
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
    failFile,
    buildStage
  });

  if (chunkResult?.skip) {
    return chunkResult;
  }

  return {
    chunks: chunkResult.chunks,
    fileRelations,
    vfsManifestRows: chunkResult.vfsManifestRows || null,
    skip: null,
    fileLanguageId,
    fileLineCount
  };
};
