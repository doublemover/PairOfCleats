import { semanticObject as object, semanticHashSchema as hash, semanticNullable as nullable } from './semantic-envelopes.js';
import { EVIDENCE_TASK_SCHEMAS } from './evidence-task.js';
const text = maxLength => ({ type: 'string', minLength: 1, maxLength });
const unit = { type: 'number', minimum: 0, maximum: 1 };
const count = { type: 'integer', minimum: 0, maximum: 8 };
export const FINITE_POLICY_DOMAIN_SCHEMA = object(Object.fromEntries(['actionId', 'sourceDomainId', 'modelId', 'filterId', 'vectorTargetId',
  'featureSchemaId', 'runtimeId', 'resourcePolicyId', 'oracleId', 'checkerId'].map(key => [key, hash])));
const thresholds = object({ minLeakageComponents: { type: 'integer', minimum: 1, maximum: 8 }, maxRisk: unit,
  minCoverage: { type: 'number', exclusiveMinimum: 0, maximum: 1 }, minUtility: unit,
  maxReadBytesPerTask: { type: 'integer', minimum: 0, maximum: 1048576 } });
export const FINITE_POLICY_QUALIFICATION_SCHEMA = object({ schemaVersion: { const: 1 }, profile: { const: 'finite-source-evidence-policy-v1' },
  corpusInputId: hash, baselinePolicyId: hash, candidatePolicyId: hash, domain: FINITE_POLICY_DOMAIN_SCHEMA, fallbackId: hash,
  fitting: { const: 'none-fixed-registered-policy' }, riskEstimand: { const: 'authored-source-certificate-failure-on-answer' },
  runtimeFeatures: { const: 'registered-visible-source-only; no-predictor-inputs' },
  missingLabels: { const: 'identification-bounds; never-drop-or-impute-success' },
  selection: { const: 'single-original-frozen-plan' }, uncertainty: { const: 'paired-family-bootstrap-diagnostic-only' },
  thresholds, cohorts: { type: 'array', maxItems: 16, items: object({ id: text(64), taskIndices: { type: 'array', minItems: 1, maxItems: 8,
    uniqueItems: true, items: { type: 'integer', minimum: 0, maximum: 7 } }, thresholds }) },
  qualityRequest: EVIDENCE_TASK_SCHEMAS.quality, minPairedQualityDifference: { type: 'number', minimum: -1, maximum: 1 },
  notBefore: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, expiresAt: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } });
const ratioBounds = { type: 'array', minItems: 2, maxItems: 2, items: unit };
const metrics = object({ declaredTasks: count, leakageComponents: count, answered: count, abstained: count, unknownActions: count,
  pass: count, fail: count, unknownLabels: count, answeredFailures: count, answeredUnknownLabels: count,
  answeredCorrect: count, coverageBounds: ratioBounds, utilityBounds: ratioBounds, riskBounds: nullable(ratioBounds), unconditionalFailureBounds: ratioBounds,
  newlyIncorrect: count, unresolvedHarmPairs: count,
  sourceReads: object({ measuredTasks: count, missingMeasurements: count, observedSum: { type: 'integer', minimum: 0, maximum: 8388608 },
    observedMaximum: { type: 'integer', minimum: 0, maximum: 1048576 }, possibleMaximum: { type: 'integer', minimum: 0, maximum: 1048576 } }) });
export const FINITE_POLICY_RECEIPT_SCHEMA = object({ schemaVersion: { const: 1 }, kind: { const: 'finite-source-policy-qualification' },
  receiptId: hash, specId: hash, spec: FINITE_POLICY_QUALIFICATION_SCHEMA, cohortExecutionId: text(64), qualityExecutionId: text(64),
  decision: { enum: ['invalid', 'insufficient-evidence', 'rejected', 'shadow-only'] },
  reasons: { type: 'array', maxItems: 128, items: text(512) },
  cohorts: { type: 'array', minItems: 1, maxItems: 17, items: object({ id: text(64), thresholds, metrics,
    gates: { type: 'array', maxItems: 16, items: object({ id: text(64), state: { enum: ['pass', 'rejected', 'insufficient-evidence'] } }) } }) },
  paired: object({ complete: { type: 'boolean' }, knownMeanDifference: nullable({ type: 'number', minimum: -1, maximum: 1 }),
    completePairs: count, clusters: count, interval95: nullable({ type: 'array', minItems: 2, maxItems: 2, items: { type: 'number', minimum: -1, maximum: 1 } }),
    interpretation: { const: 'diagnostic-paired-quality; not-a-selective-risk-bound' } }),
  evidenceId: hash, scope: { const: 'authored-finite-source-task-results-only' },
  activation: { const: 'not-authorized-by-this-profile' }, exposureRegistry: { const: 'original-plan-only; cross-run-lineage-not-qualified' } });
