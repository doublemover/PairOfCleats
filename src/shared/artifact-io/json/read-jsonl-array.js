import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { addStorageFailureContext } from '../../storage/operation-error.js';
import { MAX_JSON_BYTES } from '../constants.js';
import { cleanupBak, getBakPath, readCache, writeCache } from '../cache.js';
import {
  collectCompressedJsonlCandidates,
  decompressBuffer,
  detectCompression,
  readBuffer
} from '../compression.js';
import {
  canUseFallbackAfterPrimaryError,
  captureFallbackReadError,
  normalizeArtifactReadFailure,
  resolvePreferredReadError
} from './fallback.js';
import {
  shouldTreatAsTooLarge,
  toJsonTooLargeError
} from '../limits.js';
import { hasArtifactReadObserver, recordArtifactRead } from '../telemetry.js';
import { readJsonLinesIterator } from './read-jsonl-stream.js';
import { scanJsonlBuffer } from './line-scan.js';

/**
 * Materialize JSONL entries from one or more sources.
 *
 * Uses bounded parallelism when multiple input files are supplied.
 *
 * @param {string|string[]} filePath
 * @param {{
 *   maxBytes?: number,
 *   requiredKeys?: string[]|null,
 *   validationMode?: 'strict'|'trusted',
 *   concurrency?: number|null,
 *   recoveryFallback?:boolean
 * }} [options]
 * @returns {Promise<any[]>}
 */
export const readJsonLinesArray = async (
  filePath,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
    validationMode = 'strict',
    concurrency = null,
    containedRoot = null,
    recoveryFallback = false
  } = {}
) => {
  const collectSingle = async (sourcePath, readSignal) => {
    const parsed = [];
    for await (const entry of readJsonLinesIterator(sourcePath, {
      maxBytes,
      requiredKeys,
      validationMode,
      recoveryFallback,
      containedRoot,
      signal: readSignal
    })) {
      parsed.push(entry);
    }
    return parsed;
  };

  const paths = Array.isArray(filePath) ? filePath.slice() : [filePath];
  if (paths.length === 1) {
    return await collectSingle(paths[0], null);
  }
  if (!paths.length) return [];
  const resolvedConcurrency = Math.max(1, Math.floor(Math.min(Number(concurrency) || 4, paths.length)));
  const controller = new AbortController();
  const readSignal = controller.signal;
  const results = new Array(paths.length);
  let cursor = 0, stopped = false, primary;
  const worker = async () => {
    for (;;) {
      if (stopped || readSignal.aborted) return;
      const index = cursor;
      cursor += 1;
      if (index >= paths.length) return;
      try {
        const part = await collectSingle(paths[index], readSignal);
        if (!stopped) results[index] = part;
      } catch (error) {
        if (!stopped) {
          stopped = true; primary = error;
          results.fill(undefined);
          controller.abort(error);
        }
        throw error;
      }
    }
  };
  const settled = await Promise.allSettled(new Array(resolvedConcurrency).fill(0).map(() => worker()));
  if (stopped) {
    let failure = primary;
    const seen = new Set([primary]);
    for (const result of settled) if (result.status === 'rejected' && !seen.has(result.reason)) {
      seen.add(result.reason);
      failure = addStorageFailureContext(failure, {}, result.reason, { secondaryPresent: true });
    }
    results.fill(undefined);
    throw failure;
  }
  return results.flatMap((part) => Array.isArray(part) ? part : []);
};

/**
 * Synchronously materialize JSONL entries from a single source.
 *
 * Cache behavior:
 * - Cache is used only when `requiredKeys` is not specified.
 * - Successful primary reads may cleanup stale `.bak` files.
 *
 * @param {string} filePath
 * @param {{
 *   maxBytes?: number,
 *   requiredKeys?: string[]|null,
 *   validationMode?: 'strict'|'trusted',
 *   recoveryFallback?:boolean
 * }} [options]
 * @returns {any[]}
 */
export const readJsonLinesArraySync = (
  filePath,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
    validationMode = 'strict',
    containedRoot = null,
    recoveryFallback = false
  } = {}
) => {
  return readJsonLinesSyncWithFallback(filePath, {
    maxBytes,
    requiredKeys,
    validationMode,
    containedRoot,
    recoveryFallback,
    useCache: !requiredKeys
  });
};

/**
 * Synchronously parse JSONL entries and invoke `onEntry` for each parsed row.
 *
 * @param {string} filePath
 * @param {(entry:any)=>void} onEntry
 * @param {{
 *   maxBytes?: number,
 *   requiredKeys?: string[]|null,
 *   validationMode?: 'strict'|'trusted',
 *   recoveryFallback?:boolean
 * }} [options]
 * @returns {number}
 */
