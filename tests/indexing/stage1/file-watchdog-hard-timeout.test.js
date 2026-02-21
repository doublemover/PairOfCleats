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

console.log('file watchdog hard timeout test passed');

