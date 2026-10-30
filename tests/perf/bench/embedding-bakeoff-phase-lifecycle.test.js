import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { runBakeoffPhase, runBakeoffBuildChild, runBakeoffJsonChild, persistBakeoffFailure, bakeoffPhaseFailureReceipt } from '../../../tools/bench/embeddings/bakeoff-phase.js';
import { createToolDisplay } from '../../../tools/shared/cli-display.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';

applyTestEnv();
const root = process.cwd(), { dir } = await prepareTestCacheDir('embedding-bakeoff-phase-lifecycle');
const script = path.join(root, 'tests/fixtures/bakeoff-phase/child.js');
const contains = (error, target, seen = new Set()) => {
  if (error === target) return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  return contains(error.cause, target, seen) || (Array.isArray(error.errors) && error.errors.some(item => contains(item, target, seen)));
};
const fixture = (name, options = {}) => {
  const states = [], checkpoints = [], messages = [], updates = [], failures = [], controller = new AbortController();
  let settled = false, firstDiagnosticAt = null, releasedWhilePending = false, liveHeartbeats = 0;
  const releasePath = path.join(dir, name + '.release');
  const onState = state => {
    states.push(structuredClone(state));
    if (state.state !== 'running' || state.childProgress.observation !== 'diagnostic-available') return;
    firstDiagnosticAt ??= state.elapsedMs;
    if (state.elapsedMs > firstDiagnosticAt + 30 && !settled) {
      liveHeartbeats++;
      if (!fs.existsSync(releasePath)) { fs.writeFileSync(releasePath, 'owned release'); releasedWhilePending = true; }
    }
  };
  const task = { set: (current, total, extra) => updates.push({ current, total, ...extra }), fail: error => failures.push(error.message) };
  const display = { log: message => messages.push(message) };
  const run = async (phaseName, mode = 'pending') => {
    try { return await runBakeoffPhase({ modelId: 'fixture-model', phaseName, display, task, total: 1,
      completed: () => states.at(-1)?.state === 'succeeded' ? 1 : 0,
      onState, checkpoint: async state => { checkpoints.push(structuredClone(state)); await options.checkpoint?.(state); },
      heartbeatMs: 15, signal: controller.signal,
      run: async phase => {
        const onProgress = chunk => { phase.onProgress(chunk); if (mode === 'cancel') controller.abort(); };
        const input = { args: [script, mode, releasePath], cwd: root, env: process.env, label: phaseName, ...phase, onProgress };
        return phaseName === 'stage2' ? runBakeoffBuildChild(input) : runBakeoffJsonChild(input);
      }
    }); } finally { settled = true; }
  };
  return { run, states, checkpoints, messages, updates, failures,
    progress: () => ({ liveHeartbeats, releasedWhilePending }) };
};
for (const phase of ['stage2', 'eval', 'latency-compare']) {
  const test = fixture(phase), result = await test.run(phase);
  assert.ok(test.progress().liveHeartbeats > 0 && test.progress().releasedWhilePending,
    'the actual phase wrapper must update while its real child is unresolved');
  assert.equal(test.states.at(-1).state, 'succeeded'); assert.equal(test.checkpoints.at(-1).state, 'succeeded');
  assert.equal(test.messages.some(line => line.includes('completed in')), true);
  assert.equal(test.updates.filter(row => row.message.includes('running')).every(row => row.current === 0), true,
    'waiting and diagnostic bytes do not advance completed-success counts');
  assert.ok(test.updates.some(row => row.message.includes('fixture child ready')));
  assert.equal(phase === 'stage2' ? result.exitCode : result.ok, phase === 'stage2' ? 0 : true);
  if (phase !== 'stage2') assert.equal(JSON.parse(JSON.stringify(result)).fixture, 'bakeoff-phase', 'stderr is not mixed into the admitted JSON document');
  const settledStates = test.states.length; await delay(45); assert.equal(test.states.length, settledStates, 'phase timer is cleared after success');
}
for (const mode of ['invalid', 'failed', 'cancel']) {
  const test = fixture(mode);
  await assert.rejects(test.run('eval', mode), error => mode === 'invalid' ? error.code === 'ERR_BAKEOFF_JSON_RESULT'
    : mode === 'failed' ? error.code === 'SUBPROCESS_FAILED' : error.code === 'ABORT_ERR');
  assert.equal(test.states.at(-1).state, mode === 'cancel' ? 'cancelled' : 'failed');
  assert.equal(test.checkpoints.at(-1).state, mode === 'cancel' ? 'cancelled' : 'failed');
  assert.equal(test.messages.some(line => line.includes('completed in')), false);
  assert.equal(test.failures.length, 1);
  assert.equal(test.updates.some(row => row.current === 1), false);
  const settledStates = test.states.length; await delay(45); assert.equal(test.states.length, settledStates, 'failed/cancelled phase timer is cleared');
}

