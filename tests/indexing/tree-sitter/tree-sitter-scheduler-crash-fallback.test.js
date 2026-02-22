#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizeCommentConfig } from '../../../src/index/comments.js';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { normalizeSegmentsConfig } from '../../../src/index/segments.js';
import { processFileCpu } from '../../../src/index/build/file-processor/cpu.js';
import { createCrashLogger } from '../../../src/index/build/crash-log.js';
import { runTreeSitterScheduler } from '../../../src/index/build/tree-sitter-scheduler/runner.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'tree-sitter-scheduler-crash-fallback');
const outDir = path.join(tempRoot, 'index-code');
const repoCacheRoot = path.join(tempRoot, 'repo-cache');
const perlAbs = path.join(root, 'tests', 'fixtures', 'languages', 'src', 'perl_advanced.pl');
const jsAbs = path.join(root, 'tests', 'fixtures', 'tree-sitter', 'javascript.js');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(repoCacheRoot, { recursive: true });

const runtime = {
  root,
  repoCacheRoot,
  buildRoot: tempRoot,
  buildId: 'ub001-tree-sitter-crash',
  segmentsConfig: null,
  languageOptions: {
    treeSitter: {
      enabled: true,
      strict: true
    }
  }
};
const crashLogger = await createCrashLogger({
  repoCacheRoot,
  enabled: true
});

const previousCrashInjection = process.env.PAIROFCLEATS_TEST_TREE_SITTER_SCHEDULER_CRASH;
process.env.PAIROFCLEATS_TEST_TREE_SITTER_SCHEDULER_CRASH = 'perl';
let scheduler = null;
try {
  scheduler = await runTreeSitterScheduler({
    mode: 'code',
    runtime,
    entries: [perlAbs, jsAbs],
    outDir,
    abortSignal: null,
    log: () => {},
    crashLogger
  });
} finally {
  if (previousCrashInjection === undefined) {
    delete process.env.PAIROFCLEATS_TEST_TREE_SITTER_SCHEDULER_CRASH;
  } else {
    process.env.PAIROFCLEATS_TEST_TREE_SITTER_SCHEDULER_CRASH = previousCrashInjection;
  }
}

assert.ok(scheduler, 'expected scheduler result');
assert.ok(scheduler.index instanceof Map, 'expected scheduler index map');
assert.ok(
  scheduler.index.size > 0,
  'expected scheduler to continue processing unaffected files after injected parser crash'
);
const schedulerStats = scheduler.stats();
assert.ok(
  Number(schedulerStats?.parserCrashSignatures) >= 1,
  'expected parser crash signature to be recorded'
);
assert.ok(
  Number(schedulerStats?.degradedVirtualPaths) >= 1,
  'expected degraded virtual paths to be tracked'
);
assert.ok(
  typeof scheduler?.isDegradedVirtualPath === 'function',
  'expected degraded virtual path checker'
);
const crashSummary = scheduler.getCrashSummary();
assert.ok(
  crashSummary.degradedVirtualPaths.some((virtualPath) => virtualPath.includes('perl_advanced.pl')),
  'expected perl virtual path to be marked degraded'
);
await fs.access(scheduler.crashForensicsBundlePath);
await fs.access(path.join(repoCacheRoot, 'logs', 'index-crash-forensics-index.json'));

const rel = path.relative(root, perlAbs);
const relKey = rel.split(path.sep).join('/');
const text = await fs.readFile(perlAbs, 'utf8');
const fileStat = await fs.stat(perlAbs);
const languageHint = getLanguageForFile('.pl', relKey);
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
const schedulerNoLoad = {
  ...scheduler,
  loadChunks: async () => {
    throw new Error('scheduler loadChunks should not run for degraded virtual paths');
  },
  loadChunksBatch: async () => {
    throw new Error('scheduler loadChunksBatch should not run for degraded virtual paths');
  }
};

const cpuResult = await processFileCpu({
  abs: perlAbs,
  root,
  mode: 'code',
  fileEntry: { abs: perlAbs, rel: relKey },
  fileIndex: 1,
  ext: '.pl',
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
  treeSitterScheduler: schedulerNoLoad,
  timing,
  languageHint,
  crashLogger,
  vfsManifestConcurrency: 1,
  complexityCache: null,
  lintCache: null,
  buildStage: 'stage1'
});

assert.ok(Array.isArray(cpuResult?.chunks) && cpuResult.chunks.length > 0, 'expected fallback chunks');
assert.equal(cpuResult?.skip, null, 'expected no skip despite injected parser crash');

console.log('tree-sitter scheduler crash fallback ok');
