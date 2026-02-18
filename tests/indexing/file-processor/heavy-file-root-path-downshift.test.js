#!/usr/bin/env node
import assert from 'node:assert/strict';
import { processChunks } from '../../../src/index/build/file-processor/process-chunks.js';
import { createTokenizationContext } from '../../../src/index/build/tokenization.js';
import { buildLineIndex } from '../../../src/shared/lines.js';

const text = 'int vendor_symbol() { return 42; }\n';
const sc = [{
  start: 0,
  end: text.length,
  segment: { languageId: 'clike', segmentUid: 'seg-vendor' },
  kind: 'code',
  name: 'vendor_symbol'
}];
const lineIndex = buildLineIndex(text);
const tokenContext = createTokenizationContext({
  dictWords: new Set(),
  dictConfig: { dpMaxTokenLength: 16 },
  postingsConfig: {}
});
const logs = [];

const result = await processChunks({
  sc,
  text,
  ext: '.cpp',
  rel: 'vendor/foo.cpp',
  relKey: 'vendor/foo.cpp',
  fileStat: { size: Buffer.byteLength(text) },
  fileHash: null,
  fileHashAlgo: null,
  fileLineCount: 1,
  fileLanguageId: 'clike',
  lang: { id: 'clike', extractDocMeta: () => ({}) },
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
  runProc: async (fn) => fn(),
  workerPool: null,
  workerDictOverride: null,
  workerState: { tokenWorkerDisabled: true, workerTokenizeFailed: false },
  tokenizationStats: { chunks: 0, tokens: 0, seq: 0 },
  tokenizeEnabled: false,
  complexityEnabled: false,
  lintEnabled: false,
  complexityCache: new Map(),
  lintCache: new Map(),
  log: (msg) => logs.push(String(msg)),
  logLine: () => {},
  crashLogger: null,
  riskAnalysisEnabled: false,
  riskConfig: {},
  typeInferenceEnabled: false,
  analysisPolicy: {
    metadata: { enabled: false },
    risk: { enabled: false },
    typeInference: { local: { enabled: false } }
  },
  astDataflowEnabled: false,
  controlFlowEnabled: false,
  toolInfo: { version: 'test' },
  lineIndex,
  lineAuthors: null,
  fileGitMeta: {},
  vfsManifestConcurrency: 1,
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
});

assert.equal(result.chunks.length, 1, 'expected one chunk result');
assert.ok(
  logs.some((line) => line.includes('[perf] heavy-file downshift enabled for vendor/foo.cpp')),
  'expected heavy-file downshift to trigger for root-level vendor path'
);

console.log('heavy file root-path downshift test passed');
