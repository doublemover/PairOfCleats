import { MAX_JSON_BYTES } from '../constants.js';
import { existsOrBak } from '../fs.js';
import { readJsonFile, readJsonLinesArray, readJsonLinesArraySync, readJsonLinesIterator } from '../json.js';
import { resolveJsonlRequiredKeys } from '../jsonl.js';
import { loadPiecesManifest, resolveManifestArtifactSources } from '../manifest.js';
import {
  assertNoShardIndexGaps,
  ensureOffsetsValid,
  inflateColumnarRows,
  iterateColumnarRows
} from './shared.js';

const resolveManifestMaxBytes = (maxBytes) => (
  Number.isFinite(Number(maxBytes)) ? Number(maxBytes) : MAX_JSON_BYTES
);

const resolveRequiredSources = ({
  dir,
  manifest,
  name,
  maxBytes,
  strict
}) => {
  const sources = resolveManifestArtifactSources({
    dir,
    manifest,
    name,
    strict,
    maxBytes
  });
  if (!sources?.paths?.length) {
    throw new Error(`Missing manifest entry for ${name}`);
  }
  const missingPaths = sources.paths.filter((target) => !existsOrBak(target));
  if (missingPaths.length) {
    const err = new Error(`Missing manifest parts for ${name}: ${missingPaths.join(', ')}`);
    err.code = 'ERR_ARTIFACT_PARTS_MISSING';
    throw err;
  }
  if (sources.format === 'json' || sources.format === 'columnar') {
    if (sources.paths.length > 1) {
      throw new Error(`Ambiguous ${sources.format.toUpperCase()} sources for ${name}`);
    }
    return sources;
  }
  assertNoShardIndexGaps(sources.paths, name);
  return sources;
};

const loadArrayPayloadFromSources = async (
  sources,
  { baseName, maxBytes, requiredKeys, validationMode, concurrency = null }
) => {
  if (sources.format === 'json') {
    return readJsonFile(sources.paths[0], { maxBytes });
  }
  if (sources.format === 'columnar') {
    const payload = readJsonFile(sources.paths[0], { maxBytes });
    const inflated = inflateColumnarRows(payload);
    if (!inflated) throw new Error(`Invalid columnar payload for ${baseName}`);
    return inflated;
  }
  return await readJsonLinesArray(sources.paths, {
    maxBytes,
    requiredKeys,
    validationMode,
    concurrency
  });
};

const loadArrayPayloadFromSourcesSync = (
  sources,
  { baseName, maxBytes, requiredKeys, validationMode }
) => {
  if (sources.format === 'json') {
    return readJsonFile(sources.paths[0], { maxBytes });
  }
  if (sources.format === 'columnar') {
    const payload = readJsonFile(sources.paths[0], { maxBytes });
    const inflated = inflateColumnarRows(payload);
    if (!inflated) throw new Error(`Invalid columnar payload for ${baseName}`);
    return inflated;
  }
  const out = [];
  for (const partPath of sources.paths) {
    const part = readJsonLinesArraySync(partPath, {
      maxBytes,
      requiredKeys,
      validationMode
    });
    for (const entry of part) out.push(entry);
  }
  return out;
};

/**
 * @typedef {object} LoadArrayArtifactOptions
 * @property {number} [maxBytes]
 * @property {string[]|null} [requiredKeys]
 * @property {object|null} [manifest]
 * @property {boolean} [strict]
 * @property {number|null} [concurrency]
 */

