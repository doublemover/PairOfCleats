import { ARTIFACT_SURFACE_VERSION, parseSemver } from './versioning.js';

export const CONTEXT_PACK_RISK_SCHEMA_VERSION = 1;
export const CONTEXT_PACK_RISK_CONTRACT_VERSION = '1.0.0';
export const CONTEXT_PACK_RISK_ACCEPTED_ARTIFACT_SURFACE_VERSIONS = Object.freeze([ARTIFACT_SURFACE_VERSION]);

const isExactSemverMatch = (value, expected) => (
  typeof value === 'string'
  && parseSemver(value) != null
  && value === expected
);

export const validateContextPackRiskContractCompatibility = (payload) => {
  const risk = payload?.risk;
  if (!risk || typeof risk !== 'object') {
    return { ok: true, errors: [] };
  }

  const errors = [];
  if (risk.version !== CONTEXT_PACK_RISK_SCHEMA_VERSION) {
    errors.push(`/risk/version must equal ${CONTEXT_PACK_RISK_SCHEMA_VERSION}`);
  }
  if (!isExactSemverMatch(risk.contractVersion, CONTEXT_PACK_RISK_CONTRACT_VERSION)) {
    errors.push(`/risk/contractVersion must equal ${CONTEXT_PACK_RISK_CONTRACT_VERSION}`);
  }

  const artifactSurfaceVersion = risk?.provenance?.artifactSurfaceVersion;
  if (artifactSurfaceVersion != null && !CONTEXT_PACK_RISK_ACCEPTED_ARTIFACT_SURFACE_VERSIONS.includes(artifactSurfaceVersion)) {
    errors.push(
      `/risk/provenance/artifactSurfaceVersion must be one of ${CONTEXT_PACK_RISK_ACCEPTED_ARTIFACT_SURFACE_VERSIONS.join(', ')}`
    );
  }

  return {
    ok: errors.length === 0,
    errors
  };
};
