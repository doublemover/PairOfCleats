import fs from 'node:fs';
import { readJsonFile } from '../json.js';
import { createPackedChecksumValidator } from '../checksum.js';
import { resolveManifestPieceByPath } from '../manifest.js';
import {
  iterateBinaryColumnarRowPayloads,
  loadBinaryColumnarRowPayloads
} from './binary-columnar.js';
import { createLoaderError, resolveArtifactMetaEnvelope } from './shared.js';
import { joinPathSafe } from '../../path-normalize.js';
import {
  resolveBinaryColumnarDefaultPaths,
  resolveReadableArtifactPathState
} from './core-source-resolution.js';

const SUPPORTED_BINARY_COLUMNAR_FORMAT = 'binary-columnar-v1';
const STREAM_CHECKSUM_CHUNK_BYTES = 64 * 1024;

/**
 * Resolve an optional manifest checksum validator for one binary-columnar part.
 * Missing or malformed checksums are treated as "no checksum enforcement".
 *
 * @param {object} input
 * @returns {ReturnType<typeof createPackedChecksumValidator>|null}
 */
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

/**
 * Verify a payload buffer against its manifest checksum validator.
 *
 * @param {object} input
 * @returns {void}
 */
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

/**
 * Verify a payload file against its manifest checksum validator without
 * materializing the entire file into memory.
 *
 * @param {object} input
 * @returns {void}
 */
