import fs from 'node:fs/promises';
import util from 'node:util';
import path from 'node:path';
import { analyzeComplexity, lintChunk } from '../analysis.js';
import { chunkSegments, detectFrontmatter, discoverSegments, normalizeSegmentsConfig } from '../segments.js';
import { extractComments, normalizeCommentConfig } from '../comments.js';
import { buildChunkRelations, buildLanguageContext } from '../language-registry.js';
import { detectRiskSignals } from '../risk.js';
import { inferTypeMetadata } from '../type-inference.js';
import { getChunkAuthorsFromLines, getGitMetaForFile } from '../git.js';
import { isJsLike } from '../constants.js';
import { buildLineIndex, offsetToLine } from '../../shared/lines.js';
import { createLruCache, estimateJsonBytes } from '../../shared/cache.js';
import { toPosix } from '../../shared/files.js';
import { log, logLine } from '../../shared/progress.js';
import { getEnvConfig } from '../../shared/env.js';
import { readTextFileWithHash } from '../../shared/encoding.js';
import { createFileScanner } from './file-scan.js';
import { buildTokenSequence, createTokenizationBuffers, createTokenizationContext, tokenizeChunkText } from './tokenization.js';
import { assignCommentsToChunks, getStructuralMatchesForChunk } from './file-processor/chunk.js';
import { buildChunkPayload } from './file-processor/assemble.js';
import { reuseCachedBundle } from './file-processor/cached-bundle.js';
import { attachEmbeddings } from './file-processor/embeddings.js';
import { loadCachedBundleForFile, writeBundleForFile } from './file-processor/incremental.js';
import { formatError, mergeFlowMeta } from './file-processor/meta.js';
import { buildCallIndex, buildFileRelations } from './file-processor/relations.js';
import { resolveBinarySkip, resolvePreReadSkip } from './file-processor/skip.js';
import { createFileTimingTracker } from './file-processor/timings.js';
import { resolveExt, resolveFileCaps, truncateByBytes } from './file-processor/read.js';
import { TREE_SITTER_LANGUAGE_IDS } from '../../lang/tree-sitter/config.js';
import { isTreeSitterEnabled } from '../../lang/tree-sitter/options.js';
import {
  preloadTreeSitterLanguages,
  pruneTreeSitterLanguages,
  resetTreeSitterParser
} from '../../lang/tree-sitter.js';
import { getLanguageForFile } from '../language-registry.js';

const TREE_SITTER_LANG_IDS = new Set(TREE_SITTER_LANGUAGE_IDS);

const resolveTreeSitterLanguageForExt = (languageId, ext) => {
  const normalizedExt = typeof ext === 'string' ? ext.toLowerCase() : '';
  if (normalizedExt === '.tsx') return 'tsx';
  if (normalizedExt === '.jsx') return 'jsx';
  if (normalizedExt === '.ts' || normalizedExt === '.cts' || normalizedExt === '.mts') return 'typescript';
  if (normalizedExt === '.js' || normalizedExt === '.mjs' || normalizedExt === '.cjs' || normalizedExt === '.jsm') {
    return 'javascript';
  }
  if (normalizedExt === '.py') return 'python';
  if (normalizedExt === '.json') return 'json';
  if (normalizedExt === '.yaml' || normalizedExt === '.yml') return 'yaml';
  if (normalizedExt === '.toml') return 'toml';
  if (normalizedExt === '.md' || normalizedExt === '.mdx') return 'markdown';
  if (!normalizedExt) return languageId;
  if (normalizedExt === '.m' || normalizedExt === '.mm') return 'objc';
  if (normalizedExt === '.cpp' || normalizedExt === '.cc' || normalizedExt === '.cxx'
    || normalizedExt === '.hpp' || normalizedExt === '.hh' || normalizedExt === '.hxx') return 'cpp';
  if (normalizedExt === '.c' || normalizedExt === '.h') return 'clike';
  return languageId;
};

