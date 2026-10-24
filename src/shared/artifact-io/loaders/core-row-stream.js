import { iterateColumnarRows } from '../columnar-rows.js';
import { readJsonFile } from '../json.js';
import { createLoaderError } from './shared.js';
import {
  iterateBinaryColumnarRows,
  streamJsonlRowsFromSources
} from './core-array-payload.js';

export const streamArrayArtifactRowsFromSources = async function* (
  sources,
  {
    dir,
    manifest,
    strict,
    baseName,
    maxBytes,
    requiredKeys,
    validationMode,
    maxInFlight = 0,
    onBackpressure = null,
    onResume = null,
    enforceBinaryDataBudget = true
  }
) {
  if (sources.format === 'json') {
    for (const sourcePath of sources.paths) {
      const payload = readJsonFile(sourcePath, { maxBytes, containedRoot: sources.containedRoot });
      const rows = Array.isArray(payload) ? payload : [];
      for (const row of rows) yield row;
    }
    return;
  }
  if (sources.format === 'columnar') {
    for (const sourcePath of sources.paths) {
      const payload = readJsonFile(sourcePath, { maxBytes, containedRoot: sources.containedRoot });
      const rows = iterateColumnarRows(payload);
      if (!rows) {
        throw createLoaderError('ERR_ARTIFACT_INVALID', `Invalid columnar payload for ${baseName}`);
      }
      for (const row of rows) yield row;
    }
    return;
  }
  if (sources.format === 'binary-columnar') {
    yield* iterateBinaryColumnarRows({
      dir,
      baseName,
      sources,
      manifest,
      maxBytes,
      strict,
      enforceBinaryDataBudget
    });
    return;
  }
  for await (const row of streamJsonlRowsFromSources(sources.paths, sources.offsets, {
    maxBytes,
    containedRoot: sources.containedRoot,
    requiredKeys,
    validationMode,
    maxInFlight,
    onBackpressure,
    onResume
  })) {
    yield row;
  }
};
