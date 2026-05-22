import path from 'node:path';
import { logLine } from '../../progress-runtime.js';
import { validateOffsetsAgainstFile } from '../offsets.js';
import { readJsonFile } from '../json.js';
import { readCache, writeCache } from '../cache.js';

const warnedMaterializeFallback = new Set();

/**
 * Create a loader error with a stable `err.code` for downstream recovery paths.
 *
 * @param {string} code
 * @param {string} message
 * @param {Error|null} [cause]
 * @returns {Error}
 */
const createLoaderError = (code, message, cause = null) => {
  const err = new Error(message);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
};

/**
 * Emit a one-time warning when a streaming caller must materialize payloads.
 *
 * @param {string} dir
 * @param {string} name
 * @param {string} format
 * @returns {void}
 */
const warnMaterializeFallback = (dir, name, format) => {
  const key = `${dir}:${name}:${format}`;
  if (warnedMaterializeFallback.has(key)) return;
  warnedMaterializeFallback.add(key);
  logLine(
    `[manifest] Streaming fallback: ${name} uses ${format}; ` +
    'materialized read may be required for full validation.',
    { kind: 'warning' }
  );
};

/**
 * Read and cache a JSON file through the shared artifact cache.
 *
 * @param {string} filePath
 * @param {{ maxBytes?: number }} [options]
 * @returns {any}
 */
const readJsonFileCached = (filePath, options) => {
  const cached = readCache(filePath);
  if (cached) return cached;
  const value = readJsonFile(filePath, options);
  writeCache(filePath, value);
  return value;
};

/**
 * Normalize artifact metadata envelopes that may encode fields/arrays either
 * as nested objects (`{fields:{}, arrays:{}}`) or as top-level keys.
 *
 * @param {any} raw
 * @returns {{ fields: object, arrays: object }}
 */
const resolveArtifactMetaEnvelope = (raw) => {
  const fields = raw?.fields && typeof raw.fields === 'object' && !Array.isArray(raw.fields)
    ? raw.fields
    : (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});
  const arrays = raw?.arrays && typeof raw.arrays === 'object' && !Array.isArray(raw.arrays)
    ? raw.arrays
    : (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});
  return { fields, arrays };
};

/**
 * Parse shard index from `<name>.part-000123.jsonl[.gz|.zst]`.
 *
 * @param {string} filePath
 * @returns {number|null}
 */
const parseJsonlShardIndex = (filePath) => {
  const name = path.basename(filePath);
  const match = name.match(/\.part-(\d+)\.jsonl(?:\.(?:gz|zst))?$/i);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
};

/**
 * Validate contiguous shard numbering and throw when gaps are detected.
 *
 * @param {string[]} paths
 * @param {string} baseName
 * @returns {void}
 */
const assertNoShardIndexGaps = (paths, baseName) => {
  if (!Array.isArray(paths) || paths.length < 2) return;
  const indexes = [];
  for (const target of paths) {
    const parsed = parseJsonlShardIndex(target);
    if (!Number.isInteger(parsed)) return;
    indexes.push(parsed);
  }
  if (indexes.length !== paths.length) return;
  indexes.sort((a, b) => a - b);
  const missing = [];
  let expected = 0;
  for (const value of indexes) {
    while (expected < value) {
      missing.push(expected);
      expected += 1;
      if (missing.length >= 8) break;
    }
    if (missing.length >= 8) break;
    expected = value + 1;
  }
  if (!missing.length) return;
  const missingPaths = missing
    .map((index) => `${baseName}.part-${String(index).padStart(6, '0')}.jsonl`)
    .join(', ');
  const err = new Error(`Missing manifest parts for ${baseName}: ${missingPaths}`);
  err.code = 'ERR_ARTIFACT_PARTS_MISSING';
  throw err;
};

const validatedOffsets = new Set();

/**
 * Validate offsets file against its JSONL source exactly once per process.
 *
 * @param {string} jsonlPath
 * @param {string} offsetsPath
 * @returns {Promise<boolean>}
 */
const ensureOffsetsValid = async (jsonlPath, offsetsPath) => {
  const key = `${jsonlPath}::${offsetsPath}`;
  if (validatedOffsets.has(key)) return true;
  await validateOffsetsAgainstFile(jsonlPath, offsetsPath);
  validatedOffsets.add(key);
  return true;
};

export {
  createLoaderError,
  warnMaterializeFallback,
  readJsonFileCached,
  resolveArtifactMetaEnvelope,
  assertNoShardIndexGaps,
  ensureOffsetsValid
};