const resolveTreeSitterLanguageForSegment = (languageId, ext) => {
  const normalizedExt = typeof ext === 'string' ? ext.toLowerCase() : '';
  if (languageId === 'typescript' && normalizedExt === '.tsx') return 'tsx';
  if (languageId === 'javascript' && normalizedExt === '.jsx') return 'jsx';
  if (languageId === 'clike' || languageId === 'objc' || languageId === 'cpp') {
    return resolveTreeSitterLanguageForExt(languageId, ext);
  }
  if (languageId) return languageId;
  return resolveTreeSitterLanguageForExt(languageId, ext);
};

const resolveTreeSitterLanguagesForSegments = ({ segments, primaryLanguageId, ext, treeSitterConfig }) => {
  if (!treeSitterConfig || treeSitterConfig.enabled === false) return [];
  const options = { treeSitter: treeSitterConfig };
  const languages = new Set();
  const add = (languageId) => {
    if (!languageId || !TREE_SITTER_LANG_IDS.has(languageId)) return;
    if (!isTreeSitterEnabled(options, languageId)) return;
    languages.add(languageId);
  };
  add(resolveTreeSitterLanguageForSegment(primaryLanguageId, ext));
  if (Array.isArray(segments)) {
    for (const segment of segments) {
      if (!segment || segment.type !== 'embedded') continue;
      add(resolveTreeSitterLanguageForSegment(segment.languageId, ext));
    }
  }
  return Array.from(languages);
};

/**
 * Create a file processor with shared caches.
 * @param {object} options
 * @returns {{processFile:(abs:string,fileIndex:number)=>Promise<object|null>}}
 */
