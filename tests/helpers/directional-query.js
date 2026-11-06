import { createHash } from 'node:crypto';
export const directionalQueryHash = text => createHash('sha256').update(text).digest('hex');
export const directionalQuerySpec = ({ dimensions = 4, rank = 2, trained = false } = {}) => {
  const hash = directionalQueryHash;
  const encoder = { provider: 'xenova', modelId: 'fixture/frozen-encoder',
    artifact: { status: 'verified', reuse: 'allow', digest: hash('weights-and-tokenizer'), revision: null }, dimensions,
    inputFormattingId: hash('format'), poolingId: hash('pooling'), representedInputPolicyId: hash('input-policy') };
  return { schemaVersion: 1, query: { ...structuredClone(encoder), role: 'query',
    stage: 'base-query-output-before-consumer-normalization', inputDtype: 'float32' },
  document: { ...structuredClone(encoder), role: 'merged', mergePolicyId: hash('merged-v1'), normalizationId: hash('normalize-v1'),
    metric: 'cosine', representation: 'original-float32', quantizationId: null },
  purpose: trained ? 'trained-candidate' : 'identity-control', trainingCohortId: trained ? hash('cohort') : null,
  splitManifestId: trained ? hash('split') : null, sourceDependencies: trained ? [hash('training-source')] : [],
  rightsScopeId: hash('rights-scope'), objectiveId: hash('positive-set-likelihood'),
  kernel: 'residual-uv-f32le-f64acc-normalize-f32-v1', rank };
};
