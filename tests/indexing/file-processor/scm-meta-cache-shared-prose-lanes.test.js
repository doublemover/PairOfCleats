#!/usr/bin/env node
import assert from 'node:assert/strict';

import { normalizeCommentConfig } from '../../../src/index/comments.js';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { normalizeSegmentsConfig } from '../../../src/index/segments.js';
import { processFileCpu } from '../../../src/index/build/file-processor/cpu.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
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

const createContext = ({
  mode,
  relKey,
  text,
  scmProviderImpl,
  scmMetaCache
}) => ({
  abs: `${root}/${relKey}`.replace(/\//g, '\\'),
  root,
  mode,
  fileEntry: { abs: `${root}/${relKey}`.replace(/\//g, '\\'), rel: relKey },
  fileIndex: 1,
  ext: '.js',
  rel: relKey,
  relKey,
  text,
  documentExtraction: null,
  fileStat: { size: Buffer.byteLength(text, 'utf8') },
  fileHash: `hash:${mode}`,
  fileHashAlgo: 'sha1',
  fileCaps: null,
  fileStructural: null,
  scmProvider: 'git',
  scmProviderImpl,
  scmRepoRoot: root,
  scmConfig: { annotate: {} },
  scmFileMetaByPath: null,
  scmMetaCache,
  languageOptions: { treeSitter: { enabled: false }, pythonAst: { enabled: false } },
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
  analysisPolicy: { git: { churn: true, blame: false } },
  workerPool: null,
  workerDictOverride: null,
  workerState: {},
  tokenizationStats: null,
  tokenizeEnabled: true,
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
  perfEventLogger: null,
  timing,
  languageHint: getLanguageForFile('.js', relKey),
  crashLogger: { enabled: false, updateFile: noop },
  vfsManifestConcurrency: 1,
  complexityCache: null,
  lintCache: null,
  buildStage: 'stage1',
  extractedProseExtrasCache: null,
  primeExtractedProseExtrasCache: false
});

const relKey = 'src/shared-cache-target.js';
const text = 'export const value = 1;\n';
const scmMetaCache = new Map();
let getFileMetaCalls = 0;
let annotateCalls = 0;
const scmProviderImpl = {
  async getFileMeta() {
    getFileMetaCalls += 1;
    return {
      ok: true,
      lastCommitId: 'commit-1',
      lastModifiedAt: '2026-02-20T00:00:00.000Z',
      lastAuthor: 'alice',
      churn: 1,
      churnAdded: 1,
      churnDeleted: 0,
      churnCommits: 1
    };
  },
  async annotate() {
    annotateCalls += 1;
    return { ok: false, reason: 'timeout' };
  }
};

await processFileCpu(createContext({
  mode: 'prose',
  relKey,
  text,
  scmProviderImpl,
  scmMetaCache
}));
await processFileCpu(createContext({
  mode: 'extracted-prose',
  relKey,
  text,
  scmProviderImpl,
  scmMetaCache
}));

assert.equal(getFileMetaCalls, 1, 'expected SCM metadata lookup reuse across prose lanes');
assert.equal(annotateCalls, 0, 'did not expect annotate calls when git blame is disabled');

console.log('shared prose-lane SCM metadata cache test passed');
