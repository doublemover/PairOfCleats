import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { logLine } from '../progress.js';
import { MAX_JSON_BYTES } from './constants.js';
import { existsOrBak, readShardFiles, resolveArtifactMtime, resolveDirMtime } from './fs.js';
import { fromPosix } from '../files.js';
import {
  OFFSETS_COMPRESSION,
  OFFSETS_FORMAT,
  OFFSETS_FORMAT_VERSION,
  readJsonlRowsAt,
  readOffsetsAt,
  readOffsetAt,
  resolveOffsetsCount,
  validateOffsetsAgainstFile
} from './offsets.js';
import { readVarintDeltasAt } from './varint.js';
import {
  readJsonFile,
  readJsonLinesArray,
  readJsonLinesArraySync,
  readJsonLinesIterator
} from './json.js';
import { readCache, writeCache } from './cache.js';
import { resolveJsonlRequiredKeys } from './jsonl.js';
import {
  createGraphRelationsShell,
  appendGraphRelationsEntry,
  appendGraphRelationsEntries,
  finalizeGraphRelations,
  normalizeGraphRelationsCsr
} from './graph.js';
import { createPackedChecksumValidator } from './checksum.js';
import { loadPiecesManifest, resolveManifestArtifactSources, normalizeMetaParts } from './manifest.js';
import {
  DEFAULT_PACKED_BLOCK_SIZE,
  decodePackedOffsets,
  unpackTfPostingSlice,
  unpackTfPostings
} from '../packed-postings.js';
import { decodeVarint64List } from './varint.js';
import {
  decodeBinaryRowFrameLengths,
  decodeU64Offsets
} from './binary-columnar.js';
import { formatHash64 } from '../token-id.js';
import { mergeChunkMetaColdFields } from '../chunk-meta-cold.js';

const warnedNonStrictJsonFallback = new Set();
const warnedMaterializeFallback = new Set();
const warnNonStrictJsonFallback = (dir, name) => {
  const key = `${dir}:${name}`;
  if (warnedNonStrictJsonFallback.has(key)) return;
  warnedNonStrictJsonFallback.add(key);
  logLine(
    `[manifest] Non-strict mode: ${name} missing from manifest; using legacy JSON path (${dir}).`,
    { kind: 'warning' }
  );
};

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

const readJsonFileCached = (filePath, options) => {
  const cached = readCache(filePath);
  if (cached) return cached;
  const value = readJsonFile(filePath, options);
  writeCache(filePath, value);
  return value;
};

const parseJsonlShardIndex = (filePath) => {
  const name = path.basename(filePath);
  const match = name.match(/\.part-(\d+)\.jsonl(?:\.(?:gz|zst))?$/i);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
};

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
const ensureOffsetsValid = async (jsonlPath, offsetsPath) => {
  const key = `${jsonlPath}::${offsetsPath}`;
  if (validatedOffsets.has(key)) return true;
  await validateOffsetsAgainstFile(jsonlPath, offsetsPath);
  validatedOffsets.add(key);
  return true;
};

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

export const loadJsonArrayArtifact = async (
  dir,
  baseName,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
    manifest = null,
    strict = true,
    concurrency = null
  } = {}
) => {
  const validationMode = strict ? 'strict' : 'trusted';
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  if (strict) {
    const sources = resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name: baseName,
      strict: true,
      maxBytes
    });
    const resolvedKeys = requiredKeys ?? resolveJsonlRequiredKeys(baseName);
    if (sources?.paths?.length) {
      const missingPaths = sources.paths.filter((target) => !existsOrBak(target));
      if (missingPaths.length) {
        const err = new Error(`Missing manifest parts for ${baseName}: ${missingPaths.join(', ')}`);
        err.code = 'ERR_ARTIFACT_PARTS_MISSING';
        throw err;
      }
      if (sources.format === 'json') {
        if (sources.paths.length > 1) {
          throw new Error(`Ambiguous JSON sources for ${baseName}`);
        }
        return readJsonFile(sources.paths[0], { maxBytes });
      }
      if (sources.format === 'columnar') {
        if (sources.paths.length > 1) {
          throw new Error(`Ambiguous columnar sources for ${baseName}`);
        }
        const payload = readJsonFile(sources.paths[0], { maxBytes });
        const inflated = inflateColumnarRows(payload);
        if (!inflated) throw new Error(`Invalid columnar payload for ${baseName}`);
        return inflated;
      }
      assertNoShardIndexGaps(sources.paths, baseName);
      return await readJsonLinesArray(sources.paths, {
        maxBytes,
        requiredKeys: resolvedKeys,
        validationMode,
        concurrency
      });
    }
    throw new Error(`Missing manifest entry for ${baseName}`);
  }
  const manifestSources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    strict: false,
    maxBytes
  });
  const sources = manifestSources || resolveJsonlArtifactSources(dir, baseName);
  const resolvedKeys = requiredKeys ?? resolveJsonlRequiredKeys(baseName);
  if (sources?.paths?.length) {
    const missingPaths = sources.paths.filter((target) => !existsOrBak(target));
    if (missingPaths.length) {
      const err = new Error(`Missing manifest parts for ${baseName}: ${missingPaths.join(', ')}`);
      err.code = 'ERR_ARTIFACT_PARTS_MISSING';
      throw err;
    }
    assertNoShardIndexGaps(sources.paths, baseName);
    if (!manifestSources) warnNonStrictJsonFallback(dir, baseName);
    if (sources.format === 'json') {
      if (sources.paths.length > 1) {
        throw new Error(`Ambiguous JSON sources for ${baseName}`);
      }
      return readJsonFile(sources.paths[0], { maxBytes });
    }
    if (sources.format === 'columnar') {
      if (sources.paths.length > 1) {
        throw new Error(`Ambiguous columnar sources for ${baseName}`);
      }
      const payload = readJsonFile(sources.paths[0], { maxBytes });
      const inflated = inflateColumnarRows(payload);
      if (!inflated) throw new Error(`Invalid columnar payload for ${baseName}`);
      return inflated;
    }
    assertNoShardIndexGaps(sources.paths, baseName);
    return await readJsonLinesArray(sources.paths, {
      maxBytes,
      requiredKeys: resolvedKeys,
      validationMode,
      concurrency
    });
  }
  const jsonPath = path.join(dir, `${baseName}.json`);
  if (existsOrBak(jsonPath)) {
    warnNonStrictJsonFallback(dir, baseName);
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error(`Missing index artifact: ${baseName}.json`);
};

