import { iterateColumnarRows } from '../columnar-rows.js';
import { readJsonFile } from '../json.js';
import { createLoaderError } from './shared.js';
import { admitJsonArrayPayload } from '../payload-admission.js';
import { throwIfAborted } from '../../abort.js';
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
    enforceBinaryDataBudget = true,
    signal = null
  }
) {
  if (sources.format === 'json') {
    throwIfAborted(signal);
    for (const sourcePath of sources.paths) {
      throwIfAborted(signal);
      const payload = admitJsonArrayPayload(readJsonFile(sourcePath, { maxBytes, containedRoot: sources.containedRoot }),
        { artifact: baseName, sourcePath });
      throwIfAborted(signal);
      for (const row of payload) {
        throwIfAborted(signal);
        yield row;
      }
    }
    throwIfAborted(signal);
    return;
  }
  if (sources.format === 'columnar') {
    for (const [index, sourcePath] of sources.paths.entries()) {
      throwIfAborted(signal);
      const payload = readJsonFile(sourcePath, { maxBytes, containedRoot: sources.containedRoot });
      const rows = iterateColumnarRows(payload, { artifact: baseName, sourcePath,
        expectedCount: sources.sourceParts?.[index]?.expectedCount });
      if (!rows) {
        throw createLoaderError('ERR_ARTIFACT_INVALID', `Invalid columnar payload for ${baseName}`);
      }
      for (const row of rows) { throwIfAborted(signal); yield row; }
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
    onResume,
    signal,
    expectedCounts: sources.sourceParts?.map(part => part.expectedCount)
  })) {
    yield row;
  }
};
