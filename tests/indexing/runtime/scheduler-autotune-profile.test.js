#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { schedulerWorkloadInput } from '../../helpers/scheduler-workload.js';
import { deriveSchedulerAutoTuneRecommendation as derive, loadSchedulerAutoTuneProfile as load,
  writeSchedulerAutoTuneProfile as write } from '../../../src/index/build/runtime/scheduler-autotune-profile.js';
import { resolveSchedulerConfig } from '../../../src/index/build/runtime/scheduler.js';
import { SCHEDULER_AUTOTUNE_PROFILE_VERSION } from '../../../src/index/build/runtime/scheduler-autotune-policy.js';
import { createSchedulerWorkloadObservation } from '../../../src/shared/concurrency/scheduler-workload-observation.js';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { createPipelineCheckpointController, sanitizeRuntimeSnapshotForCheckpoint } from '../../../src/index/build/indexer/pipeline/checkpoints.js';
import { finalizePipelineModeRun } from '../../../src/index/build/indexer/pipeline/finalize.js';

applyTestEnv();
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-scheduler-autotune-'));
const envelope = cpu => ({ concurrency: { cpuConcurrency: { value: cpu }, ioConcurrency: { value: cpu }, totalMemBytes: 8 * 1024 ** 3 } });
const resolve = (overrides = {}) => resolveSchedulerConfig({ envelope: envelope(4), indexingConfig: {},
  argv: {}, rawArgv: [], envConfig: {}, ...overrides });
