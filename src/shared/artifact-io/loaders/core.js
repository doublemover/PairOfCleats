import { MAX_JSON_BYTES } from '../constants.js';
import { resolveJsonlRequiredKeys } from '../jsonl.js';
import {
  loadPiecesManifest,
  resolveManifestArtifactSources,
  resolveManifestMaxBytes
} from '../manifest.js';
import { resolveRequiredSources } from './core-source-resolution.js';
import {
  loadArrayPayloadFromSources,
  loadArrayPayloadFromSourcesSync,
  loadManifestJsonObjectFromSources
} from './core-array-payload.js';
import { streamArrayArtifactRowsFromSources } from './core-row-stream.js';
import { loadFileMetaRows } from './core-file-meta.js';

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
  yield* streamArrayArtifactRowsFromSources(sources, {
    dir,
    manifest: resolvedManifest,
    strict,
    baseName,
    maxBytes,
    requiredKeys: resolvedKeys,
    validationMode,
    maxInFlight,
    onBackpressure,
    onResume,
    enforceBinaryDataBudget
  });
};

export { loadFileMetaRows };

const loadJsonObjectArtifactFromManifest = ({
  dir,
  baseName,
  maxBytes,
  manifest,
  strict
}) => {
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

export const loadJsonObjectArtifact = async (
  dir,
  baseName,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  return loadJsonObjectArtifactFromManifest({
    dir,
    baseName,
    strict,
    manifest,
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
  return loadJsonObjectArtifactFromManifest({
    dir,
    baseName,
    strict,
    manifest,
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