export const loadJsonArrayArtifactRows = async function* (
  dir,
  baseName,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
    manifest = null,
    strict = true,
    materialize = false,
    maxInFlight = 0,
    onBackpressure = null,
    onResume = null
  } = {}
) {
  const validationMode = strict ? 'strict' : 'trusted';
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  const resolvedKeys = requiredKeys ?? resolveJsonlRequiredKeys(baseName);
  const ensurePresent = (sources, label) => {
    if (!sources?.paths?.length) {
      throw new Error(`Missing manifest entry for ${label}`);
    }
    const missingPaths = sources.paths.filter((target) => !existsOrBak(target));
    if (missingPaths.length) {
      const err = new Error(`Missing manifest parts for ${label}: ${missingPaths.join(', ')}`);
      err.code = 'ERR_ARTIFACT_PARTS_MISSING';
      throw err;
    }
    assertNoShardIndexGaps(sources.paths, label);
  };
  const yieldMaterialized = (payload, label) => {
    if (!materialize) {
      throw new Error(`Materialized read required for ${label}; pass materialize=true to load`);
    }
    if (Array.isArray(payload)) {
      return payload;
    }
    const inflated = inflateColumnarRows(payload);
    if (!inflated) {
      throw new Error(`Invalid columnar payload for ${label}`);
    }
    return inflated;
  };
  const streamRows = async function* (paths, offsetsPaths = null) {
    for (let i = 0; i < paths.length; i += 1) {
      const partPath = paths[i];
      const offsetsPath = Array.isArray(offsetsPaths) ? offsetsPaths[i] : null;
      if (offsetsPath) {
        await ensureOffsetsValid(partPath, offsetsPath);
      }
      for await (const row of readJsonLinesIterator(partPath, {
        maxBytes,
        requiredKeys: resolvedKeys,
        validationMode,
        maxInFlight,
        onBackpressure,
        onResume
      })) {
        yield row;
      }
    }
  };

  if (strict) {
    const sources = resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name: baseName,
      strict: true,
      maxBytes
    });
    ensurePresent(sources, baseName);
    if (sources.format === 'json') {
      if (sources.paths.length > 1) {
        throw new Error(`Ambiguous JSON sources for ${baseName}`);
      }
      const payload = readJsonFile(sources.paths[0], { maxBytes });
      const rows = yieldMaterialized(payload, baseName);
      for (const row of rows) yield row;
      return;
    }
    if (sources.format === 'columnar') {
      if (sources.paths.length > 1) {
        throw new Error(`Ambiguous columnar sources for ${baseName}`);
      }
      const payload = readJsonFile(sources.paths[0], { maxBytes });
      const rows = yieldMaterialized(payload, baseName);
      for (const row of rows) yield row;
      return;
    }
    for await (const row of streamRows(sources.paths, sources.offsets)) {
      yield row;
    }
    return;
  }

  const manifestSources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    strict: false,
    maxBytes
  });
  const sources = manifestSources || resolveJsonlArtifactSources(dir, baseName);
  if (sources?.paths?.length) {
    const missingPaths = sources.paths.filter((target) => !existsOrBak(target));
    if (missingPaths.length) {
      const err = new Error(`Missing manifest parts for ${baseName}: ${missingPaths.join(', ')}`);
      err.code = 'ERR_ARTIFACT_PARTS_MISSING';
      throw err;
    }
    assertNoShardIndexGaps(sources.paths, baseName);
    if (!manifestSources) warnNonStrictJsonFallback(dir, baseName);
    if (sources.format === 'json') {
      if (sources.paths.length > 1) {
        throw new Error(`Ambiguous JSON sources for ${baseName}`);
      }
      const payload = readJsonFile(sources.paths[0], { maxBytes });
      const rows = yieldMaterialized(payload, baseName);
      for (const row of rows) yield row;
      return;
    }
    if (sources.format === 'columnar') {
      if (sources.paths.length > 1) {
        throw new Error(`Ambiguous columnar sources for ${baseName}`);
      }
      const payload = readJsonFile(sources.paths[0], { maxBytes });
      const rows = yieldMaterialized(payload, baseName);
      for (const row of rows) yield row;
      return;
    }
    for await (const row of streamRows(sources.paths, sources.offsets)) {
      yield row;
    }
    return;
  }
  const jsonPath = path.join(dir, `${baseName}.json`);
  if (existsOrBak(jsonPath)) {
    warnNonStrictJsonFallback(dir, baseName);
    const payload = readJsonFile(jsonPath, { maxBytes });
    const rows = yieldMaterialized(payload, baseName);
    for (const row of rows) yield row;
    return;
  }
  throw new Error(`Missing index artifact: ${baseName}.json`);
};

const validateFileMetaRow = (row, label) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`Invalid ${label} row: expected object`);
  }
  if (!Number.isFinite(row.id)) {
    throw new Error(`Invalid ${label} row: missing numeric id`);
  }
  if (typeof row.file !== 'string') {
    throw new Error(`Invalid ${label} row: missing file path`);
  }
  return row;
};

export const loadFileMetaRows = async function* (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true,
    materialize = false,
    maxInFlight = 0,
    onBackpressure = null,
    onResume = null
  } = {}
) {
  const validationMode = strict ? 'strict' : 'trusted';
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  const resolvedKeys = resolveJsonlRequiredKeys('file_meta');
  const ensurePresent = (sources, label) => {
    if (!sources?.paths?.length) {
      throw new Error(`Missing manifest entry for ${label}`);
    }
    const missingPaths = sources.paths.filter((target) => !existsOrBak(target));
    if (missingPaths.length) {
      const err = new Error(`Missing manifest parts for ${label}: ${missingPaths.join(', ')}`);
      err.code = 'ERR_ARTIFACT_PARTS_MISSING';
      throw err;
    }
    assertNoShardIndexGaps(sources.paths, label);
  };
  const streamRows = async function* (paths, offsetsPaths = null) {
    for (let i = 0; i < paths.length; i += 1) {
      const partPath = paths[i];
      const offsetsPath = Array.isArray(offsetsPaths) ? offsetsPaths[i] : null;
      if (offsetsPath) {
        await ensureOffsetsValid(partPath, offsetsPath);
      }
      for await (const row of readJsonLinesIterator(partPath, {
        maxBytes,
        requiredKeys: resolvedKeys,
        validationMode,
        maxInFlight,
        onBackpressure,
        onResume
      })) {
        yield validateFileMetaRow(row, 'file_meta');
      }
    }
  };
  const yieldJsonRows = (payload, label, format) => {
    if (!Array.isArray(payload)) {
      throw new Error(`Invalid ${format} payload for ${label}`);
    }
    if (!materialize) {
      warnMaterializeFallback(dir, label, format);
    }
    return (function* () {
      for (const row of payload) {
        yield validateFileMetaRow(row, label);
      }
    })();
  };
  const yieldColumnarRows = (payload, label) => {
    const iterator = iterateColumnarRows(payload);
    if (!iterator) {
      throw new Error(`Invalid columnar payload for ${label}`);
    }
    if (!materialize) {
      warnMaterializeFallback(dir, label, 'columnar');
    }
    return (function* () {
      for (const row of iterator) {
        yield validateFileMetaRow(row, label);
      }
    })();
  };

  if (strict) {
    const sources = resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name: 'file_meta',
      strict: true,
      maxBytes
    });
    ensurePresent(sources, 'file_meta');
    if (sources.format === 'json') {
      if (sources.paths.length > 1) {
        throw new Error('Ambiguous JSON sources for file_meta');
      }
      const payload = readJsonFile(sources.paths[0], { maxBytes });
      for (const row of yieldJsonRows(payload, 'file_meta', 'json')) {
        yield row;
      }
      return;
    }
    if (sources.format === 'columnar') {
      if (sources.paths.length > 1) {
        throw new Error('Ambiguous columnar sources for file_meta');
      }
      const payload = readJsonFile(sources.paths[0], { maxBytes });
      for (const row of yieldColumnarRows(payload, 'file_meta')) {
        yield row;
      }
      return;
    }
    for await (const row of streamRows(sources.paths, sources.offsets)) {
      yield row;
    }
    return;
  }

  const manifestSources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: 'file_meta',
    strict: false,
    maxBytes
  });
  const sources = manifestSources || resolveJsonlArtifactSources(dir, 'file_meta');
  if (sources?.paths?.length) {
    const missingPaths = sources.paths.filter((target) => !existsOrBak(target));
    if (missingPaths.length) {
      const err = new Error(`Missing manifest parts for file_meta: ${missingPaths.join(', ')}`);
      err.code = 'ERR_ARTIFACT_PARTS_MISSING';
      throw err;
    }
    assertNoShardIndexGaps(sources.paths, 'file_meta');
    if (!manifestSources) warnNonStrictJsonFallback(dir, 'file_meta');
    if (sources.format === 'json') {
      if (sources.paths.length > 1) {
        throw new Error('Ambiguous JSON sources for file_meta');
      }
      try {
        const payload = readJsonFile(sources.paths[0], { maxBytes });
        for (const row of yieldJsonRows(payload, 'file_meta', 'json')) {
          yield row;
        }
        return;
      } catch (err) {
        if (err?.code !== 'ERR_JSON_TOO_LARGE') throw err;
        const fallback = resolveJsonlFallbackSources(dir, 'file_meta');
        if (!fallback) throw err;
        for await (const row of streamRows(fallback.paths, fallback.offsets)) {
          yield row;
        }
        return;
      }
    }
    if (sources.format === 'columnar') {
      if (sources.paths.length > 1) {
        throw new Error('Ambiguous columnar sources for file_meta');
      }
      try {
        const payload = readJsonFile(sources.paths[0], { maxBytes });
        for (const row of yieldColumnarRows(payload, 'file_meta')) {
          yield row;
        }
        return;
      } catch (err) {
        if (err?.code !== 'ERR_JSON_TOO_LARGE') throw err;
        const fallback = resolveJsonlFallbackSources(dir, 'file_meta');
        if (!fallback) throw err;
        for await (const row of streamRows(fallback.paths, fallback.offsets)) {
          yield row;
        }
        return;
      }
    }
    for await (const row of streamRows(sources.paths, sources.offsets)) {
      yield row;
    }
    return;
  }
  const jsonPath = path.join(dir, 'file_meta.json');
  if (existsOrBak(jsonPath)) {
    warnNonStrictJsonFallback(dir, 'file_meta');
    const payload = readJsonFile(jsonPath, { maxBytes });
    for (const row of yieldJsonRows(payload, 'file_meta', 'json')) {
      yield row;
    }
    return;
  }
  throw new Error('Missing index artifact: file_meta.json');
};

