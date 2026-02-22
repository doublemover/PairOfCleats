#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeCommentConfig } from '../../../src/index/comments.js';
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

const abs = path.join(root, 'tests', 'fixtures', 'mixed', 'src', 'config.yml');
const rel = path.relative(root, abs);
const relKey = rel.split(path.sep).join('/');
const text = await fs.readFile(abs, 'utf8');
const fileStat = await fs.stat(abs);

let metaCalls = 0;
const scmProviderImpl = {
  async getFileMeta() {
    metaCalls += 1;
    return { ok: false, reason: 'unavailable' };
  },
  async annotate() {
    return { ok: false, reason: 'disabled' };
  }
};

const result = await processFileCpu({
  abs,
  root,
  mode: 'code',
  fileEntry: { abs, rel: relKey },
  fileIndex: 1,
  ext: '.yml',
  rel,
  relKey,
  text,
  documentExtraction: null,
  fileStat,
  fileHash: 'snapshot-fastpath-hash',
  fileHashAlgo: 'sha1',
  fileCaps: null,
  fileStructural: null,
  scmProvider: 'git',
  scmProviderImpl,
  scmRepoRoot: root,
  scmConfig: { annotate: { enabled: false } },
  scmFileMetaByPath: {
    [relKey]: {
      lastModifiedAt: '2026-01-01T00:00:00Z',
      lastAuthor: 'snapshot-author',
      churn: 11,
      churnAdded: 6,
      churnDeleted: 5,
      churnCommits: 2
    }
  },
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
  analysisPolicy: { git: { blame: false, churn: true } },
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
  languageHint: null,
  crashLogger: { enabled: false, updateFile: noop, updateStage: noop },
  vfsManifestConcurrency: 1,
  complexityCache: null,
  lintCache: null,
  buildStage: 'stage1'
});

assert.equal(metaCalls, 0, 'expected snapshot metadata to bypass per-file SCM getFileMeta calls');
assert.ok(result?.chunks?.length >= 0, 'expected file processor result');

console.log('scm file meta snapshot fastpath test passed');
