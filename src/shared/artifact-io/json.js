import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { createGunzip, createZstdDecompress } from 'node:zlib';
import { MAX_JSON_BYTES } from './constants.js';
import { cleanupBak, getBakPath, readCache, writeCache } from './cache.js';
import {
  collectCompressedCandidates,
  collectCompressedJsonlCandidates,
  decompressBuffer,
  detectCompression,
  readBuffer
} from './compression.js';
import { parseJsonlLine } from './jsonl.js';
import { shouldAbortForHeap, shouldTreatAsTooLarge, toJsonTooLargeError } from './limits.js';
import { hasArtifactReadObserver, recordArtifactRead } from './telemetry.js';

export const readJsonFile = (filePath, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const parseBuffer = (buffer, sourcePath) => {
    if (buffer.length > maxBytes) {
      throw toJsonTooLargeError(sourcePath, buffer.length);
    }
    if (shouldAbortForHeap(buffer.length)) {
      throw toJsonTooLargeError(sourcePath, buffer.length);
    }
    try {
      return JSON.parse(buffer.toString('utf8'));
    } catch (err) {
      if (shouldTreatAsTooLarge(err)) {
        throw toJsonTooLargeError(sourcePath, buffer.length);
      }
      throw err;
    }
  };
  const tryRead = (targetPath, options = {}) => {
    const { compression = null, cleanup = false } = options;
    const shouldMeasure = hasArtifactReadObserver();
    const start = shouldMeasure ? performance.now() : 0;
    const buffer = readBuffer(targetPath, maxBytes);
    const resolvedCompression = compression || detectCompression(targetPath) || null;
    const decompressed = decompressBuffer(buffer, resolvedCompression, maxBytes, targetPath);
    const parsed = parseBuffer(decompressed, targetPath);
    if (cleanup) cleanupBak(targetPath);
    if (shouldMeasure) {
      recordArtifactRead({
        path: targetPath,
        format: 'json',
        compression: resolvedCompression,
        rawBytes: buffer.length,
        bytes: decompressed.length,
        durationMs: performance.now() - start
      });
    }
    return parsed;
  };
  const bakPath = getBakPath(filePath);
  if (fs.existsSync(filePath)) {
    try {
      return tryRead(filePath, { cleanup: true });
    } catch (err) {
      if (fs.existsSync(bakPath)) {
        return tryRead(bakPath);
      }
      throw err;
    }
  }
  if (filePath.endsWith('.json')) {
    const candidates = collectCompressedCandidates(filePath);
    if (candidates.length) {
      let lastErr = null;
      for (const candidate of candidates) {
        try {
          return tryRead(candidate.path, {
            compression: candidate.compression,
            cleanup: candidate.cleanup
          });
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr) throw lastErr;
    }
  }
  if (fs.existsSync(bakPath)) {
    return tryRead(bakPath);
  }
  throw new Error(`Missing JSON artifact: ${filePath}`);
};

export const readJsonLinesArray = async (
  filePath,
  { maxBytes = MAX_JSON_BYTES, requiredKeys = null } = {}
) => {
  const readJsonlFromBuffer = (buffer, sourcePath) => {
    if (buffer.length > maxBytes) {
      throw toJsonTooLargeError(sourcePath, buffer.length);
    }
    const parsed = [];
    const raw = buffer.toString('utf8');
    if (!raw.trim()) return parsed;
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const entry = parseJsonlLine(lines[i], sourcePath, i + 1, maxBytes, requiredKeys);
      if (entry !== null) parsed.push(entry);
    }
    return parsed;
  };
  const readJsonlFromGzipStream = async (targetPath, cleanup = false) => {
    const stat = fs.statSync(targetPath);
    if (stat.size > maxBytes) {
      throw toJsonTooLargeError(targetPath, stat.size);
    }
    const shouldMeasure = hasArtifactReadObserver();
    const start = shouldMeasure ? performance.now() : 0;
    const parsed = [];
    const stream = fs.createReadStream(targetPath);
    const gunzip = createGunzip();
    let inflatedBytes = 0;
    gunzip.on('data', (chunk) => {
      inflatedBytes += chunk.length;
      if (inflatedBytes > maxBytes) {
        gunzip.destroy(toJsonTooLargeError(targetPath, inflatedBytes));
      }
    });
    stream.on('error', (err) => gunzip.destroy(err));
    stream.pipe(gunzip);
    const rl = createInterface({ input: gunzip, crlfDelay: Infinity });
    let lineNumber = 0;
    try {
      for await (const line of rl) {
        lineNumber += 1;
        const entry = parseJsonlLine(line, targetPath, lineNumber, maxBytes, requiredKeys);
        if (entry !== null) parsed.push(entry);
      }
    } catch (err) {
      if (err?.code === 'ERR_JSON_TOO_LARGE') {
        throw err;
      }
      if (shouldTreatAsTooLarge(err)) {
        throw toJsonTooLargeError(targetPath, inflatedBytes || stat.size);
      }
      throw err;
    } finally {
      rl.close();
      gunzip.destroy();
      stream.destroy();
    }
    if (cleanup) cleanupBak(targetPath);
    if (shouldMeasure) {
      recordArtifactRead({
        path: targetPath,
        format: 'jsonl',
        compression: 'gzip',
        rawBytes: stat.size,
        bytes: inflatedBytes,
        durationMs: performance.now() - start
      });
    }
    return parsed;
  };

  const readJsonlFromZstdStream = async (targetPath, cleanup = false) => {
    const stat = fs.statSync(targetPath);
    if (stat.size > maxBytes) {
      throw toJsonTooLargeError(targetPath, stat.size);
    }
    const shouldMeasure = hasArtifactReadObserver();
    const start = shouldMeasure ? performance.now() : 0;
    const parsed = [];
    const stream = fs.createReadStream(targetPath);
    let zstd;
    try {
      zstd = createZstdDecompress();
    } catch (err) {
      stream.destroy();
      throw err;
    }
    let inflatedBytes = 0;
    zstd.on('data', (chunk) => {
      inflatedBytes += chunk.length;
      if (inflatedBytes > maxBytes) {
        zstd.destroy(toJsonTooLargeError(targetPath, inflatedBytes));
      }
    });
    stream.on('error', (err) => zstd.destroy(err));
    stream.pipe(zstd);
    const rl = createInterface({ input: zstd, crlfDelay: Infinity });
    let lineNumber = 0;
    try {
      for await (const line of rl) {
        lineNumber += 1;
        const entry = parseJsonlLine(line, targetPath, lineNumber, maxBytes, requiredKeys);
        if (entry !== null) parsed.push(entry);
      }
    } catch (err) {
      if (err?.code === 'ERR_JSON_TOO_LARGE') {
        throw err;
      }
      if (shouldTreatAsTooLarge(err)) {
        throw toJsonTooLargeError(targetPath, inflatedBytes || stat.size);
      }
      throw err;
    } finally {
      rl.close();
      zstd.destroy();
      stream.destroy();
    }
    if (cleanup) cleanupBak(targetPath);
    if (shouldMeasure) {
      recordArtifactRead({
        path: targetPath,
        format: 'jsonl',
        compression: 'zstd',
        rawBytes: stat.size,
        bytes: inflatedBytes,
        durationMs: performance.now() - start
      });
    }
    return parsed;
  };

  const tryRead = async (targetPath, cleanup = false) => {
    const compression = detectCompression(targetPath);
    if (compression) {
      if (compression === 'gzip') {
        return await readJsonlFromGzipStream(targetPath, cleanup);
      }
      if (compression === 'zstd') {
        try {
          return await readJsonlFromZstdStream(targetPath, cleanup);
        } catch (err) {
          const message = typeof err?.message === 'string' ? err.message : '';
          if (!message.includes('zstd') && !message.includes('ZSTD')) throw err;
        }
      }
      const shouldMeasure = hasArtifactReadObserver();
      const start = shouldMeasure ? performance.now() : 0;
      const buffer = readBuffer(targetPath, maxBytes);
      const decompressed = decompressBuffer(buffer, compression, maxBytes, targetPath);
      const parsed = readJsonlFromBuffer(decompressed, targetPath);
      if (cleanup) cleanupBak(targetPath);
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
    const stat = fs.statSync(targetPath);
    if (stat.size > maxBytes) {
      throw toJsonTooLargeError(targetPath, stat.size);
    }
    const shouldMeasure = hasArtifactReadObserver();
    const start = shouldMeasure ? performance.now() : 0;
    const parsed = [];
    const stream = fs.createReadStream(targetPath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let lineNumber = 0;
    try {
      for await (const line of rl) {
        lineNumber += 1;
        const entry = parseJsonlLine(line, targetPath, lineNumber, maxBytes, requiredKeys);
        if (entry !== null) parsed.push(entry);
      }
    } catch (err) {
      if (shouldTreatAsTooLarge(err)) {
        throw toJsonTooLargeError(targetPath, stat.size);
      }
      throw err;
    } finally {
      rl.close();
      stream.destroy();
    }
    if (cleanup) cleanupBak(targetPath);
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
  if (fs.existsSync(filePath)) {
    try {
      return await tryRead(filePath, true);
    } catch (err) {
      if (fs.existsSync(bakPath)) {
        return await tryRead(bakPath);
      }
      throw err;
    }
  }
  if (fs.existsSync(bakPath)) {
    return await tryRead(bakPath);
  }
  if (filePath.endsWith('.jsonl')) {
    const candidates = collectCompressedJsonlCandidates(filePath);
    if (candidates.length) {
      let lastErr = null;
      for (const candidate of candidates) {
        try {
          return await tryRead(candidate.path, candidate.cleanup);
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr) throw lastErr;
    }
  }
  throw new Error(`Missing JSONL artifact: ${filePath}`);
};

export const readJsonLinesArraySync = (
  filePath,
  { maxBytes = MAX_JSON_BYTES, requiredKeys = null } = {}
) => {
  const useCache = !requiredKeys;
  if (useCache) {
    const cached = readCache(filePath);
    if (cached) return cached;
  }
  const readJsonlFromBuffer = (buffer, sourcePath) => {
    if (buffer.length > maxBytes) {
      throw toJsonTooLargeError(sourcePath, buffer.length);
    }
    const parsed = [];
    const raw = buffer.toString('utf8');
    if (!raw.trim()) return parsed;
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const entry = parseJsonlLine(lines[i], sourcePath, i + 1, maxBytes, requiredKeys);
      if (entry !== null) parsed.push(entry);
    }
    return parsed;
  };
  const tryRead = (targetPath, cleanup = false) => {
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
    for (let i = 0; i < lines.length; i += 1) {
      const lineNumber = i + 1;
      const entry = parseJsonlLine(lines[i], targetPath, lineNumber, maxBytes, requiredKeys);
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
  if (fs.existsSync(filePath)) {
    try {
      return tryRead(filePath, true);
    } catch (err) {
      if (fs.existsSync(bakPath)) {
        return tryRead(bakPath);
      }
      throw err;
    }
  }
  if (fs.existsSync(bakPath)) {
    return tryRead(bakPath);
  }
  if (filePath.endsWith('.jsonl')) {
    const candidates = collectCompressedJsonlCandidates(filePath);
    if (candidates.length) {
      let lastErr = null;
      for (const candidate of candidates) {
        try {
          return tryRead(candidate.path, candidate.cleanup);
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr) throw lastErr;
    }
  }
  throw new Error(`Missing JSONL artifact: ${filePath}`);
};
