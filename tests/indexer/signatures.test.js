#!/usr/bin/env node
import { buildIncrementalSignature, buildTokenizationKey } from '../../src/index/build/indexer/signatures.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const baseRuntime = {
  commentsConfig: {
    licensePattern: /MIT/,
    generatedPattern: /@generated/,
    linterPattern: /eslint/
  },
  dictConfig: { splitCase: true },
  postingsConfig: { enablePhraseNgrams: true },
  dictSignature: 'sig-a',
  segmentsConfig: { enabled: true }
};

const tokenKeyA = buildTokenizationKey(baseRuntime, 'code');
const tokenKeyB = buildTokenizationKey({ ...baseRuntime, dictSignature: 'sig-b' }, 'code');
if (tokenKeyA === tokenKeyB) {
  fail('buildTokenizationKey should reflect dictSignature changes.');
}

const runtimeA = {
  astDataflowEnabled: true,
  controlFlowEnabled: false,
  lintEnabled: true,
  complexityEnabled: true,
  riskAnalysisEnabled: false,
  riskAnalysisCrossFileEnabled: false,
  typeInferenceEnabled: true,
  typeInferenceCrossFileEnabled: false,
  gitBlameEnabled: true,
  indexingConfig: {
    riskRules: { foo: 'bar' },
    riskCaps: { max: 1 },
    importScan: 'post'
  },
  languageOptions: {
    javascript: { parser: 'babel', flow: 'auto' },
    typescript: { parser: 'auto', importsOnly: false },
    treeSitter: {
      enabled: true,
      languages: { js: true },
      configChunking: true,
      maxBytes: 100,
      maxLines: 200,
      maxParseMs: 300,
      byLanguage: {}
    },
    yamlChunking: { mode: 'root' },
    kotlin: { flowMaxBytes: 1 }
  },
  embeddingEnabled: true,
  embeddingService: false,
  embeddingMode: 'inline',
  embeddingBatchSize: 32,
  fileCaps: { default: { maxBytes: 1, maxLines: 2 }, byExt: {}, byLanguage: {} },
  fileScan: { sampleBytes: 64 },
  incrementalBundleFormat: 'json'
};

const sigA = buildIncrementalSignature(runtimeA, 'code', tokenKeyA);
const sigB = buildIncrementalSignature({
  ...runtimeA,
  languageOptions: {
    ...runtimeA.languageOptions,
    typescript: { parser: 'typescript', importsOnly: false }
  }
}, 'code', tokenKeyA);
if (sigA === sigB) {
  fail('buildIncrementalSignature should reflect parser changes.');
}

const sigC = buildIncrementalSignature({
  ...runtimeA,
  embeddingBatchSize: 64
}, 'code', tokenKeyA);
if (sigA === sigC) {
  fail('buildIncrementalSignature should reflect embedding batch changes.');
}

console.log('indexer signatures tests passed');
