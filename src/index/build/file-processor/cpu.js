import { chunkSegments, detectFrontmatter, discoverSegments } from '../../segments.js';
import { extractComments } from '../../comments.js';
import { buildLanguageContext, getLanguageForFile } from '../../language-registry.js';
import { getGitMetaForFile } from '../../git.js';
import { buildCallIndex, buildFileRelations } from './relations.js';
import {
  resolveTreeSitterLanguageForSegment,
  resolveTreeSitterLanguagesForSegments
} from './tree-sitter.js';
import { resolveFileCaps } from './read.js';
import { buildLineIndex } from '../../../shared/lines.js';
import { buildTokenSequence } from '../tokenization.js';
import { formatError } from './meta.js';
import { processChunks } from './process-chunks.js';
import { TREE_SITTER_LANGUAGE_IDS } from '../../../lang/tree-sitter/config.js';
import { isTreeSitterEnabled } from '../../../lang/tree-sitter/options.js';
import {
  preloadTreeSitterLanguages,
  pruneTreeSitterLanguages,
  resetTreeSitterParser
} from '../../../lang/tree-sitter.js';

const TREE_SITTER_LANG_IDS = new Set(TREE_SITTER_LANGUAGE_IDS);

const chunkSegmentsWithTreeSitterPasses = async ({
  text,
  ext,
  relPath,
  mode,
  segments,
  lineIndex,
  context,
  treeSitterConfig,
  languageOptions,
  log
}) => {
  if (!treeSitterConfig || treeSitterConfig.enabled === false) {
    return chunkSegments({ text, ext, relPath, mode, segments, lineIndex, context });
  }
  if (treeSitterConfig.languagePasses === false) {
    return chunkSegments({ text, ext, relPath, mode, segments, lineIndex, context });
  }
  if (!Array.isArray(segments) || !segments.length) {
    return chunkSegments({ text, ext, relPath, mode, segments, lineIndex, context });
  }
  const baseOptions = { treeSitter: treeSitterConfig };
  const passSegments = new Map();
  const fallbackSegments = [];
  for (const segment of segments) {
    const rawLanguageId = segment?.languageId || context?.languageId || null;
    const languageId = resolveTreeSitterLanguageForSegment(rawLanguageId, ext);
    if (!languageId || !TREE_SITTER_LANG_IDS.has(languageId) || !isTreeSitterEnabled(baseOptions, languageId)) {
      fallbackSegments.push(segment);
      continue;
    }
    if (!passSegments.has(languageId)) passSegments.set(languageId, []);
    passSegments.get(languageId).push(segment);
  }
  if (passSegments.size <= 1 && !fallbackSegments.length) {
    return chunkSegments({ text, ext, relPath, mode, segments, lineIndex, context });
  }
  const chunks = [];
  if (fallbackSegments.length) {
    const fallbackContext = {
      ...context,
      treeSitter: { ...(treeSitterConfig || {}), enabled: false }
    };
    const fallbackChunks = chunkSegments({
      text,
      ext,
      relPath,
      mode,
      segments: fallbackSegments,
      lineIndex,
      context: fallbackContext
    });
    if (fallbackChunks && fallbackChunks.length) chunks.push(...fallbackChunks);
  }
  for (const [languageId, languageSegments] of passSegments) {
    const passTreeSitter = { ...(treeSitterConfig || {}), allowedLanguages: [languageId] };
    resetTreeSitterParser({ hard: true });
    pruneTreeSitterLanguages([languageId], {
      log: languageOptions?.log || log,
      maxLoadedLanguages: treeSitterConfig?.maxLoadedLanguages,
      onlyIfExceeds: true
    });
    try {
      await preloadTreeSitterLanguages([languageId], {
        log: languageOptions?.log,
        parallel: false,
        maxLoadedLanguages: treeSitterConfig.maxLoadedLanguages
      });
    } catch {
      // ignore preload failures; chunking will fall back if needed.
    }
    const passChunks = chunkSegments({
      text,
      ext,
      relPath,
      mode,
      segments: languageSegments,
      lineIndex,
      context: {
        ...context,
        treeSitter: passTreeSitter
      }
    });
    if (passChunks && passChunks.length) chunks.push(...passChunks);
  }
  if (!chunks.length) return chunks;
  chunks.sort((a, b) => (a.start - b.start) || (a.end - b.end));
  return chunks;
};

const validateChunkBounds = (chunks, textLength) => {
  if (!Array.isArray(chunks)) return 'chunk list missing';
  let lastStart = -1;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (!chunk) return `chunk ${i} missing`;
    const start = Number(chunk.start);
    const end = Number(chunk.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return `chunk ${i} missing offsets`;
    }
    if (start < 0 || end < 0 || start > end || end > textLength) {
      return `chunk ${i} out of bounds`;
    }
    if (start < lastStart) {
      return `chunk ${i} out of order`;
    }
    lastStart = start;
  }
  return null;
};