export const loadJsonObjectArtifact = async (
  dir,
  baseName,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true,
    fallbackPath = null
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  if (strict) {
    const sources = resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name: baseName,
      strict: true,
      maxBytes
    });
    if (sources?.paths?.length) {
      if (sources.format !== 'json') {
        throw new Error(`Unsupported JSON object format for ${baseName}: ${sources.format}`);
      }
      if (sources.paths.length > 1) {
        throw new Error(`Ambiguous JSON sources for ${baseName}`);
      }
      return readJsonFile(sources.paths[0], { maxBytes });
    }
    throw new Error(`Missing manifest entry for ${baseName}`);
  }
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    strict: false,
    maxBytes
  });
  if (sources?.paths?.length) {
    if (sources.format !== 'json') {
      throw new Error(`Unsupported JSON object format for ${baseName}: ${sources.format}`);
    }
    if (sources.paths.length > 1) {
      throw new Error(`Ambiguous JSON sources for ${baseName}`);
    }
    return readJsonFile(sources.paths[0], { maxBytes });
  }
  if (fallbackPath && existsOrBak(fallbackPath)) {
    warnNonStrictJsonFallback(dir, baseName);
    return readJsonFile(fallbackPath, { maxBytes });
  }
  const jsonPath = path.join(dir, `${baseName}.json`);
  if (existsOrBak(jsonPath)) {
    warnNonStrictJsonFallback(dir, baseName);
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error(`Missing index artifact: ${baseName}.json`);
};

export const loadJsonObjectArtifactSync = (
  dir,
  baseName,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true,
    fallbackPath = null
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  if (strict) {
    const sources = resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name: baseName,
      strict: true,
      maxBytes
    });
    if (sources?.paths?.length) {
      if (sources.format !== 'json') {
        throw new Error(`Unsupported JSON object format for ${baseName}: ${sources.format}`);
      }
      if (sources.paths.length > 1) {
        throw new Error(`Ambiguous JSON sources for ${baseName}`);
      }
      return readJsonFile(sources.paths[0], { maxBytes });
    }
    throw new Error(`Missing manifest entry for ${baseName}`);
  }
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    strict: false,
    maxBytes
  });
  if (sources?.paths?.length) {
    if (sources.format !== 'json') {
      throw new Error(`Unsupported JSON object format for ${baseName}: ${sources.format}`);
    }
    if (sources.paths.length > 1) {
      throw new Error(`Ambiguous JSON sources for ${baseName}`);
    }
    return readJsonFile(sources.paths[0], { maxBytes });
  }
  if (fallbackPath && existsOrBak(fallbackPath)) {
    warnNonStrictJsonFallback(dir, baseName);
    return readJsonFile(fallbackPath, { maxBytes });
  }
  const jsonPath = path.join(dir, `${baseName}.json`);
  if (existsOrBak(jsonPath)) {
    warnNonStrictJsonFallback(dir, baseName);
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error(`Missing index artifact: ${baseName}.json`);
};

export const loadJsonArrayArtifactSync = (
  dir,
  baseName,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
    manifest = null,
    strict = true
  } = {}
) => {
  const validationMode = strict ? 'strict' : 'trusted';
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  if (strict) {
    const sources = resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name: baseName,
      strict: true,
      maxBytes
    });
    const resolvedKeys = requiredKeys ?? resolveJsonlRequiredKeys(baseName);
    if (sources?.paths?.length) {
      if (sources.format === 'json') {
        if (sources.paths.length > 1) {
          throw new Error(`Ambiguous JSON sources for ${baseName}`);
        }
        return readJsonFile(sources.paths[0], { maxBytes });
      }
      if (sources.format === 'columnar') {
        if (sources.paths.length > 1) {
          throw new Error(`Ambiguous columnar sources for ${baseName}`);
        }
        const payload = readJsonFile(sources.paths[0], { maxBytes });
        const inflated = inflateColumnarRows(payload);
        if (!inflated) throw new Error(`Invalid columnar payload for ${baseName}`);
        return inflated;
      }
      const out = [];
      for (const partPath of sources.paths) {
        const part = readJsonLinesArraySync(partPath, {
          maxBytes,
          requiredKeys: resolvedKeys,
          validationMode
        });
        for (const entry of part) out.push(entry);
      }
      return out;
    }
    throw new Error(`Missing manifest entry for ${baseName}`);
  }
  const manifestSources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    strict: false,
    maxBytes
  });
  const sources = manifestSources || resolveJsonlArtifactSources(dir, baseName);
  const resolvedKeys = requiredKeys ?? resolveJsonlRequiredKeys(baseName);
  if (sources?.paths?.length) {
    if (!manifestSources) warnNonStrictJsonFallback(dir, baseName);
    if (sources.format === 'json') {
      if (sources.paths.length > 1) {
        throw new Error(`Ambiguous JSON sources for ${baseName}`);
      }
      return readJsonFile(sources.paths[0], { maxBytes });
    }
    if (sources.format === 'columnar') {
      if (sources.paths.length > 1) {
        throw new Error(`Ambiguous columnar sources for ${baseName}`);
      }
      const payload = readJsonFile(sources.paths[0], { maxBytes });
      const inflated = inflateColumnarRows(payload);
      if (!inflated) throw new Error(`Invalid columnar payload for ${baseName}`);
      return inflated;
    }
    const out = [];
    for (const partPath of sources.paths) {
      const part = readJsonLinesArraySync(partPath, {
        maxBytes,
        requiredKeys: resolvedKeys,
        validationMode
      });
      for (const entry of part) out.push(entry);
    }
    return out;
  }
  const jsonPath = path.join(dir, `${baseName}.json`);
  if (existsOrBak(jsonPath)) {
    warnNonStrictJsonFallback(dir, baseName);
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error(`Missing index artifact: ${baseName}.json`);
};

export const loadGraphRelations = async (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const requiredKeys = resolveJsonlRequiredKeys('graph_relations');
  const validationMode = strict ? 'strict' : 'trusted';
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  if (strict) {
    const sources = resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name: 'graph_relations',
      strict: true,
      maxBytes
    });
    if (sources?.paths?.length) {
      if (sources.format === 'json') {
        if (sources.paths.length > 1) {
          throw new Error('Ambiguous JSON sources for graph_relations');
        }
        return readJsonFile(sources.paths[0], { maxBytes });
      }
      const payload = createGraphRelationsShell(sources.meta || null);
      for (const partPath of sources.paths) {
        for await (const entry of readJsonLinesIterator(partPath, {
          maxBytes,
          requiredKeys,
          validationMode
        })) {
          appendGraphRelationsEntry(payload, entry, partPath);
        }
      }
      return finalizeGraphRelations(payload);
    }
    throw new Error('Missing manifest entry for graph_relations');
  }

  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: 'graph_relations',
    strict: false,
    maxBytes
  });
  if (sources?.paths?.length) {
    if (sources.format === 'json') {
      if (sources.paths.length > 1) {
        throw new Error('Ambiguous JSON sources for graph_relations');
      }
      return readJsonFile(sources.paths[0], { maxBytes });
    }
    const payload = createGraphRelationsShell(sources.meta || null);
    for (const partPath of sources.paths) {
      for await (const entry of readJsonLinesIterator(partPath, {
        maxBytes,
        requiredKeys,
        validationMode
      })) {
        appendGraphRelationsEntry(payload, entry, partPath);
      }
    }
    return finalizeGraphRelations(payload);
  }

  const metaPath = path.join(dir, 'graph_relations.meta.json');
  const partsDir = path.join(dir, 'graph_relations.parts');
  if (existsOrBak(metaPath) || fs.existsSync(partsDir)) {
    const metaRaw = existsOrBak(metaPath) ? readJsonFileCached(metaPath, { maxBytes }) : null;
    const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
    const partList = normalizeMetaParts(meta?.parts);
    const parts = partList.length
      ? partList.map((name) => path.join(dir, name))
      : readShardFiles(partsDir, 'graph_relations.part-');
    if (!parts.length) {
      throw new Error(`Missing graph_relations shard files in ${partsDir}`);
    }
    const payload = createGraphRelationsShell(meta);
    for (const partPath of parts) {
      for await (const entry of readJsonLinesIterator(partPath, {
        maxBytes,
        requiredKeys,
        validationMode
      })) {
        appendGraphRelationsEntry(payload, entry, partPath);
      }
    }
    return finalizeGraphRelations(payload);
  }
  const jsonlPath = path.join(dir, 'graph_relations.jsonl');
  if (existsOrBak(jsonlPath)) {
    const payload = createGraphRelationsShell(null);
    for await (const entry of readJsonLinesIterator(jsonlPath, {
      maxBytes,
      requiredKeys,
      validationMode
    })) {
      appendGraphRelationsEntry(payload, entry, jsonlPath);
    }
    return finalizeGraphRelations(payload);
  }
  const jsonPath = path.join(dir, 'graph_relations.json');
  if (existsOrBak(jsonPath)) {
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error('Missing index artifact: graph_relations.json');
};

