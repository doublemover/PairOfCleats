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

console.log('tree-sitter scheduler stage1 contract ok');

