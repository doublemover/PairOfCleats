import { semanticObject as object, semanticHashSchema as hash, semanticNullable as nullable,
  SEMANTIC_GENERATION_SCHEMA } from './semantic-envelopes.js';
import { RUNTIME_EVIDENCE_SCHEMA } from './runtime-evidence.js';
import { RUNTIME_QUERY_LIMITS_SCHEMA } from './runtime-query.js';
import { ARTIFACT_SURFACE_VERSION } from '../versioning.js';
const text = { type: 'string', minLength: 1, maxLength: 4096 };
const list = (items, maxItems = 128) => ({ type: 'array', items, maxItems, uniqueItems: true });
const source = object({ sourceUnitId: { type: 'string', pattern: '^su1:[a-f0-9]{64}$' }, byteHash: hash });
const pin = object({ generationId: hash, captureId: text, manifestHash: hash });
const claim = { allOf: [RUNTIME_EVIDENCE_SCHEMA, { type: 'object', properties: { kind: { const: 'derivedClaim' } } }] };
const scope = { schemaVersion: { const: 1 }, repositoryNamespace: text, generation: SEMANTIC_GENERATION_SCHEMA };
export const RUNTIME_COMPARE_REQUEST_SCHEMA = object({ ...scope, leftFamily: hash, rightFamily: hash,
  sources: { ...list(source, 32), minItems: 1 }, limits: RUNTIME_QUERY_LIMITS_SCHEMA, persist: { type: 'boolean' } });
export const RUNTIME_CLAIMS_REQUEST_SCHEMA = object({ ...scope, claimGeneration: hash,
  limits: RUNTIME_QUERY_LIMITS_SCHEMA, cursor: nullable({ type: 'string', maxLength: 4096 }) });
export const RUNTIME_COMPARE_RESULT_SCHEMA = object({ ...scope, executionAuthorized: { const: false },
  status: { enum: ['complete', 'partial', 'incompatible'] }, reasons: list(text), pinnedFamilies: list(pin, 2),
  claims: { type: 'array', maxItems: 64, items: claim }, claimGeneration: nullable(hash) });
export const RUNTIME_CLAIM_MANIFEST_SCHEMA = object({ ...scope, artifactSurfaceVersion: { const: ARTIFACT_SURFACE_VERSION },
  claimGeneration: hash, inputs: { ...list(pin, 2), minItems: 1 },
  citations: { ...list(object({ generationId: hash, captureId: text, evidenceId: text, rowHash: hash })), minItems: 1 },
  rows: list(object({ evidenceId: text, hash, start: { type: 'integer', minimum: 0 }, byteLength: { type: 'integer', minimum: 1 } }), 64),
  evidenceHash: hash, offsetsHash: hash, byteLength: { type: 'integer', minimum: 0 } });
export const RUNTIME_CLAIMS_RESULT_SCHEMA = object({ ...scope, executionAuthorized: { const: false },
  claimGeneration: hash, inputs: list(pin, 2), claims: { type: 'array', maxItems: 128, items: claim },
  integrity: { const: 'claims-and-cited-observations-verified' }, nextCursor: nullable(text) });
export const RUNTIME_COMPARE_SERVICE_SCHEMA = object({ schemaVersion: { const: 1 }, repoRoot: text, destination: text,
  request: RUNTIME_COMPARE_REQUEST_SCHEMA });
export const RUNTIME_CLAIMS_SERVICE_SCHEMA = object({ schemaVersion: { const: 1 }, repoRoot: text, destination: text,
  request: RUNTIME_CLAIMS_REQUEST_SCHEMA });
export const RUNTIME_CLAIMS_SCHEMAS = { compareRequest: RUNTIME_COMPARE_REQUEST_SCHEMA, compareResult: RUNTIME_COMPARE_RESULT_SCHEMA,
  request: RUNTIME_CLAIMS_REQUEST_SCHEMA, result: RUNTIME_CLAIMS_RESULT_SCHEMA, manifest: RUNTIME_CLAIM_MANIFEST_SCHEMA,
  compareService: RUNTIME_COMPARE_SERVICE_SCHEMA, claimsService: RUNTIME_CLAIMS_SERVICE_SCHEMA };
