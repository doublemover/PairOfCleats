#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gitProvider } from '../../../src/index/scm/providers/git.js';
import { getScmCommandRunner, setScmCommandRunner } from '../../../src/index/scm/runner.js';
import { getScmRuntimeConfig, setScmRuntimeConfig } from '../../../src/index/scm/runtime.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const defaultRunner = getScmCommandRunner();
const defaultScmConfig = getScmRuntimeConfig();

const tempRoot = path.join(process.cwd(), '.testCache', 'git-meta-timeout-backoff');
const adaptiveRepoRoot = path.join(tempRoot, 'adaptive-repo');
const cooldownRepoRoot = path.join(tempRoot, 'cooldown-repo');

const writeSizedFile = (repoRoot, filePosix, sizeBytes) => {
  const absPath = path.join(repoRoot, filePosix);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const size = Math.max(1, Math.floor(Number(sizeBytes) || 1));
  fs.writeFileSync(absPath, Buffer.alloc(size, 120));
};

let timeoutAttempts = [];
let totalCalls = 0;

fs.rmSync(tempRoot, { recursive: true, force: true });
fs.mkdirSync(adaptiveRepoRoot, { recursive: true });
fs.mkdirSync(cooldownRepoRoot, { recursive: true });
writeSizedFile(adaptiveRepoRoot, 'src/history-medium.js', 1024 * 1024);
writeSizedFile(cooldownRepoRoot, 'src/repeat-offender.js', 1024 * 1024);

setScmCommandRunner(async (_command, _args, options = {}) => {
  totalCalls += 1;
  timeoutAttempts.push(options?.timeoutMs ?? null);
  const err = new Error('forced batch timeout');
  err.code = 'SUBPROCESS_TIMEOUT';
  throw err;
});

try {
  setScmRuntimeConfig({
    maxConcurrentProcesses: 1,
    runtime: {
      fileConcurrency: 1,
      cpuConcurrency: 1
    },
    gitMetaBatch: {
      timeoutPolicy: {
        retryMaxAttempts: 4,
        cooldownAfterTimeouts: 20,
        cooldownMs: 60 * 1000,
        minTimeoutMs: 10,
        maxTimeoutMs: 200
      }
    }
  });

  const adaptiveFile = 'src/history-medium.js';
  timeoutAttempts = [];
  const firstAdaptive = await gitProvider.getFileMetaBatch({
    repoRoot: adaptiveRepoRoot,
    filesPosix: [adaptiveFile],
    timeoutMs: 50
  });
  const firstAttempts = timeoutAttempts.slice();
  assert.equal(firstAttempts.length, 3, 'expected large-cost file to use three timeout attempts initially');
  assert.deepEqual(
    firstAttempts,
    [...firstAttempts].sort((left, right) => left - right),
    'expected initial timeout attempts to increase toward the target'
  );
  assert.equal(firstAdaptive?.diagnostics?.timeoutCount, 3);
  assert.equal(firstAdaptive?.diagnostics?.timeoutRetries, 2);
  assert.equal(firstAdaptive?.diagnostics?.cooldownSkips, 0);
  assert.equal(firstAdaptive?.fileMetaByPath?.[adaptiveFile]?.lastModifiedAt, null);

  timeoutAttempts = [];
  const secondAdaptive = await gitProvider.getFileMetaBatch({
    repoRoot: adaptiveRepoRoot,
    filesPosix: [adaptiveFile],
    timeoutMs: 50
  });
  const secondAttempts = timeoutAttempts.slice();
  assert.equal(secondAttempts.length, 4, 'expected timeout history depth to expand retry budget');
  assert(
    secondAttempts.length > firstAttempts.length,
    'expected second timeout ladder to have more attempts after prior failures'
  );
  assert.deepEqual(
    secondAttempts,
    [...secondAttempts].sort((left, right) => left - right),
    'expected expanded timeout attempts to stay ordered'
  );
  assert.equal(secondAdaptive?.diagnostics?.timeoutCount, 4);
  assert.equal(secondAdaptive?.diagnostics?.timeoutRetries, 3);
  const secondHeat = secondAdaptive?.diagnostics?.timeoutHeatmap?.find((entry) => entry.file === adaptiveFile);
  assert.equal(secondHeat?.timeouts, 4, 'expected timeout heatmap to record repeated attempts');
  assert.equal(secondHeat?.retries, 3, 'expected timeout heatmap to record retry attempts');
  assert.equal(Number.isFinite(Number(secondHeat?.lastTimeoutMs)), true);

  setScmRuntimeConfig({
    maxConcurrentProcesses: 1,
    runtime: {
      fileConcurrency: 1,
      cpuConcurrency: 1
    },
    gitMetaBatch: {
      timeoutPolicy: {
        retryMaxAttempts: 2,
        cooldownAfterTimeouts: 2,
        cooldownMs: 60 * 1000,
        minTimeoutMs: 10,
        maxTimeoutMs: 200
      }
    }
  });

  const cooldownFile = 'src/repeat-offender.js';
  timeoutAttempts = [];
  const firstCooldown = await gitProvider.getFileMetaBatch({
    repoRoot: cooldownRepoRoot,
    filesPosix: [cooldownFile],
    timeoutMs: 50
  });
  const firstCooldownAttempts = timeoutAttempts.slice();
  assert.equal(firstCooldownAttempts.length, 2, 'expected initial cooldown run to exhaust timeout attempts');
  assert.equal(firstCooldown?.diagnostics?.timeoutCount, 2);
  assert.equal(firstCooldown?.diagnostics?.timeoutRetries, 1);
  const callsAfterFirstCooldown = totalCalls;

  timeoutAttempts = [];
  const secondCooldown = await gitProvider.getFileMetaBatch({
    repoRoot: cooldownRepoRoot,
    filesPosix: [cooldownFile],
    timeoutMs: 50
  });
  assert.equal(timeoutAttempts.length, 0, 'expected cooldown run to skip SCM command execution');
  assert.equal(totalCalls, callsAfterFirstCooldown, 'expected cooldown skip to avoid new SCM calls');
  assert.equal(secondCooldown?.diagnostics?.timeoutCount, 0);
  assert.equal(secondCooldown?.diagnostics?.cooldownSkips, 1);
  const cooldownHeat = secondCooldown?.diagnostics?.timeoutHeatmap?.find((entry) => entry.file === cooldownFile);
  assert.equal(cooldownHeat?.timeouts, 0);
  assert.equal(cooldownHeat?.cooldownSkips, 1);
  assert.equal(secondCooldown?.fileMetaByPath?.[cooldownFile]?.lastAuthor, null);
} finally {
  setScmRuntimeConfig(defaultScmConfig);
  setScmCommandRunner(defaultRunner);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('git meta timeout adaptive policy test passed');
