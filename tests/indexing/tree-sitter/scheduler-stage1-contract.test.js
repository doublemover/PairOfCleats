#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizeCommentConfig } from '../../../src/index/comments.js';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { normalizeSegmentsConfig } from '../../../src/index/segments.js';
import { processFileCpu } from '../../../src/index/build/file-processor/cpu.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const abs = path.join(root, 'tests', 'fixtures', 'tree-sitter', 'javascript.js');
const rel = path.relative(root, abs);
const relKey = rel.split(path.sep).join('/');
const text = await fs.readFile(abs, 'utf8');
const fileStat = await fs.stat(abs);
const languageHint = getLanguageForFile('.js', relKey);
const noop = () => {};

const timing = {
  metricsCollector: null,
  addSettingMetric: noop,
  addLineSpan: noop,
  addParseDuration: noop,
  addTokenizeDuration: noop,
  addEnrichDuration: noop,
  addEmbeddingDuration: noop,
  addLintDuration: noop,
  addComplexityDuration: noop,
  setGitDuration: noop,
  setPythonAstDuration: noop
};

let schedulerCalls = 0;
const treeSitterScheduler = {
  loadChunks: async () => {
    schedulerCalls += 1;
    return null;
  }
};

await assert.rejects(
  async () => processFileCpu({
    abs,
    root,
    mode: 'code',
    fileEntry: { abs, rel: relKey },
    fileIndex: 1,
    ext: '.js',
    rel,
    relKey,
    text,
    fileStat,
    fileHash: 'testhash',
    fileHashAlgo: 'sha1',
    fileCaps: null,
    fileStructural: null,
    scmProvider: null,
    scmProviderImpl: null,
    scmRepoRoot: null,
    scmConfig: null,
    languageOptions: {
      treeSitter: {
        enabled: true,
        strict: true
      }
    },
    astDataflowEnabled: false,
    controlFlowEnabled: false,
    normalizedSegmentsConfig: normalizeSegmentsConfig(null),
    normalizedCommentsConfig: normalizeCommentConfig(null),
    tokenDictWords: new Set(),
    dictConfig: {},
    tokenContext: {
      dictWords: new Set(),
      dictConfig: {},
      codeDictCache: new Map(),
      tokenClassification: { enabled: false },
      phraseEnabled: false,
      chargramEnabled: false
    },
    postingsConfig: {},
    contextWin: {},
    relationsEnabled: false,
    lintEnabled: false,
    complexityEnabled: false,
    typeInferenceEnabled: false,
    riskAnalysisEnabled: false,
    riskConfig: {},
    gitBlameEnabled: false,
    analysisPolicy: null,
    workerPool: null,
    workerDictOverride: null,
    workerState: {},
    tokenizationStats: null,
    embeddingEnabled: false,
    embeddingNormalize: false,
    embeddingBatchSize: 0,
    getChunkEmbedding: null,
    getChunkEmbeddings: null,
    runEmbedding: (fn) => fn(),
    runProc: (fn) => fn(),
    runTreeSitterSerial: (fn) => fn(),
    runIo: (fn) => fn(),
    log: noop,
    logLine: noop,
    showLineProgress: false,
    toolInfo: null,
    treeSitterScheduler,
    timing,
    languageHint,
    crashLogger: { enabled: false, updateFile: noop },
    vfsManifestConcurrency: 1,
    complexityCache: null,
    lintCache: null,
    buildStage: 'stage1'
  }),
  /Missing scheduled chunks/
);
assert.ok(schedulerCalls > 0, 'expected scheduler to be consulted for tree-sitter chunks');

