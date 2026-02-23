import fs from 'node:fs';
import path from 'node:path';
import { MAX_JSON_BYTES } from '../constants.js';
import { getBakPath } from '../cache.js';
import { existsOrBak } from '../fs.js';
import { readJsonFile, readJsonLinesArray, readJsonLinesArraySync, readJsonLinesIterator } from '../json.js';
import { resolveJsonlRequiredKeys } from '../jsonl.js';
import { createPackedChecksumValidator } from '../checksum.js';
import {
  loadPiecesManifest,
  resolveManifestArtifactSources,
  resolveManifestMmapHotLayoutPreference,
  resolveManifestPieceByPath
} from '../manifest.js';
import { loadBinaryColumnarRowPayloads } from './binary-columnar.js';
import {
  createLoaderError,
  assertNoShardIndexGaps,
  ensureOffsetsValid,
  inflateColumnarRows,
  iterateColumnarRows
} from './shared.js';

const resolveManifestMaxBytes = (maxBytes) => (
  Number.isFinite(Number(maxBytes)) ? Number(maxBytes) : MAX_JSON_BYTES
);

const resolveSourceLayoutSummary = ({ manifest, sources }) => {
  const entries = Array.isArray(sources?.entries) ? sources.entries : [];
  if (!entries.length) return null;
  const preferMmapHotLayout = resolveManifestMmapHotLayoutPreference(manifest);
  let hotCount = 0;
  let hotContiguousCount = 0;
  for (const entry of entries) {
    const tier = typeof entry?.tier === 'string' ? entry.tier.trim().toLowerCase() : '';
    const layout = entry?.layout && typeof entry.layout === 'object' ? entry.layout : null;
    const contiguous = layout?.contiguous === true;
    if (tier === 'hot') {
      hotCount += 1;
      if (contiguous) hotContiguousCount += 1;
    }
  }
  return {
    preferMmapHotLayout,
    hotCount,
    hotContiguousCount
  };
};

const resolveReadableArtifactPath = (targetPath) => {
  if (fs.existsSync(targetPath)) return targetPath;
  const backupPath = getBakPath(targetPath);
  if (fs.existsSync(backupPath)) return backupPath;
  return targetPath;
};

const resolveRequiredSources = ({
  dir,
  manifest,
  name,
  maxBytes,
  strict
}) => {
  if (!manifest) {
    const manifestPath = path.join(dir, 'pieces', 'manifest.json');
    throw createLoaderError('ERR_MANIFEST_MISSING', `Missing pieces manifest: ${manifestPath}`);
  }
  let sources = resolveManifestArtifactSources({
    dir,
    manifest,
    name,
    strict,
    maxBytes
  });
  if (!sources?.paths?.length) {
    throw createLoaderError('ERR_MANIFEST_ENTRY_MISSING', `Missing manifest entry for ${name}`);
  }
  const missingPaths = sources.paths.filter((target) => !existsOrBak(target));
  if (missingPaths.length) {
    throw createLoaderError(
      'ERR_ARTIFACT_PARTS_MISSING',
      `Missing manifest parts for ${name}: ${missingPaths.join(', ')}`
    );
  }
  if (sources.format === 'binary-columnar') {
    const sidecars = sources.binaryColumnar || null;
    const missingSidecars = [];
    if (sidecars?.metaPath && !existsOrBak(sidecars.metaPath)) {
      missingSidecars.push(sidecars.metaPath);
    }
    if (sidecars?.offsetsPath && !existsOrBak(sidecars.offsetsPath)) {
      missingSidecars.push(sidecars.offsetsPath);
    }
    if (sidecars?.lengthsPath && !existsOrBak(sidecars.lengthsPath)) {
      missingSidecars.push(sidecars.lengthsPath);
    }
    if (missingSidecars.length) {
      throw createLoaderError(
        'ERR_ARTIFACT_PARTS_MISSING',
        `Missing binary-columnar sidecars for ${name}: ${missingSidecars.join(', ')}`
      );
    }
  }
  const resolvedPaths = sources.paths.map(resolveReadableArtifactPath);
  const resolvedOffsets = Array.isArray(sources.offsets)
    ? sources.offsets.map(resolveReadableArtifactPath)
    : null;
  const resolvedBinaryColumnar = sources.binaryColumnar && typeof sources.binaryColumnar === 'object'
    ? {
      ...sources.binaryColumnar,
      dataPath: sources.binaryColumnar.dataPath
        ? resolveReadableArtifactPath(sources.binaryColumnar.dataPath)
        : resolvedPaths[0],
      metaPath: sources.binaryColumnar.metaPath
        ? resolveReadableArtifactPath(sources.binaryColumnar.metaPath)
        : null,
      offsetsPath: sources.binaryColumnar.offsetsPath
        ? resolveReadableArtifactPath(sources.binaryColumnar.offsetsPath)
        : null,
      lengthsPath: sources.binaryColumnar.lengthsPath
        ? resolveReadableArtifactPath(sources.binaryColumnar.lengthsPath)
        : null
    }
    : null;
  const layout = resolveSourceLayoutSummary({ manifest, sources });
  if (sources.format === 'json' || sources.format === 'columnar' || sources.format === 'binary-columnar') {
    if (sources.paths.length > 1) {
      if (!strict) {
        return {
          ...sources,
          paths: resolvedPaths,
          offsets: resolvedOffsets,
          binaryColumnar: resolvedBinaryColumnar,
          layout
        };
      }
      throw createLoaderError(
        'ERR_MANIFEST_SOURCE_AMBIGUOUS',
        `Ambiguous ${sources.format.toUpperCase()} sources for ${name}`
      );
    }
    return {
      ...sources,
      paths: resolvedPaths,
      offsets: resolvedOffsets,
      binaryColumnar: resolvedBinaryColumnar,
      layout
    };
  }
  assertNoShardIndexGaps(resolvedPaths, name);
  return {
    ...sources,
    paths: resolvedPaths,
    offsets: resolvedOffsets,
    layout
  };
};

