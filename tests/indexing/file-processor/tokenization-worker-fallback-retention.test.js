#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { processChunks } from '../../../src/index/build/file-processor/process-chunks.js';
import { createTokenizationContext } from '../../../src/index/build/tokenization.js';
import { buildLineIndex } from '../../../src/shared/lines.js';

ensureTestingEnv(process.env);

const text = [
  'function first_symbol() { return 1; }',
  'function second_symbol() { return 2; }'
].join('\n') + '\n';
const lineIndex = buildLineIndex(text);
const lineCount = lineIndex.length || 1;
const secondChunkStart = lineIndex[1];
const sc = [
  {
    start: 0,
    end: secondChunkStart,
    segment: { languageId: 'javascript', segmentUid: 'seg-1' },
    kind: 'code',
    name: 'first_symbol'
  },
  {
    start: secondChunkStart,
    end: text.length,
    segment: { languageId: 'javascript', segmentUid: 'seg-2' },
    kind: 'code',
    name: 'second_symbol'
  }
];

let workerCalls = 0;
const logs = [];
const tokenContext = createTokenizationContext({
  dictWords: new Set(),
  dictConfig: { dpMaxTokenLength: 16 },
  postingsConfig: {}
});
const workerState = { tokenWorkerDisabled: false, workerTokenizeFailed: false };

const result = await processChunks({
  sc,
  text,
  ext: '.js',
  rel: 'src/worker-fallback.js',
  relKey: 'src/worker-fallback.js',
  fileStat: { size: Buffer.byteLength(text, 'utf8') },
  fileHash: null,
  fileHashAlgo: null,
  fileLineCount: lineCount,
  fileLanguageId: 'javascript',
  lang: { id: 'javascript', extractDocMeta: () => ({}) },
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
  workerPool: {
    shouldUseForFile: () => true,
    tokenizeChunk: async () => {
      workerCalls += 1;
      throw new Error('worker explode');
    }
  },
  workerDictOverride: null,
  workerState,
  tokenizationStats: { chunks: 0, tokens: 0, seq: 0 },
  tokenizeEnabled: true,
  complexityEnabled: false,
  lintEnabled: false,
  complexityCache: new Map(),
  lintCache: new Map(),
  log: (line) => logs.push(String(line)),
  logLine: () => {},
  crashLogger: null,
  perfEventLogger: null,
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
  totalLines: lineCount,
  failFile: () => ({ chunks: [], fileRelations: null, skip: { reason: 'fail' } })
});

assert.equal(workerCalls, 1, 'expected one worker tokenize attempt before sticky fallback');
assert.equal(workerState.workerTokenizeFailed, true, 'expected worker failure flag to be retained');
assert.equal(workerState.tokenWorkerDisabled, true, 'expected worker disable flag to be retained');
assert.equal(result.chunks.length, 2, 'expected chunk output to remain intact after worker fallback');
assert.ok(
  result.chunks.every((chunk) => Array.isArray(chunk.tokens) && chunk.tokens.length > 0),
  'expected main-thread tokenization fallback to populate tokens for all chunks'
);
assert.equal(
  logs.filter((line) => line.includes('Worker tokenization failed; falling back to main thread.')).length,
  1,
  'expected fallback warning to log once'
);

console.log('tokenization worker fallback retention test passed');
