import fs from 'node:fs';
import path from 'node:path';
import { logLine } from '../../progress.js';
import { MAX_JSON_BYTES } from '../constants.js';
import { existsOrBak, readShardFiles, resolveArtifactMtime, resolveDirMtime } from '../fs.js';
import { validateOffsetsAgainstFile } from '../offsets.js';
import { readJsonFile } from '../json.js';
import { readCache, writeCache } from '../cache.js';

const warnedNonStrictJsonFallback = new Set();
const warnedMaterializeFallback = new Set();

/**
 * Emit a one-time warning when non-strict loading falls back to legacy paths.
 *
 * @param {string} dir
 * @param {string} name
 * @returns {void}
 */
const warnNonStrictJsonFallback = (dir, name) => {
  const key = `${dir}:${name}`;
  if (warnedNonStrictJsonFallback.has(key)) return;
  warnedNonStrictJsonFallback.add(key);
  logLine(
    `[manifest] Non-strict mode: ${name} missing from manifest; using legacy JSON path (${dir}).`,
    { kind: 'warning' }
  );
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

/**
 * @typedef {object} JsonlArtifactSources
 * @property {'json'|'jsonl'|'columnar'} format
 * @property {string[]} paths
 * @property {string[]|null} [offsets]
 */

/**
 * Resolve preferred artifact source paths for JSON/JSONL-based artifacts.
 *
 * @param {string} dir
 * @param {string} baseName
 * @returns {JsonlArtifactSources|null}
 */
const resolveJsonlArtifactSources = (dir, baseName) => {
  const metaPath = path.join(dir, `${baseName}.meta.json`);
  const partsDir = path.join(dir, `${baseName}.parts`);
  const jsonlPath = path.join(dir, `${baseName}.jsonl`);
  const hasJsonl = existsOrBak(jsonlPath);
  const hasShards = existsOrBak(metaPath) || fs.existsSync(partsDir);
  if (hasJsonl && hasShards) {
    const jsonlMtime = resolveArtifactMtime(jsonlPath);
    const shardMtime = existsOrBak(metaPath)
      ? resolveArtifactMtime(metaPath)
      : resolveDirMtime(partsDir);
    if (jsonlMtime >= shardMtime) {
      return { format: 'jsonl', paths: [jsonlPath] };
    }
  }
  if (hasShards) {
    let parts = [];
    let metaFormat = null;
    let offsets = [];
    if (existsOrBak(metaPath)) {
      try {
        const metaRaw = readJsonFileCached(metaPath, { maxBytes: MAX_JSON_BYTES });
        const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
        metaFormat = typeof meta?.format === 'string' ? meta.format : null;
        if (Array.isArray(meta?.offsets) && meta.offsets.length) {
          offsets = meta.offsets
            .map((offset) => (typeof offset === 'string' ? offset : null))
            .filter(Boolean)
            .map((name) => path.join(dir, name));
        }
        if (Array.isArray(meta?.parts) && meta.parts.length) {
          parts = meta.parts
            .map((part) => (typeof part === 'string' ? part : part?.path))
            .filter(Boolean)
            .map((name) => path.join(dir, name));
        }
      } catch {}
    }
    if (!parts.length) {
      parts = readShardFiles(partsDir, `${baseName}.part-`);
    }
    if (parts.length) {
      if (metaFormat === 'json' || metaFormat === 'columnar') {
        return { format: metaFormat, paths: [parts[0]] };
      }
      return {
        format: 'jsonl',
        paths: parts,
        offsets: offsets.length === parts.length ? offsets : null
      };
    }
    return null;
  }
  if (hasJsonl) {
    return { format: 'jsonl', paths: [jsonlPath] };
  }
  return null;
};

/**
 * Resolve fallback JSONL source paths, including compressed single-file forms.
 *
 * @param {string} dir
 * @param {string} baseName
 * @returns {JsonlArtifactSources|null}
 */
const resolveJsonlFallbackSources = (dir, baseName) => {
  const metaPath = path.join(dir, `${baseName}.meta.json`);
  let offsets = [];
  if (existsOrBak(metaPath)) {
    try {
      const metaRaw = readJsonFileCached(metaPath, { maxBytes: MAX_JSON_BYTES });
      const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
      if (Array.isArray(meta?.offsets) && meta.offsets.length) {
        offsets = meta.offsets
          .map((offset) => (typeof offset === 'string' ? offset : null))
          .filter(Boolean)
          .map((name) => path.join(dir, name));
      }
    } catch {}
  }
  const partsDir = path.join(dir, `${baseName}.parts`);
  const parts = readShardFiles(partsDir, `${baseName}.part-`);
  if (parts.length) {
    return {
      format: 'jsonl',
      paths: parts,
      offsets: offsets.length === parts.length ? offsets : null
    };
  }
  const jsonlBase = path.join(dir, `${baseName}.jsonl`);
  const hasJsonl = existsOrBak(jsonlBase)
    || existsOrBak(`${jsonlBase}.gz`)
    || existsOrBak(`${jsonlBase}.zst`);
  if (hasJsonl) {
    return {
      format: 'jsonl',
      paths: [jsonlBase],
      offsets: offsets.length === 1 ? offsets : null
    };
  }
  return null;
};

/**
 * Materialize row-wise objects from a columnar payload.
 *
 * @param {any} payload
 * @returns {object[]|null}
 */
const inflateColumnarRows = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const arrays = payload.arrays && typeof payload.arrays === 'object' ? payload.arrays : null;
  if (!arrays) return null;
  const columns = Array.isArray(payload.columns) ? payload.columns : Object.keys(arrays);
  if (!columns.length) return [];
  const tables = payload.tables && typeof payload.tables === 'object' ? payload.tables : null;
  const length = Number.isFinite(payload.length)
    ? payload.length
    : (Array.isArray(arrays[columns[0]]) ? arrays[columns[0]].length : 0);
  const rows = new Array(length);
  for (let i = 0; i < length; i += 1) {
    const row = {};
    for (const column of columns) {
      const values = arrays[column];
      const value = Array.isArray(values) ? (values[i] ?? null) : null;
      const table = tables && Array.isArray(tables[column]) ? tables[column] : null;
      row[column] = table && Number.isInteger(value) ? (table[value] ?? null) : value;
    }
    rows[i] = row;
  }
  return rows;
};

