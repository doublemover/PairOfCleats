import { assignSegmentUids, chunkSegments, discoverSegments } from '../../segments.js';
import { getLanguageForFile } from '../../language-registry.js';
import { getGitMetaForFile } from '../../git.js';
import { buildCallIndex, buildFileRelations } from './relations.js';
import {
  resolveTreeSitterLanguagesForSegments
} from './tree-sitter.js';
import {
  chunkSegmentsWithTreeSitterPasses,
  sanitizeChunkBounds,
  validateChunkBounds
} from './cpu/chunking.js';
import { buildLanguageAnalysisContext } from './cpu/analyze.js';
import { buildCommentMeta } from './cpu/meta.js';
import { resolveFileCaps } from './read.js';
import { buildLineIndex } from '../../../shared/lines.js';
import { formatError } from './meta.js';
import { processChunks } from './process-chunks.js';
import {
  preloadTreeSitterLanguages
} from '../../../lang/tree-sitter.js';

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
    fileStat,
    fileHash,
    fileHashAlgo,
    fileCaps,
    fileStructural,
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
    embeddingEnabled,
    embeddingNormalize,
    embeddingBatchSize,
    getChunkEmbedding,
    getChunkEmbeddings,
    runEmbedding,
    runTreeSitterSerial,
    runIo,
    log,
    logLine,
    showLineProgress,
    toolInfo,
    timing,
    languageHint,
    crashLogger,
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
  const resolvedSegmentsConfig = mode === 'extracted-prose'
    ? { ...normalizedSegmentsConfig, onlyExtras: true }
    : normalizedSegmentsConfig;
  const treeSitterEnabled = treeSitterConfig?.enabled !== false && mode === 'code';
  const treeSitterLanguagePasses = treeSitterEnabled && treeSitterConfig?.languagePasses !== false;
  const treeSitterDeferMissing = treeSitterConfig?.deferMissing !== false;
  const shouldSerializeTreeSitter = treeSitterEnabled && mode === 'code';
  const treeSitterDeferMissingMax = Number.isFinite(treeSitterConfig?.deferMissingMax)
    ? Math.max(0, Math.floor(treeSitterConfig.deferMissingMax))
    : 0;
  if (!treeSitterLanguagePasses
    && treeSitterEnabled
    && treeSitterDeferMissing
    && treeSitterDeferMissingMax > 0
    && !fileEntry?.treeSitterDisabled) {
    const deferrals = Number(fileEntry?.treeSitterDeferrals) || 0;
    if (deferrals < treeSitterDeferMissingMax) {
      const hint = getLanguageForFile(ext, relKey);
      const languageIdHint = hint?.id || null;
      let segmentHint;
      try {
        segmentHint = discoverSegments({
          text,
          ext,
          relPath: relKey,
          mode,
          languageId: languageIdHint,
          context: null,
          segmentsConfig: resolvedSegmentsConfig,
          extraSegments: []
        });
      } catch (err) {
        return failFile('parse-error', 'segments', err);
      }
      const requiredLanguages = resolveTreeSitterLanguagesForSegments({
        segments: segmentHint,
        primaryLanguageId: languageIdHint,
        ext,
        treeSitterConfig
      });
      if (requiredLanguages.length) {
        const batchLanguages = new Set(
          Array.isArray(fileEntry?.treeSitterBatchLanguages) ? fileEntry.treeSitterBatchLanguages : []
        );
        const missingLanguages = requiredLanguages.filter((languageId) => !batchLanguages.has(languageId));
        if (missingLanguages.length) {
          return { defer: true, missingLanguages };
        }
      }
    }
  }
  const treeSitterConfigForMode = treeSitterEnabled
    ? treeSitterConfig
    : { ...(treeSitterConfig || {}), enabled: false };
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
  const runTreeSitter = shouldSerializeTreeSitter ? runTreeSitterSerial : (fn) => fn();
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
  if (!lang && languageOptions?.skipUnknownLanguages) {
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
  const fileRelations = relationsEnabled ? buildFileRelations(rawRelations, relKey) : null;
  const callIndex = relationsEnabled ? buildCallIndex(rawRelations) : null;
  const resolvedGitBlameEnabled = typeof analysisPolicy?.git?.blame === 'boolean'
    ? analysisPolicy.git.blame
    : gitBlameEnabled;
  updateCrashStage('git-meta', { blame: resolvedGitBlameEnabled });
  const gitStart = Date.now();
  const resolvedGitMeta = await runIo(() => getGitMetaForFile(relKey, {
    blame: resolvedGitBlameEnabled,
    baseDir: root
  }));
  setGitDuration(Date.now() - gitStart);
  const lineAuthors = Array.isArray(resolvedGitMeta?.lineAuthors)
    ? resolvedGitMeta.lineAuthors
    : null;
  const fileGitMeta = resolvedGitMeta && typeof resolvedGitMeta === 'object'
    ? Object.fromEntries(Object.entries(resolvedGitMeta).filter(([key]) => key !== 'lineAuthors'))
    : {};
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
  let segments;
  updateCrashStage('segments');
  try {
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
  } catch (err) {
    return failFile('parse-error', 'segments', err);
  }
  updateCrashStage('segment-uid');
  try {
    await assignSegmentUids({ text, segments, ext, mode });
  } catch (err) {
    return failFile('parse-error', 'segment-uid', err);
  }
  const segmentContext = {
    ...languageContext,
    yamlChunking: languageOptions?.yamlChunking,
    chunking: languageOptions?.chunking,
    javascript: languageOptions?.javascript,
    typescript: languageOptions?.typescript,
    treeSitter: treeSitterConfigForMode,
    log: languageOptions?.log
  };
  const treeSitterMissingLanguages = new Set();
  segmentContext.treeSitterMissingLanguages = treeSitterMissingLanguages;
  let sc;
  updateCrashStage('chunking');
  try {
    if (treeSitterEnabled) {
      const requiredLanguages = resolveTreeSitterLanguagesForSegments({
        segments,
        primaryLanguageId: lang?.id || null,
        ext,
        treeSitterConfig: treeSitterConfigForMode
      });
      const shouldPreload = treeSitterLanguagePasses === false || requiredLanguages.length <= 1;
      if (shouldPreload && requiredLanguages.length) {
        try {
          await runTreeSitter(() => preloadTreeSitterLanguages(requiredLanguages, {
            log: languageOptions?.log,
            parallel: false,
            maxLoadedLanguages: treeSitterConfigForMode?.maxLoadedLanguages
          }));
        } catch {
          // ignore preload failures; chunking will fall back if needed.
        }
      }
    }
    sc = treeSitterLanguagePasses === false
      ? await runTreeSitter(() => chunkSegments({
        text,
        ext,
        relPath: relKey,
        mode,
        segments,
        lineIndex,
        context: segmentContext
      }))
      : await runTreeSitter(() => chunkSegmentsWithTreeSitterPasses({
        text,
        ext,
        relPath: relKey,
        mode,
        segments,
        lineIndex,
        context: segmentContext,
        treeSitterConfig: treeSitterConfigForMode,
        languageOptions,
        log
      }));
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
  if (
    treeSitterEnabled
    && treeSitterDeferMissing
    && treeSitterMissingLanguages.size > 0
    && !fileEntry?.treeSitterDisabled
  ) {
    return {
      defer: true,
      missingLanguages: Array.from(treeSitterMissingLanguages)
    };
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
    workerPool,
    workerDictOverride,
    workerState,
    tokenizationStats,
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
