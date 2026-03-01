import { MAX_JSON_BYTES } from '../constants.js';
import { readJsonFile, readJsonLinesArray, readJsonLinesArraySync, readJsonLinesIterator } from '../json.js';
import { resolveJsonlRequiredKeys } from '../jsonl.js';
import {
  loadPiecesManifest,
  resolveManifestArtifactSources
} from '../manifest.js';
import {
  iterateBinaryColumnarJsonRows
} from './core-binary-columnar.js';
import {
  resolveManifestMaxBytes,
  resolveReadableArtifactPath,
  resolveRequiredSources,
  resolveBinaryColumnarSourcePart
} from './core-source-resolution.js';
import {
  createLoaderError,
  ensureOffsetsValid,
  inflateColumnarRows,
  iterateColumnarRows
} from './shared.js';

/**
 * Append rows to a destination array without creating intermediate arrays.
 *
 * @template T
 * @param {T[]} target
 * @param {T[]} rows
 * @returns {T[]}
 */
const appendRows = (target, rows) => {
  for (let i = 0; i < rows.length; i += 1) {
    target.push(rows[i]);
  }
  return target;
};

/**
 * Iterate decoded binary-columnar rows across all declared source parts.
 *
 * @param {object} input
 * @returns {Generator<any, void, unknown>}
 */
const iterateBinaryColumnarRows = function* ({
  dir,
  baseName,
  sources,
  manifest,
  maxBytes,
  strict,
  enforceBinaryDataBudget = true
}) {
  for (let index = 0; index < sources.paths.length; index += 1) {
    const rows = iterateBinaryColumnarJsonRows({
      dir,
      baseName,
      sources: resolveBinaryColumnarSourcePart(sources, index),
      manifest,
      maxBytes,
      strict,
      enforceDataBudget: enforceBinaryDataBudget
    });
    for (const row of rows) {
      yield row;
    }
  }
};

/**
 * Stream JSONL rows from multi-part artifact sources, validating optional
 * offsets sidecars before consuming each part.
 *
 * @param {string[]} paths
 * @param {string[]|null} offsetsPaths
 * @param {{
 *   maxBytes:number,
 *   requiredKeys:string[]|null,
 *   validationMode:'strict'|'trusted',
 *   maxInFlight?:number,
 *   onBackpressure?:(() => void)|null,
 *   onResume?:(() => void)|null,
 *   rowMapper?:((row:any) => any)|null
 * }} options
 * @returns {AsyncGenerator<any, void, unknown>}
 */
const streamJsonlRowsFromSources = async function* (
  paths,
  offsetsPaths,
  {
    maxBytes,
    requiredKeys,
    validationMode,
    maxInFlight = 0,
    onBackpressure = null,
    onResume = null,
    rowMapper = null
  }
) {
  const hasOffsets = Array.isArray(offsetsPaths);
  for (let i = 0; i < paths.length; i += 1) {
    const partPath = paths[i];
    const offsetsPath = hasOffsets ? offsetsPaths[i] : null;
    if (offsetsPath) {
      await ensureOffsetsValid(partPath, offsetsPath);
    }
    for await (const row of readJsonLinesIterator(partPath, {
      maxBytes,
      requiredKeys,
      validationMode,
      maxInFlight,
      onBackpressure,
      onResume
    })) {
      yield rowMapper ? rowMapper(row) : row;
    }
  }
};

/**
 * Load a single JSON-object artifact from resolved manifest sources.
 *
 * @param {object} input
 * @returns {any}
 */
const loadManifestJsonObjectFromSources = ({
  sources,
  baseName,
  strict,
  maxBytes
}) => {
  if (!sources?.paths?.length) {
    throw createLoaderError('ERR_MANIFEST_ENTRY_MISSING', `Missing manifest entry for ${baseName}`);
  }
  if (sources.format !== 'json') {
    throw createLoaderError(
      'ERR_MANIFEST_FORMAT_UNSUPPORTED',
      `Unsupported JSON object format for ${baseName}: ${sources.format}`
    );
  }
  if (sources.paths.length > 1 && strict) {
    throw createLoaderError('ERR_MANIFEST_SOURCE_AMBIGUOUS', `Ambiguous JSON sources for ${baseName}`);
  }
  return readJsonFile(resolveReadableArtifactPath(sources.paths[0]), { maxBytes });
};