let fallbackSchedulerCalls = 0;
const fallbackScheduler = {
  index: new Map(),
  loadChunks: async () => {
    fallbackSchedulerCalls += 1;
    return null;
  }
};
const fallbackResult = await processFileCpu({
  abs,
  root,
  mode: 'code',
  fileEntry: { abs, rel: relKey },
  fileIndex: 1,
  ext: '.js',
  rel,
  relKey,
  text,
  fileStat,
  fileHash: 'testhash',
  fileHashAlgo: 'sha1',
  fileCaps: null,
  fileStructural: null,
  scmProvider: null,
  scmProviderImpl: null,
  scmRepoRoot: null,
  scmConfig: null,
  languageOptions: {
    treeSitter: {
      enabled: true,
      strict: false
    }
  },
  astDataflowEnabled: false,
  controlFlowEnabled: false,
  normalizedSegmentsConfig: normalizeSegmentsConfig(null),
  normalizedCommentsConfig: normalizeCommentConfig(null),
  tokenDictWords: new Set(),
  dictConfig: {},
  tokenContext: {
    dictWords: new Set(),
    dictConfig: {},
    codeDictCache: new Map(),
    tokenClassification: { enabled: false },
    phraseEnabled: false,
    chargramEnabled: false
  },
  postingsConfig: {},
  contextWin: {},
  relationsEnabled: false,
  lintEnabled: false,
  complexityEnabled: false,
  typeInferenceEnabled: false,
  riskAnalysisEnabled: false,
  riskConfig: {},
  gitBlameEnabled: false,
  analysisPolicy: null,
  workerPool: null,
  workerDictOverride: null,
  workerState: {},
  tokenizationStats: null,
  embeddingEnabled: false,
  embeddingNormalize: false,
  embeddingBatchSize: 0,
  getChunkEmbedding: null,
  getChunkEmbeddings: null,
  runEmbedding: (fn) => fn(),
  runProc: (fn) => fn(),
  runTreeSitterSerial: (fn) => fn(),
  runIo: (fn) => fn(),
  log: noop,
  logLine: noop,
  showLineProgress: false,
  toolInfo: null,
  treeSitterScheduler: fallbackScheduler,
  timing,
  languageHint,
  crashLogger: { enabled: false, updateFile: noop },
  vfsManifestConcurrency: 1,
  complexityCache: null,
  lintCache: null,
  buildStage: 'stage1'
});
assert.ok(fallbackSchedulerCalls > 0, 'expected scheduler lookup attempts in non-strict mode');
assert.ok(Array.isArray(fallbackResult?.chunks) && fallbackResult.chunks.length > 0, 'expected fallback chunking to produce chunks');

let unsupportedLanguageSchedulerCalls = 0;
const unsupportedLanguageWarnings = [];
const unsupportedLanguageScheduler = {
  index: new Map(),
  scheduledLanguageIds: new Set(['lua']),
  loadChunks: async () => {
    unsupportedLanguageSchedulerCalls += 1;
    return null;
  }
};
const unsupportedLanguageResult = await processFileCpu({
  abs,
  root,
  mode: 'code',
  fileEntry: { abs, rel: relKey },
  fileIndex: 1,
  ext: '.js',
  rel,
  relKey,
  text,
  fileStat,
  fileHash: 'testhash',
  fileHashAlgo: 'sha1',
  fileCaps: null,
  fileStructural: null,
  scmProvider: null,
  scmProviderImpl: null,
  scmRepoRoot: null,
  scmConfig: null,
  languageOptions: {
    treeSitter: {
      enabled: true,
      strict: false
    }
  },
  astDataflowEnabled: false,
  controlFlowEnabled: false,
  normalizedSegmentsConfig: normalizeSegmentsConfig(null),
  normalizedCommentsConfig: normalizeCommentConfig(null),
  tokenDictWords: new Set(),
  dictConfig: {},
  tokenContext: {
    dictWords: new Set(),
    dictConfig: {},
    codeDictCache: new Map(),
    tokenClassification: { enabled: false },
    phraseEnabled: false,
    chargramEnabled: false
  },
  postingsConfig: {},
  contextWin: {},
  relationsEnabled: false,
  lintEnabled: false,
  complexityEnabled: false,
  typeInferenceEnabled: false,
  riskAnalysisEnabled: false,
  riskConfig: {},
  gitBlameEnabled: false,
  analysisPolicy: null,
  workerPool: null,
  workerDictOverride: null,
  workerState: {},
  tokenizationStats: null,
  embeddingEnabled: false,
  embeddingNormalize: false,
  embeddingBatchSize: 0,
  getChunkEmbedding: null,
  getChunkEmbeddings: null,
  runEmbedding: (fn) => fn(),
  runProc: (fn) => fn(),
  runTreeSitterSerial: (fn) => fn(),
  runIo: (fn) => fn(),
  log: noop,
  logLine: (line) => unsupportedLanguageWarnings.push(String(line || '')),
  showLineProgress: false,
  toolInfo: null,
  treeSitterScheduler: unsupportedLanguageScheduler,
  timing,
  languageHint,
  crashLogger: { enabled: false, updateFile: noop },
  vfsManifestConcurrency: 1,
  complexityCache: null,
  lintCache: null,
  buildStage: 'stage1'
});
assert.equal(
  unsupportedLanguageSchedulerCalls,
  0,
  'expected scheduler lookup to be skipped when scheduler has no coverage for the language'
);
assert.ok(
  Array.isArray(unsupportedLanguageResult?.chunks) && unsupportedLanguageResult.chunks.length > 0,
  'expected fallback chunking to produce chunks when scheduler lacks language coverage'
);
assert.equal(
  unsupportedLanguageWarnings.some((line) => line.includes('[tree-sitter:schedule] scheduler missing')),
  false,
  'expected no scheduler-missing warning spam when language coverage is absent'
);

