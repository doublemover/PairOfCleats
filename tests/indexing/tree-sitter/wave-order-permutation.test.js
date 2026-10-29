import assert from 'node:assert/strict';
import { buildContinuousWaveExecutionOrder as order } from '../../../src/index/build/tree-sitter-scheduler/plan/execution.js';
const groups = [{ grammarKey: 'b2', bucketKey: 'b', wave: { waveIndex: 1, waveCount: 2 } },
  { grammarKey: 'a2', bucketKey: 'a', wave: { waveIndex: 2 } },
  { grammarKey: 'a1z', bucketKey: 'a', wave: { waveIndex: 1 } },
  { grammarKey: 'a1a', bucketKey: 'a', wave: { waveIndex: 1 } },
  { grammarKey: 'b3', bucketKey: 'b', wave: { waveIndex: 2 } }];
const expected = ['a1a', 'a1z', 'b2', 'a2', 'b3'];
assert.deepEqual(order(groups), expected); assert.deepEqual(order(groups.toReversed()), expected);
assert.deepEqual(order(groups).slice().sort(), groups.map(row => row.grammarKey).sort());
assert.deepEqual(order([]), []); assert.deepEqual(order([{ grammarKey: 'default' }]), ['default']);
assert.deepEqual(order([{ grammarKey: 'late', wave: { waveIndex: Number.MAX_SAFE_INTEGER } }, { grammarKey: 'first' }]), ['first', 'late']);
for (const field of ['waveIndex', 'waveCount']) for (const value of [0, -1, 1.5, NaN, Infinity, '1', false]) {
  assert.throws(() => order([{ grammarKey: 'bad', wave: { [field]: value } }, { grammarKey: 'healthy' }]), TypeError);
}
assert.throws(() => order([{ grammarKey: 'bad', wave: { waveIndex: 2, waveCount: 1 } }]), TypeError);
assert.throws(() => order([{ grammarKey: 'same' }, { grammarKey: 'same' }]), TypeError);
console.log('Same-wave groups preserve exact canonical permutation with bounded sparse metadata and explicit malformed-input rejection.');