/**
 * Load array payloads from resolved sources (json/jsonl/columnar/binary-columnar).
 *
 * @param {object} sources
 * @param {object} options
 * @returns {Promise<any[]>}
 */
const loadArrayPayloadFromSources = async (
  sources,
  {
    dir,
    manifest,
    strict,
    baseName,
    maxBytes,
    requiredKeys,
    validationMode,
    concurrency = null,
    enforceBinaryDataBudget = true
  }
) => {
  if (sources.format === 'json') {
    const out = [];
    for (const sourcePath of sources.paths) {
      const payload = readJsonFile(sourcePath, { maxBytes });
      if (!Array.isArray(payload)) {
        throw createLoaderError('ERR_ARTIFACT_INVALID', `Invalid json payload for ${baseName}`);
      }
      appendRows(out, payload);
    }
    return out;
  }
  if (sources.format === 'columnar') {
    const out = [];
    for (const sourcePath of sources.paths) {
      const payload = readJsonFile(sourcePath, { maxBytes });
      const inflated = inflateColumnarRows(payload);
      if (!inflated) {
        throw createLoaderError('ERR_ARTIFACT_INVALID', `Invalid columnar payload for ${baseName}`);
      }
      appendRows(out, inflated);
    }
    return out;
  }
  if (sources.format === 'binary-columnar') {
    const out = [];
    for (const row of iterateBinaryColumnarRows({
      dir,
      baseName,
      sources,
      manifest,
      maxBytes,
      strict,
      enforceBinaryDataBudget
    })) {
      out.push(row);
    }
    return out;
  }
  return await readJsonLinesArray(sources.paths, {
    maxBytes,
    requiredKeys,
    validationMode,
    concurrency
  });
};

/**
 * Synchronous variant of {@link loadArrayPayloadFromSources}.
 *
 * @param {object} sources
 * @param {object} options
 * @returns {any[]}
 */
