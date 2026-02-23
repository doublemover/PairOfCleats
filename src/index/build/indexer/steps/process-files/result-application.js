import { fileExt } from '../../../../../shared/files.js';
import { recordFileMetric } from '../../../perf-profile.js';
import { createVfsManifestCollector } from '../../../vfs-manifest-collector.js';
import { resolveFileLifecycleDurations } from './watchdog.js';
import { clampDurationMs, toIsoTimestamp } from './watchdog-policy.js';

/**
 * Resolve the lifecycle row that should receive write timestamps for a result.
 *
 * Sequencing detail:
 * `runWithQueue` `onResult` may map `relKey -> orderIndex` before ordered
 * flush runs. Prefer that map over `result.orderIndex` so retries/late writes
 * still attach metrics to the deterministic output slot.
 *
 * @param {{
 *  result:object,
 *  shardMeta?:object|null,
 *  lifecycleByRelKey:Map<string,number>,
 *  ensureLifecycleRecord:Function
 * }} input
 * @returns {object|null}
 */
export const resolveResultLifecycleRecord = ({
  result,
  shardMeta = null,
  lifecycleByRelKey,
  ensureLifecycleRecord
}) => {
  if (!result || typeof result !== 'object') return null;
  const fromRelKey = result.relKey && lifecycleByRelKey.has(result.relKey)
    ? lifecycleByRelKey.get(result.relKey)
    : null;
  const fromOrderIndex = Number.isFinite(result?.orderIndex)
    ? Math.floor(result.orderIndex)
    : null;
  const resolvedOrderIndex = Number.isFinite(fromRelKey)
    ? fromRelKey
    : (Number.isFinite(fromOrderIndex) ? fromOrderIndex : null);
  if (!Number.isFinite(resolvedOrderIndex)) return null;
  return ensureLifecycleRecord({
    orderIndex: resolvedOrderIndex,
    file: result.relKey || result.abs || null,
    fileIndex: result.fileIndex,
    shardId: shardMeta?.id || null
  });
};

/**
 * Create ordered stage1 result applier that merges one file result into state.
 *
 * Sequencing detail:
 * The returned callback runs at ordered flush time, not parse completion time.
 * `writeStartAtMs` is captured immediately before state mutations and
 * `writeEndAtMs` after all appends, so watchdog write durations represent
 * deterministic commit time inside ordered/postings backpressure.
 *
 * @param {{
 *  appendChunkWithRetention:Function,
 *  ensureLifecycleRecord:Function,
 *  incrementalState:object,
 *  lifecycleByOrderIndex:Map<number,object>,
 *  lifecycleByRelKey:Map<string,number>,
 *  log:Function,
 *  perfProfile:object,
 *  runtime:object,
 *  sharedState:object
 * }} input
 * @returns {(result:object,stateRef:object,shardMeta?:object|null)=>Promise<void>}
 */
