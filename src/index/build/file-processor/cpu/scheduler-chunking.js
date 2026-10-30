import { chunkSegments } from '../../../segments.js';
import { readSegmentContent } from '../../../../shared/embedded-content.js';
import {
  resolveSegmentExt,
  resolveSegmentTokenMode,
  shouldIndexSegment
} from '../../../segments/config.js';
import { buildVfsVirtualPath } from '../../../tooling/vfs.js';
import {
  isTreeSitterSchedulerLanguage,
  resolveTreeSitterLanguageForSegment
} from '../tree-sitter.js';
import { LANGUAGE_GRAMMAR_KEYS, TREE_SITTER_LANGUAGE_IDS } from '../../../../lang/tree-sitter/config.js';
import { isTreeSitterEnabled } from '../../../../lang/tree-sitter/options.js';
import { exceedsTreeSitterLimits } from './guardrails.js';
import { createSchedulerDegradationQuery } from '../../tree-sitter-scheduler/degradation.js';

const TREE_SITTER_LANG_IDS = new Set(TREE_SITTER_LANGUAGE_IDS);

/**
 * Build mutable diagnostic counters for scheduler/fallback chunk routing.
 *
 * @param {{treeSitterEnabled:boolean,schedulerRequired:boolean}} input
 * @returns {object}
 */
const createChunkingDiagnostics = ({ treeSitterEnabled, schedulerRequired }) => ({
  treeSitterEnabled,
  schedulerRequired,
  scheduledSegmentCount: 0,
  fallbackSegmentCount: 0,
  codeFallbackSegmentCount: 0,
  schedulerMissingCount: 0,
  schedulerDegradedCount: 0,
  schedulerDegradation: null,
  usedHeuristicChunking: false,
  usedHeuristicCodeChunking: false
});

/**
 * Normalize scheduler language-id capability input to a Set.
 *
 * @param {object|null} treeSitterScheduler
 * @returns {Set<string>|null}
 */
const resolveSchedulerLanguageSet = (treeSitterScheduler) => {
  const schedulerLanguageIds = treeSitterScheduler?.scheduledLanguageIds;
  if (schedulerLanguageIds instanceof Set) return schedulerLanguageIds;
  if (!Array.isArray(schedulerLanguageIds)) return null;
  return new Set(schedulerLanguageIds.filter((languageId) => typeof languageId === 'string' && languageId));
};

const pushFallbackSegment = ({
  segment,
  segmentTokenMode,
  fallbackSegments,
  counters
}) => {
  fallbackSegments.push(segment);
  if (segmentTokenMode === 'code') {
    counters.codeFallbackSegmentCount += 1;
  }
};

