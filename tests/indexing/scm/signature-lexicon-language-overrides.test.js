#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildIncrementalSignature, buildIncrementalSignaturePayload } from '../../../src/index/build/indexer/signatures.js';

const makeRuntime = (languageOverrides) => ({
  repoProvenance: null,
  analysisPolicy: {},
  gitBlameEnabled: false,
  astDataflowEnabled: false,
  controlFlowEnabled: false,
  lintEnabled: false,
  complexityEnabled: false,
  riskAnalysisEnabled: false,
  riskAnalysisCrossFileEnabled: false,
  riskInterproceduralEnabled: false,
  riskInterproceduralConfig: null,
  typeInferenceEnabled: false,
  typeInferenceCrossFileEnabled: false,
  embeddingEnabled: false,
  embeddingService: false,
  embeddingMode: null,
  embeddingBatchSize: null,
  embeddingIdentityKey: null,
  fileCaps: {},
  fileScan: {},
  indexingConfig: {},
  languageOptions: {
    lexicon: {
      enabled: true,
      relations: { enabled: true },
      languageOverrides
    }
  },
  segmentsConfig: {},
  commentsConfig: {},
  dictConfig: {},
  dictSignature: null,
  postingsConfig: {},
  incrementalBundleFormat: null,
  toolInfo: { version: 'test' }
});

const tokenizationKey = 'token-key';
const runtimeA = makeRuntime({
  javascript: {
    relations: {
      dropUsages: ['console']
    }
  }
});
const runtimeB = makeRuntime({
  javascript: {
    relations: {
      dropUsages: ['console', 'window']
    }
  }
});

const payloadA = buildIncrementalSignaturePayload(runtimeA, 'code', tokenizationKey);
assert.deepEqual(
  payloadA.lexicon.languageOverrides,
  {
    javascript: {
      relations: {
        dropUsages: ['console']
      }
    }
  },
  'signature payload should include lexicon languageOverrides'
);

const sigA = buildIncrementalSignature(runtimeA, 'code', tokenizationKey);
const sigARepeat = buildIncrementalSignature(runtimeA, 'code', tokenizationKey);
const sigB = buildIncrementalSignature(runtimeB, 'code', tokenizationKey);

assert.equal(sigA, sigARepeat, 'signature should be stable for identical languageOverrides');
assert.notEqual(sigA, sigB, 'signature should change when lexicon languageOverrides change');

console.log('signature lexicon language overrides test passed');
