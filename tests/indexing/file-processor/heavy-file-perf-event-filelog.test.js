#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { processChunks } from '../../../src/index/build/file-processor/process-chunks.js';
import { createTokenizationContext } from '../../../src/index/build/tokenization.js';
import { buildLineIndex } from '../../../src/shared/lines.js';

ensureTestingEnv(process.env);

const text = 'function a() { return 1; }\nfunction b() { return 2; }\nfunction c() { return 3; }\nfunction d() { return 4; }\n';
const lineIndex = buildLineIndex(text);
const lineCount = lineIndex.length || 1;
const offsets = [
  0,
  lineIndex[1],
  lineIndex[2],
  lineIndex[3],
  text.length
];
const sc = [
  { start: offsets[0], end: offsets[1], segment: { languageId: 'javascript', segmentUid: 'seg-1' }, kind: 'code', name: 'a' },
  { start: offsets[1], end: offsets[2], segment: { languageId: 'javascript', segmentUid: 'seg-2' }, kind: 'code', name: 'b' },
  { start: offsets[2], end: offsets[3], segment: { languageId: 'javascript', segmentUid: 'seg-3' }, kind: 'code', name: 'c' },
  { start: offsets[3], end: offsets[4], segment: { languageId: 'javascript', segmentUid: 'seg-4' }, kind: 'code', name: 'd' }
];
const tokenContext = createTokenizationContext({
  dictWords: new Set(),
  dictConfig: { dpMaxTokenLength: 16 },
  postingsConfig: {}
});
const logs = [];
const perfRows = [];

const result = await processChunks({
  sc,
  text,
  ext: '.js',
  rel: 'src/heavy-file.js',
  relKey: 'src/heavy-file.js',
  fileStat: { size: Buffer.byteLength(text) },
  fileHash: null,
  fileHashAlgo: null,
  fileLineCount: lineCount,
  fileLanguageId: 'javascript',
  lang: { id: 'javascript', extractDocMeta: () => ({}) },
  languageContext: {},
  languageOptions: {
    heavyFile: {
      maxChunks: 2,
      skipTokenizationMaxChunks: 2,
      skipTokenizationCoalesceMaxChunks: 1
    }
  },
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
  tokenizeEnabled: true,
  complexityEnabled: false,
  lintEnabled: false,
  complexityCache: new Map(),
  lintCache: new Map(),
  log: (line) => logs.push(String(line)),
  logLine: () => {},
  perfEventLogger: {
    enabled: true,
    emit: (event, payload) => perfRows.push({ event, ...(payload || {}) })
  },
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
  totalLines: lineCount,
  failFile: () => ({ chunks: [], fileRelations: null, skip: { reason: 'fail' } })
});

assert.equal(result.chunks.length, 1, 'expected heavy-file coalescing to reduce chunks');
assert.ok(
  !logs.some((line) => line.includes('[perf] heavy-file')),
  'expected heavy-file console logs to be suppressed when perfEventLogger is present'
);
assert.equal(perfRows.length, 1, 'expected one perf event row');
assert.equal(perfRows[0].event, 'perf.heavy_file_policy');
assert.equal(perfRows[0].file, 'src/heavy-file.js');
assert.equal(perfRows[0].sourceChunks, 4);
assert.equal(perfRows[0].workingChunks, 1);
assert.equal(perfRows[0].coalesced, true);
assert.equal(perfRows[0].heavyDownshift, true);
assert.equal(perfRows[0].skipTokenization, true);

console.log('heavy file perf event filelog test passed');
