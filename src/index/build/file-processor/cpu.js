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
import { shouldSkipTreeSitterPlanningForPath } from '../tree-sitter-scheduler/policy.js';
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

const normalizeScmPath = (relPath) => String(relPath || '').replace(/\\/g, '/').toLowerCase();
const toBoundedScmPath = (relPath) => {
  const normalized = normalizeScmPath(relPath);
  return `/${normalized.replace(/^\/+|\/+$/g, '')}/`;
};

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

const shouldForceScmTimeoutCaps = (relPath) => {
  const boundedPath = toBoundedScmPath(relPath);
  for (const part of SCM_FORCE_TIMEOUT_CAP_PATH_PARTS) {
    if (boundedPath.includes(part)) return true;
  }
  return false;
};

const isHeavyRelationsPath = (relPath) => {
  const boundedPath = toBoundedScmPath(relPath);
  for (const part of HEAVY_RELATIONS_PATH_PARTS) {
    if (boundedPath.includes(part)) return true;
  }
  return false;
};

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
  const legacyScmIncludeChurn = typeof scmConfig?.includeChurn === 'boolean'
    ? scmConfig.includeChurn
    : (typeof scmConfig?.meta?.includeChurn === 'boolean' ? scmConfig.meta.includeChurn : null);
  const resolvedGitChurnEnabled = typeof analysisPolicy?.git?.churn === 'boolean'
    ? analysisPolicy.git.churn
    : (legacyScmIncludeChurn ?? true);
  updateCrashStage('scm-meta', { blame: resolvedGitBlameEnabled });
  const scmStart = Date.now();
  let lineAuthors = null;
  let fileGitMeta = {};
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
  let scmMetaUnavailableReason = null;
  if (!skipScmForProseRoute && scmActive && filePosix) {
    const includeChurn = resolvedGitChurnEnabled
      && !scmFastPath
      && (fileStat?.size ?? 0) <= SCM_CHURN_MAX_BYTES;
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
    } else if (
      typeof scmProviderImpl.getFileMeta === 'function'
      && (!snapshotMeta || snapshotMissingRequestedChurn)
    ) {
      await runScmTask(async () => {
        const fileMeta = await Promise.resolve(scmProviderImpl.getFileMeta({
          repoRoot: scmRepoRoot,
          filePosix,
          timeoutMs: Math.max(0, metaTimeoutMs),
          includeChurn
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
        } else {
          const reason = String(fileMeta?.reason || '').toLowerCase();
          if (reason === 'timeout' || reason === 'unavailable') {
            scmMetaUnavailableReason = reason;
          }
        }
      });
    }
    if (
      resolvedGitBlameEnabled
      && !skipScmAnnotateForProseRoute
      && !skipScmAnnotateForProseMode
      && !skipScmAnnotateForGeneratedPython
      && scmMetaUnavailableReason == null
      && typeof scmProviderImpl.annotate === 'function'
    ) {
      await runScmTask(async () => {
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
              : 2000);
          annotateTimeoutMs = Math.min(annotateTimeoutMs, annotateCapMs);
        }
        const withinAnnotateCap = maxAnnotateBytes == null
          || (fileStat?.size ?? 0) <= maxAnnotateBytes;
        if (!withinAnnotateCap) return;
        const timeoutMs = Math.max(0, annotateTimeoutMs);
        const controller = new AbortController();
        let timeoutId = null;
        if (timeoutMs > 0) {
          timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        }
        try {
          const annotateResult = await Promise.resolve(scmProviderImpl.annotate({
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
          lineAuthors = buildLineAuthors(
            controller.signal.aborted ? { ok: false, reason: 'timeout' } : annotateResult
          );
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      });
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
  updateCrashStage('chunking');
  try {
    const fallbackSegments = [];
    const scheduled = [];
    let schedulerMissingCount = 0;
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
      const schedulerSupportsLanguage = !schedulerLanguageSet || schedulerLanguageSet.has(resolvedLang);
      const canUseTreeSitter = resolvedLang
        && TREE_SITTER_LANG_IDS.has(resolvedLang)
        && isTreeSitterSchedulerLanguage(resolvedLang)
        && schedulerSupportsLanguage
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
    const batchChunks = scheduled.length > 0
      && schedulerLoadChunksBatch
      ? await schedulerLoadChunksBatch(
        scheduled.map((item) => item.virtualPath),
        schedulerLoadOptions
      )
      : null;
    if (Array.isArray(batchChunks) && batchChunks.length === scheduled.length) {
      for (let i = 0; i < scheduled.length; i += 1) {
        const item = scheduled[i];
        const chunks = batchChunks[i];
        if (!Array.isArray(chunks) || !chunks.length) {
          const hasScheduledEntry = treeSitterScheduler?.index instanceof Map
            ? treeSitterScheduler.index.has(item.virtualPath)
            : null;
          if (!treeSitterStrict && hasScheduledEntry === false) {
            fallbackSegments.push(item.segment);
            schedulerMissingCount += 1;
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
      for (const item of scheduled) {
        if (!loadChunk) {
          fallbackSegments.push(item.segment);
          continue;
        }
        const chunks = await loadChunk(item.virtualPath);
        if (!Array.isArray(chunks) || !chunks.length) {
          const hasScheduledEntry = treeSitterScheduler?.index instanceof Map
            ? treeSitterScheduler.index.has(item.virtualPath)
            : null;
          if (!treeSitterStrict && hasScheduledEntry === false) {
            fallbackSegments.push(item.segment);
            schedulerMissingCount += 1;
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
    failFile,
    buildStage
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
