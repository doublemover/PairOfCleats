import { mergeConfig } from '../../src/shared/config.js';

const FAST_INDEXING_TEST_CONFIG = Object.freeze({
  indexing: {
    artifacts: {
      binaryColumnar: false
    },
    scm: {
      provider: 'none'
    },
    embeddings: {
      hnsw: { enabled: false },
      lancedb: { enabled: false }
    },
    treeSitter: {
      enabled: false
    },
    typeInference: false,
    typeInferenceCrossFile: false,
    riskAnalysis: false,
    riskAnalysisCrossFile: false
  },
  tooling: {
    autoEnableOnDetect: false,
    lsp: {
      enabled: false
    }
  }
});

export const createFastIndexingTestConfig = (overrides = {}) => (
  mergeConfig(FAST_INDEXING_TEST_CONFIG, overrides)
);
