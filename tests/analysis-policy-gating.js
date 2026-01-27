#!/usr/bin/env node
import assert from 'node:assert/strict';
import { processChunks } from '../src/index/build/file-processor/process-chunks.js';
import { createTokenizationContext } from '../src/index/build/tokenization.js';
import { buildLineIndex } from '../src/shared/lines.js';
import { normalizeRiskConfig } from '../src/index/risk.js';

const text = 'const token = "SECRET";\n';
const sc = [{
  start: 0,
  end: text.length,
  segment: { languageId: 'javascript', segmentUid: 'seg-test' },
  kind: 'code',
  name: 'example'
}];
const lineIndex = buildLineIndex(text);
const riskConfig = normalizeRiskConfig({
  enabled: true,
  rules: {
    includeDefaults: false,
    rules: {
      sources: [{ name: 'secret', patterns: ['SECRET'] }],
      sinks: [],
      sanitizers: []
    }
  }
}, { rootDir: process.cwd() });

const tokenContext = createTokenizationContext({
  dictWords: new Set(),
  dictConfig: { dpMaxTokenLength: 16 },
  postingsConfig: {}
});

const baseContext = {
  sc,
  text,
  ext: '.js',
  rel: 'src/example.js',
  relKey: 'src/example.js',
  fileStat: { size: Buffer.byteLength(text) },
  fileHash: null,
  fileHashAlgo: null,
  fileLineCount: 1,
  fileLanguageId: 'javascript',
  lang: {
    id: 'javascript',
    extractDocMeta: () => ({ paramTypes: { token: 'string' } })
  },
  languageContext: {},
  languageOptions: {},
  mode: 'code',
  relationsEnabled: false,
  fileRelations: null,
  callIndex: null,
  fileStructural: null,
  commentEntries: [],
  commentRanges: [],
  normalizedCommentsConfig: { extract: 'off', maxBytesPerChunk: 0, maxPerChunk: 0 },
  tokenDictWords: new Set(),
  dictConfig: { dpMaxTokenLength: 16 },
  tokenContext,
  postingsConfig: {},
  contextWin: 0,
  tokenMode: 'code',
  embeddingEnabled: false,
  embeddingBatchSize: 0,
  getChunkEmbedding: null,
  getChunkEmbeddings: null,
  runEmbedding: async () => null,
  workerPool: null,
  workerDictOverride: null,
  workerState: { tokenWorkerDisabled: true, workerTokenizeFailed: false },
  tokenizationStats: { chunks: 0, tokens: 0, seq: 0 },
  complexityEnabled: false,
  lintEnabled: false,
  complexityCache: new Map(),
  lintCache: new Map(),
  log: () => {},
  logLine: () => {},
  crashLogger: null,
  riskAnalysisEnabled: true,
  riskConfig,
  typeInferenceEnabled: true,
  astDataflowEnabled: false,
  controlFlowEnabled: false,
  toolInfo: { version: 'test' },
  lineIndex,
  lineAuthors: null,
  fileGitMeta: {},
  addLineSpan: () => {},
  addSettingMetric: () => {},
  addEnrichDuration: () => {},
  addTokenizeDuration: () => {},
  addComplexityDuration: () => {},
  addLintDuration: () => {},
  addEmbeddingDuration: () => {},
  showLineProgress: false,
  totalLines: 1,
  failFile: () => ({ chunks: [], fileRelations: null, skip: { reason: 'fail' } })
};

const disabled = await processChunks({
  ...baseContext,
  analysisPolicy: {
    metadata: { enabled: false },
    risk: { enabled: false },
    typeInference: { local: { enabled: false } }
  }
});

assert.ok(disabled.chunks.length === 1, 'expected chunk output');
assert.equal(disabled.chunks[0].metaV2, null, 'metadata should be disabled');
assert.ok(!disabled.chunks[0].docmeta?.risk, 'risk metadata should be disabled');
assert.ok(!disabled.chunks[0].docmeta?.inferredTypes, 'type inference should be disabled');

const enabled = await processChunks({
  ...baseContext,
  analysisPolicy: {
    metadata: { enabled: true },
    risk: { enabled: true },
    typeInference: { local: { enabled: true } }
  }
});

assert.ok(enabled.chunks[0].metaV2, 'metadata should be present');
assert.ok(enabled.chunks[0].docmeta?.risk, 'risk metadata should be present');
assert.ok(enabled.chunks[0].docmeta?.inferredTypes, 'type inference should be present');

console.log('analysis policy gating test passed');
