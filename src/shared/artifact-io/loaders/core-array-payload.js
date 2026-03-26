import { readJsonFile, readJsonLinesArray, readJsonLinesArraySync, readJsonLinesIterator } from '../json.js';
import { createLoaderError, ensureOffsetsValid, inflateColumnarRows, iterateColumnarRows } from './shared.js';
import { iterateBinaryColumnarJsonRows } from './core-binary-columnar.js';
import {
  resolveBinaryColumnarSourcePart,
  resolveReadableArtifactPath
} from './core-source-resolution.js';

const appendRows = (target, rows) => {
  for (let i = 0; i < rows.length; i += 1) {
    target.push(rows[i]);
  }
  return target;
};

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

export const streamJsonlRowsFromSources = async function* (
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

export const loadArrayPayloadFromSources = async (
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

export const loadArrayPayloadFromSourcesSync = (
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

export const loadManifestJsonObjectFromSources = ({
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

export { iterateBinaryColumnarRows, iterateColumnarRows };
