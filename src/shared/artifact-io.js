import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

export const MAX_JSON_BYTES = 512 * 1024 * 1024 - 1024;

const readBuffer = (targetPath, maxBytes) => {
  const stat = fs.statSync(targetPath);
  if (stat.size > maxBytes) {
    const err = new Error(
      `JSON artifact too large to load (${stat.size} bytes): ${targetPath}`
    );
    err.code = 'ERR_JSON_TOO_LARGE';
    throw err;
  }
  return fs.readFileSync(targetPath);
};

export const readJsonFile = (filePath, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const parseBuffer = (buffer) => {
    if (buffer.length > maxBytes) {
      const err = new Error(
        `JSON artifact too large to load (${buffer.length} bytes): ${filePath}`
      );
      err.code = 'ERR_JSON_TOO_LARGE';
      throw err;
    }
    return JSON.parse(buffer.toString('utf8'));
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

export const readJsonLinesArraySync = (filePath, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const stat = fs.statSync(filePath);
  if (stat.size > maxBytes) {
    const err = new Error(
      `JSONL artifact too large to load (${stat.size} bytes): ${filePath}`
    );
    err.code = 'ERR_JSON_TOO_LARGE';
    throw err;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return [];
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
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
  const jsonPath = path.join(dir, 'chunk_meta.json');
  if (fs.existsSync(jsonPath)) {
    return readJsonFile(jsonPath, { maxBytes });
  }
  const jsonlPath = path.join(dir, 'chunk_meta.jsonl');
  if (fs.existsSync(jsonlPath)) {
    return readJsonLinesArraySync(jsonlPath, { maxBytes });
  }
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
  throw new Error(`Missing index artifact: chunk_meta.json`);
};

export const loadTokenPostings = (dir, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const jsonPath = path.join(dir, 'token_postings.json');
  if (fs.existsSync(jsonPath)) {
    return readJsonFile(jsonPath, { maxBytes });
  }
  const metaPath = path.join(dir, 'token_postings.meta.json');
  const shardsDir = path.join(dir, 'token_postings.shards');
  if (!fs.existsSync(metaPath) && !fs.existsSync(shardsDir)) {
    throw new Error(`Missing index artifact: token_postings.json`);
  }
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
    const shard = readJsonFile(shardPath, { maxBytes });
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
};
