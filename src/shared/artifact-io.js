import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const MAX_JSON_BYTES_ENV = Number(process.env.PAIROFCLEATS_MAX_JSON_BYTES);
export const MAX_JSON_BYTES = Number.isFinite(MAX_JSON_BYTES_ENV) && MAX_JSON_BYTES_ENV > 0
  ? Math.floor(MAX_JSON_BYTES_ENV)
  : 512 * 1024 * 1024 - 1024;

const toJsonTooLargeError = (filePath, size) => {
  const err = new Error(
    `JSON artifact too large to load (${size} bytes): ${filePath}`
  );
  err.code = 'ERR_JSON_TOO_LARGE';
  return err;
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
  const message = typeof err.message === 'string' ? err.message : '';
  return message.includes('Invalid string length');
};

const readBuffer = (targetPath, maxBytes) => {
  const stat = fs.statSync(targetPath);
  if (stat.size > maxBytes) {
    throw toJsonTooLargeError(targetPath, stat.size);
  }
  return fs.readFileSync(targetPath);
};

export const readJsonFile = (filePath, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const parseBuffer = (buffer) => {
    if (buffer.length > maxBytes) {
      throw toJsonTooLargeError(filePath, buffer.length);
    }
    try {
      return JSON.parse(buffer.toString('utf8'));
    } catch (err) {
      if (shouldTreatAsTooLarge(err)) {
        throw toJsonTooLargeError(filePath, buffer.length);
      }
      throw err;
    }
  };
  if (fs.existsSync(filePath)) {
    return parseBuffer(readBuffer(filePath, maxBytes));
  }
  if (filePath.endsWith('.json')) {
    const gzPath = `${filePath}.gz`;
    if (fs.existsSync(gzPath)) {
      return parseBuffer(gunzipSync(readBuffer(gzPath, maxBytes)));
    }
  }
  throw new Error(`Missing JSON artifact: ${filePath}`);
};

const readJsonFileCached = (filePath, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const cached = readCache(filePath);
  if (cached) return cached;
  const data = readJsonFile(filePath, { maxBytes });
  writeCache(filePath, data);
  return data;
};

export const readJsonLinesArraySync = (filePath, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const cached = readCache(filePath);
  if (cached) return cached;
  const stat = fs.statSync(filePath);
  if (stat.size > maxBytes) {
    throw toJsonTooLargeError(filePath, stat.size);
  }
  let raw = '';
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (shouldTreatAsTooLarge(err)) {
      throw toJsonTooLargeError(filePath, stat.size);
    }
    throw err;
  }
  if (!raw.trim()) return [];
  const parsed = raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
  writeCache(filePath, parsed);
  return parsed;
};

const readShardFiles = (dir, prefix) => {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && (name.endsWith('.json') || name.endsWith('.jsonl')))
    .sort()
    .map((name) => path.join(dir, name));
};

export const loadChunkMeta = (dir, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const metaPath = path.join(dir, 'chunk_meta.meta.json');
  const partsDir = path.join(dir, 'chunk_meta.parts');
  if (fs.existsSync(metaPath) || fs.existsSync(partsDir)) {
    const meta = fs.existsSync(metaPath) ? readJsonFile(metaPath, { maxBytes }) : null;
    const parts = Array.isArray(meta?.parts) && meta.parts.length
      ? meta.parts.map((name) => path.join(dir, name))
      : readShardFiles(partsDir, 'chunk_meta.part-');
    if (!parts.length) {
      throw new Error(`Missing chunk_meta shard files in ${partsDir}`);
    }
    return parts.flatMap((partPath) => readJsonLinesArraySync(partPath, { maxBytes }));
  }
  const jsonlPath = path.join(dir, 'chunk_meta.jsonl');
  if (fs.existsSync(jsonlPath)) {
    return readJsonLinesArraySync(jsonlPath, { maxBytes });
  }
  const jsonPath = path.join(dir, 'chunk_meta.json');
  if (fs.existsSync(jsonPath)) {
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error(`Missing index artifact: chunk_meta.json`);
};

export const loadTokenPostings = (dir, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const metaPath = path.join(dir, 'token_postings.meta.json');
  const shardsDir = path.join(dir, 'token_postings.shards');
  if (fs.existsSync(metaPath) || fs.existsSync(shardsDir)) {
    const meta = fs.existsSync(metaPath) ? readJsonFile(metaPath, { maxBytes }) : {};
    const shards = Array.isArray(meta?.parts) && meta.parts.length
      ? meta.parts.map((name) => path.join(dir, name))
      : readShardFiles(shardsDir, 'token_postings.part-');
    if (!shards.length) {
      throw new Error(`Missing token_postings shard files in ${shardsDir}`);
    }
    const vocab = [];
    const postings = [];
    for (const shardPath of shards) {
      const shard = readJsonFileCached(shardPath, { maxBytes });
      const shardVocab = Array.isArray(shard?.vocab) ? shard.vocab : (Array.isArray(shard?.arrays?.vocab) ? shard.arrays.vocab : []);
      const shardPostings = Array.isArray(shard?.postings) ? shard.postings : (Array.isArray(shard?.arrays?.postings) ? shard.arrays.postings : []);
      vocab.push(...shardVocab);
      postings.push(...shardPostings);
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
  if (fs.existsSync(jsonPath)) {
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error(`Missing index artifact: token_postings.json`);
};