const verifyManifestChecksumFromFile = ({
  validator,
  artifactPath,
  baseName
}) => {
  if (!validator) return;
  const chunk = Buffer.allocUnsafe(STREAM_CHECKSUM_CHUNK_BYTES);
  let handle = null;
  try {
    handle = fs.openSync(artifactPath, 'r');
    while (true) {
      const bytesRead = fs.readSync(handle, chunk, 0, chunk.length, null);
      if (!Number.isFinite(bytesRead) || bytesRead <= 0) break;
      validator.update(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
    }
    validator.verify();
  } catch (err) {
    throw createLoaderError(
      'ERR_ARTIFACT_CORRUPT',
      `Checksum mismatch for ${baseName}: ${artifactPath}`,
      err instanceof Error ? err : null
    );
  } finally {
    if (handle != null) {
      try {
        fs.closeSync(handle);
      } catch {}
    }
  }
};

/**
 * Parse and validate binary-columnar metadata.
 *
 * @param {object} input
 * @returns {{fields:object,count:number}}
 */
const parseBinaryColumnarMeta = ({
  metaPath,
  maxBytes,
  baseName
}) => {
  const raw = readJsonFile(metaPath, { maxBytes });
  const { fields } = resolveArtifactMetaEnvelope(raw);
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
  return { fields, count };
};

/**
 * Enforce max-bytes limits for binary-columnar sidecar files.
 *
 * @param {string} targetPath
 * @param {number} maxBytes
 * @param {string} label
 * @returns {void}
 */
const assertBinaryPartWithinMaxBytes = (targetPath, maxBytes, label) => {
  const max = Number(maxBytes);
  if (!Number.isFinite(max) || max <= 0) return;
  let size = null;
  try {
    size = Number(fs.statSync(targetPath)?.size);
  } catch {
    size = null;
  }
  if (!Number.isFinite(size) || size < 0) return;
  if (size > max) {
    throw createLoaderError(
      'ERR_ARTIFACT_TOO_LARGE',
      `${label} exceeds maxBytes (${size} > ${max})`
    );
  }
};

const resolveBinaryColumnarPartPath = ({
  dir,
  candidate,
  fallbackPath,
  baseName,
  label
}) => {
  const sourcePath = typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : fallbackPath;
  if (typeof sourcePath !== 'string' || !sourcePath) {
    throw createLoaderError(
      'ERR_ARTIFACT_PARTS_MISSING',
      `Missing binary-columnar sidecars for ${baseName}`
    );
  }
  const safePath = joinPathSafe(dir, [sourcePath]);
  if (!safePath) {
    throw createLoaderError(
      'ERR_ARTIFACT_INVALID',
      `Invalid ${label} path for ${baseName}`
    );
  }
  const resolvedPathState = resolveReadableArtifactPathState(safePath);
  if (!resolvedPathState.exists) {
    throw createLoaderError(
      'ERR_ARTIFACT_PARTS_MISSING',
      `Missing binary-columnar sidecars for ${baseName}`
    );
  }
  return resolvedPathState.path;
};

/**
 * Resolve sidecar paths, metadata, and checksum validators for one
 * binary-columnar artifact source.
 *
 * @param {object} input
 * @returns {{
 *   count:number,
 *   fields:object,
 *   resolvedDataPath:string,
 *   resolvedOffsetsPath:string,
 *   resolvedLengthsPath:string,
 *   dataValidator:any,
 *   offsetsValidator:any,
 *   lengthsValidator:any
 * }}
 */
const resolveBinaryColumnarContext = ({
  dir,
  baseName,
  sources,
  manifest,
  maxBytes,
  strict,
  enforceDataBudget
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
  const resolvedMetaPath = resolveBinaryColumnarPartPath({
    dir,
    candidate: null,
    fallbackPath: metaPath,
    baseName,
    label: 'binary-columnar meta'
  });
  const fallbackOffsetsPath = resolveBinaryColumnarPartPath({
    dir,
    candidate: null,
    fallbackPath: offsetsPath,
    baseName,
    label: 'binary-columnar offsets'
  });
  const fallbackLengthsPath = resolveBinaryColumnarPartPath({
    dir,
    candidate: null,
    fallbackPath: lengthsPath,
    baseName,
    label: 'binary-columnar lengths'
  });
  const { fields, count } = parseBinaryColumnarMeta({
    metaPath: resolvedMetaPath,
    maxBytes,
    baseName
  });
  const resolvedDataPath = resolveBinaryColumnarPartPath({
    dir,
    candidate: fields?.data,
    fallbackPath: dataPath,
    baseName,
    label: 'binary-columnar data'
  });
  const resolvedOffsetsPath = resolveBinaryColumnarPartPath({
    dir,
    candidate: fields?.offsets,
    fallbackPath: fallbackOffsetsPath,
    baseName,
    label: 'binary-columnar offsets'
  });
  const resolvedLengthsPath = resolveBinaryColumnarPartPath({
    dir,
    candidate: fields?.lengths,
    fallbackPath: fallbackLengthsPath,
    baseName,
    label: 'binary-columnar lengths'
  });
  if (enforceDataBudget) {
    assertBinaryPartWithinMaxBytes(resolvedDataPath, maxBytes, `${baseName} binary-columnar data`);
  }
  assertBinaryPartWithinMaxBytes(resolvedOffsetsPath, maxBytes, `${baseName} binary-columnar offsets`);
  assertBinaryPartWithinMaxBytes(resolvedLengthsPath, maxBytes, `${baseName} binary-columnar lengths`);
  return {
    count,
    fields,
    resolvedDataPath,
    resolvedOffsetsPath,
    resolvedLengthsPath,
    dataValidator: createManifestChecksumValidator({
      manifest,
      dir,
      targetPath: resolvedDataPath,
      expectedName: sidecars?.dataName || null,
      label: `${baseName} binary-columnar data`
    }),
    offsetsValidator: createManifestChecksumValidator({
      manifest,
      dir,
      targetPath: resolvedOffsetsPath,
      expectedName: sidecars?.offsetsName || null,
      label: `${baseName} binary-columnar offsets`
    }),
    lengthsValidator: createManifestChecksumValidator({
      manifest,
      dir,
      targetPath: resolvedLengthsPath,
      expectedName: sidecars?.lengthsName || null,
      label: `${baseName} binary-columnar lengths`
    })
  };
};

/**
 * Load and decode manifest-backed binary-columnar JSON rows.
 *
 * Strictness and integrity invariants:
 * - Sidecar paths (meta/offsets/lengths) must be present and readable.
 * - Optional manifest checksums are validated for each binary sidecar payload.
 * - Declared row count in metadata must match decoded payload count.
 *
 * @param {object} input
 * @param {string} input.dir
 * @param {string} input.baseName
 * @param {object} input.sources
 * @param {object|null} input.manifest
 * @param {number} input.maxBytes
 * @param {boolean} input.strict
 * @param {boolean} [input.enforceDataBudget]
 * @returns {any[]}
 */
const loadBinaryColumnarJsonRows = ({
  dir,
  baseName,
  sources,
  manifest,
  maxBytes,
  strict,
  enforceDataBudget = true
}) => {
  const {
    count,
    fields,
    resolvedDataPath,
    resolvedOffsetsPath,
    resolvedLengthsPath,
    dataValidator,
    offsetsValidator,
    lengthsValidator
  } = resolveBinaryColumnarContext({
    dir,
    baseName,
    sources,
    manifest,
    maxBytes,
    strict,
    enforceDataBudget
  });
  const dataBuffer = fs.readFileSync(resolvedDataPath);
  const offsetsBuffer = fs.readFileSync(resolvedOffsetsPath);
  const lengthsBuffer = fs.readFileSync(resolvedLengthsPath);
  verifyManifestChecksum({
    validator: dataValidator,
    buffer: dataBuffer,
    baseName,
    artifactPath: resolvedDataPath
  });
  verifyManifestChecksum({
    validator: offsetsValidator,
    buffer: offsetsBuffer,
    baseName,
    artifactPath: resolvedOffsetsPath
  });
  verifyManifestChecksum({
    validator: lengthsValidator,
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
    maxBytes,
    enforceDataBudget
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

/**
 * Iterate decoded manifest-backed binary-columnar JSON rows without
 * materializing the entire binary data blob into memory.
 *
 * @param {object} input
 * @param {string} input.dir
 * @param {string} input.baseName
 * @param {object} input.sources
 * @param {object|null} input.manifest
 * @param {number} input.maxBytes
 * @param {boolean} input.strict
 * @param {boolean} [input.enforceDataBudget]
 * @returns {Generator<any, void, unknown>}
 */
const iterateBinaryColumnarJsonRows = function* ({
  dir,
  baseName,
  sources,
  manifest,
  maxBytes,
  strict,
  enforceDataBudget = true
}) {
  const {
    count,
    resolvedDataPath,
    resolvedOffsetsPath,
    resolvedLengthsPath,
    dataValidator,
    offsetsValidator,
    lengthsValidator
  } = resolveBinaryColumnarContext({
    dir,
    baseName,
    sources,
    manifest,
    maxBytes,
    strict,
    enforceDataBudget
  });
  const offsetsBuffer = fs.readFileSync(resolvedOffsetsPath);
  const lengthsBuffer = fs.readFileSync(resolvedLengthsPath);
  verifyManifestChecksum({
    validator: offsetsValidator,
    buffer: offsetsBuffer,
    baseName,
    artifactPath: resolvedOffsetsPath
  });
  verifyManifestChecksum({
    validator: lengthsValidator,
    buffer: lengthsBuffer,
    baseName,
    artifactPath: resolvedLengthsPath
  });
  verifyManifestChecksumFromFile({
    validator: dataValidator,
    artifactPath: resolvedDataPath,
    baseName
  });
  const payloads = iterateBinaryColumnarRowPayloads({
    dataPath: resolvedDataPath,
    offsetsPath: resolvedOffsetsPath,
    lengthsPath: resolvedLengthsPath,
    count,
    offsetsBuffer,
    lengthsBuffer,
    maxBytes,
    enforceDataBudget
  });
  if (!payloads) {
    throw createLoaderError(
      'ERR_ARTIFACT_PARTS_MISSING',
      `Missing binary-columnar payload for ${baseName}`
    );
  }
  let decodedCount = 0;
  for (const payload of payloads) {
    let parsed = null;
    try {
      parsed = JSON.parse(payload.toString('utf8'));
    } catch (err) {
      throw createLoaderError(
        'ERR_ARTIFACT_CORRUPT',
        `Invalid binary-columnar row payload for ${baseName}`,
        err instanceof Error ? err : null
      );
    }
    decodedCount += 1;
    yield parsed;
  }
  if (decodedCount !== count) {
    throw createLoaderError(
      'ERR_ARTIFACT_CORRUPT',
      `Binary-columnar row count mismatch for ${baseName}`
    );
  }
};

export {
  iterateBinaryColumnarJsonRows,
  loadBinaryColumnarJsonRows
};
