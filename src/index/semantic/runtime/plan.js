import { assertRuntimeEvidence } from '../../../contracts/validators/runtime-evidence.js';
import { semanticHash } from '../identity.js';
/** Pure planning only. Capability input is already-collected evidence for one exact binary. */
export const planRuntimeEvidence = ({ request, capabilities }) => {
  assertRuntimeEvidence('request', request);
  assertRuntimeEvidence('capabilities', capabilities);
  const desired = request.desiredEvidence.map((kind) => {
    const candidates = capabilities.capabilities.filter(row => row.evidenceKind === kind
      && request.permittedCollectors.includes(row.collector));
    return { evidenceKind: kind, candidates,
      state: candidates.some(row => row.status === 'supported') ? 'supported'
        : candidates.some(row => row.status === 'requires-restart') ? 'requires-restart'
          : candidates.some(row => row.status === 'requires-special-build') ? 'requires-special-build'
            : candidates.length && candidates.every(row => row.status === 'unsupported') ? 'unsupported' : 'unknown' };
  });
  return { schemaVersion: 1, planId: 'rp1:' + semanticHash('pairofcleats.runtime.plan.v1', { request, capabilities }),
    requestId: request.requestId, executableHash: capabilities.runtime.executableHash,
    action: 'plan-only', executionAuthorized: false, desired,
    permissionRequirements: ['Explicit capture authorization is required before starting or attaching a collector.'],
    warnings: ['Capability evidence is specific to the supplied executable hash and platform; no runtime was probed or executed.'] };
};
/** Offline import authority cannot be used as execution or attachment authority. */
export const assertRuntimeImportAuthority = ({ authority, capture, artifacts }) => {
  assertRuntimeEvidence('capture', capture);
  if (!authority || authority.action !== 'import-existing' || authority.captureId !== capture.captureId
    || !Array.isArray(authority.artifactHashes) || Object.keys(authority).some(key => !['action', 'captureId', 'artifactHashes'].includes(key))) {
    throw Object.assign(new TypeError('Explicit existing-artifact import authority required.'), { code: 'ERR_RUNTIME_IMPORT_AUTHORITY' });
  }
  const allowed = new Set(authority.artifactHashes);
  for (const artifact of artifacts) {
    assertRuntimeEvidence('rawArtifact', artifact);
    if (artifact.captureId !== capture.captureId || !allowed.has(artifact.hash)
      || !capture.rawArtifacts.some(row => row.artifactId === artifact.artifactId && row.hash === artifact.hash)) {
      throw Object.assign(new TypeError('Artifact is outside the authorized capture.'), { code: 'ERR_RUNTIME_IMPORT_AUTHORITY' });
    }
  }
  return { action: 'import-existing', executionAuthorized: false, artifactCount: artifacts.length };
};
/** Hashes dominate source joins; names or addresses never establish source identity. */
export const joinRuntimeSource = ({ sourceHash, sourceMapHash = null, candidates }) => {
  const exact = candidates.filter(row => sourceHash && row.sourceHash === sourceHash);
  const sourceUnits = new Set(exact.map(row => row.sourceUnitId));
  if (sourceUnits.size === 1) return { quality: 'exact-source', sourceUnitId: exact[0].sourceUnitId,
    sourceHash, targets: exact.flatMap(row => row.targets), reasons: [], sourceMapHash };
  return { quality: exact.length ? 'ambiguous' : 'unresolved', sourceUnitId: null, sourceHash: sourceHash || null,
    targets: exact.flatMap(row => row.targets), reasons: [exact.length ? 'multiple_source_snapshots_match' : 'exact_source_hash_unavailable_or_mismatched'], sourceMapHash };
};
