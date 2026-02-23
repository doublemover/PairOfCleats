import { assignSegmentUids, chunkSegments, discoverSegments } from '../../segments.js';
import { finalizeSegments } from '../../segments/finalize.js';
import { getLanguageForFile } from '../../language-registry.js';
import { toRepoPosixPath } from '../../scm/paths.js';
import { buildLineAuthors } from '../../scm/annotate.js';
import { buildCallIndex, buildFileRelations } from './relations.js';
import {
  filterRawRelationsWithLexicon,
  getLexiconRelationFilterStats
} from './lexicon-relations-filter.js';
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
import { shouldPreferDocsProse } from '../mode-routing.js';
import { buildLineIndex } from '../../../shared/lines.js';
import { formatError } from './meta.js';
import { processChunks } from './process-chunks.js';
import { buildVfsVirtualPath } from '../../tooling/vfs.js';
import { resolveChunkingFileRole } from '../../chunking/limits.js';
import { shouldSkipTreeSitterPlanningForPath } from '../tree-sitter-scheduler/policy.js';
import { createTimeoutError, runWithTimeout } from '../../../shared/promise-timeout.js';
import {
  resolveSegmentExt,
  resolveSegmentTokenMode,
  shouldIndexSegment
} from '../../segments/config.js';

const TREE_SITTER_LANG_IDS = new Set(TREE_SITTER_LANGUAGE_IDS);
const SCM_ANNOTATE_FAST_TIMEOUT_EXTS = new Set([
  '.yml',
  '.yaml',
  '.json',
  '.toml',
  '.lock',
  '.py',
  '.pyi',
  '.swift',
  '.html',
  '.htm'
]);
const SCM_META_FAST_TIMEOUT_EXTS = new Set([
  '.yml',
  '.yaml',
  '.json',
  '.toml',
  '.lock',
  '.py',
  '.pyi',
  '.swift',
  '.html',
  '.htm'
]);
const SCM_PYTHON_EXTS = new Set(['.py', '.pyi']);
const SCM_ANNOTATE_PYTHON_MAX_BYTES = 64 * 1024;
const SCM_ANNOTATE_PYTHON_HEAVY_LINE_CUTOFF = 2500;
const SCM_ANNOTATE_FAST_TIMEOUT_MS = 5000;
const SCM_ANNOTATE_HEAVY_PATH_TIMEOUT_MS = 5000;
const SCM_ANNOTATE_DEFAULT_TIMEOUT_CAP_MS = 5000;
const SCM_TASK_QUEUE_WAIT_SLACK_MS = 250;
const SCM_FAST_TIMEOUT_BASENAMES = new Set([
  'cmakelists.txt',
  'makefile',
  'dockerfile',
  'podfile',
  'gemfile',
  'justfile'
]);
const SCM_FAST_TIMEOUT_PATH_PARTS = [
  '/.github/workflows/',
  '/.circleci/',
  '/.gitlab/'
];
const SCM_FORCE_TIMEOUT_CAP_PATH_PARTS = [
  '/test/',
  '/validation-test/',
  '/unittests/',
  '/utils/unicodedata/',
  '/utils/gen-unicode-data/'
];
const SCM_JAVA_FAST_TIMEOUT_MIN_LINES = 400;
const SCM_FAST_TIMEOUT_MAX_LINES = 900;
const SCM_CHURN_MAX_BYTES = 256 * 1024;
const HEAVY_RELATIONS_MAX_BYTES = 512 * 1024;
const HEAVY_RELATIONS_MAX_LINES = 6000;
const HEAVY_RELATIONS_PATH_MIN_BYTES = 64 * 1024;
const HEAVY_RELATIONS_PATH_MIN_LINES = 1200;
const HEAVY_RELATIONS_PATH_PARTS = [
  '/3rdparty/',
  '/third_party/',
  '/thirdparty/',
  '/vendor/',
  '/single_include/',
  '/include/fmt/',
  '/include/spdlog/fmt/',
  '/include/nlohmann/',
  '/modules/core/include/opencv2/core/hal/',
  '/modules/core/src/',
  '/modules/dnn/',
  '/modules/js/perf/',
  '/sources/cniollhttp/',
  '/sources/nio/',
  '/sources/niocore/',
  '/sources/nioposix/',
  '/tests/nio/',
  '/test/api-digester/inputs/',
  '/test/remote-run/',
  '/test/stdlib/inputs/',
  '/tests/abi/',
  '/test/gtest/',
  '/utils/unicodedata/',
  '/utils/gen-unicode-data/',
  '/samples/',
  '/docs/mkdocs/',
  '/.github/workflows/'
];
const EXTRACTED_PROSE_EXTRAS_CACHE_SCHEMA = 'v1';

