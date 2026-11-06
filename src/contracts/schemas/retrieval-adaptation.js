import { semanticObject as object, semanticHashSchema as hash, semanticNullable as nullable } from './semantic-envelopes.js';

const text = maxLength => ({ type: 'string', minLength: 1, maxLength });
const dimension = { type: 'integer', minimum: 1, maximum: 4096 };
const artifact = object({ status: { enum: ['verified', 'immutable-revision'] }, reuse: { const: 'allow' },
  digest: nullable(hash), revision: nullable({ type: 'string', pattern: '^[a-f0-9]{40}$' }) });
const encoder = { provider: text(128), modelId: text(4096), artifact, dimensions: dimension,
  inputFormattingId: hash, poolingId: hash, representedInputPolicyId: hash };

export const RETRIEVAL_ADAPTATION_VERSION = 1;
export const DIRECTIONAL_QUERY_CONTRACT_SCHEMA = object({ ...encoder, role: { const: 'query' },
  stage: { const: 'base-query-output-before-consumer-normalization' }, inputDtype: { const: 'float32' } });
export const DIRECTIONAL_DOCUMENT_CONTRACT_SCHEMA = object({ ...encoder, role: { enum: ['merged', 'code', 'doc'] },
  mergePolicyId: hash, normalizationId: hash, metric: { const: 'cosine' },
  representation: { enum: ['original-float32', 'dequantized-q8-float32'] }, quantizationId: nullable(hash) });
export const DIRECTIONAL_QUERY_SPEC_SCHEMA = object({ schemaVersion: { const: RETRIEVAL_ADAPTATION_VERSION },
  query: DIRECTIONAL_QUERY_CONTRACT_SCHEMA, document: DIRECTIONAL_DOCUMENT_CONTRACT_SCHEMA,
  purpose: { enum: ['identity-control', 'trained-candidate'] }, trainingCohortId: nullable(hash), splitManifestId: nullable(hash),
  sourceDependencies: { type: 'array', items: hash, uniqueItems: true, maxItems: 256 },
  rightsScopeId: hash, objectiveId: hash,
  kernel: { const: 'residual-uv-f32le-f64acc-normalize-f32-v1' },
  rank: { type: 'integer', minimum: 1, maximum: 64 } });
const factor = object({ encoding: { const: 'float32-le-base64' }, sha256: hash, data: text(1398104) });
export const DIRECTIONAL_QUERY_ARTIFACT_SCHEMA = object({ schemaVersion: { const: RETRIEVAL_ADAPTATION_VERSION },
  kind: { const: 'directional-query-adapter' }, spec: DIRECTIONAL_QUERY_SPEC_SCHEMA, u: factor, v: factor, pairId: hash });