export const loadGraphRelationsCsr = async (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: 'graph_relations_csr',
    strict,
    maxBytes
  });
  if (sources?.paths?.length) {
    if (sources.format !== 'json') {
      throw new Error(`Unsupported manifest format for graph_relations_csr: ${sources.format}`);
    }
    if (sources.paths.length > 1) {
      throw new Error('Ambiguous JSON sources for graph_relations_csr');
    }
    const payload = readJsonFile(sources.paths[0], { maxBytes });
    return normalizeGraphRelationsCsr(payload, { strict });
  }
  if (strict) {
    throw new Error('Missing manifest entry for graph_relations_csr');
  }
  const legacyPath = path.join(dir, 'graph_relations.csr.json');
  if (existsOrBak(legacyPath)) {
    warnNonStrictJsonFallback(dir, 'graph_relations_csr');
    const payload = readJsonFile(legacyPath, { maxBytes });
    return normalizeGraphRelationsCsr(payload, { strict });
  }
  return null;
};

export const loadGraphRelationsSync = (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const requiredKeys = resolveJsonlRequiredKeys('graph_relations');
  const validationMode = strict ? 'strict' : 'trusted';
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  if (strict) {
    const sources = resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name: 'graph_relations',
      strict: true,
      maxBytes
    });
    if (sources?.paths?.length) {
      if (sources.format === 'json') {
        if (sources.paths.length > 1) {
          throw new Error('Ambiguous JSON sources for graph_relations');
        }
        return readJsonFile(sources.paths[0], { maxBytes });
      }
      const payload = createGraphRelationsShell(sources.meta || null);
      for (const partPath of sources.paths) {
        const entries = readJsonLinesArraySync(partPath, {
          maxBytes,
          requiredKeys,
          validationMode
        });
        appendGraphRelationsEntries(payload, entries, partPath);
      }
      return finalizeGraphRelations(payload);
    }
    throw new Error('Missing manifest entry for graph_relations');
  }

  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: 'graph_relations',
    strict: false,
    maxBytes
  });
  if (sources?.paths?.length) {
    if (sources.format === 'json') {
      if (sources.paths.length > 1) {
        throw new Error('Ambiguous JSON sources for graph_relations');
      }
      return readJsonFile(sources.paths[0], { maxBytes });
    }
    const payload = createGraphRelationsShell(sources.meta || null);
    for (const partPath of sources.paths) {
      const entries = readJsonLinesArraySync(partPath, {
        maxBytes,
        requiredKeys,
        validationMode
      });
      appendGraphRelationsEntries(payload, entries, partPath);
    }
    return finalizeGraphRelations(payload);
  }

  const metaPath = path.join(dir, 'graph_relations.meta.json');
  const partsDir = path.join(dir, 'graph_relations.parts');
  if (existsOrBak(metaPath) || fs.existsSync(partsDir)) {
    const metaRaw = existsOrBak(metaPath) ? readJsonFileCached(metaPath, { maxBytes }) : null;
    const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
    const partList = normalizeMetaParts(meta?.parts);
    const parts = partList.length
      ? partList.map((name) => path.join(dir, name))
      : readShardFiles(partsDir, 'graph_relations.part-');
    if (!parts.length) {
      throw new Error(`Missing graph_relations shard files in ${partsDir}`);
    }
    const payload = createGraphRelationsShell(meta);
    for (const partPath of parts) {
      const entries = readJsonLinesArraySync(partPath, {
        maxBytes,
        requiredKeys,
        validationMode
      });
      appendGraphRelationsEntries(payload, entries, partPath);
    }
    return finalizeGraphRelations(payload);
  }
  const jsonlPath = path.join(dir, 'graph_relations.jsonl');
  if (existsOrBak(jsonlPath)) {
    const payload = createGraphRelationsShell(null);
    const entries = readJsonLinesArraySync(jsonlPath, {
      maxBytes,
      requiredKeys,
      validationMode
    });
    appendGraphRelationsEntries(payload, entries, jsonlPath);
    return finalizeGraphRelations(payload);
  }
  const jsonPath = path.join(dir, 'graph_relations.json');
  if (existsOrBak(jsonPath)) {
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error('Missing index artifact: graph_relations.json');
};

export const loadGraphRelationsCsrSync = (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: 'graph_relations_csr',
    strict,
    maxBytes
  });
  if (sources?.paths?.length) {
    if (sources.format !== 'json') {
      throw new Error(`Unsupported manifest format for graph_relations_csr: ${sources.format}`);
    }
    if (sources.paths.length > 1) {
      throw new Error('Ambiguous JSON sources for graph_relations_csr');
    }
    const payload = readJsonFile(sources.paths[0], { maxBytes });
    return normalizeGraphRelationsCsr(payload, { strict });
  }
  if (strict) {
    throw new Error('Missing manifest entry for graph_relations_csr');
  }
  const legacyPath = path.join(dir, 'graph_relations.csr.json');
  if (existsOrBak(legacyPath)) {
    warnNonStrictJsonFallback(dir, 'graph_relations_csr');
    const payload = readJsonFile(legacyPath, { maxBytes });
    return normalizeGraphRelationsCsr(payload, { strict });
  }
  return null;
};

const inflatePackedTokenIds = (chunkMeta) => {
  if (!Array.isArray(chunkMeta)) return chunkMeta;
  for (const entry of chunkMeta) {
    if (!entry || typeof entry !== 'object') continue;
    if (Array.isArray(entry.tokenIds)) continue;
    const packed = entry.token_ids_packed;
    if (typeof packed !== 'string' || !packed) continue;
    const buffer = Buffer.from(packed, 'base64');
    const decoded = decodeVarint64List(buffer);
    entry.tokenIds = decoded.map((value) => formatHash64(value));
  }
  return chunkMeta;
};

const maybeInflatePackedTokenIds = (chunkMeta, materializeTokenIds) => (
  materializeTokenIds ? inflatePackedTokenIds(chunkMeta) : chunkMeta
);

const loadChunkMetaColdRows = async ({
  dir,
  maxBytes,
  manifest,
  strict,
  validationMode
}) => {
  const requiredKeys = ['id'];
  const sources = resolveManifestArtifactSources({
    dir,
    manifest,
    name: 'chunk_meta_cold',
    strict: false,
    maxBytes
  }) || resolveJsonlArtifactSources(dir, 'chunk_meta_cold');
  if (!sources?.paths?.length) return null;
  if (sources.format === 'json') {
    if (sources.paths.length > 1) {
      throw new Error('Ambiguous JSON sources for chunk_meta_cold');
    }
    const rows = readJsonFile(sources.paths[0], { maxBytes });
    return Array.isArray(rows) ? rows : null;
  }
  if (sources.format === 'columnar') {
    if (sources.paths.length > 1) {
      throw new Error('Ambiguous columnar sources for chunk_meta_cold');
    }
    const payload = readJsonFile(sources.paths[0], { maxBytes });
    const inflated = inflateColumnarRows(payload);
    if (!inflated) throw new Error('Invalid columnar chunk_meta_cold payload');
    return inflated;
  }
  return await readJsonLinesArray(sources.paths, {
    maxBytes,
    requiredKeys,
    validationMode
  });
};

const mergeChunkMetaColdRows = (hotRows, coldRows) => {
  if (!Array.isArray(hotRows) || !Array.isArray(coldRows) || !coldRows.length) {
    return hotRows;
  }
  const coldById = new Map();
  for (const row of coldRows) {
    const id = Number(row?.id);
    if (!Number.isFinite(id)) continue;
    coldById.set(id, row);
  }
  if (!coldById.size) return hotRows;
  for (let i = 0; i < hotRows.length; i += 1) {
    const hot = hotRows[i];
    const id = Number(hot?.id);
    if (!Number.isFinite(id)) continue;
    const cold = coldById.get(id);
    if (!cold) continue;
    hotRows[i] = mergeChunkMetaColdFields(hot, cold);
  }
  return hotRows;
};

