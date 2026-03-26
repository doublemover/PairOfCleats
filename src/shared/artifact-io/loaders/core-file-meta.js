import { MAX_JSON_BYTES } from '../constants.js';
import { readJsonFile } from '../json.js';
import { resolveJsonlRequiredKeys } from '../jsonl.js';
import { loadPiecesManifest, resolveManifestMaxBytes } from '../manifest.js';
import { createLoaderError, iterateColumnarRows } from './shared.js';
import { resolveRequiredSources } from './core-source-resolution.js';
import { streamJsonlRowsFromSources, iterateBinaryColumnarRows } from './core-array-payload.js';

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
