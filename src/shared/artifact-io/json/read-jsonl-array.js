import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { MAX_JSON_BYTES } from '../constants.js';
import { cleanupBak, getBakPath, readCache, writeCache } from '../cache.js';
import {
  collectCompressedJsonlCandidates,
  decompressBuffer,
  detectCompression,
  readBuffer
} from '../compression.js';
import { parseJsonlLine } from '../jsonl.js';
import {
  canUseFallbackAfterPrimaryError,
  captureFallbackReadError,
  resolvePreferredReadError
} from './fallback.js';
import {
  shouldTreatAsTooLarge,
  toJsonTooLargeError
} from '../limits.js';
import { hasArtifactReadObserver, recordArtifactRead } from '../telemetry.js';
import { readJsonLinesIterator } from './read-jsonl-stream.js';

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
    recoveryFallback = false
  } = {}
) => {
  const collectSingle = async (sourcePath) => {
    const parsed = [];
    for await (const entry of readJsonLinesIterator(sourcePath, {
      maxBytes,
      requiredKeys,
      validationMode,
      recoveryFallback
    })) {
      parsed.push(entry);
    }
    return parsed;
  };

  const paths = Array.isArray(filePath) ? filePath : [filePath];
  if (paths.length === 1) {
    return await collectSingle(paths[0]);
  }
  const resolvedConcurrency = Math.max(1, Math.min(Number(concurrency) || 4, paths.length));
  const results = new Array(paths.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= paths.length) return;
      results[index] = await collectSingle(paths[index]);
    }
  };
  await Promise.all(new Array(resolvedConcurrency).fill(0).map(() => worker()));
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
    recoveryFallback = false
  } = {}
) => {
  const useCache = !requiredKeys;
  const readCached = (targetPath) => (useCache ? readCache(targetPath) : null);
  const readJsonlFromBuffer = (buffer, sourcePath) => {
    if (buffer.length > maxBytes) {
      throw toJsonTooLargeError(sourcePath, buffer.length);
    }
    const parsed = [];
    const raw = buffer.toString('utf8');
    if (!raw.trim()) return parsed;
    const lines = raw.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const entry = parseJsonlLine(
        lines[index],
        sourcePath,
        index + 1,
        maxBytes,
        requiredKeys,
        validationMode
      );
      if (entry !== null) parsed.push(entry);
    }
    return parsed;
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
      const buffer = readBuffer(targetPath, maxBytes);
      const decompressed = decompressBuffer(buffer, compression, maxBytes, targetPath);
      const parsed = readJsonlFromBuffer(decompressed, targetPath);
      if (cleanup) cleanupBak(targetPath);
      if (useCache) writeCache(targetPath, parsed);
      if (shouldMeasure) {
        recordArtifactRead({
          path: targetPath,
          format: 'jsonl',
          compression,
          rawBytes: buffer.length,
          bytes: decompressed.length,
          durationMs: performance.now() - start
        });
      }
      return parsed;
    }
    let raw = '';
    try {
      raw = fs.readFileSync(targetPath, 'utf8');
    } catch (err) {
      if (shouldTreatAsTooLarge(err)) {
        throw toJsonTooLargeError(targetPath, stat.size);
      }
      throw err;
    }
    if (!raw.trim()) return [];
    const parsed = [];
    const lines = raw.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const entry = parseJsonlLine(
        lines[index],
        targetPath,
        index + 1,
        maxBytes,
        requiredKeys,
        validationMode
      );
      if (entry !== null) parsed.push(entry);
    }
    if (cleanup) cleanupBak(targetPath);
    if (useCache) writeCache(targetPath, parsed);
    if (shouldMeasure) {
      recordArtifactRead({
        path: targetPath,
        format: 'jsonl',
        compression: null,
        rawBytes: stat.size,
        bytes: stat.size,
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
      primaryErr = err;
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