const loadArrayPayloadFromSourcesSync = (
  sources,
  {
    dir,
    manifest,
    strict,
    baseName,
    maxBytes,
    requiredKeys,
    validationMode,
    enforceBinaryDataBudget = true
  }
) => {
  if (sources.format === 'json') {
    const out = [];
    for (const sourcePath of sources.paths) {
      const payload = readJsonFile(sourcePath, { maxBytes });
      if (!Array.isArray(payload)) {
        throw createLoaderError('ERR_ARTIFACT_INVALID', `Invalid json payload for ${baseName}`);
      }
      appendRows(out, payload);
    }
    return out;
  }
  if (sources.format === 'columnar') {
    const out = [];
    for (const sourcePath of sources.paths) {
      const payload = readJsonFile(sourcePath, { maxBytes });
      const inflated = inflateColumnarRows(payload);
      if (!inflated) {
        throw createLoaderError('ERR_ARTIFACT_INVALID', `Invalid columnar payload for ${baseName}`);
      }
      appendRows(out, inflated);
    }
    return out;
  }
  if (sources.format === 'binary-columnar') {
    const out = [];
    for (const row of iterateBinaryColumnarRows({
      dir,
      baseName,
      sources,
      manifest,
      maxBytes,
      strict,
      enforceBinaryDataBudget
    })) {
      out.push(row);
    }
    return out;
  }
  const out = [];
  for (const partPath of sources.paths) {
    const part = readJsonLinesArraySync(partPath, {
      maxBytes,
      requiredKeys,
      validationMode
    });
    appendRows(out, part);
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
 * @property {boolean} [enforceBinaryDataBudget]
 */

/**
 * Load array-style artifacts from manifest-declared sources.
 *
 * Supports JSON arrays, JSONL shards, columnar JSON, and binary-columnar row frames.
 * Strict mode requires manifest-valid source declarations and strict row
 * validation for JSONL payloads.
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
    concurrency = null,
    enforceBinaryDataBudget = true
  } = {}
) => {
  const validationMode = strict ? 'strict' : 'trusted';
  const resolvedManifest = manifest || loadPiecesManifest(
    dir,
    { maxBytes: resolveManifestMaxBytes(maxBytes), strict }
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
    dir,
    manifest: resolvedManifest,
    strict,
    baseName,
    maxBytes,
    requiredKeys: resolvedKeys,
    validationMode,
    concurrency,
    enforceBinaryDataBudget
  });
};

/**
 * Stream array artifact rows from JSONL sources, optionally materializing JSON/columnar/binary payloads.
 *
 * In strict mode, only manifest-declared sources are accepted and JSONL rows
 * are validated in strict parsing mode.
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
 *   onResume?: (() => void)|null,
 *   enforceBinaryDataBudget?: boolean
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
    onResume = null,
    enforceBinaryDataBudget = true
  } = {}
) {
  const validationMode = strict ? 'strict' : 'trusted';
  const resolvedManifest = manifest || loadPiecesManifest(
    dir,
    { maxBytes: resolveManifestMaxBytes(maxBytes), strict }
  );
  const resolvedKeys = requiredKeys ?? resolveJsonlRequiredKeys(baseName);
  void materialize;
  const sources = resolveRequiredSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    maxBytes,
    strict
  });
  if (sources.format === 'json') {
    for (const sourcePath of sources.paths) {
      const payload = readJsonFile(sourcePath, { maxBytes });
      const rows = Array.isArray(payload) ? payload : [];
      for (const row of rows) yield row;
    }
    return;
  }
  if (sources.format === 'columnar') {
    for (const sourcePath of sources.paths) {
      const payload = readJsonFile(sourcePath, { maxBytes });
      const rows = iterateColumnarRows(payload);
      if (!rows) {
        throw createLoaderError('ERR_ARTIFACT_INVALID', `Invalid columnar payload for ${baseName}`);
      }
      for (const row of rows) yield row;
    }
    return;
  }
  if (sources.format === 'binary-columnar') {
    for (const row of iterateBinaryColumnarRows({
      dir,
      baseName,
      sources,
      manifest: resolvedManifest,
      maxBytes,
      strict,
      enforceBinaryDataBudget
    })) {
      yield row;
    }
    return;
  }
  for await (const row of streamJsonlRowsFromSources(sources.paths, sources.offsets, {
    maxBytes,
    requiredKeys: resolvedKeys,
    validationMode,
    maxInFlight,
    onBackpressure,
    onResume
  })) {
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
    throw createLoaderError('ERR_ARTIFACT_INVALID', `Invalid ${label} row: expected object`);
  }
  if (!Number.isFinite(row.id)) {
    throw createLoaderError('ERR_ARTIFACT_INVALID', `Invalid ${label} row: missing numeric id`);
  }
  if (typeof row.file !== 'string') {
    throw createLoaderError('ERR_ARTIFACT_INVALID', `Invalid ${label} row: missing file path`);
  }
  return row;
};

/**
 * Stream `file_meta` rows while enforcing required shape and fallback policy.
 *
 * Every yielded row must contain numeric `id` and string `file`.
 *
 * @param {string} dir
 * @param {{
 *   maxBytes?: number,
 *   manifest?: object|null,
 *   strict?: boolean,
 *   materialize?: boolean,
 *   maxInFlight?: number,
 *   onBackpressure?: (() => void)|null,
 *   onResume?: (() => void)|null,
 *   enforceBinaryDataBudget?: boolean
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
    onResume = null,
    enforceBinaryDataBudget = true
  } = {}
) {
  const validationMode = strict ? 'strict' : 'trusted';
  const resolvedManifest = manifest || loadPiecesManifest(
    dir,
    { maxBytes: resolveManifestMaxBytes(maxBytes), strict }
  );
  const resolvedKeys = resolveJsonlRequiredKeys('file_meta');
  void materialize;
  const sources = resolveRequiredSources({
    dir,
    manifest: resolvedManifest,
    name: 'file_meta',
    maxBytes,
    strict
  });
  if (sources.format === 'json') {
    for (const sourcePath of sources.paths) {
      const payload = readJsonFile(sourcePath, { maxBytes });
      if (!Array.isArray(payload)) {
        throw createLoaderError('ERR_ARTIFACT_INVALID', 'Invalid json payload for file_meta');
      }
      for (let i = 0; i < payload.length; i += 1) {
        yield validateFileMetaRow(payload[i], 'file_meta');
      }
    }
    return;
  }
  if (sources.format === 'columnar') {
    for (const sourcePath of sources.paths) {
      const payload = readJsonFile(sourcePath, { maxBytes });
      const iterator = iterateColumnarRows(payload);
      if (!iterator) {
        throw createLoaderError('ERR_ARTIFACT_INVALID', 'Invalid columnar payload for file_meta');
      }
      for (const row of iterator) {
        yield validateFileMetaRow(row, 'file_meta');
      }
    }
    return;
  }
  if (sources.format === 'binary-columnar') {
    for (const row of iterateBinaryColumnarRows({
      dir,
      baseName: 'file_meta',
      sources,
      manifest: resolvedManifest,
      maxBytes,
      strict,
      enforceBinaryDataBudget
    })) {
      yield validateFileMetaRow(row, 'file_meta');
    }
    return;
  }
  for await (const row of streamJsonlRowsFromSources(sources.paths, sources.offsets, {
    maxBytes,
    requiredKeys: resolvedKeys,
    validationMode,
    maxInFlight,
    onBackpressure,
    onResume,
    rowMapper: (entry) => validateFileMetaRow(entry, 'file_meta')
  })) {
    yield row;
  }
};

/**
 * Load object-style artifacts (single JSON object) from manifest paths.
 * Strict mode rejects ambiguous manifest source declarations.
 *
 * @param {string} dir
 * @param {string} baseName
 * @param {{
 *   maxBytes?: number,
 *   manifest?: object|null,
 *   strict?: boolean
 * }} [options]
 * @returns {Promise<any>}
 */
export const loadJsonObjectArtifact = async (
  dir,
  baseName,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(
    dir,
    { maxBytes: resolveManifestMaxBytes(maxBytes), strict }
  );
  return loadManifestJsonObjectFromSources({
    sources: resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name: baseName,
      strict,
      maxBytes
    }),
    baseName,
    strict,
    maxBytes
  });
};

