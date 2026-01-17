import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { getHeapStatistics } from 'node:v8';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { tryRequire } from './optional-deps.js';

const MAX_JSON_BYTES_ENV = Number(process.env.PAIROFCLEATS_MAX_JSON_BYTES);
const DEFAULT_MAX_JSON_BYTES = (() => {
  const fallback = 128 * 1024 * 1024;
  try {
    const heapLimit = Number(getHeapStatistics()?.heap_size_limit);
    if (!Number.isFinite(heapLimit) || heapLimit <= 0) return fallback;
    const scaled = Math.floor(heapLimit * 0.1);
    const bounded = Math.min(fallback, scaled);
    return Math.max(32 * 1024 * 1024, bounded);
  } catch {
    return fallback;
  }
})();
export const MAX_JSON_BYTES = Number.isFinite(MAX_JSON_BYTES_ENV) && MAX_JSON_BYTES_ENV > 0
  ? Math.floor(MAX_JSON_BYTES_ENV)
  : DEFAULT_MAX_JSON_BYTES;

const toJsonTooLargeError = (filePath, size) => {
  const err = new Error(
    `JSON artifact too large to load (${size} bytes): ${filePath}`
  );
  err.code = 'ERR_JSON_TOO_LARGE';
  return err;
};

const getBakPath = (filePath) => `${filePath}.bak`;

const cleanupBak = (filePath) => {
  const bakPath = getBakPath(filePath);
  if (!fs.existsSync(bakPath)) return;
  try {
    fs.rmSync(bakPath, { force: true });
  } catch {}
};

const PIECE_CACHE_LIMIT = 8;
const pieceCache = new Map();

