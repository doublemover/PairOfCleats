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
import { resolveSchedulerConfig } from '../../../src/index/build/runtime/scheduler.js';
import { SCHEDULER_AUTOTUNE_PROFILE_VERSION } from '../../../src/index/build/runtime/scheduler-autotune-policy.js';

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

  const envelope = cpu => ({ concurrency: { cpuConcurrency: { value: cpu }, ioConcurrency: { value: cpu },
    totalMemBytes: 8 * 1024 ** 3 } });
  const resolve = (overrides = {}) => resolveSchedulerConfig({ envelope: envelope(4), indexingConfig: {},
    argv: {}, rawArgv: [], envConfig: {}, ...overrides });
  const stats = { tokens: { cpu: { total: 6 }, io: { total: 6 }, mem: { total: 8 } },
    utilization: { overall: 0.5, mem: 0.4 }, activity: { pending: 0, pendingBytes: 0 }, queues: {} };
  const roundTrip = async (config) => {
    await writeSchedulerAutoTuneProfile({ repoCacheRoot: tempRoot, schedulerConfig: config,
      schedulerStats: stats, buildId: 'policy-round-trip' });
    const profile = await loadSchedulerAutoTuneProfile({ repoCacheRoot: tempRoot });
    assert.equal(profile.version, SCHEDULER_AUTOTUNE_PROFILE_VERSION);
    return profile;
  };
  const automatic = resolve();
  for (const override of [
    { argv: { 'scheduler-max-cpu': 256 }, rawArgv: ['--scheduler-max-cpu=256'] },
    { envConfig: { schedulerMaxCpuTokens: 256 } },
    { indexingConfig: { scheduler: { maxCpuTokens: 256 } } }
  ]) {
    const selected = resolve(override), profile = await roundTrip(selected);
    assert.equal(profile.recommended.maxCpuTokens, 256);
    assert.equal(resolve({ autoTuneProfile: profile }).maxCpuTokens, automatic.maxCpuTokens,
      'removing a one-off control cannot promote it into learned automatic authority');
    assert.equal(resolve({ ...override, autoTuneProfile: profile }).autoTune.profileEligible, true);
    assert.equal(resolve({ argv: { 'scheduler-max-cpu': 128 }, rawArgv: ['--scheduler-max-cpu', '128'],
      autoTuneProfile: profile }).maxCpuTokens, 128);
    assert.equal(resolve({ envConfig: { schedulerMaxCpuTokens: 256 }, autoTuneProfile: profile }).autoTune.profileEligible,
      true, 'equivalent accepted explicit policy across config/CLI/env remains compatible');
  }
  const profile = await roundTrip(automatic);
  profile.recommended.maxCpuTokens = 20;
  assert.equal(resolve({ autoTuneProfile: profile }).maxCpuTokens, 20, 'legitimate same-policy learning remains reusable');
  for (const cpu of [1, 16]) assert.equal(resolve({ envelope: envelope(cpu), autoTuneProfile: profile }).autoTune.profileEligible, false);
  for (const generatedAt of ['invalid', new Date(Date.now() + 60000).toISOString(), new Date(Date.now() - 8 * 86400000).toISOString()]) {
    assert.equal(resolve({ autoTuneProfile: { ...profile, generatedAt } }).autoTune.profileEligible, false);
  }
  assert.equal(resolve({ autoTuneProfile: { ...profile, version: 2 } }).autoTune.profileEligible, false);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('scheduler autotune profile test passed');