const sanitizeChunkBounds = (chunks, textLength) => {
  if (!Array.isArray(chunks)) return;
  const max = Number.isFinite(textLength) ? textLength : 0;
  for (const chunk of chunks) {
    if (!chunk) continue;
    const start = Number(chunk.start);
    const end = Number(chunk.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const clampedStart = Math.max(0, Math.min(start, max));
    const clampedEnd = Math.max(clampedStart, Math.min(end, max));
    if (clampedStart !== start) chunk.start = clampedStart;
    if (clampedEnd !== end) chunk.end = clampedEnd;
  }
};

export const processFileCpu = async (context) => {
  const {
    abs,
    root,
    mode,
    fileEntry,
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
    lintCache
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
  try {
    ({ lang, context: languageContext } = await runTreeSitter(async () => {
      if (!treeSitterLanguagePasses
        && treeSitterEnabled
        && primaryLanguageId
        && TREE_SITTER_LANG_IDS.has(primaryLanguageId)) {
        try {
          await preloadTreeSitterLanguages([primaryLanguageId], {
            log: languageOptions?.log,
            parallel: false,
            maxLoadedLanguages: treeSitterConfigForMode?.maxLoadedLanguages
          });
        } catch {
          // ignore preload failures; prepare will fall back if needed.
        }
      }
      return buildLanguageContext({
        ext,
        relPath: relKey,
        mode,
        text,
        options: languageContextOptions
      });
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
  const capsByLanguage = resolveFileCaps(fileCaps, ext, lang?.id);
  if (capsByLanguage.maxLines && totalLines > capsByLanguage.maxLines) {
    return {
      chunks: [],
      fileRelations: null,
      skip: { reason: 'oversize', lines: totalLines, maxLines: capsByLanguage.maxLines }
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
  const commentsEnabled = (mode === 'code' || mode === 'extracted-prose')
    && normalizedCommentsConfig.extract !== 'off';
  const commentSegmentsEnabled = mode === 'extracted-prose'
    || (mode === 'code' && normalizedCommentsConfig.includeInCode === true);
  const parseStart = Date.now();
  let commentData;
  try {
    commentData = commentsEnabled
      ? extractComments({
        text,
        ext,
        languageId: lang?.id || null,
        lineIndex,
        config: normalizedCommentsConfig
      })
      : { comments: [], configSegments: [] };
  } catch (err) {
    return failFile('parse-error', 'comments', err);
  }
  const commentEntries = [];
  const commentRanges = [];
  const commentSegments = [];
  if (commentsEnabled && Array.isArray(commentData.comments)) {
    for (const comment of commentData.comments) {
      commentRanges.push(comment);
      const commentTokens = buildTokenSequence({
        text: comment.text,
        mode: 'prose',
        ext,
        dictWords: tokenDictWords,
        dictConfig
      }).tokens;
      if (commentTokens.length < normalizedCommentsConfig.minTokens) continue;
      const entry = { ...comment, tokens: commentTokens };
      commentEntries.push(entry);
      if (
        commentSegmentsEnabled
        && (comment.type !== 'license' || normalizedCommentsConfig.includeLicense)
      ) {
        commentSegments.push({
          type: 'comment',
          languageId: lang?.id || null,
          start: comment.start,
          end: comment.end,
          parentSegmentId: null,
          embeddingContext: 'prose',
          meta: {
            commentType: comment.type,
            commentStyle: comment.style
          }
        });
      }
    }
  }
  const extraSegments = [];
  if (commentSegmentsEnabled && commentSegments.length) {
    extraSegments.push(...commentSegments);
  }
  if (
    commentSegmentsEnabled
    && Array.isArray(commentData.configSegments)
    && commentData.configSegments.length
  ) {
    extraSegments.push(...commentData.configSegments);
  }
  if (mode === 'extracted-prose' && (ext === '.md' || ext === '.mdx')) {
    const frontmatter = detectFrontmatter(text);
    if (frontmatter) {
      extraSegments.push({
        type: 'prose',
        languageId: 'markdown',
        start: frontmatter.start,
        end: frontmatter.end,
        parentSegmentId: null,
        embeddingContext: 'prose',
        meta: { frontmatter: true }
      });
    }
  }
  let segments;
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
    failFile
  });

  if (chunkResult?.skip) {
    return chunkResult;
  }

  return { chunks: chunkResult.chunks, fileRelations, skip: null, fileLanguageId, fileLineCount };
};