const diskFailure = Object.assign(new Error('checkpoint write failed'), { code: 'ERR_FIXTURE_CHECKPOINT' });
const failedCommit = fixture('checkpoint', { checkpoint: state => { if (state.state === 'succeeded') throw diskFailure; } });
await assert.rejects(failedCommit.run('eval', 'valid'), error => contains(error, diskFailure));
assert.equal(failedCommit.states.at(-1).state, 'failed');
assert.equal(failedCommit.messages.some(line => line.includes('completed in')), false);
let released = false;
const original = Object.freeze(Object.assign(new Error('original child cleanup pending'), { code: 'ERR_FIXTURE_CHILD',
  cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, original); return released; } }));
let observed;
await assert.rejects(runBakeoffPhase({ modelId: 'native-control', phaseName: 'eval', total: 1, completed: () => 0,
  task: { set() {}, fail() {} }, display: { log() {} }, onState: state => { observed = state; }, heartbeatMs: 15,
  run: async () => { throw original; }, checkpoint: async state => { if (state.state === 'failed') throw diskFailure; }
}), error => {
  assert.equal(contains(error, original), true); assert.equal(contains(error, diskFailure), true);
  assert.equal(error.cacheOwnershipReleased(), false); released = true; assert.equal(error.cacheOwnershipReleased(), true);
  return true;
});
assert.equal(observed.state, 'failed');
await assert.rejects(persistBakeoffFailure(original, async () => { throw diskFailure; }), error => contains(error, original) && contains(error, diskFailure));
const displayFailure = new Error('fixture display failed');
await assert.rejects(runBakeoffPhase({ modelId: 'display-control', phaseName: 'eval', total: 1, completed: () => 0,
  task: { set() {}, fail() { throw displayFailure; } }, display: { log() {} }, checkpoint: async () => {},
  run: async () => { throw original; }, heartbeatMs: 15
}), error => contains(error, original) && contains(error, displayFailure));

let quietBytes = 0;
const stream = new Writable({ write(chunk, _encoding, done) { quietBytes += chunk.length; done(); } });
const quietDisplay = createToolDisplay({ argv: { quiet: true, progress: 'auto' }, stream });
try {
  await runBakeoffPhase({ modelId: 'quiet', phaseName: 'eval', display: quietDisplay,
    task: quietDisplay.task('Eval', { total: 1 }), total: 1, completed: () => 0, heartbeatMs: 15,
    onState() {}, checkpoint: async () => {}, run: async ({ onProgress }) => { onProgress('bounded child diagnostic'); await delay(35); return {}; } });
  quietDisplay.flush();
} finally { quietDisplay.close(); }
assert.equal(quietBytes, 0, 'quiet/non-TTY display suppresses progress output through the existing owner');
let getters = 0;
const opaque = Object.defineProperties({}, Object.fromEntries(['message', 'code', 'result', 'errors', 'cacheOwnershipPending'].map(key => [key,
  { get() { getters++; throw new Error('do not inspect opaque diagnostics'); } }])));
assert.equal(bakeoffPhaseFailureReceipt(opaque).message, 'Bakeoff phase failed.'); assert.equal(getters, 0);
const malformed = bakeoffPhaseFailureReceipt({ result: { outputCapture: { stdout: { maxBytes: 'private opaque text',
  observedBytes: 12, unknownEnvironment: process.env } } } });
assert.equal(malformed.outputCapture.stdout.maxBytes, null); assert.equal(malformed.outputCapture.stdout.observedBytes, 12);
assert.equal(Object.hasOwn(malformed.outputCapture.stdout, 'unknownEnvironment'), false);
console.log('Baked build/eval/compare phases stay live, retain truthful terminal counts and preserve child/checkpoint failures.');