/**
 * Synchronous variant of {@link loadJsonObjectArtifact}.
 *
 * @param {string} dir
 * @param {string} baseName
 * @param {{
 *   maxBytes?: number,
 *   manifest?: object|null,
 *   strict?: boolean
 * }} [options]
 * @returns {any}
 */
export const loadJsonObjectArtifactSync = (
  dir,
  baseName,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(
    dir,
    { maxBytes: resolveManifestMaxBytes(maxBytes), strict }
  );
  return loadManifestJsonObjectFromSources({
    sources: resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name: baseName,
      strict,
      maxBytes
    }),
    baseName,
    strict,
    maxBytes
  });
};

/**
 * Synchronous variant of {@link loadJsonArrayArtifact}.
 * Preserves strict/trusted row validation semantics used by the async loader.
 *
 * @param {string} dir
 * @param {string} baseName
 * @param {{
 *   maxBytes?: number,
 *   requiredKeys?: string[]|null,
 *   manifest?: object|null,
 *   strict?: boolean,
 *   enforceBinaryDataBudget?: boolean
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
    strict = true,
    enforceBinaryDataBudget = true
  } = {}
) => {
  const validationMode = strict ? 'strict' : 'trusted';
  const resolvedManifest = manifest || loadPiecesManifest(
    dir,
    { maxBytes: resolveManifestMaxBytes(maxBytes), strict }
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
    dir,
    manifest: resolvedManifest,
    strict,
    baseName,
    maxBytes,
    requiredKeys: resolvedKeys,
    validationMode,
    enforceBinaryDataBudget
  });
};