const normalizeLowerToken = (value) => (
  typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : ''
);

const buildExtractedProseExtrasCacheKey = ({
  fileHash,
  fileHashAlgo,
  ext,
  languageId
}) => {
  const hash = typeof fileHash === 'string' ? fileHash.trim() : '';
  if (!hash) return null;
  const algo = normalizeLowerToken(fileHashAlgo) || 'sha1';
  const normalizedExt = normalizeLowerToken(ext);
  const normalizedLanguageId = normalizeLowerToken(languageId);
  return [
    EXTRACTED_PROSE_EXTRAS_CACHE_SCHEMA,
    algo,
    hash,
    normalizedExt,
    normalizedLanguageId
  ].join('|');
};

const cloneCachedExtrasEntry = (entry) => {
  if (!entry || typeof entry !== 'object') {
    return {
      commentEntries: [],
      commentRanges: [],
      extraSegments: []
    };
  }
  const cloneItem = (item) => {
    if (!item || typeof item !== 'object') return item;
    const next = { ...item };
    if (Array.isArray(item.tokens)) next.tokens = item.tokens.slice();
    if (item.meta && typeof item.meta === 'object') next.meta = { ...item.meta };
    return next;
  };
  return {
    commentEntries: Array.isArray(entry.commentEntries)
      ? entry.commentEntries.map(cloneItem)
      : [],
    commentRanges: Array.isArray(entry.commentRanges)
      ? entry.commentRanges.map(cloneItem)
      : [],
    extraSegments: Array.isArray(entry.extraSegments)
      ? entry.extraSegments.map(cloneItem)
      : []
  };
};

/**
 * Normalize repo-relative paths for case-insensitive SCM heuristics.
 *
 * @param {string} relPath
 * @returns {string}
 */
const normalizeScmPath = (relPath) => String(relPath || '').replace(/\\/g, '/').toLowerCase();

/**
 * Normalize and bound one path for stable `includes("/segment/")` checks.
 *
 * @param {string} relPath
 * @returns {string}
 */
const toBoundedScmPath = (relPath) => {
  const normalized = normalizeScmPath(relPath);
  return `/${normalized.replace(/^\/+|\/+$/g, '')}/`;
};

/**
 * Detect generated Python lexer tables that should use stricter SCM budgets.
 *
 * @param {string} relPath
 * @returns {boolean}
 */
const isPythonGeneratedDataPath = (relPath) => {
  const normalizedPath = normalizeScmPath(relPath);
  if (!normalizedPath.endsWith('.py') && !normalizedPath.endsWith('.pyi')) return false;
  if (!normalizedPath.includes('pygments/lexers/')) return false;
  return normalizedPath.endsWith('_builtins.py') || normalizedPath.endsWith('/_mapping.py');
};

/**
 * Files that frequently incur SCM command overhead (lockfiles/config/docs search payloads)
 * are routed through tighter timeout caps so they do not dominate queue latency.
 *
 * @param {{relPath?:string,ext?:string,lines?:number}} input
 * @returns {boolean}
 */
