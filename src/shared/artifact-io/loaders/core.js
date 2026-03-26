import { MAX_JSON_BYTES } from '../constants.js';
import { resolveJsonlRequiredKeys } from '../jsonl.js';
import {
  loadPiecesManifest,
  resolveManifestArtifactSources,
  resolveManifestMaxBytes
} from '../manifest.js';
import { createLoaderError, iterateColumnarRows } from './shared.js';
import { resolveRequiredSources } from './core-source-resolution.js';
import {
  iterateBinaryColumnarRows,
  loadArrayPayloadFromSources,
  loadArrayPayloadFromSourcesSync,
  loadManifestJsonObjectFromSources,
  streamJsonlRowsFromSources
} from './core-array-payload.js';
import { loadFileMetaRows } from './core-file-meta.js';
import { readJsonFile } from '../json.js';

export const loadJsonArrayArtifact = async (
  dir,
  baseName,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
    manifest = null,
    strict = true,
    concurrency = null,
    enforceBinaryDataBudget = true
  } = {}
) => {
  const validationMode = strict ? 'strict' : 'trusted';
  const resolvedManifest = manifest || loadPiecesManifest(
    dir,
    { maxBytes: resolveManifestMaxBytes(maxBytes), strict }
  );
  const sources = resolveRequiredSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    maxBytes,
    strict
  });
  const resolvedKeys = requiredKeys ?? resolveJsonlRequiredKeys(baseName);
  return await loadArrayPayloadFromSources(sources, {
    dir,
    manifest: resolvedManifest,
    strict,
    baseName,
    maxBytes,
    requiredKeys: resolvedKeys,
    validationMode,
    concurrency,
    enforceBinaryDataBudget
  });
};

export const loadJsonArrayArtifactRows = async function* (
  dir,
  baseName,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
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
  const resolvedKeys = requiredKeys ?? resolveJsonlRequiredKeys(baseName);
  void materialize;
  const sources = resolveRequiredSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    maxBytes,
    strict
  });
  if (sources.format === 'json') {
    for (const sourcePath of sources.paths) {
      const payload = readJsonFile(sourcePath, { maxBytes });
      const rows = Array.isArray(payload) ? payload : [];
      for (const row of rows) yield row;
    }
    return;
  }
  if (sources.format === 'columnar') {
    for (const sourcePath of sources.paths) {
      const payload = readJsonFile(sourcePath, { maxBytes });
      const rows = iterateColumnarRows(payload);
      if (!rows) {
        throw createLoaderError('ERR_ARTIFACT_INVALID', `Invalid columnar payload for ${baseName}`);
      }
      for (const row of rows) yield row;
    }
    return;
  }
  if (sources.format === 'binary-columnar') {
    for (const row of iterateBinaryColumnarRows({
      dir,
      baseName,
      sources,
      manifest: resolvedManifest,
      maxBytes,
      strict,
      enforceBinaryDataBudget
    })) {
      yield row;
    }
    return;
  }
  for await (const row of streamJsonlRowsFromSources(sources.paths, sources.offsets, {
    maxBytes,
    requiredKeys: resolvedKeys,
    validationMode,
    maxInFlight,
    onBackpressure,
    onResume
  })) {
    yield row;
  }
};

export { loadFileMetaRows };

export const loadJsonObjectArtifact = async (
  dir,
  baseName,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(
    dir,
    { maxBytes: resolveManifestMaxBytes(maxBytes), strict }
  );
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    strict,
    maxBytes
  });
  return loadManifestJsonObjectFromSources({
    sources,
    baseName,
    strict,
    maxBytes
  });
};

export const loadJsonObjectArtifactSync = (
  dir,
  baseName,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(
    dir,
    { maxBytes: resolveManifestMaxBytes(maxBytes), strict }
  );
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    strict,
    maxBytes
  });
  return loadManifestJsonObjectFromSources({
    sources,
    baseName,
    strict,
    maxBytes
  });
};

export const loadJsonArrayArtifactSync = (
  dir,
  baseName,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
    manifest = null,
    strict = true,
    enforceBinaryDataBudget = true
  } = {}
) => {
  const validationMode = strict ? 'strict' : 'trusted';
  const resolvedManifest = manifest || loadPiecesManifest(
    dir,
    { maxBytes: resolveManifestMaxBytes(maxBytes), strict }
  );
  const sources = resolveRequiredSources({
    dir,
    manifest: resolvedManifest,
    name: baseName,
    maxBytes,
    strict
  });
  const resolvedKeys = requiredKeys ?? resolveJsonlRequiredKeys(baseName);
  return loadArrayPayloadFromSourcesSync(sources, {
    dir,
    manifest: resolvedManifest,
    strict,
    baseName,
    maxBytes,
    requiredKeys: resolvedKeys,
    validationMode,
    enforceBinaryDataBudget
  });
};
