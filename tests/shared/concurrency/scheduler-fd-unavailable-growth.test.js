import assert from 'node:assert/strict';
import { createSchedulerCoreConfig } from '../../../src/shared/concurrency/scheduler-core/config.js';
import { createAdaptiveSignalReader } from '../../../src/shared/concurrency/scheduler-core/adaptive-signals.js';
import { createAdaptiveTokenController } from '../../../src/shared/concurrency/scheduler-core/adaptive-token-controller.js';
import { createSchedulerQueueLifecycle } from '../../../src/shared/concurrency/scheduler-core/queue-lifecycle.js';

const scenario = ({ sampler, adaptive = true, surfaces = true, configuredCap } = {}) => {
  let now = 0;
  const config = createSchedulerCoreConfig({ adaptive, adaptiveIntervalMs: 1, now: () => now,
    cpuTokens: 2, ioTokens: 2, memoryTokens: 2, maxCpuTokens: 8, maxIoTokens: 8, maxMemoryTokens: 8,
    adaptiveSignalSampler: sampler, queues: { 'stage1.cpu': {} },
    adaptiveSurfaces: { enabled: surfaces, ...(configuredCap ? { fdPressure: { maxTokenCap: configuredCap } } : {}) } });
  createSchedulerQueueLifecycle({ config }).ensureQueue('stage1.cpu').pending.push(...Array.from({ length: 16 }, () => ({})));
  const state = { tokens: config.createTokenState(), shuttingDown: false, lastAdaptiveAt: 0,
    adaptiveCurrentIntervalMs: config.adaptiveMinIntervalMs, burstModeUntilMs: 0 };
  const { readSystemSignals } = createAdaptiveSignalReader({ config, state });
  const { maybeAdaptTokens } = createAdaptiveTokenController({ config, state,
    maybeAdaptSurfaceControllers: () => {
      if (!surfaces) return;
      const signals = readSystemSignals();
      // Fix memory evidence to isolate FD growth from host memory pressure.
      state.lastSystemSignals = { ...signals, memory: { totalBytes: 8 * 1024 ** 3, freeBytes: 6 * 1024 ** 3 } };
    } });
  return { state, readSystemSignals, tick: () => { now += 1000; maybeAdaptTokens(); } };
};

for (const sampler of [undefined, () => ({ cpu: { loadRatio: 0.1 } })]) {
  const { state, tick, readSystemSignals } = scenario({ sampler });
  assert.equal(readSystemSignals().fd.tokenCap, null);
  assert.equal(readSystemSignals().fd.available, false);
  for (let i = 0; i < 4; i++) tick();
  assert.equal(state.tokens.io.total, 8, 'no invented current-count cap prevents eligible growth');
}
for (const tokenCap of [null, undefined, 0, -1, NaN, Infinity]) {
  const { readSystemSignals } = scenario({ sampler: () => ({ fd: { tokenCap } }) });
  assert.equal(readSystemSignals().fd.available, false);
  assert.equal(readSystemSignals().fd.tokenCap, null);
}
let cap = 2;
const controlled = scenario({ sampler: () => ({ fd: { tokenCap: cap } }) });
for (let i = 0; i < 3; i++) controlled.tick();
assert.equal(controlled.state.tokens.io.total, 2);
cap = 8; controlled.tick();
assert.ok(controlled.state.tokens.io.total > 2);
controlled.state.tokens.io.used = 4; cap = 2; controlled.tick();
assert.equal(controlled.state.tokens.io.total, 4, 'contraction preserves admitted running work');
controlled.state.tokens.io.used = 0; controlled.tick();
assert.equal(controlled.state.tokens.io.total, 2);
assert.equal(controlled.readSystemSignals().fd.source, 'injected-sample');
const configured = scenario({ configuredCap: 2 }); configured.tick();
assert.equal(configured.state.tokens.io.total, 2);
assert.equal(configured.readSystemSignals().fd.source, 'configured-max-token-cap');
const disabled = scenario({ adaptive: false }); disabled.tick();
assert.equal(disabled.state.tokens.io.total, 2);
console.log('scheduler unknown FD budget growth passed');
