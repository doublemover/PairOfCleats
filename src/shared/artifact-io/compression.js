import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { tryRequire } from '../optional-deps.js';
import { getBakPath } from './cache.js';
import { shouldAbortForHeap, shouldTreatAsTooLarge, toJsonTooLargeError } from './limits.js';

let cachedZstdAvailable = null;

const hasZstd = () => {
  if (cachedZstdAvailable != null) return cachedZstdAvailable;
  cachedZstdAvailable = tryRequire('@mongodb-js/zstd').ok;
  return cachedZstdAvailable;
};

const zstdDecompressSync = (buffer, maxBytes, sourcePath) => {
  if (!hasZstd()) {
    throw new Error('zstd artifacts require @mongodb-js/zstd to be installed.');
  }
  const script = [
    'const zstd = require("@mongodb-js/zstd");',
    'const chunks = [];',
    'process.stdin.on("data", (d) => chunks.push(d));',
    'process.stdin.on("end", async () => {',
    '  try {',
    '    const input = Buffer.concat(chunks);',
    '    const out = await zstd.decompress(input);',
    '    process.stdout.write(out);',
    '  } catch (err) {',
    '    console.error(err && err.message ? err.message : String(err));',
    '    process.exit(2);',
    '  }',
    '});'
  ].join('');
  const result = spawnSync(process.execPath, ['-e', script], {
    input: buffer,
    maxBuffer: maxBytes + 1024
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = result.stderr ? result.stderr.toString('utf8').trim() : '';
    throw new Error(`zstd decompress failed: ${detail || 'unknown error'}`);
  }
  const outBuffer = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || '');
  if (outBuffer.length > maxBytes || shouldAbortForHeap(outBuffer.length)) {
    throw toJsonTooLargeError(sourcePath, outBuffer.length);
  }
  return outBuffer;
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
