#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  deriveSchedulerAutoTuneRecommendation,
  loadSchedulerAutoTuneProfile,
  writeSchedulerAutoTuneProfile
} from '../../../src/index/build/runtime/scheduler-autotune-profile.js';

applyTestEnv();

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-scheduler-autotune-'));
try {
  const recommendation = deriveSchedulerAutoTuneRecommendation({
    schedulerStats: {
      tokens: {
        cpu: { total: 4 },
        io: { total: 4 },
        mem: { total: 4 }
      },
      utilization: {
        overall: 0.55,
        mem: 0.4
      },
      activity: {
        pending: 24,
        pendingBytes: 256 * 1024 * 1024
      },
      queues: {
        'stage2.write': {
          pending: 12,
          waitP95Ms: 18000
        }
      }
    },
    schedulerConfig: {
      maxCpuTokens: 4,
      maxIoTokens: 4,
      maxMemoryTokens: 4
    },
    buildId: 'build-1'
  });
  assert.ok(recommendation, 'expected recommendation payload');
  assert.equal(recommendation.sourceBuildId, 'build-1');
  assert.ok(recommendation.recommended.maxCpuTokens > 4, 'expected cpu recommendation to scale up');
  assert.ok(recommendation.recommended.maxIoTokens > 4, 'expected io recommendation to scale up');

  const written = await writeSchedulerAutoTuneProfile({
    repoCacheRoot: tempRoot,
    schedulerStats: {
      tokens: {
        cpu: { total: 3 },
        io: { total: 3 },
        mem: { total: 3 }
      },
      utilization: {
        overall: 0.96,
        mem: 0.9
      },
      activity: {
        pending: 2,
        pendingBytes: 0
      },
      queues: {
        'stage2.write': {
          pending: 0,
          waitP95Ms: 0
        }
      }
    },
    schedulerConfig: {
      maxCpuTokens: 6,
      maxIoTokens: 6,
      maxMemoryTokens: 6
    },
    buildId: 'build-2'
  });
  assert.ok(written, 'expected profile to be persisted');

  const loaded = await loadSchedulerAutoTuneProfile({
    repoCacheRoot: tempRoot
  });
  assert.ok(loaded, 'expected persisted profile to be readable');
  assert.equal(loaded.sourceBuildId, 'build-2');
  assert.ok(Number.isFinite(loaded.recommended.maxCpuTokens));
  assert.ok(Number.isFinite(loaded.recommended.maxIoTokens));
  assert.ok(Number.isFinite(loaded.recommended.maxMemoryTokens));
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('scheduler autotune profile test passed');