export const loadChunkMeta = async (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true,
    preferBinaryColumnar = false,
    materializeTokenIds = false,
    includeCold = true
  } = {}
) => {
  const requiredKeys = resolveJsonlRequiredKeys('chunk_meta');
  const validationMode = strict ? 'strict' : 'trusted';
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  const maybeMergeCold = async (rows) => {
    if (!includeCold) return rows;
    const coldRows = await loadChunkMetaColdRows({
      dir,
      maxBytes,
      manifest: resolvedManifest,
      strict,
      validationMode
    });
    return mergeChunkMetaColdRows(rows, coldRows);
  };
  const loadChunkMetaJsonlFallback = async () => {
    const fallback = resolveJsonlFallbackSources(dir, 'chunk_meta');
    if (!fallback?.paths?.length) return null;
    const rows = await readJsonLinesArray(fallback.paths, {
      maxBytes,
      requiredKeys,
      validationMode
    });
    const merged = await maybeMergeCold(rows);
    return maybeInflatePackedTokenIds(merged, materializeTokenIds);
  };
  if (preferBinaryColumnar) {
    const binaryRows = tryLoadChunkMetaBinaryColumnar(dir, { maxBytes });
    if (binaryRows) {
      const merged = await maybeMergeCold(binaryRows);
      return maybeInflatePackedTokenIds(merged, materializeTokenIds);
    }
  }
  if (strict) {
    const sources = resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name: 'chunk_meta',
      strict: true,
      maxBytes
    });
    if (sources?.paths?.length) {
      if (sources.format === 'json') {
        if (sources.paths.length > 1) {
          throw new Error('Ambiguous JSON sources for chunk_meta');
        }
        const rows = readJsonFile(sources.paths[0], { maxBytes });
        const merged = await maybeMergeCold(rows);
        return maybeInflatePackedTokenIds(merged, materializeTokenIds);
      }
      if (sources.format === 'columnar') {
        if (sources.paths.length > 1) {
          throw new Error('Ambiguous columnar sources for chunk_meta');
        }
        const payload = readJsonFile(sources.paths[0], { maxBytes });
        const inflated = inflateColumnarRows(payload);
        if (!inflated) throw new Error('Invalid columnar chunk_meta payload');
        const merged = await maybeMergeCold(inflated);
        return maybeInflatePackedTokenIds(merged, materializeTokenIds);
      }
      if (sources.format === 'binary-columnar') {
        const binaryRows = tryLoadChunkMetaBinaryColumnar(dir, { maxBytes });
        if (!binaryRows) {
          throw new Error('Invalid binary-columnar chunk_meta payload');
        }
        const merged = await maybeMergeCold(binaryRows);
        return maybeInflatePackedTokenIds(merged, materializeTokenIds);
      }
      const rows = await readJsonLinesArray(sources.paths, {
        maxBytes,
        requiredKeys,
        validationMode
      });
      const merged = await maybeMergeCold(rows);
      return maybeInflatePackedTokenIds(merged, materializeTokenIds);
    }
    throw new Error('Missing manifest entry for chunk_meta');
  }

  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: 'chunk_meta',
    strict: false,
    maxBytes
  }) || resolveJsonlArtifactSources(dir, 'chunk_meta');
  if (sources?.paths?.length) {
    if (sources.format === 'json') {
      if (sources.paths.length > 1) {
        throw new Error('Ambiguous JSON sources for chunk_meta');
      }
      try {
        const rows = readJsonFile(sources.paths[0], { maxBytes });
        const merged = await maybeMergeCold(rows);
        return maybeInflatePackedTokenIds(merged, materializeTokenIds);
      } catch (err) {
        if (err?.code !== 'ERR_JSON_TOO_LARGE') throw err;
        const fallbackRows = await loadChunkMetaJsonlFallback();
        if (fallbackRows) return fallbackRows;
        throw err;
      }
    }
    if (sources.format === 'columnar') {
      if (sources.paths.length > 1) {
        throw new Error('Ambiguous columnar sources for chunk_meta');
      }
      try {
        const payload = readJsonFile(sources.paths[0], { maxBytes });
        const inflated = inflateColumnarRows(payload);
        if (!inflated) throw new Error('Invalid columnar chunk_meta payload');
        const merged = await maybeMergeCold(inflated);
        return maybeInflatePackedTokenIds(merged, materializeTokenIds);
      } catch (err) {
        if (err?.code !== 'ERR_JSON_TOO_LARGE') throw err;
        const fallbackRows = await loadChunkMetaJsonlFallback();
        if (fallbackRows) return fallbackRows;
        throw err;
      }
    }
    if (sources.format === 'binary-columnar') {
      const binaryRows = tryLoadChunkMetaBinaryColumnar(dir, { maxBytes });
      if (!binaryRows) {
        throw new Error('Invalid binary-columnar chunk_meta payload');
      }
      const merged = await maybeMergeCold(binaryRows);
      return maybeInflatePackedTokenIds(merged, materializeTokenIds);
    }
    const rows = await readJsonLinesArray(sources.paths, {
      maxBytes,
      requiredKeys,
      validationMode
    });
    const merged = await maybeMergeCold(rows);
    return maybeInflatePackedTokenIds(merged, materializeTokenIds);
  }

  const columnarPath = path.join(dir, 'chunk_meta.columnar.json');
  const binaryMetaPath = path.join(dir, 'chunk_meta.binary-columnar.meta.json');
  if (existsOrBak(binaryMetaPath)) {
    warnNonStrictJsonFallback(dir, 'chunk_meta');
    const binaryRows = tryLoadChunkMetaBinaryColumnar(dir, { maxBytes });
    if (binaryRows) {
      const merged = await maybeMergeCold(binaryRows);
      return maybeInflatePackedTokenIds(merged, materializeTokenIds);
    }
  }
  if (existsOrBak(columnarPath)) {
    warnNonStrictJsonFallback(dir, 'chunk_meta');
    const payload = readJsonFile(columnarPath, { maxBytes });
    const inflated = inflateColumnarRows(payload);
    if (!inflated) throw new Error('Invalid columnar chunk_meta payload');
    const merged = await maybeMergeCold(inflated);
    return maybeInflatePackedTokenIds(merged, materializeTokenIds);
  }
  const jsonPath = path.join(dir, 'chunk_meta.json');
  if (existsOrBak(jsonPath)) {
    try {
      const rows = readJsonFile(jsonPath, { maxBytes });
      const merged = await maybeMergeCold(rows);
      return maybeInflatePackedTokenIds(merged, materializeTokenIds);
    } catch (err) {
      if (err?.code !== 'ERR_JSON_TOO_LARGE') throw err;
      const fallbackRows = await loadChunkMetaJsonlFallback();
      if (fallbackRows) return fallbackRows;
      throw err;
    }
  }
  throw new Error('Missing index artifact: chunk_meta.json');
};