const SUPPORTED_BINARY_COLUMNAR_FORMAT = 'binary-columnar-v1';

const resolveBinaryColumnarDefaultPaths = (dataPath) => {
  if (!dataPath || typeof dataPath !== 'string') {
    return {
      metaPath: null,
      offsetsPath: null,
      lengthsPath: null
    };
  }
  const withoutBin = dataPath.replace(/\.bin$/i, '');
  return {
    metaPath: `${withoutBin}.meta.json`,
    offsetsPath: `${withoutBin}.offsets.bin`,
    lengthsPath: `${withoutBin}.lengths.varint`
  };
};

const resolveBinaryColumnarSourcePart = (sources, partIndex = 0) => {
  const paths = Array.isArray(sources?.paths) ? sources.paths : [];
  if (!paths.length) return { ...sources, paths: [] };
  const normalizedIndex = Math.max(0, Math.min(paths.length - 1, Math.floor(Number(partIndex) || 0)));
  const dataPath = paths[normalizedIndex];
  const binaryColumnar = sources?.binaryColumnar && typeof sources.binaryColumnar === 'object'
    ? sources.binaryColumnar
    : null;
  const primaryDataPath = binaryColumnar?.dataPath || paths[0] || null;
  const isPrimaryPath = primaryDataPath && path.resolve(primaryDataPath) === path.resolve(dataPath);
  const defaults = resolveBinaryColumnarDefaultPaths(dataPath);
  return {
    ...sources,
    paths: [dataPath],
    offsets: Array.isArray(sources?.offsets) && sources.offsets[normalizedIndex]
      ? [sources.offsets[normalizedIndex]]
      : null,
    binaryColumnar: {
      ...(binaryColumnar || {}),
      dataPath,
      dataName: binaryColumnar?.dataName || null,
      metaPath: isPrimaryPath ? (binaryColumnar?.metaPath || defaults.metaPath) : defaults.metaPath,
      offsetsPath: isPrimaryPath ? (binaryColumnar?.offsetsPath || defaults.offsetsPath) : defaults.offsetsPath,
      lengthsPath: isPrimaryPath ? (binaryColumnar?.lengthsPath || defaults.lengthsPath) : defaults.lengthsPath
    }
  };
};

const createManifestChecksumValidator = ({
  manifest,
  dir,
  targetPath,
  expectedName,
  label
}) => {
  const piece = resolveManifestPieceByPath({
    manifest,
    dir,
    targetPath,
    expectedName
  });
  if (!piece || typeof piece.checksum !== 'string' || !piece.checksum.includes(':')) {
    return null;
  }
  try {
    return createPackedChecksumValidator(
      { checksum: piece.checksum },
      { label }
    );
  } catch {
    return null;
  }
};