const handleMissingScheduledChunks = ({
  treeSitterStrict,
  treeSitterScheduler,
  item,
  fallbackSegments,
  counters,
  logLine,
  mode,
  relKey
}) => {
  const hasScheduledEntry = treeSitterScheduler?.index instanceof Map
    ? treeSitterScheduler.index.has(item.virtualPath)
    : null;
  if (!treeSitterStrict && hasScheduledEntry === false) {
    fallbackSegments.push(item.segment);
    counters.schedulerMissingCount += 1;
    counters.codeFallbackSegmentCount += 1;
    return true;
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
};

/**
 * Chunk a file using scheduler output when available, with deterministic
 * fallback to local heuristic chunking for unsupported/degraded segments.
 *
 * @param {object} input
 * @param {Array<object>} input.segments
 * @param {'code'|'prose'|'records'|'extracted-prose'} input.tokenMode
 * @param {boolean} input.mustUseTreeSitterScheduler
 * @param {boolean} input.treeSitterEnabled
 * @param {object|null} input.treeSitterScheduler
 * @param {object|null} input.treeSitterConfigForMode
 * @param {boolean} input.treeSitterStrict
 * @param {string} input.text
 * @param {string} input.ext
 * @param {string} input.relKey
 * @param {string} input.mode
 * @param {{id?:string}|null} input.lang
 * @param {object|null} input.segmentContext
 * @param {object|null} input.lineIndex
 * @param {(line:string,meta?:object)=>void|null} input.logLine
 * @param {(stage:string,meta?:object)=>void} input.updateCrashStage
 * @returns {Promise<{chunks:Array<object>,chunkingDiagnostics:object}>}
 */
export const chunkWithScheduler = async ({
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
}) => {
  const chunkingDiagnostics = createChunkingDiagnostics({
    treeSitterEnabled,
    schedulerRequired: mustUseTreeSitterScheduler
  });
  const sc = [];
  const fallbackSegments = [];
  const scheduled = [];
  const counters = {
    schedulerMissingCount: 0,
    schedulerDegradedCount: 0,
    codeFallbackSegmentCount: 0
  };
  const sourceSegments = Array.isArray(segments) ? segments : [];
  const contentAdmission = { schemaVersion: 1, state: 'complete', linear: 0, piecewise: 0, unavailable: 0, exclusions: [] };
  for (const segment of sourceSegments) {
    if (segment?.contentUnavailable) {
      contentAdmission.state = 'partial'; contentAdmission.unavailable++;
      if (contentAdmission.exclusions.length < 16) contentAdmission.exclusions.push({ start: segment.start,
        end: segment.end, reason: segment.contentUnavailable });
    } else if (segment?.contentView) {
      if (segment.contentView.pieces.length > 1) contentAdmission.piecewise++;
      else contentAdmission.linear++;
    }
  }
  chunkingDiagnostics.segmentContent = contentAdmission;
  if (contentAdmission.unavailable) logLine?.(`[segments] embedded content unavailable for ${relKey}: ${JSON.stringify(contentAdmission)}`);
  const treeSitterOptions = { treeSitter: treeSitterConfigForMode || {} };
  const schedulerLanguageSet = resolveSchedulerLanguageSet(treeSitterScheduler);

  for (const segment of sourceSegments) {
    if (!segment || segment.contentUnavailable) continue;
    const segmentTokenMode = resolveSegmentTokenMode(segment);
    if (!shouldIndexSegment(segment, segmentTokenMode, tokenMode)) continue;

    if (!mustUseTreeSitterScheduler || segmentTokenMode !== 'code') {
      pushFallbackSegment({
        segment,
        segmentTokenMode,
        fallbackSegments,
        counters
      });
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
      pushFallbackSegment({
        segment,
        segmentTokenMode,
        fallbackSegments,
        counters
      });
      continue;
    }

    const segmentText = readSegmentContent(text, segment);
    if (exceedsTreeSitterLimits({ text: segmentText, languageId: resolvedLang, treeSitterConfig: treeSitterConfigForMode })) {
      pushFallbackSegment({
        segment,
        segmentTokenMode,
        fallbackSegments,
        counters
      });
      continue;
    }

    const segmentUid = segment.segmentUid || null;
    if (!segmentUid) {
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
      effectiveExt: segmentExt,
      segmentStart: segment.start,
      segmentEnd: segment.end
    });
    scheduled.push({
      virtualPath,
      grammarKey: LANGUAGE_GRAMMAR_KEYS?.[resolvedLang] || null,
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
  const schedulerReleaseVirtualPathCaches = treeSitterScheduler
    && typeof treeSitterScheduler.releaseVirtualPathCaches === 'function'
    ? treeSitterScheduler.releaseVirtualPathCaches.bind(treeSitterScheduler)
    : null;
  const schedulerCrashSummary = typeof treeSitterScheduler?.getCrashSummary === 'function'
    ? treeSitterScheduler.getCrashSummary() : {};
  const degradation = typeof treeSitterScheduler?.queryDegradation === 'function'
    ? { query: treeSitterScheduler.queryDegradation.bind(treeSitterScheduler),
      unknown: schedulerCrashSummary?.degradation?.unknown || [] }
    : createSchedulerDegradationQuery(schedulerCrashSummary || {}, {
      legacyExactCheck: typeof treeSitterScheduler?.isDegradedVirtualPath === 'function'
        ? treeSitterScheduler.isDegradedVirtualPath.bind(treeSitterScheduler) : null
    });
  const scopeCounts = { grammar: 0, container: 0, segment: 0 };
  const decisions = [];
  const schedulerLookupItems = [];
  for (const item of scheduled) {
    const decision = degradation.query({ virtualPath: item.virtualPath, grammarKey: item.grammarKey });
    if (decision.degraded) {
      fallbackSegments.push(item.segment);
      counters.schedulerDegradedCount += 1;
      counters.codeFallbackSegmentCount += 1;
      scopeCounts[decision.scope] += 1;
      if (decisions.length < 16) decisions.push({ scope: decision.scope, reason: decision.reason,
        grammarKey: item.grammarKey, segmentUid: item.segment.segmentUid,
        start: item.segment.start, end: item.segment.end });
      continue;
    }
    schedulerLookupItems.push(item);
  }
  chunkingDiagnostics.schedulerDegradation = { schemaVersion: 1, scopeCounts,
    unknownReceipts: degradation.unknown.length, decisions,
    omittedDecisions: Math.max(0, counters.schedulerDegradedCount - decisions.length) };
  const releaseSchedulerLookupCaches = () => {
    if (!schedulerReleaseVirtualPathCaches || !schedulerLookupItems.length) return;
    for (const item of schedulerLookupItems) {
      try {
        schedulerReleaseVirtualPathCaches(item.virtualPath);
      } catch {}
    }
  };
  updateCrashStage('chunking:scheduler:plan', {
    scheduledSegmentCount: scheduled.length,
    schedulerLookupItems: schedulerLookupItems.length,
    fallbackSegmentCount: fallbackSegments.length,
    schedulerDegradedCount: counters.schedulerDegradedCount,
    schedulerDegradation: chunkingDiagnostics.schedulerDegradation
  });
  try {
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
          if (handleMissingScheduledChunks({
            treeSitterStrict,
            treeSitterScheduler,
            item,
            fallbackSegments,
            counters,
            logLine,
            mode,
            relKey
          })) {
            continue;
          }
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
          counters.codeFallbackSegmentCount += 1;
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
          if (handleMissingScheduledChunks({
            treeSitterStrict,
            treeSitterScheduler,
            item,
            fallbackSegments,
            counters,
            logLine,
            mode,
            relKey
          })) {
            continue;
          }
        }
        sc.push(...chunks);
      }
    }
  } finally {
    releaseSchedulerLookupCaches();
  }

  if (counters.schedulerMissingCount > 0) {
    logLine?.(
      `[tree-sitter:schedule] scheduler missed ${counters.schedulerMissingCount} segment(s); using fallback chunking.`,
      {
        kind: 'warn',
        mode,
        stage: 'processing',
        file: relKey,
        substage: 'chunking',
        fileOnlyLine:
          `[tree-sitter:schedule] scheduler missing ${counters.schedulerMissingCount} segment(s); using fallback chunking for ${relKey}`
      }
    );
  }
  if (counters.schedulerDegradedCount > 0) {
    logLine?.(
      `[tree-sitter:schedule] parser crash degraded ${counters.schedulerDegradedCount} scheduled segment(s); using fallback chunking.`,
      {
        kind: 'warning',
        mode,
        stage: 'processing',
        file: relKey,
        substage: 'chunking',
        fileOnlyLine:
          `[tree-sitter:schedule] parser degraded ${counters.schedulerDegradedCount} segment(s); using fallback chunking for ${relKey}`
      }
    );
  }
  chunkingDiagnostics.scheduledSegmentCount = scheduled.length;
  chunkingDiagnostics.fallbackSegmentCount = fallbackSegments.length;
  chunkingDiagnostics.codeFallbackSegmentCount = counters.codeFallbackSegmentCount;
  chunkingDiagnostics.schedulerMissingCount = counters.schedulerMissingCount;
  chunkingDiagnostics.schedulerDegradedCount = counters.schedulerDegradedCount;

  if (fallbackSegments.length) {
    chunkingDiagnostics.usedHeuristicChunking = true;
    chunkingDiagnostics.usedHeuristicCodeChunking = counters.codeFallbackSegmentCount > 0;
    updateCrashStage('chunking:fallback:start', {
      fallbackSegmentCount: fallbackSegments.length,
      codeFallbackSegmentCount: counters.codeFallbackSegmentCount
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

  return { chunks: sc, chunkingDiagnostics };
};