const automatic = resolve();
const input = (options = {}) => schedulerWorkloadInput({ config: automatic, ...options });
try {
  const qualified = derive(input({ buildId: 'build-1', cpuHeadroom: true }));
  assert.equal(qualified.status, 'qualified');
  assert.equal(qualified.sourceBuildId, 'build-1');
  assert.ok(qualified.recommended.maxCpuTokens <= automatic.maxCpuTokens);
  assert.equal(qualified.recommended.maxIoTokens, automatic.maxIoTokens);
  assert.equal(qualified.recommended.maxMemoryTokens, automatic.maxMemoryTokens);
  assert.equal(qualified.evidence.cpuBusyTimeMeasured, false);
  const unknown = derive(input());
  assert.equal(unknown.decision, 'no-change', 'unknown host headroom cannot authorize more capacity');
  assert.equal(unknown.evidence.coverage.signals.cpuSamples, 0);
  for (const options of [{ completed: 0 }, { durationMs: 10 }, { rejected: 1 }, { failed: 1 }]) {
    assert.equal(derive(input(options)).status, 'insufficient-evidence');
  }
  for (const change of [value => { delete value.schedulerStats.workloadObservations; },
    value => { value.schedulerStats.workloadObservations.schemaVersion = 0; },
    value => { value.schedulerStats.workloadObservations.complete = false; },
    value => { value.schedulerStats.workloadObservations.resourceIdentity = 'other'; },
    value => { value.schedulerStats.activity.pending = 1; }, value => { value.mode = 'unobserved'; },
    value => { value.outcome = 'cancelled'; }]) {
    const value = input(); change(value);
    assert.equal(derive(value).status, 'insufficient-evidence');
  }
  const staleWait = input();
  staleWait.schedulerStats.queues = { 'stage2.write': { waitP95Ms: 60000, pending: 0 } };
  assert.deepEqual(derive(staleWait).recommended, unknown.recommended, 'stale waits do not ratchet I/O or memory');

  const savedInput = input({ buildId: 'multi-mode', durationMs: 5000 });
  assert.equal((await write({ ...savedInput, repoCacheRoot: tempRoot })).status, 'qualified');
  const saved = await load({ repoCacheRoot: tempRoot });
  assert.equal(saved.version, SCHEDULER_AUTOTUNE_PROFILE_VERSION);
  assert.equal((await write({ ...savedInput, repoCacheRoot: tempRoot })).reason, 'observation-already-persisted');
  assert.equal((await write({ ...input({ buildId: 'multi-mode', mode: 'prose' }), repoCacheRoot: tempRoot })).reason,
    'richer-build-mode-evidence-retained');
  assert.equal((await write({ ...input({ completed: 0 }), repoCacheRoot: tempRoot })).status, 'insufficient-evidence');
  assert.deepEqual(await load({ repoCacheRoot: tempRoot }), saved, 'insufficient mode never destroys qualified evidence');

  const roundTrip = async config => {
    const value = await write({ ...schedulerWorkloadInput({ config, buildId: 'policy-round-trip' }), repoCacheRoot: tempRoot });
    assert.equal(value.status, 'qualified');
    return load({ repoCacheRoot: tempRoot });
  };
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
    assert.equal(resolve({ argv: { 'scheduler-max-cpu': 128 }, rawArgv: ['--scheduler-max-cpu', '128'], autoTuneProfile: profile }).maxCpuTokens, 128);
    assert.equal(resolve({ envConfig: { schedulerMaxCpuTokens: 256 }, autoTuneProfile: profile }).autoTune.profileEligible, true);
  }
  const profile = await roundTrip(automatic);
  profile.recommended.maxCpuTokens = automatic.cpuTokens + 1;
  assert.equal(resolve({ autoTuneProfile: profile }).maxCpuTokens, automatic.cpuTokens + 1, 'qualified learning within the envelope is reusable');
  profile.recommended.maxCpuTokens = automatic.maxCpuTokens + 100;
  assert.equal(resolve({ autoTuneProfile: profile }).maxCpuTokens, automatic.maxCpuTokens, 'profile cannot expand the accepted hard envelope');
  for (const cpu of [1, 16]) assert.equal(resolve({ envelope: envelope(cpu), autoTuneProfile: profile }).autoTune.profileEligible, false);
  for (const generatedAt of ['invalid', new Date(Date.now() + 60000).toISOString(), new Date(Date.now() - 8 * 86400000).toISOString()]) {
    assert.equal(resolve({ autoTuneProfile: { ...profile, generatedAt } }).autoTune.profileEligible, false);
  }
  for (const version of [1, 2, 3, String(SCHEDULER_AUTOTUNE_PROFILE_VERSION)]) {
    const old = { ...profile, version };
    assert.equal(resolve({ autoTuneProfile: old }).autoTune.profileEligible, false);
    await fs.writeFile(path.join(tempRoot, 'metrics/scheduler-autotune.json'), JSON.stringify(old));
    assert.equal(await load({ repoCacheRoot: tempRoot }), null, 'obsolete/coerced versions are not adapted');
  }

  // The aggregate retains a fixed number of phases, not one item per task.
  let tick = 0, stageEpoch = 0;
  const resource = { tokens: { cpu: { used: 1, total: 2 }, io: { used: 0, total: 1 }, mem: { used: 0, total: 1 } },
    counters: { started: 0, completed: 0, failed: 0, rejected: 0 }, active: true, inFlightBytes: 1 };
  const scope = { buildId: 'bound', mode: 'code', stage: 'processing', stageEpoch };
  const collector = createSchedulerWorkloadObservation({ nowMs: () => tick, readResources: () => resource,
    readContext: () => scope, resourceIdentity: automatic.resourceIdentity });
  for (let count = 0; count < 10000; count++) { tick++; resource.counters.started++; resource.counters.completed++; collector.resourcesChanged(); }
  assert.equal(collector.snapshot().phases.length, 1);
  for (stageEpoch = 1; stageEpoch < 100; stageEpoch++) { scope.stageEpoch = stageEpoch; tick++; collector.resourcesChanged(); }
  assert.equal(collector.snapshot().phases.length, 64);
  assert.equal(collector.snapshot().overflow, true); assert.equal(collector.snapshot().complete, false);
  const overlapping = createSchedulerWorkloadObservation({ nowMs: () => tick, readResources: () => resource,
    readContext: () => scope, resourceIdentity: automatic.resourceIdentity });
  overlapping.resourcesChanged(); scope.mode = 'prose'; tick++; overlapping.resourcesChanged();
  assert.equal(overlapping.snapshot().scopeOverlap, true);
  tick--; overlapping.resourcesChanged(); assert.equal(overlapping.snapshot().clockInvalid, true);

  // Real scheduler -> checkpoint scope -> production finalization handoff.
  // Both trajectories end drained; only their active histories differ.
  const trajectory = async cpu => {
    let now = 10000;
    const config = { ...automatic, cpuTokens: cpu, ioTokens: 1, memoryTokens: 1 };
    const scheduler = createBuildScheduler({ ...config, adaptive: false, lowResourceMode: true, now: () => now,
      queues: { work: { concurrency: 16 } } });
    const runtime = { scheduler, schedulerConfig: config, buildId: 'handoff-' + cpu, repoCacheRoot: tempRoot,
      enqueueServiceEmbeddings: false };
    const checkpoints = createPipelineCheckpointController({ mode: 'code', runtime, stageCheckpoints: {},
      hostCpuCount: 1, logFn: () => {}, logLineFn: () => {} });
    checkpoints.setSchedulerTelemetryStage('processing');
    const starts = Array.from({ length: 4 }, () => Promise.withResolvers());
    const ends = Array.from({ length: 4 }, () => Promise.withResolvers());
    const tasks = starts.map((started, index) => scheduler.schedule('work', { cpu: 1 }, async () => {
      started.resolve(); await ends[index].promise; return index;
    }));
    try {
      for (let index = 0; index < 4; index++) {
        await starts[index].promise;
        now += 400; scheduler.stats();
        ends[index].resolve(); await tasks[index];
      }
      const stats = scheduler.stats();
      assert.equal(stats.activity.pending, 0); assert.equal(stats.activity.running, 0);
      assert.equal(stats.tokens.cpu.used, 0); assert.equal(stats.workloadObservations.complete, true);
      const beforeIdle = structuredClone(stats.workloadObservations.phases);
      now += 60000;
      const afterIdle = scheduler.stats().workloadObservations.phases;
      assert.deepEqual(afterIdle.map(phase => phase.activeMs), beforeIdle.map(phase => phase.activeMs), 'drained idle time is not workload duration');
      assert.equal(sanitizeRuntimeSnapshotForCheckpoint({ scheduler: stats }).scheduler.workloadObservations, undefined);
      await finalizePipelineModeRun({ mode: 'code', runtime, runtimeRef: runtime, outDir: tempRoot,
        indexSizeBaselineBytes: 0, effectiveAbortSignal: null, stagePlan: [{ label: 'write' }],
        getSchedulerStats: checkpoints.getSchedulerStats, log: () => {}, cacheReporter: { report() {} }, crashLogger: { updatePhase() {} } });
      const result = await load({ repoCacheRoot: tempRoot });
      assert.equal(result.sourceBuildId, runtime.buildId);
      assert.equal(result.evidence.coverage.work.completed, 4);
      assert.equal(result.evidence.coverage.activeMs, 1600);
      return result.evidence.coverage;
    } finally { for (const end of ends) end.resolve(); await scheduler.shutdown({ awaitRunning: true }); }
  };
  const serial = await trajectory(1), parallel = await trajectory(4);
  assert.notEqual(serial.tokenTime.cpu.capacityMs, parallel.tokenTime.cpu.capacityMs);
  assert.ok(serial.blockedBy['cpu-tokens'] > (parallel.blockedBy['cpu-tokens'] || 0), 'distinct active demand survives identical drained stats');
} finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
console.log('scheduler autotune profile test passed');
