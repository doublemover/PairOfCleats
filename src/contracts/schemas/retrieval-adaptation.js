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
export const ADAPTATION_FACTOR_SCHEMA = object({ encoding: { const: 'float32-le-base64' }, sha256: hash, data: text(1398104) });
const factor = ADAPTATION_FACTOR_SCHEMA;
export const DIRECTIONAL_QUERY_ARTIFACT_SCHEMA = object({ schemaVersion: { const: RETRIEVAL_ADAPTATION_VERSION },
  kind: { const: 'directional-query-adapter' }, spec: DIRECTIONAL_QUERY_SPEC_SCHEMA, u: factor, v: factor, pairId: hash });
export const RETRIEVAL_TRAINING_RUN_SCHEMA = object({ schemaVersion: { const: 1 }, optimizer: { const: 'sgd-momentum-f32-v1' },
  sampler: { const: 'sha256-epoch-permutation-v1' }, numericalGradient: { const: 'cosine-f64; normalization-f64; output-f32-straight-through-v1' },
  objective: { enum: ['any-positive', 'mean-positive', 'graded-positive'] },
  temperature: { type: 'number', minimum: 1e-6, maximum: 1000 }, learningRate: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
  momentum: { type: 'number', minimum: 0, exclusiveMaximum: 1 }, factorL2: { type: 'number', minimum: 0, maximum: 1 },
  maxGradientNorm: { type: 'number', exclusiveMinimum: 0, maximum: 1000000 }, seed: text(256),
  totalSteps: { type: 'integer', minimum: 1, maximum: 100000 } });
const count = { type: 'integer', minimum: 0, maximum: 100000 };
export const RETRIEVAL_TRAINING_CHECKPOINT_SCHEMA = object({ schemaVersion: { const: 1 }, kind: { const: 'directional-query-training-checkpoint' },
  cohortId: hash, vectorSetId: hash, runSpec: RETRIEVAL_TRAINING_RUN_SCHEMA, artifact: DIRECTIONAL_QUERY_ARTIFACT_SCHEMA,
  momentumU: factor, momentumV: factor, sampler: object({ step: count, epoch: count, offset: count }),
  updates: count, skipped: count, lastLoss: nullable({ type: 'number', minimum: 0 }), checkpointId: hash });