/**
 * Iterate row-wise objects from a columnar payload without materializing a full array.
 *
 * @param {any} payload
 * @returns {Generator<object, void, unknown>|null}
 */
const iterateColumnarRows = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const arrays = payload.arrays && typeof payload.arrays === 'object' ? payload.arrays : null;
  if (!arrays) return null;
  const columns = Array.isArray(payload.columns) ? payload.columns : Object.keys(arrays);
  if (!columns.length) return (function* () {})();
  const tables = payload.tables && typeof payload.tables === 'object' ? payload.tables : null;
  const length = Number.isFinite(payload.length)
    ? payload.length
    : (Array.isArray(arrays[columns[0]]) ? arrays[columns[0]].length : 0);
  return (function* () {
    for (let i = 0; i < length; i += 1) {
      const row = {};
      for (const column of columns) {
        const values = arrays[column];
        const value = Array.isArray(values) ? (values[i] ?? null) : null;
        const table = tables && Array.isArray(tables[column]) ? tables[column] : null;
        row[column] = table && Number.isInteger(value) ? (table[value] ?? null) : value;
      }
      yield row;
    }
  })();
};

export {
  warnNonStrictJsonFallback,
  warnMaterializeFallback,
  readJsonFileCached,
  assertNoShardIndexGaps,
  ensureOffsetsValid,
  resolveJsonlArtifactSources,
  resolveJsonlFallbackSources,
  inflateColumnarRows,
  iterateColumnarRows
};
