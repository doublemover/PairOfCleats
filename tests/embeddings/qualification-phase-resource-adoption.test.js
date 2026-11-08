import assert from 'node:assert/strict';
import { runQualificationPhase } from './helpers/qualification-phase.js';

const controller = new AbortController(), reason = Object.freeze(new Error('cancelled during original acquisition'));
const phases = [], observations = [];
let owner = null, closed = 0, creations = 0;
const original = Object.freeze({ close() { closed++; } });
try {
  await assert.rejects(runQualificationPhase({ name: 'original-acquisition', signal: controller.signal,
    phases, observe: value => observations.push(value), adopt: value => { owner = value; },
    operation: async () => { creations++; controller.abort(reason); return original; } }), error => error === reason);
  assert.equal(owner, original, 'late successful acquisition remains available to the caller finally');
  assert.deepEqual(observations, ['original-acquisition:before', 'original-acquisition:after']);
  assert.equal(phases.length, 1); assert.equal(phases[0].name, 'original-acquisition');
  assert(phases[0].elapsedMs >= 0);
} finally { await owner?.close(); }
assert.equal(closed, 1); assert.equal(creations, 1);

const failed = Object.freeze(new Error('original acquisition rejected'));
let adopted = 0;
await assert.rejects(runQualificationPhase({ name: 'failed-acquisition', signal: new AbortController().signal,
  phases: [], observe: () => {}, adopt: () => { adopted++; }, operation: async () => { throw failed; } }), error => error === failed);
assert.equal(adopted, 0, 'a rejected constructor does not invent a returned cleanup capability');
await assert.rejects(runQualificationPhase({ name: 'cancelled-before-admission', signal: controller.signal,
  phases: [], observe: () => assert.fail('cancelled work is not sampled'),
  adopt: () => assert.fail('cancelled work is not adopted'), operation: () => assert.fail('cancelled work is not started') }), error => error === reason);
console.log('Qualification phases preserve late-acquired original owners across cancellation.');
