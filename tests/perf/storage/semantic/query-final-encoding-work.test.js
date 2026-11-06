import assert from 'node:assert/strict';
import { runNode } from '../../../helpers/run-node.js';
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const [, kind, layout, arm] = selected?.match(/^(query|operation)-(memory|merged)-(encoded|reencoded)$/) || [];
assert.ok(kind && layout && arm);
for (const trial of [1, 2, 3]) {
  const child = runNode(['--expose-gc', 'tests/fixtures/semantic/query-work-child.js', kind, layout, arm, String(trial)],
    'bounded semantic query final encoding work', process.cwd(), process.env,
    { stdio: 'pipe', allowFailure: true, timeoutMs: 8000, maxOutputBytes: 128 * 1024 });
  console.log(child.stdout.trim()); assert.equal(child.status, 0, child.stderr); assert.equal(child.stderr, '');
  const sample = JSON.parse(child.stdout);
  assert.equal(sample.kind, kind); assert.equal(sample.layout, layout); assert.equal(sample.arm, arm); assert.equal(sample.trial, trial);
}
