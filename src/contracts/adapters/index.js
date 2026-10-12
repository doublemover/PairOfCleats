import { ARTIFACT_SURFACE_VERSION, SHARDED_JSONL_META_SCHEMA_VERSION, parseSemver } from '../versioning.js';
import { assertCurrentIndexFormat } from '../index-format.js';

// Kept as a call-site facade, not a migration adapter. No payload is reshaped.
const exactPayload = (payload, version, expectedVersion, component, options = {}) => {
  try {
    assertCurrentIndexFormat({
      operation: 'read', component, foundVersion: version, expectedVersion,
      repoRoot: options.repoRoot || process.cwd(), indexPath: options.indexPath || process.cwd()
    });
    return { ok: true, payload, adapted: false };
  } catch (error) {
    return { ok: false, error: error.message, code: error.code, details: error.details };
  }
};
export const adaptArtifactSurfacePayload = (payload, version, options) =>
  exactPayload(payload, version, ARTIFACT_SURFACE_VERSION, 'artifact surface', options);
export const adaptShardedMetaPayload = (payload, version, options) =>
  exactPayload(payload, version, SHARDED_JSONL_META_SCHEMA_VERSION, 'sharded metadata', options);
export const SUPPORTED_ARTIFACT_SURFACE_MAJORS = Object.freeze([parseSemver(ARTIFACT_SURFACE_VERSION).major]);
export const SUPPORTED_SHARDED_META_MAJORS = Object.freeze([parseSemver(SHARDED_JSONL_META_SCHEMA_VERSION).major]);
