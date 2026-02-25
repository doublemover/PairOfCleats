import { chunkSegments } from '../../../segments.js';
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
import { TREE_SITTER_LANGUAGE_IDS } from '../../../../lang/tree-sitter/config.js';
import { isTreeSitterEnabled } from '../../../../lang/tree-sitter/options.js';
import { exceedsTreeSitterLimits } from './guardrails.js';

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
  const treeSitterOptions = { treeSitter: treeSitterConfigForMode || {} };
  const schedulerLanguageSet = resolveSchedulerLanguageSet(treeSitterScheduler);

  for (const segment of sourceSegments) {
    if (!segment) continue;
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

    const segmentText = text.slice(segment.start, segment.end);
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
  const schedulerReleaseVirtualPathCaches = treeSitterScheduler
    && typeof treeSitterScheduler.releaseVirtualPathCaches === 'function'
    ? treeSitterScheduler.releaseVirtualPathCaches.bind(treeSitterScheduler)
    : null;
  const schedulerDegradedCheck = treeSitterScheduler
    && typeof treeSitterScheduler.isDegradedVirtualPath === 'function'
    ? treeSitterScheduler.isDegradedVirtualPath.bind(treeSitterScheduler)
    : () => false;
  const schedulerCrashSummary = treeSitterScheduler
    && typeof treeSitterScheduler.getCrashSummary === 'function'
    ? treeSitterScheduler.getCrashSummary()
    : null;
  const degradedVirtualPaths = Array.isArray(schedulerCrashSummary?.degradedVirtualPaths)
    ? schedulerCrashSummary.degradedVirtualPaths
    : [];
  const isDegradedInCrashSummary = (virtualPath) => degradedVirtualPaths.some((candidate) => (
    typeof candidate === 'string'
    && (
      candidate === virtualPath
      || candidate.startsWith(`${virtualPath}#seg:`)
      || virtualPath.startsWith(candidate)
      || (relKey && candidate.includes(relKey))
    )
  ));
  const containerVirtualPath = buildVfsVirtualPath({ containerPath: relKey });
  const containerDegraded = schedulerDegradedCheck(containerVirtualPath)
    || isDegradedInCrashSummary(containerVirtualPath);
  const schedulerLookupItems = [];
  for (const item of scheduled) {
    if (
      containerDegraded
      || schedulerDegradedCheck(item.virtualPath)
      || isDegradedInCrashSummary(item.virtualPath)
    ) {
      fallbackSegments.push(item.segment);
      counters.schedulerDegradedCount += 1;
      counters.codeFallbackSegmentCount += 1;
      continue;
    }
    schedulerLookupItems.push(item);
  }
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
    schedulerDegradedCount: counters.schedulerDegradedCount
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
