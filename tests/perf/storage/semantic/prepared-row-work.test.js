import assert from 'node:assert/strict';
import { runNode } from '../../../helpers/run-node.js';
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const [, shape, arm] = selected?.match(/^(small|nodes|operands|mixed)-(prepared|plain)$/) || [];
assert.ok(shape && arm);
for (const trial of [1, 2, 3]) {
  const child = runNode(['--expose-gc', 'tests/fixtures/semantic/prepared-work-child.js', shape, arm, String(trial)],
    'bounded real semantic serializer work', process.cwd(), process.env,
    { stdio: 'pipe', allowFailure: true, timeoutMs: 8000, maxOutputBytes: 128 * 1024 });
  console.log(child.stdout.trim()); assert.equal(child.status, 0, child.stderr); assert.equal(child.stderr, '');
  const sample = JSON.parse(child.stdout);
  assert.equal(sample.shape, shape); assert.equal(sample.arm, arm); assert.equal(sample.trial, trial);
  assert.equal(sample.exactStoredBytesOffsetsHashesCountsParity, true);
}