const verifyManifestChecksum = ({
  validator,
  buffer,
  baseName,
  artifactPath
}) => {
  if (!validator) return;
  try {
    validator.update(buffer);
    validator.verify();
  } catch (err) {
    throw createLoaderError(
      'ERR_ARTIFACT_CORRUPT',
      `Checksum mismatch for ${baseName}: ${artifactPath}`,
      err instanceof Error ? err : null
    );
  }
};

const parseBinaryColumnarMeta = ({
  metaPath,
  maxBytes,
  baseName
}) => {
  const raw = readJsonFile(metaPath, { maxBytes });
  const fields = raw?.fields && typeof raw.fields === 'object'
    ? raw.fields
    : raw;
  const format = typeof fields?.format === 'string'
    ? fields.format.trim().toLowerCase()
    : '';
  if (format && format !== SUPPORTED_BINARY_COLUMNAR_FORMAT) {
    throw createLoaderError(
      'ERR_ARTIFACT_INVALID',
      `Unsupported binary-columnar format for ${baseName}: ${fields.format}`
    );
  }
  const countRaw = Number(fields?.count);
  if (!Number.isFinite(countRaw) || countRaw < 0) {
    throw createLoaderError(
      'ERR_ARTIFACT_INVALID',
      `Missing binary-columnar count for ${baseName}`
    );
  }
  const count = Math.max(0, Math.floor(countRaw));
  return { raw, fields, count };
};

const assertBinaryPartWithinMaxBytes = (targetPath, maxBytes, label) => {
  if (!Number.isFinite(Number(maxBytes)) || Number(maxBytes) <= 0) return;
  let size = null;
  try {
    size = Number(fs.statSync(targetPath)?.size);
  } catch {
    size = null;
  }
  if (!Number.isFinite(size) || size < 0) return;
  if (size > Number(maxBytes)) {
    throw createLoaderError(
      'ERR_ARTIFACT_TOO_LARGE',
      `${label} exceeds maxBytes (${size} > ${Number(maxBytes)})`
    );
  }
};