export const createStage1FileResultApplier = ({
  appendChunkWithRetention,
  ensureLifecycleRecord,
  incrementalState,
  lifecycleByOrderIndex,
  lifecycleByRelKey,
  log,
  perfProfile,
  runtime,
  sharedState
}) => {
  /**
   * Merge one file-processing result into stage state and write pipelines.
   *
   * @param {object} result
   * @param {object} stateRef
   * @param {object|null} [shardMeta]
   * @returns {Promise<void>}
   */
  const applyFileResult = async (result, stateRef, shardMeta = null) => {
    if (!result) return;
    const lifecycle = resolveResultLifecycleRecord({
      result,
      shardMeta,
      lifecycleByRelKey,
      ensureLifecycleRecord
    });
    if (lifecycle && !Number.isFinite(lifecycle.writeStartAtMs)) {
      lifecycle.writeStartAtMs = Date.now();
    }
    if (result.fileMetrics) {
      recordFileMetric(perfProfile, result.fileMetrics);
    }
    for (const chunk of result.chunks) {
      appendChunkWithRetention(stateRef, chunk, sharedState);
    }
    if (result.manifestEntry) {
      if (shardMeta?.id) result.manifestEntry.shard = shardMeta.id;
      incrementalState.manifest.files[result.relKey] = result.manifestEntry;
    }
    if (result.fileInfo && result.relKey) {
      if (!stateRef.fileInfoByPath) stateRef.fileInfoByPath = new Map();
      stateRef.fileInfoByPath.set(result.relKey, result.fileInfo);
    }
    if (result.relKey && Array.isArray(result.chunks) && result.chunks.length) {
      if (!stateRef.fileDetailsByPath) stateRef.fileDetailsByPath = new Map();
      if (!stateRef.fileDetailsByPath.has(result.relKey)) {
        const first = result.chunks[0] || {};
        const info = result.fileInfo || {};
        stateRef.fileDetailsByPath.set(result.relKey, {
          file: result.relKey,
          ext: first.ext || fileExt(result.relKey),
          size: Number.isFinite(info.size) ? info.size : (Number.isFinite(first.fileSize) ? first.fileSize : null),
          hash: info.hash || first.fileHash || null,
          hashAlgo: info.hashAlgo || first.fileHashAlgo || null,
          externalDocs: first.externalDocs || null,
          last_modified: first.last_modified || null,
          last_author: first.last_author || null,
          churn: first.churn || null,
          churn_added: first.churn_added || null,
          churn_deleted: first.churn_deleted || null,
          churn_commits: first.churn_commits || null
        });
      }
    }
    if (Array.isArray(result.chunks) && result.chunks.length) {
      if (!stateRef.chunkUidToFile) stateRef.chunkUidToFile = new Map();
      for (const chunk of result.chunks) {
        const chunkUid = chunk?.chunkUid || chunk?.metaV2?.chunkUid || null;
        if (!chunkUid || stateRef.chunkUidToFile.has(chunkUid)) continue;
        stateRef.chunkUidToFile.set(chunkUid, result.relKey);
      }
    }
    if (result.fileRelations) {
      stateRef.fileRelations.set(result.relKey, result.fileRelations);
    }
    if (result.lexiconFilterStats && result.relKey) {
      if (!stateRef.lexiconRelationFilterByFile) {
        stateRef.lexiconRelationFilterByFile = new Map();
      }
      stateRef.lexiconRelationFilterByFile.set(result.relKey, {
        ...result.lexiconFilterStats,
        file: result.relKey
      });
    }
    if (Array.isArray(result.vfsManifestRows) && result.vfsManifestRows.length) {
      if (!stateRef.vfsManifestCollector) {
        stateRef.vfsManifestCollector = createVfsManifestCollector({
          buildRoot: runtime.buildRoot || runtime.root,
          log
        });
        stateRef.vfsManifestRows = null;
        stateRef.vfsManifestStats = stateRef.vfsManifestCollector.stats;
      }
      await stateRef.vfsManifestCollector.appendRows(result.vfsManifestRows, { log });
    }
    if (lifecycle) {
      lifecycle.writeEndAtMs = Date.now();
    }
    const lifecycleDurations = lifecycle ? resolveFileLifecycleDurations(lifecycle) : null;
    stateRef.scannedFilesTimes.push({
      file: result.abs,
      duration_ms: clampDurationMs(result.durationMs),
      cached: result.cached,
      ...(lifecycle
        ? {
          lifecycle: {
            enqueuedAt: toIsoTimestamp(lifecycle.enqueuedAtMs),
            dequeuedAt: toIsoTimestamp(lifecycle.dequeuedAtMs),
            parseStartAt: toIsoTimestamp(lifecycle.parseStartAtMs),
            parseEndAt: toIsoTimestamp(lifecycle.parseEndAtMs),
            writeStartAt: toIsoTimestamp(lifecycle.writeStartAtMs),
            writeEndAt: toIsoTimestamp(lifecycle.writeEndAtMs)
          },
          queue_delay_ms: lifecycleDurations?.queueDelayMs || 0,
          active_duration_ms: lifecycleDurations?.activeDurationMs || 0,
          write_duration_ms: lifecycleDurations?.writeDurationMs || 0
        }
        : {})
    });
    stateRef.scannedFiles.push(result.abs);
    if (result.relKey && Number.isFinite(lifecycle?.orderIndex)) {
      lifecycleByRelKey.delete(result.relKey);
    }
    if (Number.isFinite(lifecycle?.orderIndex)) {
      lifecycleByOrderIndex.delete(lifecycle.orderIndex);
    }
  };
  return applyFileResult;
};
