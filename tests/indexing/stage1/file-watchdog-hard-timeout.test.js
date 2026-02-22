#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  resolveFileHardTimeoutMs,
  resolveFileWatchdogConfig,
  resolveFileWatchdogMs
} from '../../../src/index/build/indexer/steps/process-files.js';

ensureTestingEnv(process.env);

const explicitConfig = resolveFileWatchdogConfig({
  stage1Queues: {
    watchdog: {
      slowFileMs: 1000,
      maxSlowFileMs: 5000,
      hardTimeoutMs: 4000,
      bytesPerStep: 100,
      linesPerStep: 10,
      stepMs: 500
    }
  }
});

const entry = {
  stat: { size: 1000 },
  lines: 100
};
const softTimeoutMs = resolveFileWatchdogMs(explicitConfig, entry);
const hardTimeoutMs = resolveFileHardTimeoutMs(explicitConfig, entry, softTimeoutMs);
assert.equal(softTimeoutMs, 5000, 'expected soft timeout to clamp at configured max');
assert.equal(hardTimeoutMs, 10000, 'expected hard timeout to scale from soft timeout and file size');

const defaultConfig = resolveFileWatchdogConfig({
  stage1Queues: {
    watchdog: {
      slowFileMs: 1000,
      maxSlowFileMs: 2000
    }
  }
});
assert.ok(
  defaultConfig.hardTimeoutMs >= 300000,
  'expected default hard timeout floor for unconfigured watchdog hard timeout'
);

const nullOverrideConfig = resolveFileWatchdogConfig({
  stage1Queues: {
    watchdog: {
      slowFileMs: null,
      maxSlowFileMs: null,
      hardTimeoutMs: null
    }
  }
});
assert.equal(
  nullOverrideConfig.slowFileMs,
  10000,
  'expected null slowFileMs to use default watchdog timeout'
);
assert.equal(
  nullOverrideConfig.maxSlowFileMs,
  120000,
  'expected null maxSlowFileMs to use default watchdog max timeout'
);
assert.ok(
  nullOverrideConfig.hardTimeoutMs >= 300000,
  'expected null hardTimeoutMs to keep hard timeout enabled'
);

const adaptiveHugeRepoConfig = resolveFileWatchdogConfig(
  { stage1Queues: { watchdog: {} } },
  { repoFileCount: 4000 }
);
assert.equal(
  adaptiveHugeRepoConfig.slowFileMs,
  20000,
  'expected huge repo default to raise base slow-file threshold'
);
assert.equal(
  adaptiveHugeRepoConfig.maxSlowFileMs,
  120000,
  'expected adaptive slow-file threshold to preserve max slow timeout floor'
);

const explicitSlowOnHugeRepoConfig = resolveFileWatchdogConfig(
  {
    stage1Queues: {
      watchdog: {
        slowFileMs: 1500
      }
    }
  },
  { repoFileCount: 4000 }
);
assert.equal(
  explicitSlowOnHugeRepoConfig.slowFileMs,
  1500,
  'expected explicit slowFileMs to override adaptive huge-repo threshold'
);

console.log('file watchdog hard timeout test passed');

