import { createAbortError, throwIfAborted } from '../../abort.js';
import { addStorageFailureContext } from '../../storage/operation-error.js';
import { beginVerifiedArtifactRead } from '../verified-read-scope.js';
import fs from 'node:fs';
import { openContainedFileSync, verifyContainedFileHandle } from '../../contained-file.js';
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
  normalizeArtifactReadFailure,
  resolvePreferredReadError
} from './fallback.js';
import {
  resolveJsonlReadPlan,
  SMALL_JSONL_BYTES
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
  onEntry,
  signal
}) => parseJsonlStreamEntries(stream, {
  targetPath: sourcePath,
  maxBytes,
  requiredKeys,
  validationMode,
  onEntry,
  signal
});

const emitBufferedJsonlEntries = async ({
  sourcePath,
  buffer,
  maxBytes,
  requiredKeys,
  validationMode,
  pushEntry,
  cleanup,
  shouldMeasure,
  start,
  compression,
  rawBytes
}) => {
  const parsed = readBufferedJsonlEntries({
    sourcePath,
    buffer,
    maxBytes,
    requiredKeys,
    validationMode
  });
  for (const entry of parsed.entries) {
    await pushEntry(entry);
  }
  if (cleanup) cleanupBak(sourcePath);
  recordJsonlRead({
    shouldMeasure,
    start,
    path: sourcePath,
    compression,
    rawBytes: rawBytes ?? parsed.bytes,
    bytes: parsed.bytes,
    rows: parsed.entries.length
  });
  return {
    rows: parsed.entries.length,
    bytes: parsed.bytes
  };
};

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
    containedRoot = null,
    recoveryFallback = false,
    signal = null
  } = {}
) {
  throwIfAborted(signal);
  const shouldMeasure = hasArtifactReadObserver();
  const start = shouldMeasure ? performance.now() : 0;
  let rows = 0;
  let bytes = 0;
  let rawBytes = null;
  let compression = null;
  let cleanup = null;
  let stream = null;
  const ownedStreams = new Map();
  const cleanupFailures = new Set();
  let cancelled = false;
  let cancellationError = null;
  let producerFailure = null;
  let containedReadError = null;
  const cancelError = () => (cancellationError ||= createAbortError());
  const ownStream = (owned) => {
    const closed = owned.closed ? Promise.resolve() : new Promise(resolve => owned.once('close', resolve));
    // Ownership cleanup must also be safe before the row parser is attached.
    const state = { closed, error: null };
    owned.on('error', error => { state.error ||= error; });
    ownedStreams.set(owned, state);
    return owned;
  };
  const destroyStream = async (reason = undefined) => {
    const streams = [...ownedStreams];
    for (const [owned, state] of streams) {
      try { owned.destroy(reason); } catch (error) { state.error ||= error; }
    }
    stream = null;
    await Promise.all(streams.map(([, state]) => state.closed));
    const errors = streams.map(([, state]) => state.error).filter(error => error != null);
    for (const error of errors) cleanupFailures.add(error);
    for (const [owned] of streams) ownedStreams.delete(owned);
    return [...new Set(errors)];
  };
  let sourcePath = targetPath;
  const queue = createRowQueue({
    maxPending: maxInFlight,
    onBackpressure,
    onResume
  });
  const abort = () => {
    const error = cancelError();
    queue.cancel(error);
    for (const [owned, state] of ownedStreams) {
      try { owned.destroy(error); } catch (cleanupError) { state.error ||= cleanupError; }
    }
  };
  signal?.addEventListener('abort', abort, { once: true });

  const producer = (async () => {
    let primary = null;
    try {
      throwIfAborted(signal);
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
          throwIfAborted(signal);
          if (cancelled) throw cancelError();
          emittedForCandidate += 1;
          await queue.push(entry);
          throwIfAborted(signal);
        };
        try {
          sourcePath = candidate.path;
          compression = candidate.compression ?? detectCompression(candidate.path);
          cleanup = containedRoot ? false : candidate.cleanup;
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
              const buffer = readBuffer(sourcePath, maxBytes, { containedRoot });
              const decompressed = decompressBuffer(buffer, 'gzip', maxBytes, sourcePath);
              ({ rows, bytes } = await emitBufferedJsonlEntries({
                sourcePath,
                buffer: decompressed,
                maxBytes,
                requiredKeys,
                validationMode,
                pushEntry,
                cleanup,
                queue,
                shouldMeasure,
                start,
                compression,
                rawBytes
              }));
              return;
            }
            if (!compression) {
              const buffer = readBuffer(sourcePath, maxBytes, { containedRoot });
              ({ rows, bytes } = await emitBufferedJsonlEntries({
                sourcePath,
                buffer,
                maxBytes,
                requiredKeys,
                validationMode,
                pushEntry,
                cleanup,
                queue,
                shouldMeasure,
                start,
                compression,
                rawBytes
              }));
              return;
            }
          }
          // The optional whole-buffer decoder cannot enforce decoded output
          // admission during allocation. Use the owned native stream for zstd
          // regardless of encoded size, so decoded counting precedes staging.
          if (containedRoot) {
            const fd = openContainedFileSync(containedRoot, sourcePath);
            let descriptorOwnedByStream = false;
            try {
              const openedStat = fs.fstatSync(fd);
              if (openedStat.size > maxBytes) throw toJsonTooLargeError(sourcePath, openedStat.size);
              const openedPath = sourcePath;
              const witness = !range ? beginVerifiedArtifactRead(containedRoot, openedPath, fd) : null;
              stream = ownStream(fs.createReadStream(sourcePath, { ...range, fd, autoClose: true }));
              descriptorOwnedByStream = true;
              const rawStream = stream;
              if (witness) rawStream.on('data', bytes => {
                try { witness.update(bytes); } catch (error) { containedReadError = error; rawStream.destroy(error); }
              });
              if (typeof witness?.signal?.addEventListener === 'function') {
                const onAbort = () => rawStream.destroy(createAbortError());
                witness.signal.addEventListener('abort', onAbort, { once: true });
                rawStream.once('close', () => witness.signal.removeEventListener('abort', onAbort));
                if (witness.signal.aborted) onAbort();
              }
              rawStream.prependOnceListener('end', () => {
                try {
                  const verify = () => verifyContainedFileHandle(fd, containedRoot, openedPath);
                  if (witness) witness.finish(verify);
                  else verify();
                } catch (error) { containedReadError = error; }
              });
            } catch (error) { if (!descriptorOwnedByStream) fs.closeSync(fd); throw error; }
          } else {
            stream = ownStream(fs.createReadStream(sourcePath, range || undefined));
          }
          if (compression === 'gzip') {
            const gunzip = ownStream(createGunzip());
            stream.on('error', error => gunzip.destroy(error));
            stream = stream.pipe(gunzip);
          } else if (compression === 'zstd') {
            const zstdStream = ownStream(createZstdDecompress());
            stream.on('error', error => zstdStream.destroy(error));
            stream = stream.pipe(zstdStream);
          }
          break;
        } catch (err) {
          if (emittedForCandidate > 0) {
            throw err;
          }
          if (index === 0) {
            primaryErr = normalizeArtifactReadFailure(err);
            fallbackEnabled = canUseFallbackAfterPrimaryError(primaryErr, recoveryFallback);
            if (!fallbackEnabled) {
              throw primaryErr;
            }
          } else {
            fallbackErr = captureFallbackReadError(fallbackErr, err);
          }
          lastErr = err;
          const cleanupErrors = await destroyStream();
          for (const error of cleanupErrors) {
            if (error !== err) throw addStorageFailureContext(err, {}, error, { secondaryPresent: true });
          }
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
        signal,
        onEntry: async (entry) => {
          throwIfAborted(signal);
          if (cancelled) throw cancelError();
          await queue.push(entry);
        }
      }));
      if (containedReadError) throw containedReadError;
      if (cleanup) cleanupBak(sourcePath);
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
      primary = normalizeArtifactReadFailure(err);
    } finally {
      const cleanupErrors = await destroyStream();
      for (const error of cleanupErrors) {
        if (error === primary || error === cancellationError) continue;
        primary = primary ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : error;
      }
      producerFailure = primary;
      queue.finish(primary);
    }
  })();

  let iterationFailure = null, iterationFailed = false;
  try {
    for await (const entry of queue.iterator()) {
      throwIfAborted(signal);
      yield entry;
    }
  } catch (error) {
    iterationFailure = error; iterationFailed = true; throw error;
  } finally {
    cancelled = true;
    queue.cancel();
    await destroyStream(cancelError());
    await producer.catch(() => {});
    signal?.removeEventListener('abort', abort);
    // A consumer return has no queue read left to report finalizer failures.
    // Suppress only our exact cancellation cause, retaining independent source
    // or decoder errors even when the caller stops after the first row.
    if (!iterationFailed || iterationFailure !== producerFailure) {
      let primary = iterationFailure, failed = iterationFailed;
      for (const error of cleanupFailures) {
        if (error === cancellationError || error === primary) continue;
        primary = failed ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : error;
        failed = true;
      }
      if (failed && (!iterationFailed || primary !== iterationFailure)) throw primary;
    }
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
 *   recoveryFallback?:boolean,
 *   signal?:AbortSignal|null
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
  options = {}
) => {
  if (typeof onEntry !== 'function') return;
  const iterator = readJsonLinesIterator(filePath, options);
  let completed = false, failed = false, primary;
  try {
    while (true) {
      const entry = await iterator.next();
      if (entry.done) { completed = true; break; }
      await onEntry(entry.value);
    }
  } catch (error) { failed = true; primary = error; }
  if (!completed) {
    try { await iterator.return(); } catch (error) {
      primary = failed ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : error;
      failed = true;
    }
  }
  if (failed) throw primary;
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
