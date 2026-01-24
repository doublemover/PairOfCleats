import {
  ARTIFACT_SURFACE_VERSION,
  SHARDED_JSONL_META_SCHEMA_VERSION,
  parseSemver,
  resolveSupportedMajors
} from '../versioning.js';

const buildAdapter = (label, currentVersion, adaptersByMajor) => {
  const currentParsed = parseSemver(currentVersion);
  const currentMajor = currentParsed?.major ?? null;
  const supported = resolveSupportedMajors(currentVersion);
  const applyAdapter = (payload, version) => {
    const parsed = parseSemver(version);
    if (!parsed) {
      return { ok: false, error: `${label} version is not valid SemVer.` };
    }
    if (!supported.includes(parsed.major)) {
      return { ok: false, error: `${label} major ${parsed.major} is not supported.` };
    }
    if (parsed.major === currentMajor) {
      return { ok: true, payload, adapted: false };
    }
    const adapter = adaptersByMajor[parsed.major];
    if (!adapter) {
      return { ok: false, error: `${label} adapter missing for major ${parsed.major}.` };
    }
    return { ok: true, payload: adapter(payload), adapted: true };
  };
  return { applyAdapter, currentMajor, supported };
};

const passthrough = (payload) => payload;

const artifactSurfaceAdapters = (() => {
  const current = parseSemver(ARTIFACT_SURFACE_VERSION)?.major ?? 0;
  const adapters = { [current]: passthrough };
  if (current > 0) adapters[current - 1] = passthrough;
  return adapters;
})();

const shardedMetaAdapters = (() => {
  const current = parseSemver(SHARDED_JSONL_META_SCHEMA_VERSION)?.major ?? 0;
  const adapters = { [current]: passthrough };
  if (current > 0) adapters[current - 1] = passthrough;
  return adapters;
})();

const artifactSurfaceAdapter = buildAdapter(
  'artifactSurfaceVersion',
  ARTIFACT_SURFACE_VERSION,
  artifactSurfaceAdapters
);

const shardedMetaAdapter = buildAdapter(
  'sharded meta schemaVersion',
  SHARDED_JSONL_META_SCHEMA_VERSION,
  shardedMetaAdapters
);

export const adaptArtifactSurfacePayload = (payload, version) =>
  artifactSurfaceAdapter.applyAdapter(payload, version);

export const adaptShardedMetaPayload = (payload, version) =>
  shardedMetaAdapter.applyAdapter(payload, version);

export const SUPPORTED_ARTIFACT_SURFACE_MAJORS = artifactSurfaceAdapter.supported;
export const SUPPORTED_SHARDED_META_MAJORS = shardedMetaAdapter.supported;
