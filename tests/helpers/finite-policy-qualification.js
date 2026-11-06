import { authoredEvidenceTask, evidenceTaskHash as hash } from './finite-evidence-task.js';
import { evidenceTaskCohortInputIdentity } from '../../tools/eval/tasks/cohort.js';
import { finiteEvidencePolicyIdentity } from '../../tools/eval/qualification/finite-source.js';

export const finitePolicyQualificationFixture = ({ count = 3, alter = null } = {}) => {
  const input = { schemaVersion: 1, compilations: Array.from({ length: count }, (_, i) => {
    const task = authoredEvidenceTask('policy-' + i); task.spec.problem = 'Select main and helper together, or select the alternative.'; return task;
  }), splitPolicy: { schemaVersion: 1, seed: 'finite-policy', train: 0, dev: 0, calibration: 0, test: 10000 },
  candidates: ['lexical-visible-prefix-v1', 'source-order-files-v1'].map(method => ({ schemaVersion: 1, method, runId: hash('policy-' + method),
    maxReadBytes: 1048576, maxSelectedFiles: 1, maxSelectedSourceBytes: 1048576, maxWorkMs: 100 })) };
  if (alter) alter(input);
  const domain = Object.fromEntries(['actionId', 'sourceDomainId', 'modelId', 'filterId', 'vectorTargetId',
    'featureSchemaId', 'runtimeId', 'resourcePolicyId', 'oracleId', 'checkerId'].map(key => [key, hash('finite-domain-' + key)]));
  const spec = { schemaVersion: 1, profile: 'finite-source-evidence-policy-v1', corpusInputId: evidenceTaskCohortInputIdentity(input),
    baselinePolicyId: finiteEvidencePolicyIdentity(input.candidates[0]), candidatePolicyId: finiteEvidencePolicyIdentity(input.candidates[1]),
    domain, fallbackId: hash('fixed-original-fallback'), fitting: 'none-fixed-registered-policy',
    riskEstimand: 'authored-source-certificate-failure-on-answer', runtimeFeatures: 'registered-visible-source-only; no-predictor-inputs',
    missingLabels: 'identification-bounds; never-drop-or-impute-success', selection: 'single-original-frozen-plan',
    uncertainty: 'paired-family-bootstrap-diagnostic-only', thresholds: { minLeakageComponents: 2, maxRisk: 0,
      minCoverage: 0.5, minUtility: 0.5, maxReadBytesPerTask: 1048576 }, cohorts: [],
    qualityRequest: { schemaVersion: 1, baselineMethod: input.candidates[0].method, candidateMethod: input.candidates[1].method,
      seed: 'paired-finite-policy', resamples: 32, limits: {} }, minPairedQualityDifference: 0,
    notBefore: 100, expiresAt: 200 };
  return { input, spec };
};
