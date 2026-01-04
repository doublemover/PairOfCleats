import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const MAX_JSON_BYTES = 512 * 1024 * 1024 - 1024;

/**
 * Split an array into fixed-size chunks.
 * @param {Array<any>} items
 * @param {number} [size]
 * @returns {Array<Array<any>>}
 */
export function chunkArray(items, size = 900) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Return the set of table names in a SQLite database.
 * @param {import('better-sqlite3').Database} db
 * @returns {Set<string>}
 */
export function getTableNames(db) {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  return new Set(rows.map((row) => row.name));
}

/**
 * Check that all required tables exist.
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} requiredTables
 * @returns {boolean}
 */
export function hasRequiredTables(db, requiredTables) {
  const tableNames = getTableNames(db);
  return requiredTables.every((name) => tableNames.has(name));
}

/**
 * Normalize a file path to POSIX separators.
 * @param {string} value
 * @returns {string}
 */
export function normalizeFilePath(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\\/g, '/');
}

/**
 * Read and parse JSON from disk.
 * @param {string} filePath
 * @returns {any}
 */
export function readJson(filePath) {
  const readBuffer = (targetPath) => {
    const stat = fs.statSync(targetPath);
    if (stat.size > MAX_JSON_BYTES) {
      const err = new Error(
        `JSON artifact too large to load (${stat.size} bytes): ${targetPath}`
      );
      err.code = 'ERR_JSON_TOO_LARGE';
      throw err;
    }
    return fs.readFileSync(targetPath);
  };
  const parseBuffer = (buffer) => {
    if (buffer.length > MAX_JSON_BYTES) {
      const err = new Error(
        `JSON artifact too large to load (${buffer.length} bytes): ${filePath}`
      );
      err.code = 'ERR_JSON_TOO_LARGE';
      throw err;
    }
    return JSON.parse(buffer.toString('utf8'));
  };
  if (fs.existsSync(filePath)) {
    return parseBuffer(readBuffer(filePath));
  }
  if (filePath.endsWith('.json')) {
    const gzPath = `${filePath}.gz`;
    if (fs.existsSync(gzPath)) {
      return parseBuffer(gunzipSync(readBuffer(gzPath)));
    }
  }
  throw new Error(`Missing JSON artifact: ${filePath}`);
}

/**
 * Read JSON from disk if it exists; otherwise return null.
 * @param {string} dir
 * @param {string} name
 * @returns {any|null}
 */
export function loadOptional(dir, name) {
  const target = path.join(dir, name);
  if (!fs.existsSync(target) && !(name.endsWith('.json') && fs.existsSync(`${target}.gz`))) {
    return null;
  }
  try {
    return readJson(target);
  } catch (err) {
    if (err?.code === 'ERR_JSON_TOO_LARGE') {
      console.warn(`[sqlite] Skipping ${name}: ${err.message}`);
      return null;
    }
    throw err;
  }
}

/**
 * Load file-backed index artifacts from a directory.
 * @param {string} dir
 * @param {string} modelId
 * @returns {object|null}
 */
export function loadIndex(dir, modelId) {
  const chunkMetaPath = path.join(dir, 'chunk_meta.json');
  if (!fs.existsSync(chunkMetaPath)) return null;
  const chunkMeta = readJson(chunkMetaPath);
  const denseVec = loadOptional(dir, 'dense_vectors_uint8.json');
  if (denseVec && !denseVec.model) denseVec.model = modelId || null;
  return {
    chunkMeta,
    fileMeta: loadOptional(dir, 'file_meta.json'),
    denseVec,
    phraseNgrams: loadOptional(dir, 'phrase_ngrams.json'),
    chargrams: loadOptional(dir, 'chargram_postings.json'),
    minhash: loadOptional(dir, 'minhash_signatures.json'),
    tokenPostings: loadOptional(dir, 'token_postings.json')
  };
}
