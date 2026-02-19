import path from 'node:path';
import { MAX_JSON_BYTES } from '../constants.js';
import { existsOrBak } from '../fs.js';
import { readJsonFile, readJsonLinesArray, readJsonLinesArraySync, readJsonLinesIterator } from '../json.js';
import { resolveJsonlRequiredKeys } from '../jsonl.js';
import { loadPiecesManifest, resolveManifestArtifactSources } from '../manifest.js';
import {
  warnNonStrictJsonFallback,
  warnMaterializeFallback,
  assertNoShardIndexGaps,
  ensureOffsetsValid,
  resolveJsonlArtifactSources,
  resolveJsonlFallbackSources,
  inflateColumnarRows,
  iterateColumnarRows
} from './shared.js';

/**
 * @typedef {object} LoadArrayArtifactOptions
 * @property {number} [maxBytes]
 * @property {string[]|null} [requiredKeys]
 * @property {object|null} [manifest]
 * @property {boolean} [strict]
 * @property {number|null} [concurrency]
 */

/**
 * Load array-style artifacts from manifest sources or legacy fallback paths.
 *
 * Supports JSON arrays, JSONL shards, and columnar JSON payloads.
 *
 * @param {string} dir
 * @param {string} baseName
 * @param {LoadArrayArtifactOptions} [options]
 * @returns {Promise<any[]>}
 */
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

/**
 * Stream array artifact rows from JSONL sources, optionally materializing JSON/columnar payloads.
 *
 * In strict mode, only manifest-declared sources are accepted.
 *
 * @param {string} dir
 * @param {string} baseName
 * @param {{
 *   maxBytes?: number,
 *   requiredKeys?: string[]|null,
 *   manifest?: object|null,
 *   strict?: boolean,
 *   materialize?: boolean,
 *   maxInFlight?: number,
 *   onBackpressure?: (() => void)|null,
 *   onResume?: (() => void)|null
 * }} [options]
 * @returns {AsyncGenerator<any, void, unknown>}
 */
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

/**
 * Validate a `file_meta` row shape used by per-file lookups.
 *
 * @param {any} row
 * @param {string} label
 * @returns {{ id: number, file: string } & object}
 */
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

/**
 * Stream `file_meta` rows while enforcing required shape and fallback policy.
 *
 * @param {string} dir
 * @param {{
 *   maxBytes?: number,
 *   manifest?: object|null,
 *   strict?: boolean,
 *   materialize?: boolean,
 *   maxInFlight?: number,
 *   onBackpressure?: (() => void)|null,
 *   onResume?: (() => void)|null
 * }} [options]
 * @returns {AsyncGenerator<object, void, unknown>}
 */
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

/**
 * Load object-style artifacts (single JSON object) from manifest or fallback paths.
 *
 * @param {string} dir
 * @param {string} baseName
 * @param {{
 *   maxBytes?: number,
 *   manifest?: object|null,
 *   strict?: boolean,
 *   fallbackPath?: string|null
 * }} [options]
 * @returns {Promise<any>}
 */
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

/**
 * Synchronous variant of {@link loadJsonObjectArtifact}.
 *
 * @param {string} dir
 * @param {string} baseName
 * @param {{
 *   maxBytes?: number,
 *   manifest?: object|null,
 *   strict?: boolean,
 *   fallbackPath?: string|null
 * }} [options]
 * @returns {any}
 */
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

/**
 * Synchronous variant of {@link loadJsonArrayArtifact}.
 *
 * @param {string} dir
 * @param {string} baseName
 * @param {{
 *   maxBytes?: number,
 *   requiredKeys?: string[]|null,
 *   manifest?: object|null,
 *   strict?: boolean
 * }} [options]
 * @returns {any[]}
 */
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