/**
 * Load array-style artifacts from manifest-declared sources.
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
  const resolvedManifest = manifest || loadPiecesManifest(
    dir,
    { maxBytes: resolveManifestMaxBytes(maxBytes), strict: true }
  );
  const sources = resolveRequiredSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    maxBytes,
    strict
  });
  const resolvedKeys = requiredKeys ?? resolveJsonlRequiredKeys(baseName);
  return await loadArrayPayloadFromSources(sources, {
    baseName,
    maxBytes,
    requiredKeys: resolvedKeys,
    validationMode,
    concurrency
  });
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
  const resolvedManifest = manifest || loadPiecesManifest(
    dir,
    { maxBytes: resolveManifestMaxBytes(maxBytes), strict: true }
  );
  const resolvedKeys = requiredKeys ?? resolveJsonlRequiredKeys(baseName);
  void materialize;
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
  const sources = resolveRequiredSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    maxBytes,
    strict
  });
  if (sources.format === 'json') {
    const payload = readJsonFile(sources.paths[0], { maxBytes });
    const rows = Array.isArray(payload) ? payload : [];
    for (const row of rows) yield row;
    return;
  }
  if (sources.format === 'columnar') {
    const payload = readJsonFile(sources.paths[0], { maxBytes });
    const rows = iterateColumnarRows(payload);
    if (!rows) {
      throw new Error(`Invalid columnar payload for ${baseName}`);
    }
    for (const row of rows) yield row;
    return;
  }
  for await (const row of streamRows(sources.paths, sources.offsets)) {
    yield row;
  }
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
  const resolvedManifest = manifest || loadPiecesManifest(
    dir,
    { maxBytes: resolveManifestMaxBytes(maxBytes), strict: true }
  );
  const resolvedKeys = resolveJsonlRequiredKeys('file_meta');
  void materialize;
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
  const yieldJsonRows = (payload, label) => {
    if (!Array.isArray(payload)) {
      throw new Error(`Invalid json payload for ${label}`);
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
    return (function* () {
      for (const row of iterator) {
        yield validateFileMetaRow(row, label);
      }
    })();
  };
  const sources = resolveRequiredSources({
    dir,
    manifest: resolvedManifest,
    name: 'file_meta',
    maxBytes,
    strict
  });
  if (sources.format === 'json') {
    const payload = readJsonFile(sources.paths[0], { maxBytes });
    for (const row of yieldJsonRows(payload, 'file_meta')) {
      yield row;
    }
    return;
  }
  if (sources.format === 'columnar') {
    const payload = readJsonFile(sources.paths[0], { maxBytes });
    for (const row of yieldColumnarRows(payload, 'file_meta')) {
      yield row;
    }
    return;
  }
  for await (const row of streamRows(sources.paths, sources.offsets)) {
    yield row;
  }
};

/**
 * Load object-style artifacts (single JSON object) from manifest paths.
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
  void fallbackPath;
  const resolvedManifest = manifest || loadPiecesManifest(
    dir,
    { maxBytes: resolveManifestMaxBytes(maxBytes), strict: true }
  );
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    strict,
    maxBytes
  });
  if (!sources?.paths?.length) {
    throw new Error(`Missing manifest entry for ${baseName}`);
  }
  if (sources.format !== 'json') {
    throw new Error(`Unsupported JSON object format for ${baseName}: ${sources.format}`);
  }
  if (sources.paths.length > 1) {
    throw new Error(`Ambiguous JSON sources for ${baseName}`);
  }
  return readJsonFile(sources.paths[0], { maxBytes });
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
  void fallbackPath;
  const resolvedManifest = manifest || loadPiecesManifest(
    dir,
    { maxBytes: resolveManifestMaxBytes(maxBytes), strict: true }
  );
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    strict,
    maxBytes
  });
  if (!sources?.paths?.length) {
    throw new Error(`Missing manifest entry for ${baseName}`);
  }
  if (sources.format !== 'json') {
    throw new Error(`Unsupported JSON object format for ${baseName}: ${sources.format}`);
  }
  if (sources.paths.length > 1) {
    throw new Error(`Ambiguous JSON sources for ${baseName}`);
  }
  return readJsonFile(sources.paths[0], { maxBytes });
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
  const resolvedManifest = manifest || loadPiecesManifest(
    dir,
    { maxBytes: resolveManifestMaxBytes(maxBytes), strict: true }
  );
  const sources = resolveRequiredSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    maxBytes,
    strict
  });
  const resolvedKeys = requiredKeys ?? resolveJsonlRequiredKeys(baseName);
  return loadArrayPayloadFromSourcesSync(sources, {
    baseName,
    maxBytes,
    requiredKeys: resolvedKeys,
    validationMode
  });
};
