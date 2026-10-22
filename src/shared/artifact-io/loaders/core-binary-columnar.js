import { constants as bufferConstants } from 'node:buffer';
import { readBuffer } from '../compression.js';
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
import {
  assertBinaryColumnarJsonRowCount,
  parseBinaryColumnarJsonRow
} from './core-binary-columnar-json-rows.js';

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
    enforceDataBudget,
    containedRoot: strict ? dir : null
  });
  const dataBuffer = readBuffer(resolvedDataPath, enforceDataBudget ? maxBytes : bufferConstants.MAX_LENGTH, { containedRoot: strict ? dir : null });
  const offsetsBuffer = readBuffer(resolvedOffsetsPath, maxBytes, { containedRoot: strict ? dir : null });
  const lengthsBuffer = readBuffer(resolvedLengthsPath, maxBytes, { containedRoot: strict ? dir : null });
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
    enforceDataBudget,
    containedRoot: strict ? dir : null
  });
  if (!payloads) {
    throw createLoaderError(
      'ERR_ARTIFACT_PARTS_MISSING',
      `Missing binary-columnar payload for ${baseName}`
    );
  }
  const rows = new Array(payloads.length);
  for (let i = 0; i < payloads.length; i += 1) {
    rows[i] = parseBinaryColumnarJsonRow(payloads[i], baseName);
  }
  assertBinaryColumnarJsonRowCount({
    actualCount: rows.length,
    expectedCount: count,
    baseName
  });
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
    enforceDataBudget,
    containedRoot: strict ? dir : null
  });
  const offsetsBuffer = readBuffer(resolvedOffsetsPath, maxBytes, { containedRoot: strict ? dir : null });
  const lengthsBuffer = readBuffer(resolvedLengthsPath, maxBytes, { containedRoot: strict ? dir : null });
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
    containedRoot: strict ? dir : null,
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
    enforceDataBudget,
    containedRoot: strict ? dir : null
  });
  if (!payloads) {
    throw createLoaderError(
      'ERR_ARTIFACT_PARTS_MISSING',
      `Missing binary-columnar payload for ${baseName}`
    );
  }
  let decodedCount = 0;
  for (const payload of payloads) {
    const parsed = parseBinaryColumnarJsonRow(payload, baseName);
    decodedCount += 1;
    yield parsed;
  }
  assertBinaryColumnarJsonRowCount({
    actualCount: decodedCount,
    expectedCount: count,
    baseName
  });
};

export {
  iterateBinaryColumnarJsonRows,
  loadBinaryColumnarJsonRows
};