const loadBinaryColumnarJsonRows = ({
  dir,
  baseName,
  sources,
  manifest,
  maxBytes,
  strict
}) => {
  const sourcePath = sources.paths[0];
  const sidecars = sources.binaryColumnar || null;
  const defaults = resolveBinaryColumnarDefaultPaths(sourcePath);
  const dataPath = sidecars?.dataPath || sourcePath;
  const metaPath = sidecars?.metaPath || defaults.metaPath;
  const offsetsPath = sidecars?.offsetsPath || defaults.offsetsPath;
  const lengthsPath = sidecars?.lengthsPath || defaults.lengthsPath;
  if (strict && (!metaPath || !offsetsPath || !lengthsPath)) {
    throw createLoaderError(
      'ERR_MANIFEST_INCOMPLETE',
      `Missing binary-columnar sidecars for ${baseName}`
    );
  }
  if (!dataPath || !metaPath || !offsetsPath || !lengthsPath) {
    throw createLoaderError(
      'ERR_ARTIFACT_PARTS_MISSING',
      `Missing binary-columnar sidecars for ${baseName}`
    );
  }
  if (!existsOrBak(metaPath) || !existsOrBak(offsetsPath) || !existsOrBak(lengthsPath)) {
    throw createLoaderError(
      'ERR_ARTIFACT_PARTS_MISSING',
      `Missing binary-columnar sidecars for ${baseName}`
    );
  }
  const { fields, count } = parseBinaryColumnarMeta({
    metaPath,
    maxBytes,
    baseName
  });
  const dataPathFromMeta = typeof fields?.data === 'string' ? path.join(dir, fields.data) : dataPath;
  const offsetsPathFromMeta = typeof fields?.offsets === 'string' ? path.join(dir, fields.offsets) : offsetsPath;
  const lengthsPathFromMeta = typeof fields?.lengths === 'string' ? path.join(dir, fields.lengths) : lengthsPath;
  const resolvedDataPath = resolveReadableArtifactPath(dataPathFromMeta);
  const resolvedOffsetsPath = resolveReadableArtifactPath(offsetsPathFromMeta);
  const resolvedLengthsPath = resolveReadableArtifactPath(lengthsPathFromMeta);
  assertBinaryPartWithinMaxBytes(resolvedDataPath, maxBytes, `${baseName} binary-columnar data`);
  assertBinaryPartWithinMaxBytes(resolvedOffsetsPath, maxBytes, `${baseName} binary-columnar offsets`);
  assertBinaryPartWithinMaxBytes(resolvedLengthsPath, maxBytes, `${baseName} binary-columnar lengths`);
  const dataBuffer = fs.readFileSync(resolvedDataPath);
  const offsetsBuffer = fs.readFileSync(resolvedOffsetsPath);
  const lengthsBuffer = fs.readFileSync(resolvedLengthsPath);
  verifyManifestChecksum({
    validator: createManifestChecksumValidator({
      manifest,
      dir,
      targetPath: resolvedDataPath,
      expectedName: sidecars?.dataName || null,
      label: `${baseName} binary-columnar data`
    }),
    buffer: dataBuffer,
    baseName,
    artifactPath: resolvedDataPath
  });
  verifyManifestChecksum({
    validator: createManifestChecksumValidator({
      manifest,
      dir,
      targetPath: resolvedOffsetsPath,
      expectedName: sidecars?.offsetsName || null,
      label: `${baseName} binary-columnar offsets`
    }),
    buffer: offsetsBuffer,
    baseName,
    artifactPath: resolvedOffsetsPath
  });
  verifyManifestChecksum({
    validator: createManifestChecksumValidator({
      manifest,
      dir,
      targetPath: resolvedLengthsPath,
      expectedName: sidecars?.lengthsName || null,
      label: `${baseName} binary-columnar lengths`
    }),
    buffer: lengthsBuffer,
    baseName,
    artifactPath: resolvedLengthsPath
  });
  const payloads = loadBinaryColumnarRowPayloads({
    dataPath: resolvedDataPath,
    offsetsPath: resolvedOffsetsPath,
    lengthsPath: resolvedLengthsPath,
    count,
    dataBuffer,
    offsetsBuffer,
    lengthsBuffer,
    maxBytes
  });
  if (!payloads) {
    throw createLoaderError(
      'ERR_ARTIFACT_PARTS_MISSING',
      `Missing binary-columnar payload for ${baseName}`
    );
  }
  const rows = new Array(payloads.length);
  for (let i = 0; i < payloads.length; i += 1) {
    try {
      rows[i] = JSON.parse(payloads[i].toString('utf8'));
    } catch (err) {
      throw createLoaderError(
        'ERR_ARTIFACT_CORRUPT',
        `Invalid binary-columnar row payload for ${baseName}`,
        err instanceof Error ? err : null
      );
    }
  }
  if (Number.isFinite(Number(fields?.count)) && rows.length !== count) {
    throw createLoaderError(
      'ERR_ARTIFACT_CORRUPT',
      `Binary-columnar row count mismatch for ${baseName}`
    );
  }
  return rows;
};

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
    concurrency = null
  }
) => {
  if (sources.format === 'json') {
    const out = [];
    for (const sourcePath of sources.paths) {
      const payload = readJsonFile(sourcePath, { maxBytes });
      if (!Array.isArray(payload)) {
        throw createLoaderError('ERR_ARTIFACT_INVALID', `Invalid json payload for ${baseName}`);
      }
      for (const row of payload) out.push(row);
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
      for (const row of inflated) out.push(row);
    }
    return out;
  }
  if (sources.format === 'binary-columnar') {
    const out = [];
    for (let index = 0; index < sources.paths.length; index += 1) {
      const rows = loadBinaryColumnarJsonRows({
        dir,
        baseName,
        sources: resolveBinaryColumnarSourcePart(sources, index),
        manifest,
        maxBytes,
        strict
      });
      for (const row of rows) out.push(row);
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

const loadArrayPayloadFromSourcesSync = (
  sources,
  {
    dir,
    manifest,
    strict,
    baseName,
    maxBytes,
    requiredKeys,
    validationMode
  }
) => {
  if (sources.format === 'json') {
    const out = [];
    for (const sourcePath of sources.paths) {
      const payload = readJsonFile(sourcePath, { maxBytes });
      if (!Array.isArray(payload)) {
        throw createLoaderError('ERR_ARTIFACT_INVALID', `Invalid json payload for ${baseName}`);
      }
      for (const row of payload) out.push(row);
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
      for (const row of inflated) out.push(row);
    }
    return out;
  }
  if (sources.format === 'binary-columnar') {
    const out = [];
    for (let index = 0; index < sources.paths.length; index += 1) {
      const rows = loadBinaryColumnarJsonRows({
        dir,
        baseName,
        sources: resolveBinaryColumnarSourcePart(sources, index),
        manifest,
        maxBytes,
        strict
      });
      for (const row of rows) out.push(row);
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
 * Supports JSON arrays, JSONL shards, columnar JSON, and binary-columnar row frames.
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
    concurrency
  });
};

/**
 * Stream array artifact rows from JSONL sources, optionally materializing JSON/columnar/binary payloads.
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
    { maxBytes: resolveManifestMaxBytes(maxBytes), strict }
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
    for (let index = 0; index < sources.paths.length; index += 1) {
      const rows = loadBinaryColumnarJsonRows({
        dir,
        baseName,
        sources: resolveBinaryColumnarSourcePart(sources, index),
        manifest: resolvedManifest,
        maxBytes,
        strict
      });
      for (const row of rows) yield row;
    }
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
    { maxBytes: resolveManifestMaxBytes(maxBytes), strict }
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
      throw createLoaderError('ERR_ARTIFACT_INVALID', `Invalid json payload for ${label}`);
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
      throw createLoaderError('ERR_ARTIFACT_INVALID', `Invalid columnar payload for ${label}`);
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
    for (const sourcePath of sources.paths) {
      const payload = readJsonFile(sourcePath, { maxBytes });
      for (const row of yieldJsonRows(payload, 'file_meta')) {
        yield row;
      }
    }
    return;
  }
  if (sources.format === 'columnar') {
    for (const sourcePath of sources.paths) {
      const payload = readJsonFile(sourcePath, { maxBytes });
      for (const row of yieldColumnarRows(payload, 'file_meta')) {
        yield row;
      }
    }
    return;
  }
  if (sources.format === 'binary-columnar') {
    for (let index = 0; index < sources.paths.length; index += 1) {
      const rows = loadBinaryColumnarJsonRows({
        dir,
        baseName: 'file_meta',
        sources: resolveBinaryColumnarSourcePart(sources, index),
        manifest: resolvedManifest,
        maxBytes,
        strict
      });
      for (const row of rows) {
        yield validateFileMetaRow(row, 'file_meta');
      }
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
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    strict,
    maxBytes
  });
  if (!sources?.paths?.length) {
    throw createLoaderError('ERR_MANIFEST_ENTRY_MISSING', `Missing manifest entry for ${baseName}`);
  }
  if (sources.format !== 'json') {
    throw createLoaderError(
      'ERR_MANIFEST_FORMAT_UNSUPPORTED',
      `Unsupported JSON object format for ${baseName}: ${sources.format}`
    );
  }
  if (sources.paths.length > 1) {
    if (strict) {
      throw createLoaderError('ERR_MANIFEST_SOURCE_AMBIGUOUS', `Ambiguous JSON sources for ${baseName}`);
    }
    return readJsonFile(resolveReadableArtifactPath(sources.paths[0]), { maxBytes });
  }
  return readJsonFile(resolveReadableArtifactPath(sources.paths[0]), { maxBytes });
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
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    strict,
    maxBytes
  });
  if (!sources?.paths?.length) {
    throw createLoaderError('ERR_MANIFEST_ENTRY_MISSING', `Missing manifest entry for ${baseName}`);
  }
  if (sources.format !== 'json') {
    throw createLoaderError(
      'ERR_MANIFEST_FORMAT_UNSUPPORTED',
      `Unsupported JSON object format for ${baseName}: ${sources.format}`
    );
  }
  if (sources.paths.length > 1) {
    if (strict) {
      throw createLoaderError('ERR_MANIFEST_SOURCE_AMBIGUOUS', `Ambiguous JSON sources for ${baseName}`);
    }
    return readJsonFile(resolveReadableArtifactPath(sources.paths[0]), { maxBytes });
  }
  return readJsonFile(resolveReadableArtifactPath(sources.paths[0]), { maxBytes });
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
    validationMode
  });
};