export function createFileProcessor(options) {
  const {
    root,
    mode,
    dictConfig,
    dictWords,
    dictShared,
    languageOptions,
    postingsConfig,
    segmentsConfig,
    commentsConfig,
    allImports,
    contextWin,
    incrementalState,
    getChunkEmbedding,
    getChunkEmbeddings,
    typeInferenceEnabled,
    riskAnalysisEnabled,
    riskConfig,
    relationsEnabled: relationsEnabledRaw,
    seenFiles,
    gitBlameEnabled,
    lintEnabled: lintEnabledRaw,
    complexityEnabled: complexityEnabledRaw,
    structuralMatches,
    cacheConfig,
    cacheReporter,
    queues,
    useCpuQueue = true,
    workerPool = null,
    embeddingBatchSize = 0,
    crashLogger = null,
    fileCaps = null,
    fileScan = null,
    skippedFiles = null,
    embeddingEnabled = true,
    toolInfo = null,
    tokenizationStats = null,
    featureMetrics = null
  } = options;
  const lintEnabled = lintEnabledRaw !== false;
  const complexityEnabled = complexityEnabledRaw !== false;
  const relationsEnabled = relationsEnabledRaw !== false;
  const { astDataflowEnabled, controlFlowEnabled } = languageOptions;
  const ioQueue = queues?.io || null;
  const cpuQueue = queues?.cpu || null;
  const embeddingQueue = queues?.embedding || null;
  const runIo = ioQueue ? (fn) => ioQueue.add(fn) : (fn) => fn();
  const runCpu = cpuQueue && useCpuQueue ? (fn) => cpuQueue.add(fn) : (fn) => fn();
  const runEmbedding = embeddingQueue ? (fn) => embeddingQueue.add(fn) : (fn) => fn();
  const showLineProgress = getEnvConfig().verbose === true;
  const tokenDictWords = dictShared || dictWords;
  const tokenContext = createTokenizationContext({
    dictWords: tokenDictWords,
    dictConfig,
    postingsConfig
  });
  const normalizedSegmentsConfig = normalizeSegmentsConfig(segmentsConfig);
  const normalizedCommentsConfig = normalizeCommentConfig(commentsConfig);
  const fileScanner = createFileScanner(fileScan);
  const recordSkip = (filePath, reason, extra = {}) => {
    if (!skippedFiles) return;
    skippedFiles.push({ file: filePath, reason, ...extra });
  };
  const getWorkerDictOverride = () => {
    if (!workerPool?.dictConfig || !dictConfig) return null;
    const base = workerPool.dictConfig;
    const nextSegmentation = typeof dictConfig.segmentation === 'string'
      ? dictConfig.segmentation
      : base.segmentation;
    const nextMaxToken = Number.isFinite(Number(dictConfig.dpMaxTokenLength))
      ? Number(dictConfig.dpMaxTokenLength)
      : base.dpMaxTokenLength;
    if (base.segmentation === nextSegmentation && base.dpMaxTokenLength === nextMaxToken) {
      return null;
    }
    return { segmentation: nextSegmentation, dpMaxTokenLength: nextMaxToken };
  };
  const workerDictOverride = getWorkerDictOverride();
  let tokenWorkerDisabled = false;
  let workerTokenizeFailed = false;
  const lintCacheConfig = cacheConfig?.lint || {};
  const complexityCacheConfig = cacheConfig?.complexity || {};
  const lintCache = createLruCache({
    name: 'lint',
    maxMb: lintCacheConfig.maxMb,
    ttlMs: lintCacheConfig.ttlMs,
    sizeCalculation: estimateJsonBytes,
    reporter: cacheReporter
  });
  const complexityCache = createLruCache({
    name: 'complexity',
    maxMb: complexityCacheConfig.maxMb,
    ttlMs: complexityCacheConfig.ttlMs,
    sizeCalculation: estimateJsonBytes,
    reporter: cacheReporter
  });

  let treeSitterSerial = Promise.resolve();
  const runTreeSitterSerial = async (fn) => {
    const run = treeSitterSerial.then(fn, fn);
    treeSitterSerial = run.catch(() => {});
    return run;
  };

  const chunkSegmentsWithTreeSitterPasses = async ({
    text,
    ext,
    relPath,
    mode,
    segments,
    lineIndex,
    context,
    treeSitterConfig
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



  /**
   * Process a file: read, chunk, analyze, and produce chunk payloads.
   * @param {string} abs
   * @param {number} fileIndex
   * @returns {Promise<object|null>}
   */
  async function processFile(fileEntry, fileIndex) {
    const abs = typeof fileEntry === 'string' ? fileEntry : fileEntry.abs;      
    const fileStart = Date.now();
    const timing = createFileTimingTracker({ mode, featureMetrics });
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
      setPythonAstDuration,
      finalizeLanguageLines,
      recordFeatureMetrics,
      recordFileMetrics,
      buildFileMetrics
    } = timing;
    const relKey = typeof fileEntry === 'object' && fileEntry.rel
      ? fileEntry.rel
      : toPosix(path.relative(root, abs));
    const rel = typeof fileEntry === 'object' && fileEntry.rel
      ? fileEntry.rel.split('/').join(path.sep)
      : path.relative(root, abs);
    const fileStructural = structuralMatches?.get(relKey) || null;
    if (seenFiles) seenFiles.add(relKey);
    const ext = resolveExt(abs);
    let fileLanguageId = null;
    let fileLineCount = 0;
    let fileStat;
    try {
      fileStat = typeof fileEntry === 'object' && fileEntry.stat
        ? fileEntry.stat
        : await runIo(() => fs.lstat(abs));
    } catch {
      return null;
    }
    if (fileStat?.isSymbolicLink?.()) {
      recordSkip(abs, 'symlink');
      return null;
    }
    const preReadSkip = await resolvePreReadSkip({
      abs,
      fileEntry,
      fileStat,
      ext,
      fileCaps,
      fileScanner,
      runIo
    });
    if (preReadSkip) {
      const { reason, ...extra } = preReadSkip;
      recordSkip(abs, reason || 'oversize', extra);
      return null;
    }
    const knownLines = Number(fileEntry?.lines);

    let cachedBundle = null;
    let text = null;
    let fileHash = null;
    let fileBuffer = null;
    const cachedResult = await loadCachedBundleForFile({
      runIo,
      incrementalState,
      absPath: abs,
      relKey,
      fileStat
    });
    cachedBundle = cachedResult.cachedBundle;
    fileHash = cachedResult.fileHash;
    fileBuffer = cachedResult.buffer;

    const cachedOutcome = reuseCachedBundle({
      abs,
      relKey,
      fileIndex,
      fileStat,
      fileHash,
      ext,
      fileCaps,
      cachedBundle,
      incrementalState,
      allImports,
      fileStructural,
      toolInfo,
      fileStart,
      knownLines,
      fileLanguageId
    });
    if (cachedOutcome?.skip) {
      const { reason, ...extra } = cachedOutcome.skip;
      recordSkip(abs, reason || 'oversize', extra);
      return null;
    }
    if (cachedOutcome?.result) {
      return cachedOutcome.result;
    }

    if (!fileBuffer) {
      try {
        fileBuffer = await runIo(() => fs.readFile(abs));
      } catch (err) {
        recordSkip(abs, 'read-failure', {
          code: err?.code || null,
          message: err?.message || String(err)
        });
        return null;
      }
    }
    const binarySkip = await resolveBinarySkip({
      abs,
      fileBuffer,
      fileScanner
    });
    if (binarySkip) {
      const { reason, ...extra } = binarySkip;
      recordSkip(abs, reason || 'binary', extra);
      return null;
    }
    if (!text || !fileHash) {
      const decoded = await readTextFileWithHash(abs, { buffer: fileBuffer, stat: fileStat });
      if (!text) text = decoded.text;
      if (!fileHash) fileHash = decoded.hash;
    }

    let languageLines = null;
    let languageSetKey = null;

    const cpuResult = await runCpu(async () => {
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
          const languageHint = getLanguageForFile(ext, relKey);
          const languageIdHint = languageHint?.id || null;
          const segmentHint = discoverSegments({
            text,
            ext,
            relPath: relKey,
            mode,
            languageId: languageIdHint,
            context: null,
            segmentsConfig: resolvedSegmentsConfig,
            extraSegments: []
          });
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
      const primaryLanguageId = getLanguageForFile(ext, relKey)?.id || null;
      const { lang, context: languageContext } = await runTreeSitter(async () => {
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
      });
      fileLanguageId = lang?.id || null;
      if (languageContext?.pythonAstMetrics?.durationMs) {
        setPythonAstDuration(languageContext.pythonAstMetrics.durationMs);
      }
      const tokenMode = mode === 'extracted-prose' ? 'prose' : mode;
      const lineIndex = buildLineIndex(text);
      const totalLines = lineIndex.length || 1;
      fileLineCount = totalLines;
      const fileLines = contextWin > 0 ? text.split('\n') : null;
      const capsByLanguage = resolveFileCaps(fileCaps, ext, lang?.id);
      if (capsByLanguage.maxLines && totalLines > capsByLanguage.maxLines) {
        return {
          chunks: [],
          fileRelations: null,
          skip: { reason: 'oversize', lines: totalLines, maxLines: capsByLanguage.maxLines }
        };
      }
      let lastLineLogged = 0;
      let lastLineLogMs = 0;
      const rawRelations = (mode === 'code' && relationsEnabled && lang && typeof lang.buildRelations === 'function')
        ? lang.buildRelations({
          text,
          relPath: relKey,
          allImports,
          context: languageContext,
          options: languageOptions
        })
        : null;
      const fileRelations = relationsEnabled ? buildFileRelations(rawRelations) : null;
      const callIndex = relationsEnabled ? buildCallIndex(rawRelations) : null;
      const gitStart = Date.now();
      const gitMeta = await runIo(() => getGitMetaForFile(relKey, {
        blame: gitBlameEnabled,
        baseDir: root
      }));
      setGitDuration(Date.now() - gitStart);
      const lineAuthors = Array.isArray(gitMeta?.lineAuthors)
        ? gitMeta.lineAuthors
        : null;
      const fileGitMeta = gitMeta && typeof gitMeta === 'object'
        ? Object.fromEntries(Object.entries(gitMeta).filter(([key]) => key !== 'lineAuthors'))
        : {};
      const commentsEnabled = (mode === 'code' || mode === 'extracted-prose')
        && normalizedCommentsConfig.extract !== 'off';
      const commentSegmentsEnabled = mode === 'extracted-prose'
        || (mode === 'code' && normalizedCommentsConfig.includeInCode === true);
      const parseStart = Date.now();
      const commentData = commentsEnabled
        ? extractComments({
          text,
          ext,
          languageId: lang?.id || null,
          lineIndex,
          config: normalizedCommentsConfig
        })
        : { comments: [], configSegments: [] };
      const commentEntries = [];
      const commentSegments = [];
      if (commentsEnabled && Array.isArray(commentData.comments)) {
        for (const comment of commentData.comments) {
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
      const segments = discoverSegments({
        text,
        ext,
        relPath: relKey,
        mode,
        languageId: lang?.id || null,
        context: languageContext,
        segmentsConfig: resolvedSegmentsConfig,
        extraSegments
      });
      const segmentContext = {
        ...languageContext,
        yamlChunking: languageOptions?.yamlChunking,
        chunking: languageOptions?.chunking,
        javascript: languageOptions?.javascript,
        typescript: languageOptions?.typescript,
        treeSitter: treeSitterConfigForMode,
        log: languageOptions?.log
      };
      const sc = treeSitterLanguagePasses === false
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
          treeSitterConfig: treeSitterConfigForMode
        }));
      addParseDuration(Date.now() - parseStart);
      const chunkLineRanges = sc.map((chunk) => {
        const startLine = chunk.meta?.startLine ?? offsetToLine(lineIndex, chunk.start);
        const endOffset = chunk.end > chunk.start ? chunk.end - 1 : chunk.start;
        let endLine = chunk.meta?.endLine ?? offsetToLine(lineIndex, endOffset);
        if (endLine < startLine) endLine = startLine;
        return { startLine, endLine };
      });
      const commentAssignments = assignCommentsToChunks(commentEntries, sc);
      const chunks = [];
      const tokenBuffers = createTokenizationBuffers();
      const codeTexts = embeddingEnabled ? [] : null;
      const docTexts = embeddingEnabled ? [] : null;
      const useWorkerForTokens = tokenMode === 'code'
        && !tokenWorkerDisabled
        && workerPool
        && workerPool.shouldUseForFile
        ? workerPool.shouldUseForFile(fileStat.size)
        : false;

      for (let ci = 0; ci < sc.length; ++ci) {
        const c = sc[ci];
        const ctext = text.slice(c.start, c.end);
        const lineRange = chunkLineRanges[ci] || { startLine: 1, endLine: fileLineCount || 1 };
        const startLine = lineRange.startLine;
        const endLine = lineRange.endLine;
        const chunkLineCount = Math.max(1, endLine - startLine + 1);
        const chunkLanguageId = c.segment?.languageId || fileLanguageId || lang?.id || 'unknown';
        addLineSpan(chunkLanguageId, startLine, endLine);
        if (showLineProgress) {
          const currentLine = chunkLineRanges[ci]?.endLine ?? totalLines;
          const now = Date.now();
          const shouldLog = currentLine >= totalLines
            || currentLine - lastLineLogged >= 200
            || now - lastLineLogMs >= 1000;
          if (shouldLog && currentLine > lastLineLogged) {
            lastLineLogged = currentLine;
            lastLineLogMs = now;
            logLine(`Line ${currentLine}/${totalLines}`, {
              kind: 'line-progress',
              mode,
              stage: 'processing',
              file: rel,
              current: currentLine,
              total: totalLines
            });
          }
        }

        let codeRelations = {}, docmeta = {};
        if (mode === 'code') {
          const relationStart = Date.now();
          docmeta = lang && typeof lang.extractDocMeta === 'function'
            ? lang.extractDocMeta({
              text,
              chunk: c,
              fileRelations,
              context: languageContext,
              options: languageOptions
            })
            : {};
          if (relationsEnabled && fileRelations) {
            codeRelations = buildChunkRelations({
              lang,
              chunk: c,
              fileRelations,
              callIndex
            });
          }
          let flowMeta = null;
          if (lang && typeof lang.flow === 'function') {
            const flowStart = Date.now();
            flowMeta = lang.flow({
              text,
              chunk: c,
              context: languageContext,
              options: languageOptions
            });
            const flowDurationMs = Date.now() - flowStart;
            if (flowDurationMs > 0) {
              const flowTargets = [];
              if (astDataflowEnabled) flowTargets.push('astDataflow');
              if (controlFlowEnabled) flowTargets.push('controlFlow');
              const flowShareMs = flowTargets.length
                ? flowDurationMs / flowTargets.length
                : 0;
              for (const flowTarget of flowTargets) {
                addSettingMetric(flowTarget, chunkLanguageId, chunkLineCount, flowShareMs);
              }
            }
          }
          if (flowMeta) {
          docmeta = mergeFlowMeta(docmeta, flowMeta, { astDataflowEnabled, controlFlowEnabled });
          }
          addParseDuration(Date.now() - relationStart);
          if (typeInferenceEnabled) {
            const enrichStart = Date.now();
            const inferredTypes = inferTypeMetadata({
              docmeta,
              chunkText: ctext,
              languageId: lang?.id || null
            });
            if (inferredTypes) {
              docmeta = { ...docmeta, inferredTypes };
            }
            const typeDurationMs = Date.now() - enrichStart;
            addEnrichDuration(typeDurationMs);
            addSettingMetric('typeInference', chunkLanguageId, chunkLineCount, typeDurationMs);
          }
          if (riskAnalysisEnabled) {
            const enrichStart = Date.now();
            const risk = detectRiskSignals({
              text: ctext,
              chunk: c,
              config: riskConfig,
              languageId: lang?.id || null
            });
            if (risk) {
              docmeta = { ...docmeta, risk };
            }
            const riskDurationMs = Date.now() - enrichStart;
            addEnrichDuration(riskDurationMs);
            addSettingMetric('riskAnalysis', chunkLanguageId, chunkLineCount, riskDurationMs);
          }
        }

        if (fileStructural) {
          const structural = getStructuralMatchesForChunk(
            fileStructural,
            startLine,
            endLine,
            totalLines
          );
          if (structural) {
            docmeta = { ...docmeta, structural };
          }
        }

        let commentFieldTokens = [];
        if (commentAssignments.size) {
          const assigned = commentAssignments.get(ci) || [];
          if (assigned.length) {
            const chunkStart = c.start;
            const sorted = assigned.slice().sort((a, b) => (
              Math.abs(a.start - chunkStart) - Math.abs(b.start - chunkStart)
            ));
            const maxPerChunk = normalizedCommentsConfig.maxPerChunk;
            const maxBytes = normalizedCommentsConfig.maxBytesPerChunk;
            let totalBytes = 0;
            const metaComments = [];
            for (const comment of sorted) {
              if (maxPerChunk && metaComments.length >= maxPerChunk) break;
              const remaining = maxBytes ? Math.max(0, maxBytes - totalBytes) : 0;
              if (maxBytes && remaining <= 0) break;
              const clipped = maxBytes ? truncateByBytes(comment.text, remaining) : {
                text: comment.text,
                truncated: false,
                bytes: Buffer.byteLength(comment.text, 'utf8')
              };
              if (!clipped.text) continue;
              totalBytes += clipped.bytes;
              const includeInTokens = comment.type === 'inline'
                || comment.type === 'block'
                || (comment.type === 'license' && normalizedCommentsConfig.includeLicense);
              if (includeInTokens) {
                const tokens = buildTokenSequence({
                  text: clipped.text,
                  mode: 'prose',
                  ext,
                  dictWords: tokenDictWords,
                  dictConfig
                }).tokens;
                if (tokens.length) {
                  for (const token of tokens) commentFieldTokens.push(token);
                }
              }
              metaComments.push({
                type: comment.type,
                style: comment.style,
                languageId: comment.languageId || null,
                start: comment.start,
                end: comment.end,
                startLine: comment.startLine,
                endLine: comment.endLine,
                text: clipped.text,
                truncated: clipped.truncated || false,
                indexed: includeInTokens,
                anchorChunkId: null
              });
            }
            if (metaComments.length) {
              docmeta = { ...docmeta, comments: metaComments };
            }
          }
        }

        // Chargrams are built during postings construction (appendChunk), where we can
        // honor postingsConfig.chargramSource without duplicating tokenization work here.
        const fieldChargramTokens = null;

        let tokenPayload = null;
        if (useWorkerForTokens) {
          try {
            const tokenStart = Date.now();
            tokenPayload = await workerPool.runTokenize({
              text: ctext,
              mode: tokenMode,
              ext,
              file: relKey,
              size: fileStat.size,
              // chargramTokens is intentionally omitted (see note above).
              ...(workerDictOverride ? { dictConfig: workerDictOverride } : {})
            });
            const tokenDurationMs = Date.now() - tokenStart;
            addTokenizeDuration(tokenDurationMs);
            if (tokenPayload) {
              addSettingMetric('tokenize', chunkLanguageId, chunkLineCount, tokenDurationMs);
            }
          } catch (err) {
            if (!workerTokenizeFailed) {
              const message = formatError(err);
              const detail = err?.stack || err?.cause || null;
              log(`Worker tokenization failed; falling back to main thread. ${message}`);
              if (detail) log(`Worker tokenization detail: ${detail}`);
              workerTokenizeFailed = true;
            }
            tokenWorkerDisabled = true;
            if (crashLogger?.enabled) {
              crashLogger.logError({
                phase: 'worker-tokenize',
                file: relKey,
                size: fileStat?.size || null,
                languageId: fileLanguageId || lang?.id || null,
                message: formatError(err),
                stack: err?.stack || null,
                raw: util.inspect(err, {
                  depth: 5,
                  breakLength: 120,
                  showHidden: true,
                  getters: true
                }),
                ownProps: err && typeof err === 'object'
                  ? Object.getOwnPropertyNames(err)
                  : [],
                ownSymbols: err && typeof err === 'object'
                  ? Object.getOwnPropertySymbols(err).map((sym) => sym.toString())
                  : []
              });
            }
          }
        }
        if (!tokenPayload) {
          const tokenStart = Date.now();
          tokenPayload = tokenizeChunkText({
            text: ctext,
            mode: tokenMode,
            ext,
            context: tokenContext,
            // chargramTokens is intentionally omitted (see note above).
            buffers: tokenBuffers
          });
          const tokenDurationMs = Date.now() - tokenStart;
          addTokenizeDuration(tokenDurationMs);
          addSettingMetric('tokenize', chunkLanguageId, chunkLineCount, tokenDurationMs);
        }

        const {
          tokens,
          seq,
          minhashSig,
          stats
        } = tokenPayload;

        if (tokenizationStats) {
          tokenizationStats.chunks += 1;
          tokenizationStats.tokens += tokens.length;
          tokenizationStats.seq += seq.length;
          // Phrase ngrams and chargrams are computed during postings construction (appendChunk).
          // We don't materialize them during tokenization to avoid large transient allocations.
        }

        if (!seq.length) continue;

        const docText = typeof docmeta.doc === 'string' ? docmeta.doc : '';

        let complexity = {}, lint = [];
        if (isJsLike(ext) && mode === 'code') {
          if (complexityEnabled) {
            const cacheKey = fileHash ? `${rel}:${fileHash}` : rel;
            let cachedComplexity = complexityCache.get(cacheKey);
            if (!cachedComplexity) {
              const enrichStart = Date.now();
              const fullCode = text;
              const compResult = await analyzeComplexity(fullCode, rel);        
              complexityCache.set(cacheKey, compResult);
              cachedComplexity = compResult;
              const enrichDurationMs = Date.now() - enrichStart;
              addComplexityDuration(enrichDurationMs);
            }
            complexity = cachedComplexity || {};
          }

          if (lintEnabled) {
            const cacheKey = fileHash ? `${rel}:${fileHash}` : rel;
            let cachedLint = lintCache.get(cacheKey);
            if (!cachedLint) {
              const enrichStart = Date.now();
              const fullCode = text;
              const lintResult = await lintChunk(fullCode, rel);
              lintCache.set(cacheKey, lintResult);
              cachedLint = lintResult;
              const enrichDurationMs = Date.now() - enrichStart;
              addLintDuration(enrichDurationMs);
            }
            lint = cachedLint || [];
          }
        }

        let preContext = [], postContext = [];
        if (contextWin > 0 && fileLines) {
          if (ci > 0) {
            const prev = chunkLineRanges[ci - 1];
            const startIdx = Math.max(0, prev.startLine - 1);
            const endIdx = Math.min(fileLines.length, prev.endLine);
            preContext = fileLines.slice(startIdx, endIdx).slice(-contextWin);
          }
          if (ci + 1 < sc.length) {
            const next = chunkLineRanges[ci + 1];
            const startIdx = Math.max(0, next.startLine - 1);
            const endIdx = Math.min(fileLines.length, next.endLine);
            postContext = fileLines.slice(startIdx, endIdx).slice(0, contextWin);
          }
        }
        const chunkAuthors = lineAuthors
          ? getChunkAuthorsFromLines(lineAuthors, startLine, endLine)
          : [];
        const gitMeta = {
          ...fileGitMeta,
          ...(chunkAuthors.length ? { chunk_authors: chunkAuthors } : {})
        };
        const chunkRecord = { ...c, startLine, endLine };
        const chunkPayload = buildChunkPayload({
          chunk: chunkRecord,
          rel,
          relKey,
          ext,
          languageId: fileLanguageId || lang?.id || null,
          tokens,
          seq,
          codeRelations,
          docmeta,
          stats,
          complexity,
          lint,
          preContext,
          postContext,
          minhashSig,
          commentFieldTokens,
          dictWords: tokenDictWords,
          dictConfig,
          postingsConfig,
          tokenMode,
          fileRelations,
          relationsEnabled,
          toolInfo,
          gitMeta
        });

        chunks.push(chunkPayload);
        if (embeddingEnabled && codeTexts && docTexts) {
          codeTexts.push(ctext);
          docTexts.push(docText.trim() ? docText : '');
        }
      }

      const embeddingResult = await attachEmbeddings({
        chunks,
        codeTexts,
        docTexts,
        embeddingEnabled,
        getChunkEmbedding,
        getChunkEmbeddings,
        runEmbedding,
        embeddingBatchSize,
        fileLanguageId,
        languageOptions
      });
      addEmbeddingDuration(embeddingResult.embeddingMs);

      return { chunks, fileRelations, skip: null };
    });
    if (cpuResult?.defer) {
      return cpuResult;
    }
    const { chunks: fileChunks, fileRelations, skip } = cpuResult || {};
    if (skip) {
      const { reason, ...extra } = skip;
      recordSkip(abs, reason || 'oversize', extra);
      return null;
    }

    const { languageLines: resolvedLanguageLines, languageSetKey: resolvedLanguageSetKey } =
      finalizeLanguageLines({ fileLineCount, fileLanguageId });
    if (resolvedLanguageLines) {
      languageLines = resolvedLanguageLines;
      languageSetKey = resolvedLanguageSetKey;
    }
    recordFeatureMetrics({
      gitBlameEnabled,
      embeddingEnabled,
      lintEnabled,
      complexityEnabled,
      fileLineCount,
      languageLines,
      languageSetKey
    });

    const manifestEntry = await writeBundleForFile({
      runIo,
      incrementalState,
      relKey,
      fileStat,
      fileHash,
      fileChunks,
      fileRelations
    });

    const fileDurationMs = Date.now() - fileStart;
    const fileMetrics = buildFileMetrics({
      fileLineCount,
      fileStat,
      fileDurationMs,
      fileLanguageId,
      cached: false
    });
    recordFileMetrics({
      fileLineCount,
      fileStat,
      fileDurationMs,
      languageLines,
      languageSetKey
    });
    return {
      abs,
      relKey,
      fileIndex,
      cached: false,
      durationMs: fileDurationMs,
      chunks: fileChunks,
      fileRelations,
      manifestEntry,
      fileMetrics
    };
  }

  return { processFile };
}
