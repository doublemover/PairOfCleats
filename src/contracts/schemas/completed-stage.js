import { ARTIFACT_SURFACE_VERSION } from '../versioning.js';

const text = { type: 'string' };
const count = { type: 'integer', minimum: 0 };
const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const closed = (properties, required = Object.keys(properties)) => ({
  type: 'object', additionalProperties: false, required, properties
});

const producer = closed({
  schemaVersion: { const: 1 }, identity: nullable(digest), revision: text,
  dirty: digest, dirtyFiles: count, bootstrap: digest, node: text,
  signatureVersion: { type: 'integer' }, analysisVersions: { type: 'object', additionalProperties: text },
  evidenceScope: { const: 'observed-implementation-files-and-bootstrap-receipt' }, reason: text
}, ['identity']);
producer.allOf = [{
  if: { properties: { identity: { type: 'string' } } },
  then: { properties: producer.properties, required: ['schemaVersion', 'revision', 'dirty', 'dirtyFiles', 'bootstrap', 'node',
    'signatureVersion', 'analysisVersions', 'evidenceScope'] },
  else: { properties: { reason: producer.properties.reason }, required: ['reason'] }
}];

const sourceSnapshot = closed({
  schemaVersion: { const: 1 }, rootKey: digest, policyKey: digest,
  coverage: { const: 'fresh-enumeration-filtered-candidates' }, identity: digest,
  candidateCount: count, capturedSourceCount: count, capturedSourceBytes: count
});
const sourceValidation = closed({
  status: { enum: ['verified', 'unavailable'] }, reason: text, files: count,
  algorithm: { const: 'sha1' }, identity: digest
}, ['status', 'reason']);
sourceValidation.allOf = [{
  if: { properties: { status: { const: 'verified' } } },
  then: { properties: sourceValidation.properties, required: ['files', 'algorithm', 'identity'] }
}];

export const STAGE_SNAPSHOT_SCHEMA = closed({
  schemaVersion: { const: 1 }, relativeRoot: text, descriptorHash: digest,
  graphCapability: nullable(closed({
    status: { enum: ['ready', 'unavailable'] }, capabilityId: nullable(text), reason: nullable(text)
  }))
});

/** Same-generation completion emitted by sealCompletedStage. A completion
 * declares its exact structural evidence; runtime owners separately verify
 * byte hashes, contained paths, source authority and publication readiness.
 */
export const COMPLETED_STAGE_SCHEMA = closed({
  schemaVersion: { const: 2 }, artifactSurfaceVersion: { const: ARTIFACT_SURFACE_VERSION },
  stage: { const: 'stage2' }, mode: { enum: ['code', 'prose', 'extracted-prose', 'records'] },
  buildId: text, buildRoot: text, repoRoot: text, originatingAttemptId: nullable(text), sealedAt: text,
  configHash: nullable(text), profile: nullable(closed({
    id: { enum: ['default', 'vector_only'] }, schemaVersion: { const: 1 }
  })),
  sourceSnapshot: nullable(sourceSnapshot),
  dependencySignatures: nullable(closed(Object.fromEntries(['parse', 'lexical', 'enrichment', 'embeddings', 'artifacts', 'documentExtraction', 'sourceAdmission']
    .map(key => [key, { type: 'string', pattern: '^[0-9a-f]{40}$' }])), ['parse', 'lexical', 'enrichment', 'embeddings', 'artifacts'])),
  producer, reusePolicy: nullable(digest), sourceValidation,
  output: closed({ manifestHash: digest, contentHash: digest, pieces: count, bytes: count }),
  publicationHash: digest, validationHash: digest, familyContractsVersion: { const: 1 },
  publicationFamilies: { type: 'array', items: closed({
    family: text, owner: text, requiredMembers: { type: 'array', items: text },
    optionalMembers: { type: 'array', items: text }
  }, ['family', 'owner', 'requiredMembers']) },
  reuseAuthority: { const: 'immutable-same-generation-stage2' }, snapshot: STAGE_SNAPSHOT_SCHEMA
});