export const loadTokenPostings = (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true,
    preferBinaryColumnar = false,
    packedWindowTokens = 1024,
    packedWindowBytes = 16 * 1024 * 1024
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  const loadPacked = (packedPath) => {
    const metaPath = path.join(dir, 'token_postings.packed.meta.json');
    if (!existsOrBak(packedPath)) {
      throw new Error('Missing token_postings packed data');
    }
    if (!existsOrBak(metaPath)) {
      throw new Error('Missing token_postings packed meta');
    }
    const metaRaw = readJsonFileCached(metaPath, { maxBytes });
    const fields = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
    const arrays = metaRaw?.arrays && typeof metaRaw.arrays === 'object' ? metaRaw.arrays : metaRaw;
    const vocab = Array.isArray(arrays?.vocab) ? arrays.vocab : [];
    const vocabIds = Array.isArray(arrays?.vocabIds) ? arrays.vocabIds : [];
    const docLengths = Array.isArray(arrays?.docLengths) ? arrays.docLengths : [];
    const offsetsName = typeof fields?.offsets === 'string'
      ? fields.offsets
      : 'token_postings.packed.offsets.bin';
    const offsetsPath = path.join(dir, offsetsName);
    if (!existsOrBak(offsetsPath)) {
      throw new Error('Missing token_postings packed offsets');
    }
    const offsetsBuffer = fs.readFileSync(offsetsPath);
    const offsets = decodePackedOffsets(offsetsBuffer);
    const blockSize = Number.isFinite(Number(fields?.blockSize))
      ? Math.max(1, Math.floor(Number(fields.blockSize)))
      : DEFAULT_PACKED_BLOCK_SIZE;
    const totalTokens = Math.max(0, offsets.length - 1);
    const postings = new Array(totalTokens);
    const resolvedWindowTokens = Number.isFinite(Number(packedWindowTokens))
      ? Math.max(1, Math.floor(Number(packedWindowTokens)))
      : 1024;
    const resolvedWindowBytes = Number.isFinite(Number(packedWindowBytes))
      ? Math.max(1024, Math.floor(Number(packedWindowBytes)))
      : (16 * 1024 * 1024);
    const readWindow = (fd, startToken, endToken) => {
      const byteStart = offsets[startToken] ?? 0;
      const byteEnd = offsets[endToken] ?? byteStart;
      const byteLen = Math.max(0, byteEnd - byteStart);
      if (!byteLen) {
        for (let i = startToken; i < endToken; i += 1) {
          postings[i] = [];
        }
        return;
      }
      const windowBuffer = Buffer.allocUnsafe(byteLen);
      const bytesRead = fs.readSync(fd, windowBuffer, 0, byteLen, byteStart);
      if (bytesRead < byteLen) {
        throw new Error('Packed token_postings truncated');
      }
      for (let i = startToken; i < endToken; i += 1) {
        const localStart = (offsets[i] ?? 0) - byteStart;
        const localEnd = (offsets[i + 1] ?? localStart) - byteStart;
        if (localEnd <= localStart) {
          postings[i] = [];
          continue;
        }
        postings[i] = unpackTfPostingSlice(windowBuffer.subarray(localStart, localEnd), { blockSize });
      }
    };
    const fallbackFullRead = () => {
      const buffer = fs.readFileSync(packedPath);
      return unpackTfPostings(buffer, offsets, { blockSize });
    };
    let fd = null;
    try {
      fd = fs.openSync(packedPath, 'r');
      let startToken = 0;
      while (startToken < totalTokens) {
        let endToken = Math.min(totalTokens, startToken + resolvedWindowTokens);
        // Keep each decode window bounded in bytes for lower peak RSS.
        while (endToken < totalTokens) {
          const candidateBytes = (offsets[endToken] ?? 0) - (offsets[startToken] ?? 0);
          if (candidateBytes >= resolvedWindowBytes) break;
          endToken += 1;
        }
        if (endToken <= startToken) {
          endToken = Math.min(totalTokens, startToken + 1);
        }
        readWindow(fd, startToken, endToken);
        startToken = endToken;
      }
    } catch {
      return {
        ...fields,
        avgDocLen: Number.isFinite(fields?.avgDocLen) ? fields.avgDocLen : (
          docLengths.length
            ? docLengths.reduce((sum, len) => sum + (Number(len) || 0), 0) / docLengths.length
            : 0
        ),
        totalDocs: Number.isFinite(fields?.totalDocs) ? fields.totalDocs : docLengths.length,
        vocab,
        ...(vocabIds.length ? { vocabIds } : {}),
        postings: fallbackFullRead(),
        docLengths
      };
    } finally {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch {}
      }
    }
    const avgDocLen = Number.isFinite(fields?.avgDocLen) ? fields.avgDocLen : (
      docLengths.length
        ? docLengths.reduce((sum, len) => sum + (Number(len) || 0), 0) / docLengths.length
        : 0
    );
    return {
      ...fields,
      avgDocLen,
      totalDocs: Number.isFinite(fields?.totalDocs) ? fields.totalDocs : docLengths.length,
      vocab,
      ...(vocabIds.length ? { vocabIds } : {}),
      postings,
      docLengths
    };
  };
  const loadSharded = (meta, shardPaths, shardsDir) => {
    if (!Array.isArray(shardPaths) || shardPaths.length === 0) {
      throw new Error(`Missing token_postings shard files in ${shardsDir}`);
    }
    const vocab = [];
    const vocabIds = [];
    const postings = [];
    const pushChunked = (target, items) => {
      const CHUNK = 4096;
      for (let i = 0; i < items.length; i += CHUNK) {
        target.push(...items.slice(i, i + CHUNK));
      }
    };
    for (const shardPath of shardPaths) {
      const shard = readJsonFile(shardPath, { maxBytes });
      const shardVocab = Array.isArray(shard?.vocab)
        ? shard.vocab
        : (Array.isArray(shard?.arrays?.vocab) ? shard.arrays.vocab : []);
      const shardVocabIds = Array.isArray(shard?.vocabIds)
        ? shard.vocabIds
        : (Array.isArray(shard?.arrays?.vocabIds) ? shard.arrays.vocabIds : []);
      const shardPostings = Array.isArray(shard?.postings)
        ? shard.postings
        : (Array.isArray(shard?.arrays?.postings) ? shard.arrays.postings : []);
      if (shardVocab.length) pushChunked(vocab, shardVocab);
      if (shardVocabIds.length) pushChunked(vocabIds, shardVocabIds);
      if (shardPostings.length) pushChunked(postings, shardPostings);
    }
    const docLengths = Array.isArray(meta?.docLengths)
      ? meta.docLengths
      : (Array.isArray(meta?.arrays?.docLengths) ? meta.arrays.docLengths : []);
    return {
      ...meta,
      vocab,
      ...(vocabIds.length ? { vocabIds } : {}),
      postings,
      docLengths
    };
  };
  if (preferBinaryColumnar) {
    const binary = tryLoadTokenPostingsBinaryColumnar(dir, { maxBytes });
    if (binary) return binary;
  }
  if (strict) {
    const sources = resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name: 'token_postings',
      strict: true,
      maxBytes
    });
    if (sources?.paths?.length) {
      if (sources.format === 'json') {
        if (sources.paths.length > 1) {
          throw new Error('Ambiguous JSON sources for token_postings');
        }
        return readJsonFile(sources.paths[0], { maxBytes });
      }
      if (sources.format === 'packed') {
        if (sources.paths.length > 1) {
          throw new Error('Ambiguous packed sources for token_postings');
        }
        return loadPacked(sources.paths[0]);
      }
      if (sources.format === 'sharded') {
        return loadSharded(sources.meta || {}, sources.paths, path.join(dir, 'token_postings.shards'));
      }
      if (sources.format === 'binary-columnar') {
        const binary = tryLoadTokenPostingsBinaryColumnar(dir, { maxBytes });
        if (binary) return binary;
      }
      throw new Error(`Unsupported token_postings format: ${sources.format}`);
    }
    throw new Error('Missing manifest entry for token_postings');
  }

  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: 'token_postings',
    strict: false,
    maxBytes
  });
  if (sources?.paths?.length) {
    if (sources.format === 'json') {
      if (sources.paths.length > 1) {
        throw new Error('Ambiguous JSON sources for token_postings');
      }
      return readJsonFile(sources.paths[0], { maxBytes });
    }
    if (sources.format === 'packed') {
      if (sources.paths.length > 1) {
        throw new Error('Ambiguous packed sources for token_postings');
      }
      return loadPacked(sources.paths[0]);
    }
    if (sources.format === 'sharded') {
      return loadSharded(sources.meta || {}, sources.paths, path.join(dir, 'token_postings.shards'));
    }
    if (sources.format === 'binary-columnar') {
      const binary = tryLoadTokenPostingsBinaryColumnar(dir, { maxBytes });
      if (binary) return binary;
    }
    throw new Error(`Unsupported token_postings format: ${sources.format}`);
  }

  const binaryTokenPostings = tryLoadTokenPostingsBinaryColumnar(dir, { maxBytes });
  if (binaryTokenPostings) {
    warnNonStrictJsonFallback(dir, 'token_postings');
    return binaryTokenPostings;
  }
  const packedPath = path.join(dir, 'token_postings.packed.bin');
  if (existsOrBak(packedPath)) {
    warnNonStrictJsonFallback(dir, 'token_postings');
    return loadPacked(packedPath);
  }
  const metaPath = path.join(dir, 'token_postings.meta.json');
  const shardsDir = path.join(dir, 'token_postings.shards');
  if (existsOrBak(metaPath) || fs.existsSync(shardsDir)) {
    const meta = existsOrBak(metaPath) ? readJsonFileCached(metaPath, { maxBytes }) : {};
    const partList = normalizeMetaParts(meta?.parts);
    const shards = partList.length
      ? partList.map((name) => path.join(dir, name))
      : readShardFiles(shardsDir, 'token_postings.part-');
    return loadSharded(meta, shards, shardsDir);
  }
  const jsonPath = path.join(dir, 'token_postings.json');
  if (existsOrBak(jsonPath)) {
    return readJsonFile(jsonPath, { maxBytes });
  }
  throw new Error('Missing index artifact: token_postings.json');
};

