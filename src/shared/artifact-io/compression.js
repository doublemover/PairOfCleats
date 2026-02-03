import fs from 'node:fs';
import { gunzipSync, zstdDecompressSync as zstdDecompressSyncNative } from 'node:zlib';
import { getBakPath } from './cache.js';
import { shouldAbortForHeap, shouldTreatAsTooLarge, toJsonTooLargeError } from './limits.js';

const zstdDecompressSync = (buffer, maxBytes, sourcePath) => {
  try {
    const outputLimit = maxBytes > 0 ? maxBytes + 1024 : 0;
    const outBuffer = zstdDecompressSyncNative(
      buffer,
      outputLimit > 0 ? { maxOutputLength: outputLimit } : undefined
    );
    if (outBuffer.length > maxBytes || shouldAbortForHeap(outBuffer.length)) {
      throw toJsonTooLargeError(sourcePath, outBuffer.length);
    }
    return outBuffer;
  } catch (err) {
    if (shouldTreatAsTooLarge(err)) {
      throw toJsonTooLargeError(sourcePath, maxBytes);
    }
    const message = typeof err?.message === 'string' ? err.message : String(err);
    throw new Error(`zstd decompress failed: ${message}`);
  }
};

const gunzipWithLimit = (buffer, maxBytes, sourcePath) => {
  try {
    const limit = Number.isFinite(Number(maxBytes)) ? Math.max(0, Math.floor(Number(maxBytes))) : 0;
    const outputLimit = limit > 0 ? limit + 1024 : 0;
    return gunzipSync(buffer, outputLimit > 0 ? { maxOutputLength: outputLimit } : undefined);
  } catch (err) {
    if (shouldTreatAsTooLarge(err)) {
      throw toJsonTooLargeError(sourcePath, maxBytes);
    }
    throw err;
  }
};

const stripBak = (filePath) => (filePath.endsWith('.bak') ? filePath.slice(0, -4) : filePath);

export const detectCompression = (filePath) => {
  const target = stripBak(filePath);
  if (target.endsWith('.gz')) return 'gzip';
  if (target.endsWith('.zst')) return 'zstd';
  return null;
};

export const decompressBuffer = (buffer, compression, maxBytes, sourcePath) => {
  if (compression === 'gzip') {
    return gunzipWithLimit(buffer, maxBytes, sourcePath);
  }
  if (compression === 'zstd') {
    return zstdDecompressSync(buffer, maxBytes, sourcePath);
  }
  return buffer;
};

export const readBuffer = (targetPath, maxBytes) => {
  const stat = fs.statSync(targetPath);
  if (stat.size > maxBytes) {
    throw toJsonTooLargeError(targetPath, stat.size);
  }
  return fs.readFileSync(targetPath);
};

export const collectCompressedCandidates = (filePath) => {
  const candidates = [];
  const addCandidate = (targetPath, compression, cleanup) => {
    if (!fs.existsSync(targetPath)) return;
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(targetPath).mtimeMs;
    } catch {}
    candidates.push({ path: targetPath, compression, cleanup, mtimeMs });
  };
  const zstPath = `${filePath}.zst`;
  const gzPath = `${filePath}.gz`;
  addCandidate(zstPath, 'zstd', true);
  addCandidate(getBakPath(zstPath), 'zstd', false);
  addCandidate(gzPath, 'gzip', true);
  addCandidate(getBakPath(gzPath), 'gzip', false);
  candidates.sort((a, b) => {
    if (a.cleanup !== b.cleanup) return a.cleanup ? -1 : 1;
    return b.mtimeMs - a.mtimeMs;
  });
  return candidates;
};

export const collectCompressedJsonlCandidates = (filePath) => {
  const candidates = [];
  const addCandidate = (targetPath, compression, cleanup) => {
    if (!fs.existsSync(targetPath)) return;
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(targetPath).mtimeMs;
    } catch {}
    candidates.push({ path: targetPath, compression, cleanup, mtimeMs });
  };
  const zstPath = `${filePath}.zst`;
  const gzPath = `${filePath}.gz`;
  addCandidate(zstPath, 'zstd', true);
  addCandidate(getBakPath(zstPath), 'zstd', false);
  addCandidate(gzPath, 'gzip', true);
  addCandidate(getBakPath(gzPath), 'gzip', false);
  candidates.sort((a, b) => {
    if (a.cleanup !== b.cleanup) return a.cleanup ? -1 : 1;
    return b.mtimeMs - a.mtimeMs;
  });
  return candidates;
};
