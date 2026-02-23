import fs from 'node:fs';
import path from 'node:path';
import { readJsonFile } from '../json.js';
import { createPackedChecksumValidator } from '../checksum.js';
import { resolveManifestPieceByPath } from '../manifest.js';
import { loadBinaryColumnarRowPayloads } from './binary-columnar.js';
import { createLoaderError } from './shared.js';
import {
  resolveBinaryColumnarDefaultPaths,
  resolveReadableArtifactPath,
  resolveReadableArtifactPathState
} from './core-source-resolution.js';

const SUPPORTED_BINARY_COLUMNAR_FORMAT = 'binary-columnar-v1';

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
 * @returns {any[]}
 */
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
  const resolvedMetaPathState = resolveReadableArtifactPathState(metaPath);
  const resolvedOffsetsPathState = resolveReadableArtifactPathState(offsetsPath);
  const resolvedLengthsPathState = resolveReadableArtifactPathState(lengthsPath);
  if (!resolvedMetaPathState.exists || !resolvedOffsetsPathState.exists || !resolvedLengthsPathState.exists) {
    throw createLoaderError(
      'ERR_ARTIFACT_PARTS_MISSING',
      `Missing binary-columnar sidecars for ${baseName}`
    );
  }
  const resolvedMetaPath = resolvedMetaPathState.path;
  const resolvedOffsetsPath = resolvedOffsetsPathState.path;
  const resolvedLengthsPath = resolvedLengthsPathState.path;

  const { fields, count } = parseBinaryColumnarMeta({
    metaPath: resolvedMetaPath,
    maxBytes,
    baseName
  });
  const dataPathFromMeta = typeof fields?.data === 'string' ? path.join(dir, fields.data) : dataPath;
  const offsetsPathFromMeta = typeof fields?.offsets === 'string' ? path.join(dir, fields.offsets) : resolvedOffsetsPath;
  const lengthsPathFromMeta = typeof fields?.lengths === 'string' ? path.join(dir, fields.lengths) : resolvedLengthsPath;
  const resolvedDataPath = resolveReadableArtifactPath(dataPathFromMeta);
  const resolvedOffsetsPathFromMeta = resolveReadableArtifactPath(offsetsPathFromMeta);
  const resolvedLengthsPathFromMeta = resolveReadableArtifactPath(lengthsPathFromMeta);
  assertBinaryPartWithinMaxBytes(resolvedDataPath, maxBytes, `${baseName} binary-columnar data`);
  assertBinaryPartWithinMaxBytes(resolvedOffsetsPathFromMeta, maxBytes, `${baseName} binary-columnar offsets`);
  assertBinaryPartWithinMaxBytes(resolvedLengthsPathFromMeta, maxBytes, `${baseName} binary-columnar lengths`);
  const dataBuffer = fs.readFileSync(resolvedDataPath);
  const offsetsBuffer = fs.readFileSync(resolvedOffsetsPathFromMeta);
  const lengthsBuffer = fs.readFileSync(resolvedLengthsPathFromMeta);
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
      targetPath: resolvedOffsetsPathFromMeta,
      expectedName: sidecars?.offsetsName || null,
      label: `${baseName} binary-columnar offsets`
    }),
    buffer: offsetsBuffer,
    baseName,
    artifactPath: resolvedOffsetsPathFromMeta
  });
  verifyManifestChecksum({
    validator: createManifestChecksumValidator({
      manifest,
      dir,
      targetPath: resolvedLengthsPathFromMeta,
      expectedName: sidecars?.lengthsName || null,
      label: `${baseName} binary-columnar lengths`
    }),
    buffer: lengthsBuffer,
    baseName,
    artifactPath: resolvedLengthsPathFromMeta
  });
  const payloads = loadBinaryColumnarRowPayloads({
    dataPath: resolvedDataPath,
    offsetsPath: resolvedOffsetsPathFromMeta,
    lengthsPath: resolvedLengthsPathFromMeta,
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

export {
  loadBinaryColumnarJsonRows
};
