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
  abs,
  ext,
  rel,
  relKey,
  text,
  fileStat,
  languageHint,
  scmProviderImpl,
  fileHash,
  scmConfig = { allowSlowTimeouts: true, timeoutMs: 25, annotate: { timeoutMs: 20 } },
  runProc = (fn) => fn(),
  onScmProcQueueWait = null,
  signal = null
}) => ({
  abs,
  root,
  mode: 'code',
  fileEntry: { abs, rel: relKey },
  fileIndex: 1,
  ext,
  rel,
  relKey,
  text,
  fileStat,
  fileHash,
  fileHashAlgo: 'sha1',
  fileCaps: null,
  fileStructural: null,
  scmProvider: 'git',
  scmProviderImpl,
  scmRepoRoot: root,
  scmConfig,
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
  gitBlameEnabled: true,
  analysisPolicy: null,
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
  runProc,
  signal,
  onScmProcQueueWait,
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

const fixtureAbs = path.join(root, 'tests', 'fixtures', 'mixed', 'src', 'config.yml');
const fixtureRel = path.relative(root, fixtureAbs);
const fixtureRelKey = fixtureRel.split(path.sep).join('/');
const fixtureText = await fs.readFile(fixtureAbs, 'utf8');
const fixtureStat = await fs.stat(fixtureAbs);
const fixtureLanguageHint = getLanguageForFile('.yml', fixtureRelKey);
const queueDelayMs = 700;

let metaBlockedCalls = 0;
let metaBlockedAnnotateCalls = 0;
let metaBlockedRunProcCalls = 0;
const metaBlockedScmProvider = {
  async getFileMeta() {
    metaBlockedCalls += 1;
    return {
      ok: true,
      lastModifiedAt: '2026-01-01T00:00:00Z',
      lastAuthor: 'meta-timeout-author',
      lastCommitId: 'meta-timeout-commit'
    };
  },
  async annotate() {
    metaBlockedAnnotateCalls += 1;
    return { ok: false, reason: 'timeout' };
  }
};
const metaBlockedRunProc = async (fn) => {
  metaBlockedRunProcCalls += 1;
  await new Promise((resolve) => setTimeout(resolve, queueDelayMs));
  return fn();
};

const metaStart = Date.now();
await processFileCpu(createContext({
  abs: fixtureAbs,
  ext: '.yml',
  rel: fixtureRel,
  relKey: fixtureRelKey,
  text: fixtureText,
  fileStat: fixtureStat,
  languageHint: fixtureLanguageHint,
  scmProviderImpl: metaBlockedScmProvider,
  fileHash: 'scm-runproc-queue-timeout-meta',
  runProc: metaBlockedRunProc
}));
const metaElapsedMs = Date.now() - metaStart;
assert.equal(metaBlockedRunProcCalls, 1, 'expected metadata queue block to stop before annotate');
assert.equal(metaBlockedCalls, 0, 'expected metadata task to abort before getFileMeta runs');
assert.equal(metaBlockedAnnotateCalls, 0, 'expected annotate to be skipped after metadata timeout');
assert.ok(
  metaElapsedMs < queueDelayMs,
  `expected metadata queue timeout before queued task ran (elapsed=${metaElapsedMs}ms)`
);

let annotateMetaCalls = 0;
let annotateCalls = 0;
let annotateRunProcCalls = 0;
const annotateBlockedScmProvider = {
  async getFileMeta() {
    annotateMetaCalls += 1;
    return {
      ok: true,
      lastModifiedAt: '2026-01-01T00:00:00Z',
      lastAuthor: 'annotate-timeout-author',
      lastCommitId: 'annotate-timeout-commit'
    };
  },
  async annotate() {
    annotateCalls += 1;
    return { ok: true, lines: [{ line: 1, author: 'x', commit: 'y' }] };
  }
};
const annotateBlockedRunProc = async (fn) => {
  annotateRunProcCalls += 1;
  if (annotateRunProcCalls === 1) {
    return fn();
  }
  await new Promise((resolve) => setTimeout(resolve, queueDelayMs));
  return fn();
};

const annotateStart = Date.now();
const annotateResult = await processFileCpu(createContext({
  abs: fixtureAbs,
  ext: '.yml',
  rel: fixtureRel,
  relKey: fixtureRelKey,
  text: fixtureText,
  fileStat: fixtureStat,
  languageHint: fixtureLanguageHint,
  scmProviderImpl: annotateBlockedScmProvider,
  fileHash: 'scm-runproc-queue-timeout-annotate',
  runProc: annotateBlockedRunProc
}));
const annotateElapsedMs = Date.now() - annotateStart;
assert.equal(annotateRunProcCalls, 2, 'expected metadata and annotate to both use runProc queueing');
assert.equal(annotateMetaCalls, 1, 'expected metadata call before annotate queue timeout');
assert.equal(annotateCalls, 0, 'expected annotate task to abort before provider annotate runs');
assert.ok(
  annotateElapsedMs < queueDelayMs,
  `expected annotate queue timeout before queued task ran (elapsed=${annotateElapsedMs}ms)`
);
assert.ok(Array.isArray(annotateResult?.chunks), 'expected processing to complete after annotate queue timeout');

let queueMetricMetaCalls = 0;
let queueMetricAnnotateCalls = 0;
const scmQueueWaitSamples = [];
const queueMetricScmProvider = {
  async getFileMeta() {
    queueMetricMetaCalls += 1;
    return {
      ok: true,
      lastModifiedAt: '2026-01-01T00:00:00Z',
      lastAuthor: 'queue-metric-author',
      lastCommitId: 'queue-metric-commit'
    };
  },
  async annotate() {
    queueMetricAnnotateCalls += 1;
    return {
      ok: true,
      lines: [{ line: 1, author: 'queue-metric-author', commit: 'queue-metric-commit' }]
    };
  }
};
const queueMetricRunProc = async (fn) => {
  await new Promise((resolve) => setTimeout(resolve, 15));
  return fn();
};
await processFileCpu(createContext({
  abs: fixtureAbs,
  ext: '.yml',
  rel: fixtureRel,
  relKey: fixtureRelKey,
  text: fixtureText,
  fileStat: fixtureStat,
  languageHint: fixtureLanguageHint,
  scmProviderImpl: queueMetricScmProvider,
  fileHash: 'scm-runproc-queue-timeout-metrics',
  runProc: queueMetricRunProc,
  onScmProcQueueWait: (waitMs) => {
    scmQueueWaitSamples.push(waitMs);
  }
}));
assert.equal(queueMetricMetaCalls >= 1, true, 'expected metadata call in queue metric scenario');
assert.equal(queueMetricAnnotateCalls >= 1, true, 'expected annotate call in queue metric scenario');
assert.equal(scmQueueWaitSamples.length >= 2, true, 'expected SCM queue wait callback for metadata and annotate tasks');
assert.equal(
  scmQueueWaitSamples.every((waitMs) => Number.isFinite(waitMs) && waitMs > 0),
  true,
  'expected SCM queue wait callback samples to be positive finite durations'
);

let abortAwareMetaCalls = 0;
const abortAwareScmProvider = {
  async getFileMeta({ signal: taskSignal } = {}) {
    abortAwareMetaCalls += 1;
    if (taskSignal?.aborted) return { ok: false, reason: 'timeout' };
    await new Promise((resolve) => {
      if (!taskSignal || typeof taskSignal.addEventListener !== 'function') {
        resolve();
        return;
      }
      taskSignal.addEventListener('abort', resolve, { once: true });
    });
    return { ok: false, reason: 'timeout' };
  },
  async annotate() {
    return { ok: false, reason: 'timeout' };
  }
};
const abortController = new AbortController();
setTimeout(() => abortController.abort(new Error('abort scm task from outer signal')), 10);
const abortAwareStart = Date.now();
await processFileCpu(createContext({
  abs: fixtureAbs,
  ext: '.yml',
  rel: fixtureRel,
  relKey: fixtureRelKey,
  text: fixtureText,
  fileStat: fixtureStat,
  languageHint: fixtureLanguageHint,
  scmProviderImpl: abortAwareScmProvider,
  fileHash: 'scm-runproc-queue-timeout-abort',
  signal: abortController.signal,
  scmConfig: { allowSlowTimeouts: true, timeoutMs: 1000, annotate: { timeoutMs: 1000 } }
}));
const abortAwareElapsedMs = Date.now() - abortAwareStart;
assert.equal(abortAwareMetaCalls, 1, 'expected metadata task to start before abort signal');
assert.ok(
  abortAwareElapsedMs < 300,
  `expected outer signal to cancel SCM metadata wait promptly (elapsed=${abortAwareElapsedMs}ms)`
);

console.log('scm runProc queue timeout test passed');