const isScmFastPath = ({ relPath, ext, lines }) => {
  const normalizedPath = normalizeScmPath(relPath);
  const boundedPath = toBoundedScmPath(relPath);
  const normalizedExt = typeof ext === 'string' ? ext.toLowerCase() : '';
  if (SCM_META_FAST_TIMEOUT_EXTS.has(normalizedExt) || SCM_ANNOTATE_FAST_TIMEOUT_EXTS.has(normalizedExt)) {
    return true;
  }
  if (normalizedExt === '.java' && Number.isFinite(Number(lines)) && Number(lines) >= SCM_JAVA_FAST_TIMEOUT_MIN_LINES) {
    return true;
  }
  if (Number.isFinite(Number(lines)) && Number(lines) >= SCM_FAST_TIMEOUT_MAX_LINES) {
    return true;
  }
  const base = normalizedPath.split('/').pop() || '';
  if (SCM_FAST_TIMEOUT_BASENAMES.has(base)) return true;
  for (const part of SCM_FAST_TIMEOUT_PATH_PARTS) {
    if (boundedPath.includes(part)) return true;
  }
  if (isHeavyRelationsPath(normalizedPath)) return true;
  return false;
};

/**
 * Force strict SCM timeout caps for known high-overhead repository areas.
 *
 * @param {string} relPath
 * @returns {boolean}
 */
const shouldForceScmTimeoutCaps = (relPath) => {
  const boundedPath = toBoundedScmPath(relPath);
  for (const part of SCM_FORCE_TIMEOUT_CAP_PATH_PARTS) {
    if (boundedPath.includes(part)) return true;
  }
  return false;
};

/**
 * Convert per-task timeout into queue deadline budget with fixed scheduling slack.
 *
 * @param {number} taskTimeoutMs
 * @returns {number}
 */
const resolveScmTaskDeadlineMs = (taskTimeoutMs) => {
  const baseTimeout = Number(taskTimeoutMs);
  if (!Number.isFinite(baseTimeout) || baseTimeout <= 0) return 0;
  const boundedBase = Math.max(1, Math.floor(baseTimeout));
  return boundedBase + SCM_TASK_QUEUE_WAIT_SLACK_MS;
};

/**
 * Identify SCM task timeout errors from queue/deadline wrappers.
 *
 * @param {Error & {code?:string}} error
 * @returns {boolean}
 */
const isScmTaskTimeoutError = (error) => (
  error?.code === 'SCM_TASK_TIMEOUT'
);

/**
 * Identify paths that produce disproportionately expensive relation extraction.
 *
 * @param {string} relPath
 * @returns {boolean}
 */
const isHeavyRelationsPath = (relPath) => {
  const boundedPath = toBoundedScmPath(relPath);
  for (const part of HEAVY_RELATIONS_PATH_PARTS) {
    if (boundedPath.includes(part)) return true;
  }
  return false;
};

/**
 * Skip heavy relation extraction on oversized files under known expensive paths.
 *
 * @param {{relPath:string,fileBytes:number,fileLines:number}} input
 * @returns {boolean}
 */
const shouldSkipHeavyRelationsByPath = ({ relPath, fileBytes, fileLines }) => (
  isHeavyRelationsPath(relPath)
  && (
    fileBytes >= HEAVY_RELATIONS_PATH_MIN_BYTES
    || fileLines >= HEAVY_RELATIONS_PATH_MIN_LINES
  )
);

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

/**
 * Count newline-delimited lines, optionally short-circuiting past `maxLines`.
 *
 * @param {string} text
 * @param {number|null} [maxLines=null]
 * @returns {number}
 */
const countLines = (text, maxLines = null) => {
  if (!text) return 0;
  const capped = Number.isFinite(Number(maxLines)) && Number(maxLines) > 0
    ? Math.floor(Number(maxLines))
    : null;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
    if (capped && count > capped) return count;
  }
  return count;
};

