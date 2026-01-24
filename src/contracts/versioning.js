export const ARTIFACT_SURFACE_VERSION = '0.0.1';
export const SHARDED_JSONL_META_SCHEMA_VERSION = '0.0.1';

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export const parseSemver = (value) => {
  if (typeof value !== 'string' || !SEMVER_RE.test(value)) return null;
  const [core, prerelease = null] = value.split('-', 2);
  const parts = core.split('.').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return {
    major: parts[0],
    minor: parts[1],
    patch: parts[2],
    prerelease
  };
};

export const resolveSupportedMajors = (currentVersion) => {
  const parsed = parseSemver(currentVersion);
  if (!parsed) return [];
  if (parsed.major <= 0) return [parsed.major];
  return [parsed.major, parsed.major - 1];
};

export const isSupportedMajor = (major, currentVersion) => {
  const supported = resolveSupportedMajors(currentVersion);
  return supported.includes(major);
};

export const isSupportedVersion = (version, currentVersion) => {
  const parsed = parseSemver(version);
  if (!parsed) return false;
  return isSupportedMajor(parsed.major, currentVersion);
};

export const SUPPORTED_ARTIFACT_SURFACE_MAJORS = resolveSupportedMajors(ARTIFACT_SURFACE_VERSION);
export const SUPPORTED_SHARDED_META_MAJORS = resolveSupportedMajors(SHARDED_JSONL_META_SCHEMA_VERSION);
