import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createGunzip, createZstdDecompress } from 'node:zlib';
import { MAX_JSON_BYTES } from '../constants.js';
import { cleanupBak, getBakPath } from '../cache.js';
import {
  collectCompressedJsonlCandidates,
  decompressBuffer,
  detectCompression,
  readBuffer
} from '../compression.js';
import {
  parseJsonlBufferEntries,
  parseJsonlStreamEntries
} from './line-scan.js';
import { createRowQueue } from './row-queue.js';
import {
  canUseFallbackAfterPrimaryError,
  captureFallbackReadError,
  resolvePreferredReadError
} from './fallback.js';
import {
  resolveJsonlReadPlan,
  resolveOptionalZstd,
  SMALL_JSONL_BYTES,
  ZSTD_STREAM_THRESHOLD
} from './read-plan.js';
import {
  shouldAbortForHeap,
  toJsonTooLargeError
} from '../limits.js';
import { hasArtifactReadObserver, recordArtifactRead } from '../telemetry.js';

const recordJsonlRead = ({
  shouldMeasure,
  start,
  path,
  compression,
  rawBytes,
  bytes,
  rows
}) => {
  if (!shouldMeasure) return;
  recordArtifactRead({
    path,
    format: 'jsonl',
    compression,
    rawBytes,
    bytes,
    rows,
    durationMs: performance.now() - start
  });
};

const readBufferedJsonlEntries = ({
  sourcePath,
  buffer,
  maxBytes,
  requiredKeys,
  validationMode
}) => parseJsonlBufferEntries(buffer, sourcePath, {
  maxBytes,
  requiredKeys,
  validationMode
});

const readStreamJsonlEntries = async ({
  sourcePath,
  stream,
  maxBytes,
  requiredKeys,
  validationMode,
  onEntry
}) => parseJsonlStreamEntries(stream, {
  targetPath: sourcePath,
  maxBytes,
  requiredKeys,
  validationMode,
  onEntry
});

const readJsonlIteratorSingle = async function* (
  targetPath,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys,
    validationMode = 'strict',
    maxInFlight = 0,
    onBackpressure = null,
    onResume = null,
    byteRange = null,
    recoveryFallback = false
  } = {}
) {
  const shouldMeasure = hasArtifactReadObserver();
  const start = shouldMeasure ? performance.now() : 0;
  let rows = 0;
  let bytes = 0;
  let rawBytes = null;
  let compression = null;
  let cleanup = null;
  let stream = null;
  const destroyStream = () => {
    if (!stream) return;
    try {
      stream.destroy();
    } catch {}
    stream = null;
  };
  let sourcePath = targetPath;
  const queue = createRowQueue({
    maxPending: maxInFlight,
    onBackpressure,
    onResume
  });

  const producer = (async () => {
    try {
      const hasRange = byteRange && Number.isFinite(byteRange.start) && Number.isFinite(byteRange.end);
      const range = hasRange
        ? { start: Math.max(0, byteRange.start), end: Math.max(0, byteRange.end - 1) }
        : null;
      const sources = [
        {
          path: targetPath,
          compression: detectCompression(targetPath),
          cleanup: true
        },
        ...(!hasRange && targetPath.endsWith('.jsonl')
          ? collectCompressedJsonlCandidates(targetPath)
          : []),
        {
          path: getBakPath(targetPath),
          compression: detectCompression(getBakPath(targetPath)),
          cleanup: false
        }
      ];
      let primaryErr = null;
      let fallbackEnabled = true;
      let fallbackErr = null;
      let lastErr = null;
      for (let index = 0; index < sources.length; index += 1) {
        const candidate = sources[index];
        if (index > 0 && !fallbackEnabled) break;
        let emittedForCandidate = 0;
        const pushEntry = async (entry) => {
          emittedForCandidate += 1;
          await queue.push(entry);
        };
        try {
          sourcePath = candidate.path;
          compression = candidate.compression ?? detectCompression(candidate.path);
          cleanup = candidate.cleanup;
          if (range && compression) {
            throw new Error(
              `[artifact-io] byteRange requires an uncompressed JSONL source: ${sourcePath}`
            );
          }
          const stat = fs.statSync(sourcePath);
          rawBytes = stat.size;
          if (stat.size > maxBytes) {
            throw toJsonTooLargeError(sourcePath, stat.size);
          }
          const plan = resolveJsonlReadPlan(stat.size);
          if (!range && (plan.smallFile || (compression === 'gzip' && stat.size <= SMALL_JSONL_BYTES))) {
            if (compression === 'gzip') {
              const buffer = readBuffer(sourcePath, maxBytes);
              const decompressed = decompressBuffer(buffer, 'gzip', maxBytes, sourcePath);
              const parsed = readBufferedJsonlEntries({
                sourcePath,
                buffer: decompressed,
                maxBytes,
                requiredKeys,
                validationMode
              });
              rows = parsed.entries.length;
              bytes = parsed.bytes;
              for (const entry of parsed.entries) {
                await pushEntry(entry);
              }
              if (cleanup) cleanupBak(sourcePath);
              queue.finish();
              recordJsonlRead({
                shouldMeasure,
                start,
                path: sourcePath,
                compression,
                rawBytes: rawBytes ?? bytes,
                bytes,
                rows
              });
              return;
            }
            if (!compression) {
              const buffer = readBuffer(sourcePath, maxBytes);
              const parsed = readBufferedJsonlEntries({
                sourcePath,
                buffer,
                maxBytes,
                requiredKeys,
                validationMode
              });
              rows = parsed.entries.length;
              bytes = parsed.bytes;
              for (const entry of parsed.entries) {
                await pushEntry(entry);
              }
              if (cleanup) cleanupBak(sourcePath);
              queue.finish();
              recordJsonlRead({
                shouldMeasure,
                start,
                path: sourcePath,
                compression,
                rawBytes: rawBytes ?? bytes,
                bytes,
                rows
              });
              return;
            }
          }
          stream = fs.createReadStream(sourcePath, range || undefined);
          if (compression === 'gzip') {
            const gunzip = createGunzip();
            stream = stream.pipe(gunzip);
          } else if (compression === 'zstd') {
            const zstd = resolveOptionalZstd();
            if (zstd && rawBytes <= ZSTD_STREAM_THRESHOLD) {
              const buffer = readBuffer(sourcePath, maxBytes);
              const decoded = await zstd.decompress(buffer);
              const payload = Buffer.isBuffer(decoded) ? decoded : Buffer.from(decoded);
              if (payload.length > maxBytes || shouldAbortForHeap(payload.length)) {
                throw toJsonTooLargeError(sourcePath, payload.length);
              }
              const parsed = readBufferedJsonlEntries({
                sourcePath,
                buffer: payload,
                maxBytes,
                requiredKeys,
                validationMode
              });
              rows = parsed.entries.length;
              bytes = parsed.bytes;
              for (const entry of parsed.entries) {
                await pushEntry(entry);
              }
              if (cleanup) cleanupBak(sourcePath);
              queue.finish();
              recordJsonlRead({
                shouldMeasure,
                start,
                path: sourcePath,
                compression,
                rawBytes: rawBytes ?? bytes,
                bytes,
                rows
              });
              return;
            }
            const zstdStream = createZstdDecompress();
            stream = stream.pipe(zstdStream);
          }
          break;
        } catch (err) {
          if (emittedForCandidate > 0) {
            throw err;
          }
          if (index === 0) {
            primaryErr = err;
            fallbackEnabled = canUseFallbackAfterPrimaryError(primaryErr, recoveryFallback);
            if (!fallbackEnabled) {
              throw primaryErr;
            }
          } else {
            fallbackErr = captureFallbackReadError(fallbackErr, err);
          }
          lastErr = err;
          destroyStream();
        }
      }
      if (!stream) {
        const preferredErr = resolvePreferredReadError(primaryErr, fallbackErr);
        throw preferredErr || lastErr || primaryErr || new Error(`Missing JSONL artifact: ${targetPath}`);
      }
      ({ rows, bytes } = await readStreamJsonlEntries({
        sourcePath,
        stream,
        maxBytes,
        requiredKeys,
        validationMode,
        onEntry: async (entry) => {
          await queue.push(entry);
        }
      }));
      if (cleanup) cleanupBak(sourcePath);
      queue.finish();
      recordJsonlRead({
        shouldMeasure,
        start,
        path: sourcePath,
        compression,
        rawBytes: rawBytes ?? bytes,
        bytes,
        rows
      });
    } catch (err) {
      queue.finish(err);
    } finally {
      destroyStream();
    }
  })();

  try {
    for await (const entry of queue.iterator()) {
      yield entry;
    }
  } finally {
    queue.cancel();
    destroyStream();
    await producer.catch(() => {});
  }
};