const proseResult = await processFileCpu({
  abs,
  root,
  mode: 'prose',
  fileEntry: { abs, rel: relKey },
  fileIndex: 1,
  ext: '.js',
  rel,
  relKey,
  text,
  fileStat,
  fileHash: 'testhash',
  fileHashAlgo: 'sha1',
  fileCaps: null,
  fileStructural: null,
  scmProvider: null,
  scmProviderImpl: null,
  scmRepoRoot: null,
  scmConfig: null,
  languageOptions: {
    treeSitter: {
      enabled: false
    }
  },
  astDataflowEnabled: false,
  controlFlowEnabled: false,
  normalizedSegmentsConfig: normalizeSegmentsConfig(null),
  normalizedCommentsConfig: normalizeCommentConfig(null),
  tokenDictWords: new Set(),
  dictConfig: {},
  tokenContext: {
    dictWords: new Set(),
    dictConfig: {},
    codeDictCache: new Map(),
    tokenClassification: { enabled: false },
    phraseEnabled: false,
    chargramEnabled: false
  },
  postingsConfig: {},
  contextWin: {},
  relationsEnabled: false,
  lintEnabled: false,
  complexityEnabled: false,
  typeInferenceEnabled: false,
  riskAnalysisEnabled: false,
  riskConfig: {},
  gitBlameEnabled: false,
  analysisPolicy: null,
  workerPool: null,
  workerDictOverride: null,
  workerState: {},
  tokenizationStats: null,
  embeddingEnabled: false,
  embeddingNormalize: false,
  embeddingBatchSize: 0,
  getChunkEmbedding: null,
  getChunkEmbeddings: null,
  runEmbedding: (fn) => fn(),
  runProc: (fn) => fn(),
  runTreeSitterSerial: (fn) => fn(),
  runIo: (fn) => fn(),
  log: noop,
  logLine: noop,
  showLineProgress: false,
  toolInfo: null,
  treeSitterScheduler: null,
  timing,
  languageHint,
  crashLogger: { enabled: false, updateFile: noop },
  vfsManifestConcurrency: 1,
  complexityCache: null,
  lintCache: null,
  buildStage: 'stage1'
});
assert.ok(Array.isArray(proseResult?.chunks), 'expected prose mode to complete without scheduler');

console.log('tree-sitter scheduler stage1 contract ok');