const buildCacheKey = (filePath) => {
  try {
    const stat = fs.statSync(filePath);
    return `${filePath}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
};

const readCache = (filePath) => {
  const key = buildCacheKey(filePath);
  if (!key) return null;
  const cached = pieceCache.get(key);
  if (!cached) return null;
  pieceCache.delete(key);
  pieceCache.set(key, cached);
  return cached;
};

const writeCache = (filePath, value) => {
  const key = buildCacheKey(filePath);
  if (!key) return;
  if (pieceCache.has(key)) pieceCache.delete(key);
  pieceCache.set(key, value);
  if (pieceCache.size > PIECE_CACHE_LIMIT) {
    const firstKey = pieceCache.keys().next().value;
    if (firstKey) pieceCache.delete(firstKey);
  }
};

const shouldTreatAsTooLarge = (err) => {
  if (!err) return false;
  if (err.code === 'ERR_STRING_TOO_LONG') return true;
  if (err.code === 'ERR_BUFFER_TOO_LARGE' || err.code === 'ERR_OUT_OF_RANGE') return true;
  const message = typeof err.message === 'string' ? err.message : '';
  return message.includes('Invalid string length');
};

const shouldAbortForHeap = (bytes) => {
  try {
    const stats = getHeapStatistics();
    const limit = Number(stats?.heap_size_limit);
    const used = Number(stats?.used_heap_size);
    if (!Number.isFinite(limit) || !Number.isFinite(used) || limit <= 0) return false;
    const remaining = limit - used;
    if (!Number.isFinite(remaining) || remaining <= 0) return false;
    return bytes * 3 > remaining;
  } catch {
    return false;
  }
};

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

const detectCompression = (filePath) => {
  const target = stripBak(filePath);
  if (target.endsWith('.gz')) return 'gzip';
  if (target.endsWith('.zst')) return 'zstd';
  return null;
};

const decompressBuffer = (buffer, compression, maxBytes, sourcePath) => {
  if (compression === 'gzip') {
    return gunzipWithLimit(buffer, maxBytes, sourcePath);
  }
  if (compression === 'zstd') {
    return zstdDecompressSync(buffer, maxBytes, sourcePath);
  }
  return buffer;
};

const readBuffer = (targetPath, maxBytes) => {
  const stat = fs.statSync(targetPath);
  if (stat.size > maxBytes) {
    throw toJsonTooLargeError(targetPath, stat.size);
  }
  return fs.readFileSync(targetPath);
};

const collectCompressedCandidates = (filePath) => {
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
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates;
};

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
    const buffer = readBuffer(targetPath, maxBytes);
    const parsed = parseBuffer(
      decompressBuffer(buffer, compression || detectCompression(targetPath), maxBytes, targetPath),
      targetPath
    );
    if (cleanup) cleanupBak(targetPath);
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

export const readJsonLinesArray = async (filePath, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const parseLine = (line, targetPath) => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    if (trimmed.length > maxBytes) {
      throw toJsonTooLargeError(targetPath, trimmed.length);
    }
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      if (shouldTreatAsTooLarge(err)) {
        throw toJsonTooLargeError(targetPath, trimmed.length);
      }
      throw err;
    }
  };
  const tryRead = async (targetPath, cleanup = false) => {
    const stat = fs.statSync(targetPath);
    if (stat.size > maxBytes) {
      throw toJsonTooLargeError(targetPath, stat.size);
    }
    const parsed = [];
    const stream = fs.createReadStream(targetPath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        const entry = parseLine(line, targetPath);
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
  throw new Error(`Missing JSONL artifact: ${filePath}`);
};

export const readJsonLinesArraySync = (filePath, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const cached = readCache(filePath);
  if (cached) return cached;
  const tryRead = (targetPath, cleanup = false) => {
    const stat = fs.statSync(targetPath);
    if (stat.size > maxBytes) {
      throw toJsonTooLargeError(targetPath, stat.size);
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
    const parsed = raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
    if (cleanup) cleanupBak(targetPath);
    writeCache(targetPath, parsed);
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
  throw new Error(`Missing JSONL artifact: ${filePath}`);
};

const readShardFiles = (dir, prefix) => {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && (name.endsWith('.json') || name.endsWith('.jsonl')))
    .sort()
    .map((name) => path.join(dir, name));
};

const existsOrBak = (filePath) => {
  if (fs.existsSync(filePath) || fs.existsSync(getBakPath(filePath))) return true;
  if (filePath.endsWith('.json')) {
    const gzPath = `${filePath}.gz`;
    const zstPath = `${filePath}.zst`;
    if (fs.existsSync(gzPath) || fs.existsSync(getBakPath(gzPath))) return true;
    if (fs.existsSync(zstPath) || fs.existsSync(getBakPath(zstPath))) return true;
  }
  return false;
};

export const loadChunkMeta = async (dir, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const metaPath = path.join(dir, 'chunk_meta.meta.json');
  const partsDir = path.join(dir, 'chunk_meta.parts');
  if (existsOrBak(metaPath) || fs.existsSync(partsDir)) {
    const meta = existsOrBak(metaPath) ? readJsonFile(metaPath, { maxBytes }) : null;
    const parts = Array.isArray(meta?.parts) && meta.parts.length
      ? meta.parts.map((name) => path.join(dir, name))
      : readShardFiles(partsDir, 'chunk_meta.part-');
    if (!parts.length) {
      throw new Error(`Missing chunk_meta shard files in ${partsDir}`);
    }
    const out = [];
    for (const partPath of parts) {
      const part = await readJsonLinesArray(partPath, { maxBytes });
      for (const entry of part) out.push(entry);
    }
    return out;
  }
  const jsonlPath = path.join(dir, 'chunk_meta.jsonl');
  if (existsOrBak(jsonlPath)) {
    return readJsonLinesArray(jsonlPath, { maxBytes });
  }
  const jsonPath = path.join(dir, 'chunk_meta.json');
  if (existsOrBak(jsonPath)) {
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error(`Missing index artifact: chunk_meta.json`);
};

export const loadTokenPostings = (dir, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const metaPath = path.join(dir, 'token_postings.meta.json');
  const shardsDir = path.join(dir, 'token_postings.shards');
  if (existsOrBak(metaPath) || fs.existsSync(shardsDir)) {
    const meta = existsOrBak(metaPath) ? readJsonFile(metaPath, { maxBytes }) : {};
    const shards = Array.isArray(meta?.parts) && meta.parts.length
      ? meta.parts.map((name) => path.join(dir, name))
      : readShardFiles(shardsDir, 'token_postings.part-');
    if (!shards.length) {
      throw new Error(`Missing token_postings shard files in ${shardsDir}`);
    }
    const vocab = [];
    const postings = [];
    const pushChunked = (target, items) => {
      const CHUNK = 4096;
      for (let i = 0; i < items.length; i += CHUNK) {
        target.push(...items.slice(i, i + CHUNK));
      }
    };
    for (const shardPath of shards) {
      const shard = readJsonFile(shardPath, { maxBytes });
      const shardVocab = Array.isArray(shard?.vocab) ? shard.vocab : (Array.isArray(shard?.arrays?.vocab) ? shard.arrays.vocab : []);
      const shardPostings = Array.isArray(shard?.postings) ? shard.postings : (Array.isArray(shard?.arrays?.postings) ? shard.arrays.postings : []);
      if (shardVocab.length) pushChunked(vocab, shardVocab);
      if (shardPostings.length) pushChunked(postings, shardPostings);
    }
    const docLengths = Array.isArray(meta?.docLengths)
      ? meta.docLengths
      : (Array.isArray(meta?.arrays?.docLengths) ? meta.arrays.docLengths : []);
    return {
      ...meta,
      vocab,
      postings,
      docLengths
    };
  }
  const jsonPath = path.join(dir, 'token_postings.json');
  if (existsOrBak(jsonPath)) {
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error(`Missing index artifact: token_postings.json`);
};