/**
 * Create an async iterator over one or more JSONL sources.
 *
 * @param {string|string[]} filePath
 * @param {{
 *   maxBytes?: number,
 *   requiredKeys?: string[]|null,
 *   validationMode?: 'strict'|'trusted',
 *   maxInFlight?: number,
 *   onBackpressure?: ((pending:number) => void)|null,
 *   onResume?: ((pending:number) => void)|null,
 *   byteRange?: {start:number,end:number}|null,
 *   recoveryFallback?:boolean
 * }} [options]
 * @returns {AsyncGenerator<any, void, unknown>}
 */
export const readJsonLinesIterator = function (filePath, options = {}) {
  const paths = Array.isArray(filePath) ? filePath : [filePath];
  return (async function* () {
    for (const sourcePath of paths) {
      yield* readJsonlIteratorSingle(sourcePath, options);
    }
  })();
};

/**
 * Iterate JSONL rows and await `onEntry` serially for each parsed row.
 *
 * @param {string|string[]} filePath
 * @param {(entry:any)=>Promise<void>|void} onEntry
 * @param {{
 *   maxBytes?: number,
 *   requiredKeys?: string[]|null,
 *   validationMode?: 'strict'|'trusted',
 *   recoveryFallback?:boolean
 * }} [options]
 * @returns {Promise<void>}
 */
export const readJsonLinesEachAwait = async (
  filePath,
  onEntry,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
    validationMode = 'strict',
    recoveryFallback = false
  } = {}
) => {
  if (typeof onEntry !== 'function') return;
  for await (const entry of readJsonLinesIterator(filePath, {
    maxBytes,
    requiredKeys,
    validationMode,
    recoveryFallback
  })) {
    await onEntry(entry);
  }
};

/**
 * Stream JSONL entries and invoke `onEntry` for each parsed row.
 *
 * @param {string|string[]} filePath
 * @param {(entry:any)=>void|Promise<void>} onEntry
 * @param {{
 *   maxBytes?: number,
 *   requiredKeys?: string[]|null,
 *   validationMode?: 'strict'|'trusted',
 *   recoveryFallback?:boolean
 * }} [options]
 * @returns {Promise<void>}
 */
export const readJsonLinesEach = async (filePath, onEntry, options = {}) => {
  await readJsonLinesEachAwait(filePath, onEntry, options);
};
