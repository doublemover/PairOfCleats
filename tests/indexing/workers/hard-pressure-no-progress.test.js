import assert from 'node:assert/strict';
import { setImmediate as immediate } from 'node:timers/promises';
import { createWorkerPoolQueue } from '../../../src/index/build/workers/pool/queue.js';
import { evaluateTokenizerPressureWait, TOKENIZER_PRESSURE_NO_PROGRESS_MS,
  TOKENIZER_PRESSURE_MAX_WAIT_MS, createTokenizerPressureError } from '../../../src/index/build/workers/pool/pressure-admission.js';
import { createProcessChunksFixtureContext, processFixtureChunks } from '../file-processor/process-chunks-fixture.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';
ensureTestingEnv(process.env);
const payload = { mode: 'code', languageId: 'typescript' };
const make = () => {
  let time = 0, hard = true, draining = 0, relief = 0;
  const queue = createWorkerPoolQueue({ now: () => time, maxGlobalRssBytes: 10000,
    readMemoryUsage: () => ({ heapUsed: hard ? 999 : 100, heapTotal: 1000, rss: 1000 }),
    readDrainState: () => ({ draining }), requestPressureRelief: async () => { relief += 1; },
    languageThrottleConfig: { enabled: true, heavyLanguages: ['typescript'], blockHeavyOnHardPressure: true,
      softMaxPerLanguage: 1, hardMaxPerLanguage: 1 } });
  return { queue, tick: async value => { time = value; queue.refreshPressureAdmission(); await immediate(); },
    recover: () => { hard = false; }, setDraining: value => { draining = value; }, relief: () => relief };
};
assert.equal(evaluateTokenizerPressureWait({ startedAt: 0, now: 5000, lastProgressAt: 0, draining: 0 }).reason, 'pressure-no-safe-drain');
assert.equal(evaluateTokenizerPressureWait({ startedAt: 0, now: 5000, lastProgressAt: 0, draining: 1 }).reason, null);
assert.equal(evaluateTokenizerPressureWait({ startedAt: 0, now: 15000, lastProgressAt: 14999, draining: 1 }).reason, 'pressure-drain-deadline');
assert.equal(evaluateTokenizerPressureWait({ startedAt: 0, now: 5000, lastProgressAt: 4000, draining: 0 }).reason, null);
{
  const state = make();
  try {
    const waiting = state.queue.acquireLanguageThrottleSlot(payload);
    waiting.catch(() => {});
    const peers = Array.from({ length: 3 }, () => state.queue.acquireLanguageThrottleSlot(payload));
    for (const peer of peers) peer.catch(() => {});
    await state.tick(TOKENIZER_PRESSURE_NO_PROGRESS_MS);
    await assert.rejects(waiting, error => error.code === 'ERR_TOKENIZER_RESOURCE_PRESSURE'
      && error.retryable && error.resumable && error.resourcePressure.draining === 0
      && error.resourcePressure.reason === 'pressure-no-safe-drain'
      && error.resourcePressure.evidenceScope.includes('not proof'));
    assert.ok((await Promise.allSettled(peers)).every(result => result.status === 'rejected' && result.reason.code === 'ERR_TOKENIZER_RESOURCE_PRESSURE'));
    assert.deepEqual(state.queue.snapshot().languageThrottle.activeByLanguage, {});
    assert.equal(state.relief(), 1);
    await assert.rejects(state.queue.acquireLanguageThrottleSlot({ mode: 'prose', languageId: 'text' }), { code: 'ERR_TOKENIZER_RESOURCE_PRESSURE' });
    assert.equal(state.queue.snapshot().languageThrottle.refreshTimerCount, 0);
  } finally { await state.queue.close(); }
}
{
  const state = make(); state.setDraining(1);
  try {
    let settled = false;
    const waiting = state.queue.acquireLanguageThrottleSlot(payload).finally(() => { settled = true; });
    waiting.catch(() => {});
    await state.tick(TOKENIZER_PRESSURE_NO_PROGRESS_MS);
    assert.equal(settled, false, 'independent draining work gets the bounded drain window');
    state.recover(); await state.tick(TOKENIZER_PRESSURE_NO_PROGRESS_MS + 1);
    const slot = await waiting; state.queue.releaseLanguageThrottleSlot(slot);
    assert.equal(state.queue.snapshot().languageThrottle.terminalPressureReason, null);
  } finally { await state.queue.close(); }
}
{
  const state = make(); state.setDraining(1);
  try {
    const waiting = state.queue.acquireLanguageThrottleSlot(payload); waiting.catch(() => {});
    await state.tick(TOKENIZER_PRESSURE_MAX_WAIT_MS);
    await assert.rejects(waiting, error => error.resourcePressure.reason === 'pressure-drain-deadline');
  } finally { await state.queue.close(); }
}
{
  const state = make(); const controller = new AbortController();
  try {
    const waiting = state.queue.acquireLanguageThrottleSlot(payload, { signal: controller.signal });
    controller.abort(); await assert.rejects(waiting, { name: 'AbortError' });
    assert.equal(state.queue.snapshot().languageThrottle.refreshTimerCount, 0);
    assert.equal(state.queue.snapshot().languageThrottle.terminalPressureReason, null);
  } finally { await state.queue.close(); }
}
const pressure = createTokenizerPressureError({ reason: 'pressure-no-safe-drain', waitMs: 5000 });
const { context } = createProcessChunksFixtureContext({ overrides: { workerState: { tokenWorkerDisabled: false },
  workerPool: { shouldUseForFile: () => true, tokenizeChunk: async () => { throw pressure; } } } });
await assert.rejects(processFixtureChunks(context), error => error === pressure);
assert.equal(context.workerState.tokenWorkerDisabled, false, 'pressure failure cannot become inline execution or a backend retry');
assert.equal(context.tokenizationStats.chunks, 0);
console.log('hard pressure admission has bounded no-progress disposition without bypassing resource ownership');
