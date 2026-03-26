import fs from 'node:fs';
import { readJsonFile } from '../json.js';
import { createManifestChecksumValidator } from './core-binary-columnar-checksum.js';
import { createLoaderError, resolveArtifactMetaEnvelope } from './shared.js';
import { joinPathSafe } from '../../path-normalize.js';
import {
  resolveBinaryColumnarDefaultPaths,
  resolveReadableArtifactPathState
} from './core-source-resolution.js';

const SUPPORTED_BINARY_COLUMNAR_FORMAT = 'binary-columnar-v1';

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

export const resolveBinaryColumnarContext = ({
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