export const readJsonLinesEachSync = (
  filePath,
  onEntry,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
    validationMode = 'strict',
    containedRoot = null,
    recoveryFallback = false
  } = {}
) => {
  if (typeof onEntry !== 'function') return 0;
  return readJsonLinesSyncWithFallback(filePath, {
    maxBytes,
    requiredKeys,
    validationMode,
    containedRoot,
    recoveryFallback,
    onEntry
  });
};

const readJsonLinesSyncWithFallback = (
  filePath,
  {
    maxBytes,
    requiredKeys,
    validationMode,
    recoveryFallback,
    containedRoot = null,
    useCache = false,
    onEntry = null
  }
) => {
  const collectRows = typeof onEntry !== 'function';
  const cachePolicy = { maxBytes, view: 'jsonl', validationMode, recoveryFallback };
  const readCached = (targetPath) => (useCache && !containedRoot ? readCache(targetPath, cachePolicy) : null);
  const readJsonlFromBuffer = (buffer, sourcePath) => {
    const parsed = collectRows ? [] : null;
    const scan = scanJsonlBuffer(buffer, sourcePath, {
      maxBytes,
      requiredKeys,
      validationMode,
      collect: parsed,
      onEntry
    });
    return collectRows ? parsed : scan.rows;
  };
  const tryRead = (targetPath, cleanup = false) => {
    const cached = readCached(targetPath);
    if (cached) return cached;
    const stat = fs.statSync(targetPath);
    if (stat.size > maxBytes) {
      throw toJsonTooLargeError(targetPath, stat.size);
    }
    const shouldMeasure = hasArtifactReadObserver();
    const start = shouldMeasure ? performance.now() : 0;
    const compression = detectCompression(targetPath);
    if (compression) {
      const buffer = readBuffer(targetPath, maxBytes, { containedRoot });
      const decompressed = decompressBuffer(buffer, compression, maxBytes, targetPath);
      const parsed = readJsonlFromBuffer(decompressed, targetPath);
      if (cleanup && !containedRoot) cleanupBak(targetPath);
      if (useCache) writeCache(targetPath, parsed, cachePolicy);
      if (shouldMeasure) {
        recordArtifactRead({
          path: targetPath,
          format: 'jsonl',
          compression,
          rawBytes: buffer.length,
          bytes: decompressed.length,
          rows: Array.isArray(parsed) ? parsed.length : parsed,
          durationMs: performance.now() - start
        });
      }
      return parsed;
    }
    let raw = null;
    try {
      raw = readBuffer(targetPath, maxBytes, { containedRoot });
    } catch (value) {
      const err = normalizeArtifactReadFailure(value);
      if (shouldTreatAsTooLarge(err)) {
        throw toJsonTooLargeError(targetPath, stat.size, { cause: err, causePresent: true });
      }
      throw err;
    }
    const parsed = readJsonlFromBuffer(raw, targetPath);
    if (cleanup && !containedRoot) cleanupBak(targetPath);
    if (useCache) writeCache(targetPath, parsed, cachePolicy);
    if (shouldMeasure) {
      recordArtifactRead({
        path: targetPath,
        format: 'jsonl',
        compression: null,
        rawBytes: stat.size,
        bytes: stat.size,
        rows: Array.isArray(parsed) ? parsed.length : parsed,
        durationMs: performance.now() - start
      });
    }
    return parsed;
  };

  const bakPath = getBakPath(filePath);
  let primaryErr = null;
  if (fs.existsSync(filePath)) {
    try {
      return tryRead(filePath, true);
    } catch (err) {
      primaryErr = normalizeArtifactReadFailure(err);
      if (!canUseFallbackAfterPrimaryError(primaryErr, recoveryFallback)) {
        throw primaryErr;
      }
    }
  }
  let fallbackErr = null;
  if (filePath.endsWith('.jsonl')) {
    for (const candidate of collectCompressedJsonlCandidates(filePath)) {
      try {
        return tryRead(candidate.path, candidate.cleanup);
      } catch (err) {
        fallbackErr = captureFallbackReadError(fallbackErr, err);
      }
    }
  }
  if (fs.existsSync(bakPath)) {
    try {
      return tryRead(bakPath);
    } catch (err) {
      fallbackErr = captureFallbackReadError(fallbackErr, err);
    }
  }
  const preferredErr = resolvePreferredReadError(primaryErr, fallbackErr);
  if (preferredErr) throw preferredErr;
  throw new Error(`Missing JSONL artifact: ${filePath}`);
};
