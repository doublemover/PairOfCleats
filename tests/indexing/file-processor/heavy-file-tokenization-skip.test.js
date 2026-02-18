#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { processChunks } from '../../../src/index/build/file-processor/process-chunks.js';
import { createTokenizationContext } from '../../../src/index/build/tokenization.js';
import { buildLineIndex } from '../../../src/shared/lines.js';

ensureTestingEnv(process.env);

const text = 'function heavy_file_symbol() { return 42; }\n';
const sc = [{
  start: 0,
  end: text.length,
  segment: { languageId: 'javascript', segmentUid: 'seg-heavy' },
  kind: 'code',
  name: 'heavy_file_symbol'
}];
const lineIndex = buildLineIndex(text);
const lineCount = lineIndex.length || 1;
const tokenContext = createTokenizationContext({
  dictWords: new Set(),
  dictConfig: { dpMaxTokenLength: 16 },
  postingsConfig: {}
});
const logs = [];

const result = await processChunks({
  sc,
  text,
  ext: '.js',
  rel: 'src/heavy.js',
  relKey: 'src/heavy.js',
  fileStat: { size: Buffer.byteLength(text) },
  fileHash: null,
  fileHashAlgo: null,
  fileLineCount: lineCount,
  fileLanguageId: 'javascript',
  lang: { id: 'javascript', extractDocMeta: () => ({}) },
  languageContext: {},
  languageOptions: {
    heavyFile: {
      maxChunks: 1,
      skipTokenizationMaxChunks: 1,
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

assert.equal(result.chunks.length, 1, 'expected one output chunk');
assert.equal(result.chunks[0].tokens.length, 0, 'expected tokenization skip to emit no tokens');
assert.ok(
  logs.some((line) => line.includes('[perf] heavy-file tokenization skipped for src/heavy.js.')),
  'expected heavy-file tokenization skip log'
);

console.log('heavy file tokenization skip test passed');
