import { shouldSkipTreeSitterPlanningForPath } from '../../tree-sitter-scheduler/policy.js';
import { toFiniteNonNegativeInt } from './guardrails.js';

/**
 * Load preplanned scheduler segments defensively.
 * Scheduler failures must not block fallback chunking.
 *
 * @param {object|null} treeSitterScheduler
 * @param {string} relKey
 * @returns {Array<object>|null}
 */
const loadSchedulerPlannedSegments = (treeSitterScheduler, relKey) => {
  if (!treeSitterScheduler || typeof treeSitterScheduler.loadPlannedSegments !== 'function') {
    return null;
  }
  try {
    return treeSitterScheduler.loadPlannedSegments(relKey);
  } catch {
    return null;
  }
};

export const resolveFileParsePolicy = ({
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
}) => {
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
  const schedulerPlannedSegments = treeSitterEnabled
    ? loadSchedulerPlannedSegments(treeSitterScheduler, relKey)
    : null;
  const hasSchedulerPlannedSegments = Array.isArray(schedulerPlannedSegments)
    && schedulerPlannedSegments.length > 0;
  const contextTreeSitterConfig = treeSitterLanguagePasses
    ? { ...(treeSitterConfigForMode || {}), enabled: false }
    : treeSitterConfigForMode;
  const fileLineCountHint = toFiniteNonNegativeInt(fileEntry?.lines);
  const languageContextBase = {
    relationsEnabled,
    metricsCollector,
    filePath: abs,
    fileSizeBytes: fileStat?.size ?? null,
    fileLineCountHint,
    // When scheduler chunks are already planned, stage1 can skip language-level
    // prepare passes and avoid duplicate parser work on large files.
    skipPrepare: hasSchedulerPlannedSegments && mode === 'code' && relationsEnabled !== true,
    treeSitter: contextTreeSitterConfig
  };
  const languageContextOptions = languageOptions && typeof languageOptions === 'object'
    ? { ...languageOptions, ...languageContextBase }
    : languageContextBase;
  const shouldSerializeLanguageContext = treeSitterEnabled && treeSitterLanguagePasses === false;
  return {
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
  };
};
