import { MAX_JSON_BYTES } from '../constants.js';
import { readJsonFile } from '../json.js';
import { resolveJsonlRequiredKeys } from '../jsonl.js';
import { loadPiecesManifest, resolveManifestMaxBytes } from '../manifest.js';
import { iterateColumnarRows } from '../columnar-rows.js';
import { createLoaderError } from './shared.js';
import { admitJsonArrayPayload } from '../payload-admission.js';
import { throwIfAborted } from '../../abort.js';
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
    enforceBinaryDataBudget = true,
    signal = null
  } = {}
) {
  const validationMode = strict ? 'strict' : 'trusted';
  throwIfAborted(signal);
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
      const payload = admitJsonArrayPayload(readJsonFile(sourcePath, { maxBytes, containedRoot: sources.containedRoot }),
        { artifact: 'file_meta', sourcePath });
      for (let i = 0; i < payload.length; i += 1) {
        throwIfAborted(signal);
        yield validateFileMetaRow(payload[i], 'file_meta');
      }
    }
    return;
  }
  if (sources.format === 'columnar') {
    for (const [index, sourcePath] of sources.paths.entries()) {
      const payload = readJsonFile(sourcePath, { maxBytes, containedRoot: sources.containedRoot });
      const iterator = iterateColumnarRows(payload, { artifact: 'file_meta', sourcePath,
        expectedCount: sources.sourceParts?.[index]?.expectedCount });
      if (!iterator) {
        throw createLoaderError('ERR_ARTIFACT_INVALID', 'Invalid columnar payload for file_meta');
      }
      for (const row of iterator) {
        throwIfAborted(signal);
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
      throwIfAborted(signal);
      yield validateFileMetaRow(row, 'file_meta');
    }
    return;
  }
  for await (const row of streamJsonlRowsFromSources(sources.paths, sources.offsets, {
    maxBytes,
    containedRoot: sources.containedRoot,
    requiredKeys: resolvedKeys,
    validationMode,
    maxInFlight,
    onBackpressure,
    onResume,
    signal,
    expectedCounts: sources.sourceParts?.map(part => part.expectedCount),
    rowMapper: (entry) => validateFileMetaRow(entry, 'file_meta')
  })) {
    yield row;
  }
};