export const loadMinhashSignatures = async (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const packedPath = path.join(dir, 'minhash_signatures.packed.bin');
  const metaPath = path.join(dir, 'minhash_signatures.packed.meta.json');
  if (existsOrBak(packedPath) && existsOrBak(metaPath)) {
    const metaRaw = readJsonFileCached(metaPath, { maxBytes });
    const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
    const dims = Number.isFinite(Number(meta?.dims)) ? Math.max(0, Math.floor(Number(meta.dims))) : 0;
    const count = Number.isFinite(Number(meta?.count)) ? Math.max(0, Math.floor(Number(meta.count))) : 0;
    if (!dims || !count) {
      throw new Error('Invalid packed minhash meta');
    }
    const checksumValidator = createPackedChecksumValidator(meta, {
      label: 'Packed minhash signatures'
    });
    const buffer = fs.readFileSync(packedPath);
    checksumValidator?.update(buffer);
    checksumValidator?.verify();
    const total = dims * count;
    const view = new Uint32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4));
    if (view.length < total) {
      throw new Error('Packed minhash signatures truncated');
    }
    const signatures = new Array(count);
    for (let i = 0; i < count; i += 1) {
      const start = i * dims;
      signatures[i] = view.subarray(start, start + dims);
    }
    return { signatures };
  }
  try {
    return await loadJsonObjectArtifact(dir, 'minhash_signatures', { maxBytes, manifest, strict });
  } catch (err) {
    const message = err?.message || '';
    if (message.includes('Missing manifest entry for minhash_signatures')
      || message.includes('Missing index artifact: minhash_signatures.json')) {
      return null;
    }
    throw err;
  }
};

export const loadMinhashSignatureRows = async function* (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true,
    materialize = false,
    batchSize = 2048
  } = {}
) {
  const packedPath = path.join(dir, 'minhash_signatures.packed.bin');
  const metaPath = path.join(dir, 'minhash_signatures.packed.meta.json');
  if (existsOrBak(packedPath) && existsOrBak(metaPath)) {
    const metaRaw = readJsonFileCached(metaPath, { maxBytes });
    const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
    const dims = Number.isFinite(Number(meta?.dims)) ? Math.max(0, Math.floor(Number(meta.dims))) : 0;
    const count = Number.isFinite(Number(meta?.count)) ? Math.max(0, Math.floor(Number(meta.count))) : 0;
    if (!dims || !count) {
      throw new Error('Invalid packed minhash meta');
    }
    const checksumValidator = createPackedChecksumValidator(meta, {
      label: 'Packed minhash signatures'
    });
    const bytesPerSig = dims * 4;
    const totalBytes = bytesPerSig * count;
    const stat = await fsPromises.stat(packedPath);
    if (stat.size < totalBytes) {
      throw new Error('Packed minhash signatures truncated');
    }
    const handle = await fsPromises.open(packedPath, 'r');
    const resolvedBatchSize = Math.max(1, Math.floor(Number(batchSize)) || 2048);
    const buffer = Buffer.allocUnsafe(resolvedBatchSize * bytesPerSig);
    try {
      let docId = 0;
      while (docId < count) {
        const remaining = count - docId;
        const batchCount = Math.min(resolvedBatchSize, remaining);
        const bytesToRead = batchCount * bytesPerSig;
        const { bytesRead } = await handle.read(buffer, 0, bytesToRead, docId * bytesPerSig);
        if (bytesRead < bytesToRead) {
          throw new Error('Packed minhash signatures truncated');
        }
        checksumValidator?.update(buffer, 0, bytesRead);
        const view = new Uint32Array(buffer.buffer, buffer.byteOffset, bytesRead / 4);
        for (let i = 0; i < batchCount; i += 1) {
          const start = i * dims;
          const end = start + dims;
          // Copy each signature out of the reusable batch buffer so later reads
          // cannot mutate previously yielded rows.
          const sig = Uint32Array.from(view.subarray(start, end));
          yield { docId: docId + i, sig };
        }
        docId += batchCount;
      }
      checksumValidator?.verify();
    } finally {
      await handle.close();
    }
    return;
  }
  let payload = null;
  try {
    payload = await loadJsonObjectArtifact(dir, 'minhash_signatures', { maxBytes, manifest, strict });
  } catch (err) {
    const message = err?.message || '';
    if (message.includes('Missing manifest entry for minhash_signatures')
      || message.includes('Missing index artifact: minhash_signatures.json')) {
      return;
    }
    throw err;
  }
  const signatures = Array.isArray(payload?.signatures) ? payload.signatures : null;
  if (!signatures) return;
  if (!materialize) {
    warnMaterializeFallback(dir, 'minhash_signatures', 'json');
  }
  for (let docId = 0; docId < signatures.length; docId += 1) {
    const sig = signatures[docId];
    if (!sig) continue;
    yield { docId, sig };
  }
};

const resolvePerFileMetaPath = (dir, baseName, { manifest, strict, maxBytes }) => {
  const metaName = `${baseName}_by_file_meta`;
  const sources = resolveManifestArtifactSources({
    dir,
    manifest,
    name: metaName,
    strict,
    maxBytes
  });
  if (sources?.paths?.length) {
    return sources.paths[0];
  }
  if (!strict) {
    const fallback = path.join(dir, `${baseName}.by-file.meta.json`);
    return existsOrBak(fallback) ? fallback : null;
  }
  return null;
};

const loadPerFileIndexMeta = (dir, baseName, { manifest, strict, maxBytes }) => {
  const metaPath = resolvePerFileMetaPath(dir, baseName, { manifest, strict, maxBytes });
  if (!metaPath) return null;
  const metaRaw = readJsonFileCached(metaPath, { maxBytes });
  const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
  if (!meta || typeof meta !== 'object') return null;
  return { meta, metaPath };
};

const resolveRowSourcesFromPerFileMeta = (dir, meta) => {
  const jsonl = meta?.jsonl && typeof meta.jsonl === 'object' ? meta.jsonl : null;
  const parts = Array.isArray(jsonl?.parts) ? jsonl.parts : [];
  const counts = Array.isArray(jsonl?.counts) ? jsonl.counts : [];
  const offsets = Array.isArray(jsonl?.offsets) ? jsonl.offsets : [];
  if (!parts.length || parts.length !== counts.length || offsets.length !== parts.length) {
    return null;
  }
  const resolvedParts = parts.map((rel) => path.join(dir, fromPosix(rel)));
  const resolvedOffsets = offsets.map((rel) => path.join(dir, fromPosix(rel)));
  return { parts: resolvedParts, offsets: resolvedOffsets, counts };
};

const resolvePartIndex = (counts, index) => {
  let cursor = 0;
  for (let i = 0; i < counts.length; i += 1) {
    const count = Number.isFinite(counts[i]) ? counts[i] : 0;
    if (index < cursor + count) {
      return { partIndex: i, localIndex: index - cursor };
    }
    cursor += count;
  }
  return null;
};

