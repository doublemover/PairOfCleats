#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { gitProvider } from '../../../src/index/scm/providers/git.js';
import { getScmRuntimeConfig, setScmRuntimeConfig } from '../../../src/index/scm/runtime.js';
import { getScmCommandRunner, setScmCommandRunner } from '../../../src/index/scm/runner.js';
import { setProgressHandlers } from '../../../src/shared/progress.js';

const defaultRunner = getScmCommandRunner();
const defaultScmConfig = getScmRuntimeConfig();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const repoRoot = path.resolve('C:/repo');

let inFlight = 0;
let maxInFlight = 0;
let logCallCount = 0;
let observedChunkSizes = [];
let observedCommitLimits = [];
let progressEvents = [];
let partialBatchMeta = false;
let restoreProgressHandlers = () => {};

const buildBatchStdout = (files) => {
  const rows = [];
  for (const file of files) {
    rows.push('__POC_GIT_META__aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\u00002026-02-22T00:00:00Z\u0000Batch Author');
    rows.push(file);
  }
  return rows.join('\n');
};

try {
  restoreProgressHandlers = setProgressHandlers({
    showProgress: (step, current, total, meta) => {
      progressEvents.push({ step, current, total, meta });
    }
  });
  setScmRuntimeConfig({
    maxConcurrentProcesses: 4,
    runtime: {
      fileConcurrency: 4,
      cpuConcurrency: 4
    }
  });
  setScmCommandRunner(async (command, args) => {
    assert.equal(command, 'git');
    if (!Array.isArray(args) || !args.includes('log')) {
      return { exitCode: 1, stdout: '', stderr: 'unexpected git command' };
    }
    logCallCount += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await sleep(20);
      const separatorIndex = args.indexOf('--');
      const files = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : [];
      const limitIndex = args.indexOf('-n');
      observedCommitLimits.push(limitIndex >= 0 ? Number(args[limitIndex + 1]) : null);
      observedChunkSizes.push(files.length);
      const reportedFiles = partialBatchMeta ? files.slice(0, 1) : files;
      return {
        exitCode: 0,
        stdout: buildBatchStdout(reportedFiles),
        stderr: ''
      };
    } finally {
      inFlight -= 1;
    }
  });

  const largeFiles = Array.from({ length: 96 * 5 }, (_unused, index) => `src/large-${index}.js`);
  const largeResult = await gitProvider.getFileMetaBatch({
    repoRoot,
    filesPosix: largeFiles,
    timeoutMs: 5000
  });
  assert.ok(largeResult?.fileMetaByPath);
  assert.equal(Object.keys(largeResult.fileMetaByPath).length, largeFiles.length);
  assert(
    maxInFlight > 1,
    `expected batched git log calls to run in parallel for non-small repos; observed ${maxInFlight}`
  );
  assert(
    maxInFlight <= 4,
    `expected batched git log calls to respect queue cap 4; observed ${maxInFlight}`
  );
  assert(progressEvents.length >= 2, 'expected progress updates for multi-chunk batch');
  const firstProgress = progressEvents[0];
  const lastProgress = progressEvents[progressEvents.length - 1];
  assert.equal(firstProgress?.step, 'SCM Meta');
  assert.equal(firstProgress?.current, 0);
  assert.equal(firstProgress?.total, 5);
  assert.equal(firstProgress?.meta?.taskId, 'scm:git:file-meta-batch');
  assert.equal(firstProgress?.meta?.ephemeral, true);
  assert.equal(firstProgress?.meta?.message, undefined);
  assert.equal(lastProgress?.current, lastProgress?.total);
  assert.equal(Math.max(...observedChunkSizes), 96, 'expected default chunk size 96 for non-huge file sets');
  assert(
    observedCommitLimits.every((value) => Number.isFinite(value) && value > 0),
    'expected default per-chunk commit cap for non-large repos'
  );

  inFlight = 0;
  maxInFlight = 0;
  logCallCount = 0;
  observedChunkSizes = [];
  observedCommitLimits = [];
  progressEvents = [];

  const smallFiles = Array.from({ length: 96 * 2 }, (_unused, index) => `src/small-${index}.js`);
  const smallResult = await gitProvider.getFileMetaBatch({
    repoRoot,
    filesPosix: smallFiles,
    timeoutMs: 5000
  });
  assert.ok(smallResult?.fileMetaByPath);
  assert.equal(Object.keys(smallResult.fileMetaByPath).length, smallFiles.length);
  assert.equal(logCallCount, 2, `expected two chunks for 192 files, observed ${logCallCount}`);
  assert.equal(
    maxInFlight,
    1,
    `expected small-repo batches to run sequentially; observed max in flight ${maxInFlight}`
  );

  inFlight = 0;
  maxInFlight = 0;
  logCallCount = 0;
  observedChunkSizes = [];
  observedCommitLimits = [];
  setScmRuntimeConfig({
    runtime: {
      fileConcurrency: 3,
      cpuConcurrency: 3
    }
  });
  const defaultConfigFiles = Array.from(
    { length: 96 * 4 },
    (_unused, index) => `src/default-${index}.js`
  );
  const defaultConfigResult = await gitProvider.getFileMetaBatch({
    repoRoot,
    filesPosix: defaultConfigFiles,
    timeoutMs: 5000
  });
  assert.ok(defaultConfigResult?.fileMetaByPath);
  assert.equal(Object.keys(defaultConfigResult.fileMetaByPath).length, defaultConfigFiles.length);
  assert(
    maxInFlight >= 3,
    `expected default queue sizing to follow runtime thread hints (>=3); observed ${maxInFlight}`
  );
  assert(
    maxInFlight <= 3,
    `expected runtime thread hints to cap default queue at 3; observed ${maxInFlight}`
  );

  inFlight = 0;
  maxInFlight = 0;
  logCallCount = 0;
  observedChunkSizes = [];
  observedCommitLimits = [];
  setScmRuntimeConfig({
    runtime: {
      fileConcurrency: 32,
      cpuConcurrency: 16
    }
  });
  const cpuBoundFiles = Array.from(
    { length: 96 * 24 },
    (_unused, index) => `src/cpu-bound-${index}.js`
  );
  const cpuBoundResult = await gitProvider.getFileMetaBatch({
    repoRoot,
    filesPosix: cpuBoundFiles,
    timeoutMs: 5000
  });
  assert.ok(cpuBoundResult?.fileMetaByPath);
  assert.equal(Object.keys(cpuBoundResult.fileMetaByPath).length, cpuBoundFiles.length);
  assert(
    maxInFlight >= 16,
    `expected SCM default concurrency to follow cpu threads (>=16); observed ${maxInFlight}`
  );
  assert(
    maxInFlight <= 16,
    `expected SCM default concurrency to cap at cpu threads 16; observed ${maxInFlight}`
  );

  inFlight = 0;
  maxInFlight = 0;
  logCallCount = 0;
  observedChunkSizes = [];
  observedCommitLimits = [];
  setScmRuntimeConfig({
    maxConcurrentProcesses: 1,
    runtime: {
      fileConcurrency: 32,
      cpuConcurrency: 16
    }
  });
  const explicitCapFiles = Array.from(
    { length: 96 * 12 },
    (_unused, index) => `src/explicit-cap-${index}.js`
  );
  const explicitCapResult = await gitProvider.getFileMetaBatch({
    repoRoot,
    filesPosix: explicitCapFiles,
    timeoutMs: 5000
  });
  assert.ok(explicitCapResult?.fileMetaByPath);
  assert.equal(Object.keys(explicitCapResult.fileMetaByPath).length, explicitCapFiles.length);
  assert.equal(
    maxInFlight,
    1,
    `expected explicit maxConcurrentProcesses=1 to hard-cap SCM fanout; observed ${maxInFlight}`
  );

  inFlight = 0;
  maxInFlight = 0;
  logCallCount = 0;
  observedChunkSizes = [];
  observedCommitLimits = [];
  setScmRuntimeConfig({
    runtime: {
      fileConcurrency: 32,
      cpuConcurrency: 16
    }
  });
  const hugeRepoFiles = Array.from(
    { length: 8000 },
    (_unused, index) => `src/huge-repo-${index}.js`
  );
  const hugeRepoResult = await gitProvider.getFileMetaBatch({
    repoRoot,
    filesPosix: hugeRepoFiles,
    timeoutMs: 5000
  });
  assert.ok(hugeRepoResult?.fileMetaByPath);
  assert.equal(Object.keys(hugeRepoResult.fileMetaByPath).length, hugeRepoFiles.length);
  assert(
    Math.max(...observedChunkSizes) <= 16,
    `expected adaptive huge-repo chunk size <=16; observed max chunk size ${Math.max(...observedChunkSizes)}`
  );
  assert(
    maxInFlight <= 16,
    `expected huge-repo batching to respect cpu thread cap 16; observed ${maxInFlight}`
  );
  assert(
    observedCommitLimits.every((value) => Number.isFinite(value) && value > 0),
    'expected huge-repo batches to apply a default per-chunk commit limit'
  );

  inFlight = 0;
  maxInFlight = 0;
  logCallCount = 0;
  observedChunkSizes = [];
  observedCommitLimits = [];
  setScmRuntimeConfig({
    gitMetaBatch: {
      maxCommitsPerChunk: 0
    },
    runtime: {
      fileConcurrency: 32,
      cpuConcurrency: 16
    }
  });
  const hugeRepoNoCapResult = await gitProvider.getFileMetaBatch({
    repoRoot,
    filesPosix: hugeRepoFiles,
    timeoutMs: 5000
  });
  assert.ok(hugeRepoNoCapResult?.fileMetaByPath);
  assert.equal(Object.keys(hugeRepoNoCapResult.fileMetaByPath).length, hugeRepoFiles.length);
  assert(
    observedCommitLimits.every((value) => value == null),
    'expected maxCommitsPerChunk=0 to disable default per-chunk commit cap'
  );

  inFlight = 0;
  maxInFlight = 0;
  logCallCount = 0;
  observedChunkSizes = [];
  observedCommitLimits = [];
  partialBatchMeta = true;
  setScmRuntimeConfig({
    runtime: {
      fileConcurrency: 4,
      cpuConcurrency: 4
    }
  });
  const partialFiles = ['src/partial-a.js', 'src/partial-b.js', 'src/partial-c.js'];
  const partialResult = await gitProvider.getFileMetaBatch({
    repoRoot,
    filesPosix: partialFiles,
    timeoutMs: 5000
  });
  assert.ok(partialResult?.fileMetaByPath);
  assert.equal(Object.keys(partialResult.fileMetaByPath).length, partialFiles.length);
  assert.equal(partialResult.fileMetaByPath['src/partial-a.js']?.lastAuthor, 'Batch Author');
  assert.equal(partialResult.fileMetaByPath['src/partial-b.js']?.lastAuthor, null);
  assert.equal(partialResult.fileMetaByPath['src/partial-b.js']?.lastModifiedAt, null);
} finally {
  partialBatchMeta = false;
  restoreProgressHandlers();
  setScmCommandRunner(defaultRunner);
  setScmRuntimeConfig(defaultScmConfig);
}

console.log('git provider file-meta batch concurrency ok');
