import fs from 'node:fs';
import {
  iterateBinaryColumnarRowPayloads,
  loadBinaryColumnarRowPayloads
} from './binary-columnar.js';
import { createLoaderError } from './shared.js';
import {
  verifyManifestChecksum,
  verifyManifestChecksumFromFile
} from './core-binary-columnar-checksum.js';
import { resolveBinaryColumnarContext } from './core-binary-columnar-context.js';

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