const loadSymbolRowsForFile = async (
  dir,
  baseName,
  {
    fileId,
    filePath,
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  let resolvedFileId = Number.isFinite(fileId) ? fileId : null;
  if (!Number.isFinite(resolvedFileId) && filePath) {
    try {
      const fileMeta = await loadJsonArrayArtifact(dir, 'file_meta', {
        maxBytes,
        manifest: resolvedManifest,
        strict
      });
      if (Array.isArray(fileMeta)) {
        const match = fileMeta.find((entry) => entry?.file === filePath);
        if (match && Number.isFinite(match.id)) {
          resolvedFileId = match.id;
        }
      }
    } catch {}
  }
  let resolvedFilePath = filePath || null;
  if (!resolvedFilePath && Number.isFinite(resolvedFileId)) {
    try {
      const fileMeta = await loadJsonArrayArtifact(dir, 'file_meta', {
        maxBytes,
        manifest: resolvedManifest,
        strict
      });
      if (Array.isArray(fileMeta)) {
        const match = fileMeta.find((entry) => entry?.id === resolvedFileId);
        if (match?.file) {
          resolvedFilePath = match.file;
        }
      }
    } catch {}
  }
  if (!Number.isFinite(resolvedFileId)) {
    return [];
  }

  const loadFullRows = async () => {
    if (!resolvedFilePath) return [];
    const full = await loadJsonArrayArtifact(dir, baseName, {
      maxBytes,
      manifest: resolvedManifest,
      strict
    });
    const filterField = baseName === 'symbol_edges' ? 'from' : 'host';
    return Array.isArray(full)
      ? full.filter((row) => row?.[filterField]?.file === resolvedFilePath)
      : [];
  };

  const perFileMeta = loadPerFileIndexMeta(dir, baseName, {
    manifest: resolvedManifest,
    strict,
    maxBytes
  });
  if (!perFileMeta?.meta) {
    return loadFullRows();
  }

  const meta = perFileMeta.meta;
  const offsetsInfo = meta?.offsets && typeof meta.offsets === 'object' ? meta.offsets : null;
  if (!offsetsInfo?.path || !meta?.data) return loadFullRows();
  if (offsetsInfo.format && offsetsInfo.format !== OFFSETS_FORMAT) return loadFullRows();
  if (offsetsInfo.version && offsetsInfo.version !== OFFSETS_FORMAT_VERSION) return loadFullRows();
  if (offsetsInfo.compression && offsetsInfo.compression !== OFFSETS_COMPRESSION) return loadFullRows();
  const dataPath = path.join(dir, fromPosix(meta.data));
  const offsetsPath = path.join(dir, fromPosix(offsetsInfo.path));
  const sources = resolveRowSourcesFromPerFileMeta(dir, meta);
  if (!sources) return loadFullRows();
  if (!existsOrBak(dataPath) || !existsOrBak(offsetsPath)) return loadFullRows();
  if (!sources.parts.every(existsOrBak) || !sources.offsets.every(existsOrBak)) {
    return loadFullRows();
  }
  let offsetsCount;
  let start;
  let end;
  let rowIndexes;
  try {
    offsetsCount = await resolveOffsetsCount(offsetsPath);
    if (resolvedFileId + 1 >= offsetsCount) return loadFullRows();
    const offsets = await readOffsetsAt(offsetsPath, [resolvedFileId, resolvedFileId + 1]);
    start = offsets.get(resolvedFileId);
    end = offsets.get(resolvedFileId + 1);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return loadFullRows();
    if (end < start) return loadFullRows();
    if (end === start) return [];
    rowIndexes = await readVarintDeltasAt(dataPath, start, end);
  } catch {
    return loadFullRows();
  }
  if (!rowIndexes.length) {
    return end > start ? loadFullRows() : [];
  }
  const requiredKeys = resolveJsonlRequiredKeys(baseName);
  const rows = [];
  const validatedParts = new Set();
  const rowsByPart = new Map();
  for (const rowIndex of rowIndexes) {
    const resolved = resolvePartIndex(sources.counts, rowIndex);
    if (!resolved) continue;
    const partPath = sources.parts[resolved.partIndex];
    const partOffsets = sources.offsets[resolved.partIndex];
    if (!validatedParts.has(resolved.partIndex)) {
      try {
        await ensureOffsetsValid(partPath, partOffsets);
        validatedParts.add(resolved.partIndex);
      } catch {
        return loadFullRows();
      }
    }
    const key = String(resolved.partIndex);
    const bucket = rowsByPart.get(key) || {
      partPath,
      partOffsets,
      localIndexes: []
    };
    bucket.localIndexes.push(resolved.localIndex);
    rowsByPart.set(key, bucket);
  }
  for (const bucket of rowsByPart.values()) {
    const fetched = await readJsonlRowsAt(
      bucket.partPath,
      bucket.partOffsets,
      bucket.localIndexes,
      { maxBytes, requiredKeys }
    );
    for (const row of fetched) {
      if (row) rows.push(row);
    }
  }
  return rows;
};

const loadBinaryColumnarRowPayloads = ({
  dataPath,
  offsetsPath,
  lengthsPath,
  count
}) => {
  if (!existsOrBak(dataPath) || !existsOrBak(offsetsPath) || !existsOrBak(lengthsPath)) {
    return null;
  }
  const dataBuffer = fs.readFileSync(dataPath);
  const offsets = decodeU64Offsets(fs.readFileSync(offsetsPath));
  const lengths = decodeBinaryRowFrameLengths(fs.readFileSync(lengthsPath));
  if (!Number.isFinite(count) || count < 0) return null;
  if (offsets.length < count || lengths.length < count) {
    throw new Error('Binary-columnar frame metadata count mismatch');
  }
  const rows = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const start = offsets[i];
    const length = lengths[i];
    if (!Number.isSafeInteger(start) || start < 0) {
      throw new Error(`Invalid binary-columnar row offset: ${start}`);
    }
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new Error(`Invalid binary-columnar row length: ${length}`);
    }
    const end = start + length;
    if (end > dataBuffer.length) {
      throw new Error('Binary-columnar data truncated');
    }
    rows[i] = dataBuffer.subarray(start, end);
  }
  return rows;
};

const tryLoadChunkMetaBinaryColumnar = (dir, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const metaPath = path.join(dir, 'chunk_meta.binary-columnar.meta.json');
  if (!existsOrBak(metaPath)) return null;
  const metaRaw = readJsonFileCached(metaPath, { maxBytes });
  const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
  const fileTable = Array.isArray(metaRaw?.arrays?.fileTable) ? metaRaw.arrays.fileTable : [];
  const count = Number.isFinite(Number(meta?.count)) ? Math.max(0, Math.floor(Number(meta.count))) : 0;
  if (!count) return [];
  const dataPath = path.join(dir, typeof meta?.data === 'string' ? meta.data : 'chunk_meta.binary-columnar.bin');
  const offsetsPath = path.join(
    dir,
    typeof meta?.offsets === 'string' ? meta.offsets : 'chunk_meta.binary-columnar.offsets.bin'
  );
  const lengthsPath = path.join(
    dir,
    typeof meta?.lengths === 'string' ? meta.lengths : 'chunk_meta.binary-columnar.lengths.varint'
  );
  const payloads = loadBinaryColumnarRowPayloads({
    dataPath,
    offsetsPath,
    lengthsPath,
    count
  });
  if (!payloads) return null;
  const rows = new Array(payloads.length);
  for (let i = 0; i < payloads.length; i += 1) {
    const row = JSON.parse(payloads[i].toString('utf8'));
    if (row && Number.isInteger(row.fileRef) && (row.file == null)) {
      row.file = fileTable[row.fileRef] ?? null;
      delete row.fileRef;
    }
    rows[i] = row;
  }
  return rows;
};

const decodePostingPairsVarint = (payload) => {
  const values = decodeVarint64List(payload);
  const postings = [];
  let docId = 0;
  for (let i = 0; i + 1 < values.length; i += 2) {
    const delta = Number(values[i]);
    const tf = Number(values[i + 1]);
    if (!Number.isFinite(delta) || !Number.isFinite(tf)) continue;
    docId += Math.max(0, Math.floor(delta));
    postings.push([docId, Math.max(0, Math.floor(tf))]);
  }
  return postings;
};

const tryLoadTokenPostingsBinaryColumnar = (dir, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const metaPath = path.join(dir, 'token_postings.binary-columnar.meta.json');
  if (!existsOrBak(metaPath)) return null;
  const metaRaw = readJsonFileCached(metaPath, { maxBytes });
  const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
  const arrays = metaRaw?.arrays && typeof metaRaw.arrays === 'object' ? metaRaw.arrays : {};
  const count = Number.isFinite(Number(meta?.count)) ? Math.max(0, Math.floor(Number(meta.count))) : 0;
  const dataPath = path.join(dir, typeof meta?.data === 'string' ? meta.data : 'token_postings.binary-columnar.bin');
  const offsetsPath = path.join(
    dir,
    typeof meta?.offsets === 'string' ? meta.offsets : 'token_postings.binary-columnar.offsets.bin'
  );
  const lengthsPath = path.join(
    dir,
    typeof meta?.lengths === 'string' ? meta.lengths : 'token_postings.binary-columnar.lengths.varint'
  );
  const payloads = loadBinaryColumnarRowPayloads({
    dataPath,
    offsetsPath,
    lengthsPath,
    count
  });
  if (!payloads) return null;
  const postings = new Array(payloads.length);
  for (let i = 0; i < payloads.length; i += 1) {
    postings[i] = decodePostingPairsVarint(payloads[i]);
  }
  const vocab = Array.isArray(arrays.vocab) ? arrays.vocab : [];
  const vocabIds = Array.isArray(arrays.vocabIds) ? arrays.vocabIds : [];
  const docLengths = Array.isArray(arrays.docLengths) ? arrays.docLengths : [];
  return {
    ...meta,
    vocab,
    ...(vocabIds.length ? { vocabIds } : {}),
    postings,
    docLengths
  };
};

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

export const loadSymbolOccurrencesByFile = async (dir, options = {}) => (
  loadSymbolRowsForFile(dir, 'symbol_occurrences', options)
);

export const loadSymbolEdgesByFile = async (dir, options = {}) => (
  loadSymbolRowsForFile(dir, 'symbol_edges', options)
);
