#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildIncrementalSignature,
  buildIncrementalSignaturePayload
} from '../../../src/index/build/indexer/signatures.js';

const makeRuntime = (commitId) => ({
  repoProvenance: {
    provider: 'git',
    head: { commitId },
    commit: commitId
  },
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
  languageOptions: {},
  segmentsConfig: {},
  commentsConfig: {},
  dictConfig: {},
  dictSignature: null,
  postingsConfig: {},
  incrementalBundleFormat: null,
  toolInfo: { version: 'test' }
});

const tokenizationKey = 'token-key';
const runtimeA = makeRuntime('aaaa1111bbbb2222');
const runtimeB = makeRuntime('cccc3333dddd4444');

const payload = buildIncrementalSignaturePayload(runtimeA, 'code', tokenizationKey);
assert.equal(payload.scm.provider, 'git');
assert.equal(payload.scm.head.commitId, 'aaaa1111bbbb2222');

const sigA = buildIncrementalSignature(runtimeA, 'code', tokenizationKey);
const sigA2 = buildIncrementalSignature(runtimeA, 'code', tokenizationKey);
const sigB = buildIncrementalSignature(runtimeB, 'code', tokenizationKey);

assert.equal(sigA, sigA2, 'signature should be stable for identical inputs');
assert.notEqual(sigA, sigB, 'signature should vary with scm head');

console.log('signature provenance stability ok');
