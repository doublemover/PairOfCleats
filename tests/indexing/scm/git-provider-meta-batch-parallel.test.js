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
let progressEvents = [];
let restoreProgressHandlers = () => {};

const buildBatchStdout = (files) => {
  const rows = [];
  for (const file of files) {
    rows.push('__POC_GIT_META__2026-02-22T00:00:00Z\u0000Batch Author');
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
      return {
        exitCode: 0,
        stdout: buildBatchStdout(files),
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
  assert.equal(firstProgress?.step, 'SCM Git Meta');
  assert.equal(firstProgress?.current, 0);
  assert.equal(firstProgress?.total, 5);
  assert.equal(firstProgress?.meta?.taskId, 'scm:git:file-meta-batch');
  assert.equal(firstProgress?.meta?.ephemeral, true);
  assert.equal(lastProgress?.current, lastProgress?.total);

  inFlight = 0;
  maxInFlight = 0;
  logCallCount = 0;
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
} finally {
  restoreProgressHandlers();
  setScmCommandRunner(defaultRunner);
  setScmRuntimeConfig(defaultScmConfig);
}

console.log('git provider file-meta batch concurrency ok');
