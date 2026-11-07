import assert from 'node:assert/strict';
import { runNode } from '../../helpers/run-node.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('perf/risk/witness-retention-work/')[1];
const [, scope, arm, trial] = selected?.match(/^(.*)-(candidate|reference)-([123])$/) || [];
assert.ok(scope && arm && trial);
const result = runNode(['--expose-gc', 'tests/fixtures/risk/witness-work-child.js', scope, arm, trial],
  'bounded risk representation work', process.cwd(), process.env,
  { stdio: 'pipe', allowFailure: true, timeoutMs: 10000, maxOutputBytes: 128 * 1024 });
console.log(result.stdout.trim());
assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, '');
const sample = JSON.parse(result.stdout);
assert.equal(sample.scope, scope); assert.equal(sample.arm, arm); assert.equal(sample.trial, Number(trial));
assert.match(sample.inputHash, /^[a-f0-9]{64}$/); assert.match(sample.outputDigest, /^[a-f0-9]{64}$/);
assert.ok(sample.wallMs >= 0); assert.ok(sample.cpuMicroseconds.user + sample.cpuMicroseconds.system >= 0);
assert.ok(sample.work.sampledPeakHeapBytes > 0);
