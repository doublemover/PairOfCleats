import path from 'node:path';
import { toPosix } from '../../../../../shared/files.js';
import { resolveEntryOrderIndex, sortEntriesByOrderIndex } from './ordering.js';

/**
 * Resolve deterministic path key for one batch entry.
 *
 * @param {object} entry
 * @param {string} root
 * @returns {string}
 */
const resolveEntryRel = (entry, root) => {
  if (typeof entry?.rel === 'string' && entry.rel) return entry.rel;
  const absolutePath = typeof entry?.abs === 'string' ? entry.abs : '';
  if (!absolutePath) return '';
  const relative = typeof root === 'string' && root
    ? path.relative(root, absolutePath)
    : absolutePath;
  return toPosix(relative);
};

/**
 * Resolve stable file index for one batch entry.
 *
 * @param {object} entry
 * @param {number} fallbackIndex
 * @returns {number|null}
 */
const resolveEntryFileIndex = (entry, fallbackIndex) => {
  if (Number.isFinite(entry?.fileIndex)) return Math.floor(entry.fileIndex);
  if (Number.isFinite(fallbackIndex)) return Math.max(1, Math.floor(fallbackIndex) + 1);
  return null;
};

/**
 * Build one ordered queue batch plan with precomputed per-entry metadata.
 *
 * Subtle sequencing/watchdog behavior:
 * - `enqueuedAtMs` is stamped before queue dispatch starts so queue-delay
 *   telemetry includes ordered-appender backpressure wait time, but excludes
 *   parse/write stages.
 * - Metadata is anchored to deterministic order slots; retries and watchdog
 *   snapshots can reuse the same `orderIndex`/`rel` identity without
 *   recomputing path or order lookups in hot callbacks.
 *
 * Throughput note:
 * This removes repeated `resolveEntryOrderIndex` and `path.relative` work from
 * `runWithQueue` callback paths (`worker`, `onResult`, `onError`), reducing
 * per-file callback overhead for large batches.
 *
 * @param {{
 *   entries:object[],
 *   root:string,
 *   shardId?:string|null,
 *   ensureLifecycleRecord?:(input:{orderIndex:number|null,file:string|null,fileIndex:number|null,shardId:string|null})=>object|null,
 *   nowMs?:()=>number
 * }} input
 * @returns {{
 *   orderedEntries:object[],
 *   metadataByIndex:Array<{entry:object,orderIndex:number|null,rel:string,fileIndex:number|null,shardId:string|null}>
 * }}
 */
export const buildStage1BatchExecutionPlan = ({
  entries,
  root,
  shardId = null,
  ensureLifecycleRecord = null,
  nowMs = () => Date.now()
}) => {
  const orderedEntries = sortEntriesByOrderIndex(Array.isArray(entries) ? entries : []);
  const metadataByIndex = new Array(orderedEntries.length);
  const normalizedShardId = typeof shardId === 'string' && shardId ? shardId : null;
  const timestampFn = typeof nowMs === 'function' ? nowMs : () => Date.now();
  for (let i = 0; i < orderedEntries.length; i += 1) {
    const entry = orderedEntries[i];
    const rawOrderIndex = resolveEntryOrderIndex(entry, i);
    const orderIndex = Number.isFinite(rawOrderIndex) ? Math.floor(rawOrderIndex) : null;
    const rel = resolveEntryRel(entry, root);
    const fileIndex = resolveEntryFileIndex(entry, i);
    const metadata = {
      entry,
      orderIndex,
      rel,
      fileIndex,
      shardId: normalizedShardId
    };
    metadataByIndex[i] = metadata;
    if (typeof ensureLifecycleRecord !== 'function') continue;
    const lifecycle = ensureLifecycleRecord({
      orderIndex,
      file: rel || null,
      fileIndex,
      shardId: normalizedShardId
    });
    if (lifecycle && !Number.isFinite(lifecycle.enqueuedAtMs)) {
      lifecycle.enqueuedAtMs = timestampFn();
    }
  }
  return {
    orderedEntries,
    metadataByIndex
  };
};

/**
 * Resolve precomputed entry metadata by queue callback index.
 *
 * @param {{
 *   metadataByIndex:Array<{entry:object,orderIndex:number|null,rel:string,fileIndex:number|null,shardId:string|null}>,
 *   entryIndex:number,
 *   entry:object,
 *   root:string,
 *   shardId?:string|null
 * }} input
 * @returns {{entry:object,orderIndex:number|null,rel:string,fileIndex:number|null,shardId:string|null}}
 */
export const resolveStage1BatchEntryMeta = ({
  metadataByIndex,
  entryIndex,
  entry,
  root,
  shardId = null
}) => {
  const normalizedEntryIndex = Number.isFinite(entryIndex)
    ? Math.max(0, Math.floor(entryIndex))
    : 0;
  const precomputed = Array.isArray(metadataByIndex)
    ? metadataByIndex[normalizedEntryIndex]
    : null;
  if (precomputed && typeof precomputed === 'object') {
    return precomputed;
  }
  const fallbackEntry = entry && typeof entry === 'object' ? entry : {};
  const rawOrderIndex = resolveEntryOrderIndex(fallbackEntry, normalizedEntryIndex);
  const orderIndex = Number.isFinite(rawOrderIndex) ? Math.floor(rawOrderIndex) : null;
  return {
    entry: fallbackEntry,
    orderIndex,
    rel: resolveEntryRel(fallbackEntry, root),
    fileIndex: resolveEntryFileIndex(fallbackEntry, normalizedEntryIndex),
    shardId: typeof shardId === 'string' && shardId ? shardId : null
  };
};

/**
 * Decide if queue dispatch should block on ordered-appender capacity.
 *
 * Sequencing detail:
 * We intentionally probe only every `bypassWindow` entries to avoid a
 * per-dispatch await hotspot. This keeps throughput high while still bounding
 * pending ordered results during prolonged out-of-order execution.
 *
 * @param {{
 *   entryIndex:number,
 *   orderIndex:number|null,
 *   nextOrderedIndex:number|null,
 *   bypassWindow:number
 * }} input
 * @returns {boolean}
 */
export const shouldWaitForOrderedDispatchCapacity = ({
  entryIndex,
  orderIndex,
  nextOrderedIndex,
  bypassWindow
}) => {
  const normalizedBypassWindow = Number.isFinite(bypassWindow)
    ? Math.max(1, Math.floor(bypassWindow))
    : 1;
  const normalizedEntryIndex = Number.isFinite(entryIndex)
    ? Math.max(0, Math.floor(entryIndex))
    : 0;
  const shouldProbeCapacity = normalizedEntryIndex === 0
    || (normalizedEntryIndex % normalizedBypassWindow) === 0;
  if (!shouldProbeCapacity) return false;
  if (Number.isFinite(orderIndex) && Number.isFinite(nextOrderedIndex)) {
    return Math.floor(orderIndex) > (Math.floor(nextOrderedIndex) + normalizedBypassWindow);
  }
  return true;
};