/**
 * Check per-language tree-sitter max-bytes/max-lines guardrails.
 *
 * @param {{text:string,languageId:string|null,treeSitterConfig:object|null}} input
 * @returns {boolean}
 */
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
    const lines = countLines(text, maxLines);
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
  const primaryLanguageId = languageHint?.id || null;
  const treeSitterPolicySkipped = shouldSkipTreeSitterPlanningForPath({
    relKey,
    languageId: primaryLanguageId
  });
  const extractedDocumentFile = documentExtraction && typeof documentExtraction === 'object';
  const resolvedSegmentsConfig = mode === 'extracted-prose' && !extractedDocumentFile
    ? { ...normalizedSegmentsConfig, onlyExtras: true }
    : normalizedSegmentsConfig;
  const treeSitterEnabled = treeSitterConfig?.enabled !== false
    && mode === 'code'
    && !treeSitterPolicySkipped;
  const treeSitterLanguagePasses = treeSitterEnabled && treeSitterConfig?.languagePasses !== false;
  const treeSitterCacheKey = treeSitterConfig?.cacheKey ?? fileHash ?? null;
  const treeSitterConfigForMode = treeSitterEnabled
    ? { ...(treeSitterConfig || {}), cacheKey: treeSitterCacheKey }
    : { ...(treeSitterConfig || {}), enabled: false, cacheKey: treeSitterCacheKey };
  let schedulerPlannedSegments = null;
  if (
    treeSitterEnabled
    && treeSitterScheduler
    && typeof treeSitterScheduler.loadPlannedSegments === 'function'
  ) {
    try {
      schedulerPlannedSegments = treeSitterScheduler.loadPlannedSegments(relKey);
    } catch {}
  }
  const hasSchedulerPlannedSegments = Array.isArray(schedulerPlannedSegments)
    && schedulerPlannedSegments.length > 0;
  const contextTreeSitterConfig = treeSitterLanguagePasses
    ? { ...(treeSitterConfigForMode || {}), enabled: false }
    : treeSitterConfigForMode;
  const languageContextOptions = languageOptions && typeof languageOptions === 'object'
    ? {
      ...languageOptions,
      relationsEnabled,
      metricsCollector,
      filePath: abs,
      fileSizeBytes: fileStat?.size ?? null,
      fileLineCountHint: Number.isFinite(Number(fileEntry?.lines))
        ? Math.max(0, Math.floor(Number(fileEntry.lines)))
        : null,
      // When scheduler chunks are already planned, stage1 can skip language-level
      // prepare passes and avoid duplicate parser work on large files.
      skipPrepare: hasSchedulerPlannedSegments && mode === 'code' && relationsEnabled !== true,
      treeSitter: contextTreeSitterConfig
    }
    : {
      relationsEnabled,
      metricsCollector,
      filePath: abs,
      fileSizeBytes: fileStat?.size ?? null,
      fileLineCountHint: Number.isFinite(Number(fileEntry?.lines))
        ? Math.max(0, Math.floor(Number(fileEntry.lines)))
        : null,
      skipPrepare: hasSchedulerPlannedSegments && mode === 'code' && relationsEnabled !== true,
      treeSitter: contextTreeSitterConfig
    };
  const shouldSerializeLanguageContext = treeSitterEnabled && treeSitterLanguagePasses === false;
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
  const skipHeavyRelations = mode === 'code'
    && relationsEnabled
    && (
      (fileStat?.size ?? 0) >= HEAVY_RELATIONS_MAX_BYTES
      || totalLines >= HEAVY_RELATIONS_MAX_LINES
      || shouldSkipHeavyRelationsByPath({
        relPath: relKey,
        fileBytes: fileStat?.size ?? 0,
        fileLines: totalLines
      })
    );
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
  const runScmTask = async (fn) => {
    if (typeof runProc !== 'function') return fn();
    const enqueuedAtMs = Date.now();
    return runProc(async () => {
      const queueWaitMs = Math.max(0, Date.now() - enqueuedAtMs);
      if (queueWaitMs > 0 && typeof onScmProcQueueWait === 'function') {
        try {
          onScmProcQueueWait(queueWaitMs);
        } catch {}
      }
      return fn();
    });
  };
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
      && (fileStat?.size ?? 0) <= SCM_CHURN_MAX_BYTES;
    const supportsScmMetaCache = Boolean(
      scmMetaCache
      && typeof scmMetaCache.get === 'function'
      && typeof scmMetaCache.set === 'function'
      && typeof scmMetaCache.delete === 'function'
    );
    const applyScmMetaResult = (value) => {
      if (!value || typeof value !== 'object') return;
      fileGitCommitId = typeof value.fileGitCommitId === 'string'
        ? value.fileGitCommitId
        : null;
      fileGitMeta = value.fileGitMeta && typeof value.fileGitMeta === 'object'
        ? value.fileGitMeta
        : {};
      scmMetaUnavailableReason = typeof value.scmMetaUnavailableReason === 'string'
        ? value.scmMetaUnavailableReason
        : null;
    };
    const readScmMetaFromProvider = async () => {
      const result = {
        fileGitCommitId: null,
        fileGitMeta: {},
        scmMetaUnavailableReason: null
      };
      if (typeof scmProviderImpl.getFileMeta !== 'function') return result;
      try {
        await runScmTaskWithDeadline({
          label: 'file-meta',
          timeoutMs: metaTimeoutMs,
          task: async (taskSignal) => {
            if (taskSignal?.aborted) return;
            const fileMeta = await Promise.resolve(scmProviderImpl.getFileMeta({
              repoRoot: scmRepoRoot,
              filePosix,
              timeoutMs: Math.max(0, metaTimeoutMs),
              includeChurn,
              signal: taskSignal || undefined
            }));
            if (taskSignal?.aborted) return;
            if (fileMeta && fileMeta.ok !== false) {
              result.fileGitCommitId = typeof fileMeta.lastCommitId === 'string'
                ? fileMeta.lastCommitId
                : null;
              result.fileGitMeta = {
                last_modified: fileMeta.lastModifiedAt ?? null,
                last_author: fileMeta.lastAuthor ?? null,
                churn: Number.isFinite(fileMeta.churn) ? fileMeta.churn : null,
                churn_added: Number.isFinite(fileMeta.churnAdded) ? fileMeta.churnAdded : null,
                churn_deleted: Number.isFinite(fileMeta.churnDeleted) ? fileMeta.churnDeleted : null,
                churn_commits: Number.isFinite(fileMeta.churnCommits) ? fileMeta.churnCommits : null
              };
              return;
            }
            const reason = String(fileMeta?.reason || '').toLowerCase();
            if (reason === 'timeout' || reason === 'unavailable') {
              result.scmMetaUnavailableReason = reason;
            }
          }
        });
      } catch (error) {
        if (isScmTaskTimeoutError(error)) {
          result.scmMetaUnavailableReason = 'timeout';
        } else {
          throw error;
        }
      }
      return result;
    };
    const readCachedOrProviderScmMeta = async () => {
      if (!supportsScmMetaCache) {
        return readScmMetaFromProvider();
      }
      const cacheKey = `${filePosix}|churn:${includeChurn ? '1' : '0'}`;
      const existing = scmMetaCache.get(cacheKey);
      if (existing) {
        return existing;
      }
      const pending = readScmMetaFromProvider().catch((error) => {
        scmMetaCache.delete(cacheKey);
        throw error;
      });
      scmMetaCache.set(cacheKey, pending);
      return pending;
    };
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
        || (fileStat?.size ?? 0) <= maxAnnotateBytes;
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
  const schedulerLanguageIds = treeSitterScheduler?.scheduledLanguageIds;
  const schedulerLanguageSet = schedulerLanguageIds instanceof Set
    ? schedulerLanguageIds
    : (Array.isArray(schedulerLanguageIds)
      ? new Set(schedulerLanguageIds.filter((languageId) => typeof languageId === 'string' && languageId))
      : null);
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
  const chunkingDiagnostics = {
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
    const fallbackSegments = [];
    const scheduled = [];
    let schedulerMissingCount = 0;
    let schedulerDegradedCount = 0;
    let codeFallbackSegmentCount = 0;
    const treeSitterOptions = { treeSitter: treeSitterConfigForMode || {} };
    for (const segment of segments || []) {
      if (!segment) continue;
      const segmentTokenMode = resolveSegmentTokenMode(segment);
      if (!shouldIndexSegment(segment, segmentTokenMode, tokenMode)) continue;

      if (!mustUseTreeSitterScheduler || segmentTokenMode !== 'code') {
        fallbackSegments.push(segment);
        if (segmentTokenMode === 'code') codeFallbackSegmentCount += 1;
        continue;
      }

      const segmentExt = resolveSegmentExt(ext, segment);
      const rawLanguageId = segment.languageId || lang?.id || null;
      const resolvedLang = resolveTreeSitterLanguageForSegment(rawLanguageId, segmentExt);
      const schedulerSupportsLanguage = !schedulerLanguageSet || schedulerLanguageSet.has(resolvedLang);
      const canUseTreeSitter = resolvedLang
        && TREE_SITTER_LANG_IDS.has(resolvedLang)
        && isTreeSitterSchedulerLanguage(resolvedLang)
        && schedulerSupportsLanguage
        && isTreeSitterEnabled(treeSitterOptions, resolvedLang);
      if (!canUseTreeSitter) {
        fallbackSegments.push(segment);
        codeFallbackSegmentCount += 1;
        continue;
      }

      const segmentText = text.slice(segment.start, segment.end);
      if (exceedsTreeSitterLimits({ text: segmentText, languageId: resolvedLang, treeSitterConfig: treeSitterConfigForMode })) {
        fallbackSegments.push(segment);
        codeFallbackSegmentCount += 1;
        continue;
      }

      const segmentUid = segment.segmentUid || null;
      const isFullFile = segment.start === 0 && segment.end === text.length;
      if (!isFullFile && !segmentUid) {
        logLine?.(
          '[tree-sitter:schedule] missing segmentUid for scheduled segment',
          {
            kind: 'error',
            mode,
            stage: 'processing',
            file: relKey,
            substage: 'chunking',
            fileOnlyLine:
              `[tree-sitter:schedule] missing segmentUid for ${relKey} (${segment.start}-${segment.end})`
          }
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

    const schedulerLoadOptions = { consume: false };
    const schedulerLoadChunksBatch = treeSitterScheduler
      && typeof treeSitterScheduler.loadChunksBatch === 'function'
      ? treeSitterScheduler.loadChunksBatch.bind(treeSitterScheduler)
      : null;
    const schedulerLoadChunk = treeSitterScheduler
      && typeof treeSitterScheduler.loadChunks === 'function'
      ? treeSitterScheduler.loadChunks.bind(treeSitterScheduler)
      : null;
    const schedulerDegradedCheck = treeSitterScheduler
      && typeof treeSitterScheduler.isDegradedVirtualPath === 'function'
      ? treeSitterScheduler.isDegradedVirtualPath.bind(treeSitterScheduler)
      : () => false;
    const schedulerLookupItems = [];
    for (const item of scheduled) {
      if (schedulerDegradedCheck(item.virtualPath)) {
        fallbackSegments.push(item.segment);
        schedulerDegradedCount += 1;
        codeFallbackSegmentCount += 1;
        continue;
      }
      schedulerLookupItems.push(item);
    }
    updateCrashStage('chunking:scheduler:plan', {
      scheduledSegmentCount: scheduled.length,
      schedulerLookupItems: schedulerLookupItems.length,
      fallbackSegmentCount: fallbackSegments.length,
      schedulerDegradedCount
    });
    const batchChunks = schedulerLookupItems.length > 0
      && schedulerLoadChunksBatch
      ? await (async () => {
        const virtualPaths = schedulerLookupItems.map((item) => item.virtualPath);
        updateCrashStage('chunking:scheduler:load-batch:start', {
          itemCount: virtualPaths.length
        });
        const chunks = await schedulerLoadChunksBatch(virtualPaths, schedulerLoadOptions);
        updateCrashStage('chunking:scheduler:load-batch:done', {
          itemCount: virtualPaths.length,
          loadedCount: Array.isArray(chunks) ? chunks.length : null
        });
        return chunks;
      })()
      : null;
    if (Array.isArray(batchChunks) && batchChunks.length === schedulerLookupItems.length) {
      for (let i = 0; i < schedulerLookupItems.length; i += 1) {
        const item = schedulerLookupItems[i];
        const chunks = batchChunks[i];
        if (!Array.isArray(chunks) || !chunks.length) {
          const hasScheduledEntry = treeSitterScheduler?.index instanceof Map
            ? treeSitterScheduler.index.has(item.virtualPath)
            : null;
          if (!treeSitterStrict && hasScheduledEntry === false) {
            fallbackSegments.push(item.segment);
            schedulerMissingCount += 1;
            codeFallbackSegmentCount += 1;
            continue;
          }
          logLine?.(
            '[tree-sitter:schedule] missing scheduled chunks',
            {
              kind: 'error',
              mode,
              stage: 'processing',
              file: relKey,
              substage: 'chunking',
              fileOnlyLine: `[tree-sitter:schedule] missing scheduled chunks for ${relKey}: ${item.label}`
            }
          );
          throw new Error(`[tree-sitter:schedule] Missing scheduled chunks for ${relKey}: ${item.label}`);
        }
        sc.push(...chunks);
      }
    } else {
      const loadChunk = schedulerLoadChunk
        ? (virtualPath) => schedulerLoadChunk(virtualPath, schedulerLoadOptions)
        : null;
      for (const item of schedulerLookupItems) {
        if (!loadChunk) {
          fallbackSegments.push(item.segment);
          codeFallbackSegmentCount += 1;
          continue;
        }
        updateCrashStage('chunking:scheduler:load-one:start', {
          label: item.label,
          virtualPath: item.virtualPath
        });
        const chunks = await loadChunk(item.virtualPath);
        updateCrashStage('chunking:scheduler:load-one:done', {
          label: item.label,
          virtualPath: item.virtualPath,
          chunkCount: Array.isArray(chunks) ? chunks.length : null
        });
        if (!Array.isArray(chunks) || !chunks.length) {
          const hasScheduledEntry = treeSitterScheduler?.index instanceof Map
            ? treeSitterScheduler.index.has(item.virtualPath)
            : null;
          if (!treeSitterStrict && hasScheduledEntry === false) {
            fallbackSegments.push(item.segment);
            schedulerMissingCount += 1;
            codeFallbackSegmentCount += 1;
            continue;
          }
          logLine?.(
            '[tree-sitter:schedule] missing scheduled chunks',
            {
              kind: 'error',
              mode,
              stage: 'processing',
              file: relKey,
              substage: 'chunking',
              fileOnlyLine: `[tree-sitter:schedule] missing scheduled chunks for ${relKey}: ${item.label}`
            }
          );
          throw new Error(`[tree-sitter:schedule] Missing scheduled chunks for ${relKey}: ${item.label}`);
        }
        sc.push(...chunks);
      }
    }

    if (schedulerMissingCount > 0) {
      logLine?.(
        `[tree-sitter:schedule] scheduler missed ${schedulerMissingCount} segment(s); using fallback chunking.`,
        {
          kind: 'warn',
          mode,
          stage: 'processing',
          file: relKey,
          substage: 'chunking',
          fileOnlyLine:
            `[tree-sitter:schedule] scheduler missing ${schedulerMissingCount} segment(s); using fallback chunking for ${relKey}`
        }
      );
    }
    if (schedulerDegradedCount > 0) {
      logLine?.(
        `[tree-sitter:schedule] parser crash degraded ${schedulerDegradedCount} scheduled segment(s); using fallback chunking.`,
        {
          kind: 'warning',
          mode,
          stage: 'processing',
          file: relKey,
          substage: 'chunking',
          fileOnlyLine:
            `[tree-sitter:schedule] parser degraded ${schedulerDegradedCount} segment(s); using fallback chunking for ${relKey}`
        }
      );
    }
    chunkingDiagnostics.scheduledSegmentCount = scheduled.length;
    chunkingDiagnostics.fallbackSegmentCount = fallbackSegments.length;
    chunkingDiagnostics.codeFallbackSegmentCount = codeFallbackSegmentCount;
    chunkingDiagnostics.schedulerMissingCount = schedulerMissingCount;
    chunkingDiagnostics.schedulerDegradedCount = schedulerDegradedCount;

    if (fallbackSegments.length) {
      chunkingDiagnostics.usedHeuristicChunking = true;
      chunkingDiagnostics.usedHeuristicCodeChunking = codeFallbackSegmentCount > 0;
      updateCrashStage('chunking:fallback:start', {
        fallbackSegmentCount: fallbackSegments.length,
        codeFallbackSegmentCount
      });
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
      updateCrashStage('chunking:fallback:done', {
        fallbackSegmentCount: fallbackSegments.length,
        fallbackChunkCount: Array.isArray(fallbackChunks) ? fallbackChunks.length : 0
      });
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
