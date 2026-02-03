import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  MAX_JSON_BYTES,
  loadChunkMeta,
  loadTokenPostings,
  readJsonFile
} from '../../shared/artifact-io.js';
import { toPosix } from '../../shared/files.js';

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
  if (typeof value !== 'string') return null;
  return toPosix(value);
}

/**
 * Read and parse JSON from disk.
 * @param {string} filePath
 * @returns {any}
 */
export function readJson(filePath) {
  return readJsonFile(filePath, { maxBytes: MAX_JSON_BYTES });
}

/**
 * Read JSON from disk if it exists; otherwise return null.
 * @param {string} dir
 * @param {string} name
 * @returns {any|null}
 */
export function loadOptional(dir, name) {
  const target = path.join(dir, name);
  const hasTarget = fs.existsSync(target) || fs.existsSync(`${target}.bak`);
  const hasGz = name.endsWith('.json')
    && (fs.existsSync(`${target}.gz`) || fs.existsSync(`${target}.gz.bak`));
  const hasZst = name.endsWith('.json')
    && (fs.existsSync(`${target}.zst`) || fs.existsSync(`${target}.zst.bak`));
  if (!hasTarget && !hasGz && !hasZst) {
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
export async function loadIndex(dir, modelId) {
  const chunkMetaPath = path.join(dir, 'chunk_meta.json');
  const chunkMetaJsonlPath = path.join(dir, 'chunk_meta.jsonl');
  const chunkMetaMetaPath = path.join(dir, 'chunk_meta.meta.json');
  if (!fs.existsSync(chunkMetaPath)
    && !fs.existsSync(chunkMetaJsonlPath)
    && !fs.existsSync(chunkMetaMetaPath)) {
    return null;
  }
  const chunkMeta = await loadChunkMeta(dir, { maxBytes: MAX_JSON_BYTES });
  const denseVec = loadOptional(dir, 'dense_vectors_uint8.json');
  if (denseVec && !denseVec.model) denseVec.model = modelId || null;
  return {
    chunkMeta,
    fileMeta: loadOptional(dir, 'file_meta.json'),
    denseVec,
    phraseNgrams: loadOptional(dir, 'phrase_ngrams.json'),
    chargrams: loadOptional(dir, 'chargram_postings.json'),
    minhash: loadOptional(dir, 'minhash_signatures.json'),
    tokenPostings: (() => {
      const direct = loadOptional(dir, 'token_postings.json');
      if (direct) return direct;
      try {
        return loadTokenPostings(dir, { maxBytes: MAX_JSON_BYTES });
      } catch {
        return null;
      }
    })()
  };
}

const SQLITE_SIDECARS = ['-wal', '-shm'];

export async function removeSqliteSidecars(basePath) {
  await Promise.all(SQLITE_SIDECARS.map(async (suffix) => {
    try {
      await fsPromises.rm(`${basePath}${suffix}`, { force: true });
    } catch {}
  }));
}

/**
 * Atomically replace a sqlite database, cleaning up WAL/SHM sidecars.
 * @param {string} tempDbPath
 * @param {string} finalDbPath
 * @param {{keepBackup?:boolean,backupPath?:string}} [options]
 */
export async function replaceSqliteDatabase(tempDbPath, finalDbPath, options = {}) {
  const keepBackup = options.keepBackup === true;
  const backupPath = options.backupPath || `${finalDbPath}.bak`;
  const finalExists = fs.existsSync(finalDbPath);
  if (!fs.existsSync(tempDbPath)) {
    const err = new Error(`Temp sqlite db missing before replace: ${tempDbPath}`);
    err.code = 'ERR_SQLITE_TEMP_MISSING';
    throw err;
  }
  const emit = (message) => {
    if (!message) return;
    if (options.logger?.warn) {
      options.logger.warn(message);
      return;
    }
    if (options.logger?.log) {
      options.logger.log(message);
    }
  };

  await removeSqliteSidecars(finalDbPath);
  await removeSqliteSidecars(tempDbPath);

  let backupAvailable = fs.existsSync(backupPath);
  if (finalExists && !backupAvailable) {
    try {
      await fsPromises.rename(finalDbPath, backupPath);
      backupAvailable = true;
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        backupAvailable = fs.existsSync(backupPath);
      }
      if (!backupAvailable) {
        emit(`[sqlite] Failed to move existing db to backup (${err?.message || err}).`);
      }
    }
  }

  try {
    await fsPromises.rename(tempDbPath, finalDbPath);
  } catch (err) {
    if (err?.code !== 'EEXIST' && err?.code !== 'EPERM' && err?.code !== 'ENOTEMPTY') {
      throw err;
    }
    if (!backupAvailable) {
      throw err;
    }
    emit('[sqlite] Falling back to removing existing db before replace.');
    try {
      await fsPromises.rm(finalDbPath, { force: true });
    } catch {}
    await fsPromises.rename(tempDbPath, finalDbPath);
  }

  if (!keepBackup) {
    try {
      await fsPromises.rm(backupPath, { force: true });
    } catch {}
  }
  await removeSqliteSidecars(backupPath);
}
